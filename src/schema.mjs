import Ajv from 'ajv';
import { assertXmlStrings } from './xml-text.mjs';

const string = { type: 'string', minLength: 1 };
const id = { ...string, pattern: '^[a-zA-Z0-9_-]{1,80}$' };
const color = { type: 'string', pattern: '^[0-9A-Fa-f]{6}$' };
const number = { type: 'number', minimum: 0 };
const pt = { type: 'number', minimum: 8, maximum: 96 };
const object = (properties, required = []) => ({ type: 'object', properties, required, additionalProperties: false });
const common = { id, x: number, y: number, w: { type: 'number', exclusiveMinimum: 0 }, h: { type: 'number', exclusiveMinimum: 0 } };
const element = (type, properties, required) => object({ ...common, type: { const: type }, ...properties }, ['id', 'type', 'x', 'y', 'w', 'h', ...required]);
export const slideSchema = object({
  id, title: { ...string, maxLength: 500 },
  layout: { enum: ['cover', 'body', 'figure', 'comparison', 'results'] },
  body: { type: 'string', maxLength: 12000 },
  notes: { type: 'string', maxLength: 30000 },
  sources: { type: 'array', maxItems: 100, items: { ...string, maxLength: 1000 } },
  elements: { type: 'array', maxItems: 100, items: { oneOf: [
    element('text', { text: { ...string, maxLength: 12000 }, fontSize: pt, bold: { type: 'boolean' }, color, bullet: { type: 'boolean' } }, ['text']),
    element('image', { path: { ...string, maxLength: 500 }, data: { ...string, maxLength: 11000000 }, alt: string }, ['alt']),
    element('shape', { shape: { enum: ['rect', 'ellipse', 'line'] }, color, fill: color }, ['shape']),
    element('table', { rows: { type: 'array', minItems: 1, maxItems: 50, items: { type: 'array', minItems: 1, maxItems: 20, items: { type: ['string', 'number'] } } }, fontSize: pt }, ['rows']),
    element('chart', { chartType: { enum: ['bar', 'line'] }, labels: { type: 'array', minItems: 1, maxItems: 30, items: string }, series: { type: 'array', minItems: 1, maxItems: 8, items: object({ name: string, values: { type: 'array', minItems: 1, maxItems: 30, items: { type: 'number' } } }, ['name', 'values']) }, fontSize: pt }, ['chartType', 'labels', 'series'])
  ] } }
}, ['id', 'title', 'layout', 'elements']);

export const deckSchema = object({
  version: { const: 1 }, title: { ...string, maxLength: 500 },
  theme: object({ fontFace: { ...string, maxLength: 100 }, titlePt: pt, bodyPt: pt, foreground: color, accent: color, background: color }),
  provenance: object({ producer: string, model: string, prompt: { type: 'string', maxLength: 30000 } }),
  slides: { type: 'array', minItems: 1, maxItems: 80, items: slideSchema }
}, ['version', 'title', 'slides']);

const validate = new Ajv({ allErrors: true, strict: true, allowUnionTypes: true }).compile(deckSchema);
export const WIDTH = 13.333333;
export const HEIGHT = 7.5;
export const BODY_BOX = { x: 0.65, y: 1.65, w: 12, h: 4.95 };
export const bodyBoxFor = layout => layout === 'cover' ? { ...BODY_BOX, y: 3.4, h: 2.8 } : { ...BODY_BOX };

export function validateDeck(deck) {
  if (!validate(deck)) throw new Error(`Invalid deck: ${JSON.stringify(validate.errors)}`);
  assertXmlStrings(deck);
  const ids = new Set();
  for (const slide of deck.slides) {
    if (ids.has(slide.id)) throw new Error(`Duplicate slide id: ${slide.id}`);
    ids.add(slide.id);
    const elements = new Set();
    for (const e of slide.elements) {
      if (elements.has(e.id)) throw new Error(`Duplicate element id: ${slide.id}/${e.id}`);
      elements.add(e.id);
      if (e.x + e.w > WIDTH + 0.001 || e.y + e.h > HEIGHT + 0.001) throw new Error(`Element outside slide: ${slide.id}/${e.id}`);
      if (e.type === 'table' && e.rows.some(r => r.length !== e.rows[0].length)) throw new Error(`Uneven table: ${slide.id}/${e.id}`);
      if (e.type === 'chart' && e.series.some(s => s.values.length !== e.labels.length)) throw new Error(`Chart labels/data mismatch: ${slide.id}/${e.id}`);
      if (e.type === 'image' && Number(Boolean(e.path)) + Number(Boolean(e.data)) !== 1) throw new Error(`Image needs exactly one path or data: ${slide.id}/${e.id}`);
    }
  }
  return deck;
}

export function lintDeck(deck) {
  const warnings = [];
  const textCheck = (slide, element, text, size, w, h) => {
    if (size < 24) warnings.push({ slide, element, code: 'SMALL_BODY_TEXT', message: `${size}pt。初期の本文目安24ptより小さい。` });
    const columns = Math.max(1, Math.floor(w * 72 / size));
    const lines = text.split('\n').reduce((n, line) => n + Math.max(1, Math.ceil([...line].length / columns)), 0);
    if (lines * size * 1.3 > h * 72) warnings.push({ slide, element, code: 'DENSITY_ESTIMATE', message: '文字数から過密の可能性。実際に描画して確認する。' });
  };
  for (const s of deck.slides) {
    if ([...s.title].length > 45) warnings.push({ slide: s.id, code: 'LONG_TITLE', message: '見出しが長いため折り返しを確認する。' });
    const bodyBox = bodyBoxFor(s.layout);
    if (s.body) textCheck(s.id, 'body', s.body, deck.theme?.bodyPt ?? 24, bodyBox.w, bodyBox.h);
    for (const e of s.elements) {
      if (e.type === 'text') textCheck(s.id, e.id, e.text, e.fontSize ?? deck.theme?.bodyPt ?? 24, e.w, e.h);
      if (['table', 'chart'].includes(e.type) && (e.fontSize ?? 18) < 18) warnings.push({ slide: s.id, element: e.id, code: 'SMALL_DATA_TEXT', message: '図表の文字が18pt未満。' });
      if (e.type === 'text' && e.fontSize) warnings.push({ slide: s.id, element: e.id, code: 'LOCAL_STYLE', message: '自由配置の個別サイズ指定。マスターからの継承を実際に確認する。' });
    }
  }
  return warnings;
}
