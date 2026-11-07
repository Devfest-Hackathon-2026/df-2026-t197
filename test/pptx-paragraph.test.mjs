import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { XMLSerializer } from '@xmldom/xmldom';
import { editPptx } from '../src/pptx/edit/index.mjs';
import { readPptx } from '../src/pptx/read/index.mjs';
import { PptxPackage,sha256 } from '../src/pptx/package.mjs';
import { child,children,at } from '../src/pptx/xml.mjs';
import { renderDeck } from '../src/renderer.mjs';
import { fixture } from './fixtures/pptx-package.mjs';

const operation={op:'replace-paragraph-text',slide:{id:'300'},shape:{id:'5',parents:[]},paragraph:0,expectedText:' first ',text:' 段落の差し替え & <test> '};
const execute=(bytes,operations)=>editPptx(bytes,{version:1,sourceSha256:sha256(bytes),operations});
const bodyOf=root=>at(children(at(root,['p','cSld'],['p','spTree']),'p','sp')[0],['p','txBody']);
const serialize=node=>new XMLSerializer().serializeToString(node);
const mutateFirst=async transform=>fixture({mutate:f=>{const key='ppt/slides/slide9.xml';f[key]=transform(f[key]);}});

test('uniform paragraph replacement preserves paragraph properties, other paragraphs and parts',async()=>{
  const bytes=await mutateFirst(xml=>xml.replace('<a:p>','<a:p><a:pPr lvl="1" algn="ctr"><a:buChar char="•"/></a:pPr>').replace('<a:t> first </a:t></a:r>','<a:t> first </a:t></a:r><a:r><a:rPr b="0"/><a:t>next</a:t></a:r>').replace('</p:txBody>','<a:p><a:r><a:rPr sz="1700"/><a:t>untouched</a:t></a:r></a:p></p:txBody>'));
  const {buffer,report}=await execute(bytes,[{...operation,expectedText:' first next'}]);
  const r=await readPptx(buffer),paragraphs=r.slides[0].elements[0].text.paragraphs;
  assert.equal(paragraphs[0].text,operation.text);assert.equal(paragraphs[0].runs.length,1);
  assert.equal(paragraphs[0].level,1);assert.equal(paragraphs[0].properties.algn,'ctr');assert.equal(paragraphs[0].bullet.attributes.char,'•');
  assert.equal(paragraphs[0].runs[0].direct.bold,false);assert.equal(paragraphs[1].text,'untouched');assert.equal(paragraphs[1].runs[0].direct.fontSizePt,17);
  assert.deepEqual(report.preservation.changedOriginalParts.map(p=>p.part),['ppt/slides/slide9.xml']);
  assert.equal(report.operations[0].collapsedRuns,2);assert.equal(report.operations[0].styleResolution,'uniform-declared-style');
});

test('mixed formatting requires an explicit source, reports the choice and does not alter end defaults',async()=>{
  const bytes=await mutateFirst(xml=>xml.replace('<a:t> first </a:t></a:r>','<a:t> first </a:t></a:r><a:r><a:rPr b="1" sz="2300"/><a:t>bold</a:t></a:r><a:endParaRPr sz="1100"/>'));
  const op={...operation,expectedText:' first bold'};
  await assert.rejects(execute(bytes,[op]),/AMBIGUOUS_PARAGRAPH_STYLE/);
  const {buffer,report}=await execute(bytes,[{...op,styleFromRun:1}]);
  const p=(await readPptx(buffer)).slides[0].elements[0].text.paragraphs[0];
  assert.equal(p.runs[0].direct.fontSizePt,23);assert.equal(p.runs[0].direct.bold,true);assert.equal(p.endRunStyle.fontSizePt,11);
  assert.equal(report.operations[0].styleResolution,'explicit-run');assert.equal(report.operations[0].styleFromRun,1);
  await assert.rejects(execute(bytes,[{...op,styleFromRun:9}]),/style source run/);
  const custom=await mutateFirst(xml=>xml.replace('<a:rPr b="0"/>','<a:rPr b="0"><a:extLst><a:ext uri="test"><x:data xmlns:x="urn:custom">first</x:data></a:ext></a:extLst></a:rPr>').replace('<a:t> first </a:t></a:r>','<a:t> first </a:t></a:r><a:r><a:rPr b="0"><a:extLst><a:ext uri="test"><x:data xmlns:x="urn:custom">different</x:data></a:ext></a:extLst></a:rPr><a:t>next</a:t></a:r>'));
  await assert.rejects(execute(custom,[{...operation,expectedText:' first next'}]),/AMBIGUOUS_PARAGRAPH_STYLE/);
});

test('hyperlinks, breaks, fields and unknown math content cannot be flattened even with explicit style',async()=>{
  const cases=[
    xml=>xml.replace('<a:rPr b="0"/>','<a:rPr b="0"><a:hlinkClick r:id="remote"/></a:rPr>'),
    xml=>xml.replace('<a:t> first </a:t></a:r>','<a:t> first </a:t></a:r><a:br/>'),
    xml=>xml.replace('<a:t> first </a:t></a:r>','<a:t> first </a:t></a:r><a:fld id="id" type="slidenum"><a:t>1</a:t></a:fld>'),
    xml=>xml.replace('<a:t> first </a:t></a:r>','<a:t> first </a:t></a:r><m:math xmlns:m="urn:unknown-math"/>')
  ];
  for(const transform of cases){const bytes=await mutateFirst(transform);await assert.rejects(execute(bytes,[{...operation,styleFromRun:0}]),/UNSUPPORTED_PARAGRAPH_CONTENT/);}
});

test('empty paragraphs retain end character defaults and accept empty replacement text',async()=>{
  const bytes=await mutateFirst(xml=>xml.replace('<a:r><a:rPr b="0"/><a:t> first </a:t></a:r>','<a:endParaRPr sz="2900" b="1"/>'));
  const {buffer}=await execute(bytes,[{...operation,expectedText:'',text:'empty paragraph filled'}]);
  const p=(await readPptx(buffer)).slides[0].elements[0].text.paragraphs[0];
  assert.equal(p.runs[0].direct.fontSizePt,29);assert.equal(p.runs[0].direct.bold,true);assert.equal(p.endRunStyle.fontSizePt,29);
  const original=await fixture();const {buffer:empty}=await execute(original,[{...operation,text:''}]);
  assert.equal((await readPptx(empty)).slides[0].elements[0].text.text,'');
});

test('stale content, invalid controls and late operation failure never change the input',async()=>{
  const bytes=await fixture(),hash=sha256(bytes);
  for(const text of ['two\nlines','tab\there','\ud800']) await assert.rejects(execute(bytes,[{...operation,text}]),/UNSUPPORTED_TEXT_CONTROL/);
  await assert.rejects(execute(bytes,[operation,{...operation,expectedText:'old text'}]),/STALE_TEXT/);
  assert.equal(sha256(bytes),hash);
});

const deck=JSON.parse(await fs.readFile(new URL('../examples/demo.deck.json',import.meta.url),'utf8'));
const {buffer:tableInput}=await renderDeck(deck),tableIndex=await readPptx(tableInput);
const slide=tableIndex.slides[3],table=slide.elements.find(e=>e.kind==='table');
const cellOp={op:'replace-table-cell-paragraph',slide:{id:slide.slideId},shape:{id:table.id,parents:[]},row:1,column:1,paragraph:0,expectedText:table.table.rows[1].cells[1].text.paragraphs[0].text,text:'編集済みセル'};

test('native table cell edits preserve grid, row sizes, styles, neighbouring cells and all unrelated parts',async()=>{
  const {buffer,report}=await execute(tableInput,[cellOp]);
  const r=await readPptx(buffer),after=r.slides[3].elements.find(e=>e.kind==='table');
  assert.equal(after.table.rows[1].cells[1].text.text,cellOp.text);
  for(let row=0;row<table.table.rows.length;row++)for(let column=0;column<table.table.rows[row].cells.length;column++)if(row!==1||column!==1)assert.deepEqual(after.table.rows[row].cells[column],table.table.rows[row].cells[column]);
  const a=await PptxPackage.open(tableInput),b=await PptxPackage.open(buffer);
  const originalRoot=await a.xml(slide.part),editedRoot=await b.xml(slide.part);
  const tableXml=root=>at(children(at(root,['p','cSld'],['p','spTree']),'p','graphicFrame')[0],['a','graphic'],['a','graphicData'],['a','tbl']);
  for(const name of ['tblGrid','tblPr'])assert.equal(serialize(child(tableXml(originalRoot),'a',name)),serialize(child(tableXml(editedRoot),'a',name)));
  const oldRows=children(tableXml(originalRoot),'a','tr'),newRows=children(tableXml(editedRoot),'a','tr');
  assert.deepEqual(newRows.map(r=>r.getAttribute('h')),oldRows.map(r=>r.getAttribute('h')));
  assert.equal(serialize(child(children(newRows[1],'a','tc')[1],'a','tcPr')),serialize(child(children(oldRows[1],'a','tc')[1],'a','tcPr')));
  assert.deepEqual(report.preservation.changedOriginalParts.map(p=>p.part),[slide.part]);
});

test('merged/ragged tables and out-of-range cells are rejected rather than guessed',async()=>{
  for(const attribute of ['gridSpan="2"','rowSpan="2"','hMerge="1"','vMerge="true"']) {
    const pkg=await PptxPackage.open(tableInput);const raw=(await pkg.raw(slide.part)).toString('utf8').replace('<a:tc>',`<a:tc ${attribute}>`);
    pkg.zip.file(slide.part,raw);const input=await pkg.zip.generateAsync({type:'nodebuffer'});
    await assert.rejects(execute(input,[cellOp]),/UNSUPPORTED_MERGED_TABLE/);
  }
  const pkg=await PptxPackage.open(tableInput),root=await pkg.xml(slide.part);
  const tbl=at(children(at(root,['p','cSld'],['p','spTree']),'p','graphicFrame')[0],['a','graphic'],['a','graphicData'],['a','tbl']);
  const row=children(tbl,'a','tr')[0];row.removeChild(children(row,'a','tc')[0]);
  pkg.zip.file(slide.part,serialize(root));const ragged=await pkg.zip.generateAsync({type:'nodebuffer'});
  await assert.rejects(execute(ragged,[cellOp]),/UNSUPPORTED_TABLE_GRID/);
  await assert.rejects(execute(tableInput,[{...cellOp,row:99}]),/TARGET_NOT_FOUND: table cell/);
  await assert.rejects(execute(tableInput,[{...cellOp,column:99}]),/TARGET_NOT_FOUND: table cell/);
});

test('paragraph and table editing work on cloned pages while originals stay unchanged',async()=>{
  const {buffer}=await execute(tableInput,[{op:'duplicate-slide',slide:{id:slide.slideId},as:'tableCopy',after:{id:slide.slideId}},{...cellOp,slide:{alias:'tableCopy'}},{op:'replace-paragraph-text',slide:{alias:'tableCopy'},shape:{id:slide.elements.find(e=>e.placeholder?.type==='title').id,parents:[]},paragraph:0,expectedText:slide.titleText,text:'表セルの編集試験'}]);
  const r=await readPptx(buffer);
  assert.equal(r.slides[3].elements.find(e=>e.kind==='table').table.rows[1].cells[1].text.text,cellOp.expectedText);
  assert.equal(r.slides[4].elements.find(e=>e.kind==='table').table.rows[1].cells[1].text.text,cellOp.text);
  assert.equal(r.slides[4].titleText,'表セルの編集試験');
});

test('Strict namespaces support paragraph edits without losing inheritance',async()=>{
  const bytes=await fixture({strict:true}),{buffer}=await execute(bytes,[operation]);
  const r=await readPptx(buffer),run=r.slides[0].elements[0].text.paragraphs[0].runs[0];
  assert.equal(r.slides[0].titleText,operation.text);assert.equal(run.resolved.fontSizePt.value,28);assert.equal(run.resolved.fontSizePt.source.scope,'layout');
});
