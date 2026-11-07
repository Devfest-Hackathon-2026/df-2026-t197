import { child, children, attr } from '../xml.mjs';
const sectionNamespace='http://schemas.microsoft.com/office/powerpoint/2010/main';
export function sectionGroups(root) {
  const lists=Array.from(root.getElementsByTagName('*')).filter(n=>n.localName==='sectionLst');
  if(!lists.length) return [];
  if(lists.length!==1||lists[0].namespaceURI!==sectionNamespace) throw new Error('UNSUPPORTED_EDIT: section format');
  const entries=[],groups=[];
  for(const section of children(lists[0])) {
    if(section.namespaceURI!==sectionNamespace||section.localName!=='section') throw new Error('INVALID_SECTION_STRUCTURE');
    const list=children(section).find(n=>n.namespaceURI===sectionNamespace&&n.localName==='sldIdLst');
    if(!list) throw new Error('INVALID_SECTION_STRUCTURE');
    const group={section,list,entries:[]};groups.push(group);
    for(const node of children(list)) {
      if(node.namespaceURI!==sectionNamespace||node.localName!=='sldId') throw new Error('INVALID_SECTION_STRUCTURE');
      entries.push(node);
      group.entries.push(node);
    }
  }
  const pageIds=children(child(root,'p','sldIdLst'),'p','sldId').map(n=>attr(n,'id'));
  if(JSON.stringify(entries.map(n=>attr(n,'id')))!==JSON.stringify(pageIds)) throw new Error('INVALID_SECTION_MEMBERSHIP');
  return groups;
}
export function sectionInsertionPoint(root, afterId) {
  const groups=sectionGroups(root);
  if(!groups.length)return null;
  const entries=groups.flatMap(g=>g.entries);
  const anchor=entries.find(n=>attr(n,'id')===afterId);
  if(!anchor) throw new Error('INVALID_SECTION_MEMBERSHIP');
  return anchor;
}
export function reorderSectionSlides(root, orderedIds) {
  let cursor=0;
  const actions=[];
  for(const group of sectionGroups(root)) {
    const nodes=new Map(group.entries.map(n=>[attr(n,'id'),n]));
    const block=orderedIds.slice(cursor,cursor+nodes.size);cursor+=nodes.size;
    if(block.some(id=>!nodes.has(id)))throw new Error('UNSUPPORTED_SECTION_REORDER: keep existing section membership and boundaries');
    actions.push(()=>{for(const id of block)group.list.appendChild(nodes.get(id));});
  }
  for(const apply of actions)apply();
}
export function insertSectionSlide(anchor, id) {
  if(!anchor) return;
  const entry=anchor.cloneNode(false);entry.setAttribute('id',id);
  anchor.parentNode.insertBefore(entry,anchor.nextSibling);
}
