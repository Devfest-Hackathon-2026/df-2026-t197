import {child,at,descendants,attr,NS,integer} from '../xml.mjs';
export function nextShapeId(root) {
  const ids=descendants(root,'p','cNvPr').map(n=>integer(attr(n,'id'))).filter(n=>n!==null);
  const id=ids.reduce((max,n)=>Math.max(max,n),0)+1;
  if(!Number.isSafeInteger(id)||id>4294967295)throw new Error('SHAPE_ID_EXHAUSTED');
  return id;
}

export function addTextShape(root,operation,slideSize) {
  const {xEmu:x,yEmu:y,widthEmu:w,heightEmu:h}=operation;
  if(!slideSize.widthEmu||!slideSize.heightEmu||x+w>slideSize.widthEmu||y+h>slideSize.heightEmu)throw new Error('SHAPE_OUTSIDE_SLIDE');
  const id=nextShapeId(root);
  const doc=root.ownerDocument,p=root.namespaceURI,a=NS.a[NS.p.indexOf(p)];
  const make=(ns,name,attributes={})=>{const node=doc.createElementNS(ns,name);for(const [k,v]of Object.entries(attributes))node.setAttribute(k,String(v));return node;};
  const shape=make(p,'p:sp'),nv=make(p,'p:nvSpPr');
  nv.appendChild(make(p,'p:cNvPr',{id,name:`Added text ${id}`}));nv.appendChild(make(p,'p:cNvSpPr',{txBox:1}));nv.appendChild(make(p,'p:nvPr'));shape.appendChild(nv);
  const props=make(p,'p:spPr'),transform=make(a,'a:xfrm');transform.appendChild(make(a,'a:off',{x,y}));transform.appendChild(make(a,'a:ext',{cx:w,cy:h}));props.appendChild(transform);
  const geometry=make(a,'a:prstGeom',{prst:'rect'});geometry.appendChild(make(a,'a:avLst'));props.appendChild(geometry);props.appendChild(make(a,'a:noFill'));
  const line=make(a,'a:ln');line.appendChild(make(a,'a:noFill'));props.appendChild(line);shape.appendChild(props);
  const body=make(p,'p:txBody'),bodyPr=make(a,'a:bodyPr',{wrap:'square',anchor:'t',lIns:0,rIns:0,tIns:0,bIns:0});bodyPr.appendChild(make(a,'a:noAutofit'));body.appendChild(bodyPr);body.appendChild(make(a,'a:lstStyle'));
  for(const value of operation.paragraphs){
    const paragraph=make(a,'a:p'),run=make(a,'a:r'),style=make(a,'a:rPr',{lang:'ja-JP',sz:Math.round(operation.fontSizePt*100)}),fill=make(a,'a:solidFill');fill.appendChild(make(a,'a:srgbClr',{val:operation.color.toUpperCase()}));style.appendChild(fill);
    for(const name of ['latin','ea','cs'])style.appendChild(make(a,`a:${name}`,{typeface:operation.fontFace}));run.appendChild(style);
    const text=make(a,'a:t');text.textContent=value;if(/^\s|\s$/.test(value))text.setAttributeNS('http://www.w3.org/XML/1998/namespace','xml:space','preserve');run.appendChild(text);paragraph.appendChild(run);body.appendChild(paragraph);
  }
  shape.appendChild(body);
  const tree=at(root,['p','cSld'],['p','spTree']);if(!tree)throw new Error('SLIDE_TREE_MISSING');
  tree.insertBefore(shape,child(tree,'p','extLst'));
  return {shapeId:String(id),styleMode:'explicit-local-text-style; not a layout placeholder',automaticFit:'disabled; inspect rendering for overflow'};
}
