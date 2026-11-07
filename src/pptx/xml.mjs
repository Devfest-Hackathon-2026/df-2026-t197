import { DOMParser } from '@xmldom/xmldom';
import { assertXmlText } from '../xml-text.mjs';

export const NS = {
  p: ['http://schemas.openxmlformats.org/presentationml/2006/main', 'http://purl.oclc.org/ooxml/presentationml/main'],
  a: ['http://schemas.openxmlformats.org/drawingml/2006/main', 'http://purl.oclc.org/ooxml/drawingml/main'],
  r: ['http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'http://purl.oclc.org/ooxml/officeDocument/relationships'],
  c: ['http://schemas.openxmlformats.org/drawingml/2006/chart', 'http://purl.oclc.org/ooxml/drawingml/chart'],
  rel: ['http://schemas.openxmlformats.org/package/2006/relationships'],
  ct: ['http://schemas.openxmlformats.org/package/2006/content-types']
};
export function is(node, family, local) { return Boolean(node && node.nodeType === 1 && NS[family]?.includes(node.namespaceURI) && node.localName === local); }
export function children(node, family, local) { return Array.from(node?.childNodes ?? []).filter(n => n.nodeType === 1 && (!family || (NS[family]?.includes(n.namespaceURI) && (!local || n.localName === local)))); }
export const child = (node, family, local) => children(node, family, local)[0] ?? null;
export function descendants(node, family, local) {
  if (!node) return [];
  return Array.from(node.getElementsByTagNameNS('*', local)).filter(n => NS[family]?.includes(n.namespaceURI));
}
export function at(node, ...steps) { return steps.reduce((n, [family, local]) => child(n, family, local), node); }
export function attr(node, name) { return node?.hasAttribute(name) ? node.getAttribute(name) : null; }
export function relId(node, name = 'id') { for (const uri of NS.r) if (node?.hasAttributeNS(uri, name)) return node.getAttributeNS(uri, name); return null; }
export function integer(value) { if (value === null || !/^-?\d+$/.test(value)) return null; const n = Number(value); return Number.isSafeInteger(n) ? n : null; }
export function bool(value) { return ['1', 'true', 'on'].includes(value) ? true : ['0', 'false', 'off'].includes(value) ? false : null; }
export function attrs(node) { return node ? Object.fromEntries(Array.from(node.attributes).map(a => [a.name, a.value])) : {}; }

export function parseXml(xml, part) {
  assertXmlText(xml);
  if (/<!DOCTYPE|<!ENTITY/i.test(xml)) throw new Error(`DTD_NOT_SUPPORTED: ${part}`);
  const errors = [];
  let doc;
  try { doc = new DOMParser({ onError: (level, message) => { if (level !== 'warning') errors.push(message); } }).parseFromString(xml, 'application/xml'); }
  catch { throw new Error(`INVALID_XML: ${part}`); }
  if (errors.length || !doc?.documentElement) throw new Error(`INVALID_XML: ${part}`);
  let count = 0; const stack = [[doc.documentElement, 0]];
  while (stack.length) {
    const [node, depth] = stack.pop();
    for (const a of Array.from(node.attributes ?? [])) assertXmlText(a.value);
    for (const c of Array.from(node.childNodes ?? [])) if (c.nodeType === 3 || c.nodeType === 4) assertXmlText(c.data);
    if (++count > 300000 || depth > 128) throw new Error(`XML_COMPLEXITY_LIMIT: ${part}`);
    for (const c of children(node)) stack.push([c, depth + 1]);
  }
  return doc.documentElement;
}
