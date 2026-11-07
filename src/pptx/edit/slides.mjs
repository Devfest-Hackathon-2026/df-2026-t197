import {children,child,attr,NS,relId} from '../xml.mjs';
import {relationshipPart} from './duplicate.mjs';
import {sectionInsertionPoint,reorderSectionSlides} from './sections.mjs';

async function relationships(state, source) {
  const relsPart=relationshipPart(source);
  if(!state.parts().includes(relsPart))return [];
  const root=await state.xml(relsPart);
  return children(root,'rel','Relationship').map(node=>({node,id:attr(node,'Id'),type:attr(node,'Type'),external:attr(node,'TargetMode')==='External',part:attr(node,'TargetMode')==='External'?null:state.pkg.resolve(source,attr(node,'Target'))}));
}
const sourceOf=part=>part==='_rels/.rels'?'':part.replace(/(?:^|\/)\_rels\//,'/').replace(/^\//,'').slice(0,-5);

export async function deleteSlide(state, target) {
  const list=child(state.presentationRoot,'p','sldIdLst');
  if(children(list,'p','sldId').length<=1)throw new Error('LAST_SLIDE_REQUIRED');
  const section=sectionInsertionPoint(state.presentationRoot,target.id),rid=relId(target.entry);
  // References inside a custom show or unknown presentation extension must not be left dangling.
  for(const node of [state.presentationRoot,...Array.from(state.presentationRoot.getElementsByTagName('*'))]) {
    if(node===target.entry)continue;
    if(Array.from(node.attributes??[]).some(a=>NS.r.includes(a.namespaceURI)&&a.value===rid))throw new Error('SLIDE_REFERENCED_IN_PRESENTATION: custom show or extension');
  }
  const notes=(await relationships(state,target.part)).filter(r=>!r.external&&r.type?.endsWith('/notesSlide'));
  if(notes.length>1)throw new Error('AMBIGUOUS_NOTES_RELATIONSHIP');
  const removed=new Set([target.part]);
  if(notes[0])removed.add(notes[0].part);
  // Inspect every current relationship part, including parts outside the reader's supported content.
  for(const part of state.parts().filter(p=>p.endsWith('.rels'))) {
    const source=sourceOf(part);
    const rels=source ? await relationships(state,source) : (await state.pkg.relationships('')).map(r=>({...r}));
    for(const rel of rels)if(!rel.external&&removed.has(rel.part)&&!removed.has(source)) {
      if(source===state.presentationPart&&rel.id===rid&&rel.part===target.part)continue;
      throw new Error(`SLIDE_STILL_REFERENCED: ${source} / ${rel.id}`);
    }
  }
  for(const part of [...removed])if(state.parts().includes(relationshipPart(part)))removed.add(relationshipPart(part));
  const refs=children(state.presentationRels,'rel','Relationship').filter(n=>attr(n,'Id')===rid);
  if(refs.length!==1)throw new Error('SLIDE_RELATIONSHIP_INVALID');
  state.presentationRels.removeChild(refs[0]);list.removeChild(target.entry);
  if(section)section.parentNode.removeChild(section);
  for(const node of children(state.types,'ct','Override')) {
    const name=state.pkg.resolve('',attr(node,'PartName'));
    if(removed.has(name))state.types.removeChild(node);
  }
  for(const part of removed)state.remove(part);
  state.putXml(state.presentationPart,state.presentationRoot,'delete-slide-registration');
  state.putXml(relationshipPart(state.presentationPart),state.presentationRels,'delete-slide-relationship');
  state.putXml('[Content_Types].xml',state.types,'remove-slide-content-types');
  target.active=false;
  return {slideId:target.id,removedParts:[...removed],retainedResources:'Charts, images, workbooks and document caches are not garbage-collected; this is not secure content erasure.'};
}

export function reorderSlides(state, targets) {
  const list=child(state.presentationRoot,'p','sldIdLst'),current=children(list,'p','sldId');
  if(targets.length!==current.length||new Set(targets.map(t=>t.id)).size!==current.length)throw new Error('REORDER_MUST_LIST_EVERY_ACTIVE_SLIDE_ONCE');
  const ids=targets.map(t=>t.id);
  if(current.some(n=>!ids.includes(attr(n,'id'))))throw new Error('REORDER_TARGET_MISMATCH');
  reorderSectionSlides(state.presentationRoot,ids);
  for(const target of targets)list.appendChild(target.entry);
  state.putXml(state.presentationPart,state.presentationRoot,'reorder-slides-and-sections');
  return {slideIds:ids};
}
