import {child,children,descendants,at,attr,NS,is} from '../xml.mjs';
import {findShape} from './text.mjs';

const make=(node,ns,name)=>node.ownerDocument.createElementNS(ns,name);
function assertEditable(node) {
  if(!['sp','pic','graphicFrame'].some(k=>is(node,'p',k)))throw new Error('UNSUPPORTED_SHAPE_EDIT');
}
export function setShapePosition(root,op,size) {
  if(op.shape.parents.length)throw new Error('UNSUPPORTED_POSITION: grouped coordinates');
  const node=findShape(root,op.shape,null);assertEditable(node);
  if(!size.widthEmu||!size.heightEmu||op.xEmu+op.widthEmu>size.widthEmu||op.yEmu+op.heightEmu>size.heightEmu)throw new Error('SHAPE_OUTSIDE_SLIDE');
  const a=NS.a[NS.p.indexOf(root.namespaceURI)];
  let parent=is(node,'p','graphicFrame')?node:child(node,'p','spPr');
  if(!parent){parent=make(node,root.namespaceURI,'p:spPr');node.insertBefore(parent,child(node,'p','style')??child(node,'p','txBody')??child(node,'p','extLst'));}
  let x=is(node,'p','graphicFrame')?child(node,'p','xfrm'):child(parent,'a','xfrm');
  if(x&&(Number(attr(x,'rot')??0)!==0||['true','1'].includes(attr(x,'flipH'))||['true','1'].includes(attr(x,'flipV'))))throw new Error('UNSUPPORTED_POSITION: transformed shape');
  if(!x){
    if(is(node,'p','graphicFrame')){x=make(node,root.namespaceURI,'p:xfrm');parent.insertBefore(x,child(parent,'a','graphic')??child(parent,'p','extLst'));}
    else{x=make(node,a,'a:xfrm');parent.insertBefore(x,parent.firstChild);}
  }
  for(const [name,values] of [['off',{x:op.xEmu,y:op.yEmu}],['ext',{cx:op.widthEmu,cy:op.heightEmu}]]) {
    let n=child(x,'a',name);if(!n){n=make(node,a,`a:${name}`);x.appendChild(n);}
    for(const [k,v] of Object.entries(values))n.setAttribute(k,String(v));
  }
  return {shapeId:op.shape.id,coordinates:'slide-local EMU; unrotated top-level only'};
}

export function setTextStyle(root,op) {
  const node=findShape(root,op.shape,null);assertEditable(node);
  if(is(node,'p','pic')||descendants(node,'a','fld').length||node.getElementsByTagNameNS('*','AlternateContent').length)throw new Error('UNSUPPORTED_TEXT_STYLE');
  const paragraphs=descendants(node,'a','p');if(!paragraphs.length)throw new Error('TARGET_NOT_FOUND: text');
  const a=NS.a[NS.p.indexOf(root.namespaceURI)];
  for(const p of paragraphs){
    let pPr=child(p,'a','pPr');if(!pPr){pPr=make(node,a,'a:pPr');p.insertBefore(pPr,p.firstChild);}
    if(op.alignment)pPr.setAttribute('algn',{left:'l',center:'ctr',right:'r'}[op.alignment]);
    if(op.removeBullets){
      for(const n of children(pPr).filter(n=>/^bu/.test(n.localName)))pPr.removeChild(n);
      pPr.removeAttribute('marL');pPr.removeAttribute('indent');
      const bu=make(node,a,'a:buNone');pPr.insertBefore(bu,child(pPr,'a','tabLst')??child(pPr,'a','defRPr')??child(pPr,'a','extLst'));
    }
    let defaults=child(pPr,'a','defRPr');if(!defaults){defaults=make(node,a,'a:defRPr');pPr.insertBefore(defaults,child(pPr,'a','extLst'));}
    const styles=[defaults];
    for(const run of children(p,'a','r')){let rPr=child(run,'a','rPr');if(!rPr){rPr=make(node,a,'a:rPr');run.insertBefore(rPr,run.firstChild);}styles.push(rPr);}
    const end=child(p,'a','endParaRPr');if(end)styles.push(end);
    for(const style of styles){
      style.setAttribute('sz',String(Math.round(op.fontSizePt*100)));
      for(const name of ['latin','ea','cs']){let n=child(style,'a',name);if(!n){n=make(node,a,`a:${name}`);const later={latin:['ea','cs','sym','hlinkClick','hlinkMouseOver','rtl','extLst'],ea:['cs','sym','hlinkClick','hlinkMouseOver','rtl','extLst'],cs:['sym','hlinkClick','hlinkMouseOver','rtl','extLst']}[name];style.insertBefore(n,children(style).find(c=>later.includes(c.localName))??null);}n.setAttribute('typeface',op.fontFace);}
    }
  }
  return {shapeId:op.shape.id,styleMode:'explicit-local-override',paragraphs:paragraphs.length};
}

export function deleteShape(root,op) {
  const node=findShape(root,op.shape,null);
  const ids=new Set([node,...Array.from(node.getElementsByTagName('*'))].filter(n=>is(n,'p','cNvPr')).map(n=>attr(n,'id')));
  // The root shape's identity is below its non-visual node.
  if(!ids.size)throw new Error('SHAPE_ID_MISSING');
  for(const n of Array.from(root.getElementsByTagName('*'))){
    if(node===n||isDescendant(node,n))continue;
    if(ids.has(attr(n,'spid'))||(['stCxn','endCxn'].includes(n.localName)&&ids.has(attr(n,'id'))))throw new Error('SHAPE_STILL_REFERENCED');
  }
  node.parentNode.removeChild(node);
  return {shapeId:op.shape.id,removedIds:[...ids],resources:'Related media/relationships are retained; not secure erasure.'};
}
function isDescendant(parent,node){for(let p=node.parentNode;p;p=p.parentNode)if(p===parent)return true;return false;}
