import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { deckSchema, validateDeck, lintDeck } from './schema.mjs';
import { renderDeck } from './renderer.mjs';
import { inspectPptx } from './inspect.mjs';
import { patchDeck } from './patch.mjs';
import { readPptx } from './pptx/read/index.mjs';
import { editPptx } from './pptx/edit/index.mjs';
import { editPlanSchema } from './pptx/edit/plan.mjs';
import { describeFile } from './files.mjs';

const pkg = { name: 'research-slides', version: '0.1.0' };
const MAX_UPLOAD_BASE64 = 11 * 1024 ** 2;

const instructions = `編集可能なPPTXを作る・直すためのツール群です。判断（構成・説明・出典）は呼び出し側のAIが行い、このサーバーは決まった処理（検査・生成・編集）だけを行います。
新規作成: validate_deck で警告を確認 → render_deck でPPTXを生成し downloadUrl から取得。ページ単位の修正は patch_deck でdeckを直してから再度 render_deck。
既存PPTXの編集: upload_pptx（またはHTTPの POST /files）で登録 → read_pptx でスライド・図形IDと sha256 を確認 → edit_pptx に plan（sourceSha256 は登録時の sha256）を渡す。
ファイルIDとdownloadUrlは一時的（既定30分）で、サーバー再起動で消えます。構造検査は表示品質の保証ではないため、描画して目で確認してください。`;

const fileIdSchema = { type: 'string', pattern: '^[A-Za-z0-9_-]{32}$', description: 'upload_pptx / render_deck / edit_pptx が返した fileId' };
const object = (properties, required) => ({ type: 'object', properties, required, additionalProperties: false });

export const tools = [
  { name: 'validate_deck', description: 'deck.json をスキーマ検査し、過密・小さい文字などの警告を返す。PPTXは作らない。', inputSchema: object({ deck: { type: 'object', description: 'render_deck と同じ形式の deck.json' } }, ['deck']) },
  { name: 'render_deck', description: 'deck.json から編集可能なPPTXを生成し、構造検査の結果・警告・一時ダウンロードURLを返す。画像はPNG/JPEGのdata URLのみ（ローカルパス不可）。', inputSchema: object({ deck: deckSchema }, ['deck']) },
  { name: 'patch_deck', description: 'deck.json にページ単位の操作（replace / insert / remove / reorder）を適用し、検査済みの新しい deck.json を返す。元のdeckは変更しない。', inputSchema: object({
    deck: { type: 'object', description: '元の deck.json' },
    operations: { type: 'array', maxItems: 100, description: '{op:"replace",id,slide} | {op:"insert",after?,slide} | {op:"remove",id} | {op:"reorder",ids}', items: { type: 'object' } }
  }, ['deck', 'operations']) },
  { name: 'upload_pptx', description: '既存PPTXをbase64で登録し fileId と sha256 を返す。大きいファイルはHTTPの POST /files（本文にPPTXそのもの）を使う。', inputSchema: object({ base64: { type: 'string', minLength: 1, maxLength: MAX_UPLOAD_BASE64 }, name: { type: 'string', maxLength: 200 } }, ['base64']) },
  { name: 'inspect_pptx', description: '登録済みPPTXの内部構造（ZIP・XML・参照・スライド数・表/グラフ/マスター数）を検査する。XSD準拠や表示品質の保証ではない。', inputSchema: object({ fileId: fileIdSchema }, ['fileId']) },
  { name: 'read_pptx', description: '登録済みPPTXを読み、スライド・図形ID・本文・レイアウトを返す。edit_pptx の plan を作る前に使う。既定の summary は段落ごとの文字・位置・プレースホルダーだけ。書式の継承元まで要るときは detail:"full" と pages で範囲を絞る（full は大きい）。', inputSchema: object({
    fileId: fileIdSchema,
    detail: { enum: ['summary', 'full'], default: 'summary' },
    pages: { type: 'array', maxItems: 200, items: { type: 'integer', minimum: 1 }, description: '返すページ番号（1始まり）。省略時は全ページ' }
  }, ['fileId']) },
  { name: 'edit_pptx', description: '登録済みPPTXを原本を保ったまま編集し、新しい fileId と変更報告を返す。plan.sourceSha256 は対象ファイルの sha256。', inputSchema: object({ fileId: fileIdSchema, plan: editPlanSchema }, ['fileId', 'plan']) }
];

const paragraphs = text => (text?.paragraphs ?? []).map(p => p.runs.map(r => r.text ?? '').join(''));
const shapeSummary = e => ({
  id: e.id, name: e.name, kind: e.kind, ...(e.parentIds?.length ? { parentIds: e.parentIds } : {}),
  ...(e.placeholder ? { placeholder: { type: e.placeholder.type, idx: e.placeholder.idx } } : {}),
  ...(e.geometry?.pageBounds ?? e.geometry?.bounds ? { boundsEmu: (({ x, y, width, height }) => ({ x, y, width, height }))(e.geometry.pageBounds ?? e.geometry.bounds) } : {}),
  ...(e.text ? { paragraphs: paragraphs(e.text) } : {}),
  ...(e.table ? { table: e.table.rows.map(r => r.cells.map(c => paragraphs(c.text))) } : {}),
  ...(e.chart ? { chart: { part: e.chart.part, types: e.chart.chartTypes } } : {}),
  ...(e.description ? { alt: e.description } : {})
});
// The full reader output is ~40KB per slide; agents usually need only ids and text to plan edits.
export function summarizeRead(index, pages) {
  const wanted = pages?.length ? new Set(pages) : null;
  return {
    status: index.status, source: index.source, slideSize: index.slideSize, summary: index.summary,
    slides: index.slides.filter(s => !wanted || wanted.has(s.page)).map(s => ({
      page: s.page, slideId: s.slideId, hidden: s.hidden, layoutPart: s.layoutPart, titleText: s.titleText,
      elements: s.elements.map(shapeSummary),
      notes: s.notes ? s.notes.elements.filter(e => e.placeholder?.type === 'body').flatMap(e => paragraphs(e.text)) : null
    })),
    layouts: index.layouts.map(l => ({ part: l.part, name: l.name, type: l.type, placeholders: l.elements.filter(e => e.placeholder).map(e => ({ type: e.placeholder.type, idx: e.placeholder.idx })) })),
    issues: index.issues, limitations: index.limitations
  };
}

const text = value => ({ content: [{ type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value) }] });
// Validation messages help the agent fix its input; strip absolute paths and cap length.
// Ajv instance paths such as /slides/1/id stay intact so the agent can find the bad field.
export const safeMessage = error => String(error?.message ?? error).replace(/(?:[A-Za-z]:\\|\/(?:Users|home|app|tmp|var|private|opt|root|workspace)\/)[^\s"']*/g, '<path>').slice(0, 4000);

export function createMcpServer({ files, baseUrl, exclusive = fn => fn() }) {
  const server = new Server(pkg, { capabilities: { tools: {} }, instructions });
  const stored = id => { const f = files.get(id); if (!f) throw new Error('FILE_NOT_FOUND_OR_EXPIRED: upload again'); return f; };
  const handlers = {
    validate_deck: async ({ deck }) => ({ status: 'passed', warnings: lintDeck(validateDeck(deck)) }),
    render_deck: ({ deck }) => exclusive(async () => {
      const { buffer, report } = await renderDeck(deck, { allowLocalPaths: false });
      const structure = await inspectPptx(buffer);
      if (structure.status !== 'passed') throw new Error(`OUTPUT_VALIDATION_FAILED: ${structure.errors.join('; ')}`);
      const file = files.put(buffer, { name: 'slides.pptx' });
      return { ...describeFile(file, baseUrl), report: { ...report, structure, slideMap: deck.slides.map((s, i) => ({ id: s.id, page: i + 1, elements: s.elements.map(e => e.id) })) } };
    }),
    patch_deck: async ({ deck, operations }) => { const changed = patchDeck(deck, operations); return { deck: changed, warnings: lintDeck(changed) }; },
    upload_pptx: async ({ base64, name }) => {
      if (typeof base64 !== 'string' || base64.length > MAX_UPLOAD_BASE64 || !/^[A-Za-z0-9+/]+={0,2}$/.test(base64)) throw new Error('INVALID_BASE64');
      return describeFile(files.put(Buffer.from(base64, 'base64'), { name: typeof name === 'string' && name ? name : 'input.pptx' }), baseUrl);
    },
    inspect_pptx: async ({ fileId }) => inspectPptx(stored(fileId).buffer),
    read_pptx: async ({ fileId, detail = 'summary', pages }) => {
      const file = stored(fileId), index = await readPptx(file.buffer);
      if (detail === 'full') return { fileId, sha256: file.sha256, ...index, slides: pages?.length ? index.slides.filter(s => pages.includes(s.page)) : index.slides };
      return { fileId, sha256: file.sha256, ...summarizeRead(index, pages) };
    },
    edit_pptx: ({ fileId, plan }) => exclusive(async () => {
      const { buffer, report } = await editPptx(stored(fileId).buffer, plan);
      return { ...describeFile(files.put(buffer, { name: 'edited.pptx' }), baseUrl), report };
    })
  };
  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools }));
  server.setRequestHandler(CallToolRequestSchema, async request => {
    const handler = handlers[request.params.name];
    if (!handler) return { isError: true, ...text(`Unknown tool: ${request.params.name}`) };
    try { return text(await handler(request.params.arguments ?? {})); }
    catch (error) { return { isError: true, ...text(safeMessage(error)) }; }
  });
  return server;
}
