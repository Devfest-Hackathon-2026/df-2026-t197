import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {renderDeck} from '../src/renderer.mjs';
import {readPptx} from '../src/pptx/read/index.mjs';
import {editPptx} from '../src/pptx/edit/index.mjs';
import {checkTemplate} from '../src/pptx/check-template.mjs';
import {PptxPackage,sha256} from '../src/pptx/package.mjs';

const deck=JSON.parse(await fs.readFile(new URL('../examples/demo.deck.json',import.meta.url),'utf8'));
deck.slides=deck.slides.slice(0,3);
const {buffer:template}=await renderDeck(deck);
const source=await readPptx(template);
const [cover,body,figure]=source.slides;
const ref=slide=>({id:slide.slideId});
const sourceLayout=source.layouts.find(layout=>layout.part===body.layoutPart);
const title=sourceLayout.elements.find(shape=>shape.placeholder?.type==='title');
const text=sourceLayout.elements.find(shape=>shape.placeholder?.type==='body');
const exceptions=[{page:1,reason:'Cover'}];
const review={baseline:{layoutPart:sourceLayout.part,titleIdx:title.placeholder.idx,bodyIdx:text.placeholder.idx},exceptions};
const edit=async (input,operations)=>(await editPptx(input,{version:1,sourceSha256:sha256(input),operations})).buffer;
const removeSamplePages=[body,figure].map(slide=>({op:'delete-slide',slide:ref(slide)}));
const add={
  op:'add-slide-from-layout',layoutPart:sourceLayout.part,as:'newBody',after:ref(cover),
  placeholders:[
    {idx:title.placeholder.idx,paragraphs:['同じレイアウトのタイトル']},
    {idx:text.placeholder.idx,paragraphs:['本文',{text:'補足の段落',level:1}]}
  ]
};

test('template check catches different body layouts and accepts inherited frames after rebuilding',async()=>{
  const mixed=checkTemplate(source,source,review);
  assert.equal(mixed.status,'failed');
  assert.ok(mixed.issues.some(issue=>issue.code==='BODY_LAYOUT_MISMATCH'&&issue.page===3));
  const candidate=await edit(template,[add,{...add,as:'secondBody',after:{alias:'newBody'}},...removeSamplePages]);
  const result=checkTemplate(source,await readPptx(candidate),review);
  assert.equal(result.status,'passed',JSON.stringify(result.issues));
  assert.deepEqual(result.checkedBodyPages,[2,3]);
});

test('template check rejects a local font override and a change to the shared master',async()=>{
  const candidate=await edit(template,[add,...removeSamplePages]);
  const added=(await readPptx(candidate)).slides[1];
  const bodyId=added.elements.find(shape=>shape.placeholder?.idx===text.placeholder.idx).id;
  const restyled=await edit(candidate,[{
    op:'set-text-style',slide:ref(added),shape:{id:bodyId,parents:[]},fontFace:'Arial',fontSizePt:16
  }]);
  assert.ok(checkTemplate(source,await readPptx(restyled),review).issues.some(
    issue=>issue.code==='BODY_FRAME_LOCAL_OVERRIDE'&&issue.page===2&&issue.role==='body'
  ));

  const pkg=await PptxPackage.open(candidate);
  const master=body.masterPart;
  pkg.zip.file(master,(await pkg.raw(master)).toString('utf8')+'<!--changed-->');
  const modified=await pkg.zip.generateAsync({type:'nodebuffer'});
  assert.ok(checkTemplate(source,await readPptx(modified),review).issues.some(
    issue=>issue.code==='TEMPLATE_PART_CHANGED_OR_MISSING'&&issue.part===master
  ));
});

test('template check compares reused text frames to the cloned source page',async()=>{
  const sourceTitle=body.elements.find(shape=>shape.placeholder?.idx===title.placeholder.idx);
  const sourceBody=body.elements.find(shape=>shape.placeholder?.idx===text.placeholder.idx);
  const candidate=await edit(template,[
    {op:'duplicate-slide',slide:ref(body),after:ref(cover),as:'clonedBody'},
    {op:'replace-run-text',slide:{alias:'clonedBody'},shape:{id:sourceTitle.id,parents:[]},
      paragraph:0,run:0,expectedText:sourceTitle.text.paragraphs[0].runs[0].text,text:'複製した枠の新しいタイトル'},
    ...removeSamplePages
  ]);
  const result=checkTemplate(source,await readPptx(candidate),{
    baseline:{slideId:body.slideId,titleShapeId:sourceTitle.id,bodyShapeId:sourceBody.id},exceptions
  });
  assert.equal(result.status,'passed',JSON.stringify(result.issues));
});

test('template check requires a planned paper image on its intended page',async()=>{
  const image=deck.slides[2].elements.find(element=>element.type==='image');
  const sha=sha256(Buffer.from(image.data.split(',')[1],'base64'));
  const required={...review,assets:[{page:2,sha256:sha}]};
  assert.ok(checkTemplate(source,source,required).issues.some(
    issue=>issue.code==='EXPECTED_ASSET_MISSING'&&issue.page===2
  ));

  const candidate=await edit(template,[
    add,{op:'add-image',slide:{alias:'newBody'},data:image.data,alt:'Paper figure',
      box:{xEmu:1000000,yEmu:3000000,widthEmu:2000000,heightEmu:1000000}},
    ...removeSamplePages
  ]);
  const result=checkTemplate(source,await readPptx(candidate),required);
  assert.equal(result.status,'passed',JSON.stringify(result.issues));
});
