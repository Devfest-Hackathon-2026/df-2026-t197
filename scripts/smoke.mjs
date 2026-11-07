// Public-data-only CLI walkthrough. Run from any working directory.
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';

const root=fileURLToPath(new URL('../',import.meta.url));
const execute=promisify(execFile);
const run=async(...args)=>{
  const {stdout}=await execute(process.execPath,[path.join(root,'src/cli.mjs'),...args],{cwd:root,windowsHide:true,timeout:60000,maxBuffer:16*1024*1024});
  return JSON.parse(stdout);
};
const json=async file=>JSON.parse(await fs.readFile(file,'utf8'));

try {
  await fs.mkdir(path.join(root,'out'),{recursive:true});
  const directory=await fs.mkdtemp(path.join(root,'out','smoke-'));
  const created=path.join(directory,'created.pptx'),edited=path.join(directory,'edited.pptx');
  const indexFile=path.join(directory,'index.json'),finalIndexFile=path.join(directory,'edited-index.json');
  await run('render',path.join(root,'examples/demo.deck.json'),created);
  await run('read',created,indexFile);
  const before=await json(indexFile),slide=before.slides[0];
  const title=slide.elements.find(e=>e.text?.paragraphs[0]?.runs[0]?.kind==='text'&&e.text.paragraphs[0].runs[0].text===slide.titleText);
  assert.ok(title,'Demo must expose a native editable title');
  const text=slide.titleText+'（編集確認）';
  const plan={version:1,sourceSha256:before.source.sha256,operations:[{
    op:'replace-run-text',slide:{id:slide.slideId},shape:{id:title.id,parents:title.parentIds},
    paragraph:0,run:0,expectedText:slide.titleText,text
  }]};
  const planFile=path.join(directory,'edit-plan.json');
  await fs.writeFile(planFile,JSON.stringify(plan,null,2),'utf8');
  await run('edit',created,planFile,edited);
  await run('read',edited,finalIndexFile);
  const after=await json(finalIndexFile),report=await json(edited+'.report.json');
  assert.equal(after.slides[0].titleText,text);
  assert.equal(after.slides.length,5);
  assert.deepEqual(after.slides.slice(1),before.slides.slice(1));
  assert.deepEqual(report.preservation.changedOriginalParts.map(p=>p.part),[slide.part]);
  for(const file of [created,edited])assert.equal((await run('inspect',file)).status,'passed');
  // Reusing an output name must fail and leave the successful result intact.
  const hashFile=async file=>createHash('sha256').update(await fs.readFile(file)).digest('hex');
  const savedHash=await hashFile(edited);
  await assert.rejects(run('edit',created,planFile,edited),/OUTPUT_EXISTS|Refusing to overwrite/);
  assert.equal(await hashFile(edited),savedHash);
  console.log(JSON.stringify({status:'passed',directory,slides:5,checks:['render','read','edit','unchanged-slides','inspect','overwrite-refused'],visual:'not-run',nativeSaveReopen:'not-run'},null,2));
} catch(error) {console.error(error.message);process.exitCode=1;}
