import { child, children, at, is } from '../xml.mjs';
import { topShapes, shapeIdentity } from '../read/shapes.mjs';

export function findShape(root, target, kind='sp') {
  let candidates=topShapes(root);
  for(const id of target.parents) {
    const matches=candidates.filter(n=>is(n,'p','grpSp') && shapeIdentity(n).id===id);
    if(matches.length!==1) throw new Error('TARGET_NOT_FOUND_OR_AMBIGUOUS: parent group');
    candidates=children(matches[0],'p').filter(n=>!['nvGrpSpPr','grpSpPr','extLst'].includes(n.localName));
  }
  const matches=candidates.filter(n=>(kind ? is(n,'p',kind) : is(n,'p',n.localName)) && shapeIdentity(n).id===target.id);
  if(matches.length!==1) throw new Error('TARGET_NOT_FOUND_OR_AMBIGUOUS: text shape');
  return matches[0];
}

export function replaceRunText(root, operation) {
  const paragraph=children(at(findShape(root,operation.shape),['p','txBody']),'a','p')[operation.paragraph];
  if(!paragraph) throw new Error('TARGET_NOT_FOUND: paragraph');
  // Same run numbering as the index, including fields and breaks. Only plain runs are editable.
  const runs=children(paragraph).filter(n=>['r','fld','br'].some(name=>is(n,'a',name)));
  const run=runs[operation.run];
  if(!is(run,'a','r')) throw new Error('UNSUPPORTED_EDIT: field, break or missing run');
  const texts=children(run,'a','t');
  if(texts.length!==1) throw new Error('UNSUPPORTED_EDIT: ambiguous text node');
  if(texts[0].textContent!==operation.expectedText) throw new Error('STALE_TEXT');
  texts[0].textContent=operation.text;
  // Preserve leading/trailing spaces explicitly without touching run formatting.
  if(/^\s|\s$/.test(operation.text)) texts[0].setAttributeNS('http://www.w3.org/XML/1998/namespace','xml:space','preserve');
}
