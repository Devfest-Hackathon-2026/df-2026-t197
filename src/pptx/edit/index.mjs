import { XMLSerializer } from '@xmldom/xmldom';
import { PptxPackage, sha256 } from '../package.mjs';
import { readPptx } from '../read/index.mjs';
import { child, children, attr, relId, NS, parseXml } from '../xml.mjs';
import { validateEditPlan } from './plan.mjs';
import { replaceRunText } from './text.mjs';
import { replaceShapeParagraph, insertShapeParagraph, deleteShapeParagraph } from './paragraph.mjs';
import { createSlideFromLayout } from './layout.mjs';
import { replaceTableCellParagraph } from './table.mjs';
import { duplicateSlide, addSlideEntry, relationshipPart } from './duplicate.mjs';
import { sectionInsertionPoint, insertSectionSlide } from './sections.mjs';
import {deleteSlide,reorderSlides} from './slides.mjs';
import {addTextShape} from './shape.mjs';
import {setTextStyle,setShapePosition,deleteShape} from './format.mjs';
import {addImage,replaceImage} from './image.mjs';
import {setSpeakerNotes} from './notes.mjs';

const serialize=root=>Buffer.from(new XMLSerializer().serializeToString(root),'utf8');
export async function editPptx(input, plan) {
  validateEditPlan(plan);
  if(sha256(input)!==plan.sourceSha256.toLowerCase()) throw new Error('STALE_INPUT');
  const pkg=await PptxPackage.open(input), before=await pkg.inventory();
  if(before.some(p=>p.part.startsWith('_xmlsignatures/'))) throw new Error('UNSUPPORTED_EDIT: signed package');
  const index=await readPptx(input);
  if(index.status==='partial') throw new Error('INPUT_STRUCTURE_INVALID');
  const changes=new Map(),roots=new Map(),reasons=new Map(),deleted=new Set(),reservedParts=new Set(before.map(p=>p.part));
  const bytes=async part=>{if(deleted.has(part))throw new Error('PART_REMOVED');return changes.get(part) ?? pkg.raw(part);};
  const xml=async part=>{
    if(!roots.has(part)) roots.set(part,parseXml(new TextDecoder('utf-8',{fatal:true}).decode(await bytes(part)),part));
    return roots.get(part);
  };
  const put=(part,data,reason='duplicate-dependency')=>{if(deleted.has(part))throw new Error('PART_REMOVED');reservedParts.add(part);changes.set(part,data);roots.delete(part);reasons.set(part,reason);};
  const putXml=(part,root,reason)=>{put(part,serialize(root),reason);roots.set(part,root);};
  const presentationPart=index.source.presentationPart;
  const presentationRoot=await xml(presentationPart), presentationRels=await xml(relationshipPart(presentationPart));
  const types=await xml('[Content_Types].xml');
  const registerContentType=(dest,type)=>{
    const extension=dest.split('.').at(-1);
    if(children(types,'ct','Default').some(n=>attr(n,'Extension')===extension&&attr(n,'ContentType')===type)) return;
    const node=types.ownerDocument.createElementNS(NS.ct[0],'Override');
    node.setAttribute('PartName','/'+dest);node.setAttribute('ContentType',type);types.appendChild(node);
    putXml('[Content_Types].xml',types,'register-added-content-types');
  };
  const state={pkg,presentationPart,presentationRoot,presentationRels,types,bytes,xml,put,putXml,registerContentType,
    usedSlideIds:new Set(index.slides.map(s=>s.slideId)),
    parts:()=>[...reservedParts].filter(p=>!deleted.has(p)),
    remove:part=>{deleted.add(part);changes.delete(part);roots.delete(part);reasons.set(part,'delete-slide-owned-part');},
    has:part=>reservedParts.has(part),copyContentType:(source,dest)=>{
    const type=index.parts.find(p=>p.part===source)?.contentType;
    if(!type) throw new Error(`CONTENT_TYPE_MISSING: ${source}`);
    registerContentType(dest,type);
  }};
  const list=child(presentationRoot,'p','sldIdLst');
  const original=new Map(children(list,'p','sldId').map(entry=>{const slide=index.slides.find(s=>s.slideId===attr(entry,'id'));return [attr(entry,'id'),{id:attr(entry,'id'),entry,part:slide?.part,active:true,hidden:slide?.hidden,hasNotes:Boolean(slide?.notes)}];}));
  const aliases=new Map(),operations=[],warnings=[];
  const resolve=ref=>{
    const target=ref.id ? original.get(ref.id) : aliases.get(ref.alias);
    if(!target?.part||target.active===false) throw new Error('TARGET_NOT_FOUND: active slide');return target;
  };
  for(const operation of plan.operations) {
    const target=['add-slide-from-layout','reorder-slides'].includes(operation.op)?null:resolve(operation.slide);
    if(operation.op==='delete-slide') {
      operations.push({op:operation.op,...await deleteSlide(state,target)});
    } else if(operation.op==='reorder-slides') {
      operations.push({op:operation.op,...reorderSlides(state,operation.slides.map(resolve))});
    } else if(operation.op==='set-speaker-notes') {
      operations.push({op:operation.op,slideId:target.id,...await setSpeakerNotes(state,target,operation)});
    } else if(operation.op==='add-slide-from-layout') {
      if(aliases.has(operation.as))throw new Error('DUPLICATE_ALIAS');
      const layout=index.layouts.find(l=>l.part===operation.layoutPart);
      if(!layout)throw new Error('TARGET_NOT_FOUND: registered layout');
      const after=resolve(operation.after),sectionAnchor=sectionInsertionPoint(presentationRoot,after.id);
      const added=await createSlideFromLayout(state,layout,operation);
      const created=addSlideEntry(state,after.entry,after.entry,added.part);
      Object.assign(created,{active:true,hidden:false,hasNotes:false});
      insertSectionSlide(sectionAnchor,created.id);putXml(presentationPart,presentationRoot,'register-new-slide-and-section');
      aliases.set(operation.as,created);
      operations.push({op:operation.op,alias:operation.as,slideId:created.id,...added});
      if(child(presentationRoot,'p','custShowLst'))warnings.push('Custom shows are preserved; added pages are not automatically included.');
    } else if(operation.op==='duplicate-slide') {
      if(operation.slide.alias) throw new Error('UNSUPPORTED_EDIT: duplicate an original slide, not an alias');
      if(aliases.has(operation.as)) throw new Error('DUPLICATE_ALIAS');
      const after=resolve(operation.after),sectionAnchor=sectionInsertionPoint(presentationRoot,after.id);
      const duplicate=await duplicateSlide(state,target.part);
      const created=addSlideEntry(state,target.entry,after.entry,duplicate.part);
      Object.assign(created,{active:true,hidden:target.hidden,hasNotes:target.hasNotes});
      insertSectionSlide(sectionAnchor,created.id);
      putXml(presentationPart,presentationRoot,'register-cloned-slide-and-section');
      aliases.set(operation.as,created);
      operations.push({op:operation.op,sourceSlideId:target.id,alias:operation.as,slideId:created.id,...duplicate});
      if(child(presentationRoot,'p','custShowLst')) warnings.push('Custom shows are preserved; cloned pages are not automatically included.');
    } else {
      const root=await xml(target.part);
      let detail={};
      if(operation.op==='replace-run-text') replaceRunText(root,operation);
      else if(operation.op==='replace-paragraph-text') detail=replaceShapeParagraph(root,operation);
      else if(operation.op==='insert-paragraph') detail=insertShapeParagraph(root,operation);
      else if(operation.op==='delete-paragraph') detail=deleteShapeParagraph(root,operation);
      else if(operation.op==='add-text-shape') detail=addTextShape(root,operation,index.slideSize);
      else if(operation.op==='set-text-style') detail=setTextStyle(root,operation);
      else if(operation.op==='set-shape-position') detail=setShapePosition(root,operation,index.slideSize);
      else if(operation.op==='delete-shape') detail=deleteShape(root,operation);
      else if(operation.op==='replace-image') detail=await replaceImage(state,target,root,operation,index.slideSize);
      else if(operation.op==='add-image') detail=await addImage(state,target,root,operation,index.slideSize);
      else if(operation.op==='replace-table-cell-paragraph') detail=replaceTableCellParagraph(root,operation);
      else throw new Error('UNSUPPORTED_EDIT');
      putXml(target.part,root,operation.op);
      operations.push({op:operation.op,slideId:target.id,part:target.part,shape:operation.shape,paragraph:operation.paragraph,run:operation.run,row:operation.row,column:operation.column,...detail});
    }
  }
  const active=[...original.values(),...aliases.values()].filter(s=>s.active!==false);
  if(operations.some(op=>['add-slide-from-layout','duplicate-slide','delete-slide','reorder-slides'].includes(op.op))) {
    // Update simple counts, while leaving saved outline/thumbnail caches intact.
    const rel=(await pkg.relationships('')).find(r=>r.type?.endsWith('/extended-properties')&&r.exists);
    if(rel) {
      const root=await xml(rel.part);
      const counts={Slides:active.length,Notes:active.filter(s=>s.hasNotes).length,HiddenSlides:active.filter(s=>s.hidden).length};
      let changed=false;
      for(const node of Array.from(root.childNodes)) if(node.nodeType===1&&node.namespaceURI===root.namespaceURI&&Object.hasOwn(counts,node.localName)&&node.textContent!==String(counts[node.localName])) {node.textContent=String(counts[node.localName]);changed=true;}
      if(changed) putXml(rel.part,root,'update-slide-note-hidden-counts');
    }
    warnings.push('Cached document thumbnails/outlines and field display values are preserved; Office may refresh them.');
  }
  for(const [part,data] of changes) pkg.zip.file(part,data,{createFolders:false});
  for(const part of deleted)pkg.zip.remove(part);
  const buffer=await pkg.zip.generateAsync({type:'nodebuffer',compression:'DEFLATE'});
  const afterPkg=await PptxPackage.open(buffer),after=await afterPkg.inventory();
  // Check all relationship parts, including parts not traversed by the content index.
  for(const p of after) if(p.part.endsWith('.rels')) {
    const source=p.part==='_rels/.rels' ? '' : p.part.replace(/(?:^|\/)\_rels\//, '/').replace(/^\//,'').slice(0,-5);
    await afterPkg.relationships(source);
  }
  if(afterPkg.issues.some(i=>i.severity==='error')) throw new Error(`OUTPUT_RELATIONSHIP_INVALID: ${JSON.stringify(afterPkg.issues)}`);
  const afterIndex=await readPptx(buffer);
  if(afterIndex.status==='partial') throw new Error('OUTPUT_STRUCTURE_INVALID');
  if(afterIndex.slides.length!==active.length) throw new Error('OUTPUT_SLIDE_COUNT_INVALID');
  const afterMap=new Map(after.map(p=>[p.part,p]));
  for(const part of before) if(deleted.has(part.part)?afterMap.has(part.part):!changes.has(part.part)&&afterMap.get(part.part)?.sha256!==part.sha256) throw new Error(`PRESERVATION_FAILED: ${part.part}`);
  const oldMap=new Map(before.map(p=>[p.part,p]));
  return {buffer,report:{version:1,status:'passed',sourceSha256:pkg.hash,outputSha256:sha256(buffer),operations,
    preservation:{unchangedOriginalParts:before.filter(p=>!changes.has(p.part)&&!deleted.has(p.part)).length,changedOriginalParts:before.filter(p=>changes.has(p.part)).map(p=>({part:p.part,before:p.sha256,after:afterMap.get(p.part).sha256,reason:reasons.get(p.part)})),addedParts:after.filter(p=>!oldMap.has(p.part)).map(p=>({part:p.part,sha256:p.sha256})),removedParts:before.filter(p=>deleted.has(p.part)).map(p=>({part:p.part,sha256:p.sha256,reason:reasons.get(p.part)}))},
    inputWarnings:index.issues,outputWarnings:afterIndex.issues,warnings,
    checks:{partPreservation:'passed',relationships:'passed',reader:'passed-with-possible-warnings',rendering:'not-run',nativeEditing:'not-run'},
    limitations:['Plain runs, supported shape paragraphs and unmerged native-table cell paragraphs only; no fields/math or compatibility-branch text edits.', 'No full XSD, visual or font validation. Shared layouts/masters/themes are preserved, not globally edited.','Duplicate of an alias, unknown section formats and unknown owned relationship kinds are rejected.','Paragraph operations do not automatically reflow or resize text. Mixed declared character styles require an explicit source run; hyperlinks require run-level edits.','New layout pages instantiate supported text placeholders only; auxiliary date/header/footer/slide-number placeholders are not materialized. No source slide content or notes are copied.','Reorder preserves existing section boundaries. Deletion retains related resources and document caches; it is not secure content erasure.','Text formatting is explicit local override. Position and PNG/JPEG replacement support unrotated top-level shapes only; image effects other than identity alpha are unsupported. Existing exclusive notes only; no creation or alias-note edits in the same plan.','No automatic font shrinking, text overflow guarantee or chart-data editing.']}};
}
