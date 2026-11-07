import {child,children,at,attr,NS,is} from '../xml.mjs';

export async function setSpeakerNotes(state,target,op){
  // Only edit an existing exclusive notes part; creation is a separate capability.
  const rel=await state.pkg.oneRelationship(target.part,'notesSlide');
  if(!rel)throw new Error('UNSUPPORTED_NOTES: existing notes required');
  for(const part of state.parts().filter(p=>p.endsWith('.rels'))){
    const root=await state.xml(part);
    for(const n of children(root,'rel','Relationship')){
      if(attr(n,'TargetMode')==='External'||!attr(n,'Type')?.endsWith('/notesSlide'))continue;
      const source=part==='_rels/.rels'?'':part.replace(/(?:^|\/)\_rels\//,'/').replace(/^\//,'').slice(0,-5);
      if(source!==target.part&&state.pkg.resolve(source,attr(n,'Target'))===rel.part)throw new Error('SHARED_NOTES_EDIT_REFUSED');
    }
  }
  const root=await state.xml(rel.part),p=root.namespaceURI,a=NS.a[NS.p.indexOf(p)];
  if(!is(root,'p','notes'))throw new Error('NOTES_ROOT_INVALID');
  const tree=at(root,['p','cSld'],['p','spTree']);
  const candidates=children(tree,'p','sp').filter(n=>attr(at(n,['p','nvSpPr'],['p','nvPr'],['p','ph']),'type')==='body');
  if(candidates.length!==1)throw new Error('UNSUPPORTED_NOTES: require one body placeholder');
  const body=child(candidates[0],'p','txBody');if(!body)throw new Error('NOTES_BODY_MISSING');
  const current=children(body,'a','p').map(p=>children(p).filter(n=>['r','fld','br'].includes(n.localName)).map(n=>n.localName==='br'?'\n':child(n,'a','t')?.textContent??'').join('')).join('\n');
  if(current!==op.expectedText)throw new Error('STALE_NOTES');
  for(const node of children(body,'a','p'))body.removeChild(node);
  for(const value of op.paragraphs){const para=body.ownerDocument.createElementNS(a,'a:p'),run=body.ownerDocument.createElementNS(a,'a:r'),text=body.ownerDocument.createElementNS(a,'a:t');text.textContent=value;if(/^\s|\s$/.test(value))text.setAttributeNS('http://www.w3.org/XML/1998/namespace','xml:space','preserve');run.appendChild(text);para.appendChild(run);body.appendChild(para);}
  state.putXml(rel.part,root,'set-speaker-notes');return {notesPart:rel.part,paragraphs:op.paragraphs.length};
}
