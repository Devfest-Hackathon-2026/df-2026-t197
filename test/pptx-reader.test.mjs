import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import JSZip from 'jszip';
import { fixture } from './fixtures/pptx-package.mjs';
import { readPptx } from '../src/pptx/read/index.mjs';
import { PptxPackage, sha256 } from '../src/pptx/package.mjs';
import { parseXml } from '../src/pptx/xml.mjs';
import { resolveBounds } from '../src/pptx/read/geometry.mjs';
import { renderDeck } from '../src/renderer.mjs';

test('XML accepts large flat artwork while enforcing element and depth budgets', () => {
  assert.ok(parseXml(`<a>${'<b/>'.repeat(230000)}</a>`, 'large-artwork'));
  assert.throws(() => parseXml(`<a>${'<b/>'.repeat(300000)}</a>`, 'too-many'), /XML_COMPLEXITY_LIMIT/);
  assert.throws(() => parseXml('<a>'.repeat(130) + '</a>'.repeat(130), 'too-deep'), /XML_COMPLEXITY_LIMIT/);
});

test('reader follows presentation order, not filenames, and leaves bytes unchanged', async () => {
  const bytes = await fixture(), hash = sha256(bytes), r = await readPptx(bytes);
  assert.equal(sha256(bytes),hash); assert.equal(r.source.sha256,hash); assert.equal(r.readOnly,true);
  assert.deepEqual(r.slides.map(s=>[s.page,s.slideId,s.part.split('/').at(-1)]),[[1,'300','slide9.xml'],[2,'301','slide3.xml']]);
  assert.equal(r.summary.hiddenSlides,1); assert.equal(r.summary.masters,1); assert.equal(r.summary.layouts,1);
  assert.deepEqual(r.unlistedSlideParts,['ppt/slides/slide7.xml']);
  assert.equal(r.slides[0].notes.speakerText,'speaker note');
  assert.equal(r.slides[0].elements[2].image.source.external,true);
  assert.equal(r.slides[0].elements[3].kind,'unsupported-element');
  assert.ok(r.issues.some(i=>i.code==='SHAPE_CONTENT_NOT_DECODED'));
  assert.ok(r.parts.every(p=>/^[a-f0-9]{64}$/.test(p.sha256)));
});

test('placeholder matches idx, preserves whitespace, and records inherited properties', async () => {
  const r = await readPptx(await fixture()), s = r.slides[0].elements[0], run = s.text.paragraphs[0].runs[0];
  assert.equal(s.text.text,' first '); assert.equal(r.slides[0].titleText,' first ');
  assert.deepEqual(s.inheritance.map(i=>[i.scope,i.shapeId]),[['layout','2'],['master','1']]);
  assert.equal(run.resolved.fontSizePt.value,28); assert.equal(run.resolved.fontSizePt.source.scope,'layout');
  assert.equal(run.resolved.bold.value,false); assert.equal(run.resolved.bold.source.scope,'slide');
  assert.equal(run.resolved.latinFont.theme.value,'Test Major');
  assert.deepEqual(s.geometry.pageBounds,{x:100,y:200,width:300,height:400,unit:'EMU'});
  const g = r.slides[0].elements[1].children[0];
  assert.deepEqual(g.parentIds,['6']);
  assert.deepEqual(g.geometry.pageBounds,{x:1200,y:2600,width:600,height:1200,unit:'EMU'});
});

test('Strict namespaces and arbitrary prefixes produce the same logical index', async () => {
  const r = await readPptx(await fixture({strict:true,mutate:files=>{
    for (const key of Object.keys(files)) if (!key.endsWith('.rels')) files[key] = files[key].replaceAll('xmlns:p=','xmlns:slides=').replaceAll('<p:','<slides:').replaceAll('</p:','</slides:');
  }}));
  assert.equal(r.summary.readSlides,2); assert.equal(r.slides[0].titleText,' first ');
  assert.ok(!r.issues.some(i=>i.severity==='error'),JSON.stringify(r.issues));
});

test('missing slide references remain in page positions and yield partial status', async () => {
  const r = await readPptx(await fixture({mutate:f=>{delete f['ppt/slides/slide9.xml'];}}));
  assert.equal(r.status,'partial'); assert.equal(r.slides.length,2);
  assert.equal(r.slides[0].readStatus,'unreadable'); assert.equal(r.slides[1].page,2);
});

test('duplicate IDs and ambiguous placeholder matches are explicit errors', async () => {
  const r = await readPptx(await fixture({mutate:f=>{
    f['ppt/slides/slide9.xml']=f['ppt/slides/slide9.xml'].replace('id="8"','id="5"');
    const key='ppt/slideLayouts/layout.xml', sp=f[key].match(/<p:sp>.*?<\/p:sp>/)[0];
    f[key]=f[key].replace('</p:spTree>',sp.replace('id="2"','id="20"')+'</p:spTree>');
  }}));
  assert.equal(r.status,'partial');
  for(const code of ['DUPLICATE_SHAPE_ID','AMBIGUOUS_PLACEHOLDER']) assert.ok(r.issues.some(i=>i.code===code),code);
});

test('empty media action ID is allowed while a missing image ID remains an error', async () => {
  const r=await readPptx(await fixture({mutate:f=>{
    const key='ppt/slides/slide9.xml';
    f[key]=f[key].replace('<p:cNvPr id="5" name="item5"/>','<p:cNvPr id="5" name="item5"><a:hlinkClick r:id="" action="ppaction://media"/></p:cNvPr>').replace('r:link="remote"','r:link="missing"');
  }}));
  const errors=r.issues.filter(i=>i.code==='SHAPE_RELATIONSHIP_MISSING');
  assert.equal(errors.length,1); assert.equal(errors[0].detail.id,'missing');
  assert.equal(r.slides[0].elements[0].relationshipReferences[0].intrinsicAction,true);
});

test('unrotated bounds are never claimed for rotated or incomplete groups', () => {
  const transform={offset:{x:1,y:2},extent:{cx:3,cy:4},rotation:60000};
  assert.equal(resolveBounds([{transform}]).pageBounds,null);
  assert.equal(resolveBounds([{transform:{...transform,rotation:0}}],[{}]).pageBounds,null);
});

test('reject unsafe XML and archive paths, and enforce declared size limits', async () => {
  assert.throws(()=>parseXml('<!DOCTYPE a [<!ENTITY x "x">]><a/>','test'),/DTD/);
  assert.throws(()=>parseXml('<a><b></a>','test'),/INVALID_XML/);
  const bytes=await fixture();
  await assert.rejects(readPptx(bytes,{limits:{inputBytes:10}}),/INPUT_SIZE_LIMIT/);
  await assert.rejects(readPptx(bytes,{limits:{xmlBytes:100}}),/PART_SIZE_LIMIT/);
  const zip=new JSZip(); zip.file('../escape.xml','<a/>',{createFolders:false});
  await assert.rejects(PptxPackage.open(await zip.generateAsync({type:'nodebuffer'})),/UNSAFE_ZIP_NAME/);
  const pkg=await PptxPackage.open(bytes);
  assert.throws(()=>pkg.resolve('ppt/slides/slide9.xml','../../../outside'),/TARGET_OUTSIDE_PACKAGE/);
});

test('reader indexes generated native tables, chart caches, image and notes', async () => {
  const deck=JSON.parse(await fs.readFile(new URL('../examples/demo.deck.json',import.meta.url),'utf8'));
  const {buffer}=await renderDeck(deck), r=await readPptx(buffer);
  assert.equal(r.status,'read',JSON.stringify(r.issues)); assert.equal(r.summary.readSlides,5);
  assert.equal(r.summary.elementKinds.table,1); assert.equal(r.summary.elementKinds.chart,1); assert.equal(r.summary.elementKinds.image,1);
  const elements=r.slides.flatMap(s=>s.elements), table=elements.find(e=>e.kind==='table'),chart=elements.find(e=>e.kind==='chart');
  assert.equal(table.table.rows.length,deck.slides[3].elements[0].rows.length);
  assert.equal(chart.chart.series[0].values.caches[0].points.length,deck.slides[4].elements[0].series[0].values.length);
  assert.ok(r.slides.some(s=>s.notes?.speakerText));
});
