import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import JSZip from 'jszip';
import { DOMParser } from '@xmldom/xmldom';
import { validateDeck, lintDeck } from '../src/schema.mjs';
import { renderDeck, resolveImage } from '../src/renderer.mjs';
import { inspectPptx } from '../src/inspect.mjs';
import { patchDeck } from '../src/patch.mjs';
import { createServer } from '../src/server.mjs';

const fixture = JSON.parse(await fs.readFile(new URL('../examples/demo.deck.json', import.meta.url), 'utf8'));
const patch = JSON.parse(await fs.readFile(new URL('../examples/demo.patch.json', import.meta.url), 'utf8'));

test('reject invalid input before rendering', () => {
  const cases = [
    d => { d.slides[0].unexpected = true; },
    d => { d.slides[1].id = d.slides[0].id; },
    d => { d.slides[2].elements[0].w = 100; },
    d => { d.slides[3].elements[0].rows[1].pop(); },
    d => { d.slides[4].elements[0].series[0].values.pop(); },
    d => { d.slides[2].elements[0].path = 'also.png'; }
  ];
  for (const mutate of cases) { const d = structuredClone(fixture); mutate(d); assert.throws(() => validateDeck(d)); }
});

test('patch is atomic and preserves unrelated slides', () => {
  const before = JSON.stringify(fixture); const result = patchDeck(fixture, patch);
  assert.equal(JSON.stringify(fixture), before);
  assert.notEqual(result.slides[1].title, fixture.slides[1].title);
  for (const i of [0, 2, 3, 4]) assert.deepEqual(result.slides[i], fixture.slides[i]);
  assert.throws(() => patchDeck(fixture, [...patch, { op: 'remove', id: 'missing' }]));
  assert.equal(JSON.stringify(fixture), before);
  const reversed = fixture.slides.map(s => s.id).reverse();
  assert.deepEqual(patchDeck(fixture, [{ op: 'reorder', ids: reversed }]).slides.map(s => s.id), reversed);
  assert.throws(() => patchDeck(fixture, [{ op: 'reorder', ids: ['cover'] }]));
});

test('render native elements with notes and embedded chart data', async () => {
  const { buffer, report } = await renderDeck(fixture);
  const inspected = await inspectPptx(buffer);
  assert.equal(inspected.status, 'passed', inspected.errors.join('\n'));
  assert.equal(inspected.slides, 5); assert.equal(inspected.nativeTables, 1);
  assert.equal(inspected.nativeCharts, 1); assert.equal(inspected.embeddedWorkbooks, 1);
  assert.ok(inspected.layouts >= 5);
  const zip = await JSZip.loadAsync(buffer);
  const slide = await zip.file('ppt/slides/slide2.xml').async('string');
  assert.ok(slide.includes('根拠と説明'));
  const xml = new DOMParser().parseFromString(slide, 'application/xml');
  for (const sp of Array.from(xml.getElementsByTagName('p:sp'))) {
    const ph = sp.getElementsByTagName('p:ph')[0];
    if (!ph || !['title', 'body'].includes(ph.getAttribute('type'))) continue;
    for (const r of Array.from(sp.getElementsByTagName('a:rPr'))) {
      assert.equal(r.hasAttribute('sz'), false);
      assert.equal(r.getElementsByTagName('a:latin').length, 0);
    }
    assert.equal(sp.getElementsByTagName('a:xfrm').length, 0);
  }
  const notes = await zip.file('ppt/notesSlides/notesSlide5.xml').async('string');
  assert.ok(notes.includes('架空データ'));
  const imageSlide = new DOMParser().parseFromString(await zip.file('ppt/slides/slide3.xml').async('string'), 'application/xml');
  const imageExtent = imageSlide.getElementsByTagName('p:pic')[0].getElementsByTagName('a:ext')[0];
  assert.equal(Number(imageExtent.getAttribute('cx')) / Number(imageExtent.getAttribute('cy')), 2);
  assert.equal(report.checks.visual, 'not-run'); assert.equal(report.checks.skillReadByAgent, 'unverified');
  const corrupt = await JSZip.loadAsync(buffer);
  const rel = 'ppt/slides/_rels/slide1.xml.rels';
  corrupt.file(rel, (await corrupt.file(rel).async('string')).replace(/Target="[^"]+"/, 'Target="missing.xml"'));
  assert.equal((await inspectPptx(await corrupt.generateAsync({ type: 'nodebuffer' }))).status, 'failed');
});

test('reject external and unsafe image access', async () => {
  await assert.rejects(() => renderDeck(fixture.slides[0]));
  await assert.rejects(() => resolveImage({ id: 'bad', data: 'data:image/png;base64,YmFk' }));
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'research-slides-'));
  try {
    await fs.mkdir(path.join(temp, 'assets'));
    await fs.writeFile(path.join(temp, 'outside.png'), 'not actually a png');
    await assert.rejects(() => resolveImage({ id: 'escape', path: '../outside.png' }, path.join(temp, 'assets')));
    await assert.rejects(() => resolveImage({ id: 'remote', path: 'image.png' }, temp, false));
  } finally { await fs.rm(temp, { recursive: true, force: true }); }
});

test('density warning does not silently alter text', () => {
  const d = structuredClone(fixture); d.slides[1].body = '長い文章'.repeat(500);
  assert.ok(lintDeck(d).some(w => w.code === 'DENSITY_ESTIMATE'));
  assert.equal(d.slides[1].body, '長い文章'.repeat(500));
});

test('HTTP endpoint renders and rejects bad input', async () => {
  const server = createServer(); await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    assert.equal((await (await fetch(`${base}/health`)).json()).llm, 'not-connected');
    const response = await fetch(`${base}/render`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(fixture) });
    assert.equal(response.status, 200);
    assert.equal((await inspectPptx(Buffer.from(await response.arrayBuffer()))).slides, 5);
    assert.equal((await fetch(`${base}/render`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })).status, 400);
    const d = structuredClone(fixture); delete d.slides[2].elements[0].data; d.slides[2].elements[0].path = 'private.png';
    assert.equal((await fetch(`${base}/render`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(d) })).status, 400);
  } finally { await new Promise(resolve => server.close(resolve)); }
});
