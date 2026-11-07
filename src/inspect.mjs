import { PptxPackage } from './pptx/package.mjs';
import { readPptx } from './pptx/read/index.mjs';
import { descendants } from './pptx/xml.mjs';

export async function inspectPptx(buffer) {
  const errors = [];
  let pkg, index;
  try {
    pkg = await PptxPackage.open(buffer);
    for (const { part } of await pkg.inventory()) {
      if (/\.(xml|rels)$/i.test(part)) await pkg.xml(part);
      if (part.endsWith('.rels')) {
        const source = part === '_rels/.rels' ? '' : part.replace(/(?:^|\/)\_rels\//, '/').replace(/^\//, '').slice(0, -5);
        await pkg.relationships(source);
      }
    }
    index = await readPptx(buffer);
    errors.push(...pkg.issues.filter(i => i.severity === 'error').map(i => `${i.code}: ${i.part}`));
    errors.push(...index.issues.filter(i => i.severity === 'error').map(i => `${i.code}: ${i.part}`));
  } catch (error) { errors.push(error.message); }
  let nativeTables = 0;
  for (const slide of index?.slides ?? []) if (slide.part) {
    const root = await pkg.xml(slide.part);
    nativeTables += root ? descendants(root, 'a', 'tbl').length : 0;
  }
  const parts = index?.parts ?? [];
  const countType = suffix => parts.filter(p => p.contentType?.endsWith(suffix)).length;
  return {
    status: errors.length ? 'failed' : 'passed',
    scope: 'Bounded ZIP/CRC, XML characters/parsing, relationships and listed slide structure; not XSD/visual/Office validation. Resource counts include retained unused parts.',
    errors: [...new Set(errors)], slides: index?.slides.length ?? 0,
    hiddenSlides: index?.summary.hiddenSlides ?? 0,
    unlistedSlideParts: index?.unlistedSlideParts ?? [], nativeTables,
    nativeCharts: countType('drawingml.chart+xml'),
    embeddedWorkbooks: parts.filter(p => p.contentType === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet').length,
    masters: countType('presentationml.slideMaster+xml'),
    layouts: countType('presentationml.slideLayout+xml')
  };
}
