import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {renderPaper} from '../src/pdf/paper.mjs';
import {hash} from '../src/renderer.mjs';
import {readPptx} from '../src/pptx/read/index.mjs';
const deck=JSON.parse(await fs.readFile(new URL('../examples/demo.deck.json',import.meta.url),'utf8'));
const text='Synthetic source text. This is a fixture, not paper evidence.';
const paper={version:1,source:{sha256:'a'.repeat(64)},pages:[{page:1,text,textSha256:hash(text)}],assets:[]};
const makePlan=()=>({version:1,sourceSha256:paper.source.sha256,deck:structuredClone(deck),evidence:deck.slides.map(s=>({id:`e-${s.id}`,slideId:s.id,page:1,anchor:'Synthetic source text',statement:'Synthetic test only'})),assetBindings:[]});

test('paper plan renders with page evidence in notes and does not mutate author inputs',async()=>{
  const plan=makePlan(),before=JSON.stringify(plan),{buffer,report}=await renderPaper(paper,plan,process.cwd());
  assert.equal(JSON.stringify(plan),before);assert.equal(report.sourcePdfSha256,paper.source.sha256);
  assert.equal(report.checks.paperPageAnchors,'passed');assert.match(report.checks.factualAccuracy,/not-run/);
  const r=await readPptx(buffer);assert.equal(r.summary.readSlides,5);
  assert.ok(r.slides.every(s=>s.notes.speakerText.includes('Source PDF p.1')));
});

test('stale source, corrupt extracted text, missing anchors and uncovered slides fail',async()=>{
  await assert.rejects(renderPaper(paper,{...makePlan(),sourceSha256:'b'.repeat(64)},process.cwd()),/STALE_OR_INVALID/);
  const corrupt=structuredClone(paper);corrupt.pages[0].text='modified';
  await assert.rejects(renderPaper(corrupt,makePlan(),process.cwd()),/TEXT_HASH_MISMATCH/);
  for(const anchor of ['does not occur','   ']){const p=makePlan();p.evidence[0].anchor=anchor;await assert.rejects(renderPaper(paper,p,process.cwd()),/ANCHOR_NOT_FOUND/);}
  const uncovered=makePlan();uncovered.evidence.pop();await assert.rejects(renderPaper(paper,uncovered,process.cwd()),/SLIDE_WITHOUT_PAPER_EVIDENCE/);
});

test('bound paper image bytes are checked and cannot escape the declared asset directory',async()=>{
  const directory=await fs.mkdtemp(path.join(os.tmpdir(),'paper-assets-'));
  try{
    const root=path.join(directory,'assets');await fs.mkdir(root);
    const bytes=Buffer.from(deck.slides[2].elements[0].data.split(',')[1],'base64');await fs.writeFile(path.join(root,'figure.png'),bytes);
    const indexed={...structuredClone(paper),assets:[{id:'figure',page:1,label:'Synthetic figure',path:'figure.png',sha256:hash(bytes)}]};
    const plan=makePlan();plan.assetBindings=[{slideId:'figure',elementId:'image',assetId:'figure'}];
    assert.equal((await renderPaper(indexed,plan,root)).report.checks.boundAssetHashes,'passed');
    const changed=structuredClone(indexed);changed.assets[0].sha256='0'.repeat(64);
    await assert.rejects(renderPaper(changed,plan,root),/ASSET_HASH_MISMATCH/);
    await fs.writeFile(path.join(directory,'outside.png'),bytes);changed.assets[0]={...indexed.assets[0],path:'../outside.png'};
    await assert.rejects(renderPaper(changed,plan,root),/ASSET_OUTSIDE_ROOT/);
  }finally{assert.ok(path.resolve(directory).startsWith(path.resolve(os.tmpdir())+path.sep));await fs.rm(directory,{recursive:true,force:true});}
});
