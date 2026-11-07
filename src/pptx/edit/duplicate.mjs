import path from 'node:path';
import { child, children, attr, NS, parseXml } from '../xml.mjs';

export const relationshipPart = part => path.posix.join(path.posix.dirname(part),'_rels',`${path.posix.basename(part)}.rels`);
const relativeTarget=(from,to)=>path.posix.relative(path.posix.dirname(from),to);
const owned=new Set(['notesSlide','chart','package','oleObject','chartStyle','chartColorStyle']);
const shared=new Set(['slideLayout','notesMaster','theme','image','audio','video','media','hyperlink','slide']);

// Ownership rules are deliberate. Unknown relationships fail instead of silently sharing mutable data.
export async function duplicateSlide(state, sourcePart) {
  const mapping=new Map(), sharedReferences=[], copied=[];
  function allocate(original) {
    const ext=path.posix.extname(original),base=original.slice(0,original.length-ext.length);
    let index=1,part;
    do {part=`${base}_copy${index++}${ext}`;} while(state.has(part));
    return part;
  }
  async function clone(original) {
    if(mapping.has(original)) return mapping.get(original);
    const dest=allocate(original); mapping.set(original,dest);
    state.put(dest,await state.bytes(original)); copied.push({source:original,part:dest});
    state.copyContentType(original,dest);
    const originalRels=relationshipPart(original);
    if(state.has(originalRels)) {
      const root=parseXml((await state.bytes(originalRels)).toString('utf8'),originalRels);
      const relationships=await state.pkg.relationships(original);
      for(const node of children(root,'rel','Relationship')) {
        const rel=relationships.find(r=>r.id===attr(node,'Id'));
        if(!rel) throw new Error('RELATIONSHIP_INVALID');
        if(rel.external) {sharedReferences.push({source:original,id:rel.id,external:true});continue;}
        if(!rel.exists) throw new Error('RELATIONSHIP_INVALID: missing target');
        const kind=rel.kind ?? rel.type?.split('/').at(-1);
        let target;
        if(mapping.has(rel.part)) target=mapping.get(rel.part);
        else if(owned.has(kind)) target=await clone(rel.part);
        else if(shared.has(kind)) {target=rel.part;sharedReferences.push({source:original,id:rel.id,part:target,kind});}
        else throw new Error(`UNSUPPORTED_DUPLICATE_RELATIONSHIP: ${rel.type}`);
        const fragment=rel.target.includes('#') ? '#'+rel.target.split('#').slice(1).join('#') : '';
        node.setAttribute('Target',relativeTarget(dest,target)+fragment);
      }
      state.putXml(relationshipPart(dest),root);
      state.copyContentType(originalRels,relationshipPart(dest));
    }
    return dest;
  }
  const part=await clone(sourcePart);
  // Notes back-links (and self-links) resolve through the mapping created before recursion.
  return {part,copied,sharedReferences};
}

export function addSlideEntry(state, sourceEntry, afterEntry, newPart) {
  const list=child(state.presentationRoot,'p','sldIdLst');
  const ids=state.usedSlideIds ? [...state.usedSlideIds].map(Number) : children(list,'p','sldId').map(n=>Number(attr(n,'id')));
  const id=Math.max(255,...ids)+1;
  if(!Number.isSafeInteger(id)||id>2147483647) throw new Error('SLIDE_ID_EXHAUSTED');
  state.usedSlideIds?.add(String(id));
  const relIds=new Set(children(state.presentationRels,'rel','Relationship').map(n=>attr(n,'Id')));
  let counter=1; while(relIds.has(`rIdCopy${counter}`)) counter++;
  const rid=`rIdCopy${counter}`;
  const entry=sourceEntry.cloneNode(false); entry.setAttribute('id',String(id));
  const relationshipAttr=Array.from(entry.attributes).find(a=>NS.r.includes(a.namespaceURI)&&a.localName==='id');
  if(!relationshipAttr) throw new Error('SLIDE_RELATIONSHIP_ATTRIBUTE_MISSING');
  entry.setAttributeNS(relationshipAttr.namespaceURI,relationshipAttr.name,rid);
  list.insertBefore(entry,afterEntry.nextSibling);
  const rel=state.presentationRels.ownerDocument.createElementNS(NS.rel[0],'Relationship');
  rel.setAttribute('Id',rid);
  rel.setAttribute('Type',`${relationshipAttr.namespaceURI}/slide`);
  rel.setAttribute('Target',relativeTarget(state.presentationPart,newPart));
  state.presentationRels.appendChild(rel);
  state.putXml(state.presentationPart,state.presentationRoot);
  state.putXml(relationshipPart(state.presentationPart),state.presentationRels,'register-cloned-slide-relationship');
  return {id:String(id),part:newPart,entry};
}
