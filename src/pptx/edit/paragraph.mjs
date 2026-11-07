import { child, children, descendants, is, NS, attr } from '../xml.mjs';
import { findShape } from './text.mjs';

// Compare declared character properties by namespace/attributes, not prefix spelling.
const signature=node=>JSON.stringify(node ? [
  Array.from(node.attributes).filter(a=>a.namespaceURI!=='http://www.w3.org/2000/xmlns/').map(a=>[a.namespaceURI,a.localName,a.value]).sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b))),
  children(node).map(n=>[n.namespaceURI,n.localName,signature(n)]),
  Array.from(node.childNodes).filter(n=>n.nodeType===3||n.nodeType===4).map(n=>n.data).join('')
] : [[],[],'']);

export function plainParagraphRuns(paragraph) {
  if(!paragraph) throw new Error('TARGET_NOT_FOUND: paragraph');
  const nodes=children(paragraph);
  if(nodes.some(n=>!['pPr','r','endParaRPr'].some(name=>is(n,'a',name)))) throw new Error('UNSUPPORTED_PARAGRAPH_CONTENT: fields, breaks, math or unknown children');
  const runs=children(paragraph,'a','r');
  if(runs.some(r=>children(r).some(n=>!['rPr','t'].some(name=>is(n,'a',name)))||children(r,'a','t').length!==1)) throw new Error('UNSUPPORTED_PARAGRAPH_CONTENT: non-text run');
  const hyperlinks=Array.from(paragraph.getElementsByTagName('*')).filter(n=>NS.a.includes(n.namespaceURI)&&['hlinkClick','hlinkHover','hlinkMouseOver'].includes(n.localName));
  if(hyperlinks.length) throw new Error('UNSUPPORTED_PARAGRAPH_CONTENT: hyperlink; use run edits to preserve links');
  return runs;
}

export function replaceParagraph(body, operation) {
  const paragraph=children(body,'a','p')[operation.paragraph];
  const runs=plainParagraphRuns(paragraph);
  if(runs.map(r=>child(r,'a','t').textContent).join('')!==operation.expectedText) throw new Error('STALE_TEXT');
  const explicit=Object.hasOwn(operation,'styleFromRun');
  if(explicit&&!runs[operation.styleFromRun]) throw new Error('TARGET_NOT_FOUND: style source run');
  const styles=runs.map(r=>child(r,'a','rPr'));
  if(!explicit&&new Set(styles.map(signature)).size>1) throw new Error('AMBIGUOUS_PARAGRAPH_STYLE: specify styleFromRun or use run edits');
  const chosen=styles[operation.styleFromRun ?? 0] ?? (runs.length===0 ? child(paragraph,'a','endParaRPr') : null);
  const doc=paragraph.ownerDocument,prefix=paragraph.prefix ? `${paragraph.prefix}:` : '';
  const run=doc.createElementNS(paragraph.namespaceURI,`${prefix}r`);
  if(chosen) {
    // endParaRPr uses the same character-property type; retain its properties on empty paragraphs.
    const properties=doc.createElementNS(paragraph.namespaceURI,`${prefix}rPr`);
    for(const a of Array.from(chosen.attributes)) properties.setAttributeNS(a.namespaceURI,a.name,a.value);
    for(const c of Array.from(chosen.childNodes)) properties.appendChild(c.cloneNode(true));
    run.appendChild(properties);
  }
  const text=doc.createElementNS(paragraph.namespaceURI,`${prefix}t`);text.textContent=operation.text;
  if(/^\s|\s$/.test(operation.text)) text.setAttributeNS('http://www.w3.org/XML/1998/namespace','xml:space','preserve');
  run.appendChild(text);
  for(const old of runs) paragraph.removeChild(old);
  paragraph.insertBefore(run,child(paragraph,'a','endParaRPr'));
  return {collapsedRuns:runs.length,styleResolution:explicit?'explicit-run':runs.length?'uniform-declared-style':'empty-paragraph-default',styleFromRun:explicit?operation.styleFromRun:null};
}

export function replaceShapeParagraph(root, operation) {
  return replaceParagraph(child(findShape(root,operation.shape),'p','txBody'),operation);
}

export function insertShapeParagraph(root, operation) {
  assertNoTextAnimation(root,operation.shape.id);
  const body=child(findShape(root,operation.shape),'p','txBody');
  const paragraphs=children(body,'a','p');
  if(!body||operation.paragraph>paragraphs.length) throw new Error('TARGET_NOT_FOUND: insertion position');
  const source=paragraphs[operation.styleFromParagraph];
  if(!source) throw new Error('TARGET_NOT_FOUND: source paragraph');
  const temporary=body.cloneNode(false),copy=source.cloneNode(true);
  temporary.appendChild(copy);
  const detail=replaceParagraph(temporary,{...operation,paragraph:0});
  body.insertBefore(copy,paragraphs[operation.paragraph]??null);
  return {...detail,styleFromParagraph:operation.styleFromParagraph};
}

export function deleteShapeParagraph(root, operation) {
  assertNoTextAnimation(root,operation.shape.id);
  const body=child(findShape(root,operation.shape),'p','txBody'),paragraphs=children(body,'a','p');
  const paragraph=paragraphs[operation.paragraph],runs=plainParagraphRuns(paragraph);
  if(runs.map(r=>child(r,'a','t').textContent).join('')!==operation.expectedText) throw new Error('STALE_TEXT');
  if(paragraphs.length===1) throw new Error('LAST_PARAGRAPH_REQUIRED: clear its text instead');
  body.removeChild(paragraph);
  return {removedParagraph:operation.paragraph};
}

function assertNoTextAnimation(root, shapeId) {
  if(descendants(root,'p','spTgt').some(n=>attr(n,'spid')===shapeId&&descendants(n,'p','txEl').length)) throw new Error('UNSUPPORTED_PARAGRAPH_ANIMATION: text ranges require explicit remapping');
}
