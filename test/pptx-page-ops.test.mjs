import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture} from './fixtures/pptx-package.mjs';
import {editPptx} from '../src/pptx/edit/index.mjs';
import {readPptx} from '../src/pptx/read/index.mjs';
import {PptxPackage,sha256} from '../src/pptx/package.mjs';
const run=(input,operations)=>editPptx(input,{version:1,sourceSha256:sha256(input),operations});
const order={op:'reorder-slides',slides:[{id:'301'},{id:'300'}]};
const remove={op:'delete-slide',slide:{id:'300'}};
const duplicate={op:'duplicate-slide',slide:{id:'300'},after:{id:'301'},as:'copy'};
const text={op:'add-text-shape',slide:{id:'300'},xEmu:914400,yEmu:914400,widthEmu:5000000,heightEmu:1500000,paragraphs:['追加する本文','二つ目の段落'],fontFace:'Yu Gothic',fontSizePt:28,color:'203A63'};

test('reorder follows requested ID order and preserves all slide/notes/layout bytes',async()=>{
  const input=await fixture(),{buffer,report}=await run(input,[order]),r=await readPptx(buffer);
  assert.deepEqual(r.slides.map(s=>s.slideId),['301','300']);assert.equal(r.summary.hiddenSlides,1);
  assert.deepEqual(report.preservation.changedOriginalParts.map(p=>p.part),['ppt/presentation.xml']);
  const before=await PptxPackage.open(input),after=await PptxPackage.open(buffer);
  for(const part of await before.inventory())if(part.part!=='ppt/presentation.xml')assert.deepEqual(await before.raw(part.part),await after.raw(part.part),part.part);
});

test('reorder refuses incomplete, duplicate and unknown references without input mutation',async()=>{
  const input=await fixture(),hash=sha256(input);
  for(const slides of [[{id:'300'}],[{id:'300'},{id:'300'}],[{id:'300'},{id:'999'}]])await assert.rejects(run(input,[{...order,slides}]),/REORDER|TARGET_NOT_FOUND/);
  assert.equal(sha256(input),hash);
});

test('deletion removes slide, relationship part and exclusive notes while keeping resources',async()=>{
  const input=await fixture(),{buffer,report}=await run(input,[remove]),r=await readPptx(buffer);
  assert.deepEqual(r.slides.map(s=>s.slideId),['301']);assert.equal(r.summary.notesSlides,0);
  const removed=new Set(report.preservation.removedParts.map(p=>p.part));
  for(const part of ['ppt/slides/slide9.xml','ppt/slides/_rels/slide9.xml.rels','ppt/notesSlides/notes.xml'])assert.ok(removed.has(part));
  for(const part of r.parts)assert.ok(!removed.has(part.part));
  assert.ok(r.parts.some(p=>p.part==='ppt/slides/slide7.xml')); // Existing unlisted data is not a garbage-collection target.
});

test('slide links, shared notes and custom show references block deletion',async()=>{
  for(const kind of ['link','notes','show']){
    const input=await fixture({mutate:f=>{
      if(kind==='show')f['ppt/presentation.xml']=f['ppt/presentation.xml'].replace('</p:presentation>','<p:custShowLst><p:custShow name="custom" id="0"><p:sldLst><p:sld r:id="nine"/></p:sldLst></p:custShow></p:custShowLst></p:presentation>');
      else{
        const relationship=kind==='link'?['slide','../slides/slide9.xml']:['notesSlide','../notesSlides/notes.xml'];
        const key='ppt/slides/_rels/slide3.xml.rels';f[key]=f[key].replace('</Relationships>',`<Relationship Id="shared" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/${relationship[0]}" Target="${relationship[1]}"/></Relationships>`);
      }
    }});
    await assert.rejects(run(input,[remove]),/SLIDE_STILL_REFERENCED|SLIDE_REFERENCED_IN_PRESENTATION/);
  }
});

test('deleting all slides or addressing a deleted slide fails atomically',async()=>{
  const input=await fixture(),hash=sha256(input);
  await assert.rejects(run(input,[remove,{op:'delete-slide',slide:{id:'301'}}]),/LAST_SLIDE_REQUIRED/);
  await assert.rejects(run(input,[remove,remove]),/TARGET_NOT_FOUND/);
  assert.equal(sha256(input),hash);
});

test('deleted clone IDs and package names are never reused in the same plan',async()=>{
  const input=await fixture(),{buffer,report}=await run(input,[duplicate,{op:'delete-slide',slide:{alias:'copy'}},{...duplicate,as:'next'}]);
  const r=await readPptx(buffer);assert.deepEqual(r.slides.map(s=>s.slideId),['300','301','303']);
  assert.notEqual(report.operations[0].part,report.operations[2].part);
  assert.equal(r.summary.notesSlides,2);
  await assert.rejects(run(input,[duplicate,{op:'delete-slide',slide:{alias:'copy'}},{...order,slides:[{id:'300'},{id:'301'},{alias:'copy'}]}]),/TARGET_NOT_FOUND/);
});

function sectionFixture(twoSections=false){return fixture({mutate:f=>{
  const first='<p14:sldId id="300"/>',second='<p14:sldId id="301"/>';
  const sections=twoSections?`<p14:section name="one" id="1"><p14:sldIdLst>${first}</p14:sldIdLst></p14:section><p14:section name="two" id="2"><p14:sldIdLst>${second}</p14:sldIdLst></p14:section>`:`<p14:section name="one" id="1"><p14:sldIdLst>${first}${second}</p14:sldIdLst></p14:section>`;
  f['ppt/presentation.xml']=f['ppt/presentation.xml'].replace('</p:presentation>',`<p:extLst><p:ext uri="sections"><p14:sectionLst xmlns:p14="http://schemas.microsoft.com/office/powerpoint/2010/main">${sections}</p14:sectionLst></p:ext></p:extLst></p:presentation>`);
}});}

test('known sections track reorder/deletion; crossing existing boundaries is rejected',async()=>{
  const input=await sectionFixture(),{buffer}=await run(input,[order,remove]);
  const pkg=await PptxPackage.open(buffer),root=await pkg.xml('ppt/presentation.xml');
  assert.deepEqual(Array.from(root.getElementsByTagNameNS('http://schemas.microsoft.com/office/powerpoint/2010/main','sldId')).map(n=>n.getAttribute('id')),['301']);
  await assert.rejects(run(await sectionFixture(true),[order]),/UNSUPPORTED_SECTION_REORDER/);
});

test('add text creates editable local-style XML, multiple paragraphs and a fresh shape ID',async()=>{
  const input=await fixture(),{buffer,report}=await run(input,[text]),r=await readPptx(buffer),added=r.slides[0].elements.at(-1);
  assert.equal(added.id,report.operations[0].shapeId);assert.equal(added.id,'9');
  assert.equal(added.text.text,text.paragraphs.join('\n'));assert.equal(added.placeholder,null);
  assert.equal(added.text.paragraphs[0].runs[0].direct.fontSizePt,28);
  assert.equal(added.text.paragraphs[0].runs[0].direct.eastAsianFont,'Yu Gothic');
  assert.deepEqual(added.geometry.pageBounds,{x:914400,y:914400,width:5000000,height:1500000,unit:'EMU'});
  assert.deepEqual(report.preservation.changedOriginalParts.map(p=>p.part),['ppt/slides/slide9.xml']);
});

test('new text refuses overflowing boxes, invalid characters and invalid style fields',async()=>{
  const input=await fixture();
  await assert.rejects(run(input,[{...text,xEmu:9000000}]),/SHAPE_OUTSIDE_SLIDE/);
  await assert.rejects(run(input,[{...text,paragraphs:['line\nbreak']}]),/UNSUPPORTED_TEXT_CONTROL/);
  await assert.rejects(run(input,[{...text,color:'invalid'}]),/INVALID_EDIT_PLAN/);
});

test('Strict namespaces support text insertion, reorder and deletion together',async()=>{
  const input=await fixture({strict:true}),{buffer}=await run(input,[{...text,slide:{id:'301'}},order,remove]);
  const r=await readPptx(buffer);assert.deepEqual(r.slides.map(s=>s.slideId),['301']);
  assert.equal(r.slides[0].elements.at(-1).text.text,text.paragraphs.join('\n'));
});
