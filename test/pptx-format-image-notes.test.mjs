import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {fixture} from './fixtures/pptx-package.mjs';
import {editPptx} from '../src/pptx/edit/index.mjs';
import {readPptx} from '../src/pptx/read/index.mjs';
import {PptxPackage,sha256} from '../src/pptx/package.mjs';
const run=(bytes,operations)=>editPptx(bytes,{version:1,sourceSha256:sha256(bytes),operations});
const style={op:'set-text-style',slide:{id:'300'},shape:{id:'5',parents:[]},fontFace:'Yu Gothic',fontSizePt:24,removeBullets:true,alignment:'left'};
const box={xEmu:1000,yEmu:2000,widthEmu:3000,heightEmu:4000};

test('local style change preserves text, declared bold and unrelated package parts',async()=>{
 const input=await fixture(),{buffer,report}=await run(input,[style]);const r=await readPptx(buffer),shape=r.slides[0].elements[0];
 assert.equal(shape.text.text,' first ');assert.equal(shape.text.paragraphs[0].runs[0].resolved.fontSizePt.value,24);assert.equal(shape.text.paragraphs[0].runs[0].resolved.bold.value,false);assert.equal(shape.text.paragraphs[0].bullet.kind,'buNone');
 assert.deepEqual(report.preservation.changedOriginalParts.map(p=>p.part),['ppt/slides/slide9.xml']);
});
test('position change uses slide EMU and rejects groups and overflow',async()=>{
 const input=await fixture();const op={op:'set-shape-position',slide:{id:'300'},shape:{id:'5',parents:[]},...box};const {buffer}=await run(input,[op]);assert.equal((await readPptx(buffer)).slides[0].elements[0].geometry.pageBounds.x,1000);
 await assert.rejects(run(input,[{...op,widthEmu:20000000}]),/OUTSIDE/);await assert.rejects(run(input,[{...op,shape:{id:'7',parents:['6']}}]),/grouped/);
});
test('delete shape preserves resources and refuses incoming shape targets',async()=>{
 const input=await fixture();const op={op:'delete-shape',slide:{id:'300'},shape:{id:'6',parents:[]}};const {buffer}=await run(input,[op]);assert.ok(!(await readPptx(buffer)).slides[0].elements.some(e=>e.id==='6'));
 const referenced=await fixture({mutate:f=>{f['ppt/slides/slide9.xml']=f['ppt/slides/slide9.xml'].replace('</p:sld>','<p:timing><p:spTgt spid="7"/></p:timing></p:sld>');}});await assert.rejects(run(referenced,[op]),/SHAPE_STILL_REFERENCED/);
});
test('existing exclusive notes support stale checking and preserve slide-number text',async()=>{
 const input=await fixture(),op={op:'set-speaker-notes',slide:{id:'300'},expectedText:'speaker note',paragraphs:['Source PDF p.3','日本語の説明']};const {buffer,report}=await run(input,[op]);const r=await readPptx(buffer);assert.equal(r.slides[0].notes.speakerText,'Source PDF p.3\n日本語の説明');assert.equal(r.slides[0].notes.elements[1].text.text,'99');assert.deepEqual(report.preservation.changedOriginalParts.map(p=>p.part),['ppt/notesSlides/notes.xml']);await assert.rejects(run(input,[{...op,expectedText:'stale'}]),/STALE_NOTES/);
});
test('notes editing refuses shared notes and missing notes',async()=>{
 const op={op:'set-speaker-notes',slide:{id:'300'},expectedText:'speaker note',paragraphs:['x']};const input=await fixture({mutate:f=>{f['ppt/slides/_rels/slide3.xml.rels']=f['ppt/slides/_rels/slide3.xml.rels'].replace('</Relationships>','<Relationship Id="notes" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/notesSlide" Target="../notesSlides/notes.xml"/></Relationships>');}});await assert.rejects(run(input,[op]),/SHARED_NOTES/);await assert.rejects(run(await fixture(),[{...op,slide:{id:'301'}}]),/existing notes/);
});
test('image replacement creates a private asset, clears crop, fits bounds and preserves shared source',async()=>{
 const demo=JSON.parse(await fs.readFile(new URL('../examples/demo.deck.json',import.meta.url),'utf8'));const data=demo.slides.flatMap(s=>s.elements).find(e=>e.type==='image').data;const bytes=Buffer.from(data.split(',')[1],'base64');
 const input=await fixture({mutate:f=>{f['ppt/media/old.png']=bytes;f['[Content_Types].xml']=f['[Content_Types].xml'].replace('</Types>','<Default Extension="png" ContentType="image/png"/></Types>');f['ppt/slides/slide9.xml']=f['ppt/slides/slide9.xml'].replace('r:link="remote"','r:embed="remote"').replace('<a:blip r:embed="remote"/>','<a:blip r:embed="remote"><a:alphaModFix/></a:blip>');f['ppt/slides/_rels/slide9.xml.rels']=f['ppt/slides/_rels/slide9.xml.rels'].replace('https://example.invalid/not-fetched.png','../media/old.png').replace(' TargetMode="External"','');}});
 const op={op:'replace-image',slide:{id:'300'},shape:{id:'8',parents:[]},data,box:{xEmu:0,yEmu:0,widthEmu:100000,heightEmu:100000}};const {buffer}=await run(input,[op]);const pkg=await PptxPackage.open(buffer);assert.deepEqual(await pkg.raw('ppt/media/old.png'),bytes);const pic=(await readPptx(buffer)).slides[0].elements.find(e=>e.id==='8');assert.notEqual(pic.image.source.part,'ppt/media/old.png');assert.deepEqual(await pkg.raw(pic.image.source.part),bytes);assert.deepEqual(pic.image.crop,{});assert.equal(pic.geometry.pageBounds.width/pic.geometry.pageBounds.height,2);
 await assert.rejects(run(input,[{...op,data:'data:image/svg+xml;base64,AAAA'}]),/image data/);
 const effects=await PptxPackage.open(input);effects.zip.file('ppt/slides/slide9.xml',(await effects.raw('ppt/slides/slide9.xml')).toString('utf8').replace('<a:alphaModFix/>','<a:alphaModFix amt="50000"/>'));await assert.rejects(run(await effects.zip.generateAsync({type:'nodebuffer'}),[op]),/UNSUPPORTED_IMAGE/);
});
test('adding a source figure preserves text and layout while embedding the exact bytes',async()=>{
 const demo=JSON.parse(await fs.readFile(new URL('../examples/demo.deck.json',import.meta.url),'utf8'));
 const data=demo.slides.flatMap(s=>s.elements).find(e=>e.type==='image').data;
 const input=await fixture();
 const op={op:'add-image',slide:{id:'300'},data,alt:'Figure 1, page 3',box};
 const {buffer,report}=await run(input,[op]);
 const before=(await readPptx(input)).slides[0],after=(await readPptx(buffer)).slides[0];
 assert.equal(after.layoutPart,before.layoutPart);
 assert.deepEqual(after.elements.slice(0,-1),before.elements);
 const pic=after.elements.at(-1),pkg=await PptxPackage.open(buffer);
 assert.equal(pic.description,op.alt);
 assert.deepEqual(await pkg.raw(pic.image.source.part),Buffer.from(data.split(',')[1],'base64'));
 assert.equal(pic.geometry.pageBounds.width/pic.geometry.pageBounds.height,2);
 assert.ok(report.preservation.changedOriginalParts.every(p=>!p.part.startsWith('ppt/slideLayouts/')));
 await assert.rejects(run(input,[{...op,box:{...box,widthEmu:20000000}}]),/SHAPE_OUTSIDE_SLIDE/);
});
test('new operations reject invalid XML font text and survive Strict namespace packages',async()=>{
 const input=await fixture({strict:true});await assert.rejects(run(input,[{...style,fontFace:'bad\u0001'}]),/INVALID_XML_TEXT/);const {buffer}=await run(input,[style,{op:'set-speaker-notes',slide:{id:'300'},expectedText:'speaker note',paragraphs:['出典']}]);const r=await readPptx(buffer);assert.notEqual(r.status,'partial');assert.equal(r.slides[0].notes.speakerText,'出典');
});
