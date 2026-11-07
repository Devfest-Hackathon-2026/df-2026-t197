import fs from 'node:fs/promises';
import path from 'node:path';
import Ajv from 'ajv';
import {renderDeck,hash} from '../renderer.mjs';
import {inspectPptx} from '../inspect.mjs';
import {validateDeck} from '../schema.mjs';
const text={type:'string',minLength:1,maxLength:2000};
const schema={type:'object',additionalProperties:false,required:['version','sourceSha256','deck','evidence','assetBindings'],properties:{version:{const:1},sourceSha256:{type:'string',pattern:'^[a-f0-9]{64}$'},deck:{type:'object'},evidence:{type:'array',minItems:1,maxItems:500,items:{type:'object',additionalProperties:false,required:['id','slideId','page','anchor','statement'],properties:{id:text,slideId:text,page:{type:'integer',minimum:1},anchor:text,statement:text}}},assetBindings:{type:'array',maxItems:100,items:{type:'object',additionalProperties:false,required:['slideId','elementId','assetId'],properties:{slideId:text,elementId:text,assetId:text}}}}};
const validate=new Ajv({allErrors:true,strict:true}).compile(schema);
const normalize=text=>text.replace(/\s+/gu,'');
export async function renderPaper(paper,plan,assetRoot) {
  if(!validate(plan))throw new Error(`INVALID_PAPER_PLAN: ${JSON.stringify(validate.errors)}`);
  validateDeck(plan.deck);
  if(paper.version!==1||!Array.isArray(paper.pages)||!Array.isArray(paper.assets)||paper.source?.sha256!==plan.sourceSha256)throw new Error('STALE_OR_INVALID_PAPER_INDEX');
  const deck=structuredClone(plan.deck),slides=new Map(deck.slides?.map(s=>[s.id,s])??[]),ids=new Set();
  for(const evidence of plan.evidence){
    const slide=slides.get(evidence.slideId),page=paper.pages[evidence.page-1];
    if(!slide||!page||page.page!==evidence.page)throw new Error('PAPER_EVIDENCE_TARGET_NOT_FOUND');
    if(ids.has(evidence.id))throw new Error('DUPLICATE_EVIDENCE_ID');ids.add(evidence.id);
    if(hash(page.text)!==page.textSha256)throw new Error('PAPER_INDEX_TEXT_HASH_MISMATCH');
    if(!normalize(evidence.anchor)||!normalize(page.text).includes(normalize(evidence.anchor)))throw new Error(`PAPER_ANCHOR_NOT_FOUND: ${evidence.id} (page ${evidence.page})`);
    const source=`Source PDF p.${evidence.page}`;
    slide.sources=[...new Set([...(slide.sources??[]),source])];
    slide.notes=[slide.notes??'',`根拠 ${evidence.id}: PDF p.${evidence.page} / ${evidence.statement}`].filter(Boolean).join('\n');
  }
  for(const slide of slides.values())if(!plan.evidence.some(e=>e.slideId===slide.id))throw new Error('SLIDE_WITHOUT_PAPER_EVIDENCE');
  const root=await fs.realpath(assetRoot),bound=new Set();
  for(const binding of plan.assetBindings){
    const key=`${binding.slideId}/${binding.elementId}`;
    if(bound.has(key))throw new Error('DUPLICATE_ASSET_BINDING');bound.add(key);
    const element=slides.get(binding.slideId)?.elements?.find(e=>e.id===binding.elementId),asset=paper.assets.find(a=>a.id===binding.assetId);
    if(element?.type!=='image'||!asset||typeof asset.path!=='string')throw new Error('PAPER_ASSET_TARGET_NOT_FOUND');
    const file=await fs.realpath(path.resolve(root,asset.path)),relative=path.relative(root,file);
    if(relative==='..'||relative.startsWith(`..${path.sep}`)||path.isAbsolute(relative))throw new Error('PAPER_ASSET_OUTSIDE_ROOT');
    const bytes=await fs.readFile(file);if(hash(bytes)!==asset.sha256)throw new Error('PAPER_ASSET_HASH_MISMATCH');
    delete element.path;element.data=`data:image/png;base64,${bytes.toString('base64')}`;
    const source=`Source PDF p.${asset.page}, ${asset.label}`;
    const slide=slides.get(binding.slideId);slide.sources=[...new Set([...(slide.sources??[]),source])];
  }
  const {buffer,report}=await renderDeck(deck,{assetRoot:root});
  const structure=await inspectPptx(buffer);if(structure.status!=='passed')throw new Error('PAPER_PPTX_STRUCTURE_FAILED');
  return {buffer,report:{...report,structure,sourcePdfSha256:paper.source.sha256,paperPlanSha256:hash(JSON.stringify(plan)),paperEvidence:plan.evidence,assetBindings:plan.assetBindings,checks:{...report.checks,paperPageAnchors:'passed',boundAssetHashes:'passed',factualAccuracy:'not-run; semantic source review required'},limitations:['No AI API is called. The agent authors the plan after reading the source.','PDF anchor matching is traceability, not automatic fact checking.','Raster source figures remain images; native shapes and tables remain editable.']}};
}
