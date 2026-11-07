import JSZip from 'jszip';
import { DOMParser, XMLSerializer } from '@xmldom/xmldom';

// Apply only to packages authored by this generator. Generic imported PPTX editing
// is deliberately not implemented here: user-authored rich text must be preserved.
export async function restorePlaceholderInheritance(buffer) {
  const zip = await JSZip.loadAsync(buffer);
  for (const name of Object.keys(zip.files).filter(n => /^ppt\/slides\/slide\d+\.xml$/.test(n))) {
    const doc = new DOMParser().parseFromString(await zip.file(name).async('string'), 'application/xml');
    for (const shape of Array.from(doc.getElementsByTagName('p:sp'))) {
      const ph = shape.getElementsByTagName('p:ph')[0];
      if (!ph || !['title', 'body'].includes(ph.getAttribute('type')) || !['100', '101'].includes(ph.getAttribute('idx'))) continue;
      for (const tag of ['a:rPr', 'a:defRPr', 'a:endParaRPr']) {
        for (const style of Array.from(shape.getElementsByTagName(tag))) {
          for (const attr of Array.from(style.attributes)) style.removeAttribute(attr.name);
          while (style.firstChild) style.removeChild(style.firstChild);
          style.setAttribute('lang', 'ja-JP');
        }
      }
      const transform = shape.getElementsByTagName('a:xfrm')[0];
      if (transform) transform.parentNode.removeChild(transform);
    }
    zip.file(name, new XMLSerializer().serializeToString(doc));
  }
  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
}
