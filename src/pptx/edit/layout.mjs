import path from 'node:path';
import { NS, child, children, at, attr, parseXml, is } from '../xml.mjs';
import { topShapes, shapeIdentity } from '../read/shapes.mjs';
import { relationshipPart } from './duplicate.mjs';

const textTypes=new Set(['title','ctrTitle','subTitle','body','obj','vertBody','vertObj']);
const auxiliaryTypes=new Set(['dt','ftr','hdr','sldNum']);

export async function createSlideFromLayout(state, layout, operation) {
  const layoutRoot=await state.xml(layout.part);
  if(!is(layoutRoot,'p','sldLayout')) throw new Error('LAYOUT_ROOT_INVALID');
  const p=layoutRoot.namespaceURI,a=NS.a[NS.p.indexOf(p)],r=NS.r[NS.p.indexOf(p)];
  const root=parseXml(`<p:sld xmlns:p="${p}" xmlns:a="${a}" xmlns:r="${r}"><p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/></p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sld>`,'new-slide');
  const doc=root.ownerDocument,tree=at(root,['p','cSld'],['p','spTree']);
  const fill=new Map();
  for(const item of operation.placeholders){if(fill.has(item.idx))throw new Error('DUPLICATE_PLACEHOLDER_FILL');fill.set(item.idx,item.paragraphs);}
  const placeholders=[],seen=new Set(),skipped=[];
  for(const node of topShapes(layoutRoot)) {
    const identity=shapeIdentity(node),ph=identity.placeholder;
    if(!ph) {
      if(node.getElementsByTagNameNS(p,'ph').length) throw new Error('UNSUPPORTED_LAYOUT: nested or compatibility placeholder');
      continue; // Static layout decoration remains in the shared layout part.
    }
    if(auxiliaryTypes.has(ph.type)){skipped.push({idx:ph.idx,type:ph.type});continue;}
    if(!is(node,'p','sp')||!textTypes.has(ph.type)) throw new Error(`UNSUPPORTED_LAYOUT_PLACEHOLDER: ${ph.type}`);
    if(seen.has(ph.idx)) throw new Error('AMBIGUOUS_LAYOUT_PLACEHOLDER');seen.add(ph.idx);
    const sourcePh=at(node,['p','nvSpPr'],['p','nvPr'],['p','ph']);
    if(children(sourcePh).length||Array.from(sourcePh.attributes).some(at=>at.namespaceURI!=='http://www.w3.org/2000/xmlns/'&&!(at.namespaceURI===null&&['idx','type','sz','orient','hasCustomPrompt'].includes(at.localName)))) throw new Error('UNSUPPORTED_LAYOUT: extended placeholder properties');
    const id=String(placeholders.length+2),shape=doc.createElementNS(p,'p:sp');
    const nv=doc.createElementNS(p,'p:nvSpPr'),cnv=doc.createElementNS(p,'p:cNvPr');cnv.setAttribute('id',id);cnv.setAttribute('name',`Placeholder ${ph.idx}`);nv.appendChild(cnv);nv.appendChild(doc.createElementNS(p,'p:cNvSpPr'));
    const nvPr=doc.createElementNS(p,'p:nvPr'),newPh=doc.createElementNS(p,'p:ph');
    for(const name of ['idx','type','sz','orient']) if(attr(sourcePh,name)!==null)newPh.setAttribute(name,attr(sourcePh,name));
    nvPr.appendChild(newPh);nv.appendChild(nvPr);shape.appendChild(nv);shape.appendChild(doc.createElementNS(p,'p:spPr'));
    const body=doc.createElementNS(p,'p:txBody');body.appendChild(doc.createElementNS(a,'a:bodyPr'));body.appendChild(doc.createElementNS(a,'a:lstStyle'));
    for(const item of fill.get(ph.idx)??['']){
      const {text:value,level}=typeof item==='string'?{text:item,level:0}:item;
      const paragraph=doc.createElementNS(a,'a:p');
      if(level>0){
        const properties=doc.createElementNS(a,'a:pPr');
        properties.setAttribute('lvl',String(level));
        paragraph.appendChild(properties);
      }
      if(value!==''){const run=doc.createElementNS(a,'a:r'),text=doc.createElementNS(a,'a:t');text.textContent=value;if(/^\s|\s$/.test(value))text.setAttributeNS('http://www.w3.org/XML/1998/namespace','xml:space','preserve');run.appendChild(text);paragraph.appendChild(run);}
      body.appendChild(paragraph);
    }
    shape.appendChild(body);tree.appendChild(shape);placeholders.push({idx:ph.idx,type:ph.type,shapeId:id});
  }
  for(const idx of fill.keys())if(!seen.has(idx))throw new Error('TARGET_NOT_FOUND: editable layout placeholder');
  const directory=path.posix.join(path.posix.dirname(state.presentationPart),'slides');let counter=1,part;
  do{part=path.posix.join(directory,`slideLayoutAdded${counter++}.xml`);}while(state.has(part));
  const rels=parseXml(`<Relationships xmlns="${NS.rel[0]}"/>`,'new-relationships');
  const rel=rels.ownerDocument.createElementNS(NS.rel[0],'Relationship');rel.setAttribute('Id','rIdLayout');rel.setAttribute('Type',`${r}/slideLayout`);rel.setAttribute('Target',path.posix.relative(path.posix.dirname(part),layout.part));rels.appendChild(rel);
  state.putXml(part,root,'new-slide-from-layout');state.putXml(relationshipPart(part),rels,'new-slide-layout-reference');
  state.registerContentType(part,'application/vnd.openxmlformats-officedocument.presentationml.slide+xml');
  state.registerContentType(relationshipPart(part),'application/vnd.openxmlformats-package.relationships+xml');
  return {part,layoutPart:layout.part,placeholders,auxiliaryPlaceholdersNotMaterialized:skipped};
}
