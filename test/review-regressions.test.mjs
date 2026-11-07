import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import JSZip from 'jszip';
import { fixture } from './fixtures/pptx-package.mjs';
import { validateDeck, lintDeck, bodyBoxFor } from '../src/schema.mjs';
import { renderDeck } from '../src/renderer.mjs';
import { inspectPptx } from '../src/inspect.mjs';
import { editPptx } from '../src/pptx/edit/index.mjs';
import { sha256 } from '../src/pptx/package.mjs';
import { saveEditedPptx } from '../src/pptx/edit/save.mjs';
import { parseXml } from '../src/pptx/xml.mjs';
const deck = () => ({version:1,title:'Test',slides:[{id:'s',title:'Test',layout:'body',elements:[]}]});

test('generation rejects invalid XML in content, metadata, font, table and chart labels', () => {
  const mutations = [d=>d.title='bad\u0001',d=>d.slides[0].notes='bad\ud800',d=>d.theme={fontFace:'bad\ufffe'},d=>d.slides[0].sources=['bad\u0000'],d=>d.slides[0].elements=[{id:'t',type:'table',x:1,y:1,w:4,h:2,rows:[['bad\u0001']]}],d=>d.slides[0].elements=[{id:'c',type:'chart',x:1,y:1,w:4,h:2,chartType:'bar',labels:['bad\u0001'],series:[{name:'s',values:[1]}]}]];
  for(const mutate of mutations){const d=deck();mutate(d);assert.throws(()=>validateDeck(d),/INVALID_XML_TEXT/);}
  const good=deck();good.slides[0].body='Japanese 日本語\nTab\tCR\rEmoji 😀';assert.doesNotThrow(()=>validateDeck(good));
});

test('XML reader rejects raw and entity-encoded forbidden characters', () => {
  for(const xml of ['<a>bad\u0001</a>','<a>&#1;</a>','<a font="&#x1;"/>']) assert.throws(()=>parseXml(xml,'test'),/INVALID_XML_TEXT|INVALID_XML/);
});

test('text shape rejects invalid XML in font names before editing', async () => {
  const input=await fixture();
  await assert.rejects(editPptx(input,{version:1,sourceSha256:sha256(input),operations:[{op:'add-text-shape',slide:{id:'300'},xEmu:1,yEmu:1,widthEmu:100,heightEmu:100,paragraphs:['valid'],fontFace:'bad\u0001font',fontSizePt:24,color:'000000'}]}),/INVALID_XML_TEXT/);
});

test('inspect follows slide list with copies, orphans and arbitrary namespace prefixes',async()=>{
  const input=await fixture();
  const {buffer}=await editPptx(input,{version:1,sourceSha256:sha256(input),operations:[{op:'duplicate-slide',slide:{id:'301'},after:{id:'301'},as:'copy'}]});
  const r=await inspectPptx(buffer);assert.equal(r.status,'passed');assert.equal(r.slides,3);assert.equal(r.hiddenSlides,2);assert.deepEqual(r.unlistedSlideParts,['ppt/slides/slide7.xml']);
  const d=deck();d.slides[0].elements=[{id:'t',type:'table',x:1,y:2,w:5,h:2,rows:[['a','b']]}];
  const zip=await JSZip.loadAsync((await renderDeck(d)).buffer);
  const xml=await zip.file('ppt/slides/slide1.xml').async('string');
  zip.file('ppt/slides/slide1.xml',xml.replaceAll('xmlns:a=', 'xmlns:z=').replaceAll('<a:', '<z:').replaceAll('</a:', '</z:'));
  assert.equal((await inspectPptx(await zip.generateAsync({type:'nodebuffer'}))).nativeTables,1);
});

test('inspect fails invalid XML even in an unused resource',async()=>{
  const zip=await JSZip.loadAsync(await fixture());zip.file('unused.xml','<a>bad\u0001</a>');
  assert.equal((await inspectPptx(await zip.generateAsync({type:'nodebuffer'}))).status,'failed');
});

test('cover density uses the same body box as rendering',()=>{
  const d=deck();d.slides[0].layout='cover';d.slides[0].body='x'.repeat(240);
  assert.equal(bodyBoxFor('cover').h,2.8);assert.ok(lintDeck(d).some(w=>w.code==='DENSITY_ESTIMATE'));
  d.slides[0].layout='body';assert.equal(lintDeck(d).length,0);
});

test('saving rolls back report when PPTX publication fails and leaves no final files on report write failure', async t=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'pptx-save-review-'));
  try {
    const output=path.join(dir,'result.pptx');
    const realWrite=fs.writeFile.bind(fs);
    const write=t.mock.method(fs,'writeFile',async(file,...args)=>{if(String(file).endsWith('.tmp.json'))throw new Error('INJECTED_REPORT_WRITE');return realWrite(file,...args);});
    await assert.rejects(saveEditedPptx(output,Buffer.from('pptx'),{}),/INJECTED_REPORT_WRITE/);write.mock.restore();assert.deepEqual(await fs.readdir(dir),[]);
    const realLink=fs.link.bind(fs);
    const link=t.mock.method(fs,'link',async(from,to)=>{if(to===output)throw new Error('INJECTED_PPTX_LINK');return realLink(from,to);});
    await assert.rejects(saveEditedPptx(output,Buffer.from('pptx'),{}),/INJECTED_PPTX_LINK/);link.mock.restore();assert.deepEqual(await fs.readdir(dir),[]);
    await saveEditedPptx(output,Buffer.from('pptx'),{});assert.deepEqual((await fs.readdir(dir)).sort(),['result.pptx','result.pptx.report.json']);
  } finally { t.mock.restoreAll(); await fs.rm(dir,{recursive:true,force:true}); }
});
