import path from 'node:path';
import {resolveImage} from '../../renderer.mjs';
import {findShape} from './text.mjs';
import {at,child,children,attr,NS,parseXml} from '../xml.mjs';
import {nextShapeId} from './shape.mjs';
import {relationshipPart} from './duplicate.mjs';
import {setShapePosition} from './format.mjs';

export async function addImage(state,target,root,op,size) {
  const frame=op.box;
  if(frame.xEmu+frame.widthEmu>size.widthEmu||frame.yEmu+frame.heightEmu>size.heightEmu)throw new Error('SHAPE_OUTSIDE_SLIDE');
  const id=String(nextShapeId(root)),p=root.namespaceURI,a=NS.a[NS.p.indexOf(p)];
  const picture=parseXml(
    `<p:pic xmlns:p="${p}" xmlns:a="${a}"><p:nvPicPr><p:cNvPr id="${id}" name="Added picture ${id}"/><p:cNvPicPr><a:picLocks noChangeAspect="1"/></p:cNvPicPr><p:nvPr/></p:nvPicPr><p:blipFill><a:blip/></p:blipFill><p:spPr><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr></p:pic>`,
    'new-picture'
  );
  const tree=at(root,['p','cSld'],['p','spTree']);
  if(!tree)throw new Error('SLIDE_TREE_MISSING');
  tree.insertBefore(root.ownerDocument.importNode(picture,true),child(tree,'p','extLst'));
  const {sharedOriginalAsset,...result}=await replaceImage(state,target,root,{...op,shape:{id,parents:[]}},size);
  return result;
}

export async function replaceImage(state,target,root,op,size){
  if(op.shape.parents.length)throw new Error('UNSUPPORTED_IMAGE: grouped placement');
  const pic=findShape(root,op.shape,'pic'),fill=child(pic,'p','blipFill'),blip=child(fill,'a','blip');
  const effects=children(blip);
  const identityAlpha=n=>NS.a.includes(n.namespaceURI)&&n.localName==='alphaModFix'&&children(n).length===0&&Array.from(n.attributes).every(a=>a.namespaceURI==='http://www.w3.org/2000/xmlns/'||(a.name==='amt'&&a.value==='100000'));
  if(!blip||effects.some(n=>!identityAlpha(n))||children(fill).some(n=>!['blip','srcRect','stretch'].includes(n.localName)))throw new Error('UNSUPPORTED_IMAGE: effects, tiling or compatibility');
  const image=await resolveImage({id:op.shape.id,data:op.data},undefined,false);
  const bytes=Buffer.from(image.data.split(',')[1],'base64'),ext=op.data.startsWith('data:image/png;')?'png':'jpeg';
  const directory=path.posix.join(path.posix.dirname(state.presentationPart),'media');let i=1,part;
  do{part=path.posix.join(directory,`replacement${i++}.${ext}`);}while(state.has(part));
  const relsPart=relationshipPart(target.part),rels=await state.xml(relsPart);
  const ids=new Set(children(rels,'rel','Relationship').map(n=>attr(n,'Id')));i=1;while(ids.has(`rIdImage${i}`))i++;
  const rid=`rIdImage${i}`,r=NS.r[NS.p.indexOf(root.namespaceURI)];
  const rel=rels.ownerDocument.createElementNS(NS.rel[0],'Relationship');rel.setAttribute('Id',rid);rel.setAttribute('Type',`${r}/image`);rel.setAttribute('Target',path.posix.relative(path.posix.dirname(target.part),part));rels.appendChild(rel);
  for(const n of Array.from(blip.attributes))if(NS.r.includes(n.namespaceURI)&&['link','embed'].includes(n.localName))blip.removeAttributeNode(n);
  blip.setAttributeNS(r,'r:embed',rid);
  const nv=at(pic,['p','nvPicPr'],['p','cNvPr']);if(nv)nv.setAttribute('descr',op.alt??'');
  const a=NS.a[NS.p.indexOf(root.namespaceURI)];
  for(const n of children(fill).filter(n=>['srcRect','stretch'].includes(n.localName)))fill.removeChild(n);
  const stretch=fill.ownerDocument.createElementNS(a,'a:stretch');stretch.appendChild(fill.ownerDocument.createElementNS(a,'a:fillRect'));fill.appendChild(stretch);
  const frame=op.box,ratio=image.pixelWidth/image.pixelHeight;
  const w=Math.min(frame.widthEmu,frame.heightEmu*ratio),h=w/ratio;
  if(Math.round(w)<1||Math.round(h)<1)throw new Error('IMAGE_BOX_TOO_SMALL');
  setShapePosition(root,{shape:op.shape,xEmu:Math.round(frame.xEmu+(frame.widthEmu-w)/2),yEmu:Math.round(frame.yEmu+(frame.heightEmu-h)/2),widthEmu:Math.round(w),heightEmu:Math.round(h)},size);
  state.put(part,bytes,'replacement-image');state.registerContentType(part,`image/${ext}`);state.putXml(relsPart,rels,'replacement-image-reference');
  return {shapeId:op.shape.id,assetPart:part,fit:'contain',sharedOriginalAsset:'preserved'};
}
