import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import JSZip from 'jszip';
import { editPptx } from '../src/pptx/edit/index.mjs';
import { saveEditedPptx } from '../src/pptx/edit/save.mjs';
import { readPptx } from '../src/pptx/read/index.mjs';
import { PptxPackage, sha256 } from '../src/pptx/package.mjs';
import { renderDeck } from '../src/renderer.mjs';
import { fixture } from './fixtures/pptx-package.mjs';

const original=await fixture();
const plan=operations=>({version:1,sourceSha256:sha256(original),operations});
const duplicate={op:'duplicate-slide',slide:{id:'300'},as:'copy',after:{id:'300'}};
const change={op:'replace-run-text',slide:{alias:'copy'},shape:{id:'5',parents:[]},paragraph:0,run:0,expectedText:' first ',text:' new title & <test> '};

test('duplicate preserves unknown elements, layout inheritance and all untouched bytes', async()=>{
  const before=sha256(original),{buffer,report}=await editPptx(original,plan([duplicate,change]));
  assert.equal(sha256(original),before);
  const r=await readPptx(buffer);
  assert.deepEqual(r.slides.map(s=>s.slideId),['300','302','301']);
  assert.equal(r.slides[0].titleText,' first ');assert.equal(r.slides[1].titleText,change.text);
  assert.equal(r.slides[0].layoutPart,r.slides[1].layoutPart);
  assert.equal(r.slides[0].elements[0].text.paragraphs[0].runs[0].resolved.fontSizePt.value,r.slides[1].elements[0].text.paragraphs[0].runs[0].resolved.fontSizePt.value);
  assert.notEqual(r.slides[0].notes.part,r.slides[1].notes.part);
  assert.equal(r.slides[1].elements[3].kind,'unsupported-element');
  assert.ok(report.preservation.changedOriginalParts.every(p=>['ppt/presentation.xml','ppt/_rels/presentation.xml.rels','[Content_Types].xml'].includes(p.part)));
  const a=await PptxPackage.open(original),b=await PptxPackage.open(buffer);
  for(const p of await a.inventory()) if(!report.preservation.changedOriginalParts.some(c=>c.part===p.part)) assert.deepEqual(await b.raw(p.part),await a.raw(p.part),p.part);
});

test('edit existing grouped run without replacing whole slide content',async()=>{
  const operation={...change,slide:{id:'300'},shape:{id:'7',parents:['6']},expectedText:'group child',text:'changed child'};
  const {buffer,report}=await editPptx(original,plan([operation]));
  const r=await readPptx(buffer);
  assert.equal(r.slides[0].elements[1].children[0].text.text,'changed child');
  assert.deepEqual(report.preservation.changedOriginalParts.map(p=>p.part),['ppt/slides/slide9.xml']);
  assert.equal(r.slides[0].titleText,' first ');
});

test('run edits preserve neighbouring mixed formatting, hyperlinks, bullets and fields',async()=>{
  const bytes=await fixture({mutate:f=>{
    const key='ppt/slides/slide9.xml';
    f[key]=f[key].replace('<a:p>','<a:p><a:pPr><a:buChar char="•"/></a:pPr>').replace('<a:rPr b="0"/>','<a:rPr b="0"><a:hlinkClick r:id="remote"/></a:rPr>').replace('<a:t> first </a:t></a:r>','<a:t> first </a:t></a:r><a:r><a:rPr sz="1900" i="1"/><a:t>keep me</a:t></a:r><a:fld id="field1" type="slidenum"><a:t>1</a:t></a:fld>');
  }});
  const operation={...change,slide:{id:'300'}};
  const {buffer}=await editPptx(bytes,{...plan([operation]),sourceSha256:sha256(bytes)});
  const paragraph=(await readPptx(buffer)).slides[0].elements[0].text.paragraphs[0];
  assert.equal(paragraph.bullet.attributes.char,'•');
  assert.deepEqual(paragraph.runs.map(r=>r.text),[change.text,'keep me','1']);
  assert.equal(paragraph.runs[0].direct.bold,false);
  assert.equal(paragraph.runs[1].direct.fontSizePt,19);assert.equal(paragraph.runs[1].direct.italic,true);
  const zip=await JSZip.loadAsync(buffer);
  assert.match(await zip.file('ppt/slides/slide9.xml').async('string'),/hlinkClick r:id="remote"/);
  await assert.rejects(editPptx(bytes,{...plan([{...operation,run:2,expectedText:'1'}]),sourceSha256:sha256(bytes)}),/UNSUPPORTED_EDIT: field/);
});

test('native charts, embedded workbooks and notes are independently cloned with correct back-links',async()=>{
  const deck=JSON.parse(await fs.readFile(new URL('../examples/demo.deck.json',import.meta.url),'utf8'));
  const {buffer:input}=await renderDeck(deck),before=await readPptx(input),source=before.slides[4];
  const {buffer}=await editPptx(input,{version:1,sourceSha256:sha256(input),operations:[{op:'duplicate-slide',slide:{id:source.slideId},as:'chartCopy',after:{id:source.slideId}}]});
  const r=await readPptx(buffer),copy=r.slides[5];
  const oldChart=source.elements.find(e=>e.kind==='chart').chart,newChart=copy.elements.find(e=>e.kind==='chart').chart;
  assert.notEqual(oldChart.part,newChart.part);
  assert.deepEqual(oldChart.series,newChart.series);
  const oldData=oldChart.relationships.find(r=>r.kind==='package'),newData=newChart.relationships.find(r=>r.kind==='package');
  assert.notEqual(oldData.part,newData.part);
  const pkg=await PptxPackage.open(buffer);
  assert.deepEqual(await pkg.raw(oldData.part),await pkg.raw(newData.part));
  assert.notEqual(source.notes.part,copy.notes.part);
  assert.equal((await pkg.relationships(copy.notes.part)).find(r=>r.kind==='slide').part,copy.part);
  assert.equal((await pkg.relationships(source.notes.part)).find(r=>r.kind==='slide').part,source.part);
  assert.equal(r.summary.masters,before.summary.masters);assert.equal(r.summary.layouts,before.summary.layouts);
});

test('stale hash/text, invalid plan and ambiguous or unsupported targets fail atomically',async()=>{
  const hash=sha256(original);
  await assert.rejects(editPptx(original,{...plan([duplicate]),sourceSha256:'0'.repeat(64)}),/STALE_INPUT/);
  await assert.rejects(editPptx(original,plan([duplicate,{...change,expectedText:'wrong'}])),/STALE_TEXT/);
  await assert.rejects(editPptx(original,plan([duplicate,{...change,shape:{id:'999',parents:[]}}])),/TARGET_NOT_FOUND/);
  await assert.rejects(editPptx(original,plan([duplicate,{...change,text:'a\nb'}])),/UNSUPPORTED_TEXT_CONTROL/);
  await assert.rejects(editPptx(original,plan([{...duplicate,unexpected:true}])),/INVALID_EDIT_PLAN/);
  assert.equal(sha256(original),hash);
});

test('unsupported section membership and unknown owned dependencies are refused',async()=>{
  const bytes=await fixture({mutate:f=>{f['ppt/presentation.xml']=f['ppt/presentation.xml'].replace('</p:presentation>','<p:extLst><p:sectionLst/></p:extLst></p:presentation>');}});
  await assert.rejects(editPptx(bytes,{...plan([duplicate]),sourceSha256:sha256(bytes)}),/section/);
  const unsupported=await fixture({mutate:f=>{f['ppt/slides/_rels/slide9.xml.rels']=f['ppt/slides/_rels/slide9.xml.rels'].replace('/notesSlide"','/unknownMutablePart"');}});
  await assert.rejects(editPptx(unsupported,{...plan([duplicate]),sourceSha256:sha256(unsupported)}),/UNSUPPORTED_DUPLICATE_RELATIONSHIP/);
});

test('PowerPoint sections include the new page in insertion order and preserve section boundaries',async()=>{
  const bytes=await fixture({mutate:f=>{
    f['ppt/presentation.xml']=f['ppt/presentation.xml'].replace('</p:presentation>','<p:extLst><p:ext uri="test"><p14:sectionLst xmlns:p14="http://schemas.microsoft.com/office/powerpoint/2010/main"><p14:section name="one" id="1"><p14:sldIdLst><p14:sldId id="300"/></p14:sldIdLst></p14:section><p14:section name="two" id="2"><p14:sldIdLst><p14:sldId id="301"/></p14:sldIdLst></p14:section></p14:sectionLst></p:ext></p:extLst></p:presentation>');
  }});
  const {buffer}=await editPptx(bytes,{...plan([duplicate]),sourceSha256:sha256(bytes)});
  const pkg=await PptxPackage.open(buffer),root=await pkg.xml('ppt/presentation.xml');
  const sections=Array.from(root.getElementsByTagNameNS('http://schemas.microsoft.com/office/powerpoint/2010/main','section'));
  assert.deepEqual(sections.map(s=>Array.from(s.getElementsByTagNameNS(s.namespaceURI,'sldId')).map(n=>n.getAttribute('id'))),[['300','302'],['301']]);
});

test('multiple copies get distinct IDs, names and private notes; alias can be insertion point',async()=>{
  const {buffer}=await editPptx(original,plan([duplicate,{...duplicate,as:'copyTwo',after:{alias:'copy'}}]));
  const r=await readPptx(buffer);
  assert.deepEqual(r.slides.map(s=>s.slideId),['300','302','303','301']);
  assert.equal(new Set(r.slides.map(s=>s.part)).size,4);
  assert.equal(new Set(r.slides.filter(s=>s.notes).map(s=>s.notes.part)).size,3);
});

test('Strict XML namespaces survive cloning and text replacement',async()=>{
  const bytes=await fixture({strict:true});
  const {buffer}=await editPptx(bytes,{...plan([duplicate,change]),sourceSha256:sha256(bytes)});
  assert.equal((await readPptx(buffer)).slides[1].titleText,change.text);
});

test('cloned relationship parts retain content types even without a default rels mapping',async()=>{
  const bytes=await fixture({mutate:f=>{
    const key='[Content_Types].xml';
    f[key]=f[key].replace(/<Default Extension="rels"[^>]*\/>/,'');
    const overrides=Object.keys(f).filter(p=>p.endsWith('.rels')).map(p=>`<Override PartName="/${p}" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>`).join('');
    f[key]=f[key].replace('</Types>',overrides+'</Types>');
  }});
  const {buffer}=await editPptx(bytes,{...plan([duplicate]),sourceSha256:sha256(bytes)});
  const r=await readPptx(buffer);
  for(const part of r.parts.filter(p=>p.part.endsWith('.rels'))) assert.equal(part.contentType,'application/vnd.openxmlformats-package.relationships+xml',part.part);
});

test('save publishes validated files without overwriting existing outputs or temporary residue',async()=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'pptx-edit-'));
  try {
    const {buffer,report}=await editPptx(original,plan([duplicate]));
    const output=path.join(dir,'result.pptx');
    await saveEditedPptx(output,buffer,report);
    assert.equal(sha256(await fs.readFile(output)),report.outputSha256);
    await assert.rejects(saveEditedPptx(output,Buffer.from('wrong'),report),/OUTPUT_EXISTS/);
    assert.equal(sha256(await fs.readFile(output)),report.outputSha256);
    assert.deepEqual((await fs.readdir(dir)).sort(),['result.pptx','result.pptx.report.json']);
  } finally {
    assert.ok(path.resolve(dir).startsWith(path.resolve(os.tmpdir())+path.sep));
    await fs.rm(dir,{recursive:true,force:true});
  }
});
