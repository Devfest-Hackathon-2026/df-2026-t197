import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { createServer } from '../src/server.mjs';
import { FileStore, PPTX_TYPE } from '../src/files.mjs';
import { inspectPptx } from '../src/inspect.mjs';
import { safeMessage } from '../src/mcp.mjs';

const fixture = JSON.parse(await fs.readFile(new URL('../examples/demo.deck.json', import.meta.url), 'utf8'));

async function withServer(options, fn) {
  const server = createServer(options); await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  try { return await fn(base); } finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
}
async function connect(base, headers = {}) {
  const client = new Client({ name: 'test', version: '0' });
  await client.connect(new StreamableHTTPClientTransport(new URL(`${base}/mcp`), { requestInit: { headers } }));
  return client;
}
const call = async (client, name, args) => {
  const result = await client.callTool({ name, arguments: args });
  return { isError: Boolean(result.isError), value: result.isError ? result.content[0].text : JSON.parse(result.content[0].text) };
};

test('MCP lists tools with the executable deck schema', async () => withServer({}, async base => {
  const client = await connect(base);
  try {
    const { tools } = await client.listTools();
    assert.deepEqual(tools.map(t => t.name).sort(), ['edit_pptx', 'inspect_pptx', 'patch_deck', 'read_pptx', 'render_deck', 'upload_pptx', 'validate_deck']);
    assert.deepEqual(tools.find(t => t.name === 'render_deck').inputSchema.properties.deck.required, ['version', 'title', 'slides']);
    assert.match(client.getInstructions(), /render_deck/);
  } finally { await client.close(); }
}));

test('MCP renders, downloads, reads and edits a deck without a shared filesystem', async () => withServer({}, async base => {
  const client = await connect(base);
  try {
    const validation = await call(client, 'validate_deck', { deck: fixture });
    assert.equal(validation.value.status, 'passed');

    const rendered = await call(client, 'render_deck', { deck: fixture });
    assert.equal(rendered.isError, false);
    assert.equal(rendered.value.report.structure.status, 'passed');
    assert.ok(rendered.value.downloadUrl.startsWith(`${base}/files/`));
    const download = await fetch(rendered.value.downloadUrl);
    assert.equal(download.headers.get('content-type'), PPTX_TYPE);
    assert.equal((await inspectPptx(Buffer.from(await download.arrayBuffer()))).slides, 5);

    const read = await call(client, 'read_pptx', { fileId: rendered.value.fileId });
    assert.equal(read.value.slides.length, 5);
    assert.equal(read.value.sha256, rendered.value.sha256);
    assert.ok(JSON.stringify(read.value).length < 40000, 'summary should stay small enough for an agent context');
    const title = read.value.slides[1].elements.find(e => e.placeholder?.type === 'title');
    assert.deepEqual(title.paragraphs, [fixture.slides[1].title]);
    const page2 = await call(client, 'read_pptx', { fileId: rendered.value.fileId, detail: 'full', pages: [2] });
    assert.equal(page2.value.slides.length, 1);

    const edited = await call(client, 'edit_pptx', { fileId: rendered.value.fileId, plan: {
      version: 1, sourceSha256: rendered.value.sha256,
      operations: [{ op: 'replace-paragraph-text', slide: { id: read.value.slides[1].slideId }, shape: { id: title.id, parents: [] }, paragraph: 0, expectedText: fixture.slides[1].title, text: '編集後の見出し' }]
    } });
    assert.equal(edited.isError, false, edited.value);
    assert.notEqual(edited.value.fileId, rendered.value.fileId);
    const after = await call(client, 'read_pptx', { fileId: edited.value.fileId, pages: [2] });
    assert.deepEqual(after.value.slides[0].elements.find(e => e.id === title.id).paragraphs, ['編集後の見出し']);
    assert.equal((await call(client, 'inspect_pptx', { fileId: edited.value.fileId })).value.status, 'passed');

    const stale = await call(client, 'edit_pptx', { fileId: edited.value.fileId, plan: { version: 1, sourceSha256: rendered.value.sha256, operations: [{ op: 'delete-slide', slide: { id: read.value.slides[4].slideId } }] } });
    assert.equal(stale.isError, true);
    assert.match(stale.value, /STALE_INPUT/);
  } finally { await client.close(); }
}));

test('MCP reports fixable errors without crashing the session', async () => withServer({}, async base => {
  const client = await connect(base);
  try {
    const bad = structuredClone(fixture); bad.slides[1].id = bad.slides[0].id;
    const invalid = await call(client, 'render_deck', { deck: bad });
    assert.equal(invalid.isError, true);
    assert.match(invalid.value, /Duplicate slide id/);
    const local = structuredClone(fixture); delete local.slides[2].elements[0].data; local.slides[2].elements[0].path = 'private.png';
    assert.match((await call(client, 'render_deck', { deck: local })).value, /Local image paths are disabled/);
    const patched = await call(client, 'patch_deck', { deck: fixture, operations: [{ op: 'remove', id: 'chart' }] });
    assert.equal(patched.value.deck.slides.length, 4);
    assert.match((await call(client, 'read_pptx', { fileId: 'A'.repeat(32) })).value, /FILE_NOT_FOUND/);
    assert.match((await call(client, 'upload_pptx', { base64: Buffer.from('not a zip').toString('base64') })).value, /NOT_A_ZIP/);
    assert.equal(safeMessage(new Error('ENOENT /app/src/secret/file.png')), 'ENOENT <path>');
    assert.equal(safeMessage(new Error('open C:\\Users\\me\\a.png')), 'open <path>');
    const wrongType = structuredClone(fixture); wrongType.slides[1].layout = 'unknown';
    assert.match((await call(client, 'validate_deck', { deck: wrongType })).value, /\/slides\/1\/layout/);
  } finally { await client.close(); }
}));

test('HTTP upload feeds MCP tools and the access token guards write endpoints', async () => {
  const { buffer } = await (await import('../src/renderer.mjs')).renderDeck(fixture);
  await withServer({ accessToken: 'test-token' }, async base => {
    assert.equal((await fetch(`${base}/health`)).status, 200);
    assert.equal((await fetch(`${base}/files`, { method: 'POST', headers: { 'Content-Type': PPTX_TYPE }, body: buffer })).status, 401);
    await assert.rejects(connect(base));
    const upload = await fetch(`${base}/files`, { method: 'POST', headers: { 'Content-Type': PPTX_TYPE, Authorization: 'Bearer test-token', 'X-File-Name': 'mine.pptx' }, body: buffer });
    assert.equal(upload.status, 201);
    const file = await upload.json();
    const client = await connect(base, { Authorization: 'Bearer test-token' });
    try { assert.equal((await call(client, 'inspect_pptx', { fileId: file.fileId })).value.slides, 5); }
    finally { await client.close(); }
    assert.equal((await fetch(file.downloadUrl)).status, 200);
    assert.equal((await fetch(`${base}/mcp`)).status, 401);
  });
  await withServer({}, async base => assert.equal((await fetch(`${base}/mcp`)).status, 405));
});

test('file store expires and evicts files', () => {
  let time = 0;
  const store = new FileStore({ ttlMs: 10, maxTotalBytes: 6, now: () => time });
  const zip = n => Buffer.concat([Buffer.from('PK'), Buffer.alloc(n - 2)]);
  const a = store.put(zip(3)); const b = store.put(zip(3));
  assert.ok(store.get(a.id) && store.get(b.id));
  const c = store.put(zip(4));
  assert.equal(store.get(a.id), undefined);
  assert.ok(store.get(c.id));
  time = 11;
  assert.equal(store.get(c.id), undefined);
  assert.throws(() => store.put(zip(7)), /FILE_STORE_FULL/);
});
