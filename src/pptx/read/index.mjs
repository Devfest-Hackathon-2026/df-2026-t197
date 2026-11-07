import fs from 'node:fs/promises';
import { PptxPackage, DEFAULT_LIMITS } from '../package.mjs';
import { is, child, children, at, attr, attrs, relId, integer, bool } from '../xml.mjs';
import { readTheme } from './text.mjs';
import { readElements } from './shapes.mjs';

export async function readPptxFile(filePath, options = {}) {
  const stat = await fs.stat(filePath);
  if (!stat.isFile() || stat.size > (options.limits?.inputBytes ?? DEFAULT_LIMITS.inputBytes)) throw new Error('INPUT_SIZE_LIMIT_OR_NOT_FILE');
  return readPptx(await fs.readFile(filePath),options);
}

export async function readPptx(input, options = {}) {
  const pkg = await PptxPackage.open(input,options.limits);
  const main = await pkg.oneRelationship('','officeDocument',{required:true});
  if (!main) throw new Error('PRESENTATION_RELATIONSHIP_MISSING');
  const presentationPart = main.part;
  const presentationRoot = await pkg.xml(presentationPart);
  if (!is(presentationRoot,'p','presentation')) throw new Error('PRESENTATION_ROOT_INVALID');
  const contentTypesRoot = await pkg.xml('[Content_Types].xml');
  if (!is(contentTypesRoot,'ct','Types')) throw new Error('CONTENT_TYPES_ROOT_INVALID');
  const types = { defaults:Object.fromEntries(children(contentTypesRoot,'ct','Default').map(n => [attr(n,'Extension'),attr(n,'ContentType')])), overrides:{} };
  for (const n of children(contentTypesRoot,'ct','Override')) {
    try { types.overrides[pkg.resolve('',attr(n,'PartName'))] = attr(n,'ContentType'); }
    catch { pkg.issue('CONTENT_TYPE_PART_INVALID','[Content_Types].xml',attr(n,'PartName'),'error'); }
  }
  const contentType = part => types.overrides[part] ?? types.defaults[part.split('.').at(-1)] ?? null;
  const themes = new Map(), masters = new Map(), layouts = new Map(), notesMasters = new Map();
  const masterRoots = new Map(), layoutRoots = new Map();
  async function themeFor(part) {
    const rel = await pkg.oneRelationship(part,'theme');
    if (!rel) return null;
    if (!themes.has(rel.part)) {
      const root = await pkg.xml(rel.part);
      if (is(root,'a','theme')) themes.set(rel.part,{part:rel.part,...readTheme(root)});
      else pkg.issue('THEME_ROOT_INVALID',rel.part,'Expected theme','error');
    }
    return themes.get(rel.part) ?? null;
  }
  const relationshipById = async (source,id,kind) => {
    const matches = (await pkg.relationships(source)).filter(r => r.id === id);
    if (matches.length !== 1 || matches[0].kind !== kind || matches[0].external || !matches[0].exists) {
      pkg.issue('LIST_RELATIONSHIP_INVALID',source,{id,expected:kind},'error'); return null;
    }
    return matches[0];
  };
  async function loadMaster(part) {
    if (masters.has(part)) return masters.get(part);
    const root = await pkg.xml(part);
    if (!is(root,'p','sldMaster')) { pkg.issue('MASTER_ROOT_INVALID',part,'Expected slide master','error'); return null; }
    masterRoots.set(part,root);
    const theme = await themeFor(part);
    const item = {part,name:attr(child(root,'p','cSld'),'name'),themePart:theme?.part ?? null,colorMap:attrs(child(root,'p','clrMap')),layoutParts:[],relationships:await pkg.relationships(part),elements:[]};
    masters.set(part,item);
    item.elements = await readElements(pkg,{root,part,scope:'master',theme,masterRoot:root,masterPart:part,presentationRoot,presentationPart});
    for (const id of children(child(root,'p','sldLayoutIdLst'),'p','sldLayoutId')) {
      const rel = await relationshipById(part,relId(id),'slideLayout');
      if (rel) item.layoutParts.push({part:rel.part,id:attr(id,'id')});
    }
    return item;
  }
  async function loadLayout(part) {
    if (layouts.has(part)) return layouts.get(part);
    const root = await pkg.xml(part);
    if (!is(root,'p','sldLayout')) { pkg.issue('LAYOUT_ROOT_INVALID',part,'Expected slide layout','error'); return null; }
    layoutRoots.set(part,root);
    const masterRel = await pkg.oneRelationship(part,'slideMaster',{required:true});
    const master = masterRel ? await loadMaster(masterRel.part) : null;
    const theme = master ? themes.get(master.themePart) : null;
    const overrides = (await pkg.relationships(part)).filter(r => r.kind === 'themeOverride');
    if (overrides.length) pkg.issue('THEME_OVERRIDE_NOT_RESOLVED',part,'Override parts are listed but not applied to computed styles');
    const item = {part,name:attr(child(root,'p','cSld'),'name'),type:attr(root,'type'),masterPart:master?.part ?? null,themePart:theme?.part ?? null,attributes:attrs(root),colorMapOverride:children(child(root,'p','clrMapOvr')).map(n => ({kind:n.localName,attributes:attrs(n)})),relationships:await pkg.relationships(part),elements:[]};
    layouts.set(part,item);
    item.elements = await readElements(pkg,{root,part,scope:'layout',theme,masterRoot:masterRoots.get(master?.part),masterPart:master?.part,presentationRoot,presentationPart});
    return item;
  }
  const presentationRelationships = await pkg.relationships(presentationPart);
  const declaredMasterParts = [];
  for (const id of children(child(presentationRoot,'p','sldMasterIdLst'),'p','sldMasterId')) {
    const rel = await relationshipById(presentationPart,relId(id),'slideMaster');
    if (rel) { declaredMasterParts.push(rel.part); await loadMaster(rel.part); }
  }
  for (const master of [...masters.values()]) for (const layout of master.layoutParts) await loadLayout(layout.part);

  const slides = [], seenParts = new Set(), seenIds = new Set();
  const slideIds = children(child(presentationRoot,'p','sldIdLst'),'p','sldId');
  if (!slideIds.length) pkg.issue('NO_SLIDES_LISTED',presentationPart,'No slide entries found');
  for (let i = 0; i < slideIds.length; i++) {
    const idNode = slideIds[i], slideId = attr(idNode,'id'), rid = relId(idNode);
    const rel = await relationshipById(presentationPart,rid,'slide');
    if (seenIds.has(slideId)) pkg.issue('DUPLICATE_SLIDE_ID',presentationPart,slideId,'error');
    seenIds.add(slideId);
    if (!rel) { slides.push({page:i+1,slideId,relationshipId:rid,part:null,readStatus:'unreadable',elements:[]}); continue; }
    if (seenParts.has(rel.part)) pkg.issue('DUPLICATE_SLIDE_REFERENCE',presentationPart,rel.part,'error');
    seenParts.add(rel.part);
    const root = await pkg.xml(rel.part);
    if (!is(root,'p','sld')) { pkg.issue('SLIDE_ROOT_INVALID',rel.part,'Expected slide','error'); slides.push({page:i+1,slideId,relationshipId:rid,part:rel.part,readStatus:'unreadable',elements:[]}); continue; }
    const layoutRel = await pkg.oneRelationship(rel.part,'slideLayout',{required:true});
    const layout = layoutRel ? await loadLayout(layoutRel.part) : null;
    const master = layout ? masters.get(layout.masterPart) : null;
    const theme = master ? themes.get(master.themePart) : null;
    const relationships = await pkg.relationships(rel.part);
    if (relationships.some(r => r.kind === 'themeOverride')) pkg.issue('THEME_OVERRIDE_NOT_RESOLVED',rel.part,'Override parts are not applied to computed styles');
    const context = {root,part:rel.part,scope:'slide',layoutRoot:layoutRoots.get(layout?.part),layoutPart:layout?.part,masterRoot:masterRoots.get(master?.part),masterPart:master?.part,theme,presentationRoot,presentationPart};
    const elements = await readElements(pkg,context);
    const notesRel = await pkg.oneRelationship(rel.part,'notesSlide');
    let notes = null;
    if (notesRel) {
      const notesRoot = await pkg.xml(notesRel.part);
      const notesMasterRel = await pkg.oneRelationship(notesRel.part,'notesMaster');
      let notesMasterRoot = null;
      if (notesMasterRel) {
        notesMasterRoot = await pkg.xml(notesMasterRel.part);
        notesMasters.set(notesMasterRel.part,{part:notesMasterRel.part,relationships:await pkg.relationships(notesMasterRel.part)});
      }
      if (is(notesRoot,'p','notes')) {
        const noteElements = await readElements(pkg,{root:notesRoot,part:notesRel.part,scope:'notes',masterRoot:notesMasterRoot,masterPart:notesMasterRel?.part});
        notes = {part:notesRel.part,masterPart:notesMasterRel?.part ?? null,elements:noteElements,speakerText:noteElements.filter(e => e.placeholder?.type === 'body' || !e.placeholder).map(e => e.text?.text ?? '').filter(Boolean).join('\n'),styleResolution:'notes master text-style cascade is not fully resolved'};
      } else pkg.issue('NOTES_ROOT_INVALID',notesRel.part,'Expected notes','error');
    }
    const titleElements = elements.filter(e => ['title','ctrTitle'].includes(e.placeholder?.matchedLayoutType ?? e.placeholder?.type));
    slides.push({page:i+1,slideId,relationshipId:rid,part:rel.part,readStatus:'read',name:attr(child(root,'p','cSld'),'name'),hidden:bool(attr(root,'show')) === false,attributes:attrs(root),layoutPart:layout?.part ?? null,masterPart:master?.part ?? null,themePart:theme?.part ?? null,titleText:titleElements.map(e => e.text?.text ?? '').filter(Boolean).join('\n'),colorMapOverride:children(child(root,'p','clrMapOvr')).map(n => ({kind:n.localName,attributes:attrs(n)})),elements,notes,relationships});
  }
  const parts = await pkg.inventory();
  const unlistedSlideParts = parts.filter(p => contentType(p.part)?.endsWith('.slide+xml') && !seenParts.has(p.part)).map(p => p.part);
  if (unlistedSlideParts.length) pkg.issue('UNLISTED_SLIDE_PARTS',presentationPart,unlistedSlideParts);
  for (const m of masters.values()) if (!declaredMasterParts.includes(m.part)) pkg.issue('MASTER_NOT_IN_PRESENTATION_LIST',m.part,'Reached from a slide/layout but not declared in main master list');
  const flatten = values => values.flatMap(v => [v,...flatten(v.children ?? [])]);
  const allElements = slides.flatMap(s => flatten(s.elements));
  const counts = Object.fromEntries([...new Set(allElements.map(e => e.kind))].map(kind => [kind,allElements.filter(e => e.kind === kind).length]));
  const size = child(presentationRoot,'p','sldSz');
  return {
    readerVersion:1,readOnly:true,status:pkg.issues.some(i => i.severity === 'error') ? 'partial' : pkg.issues.length ? 'read-with-warnings' : 'read',
    source:{sha256:pkg.hash,bytes:pkg.bytes,presentationPart,contentType:contentType(presentationPart)},
    slideSize:{widthEmu:integer(attr(size,'cx')),heightEmu:integer(attr(size,'cy')),type:attr(size,'type')},
    summary:{listedSlides:slides.length,readSlides:slides.filter(s => s.readStatus === 'read').length,hiddenSlides:slides.filter(s => s.hidden).length,masters:masters.size,layouts:layouts.size,themes:themes.size,notesSlides:slides.filter(s => s.notes).length,elementKinds:counts},
    slides,masters:[...masters.values()],layouts:[...layouts.values()],themes:[...themes.values()],notesMasters:[...notesMasters.values()],
    presentationRelationships,contentTypes:types,parts:parts.map(p => ({...p,contentType:contentType(p.part)})),unlistedSlideParts,issues:pkg.issues,
    limitations:[
      'No rendering, OCR, native-math decoding, or content fact checking.',
      'Resolved text properties cover selected declared cascade layers only; visual font fallback, table styles, effects and complete Office style computation are not implemented.',
      'Theme overrides and color-map transformations are reported but are not applied to computed properties.',
      'Rotated/flipped group page bounds are not resolved; raw transforms remain available.',
      'Chart formulas and caches are indexed; embedded workbook values and equality are not verified.',
      'ZIP64, multidisk/encrypted archives and non-UTF8 ZIP member names are rejected.',
      'No XSD validation or guarantee that PowerPoint can open the input.'
    ]
  };
}
