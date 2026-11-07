import pptxgen from 'pptxgenjs';
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { imageSize } from 'image-size';
import { WIDTH, HEIGHT, bodyBoxFor, validateDeck, lintDeck } from './schema.mjs';
import { restorePlaceholderInheritance } from './inheritance.mjs';

export const hash = data => crypto.createHash('sha256').update(data).digest('hex');

export async function resolveImage(e, assetRoot, allowLocalPaths = true) {
  if (e.data) {
    if (!/^data:image\/(png|jpeg);base64,[A-Za-z0-9+/]+={0,2}$/.test(e.data)) throw new Error(`Unsupported image data: ${e.id}. Use a PNG/JPEG data URL.`);
    const bytes = Buffer.from(e.data.split(',')[1], 'base64');
    const png = bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]));
    const jpeg = bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
    if ((!png && !jpeg) || bytes.length > 8 * 1024 * 1024) throw new Error(`Invalid image bytes/size: ${e.id}`);
    if (png !== e.data.startsWith('data:image/png;')) throw new Error(`Image MIME mismatch: ${e.id}`);
    const dimensions = imageSize(bytes);
    if (!(dimensions.width > 0 && dimensions.height > 0) || dimensions.width * dimensions.height > 50000000) throw new Error(`Unsupported image dimensions: ${e.id}`);
    return { data: e.data, pixelWidth: dimensions.width, pixelHeight: dimensions.height };
  }
  if (!allowLocalPaths) throw new Error('Local image paths are disabled for this request');
  if (!assetRoot) throw new Error('assetRoot is required for image paths');
  const root = await fs.realpath(assetRoot);
  const target = await fs.realpath(path.resolve(root, e.path));
  const relative = path.relative(root, target);
  if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) throw new Error(`Image outside assetRoot: ${e.id}`);
  if (!['.png','.jpg','.jpeg'].includes(path.extname(target).toLowerCase())) throw new Error('Only PNG/JPEG image paths are supported');
  const bytes = await fs.readFile(target);
  const mime = path.extname(target).toLowerCase() === '.png' ? 'png' : 'jpeg';
  return resolveImage({ ...e, data: `data:image/${mime};base64,${bytes.toString('base64')}` }, undefined, false);
}

export async function renderDeck(deck, { assetRoot, allowLocalPaths = true } = {}) {
  validateDeck(deck);
  const images = new Map();
  for (const s of deck.slides) for (const e of s.elements) if (e.type === 'image') images.set(`${s.id}/${e.id}`, await resolveImage(e, assetRoot, allowLocalPaths));
  const theme = { fontFace: 'Yu Gothic', titlePt: 32, bodyPt: 24, foreground: '17212B', accent: '12657A', background: 'FFFFFF', ...deck.theme };
  const pptx = new pptxgen();
  pptx.defineLayout({ name: 'RESEARCH_WIDE', width: WIDTH, height: HEIGHT });
  pptx.layout = 'RESEARCH_WIDE';
  pptx.author = 'Research Slides'; pptx.subject = 'Editable presentation'; pptx.title = deck.title; pptx.lang = 'ja-JP';
  pptx.theme = { headFontFace: theme.fontFace, bodyFontFace: theme.fontFace, lang: 'ja-JP' };
  for (const layout of ['cover', 'body', 'figure', 'comparison', 'results']) {
    pptx.defineSlideMaster({
      title: `research-${layout}`, background: { color: theme.background },
      objects: [
        { placeholder: { options: { name: 'title', type: 'title', x: 0.65, y: layout === 'cover' ? 1.5 : 0.45, w: 12, h: layout === 'cover' ? 1.5 : 0.95, fontFace: theme.fontFace, fontSize: layout === 'cover' ? 38 : theme.titlePt, bold: true, color: theme.accent, margin: 0 }, text: '' } },
        { placeholder: { options: { name: 'body', type: 'body', ...bodyBoxFor(layout), fontFace: theme.fontFace, fontSize: theme.bodyPt, color: theme.foreground, margin: 0, valign: 'top' }, text: '' } }
      ],
      slideNumber: { x: 12.25, y: 7.03, w: 0.4, h: 0.2, fontFace: theme.fontFace, fontSize: 11, color: '666666', align: 'right' }
    });
  }
  for (const s of deck.slides) {
    const slide = pptx.addSlide({ masterName: `research-${s.layout}` });
    slide.addText(s.title, { placeholder: 'title', objectName: `${s.id}:title` });
    if (s.body) slide.addText(s.body, { placeholder: 'body', objectName: `${s.id}:body` });
    for (const e of s.elements) {
      const box = { x: e.x, y: e.y, w: e.w, h: e.h, objectName: `${s.id}:${e.id}` };
      if (e.type === 'text') slide.addText(e.text, { ...box, fontFace: theme.fontFace, fontSize: e.fontSize ?? theme.bodyPt, color: e.color ?? theme.foreground, bold: e.bold ?? false, margin: 0, valign: 'top', ...(e.bullet ? { bullet: { indent: 18 } } : {}) });
      if (e.type === 'shape') slide.addShape(pptx.ShapeType[e.shape], { ...box, line: { color: e.color ?? theme.accent, width: 1.5 }, ...(e.shape === 'line' ? {} : { fill: { color: e.fill ?? theme.background } }) });
      if (e.type === 'image') {
        const image = images.get(`${s.id}/${e.id}`);
        const ratio = image.pixelWidth / image.pixelHeight;
        const w = Math.min(e.w, e.h * ratio), h = w / ratio;
        slide.addImage({ ...box, x: e.x + (e.w - w) / 2, y: e.y + (e.h - h) / 2, w, h, data: image.data, altText: e.alt });
      }
      if (e.type === 'table') slide.addTable(e.rows.map((r, i) => r.map(value => ({ text: String(value), options: i === 0 ? { bold: true, fill: { color: 'EAF2F4' } } : {} }))), {
        ...box, fontFace: theme.fontFace, fontSize: e.fontSize ?? 18, color: theme.foreground, margin: 0.08,
        rowH: e.h / e.rows.length, colW: Array(e.rows[0].length).fill(e.w / e.rows[0].length), border: { type: 'solid', pt: 0.5, color: 'BAC8CC' }, autoPage: false
      });
      if (e.type === 'chart') slide.addChart(pptx.ChartType[e.chartType], e.series.map(series => ({ name: series.name, labels: [...e.labels], values: [...series.values] })), {
        ...box, catAxisLabelFontFace: theme.fontFace, valAxisLabelFontFace: theme.fontFace, catAxisLabelFontSize: e.fontSize ?? 18, valAxisLabelFontSize: e.fontSize ?? 18,
        showTitle: false, showLegend: e.series.length > 1, legendFontFace: theme.fontFace, legendFontSize: 18,
        chartColors: [theme.accent, 'C48139', '48845F'], showValue: true, dataLabelFormatCode: '0.##', showBorder: false, showCatName: false, showSerName: false
      });
    }
    slide.addNotes([s.notes ?? '', ...(s.sources ?? []).map(source => `出典: ${source}`)].filter(Boolean).join('\n'));
  }
  const buffer = await restorePlaceholderInheritance(Buffer.from(await pptx.write({ outputType: 'nodebuffer' })));
  return { buffer, report: { version: 1, title: deck.title, slideCount: deck.slides.length, inputHash: hash(JSON.stringify(deck)), outputHash: hash(buffer), producer: deck.provenance ?? { producer: 'unspecified', model: 'unknown' }, warnings: lintDeck(deck), checks: { input: 'passed', visual: 'not-run', powerpointEditing: 'not-run', factualAccuracy: 'not-run', skillReadByAgent: 'unverified' } } };
}
