import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { editPptx } from '../src/pptx/edit/index.mjs';
import { readPptx } from '../src/pptx/read/index.mjs';
import { PptxPackage,sha256 } from '../src/pptx/package.mjs';
import { renderDeck } from '../src/renderer.mjs';
import { child,children,at } from '../src/pptx/xml.mjs';
import { fixture } from './fixtures/pptx-package.mjs';

const run=(bytes,operations)=>editPptx(bytes,{version:1,sourceSha256:sha256(bytes),operations});
const insert={op:'insert-paragraph',slide:{id:'300'},shape:{id:'5',parents:[]},paragraph:1,styleFromParagraph:0,expectedText:' first ',text:'added paragraph'};
const add={op:'add-slide-from-layout',layoutPart:'ppt/slideLayouts/layout.xml',as:'newPage',after:{id:'300'},placeholders:[{idx:7,paragraphs:['new title','second paragraph']}]};

test('paragraph insertion supports start/end, preserves source text/styles and applies sequential positions',async()=>{
  const bytes=await fixture();
  const {buffer,report}=await run(bytes,[{...insert,paragraph:0},{...insert,styleFromParagraph:1},{op:'delete-paragraph',slide:{id:'300'},shape:insert.shape,paragraph:0,expectedText:'added paragraph'}]);
  const paragraphs=(await readPptx(buffer)).slides[0].elements[0].text.paragraphs;
  assert.deepEqual(paragraphs.map(p=>p.text),['added paragraph',' first ']);
  assert.equal(paragraphs[0].runs[0].direct.bold,false);
  assert.equal(report.preservation.changedOriginalParts.length,1);
  assert.equal(report.operations[0].styleFromParagraph,0);
});

test('deleting the last paragraph, stale text and invalid positions are rejected atomically',async()=>{
  const bytes=await fixture(),hash=sha256(bytes);
  await assert.rejects(run(bytes,[{op:'delete-paragraph',slide:{id:'300'},shape:insert.shape,paragraph:0,expectedText:' first '}]),/LAST_PARAGRAPH_REQUIRED/);
  await assert.rejects(run(bytes,[{...insert,paragraph:5}]),/insertion position/);
  await assert.rejects(run(bytes,[{...insert,styleFromParagraph:5}]),/source paragraph/);
  await assert.rejects(run(bytes,[insert,{op:'delete-paragraph',slide:{id:'300'},shape:insert.shape,paragraph:0,expectedText:'wrong'}]),/STALE_TEXT/);
  assert.equal(sha256(bytes),hash);
});

test('paragraph insertion rejects links and mixed style unless a style source is explicitly chosen',async()=>{
  const bytes=await fixture({mutate:f=>{const k='ppt/slides/slide9.xml';f[k]=f[k].replace('<a:t> first </a:t></a:r>','<a:t> first </a:t></a:r><a:r><a:rPr b="1"/><a:t>bold</a:t></a:r>');}});
  await assert.rejects(run(bytes,[{...insert,expectedText:' first bold'}]),/AMBIGUOUS_PARAGRAPH_STYLE/);
  const {buffer}=await run(bytes,[{...insert,expectedText:' first bold',styleFromRun:1}]);
  const p=(await readPptx(buffer)).slides[0].elements[0].text.paragraphs;
  assert.equal(p[1].runs[0].direct.bold,true);assert.equal(p[0].runs.length,2);
  const linked=await fixture({mutate:f=>{const k='ppt/slides/slide9.xml';f[k]=f[k].replace('<a:rPr b="0"/>','<a:rPr b="0"><a:hlinkClick r:id="remote"/></a:rPr>');}});
  await assert.rejects(run(linked,[insert]),/hyperlink/);
  const animated=await fixture({mutate:f=>{const k='ppt/slides/slide9.xml';f[k]=f[k].replace('</p:sld>','<p:timing><p:tnLst><p:par><p:cTn id="1"><p:childTnLst><p:anim><p:cBhvr><p:cTn id="2"/><p:tgtEl><p:spTgt spid="5"><p:txEl><p:pRg st="0" end="0"/></p:txEl></p:spTgt></p:tgtEl></p:cBhvr></p:anim></p:childTnLst></p:cTn></p:par></p:tnLst></p:timing></p:sld>');}});
  await assert.rejects(run(animated,[insert]),/UNSUPPORTED_PARAGRAPH_ANIMATION/);
});

test('new layout page inherits bounds/style, has fresh content and preserves existing parts',async()=>{
  const bytes=await fixture(),{buffer,report}=await run(bytes,[add]);
  const r=await readPptx(buffer),page=r.slides[1],element=page.elements[0];
  assert.deepEqual(r.slides.map(s=>s.slideId),['300','302','301']);
  assert.equal(page.layoutPart,add.layoutPart);assert.equal(page.masterPart,r.slides[0].masterPart);
  assert.equal(page.notes,null);assert.equal(element.text.text,'new title\nsecond paragraph');
  assert.equal(element.text.paragraphs[0].runs[0].resolved.fontSizePt.value,28);
  assert.equal(element.text.paragraphs[0].runs[0].resolved.fontSizePt.source.scope,'layout');
  assert.deepEqual(element.geometry.pageBounds,{x:100,y:200,width:300,height:400,unit:'EMU'});
  assert.equal(element.transform,null);assert.deepEqual(element.text.paragraphs[0].runs[0].direct,{});
  assert.equal(r.summary.masters,1);assert.equal(r.summary.layouts,1);
  assert.ok(report.preservation.changedOriginalParts.every(p=>['ppt/presentation.xml','ppt/_rels/presentation.xml.rels','[Content_Types].xml'].includes(p.part)));
  const pkg=await PptxPackage.open(buffer);assert.equal((await pkg.relationships(page.part)).length,1);
});

test('layout fills emit a native paragraph level without overriding inherited run formatting',async()=>{
  const bytes=await fixture();
  const op={...add,placeholders:[{idx:7,paragraphs:['要点',{text:'補足',level:1}]}]};
  const {buffer}=await run(bytes,[op]);
  const paragraphs=(await readPptx(buffer)).slides[1].elements[0].text.paragraphs;
  assert.deepEqual(paragraphs.map(p=>p.level),[0,1]);
  assert.deepEqual(paragraphs.map(p=>p.runs[0].direct),[{},{}]);
  for(const item of [{text:'範囲外',level:9},{text:'改行\nあり',level:1}]){
    await assert.rejects(run(bytes,[{...op,placeholders:[{idx:7,paragraphs:[item]}]}]),/INVALID_EDIT_PLAN|UNSUPPORTED_TEXT_CONTROL/);
  }
});

test('new pages support aliases for insertion and later paragraph editing',async()=>{
  const bytes=await fixture();
  const {buffer}=await run(bytes,[add,{...add,as:'another',after:{alias:'newPage'}},{...insert,slide:{alias:'newPage'},shape:{id:'2',parents:[]},paragraph:2,expectedText:'new title'},{op:'delete-paragraph',slide:{alias:'newPage'},shape:{id:'2',parents:[]},paragraph:1,expectedText:'second paragraph'}]);
  const r=await readPptx(buffer);
  assert.deepEqual(r.slides.map(s=>s.slideId),['300','302','303','301']);
  assert.equal(r.slides[1].titleText,'new title\nadded paragraph');
  assert.notEqual(r.slides[1].part,r.slides[2].part);
});

test('unknown layouts, unsupported placeholders, duplicate fills and invalid text are rejected',async()=>{
  const bytes=await fixture();
  await assert.rejects(run(bytes,[{...add,layoutPart:'../outside.xml'}]),/registered layout/);
  await assert.rejects(run(bytes,[{...add,placeholders:[{idx:99,paragraphs:['text']}]}]),/editable layout placeholder/);
  await assert.rejects(run(bytes,[{...add,placeholders:[...add.placeholders,...add.placeholders]}]),/DUPLICATE_PLACEHOLDER_FILL/);
  await assert.rejects(run(bytes,[{...add,placeholders:[{idx:7,paragraphs:['a\nb']}]}]),/UNSUPPORTED_TEXT_CONTROL/);
  const picture=await fixture({mutate:f=>{const k='ppt/slideLayouts/layout.xml';f[k]=f[k].replace('type="title"','type="pic"');}});
  await assert.rejects(run(picture,[add]),/UNSUPPORTED_LAYOUT_PLACEHOLDER/);
});

test('auxiliary placeholders are reported rather than copied as static sample text',async()=>{
  const bytes=await fixture({mutate:f=>{const k='ppt/slideLayouts/layout.xml';const sp=f[k].match(/<p:sp>.*?<\/p:sp>/)[0].replace('id="2"','id="8"').replace('type="title" idx="7"','type="sldNum" idx="12"');f[k]=f[k].replace('</p:spTree>',sp+'</p:spTree>');}});
  const {buffer,report}=await run(bytes,[add]);
  assert.equal((await readPptx(buffer)).slides[1].elements.length,1);
  assert.deepEqual(report.operations[0].auxiliaryPlaceholdersNotMaterialized,[{idx:12,type:'sldNum'}]);
});

test('layout page insertion updates known section lists and preserves their boundaries',async()=>{
  const bytes=await fixture({mutate:f=>{const k='ppt/presentation.xml';f[k]=f[k].replace('</p:presentation>','<p:extLst><p:ext uri="sections"><p14:sectionLst xmlns:p14="http://schemas.microsoft.com/office/powerpoint/2010/main"><p14:section name="one" id="1"><p14:sldIdLst><p14:sldId id="300"/><p14:sldId id="301"/></p14:sldIdLst></p14:section></p14:sectionLst></p:ext></p:extLst></p:presentation>');}});
  const {buffer}=await run(bytes,[add]);
  const pkg=await PptxPackage.open(buffer),root=await pkg.xml('ppt/presentation.xml');
  assert.deepEqual(Array.from(root.getElementsByTagNameNS('http://schemas.microsoft.com/office/powerpoint/2010/main','sldId')).map(n=>n.getAttribute('id')),['300','302','301']);
});

test('Strict layout pages preserve strict namespaces and source font inheritance',async()=>{
  const bytes=await fixture({strict:true}),{buffer}=await run(bytes,[add]);
  const r=await readPptx(buffer);assert.equal(r.slides[1].titleText,'new title\nsecond paragraph');
  assert.equal(r.slides[1].elements[0].text.paragraphs[0].runs[0].resolved.fontSizePt.value,28);
});

test('real generator layouts allow fresh title/body content without direct font or geometry overrides',async()=>{
  const deck=JSON.parse(await fs.readFile(new URL('../examples/demo.deck.json',import.meta.url),'utf8'));
  const {buffer:bytes}=await renderDeck(deck),source=await readPptx(bytes),layout=source.layouts.find(l=>l.part===source.slides[1].layoutPart);
  const placeholders=layout.elements.filter(e=>e.placeholder&&['title','body'].includes(e.placeholder.type)).map(e=>({idx:e.placeholder.idx,paragraphs:e.placeholder.type==='title'?['新しいページ']:['本文の一行目','本文の二行目']}));
  const {buffer}=await run(bytes,[{...add,layoutPart:layout.part,after:{id:source.slides[1].slideId},placeholders}]);
  const r=await readPptx(buffer),page=r.slides[2];
  assert.equal(page.titleText,'新しいページ');
  assert.ok(page.elements.every(e=>e.transform===null));
  const pkg=await PptxPackage.open(buffer),root=await pkg.xml(page.part);
  for(const shape of children(at(root,['p','cSld'],['p','spTree']),'p','sp'))assert.equal(children(child(shape,'p','spPr')).length,0);
});
