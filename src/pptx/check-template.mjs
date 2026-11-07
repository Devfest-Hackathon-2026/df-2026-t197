import {isDeepStrictEqual as equal} from 'node:util';
import Ajv from 'ajv';
import {relationshipPart} from './edit/duplicate.mjs';

const partName = {type:'string', minLength:1, maxLength:1024};
const id = {type:'string', pattern:'^[0-9]+$'};
const idx = {type:'integer', minimum:0, maximum:4294967295};
const pageNumber = {type:'integer', minimum:1};
const validate = new Ajv({strict:true}).compile({
  type:'object', additionalProperties:false, required:['baseline','exceptions'],
  properties:{
    baseline:{oneOf:[
      {type:'object', additionalProperties:false, required:['layoutPart','titleIdx','bodyIdx'],
        properties:{layoutPart:partName, titleIdx:idx, bodyIdx:idx}},
      {type:'object', additionalProperties:false, required:['slideId','titleShapeId','bodyShapeId'],
        properties:{slideId:id, titleShapeId:id, bodyShapeId:id}}
    ]},
    exceptions:{type:'array', maxItems:1000, items:{
      type:'object', additionalProperties:false, required:['page','reason'],
      properties:{page:pageNumber, reason:{type:'string', minLength:1, maxLength:500, pattern:'\\S'}}
    }},
    assets:{type:'array', maxItems:1000, items:{
      type:'object', additionalProperties:false, required:['page','sha256'],
      properties:{page:pageNumber,sha256:{type:'string',pattern:'^[0-9a-f]{64}$'}}
    }}
  }
});

const titleTypes = new Set(['title','ctrTitle']);
const bodyTypes = new Set(['body','obj','vertBody','vertObj']);
const fontKeys = ['fontSizePt','latinFont','eastAsianFont','complexScriptFont'];
const layoutMatch = (shapes, idx) => shapes.filter(shape => shape.placeholder?.idx === idx);
const idMatch = (shapes, id) => shapes.filter(shape => shape.id === id);
const textRuns = shape => shape.text.paragraphs.flatMap(p => p.runs.filter(run => run.kind === 'text' && run.text.trim()));
const hasBounds = shape => {
  const bounds = shape?.geometry?.pageBounds;
  return bounds && bounds.width > 0 && bounds.height > 0;
};

function templateParts(source) {
  const inventory = new Map(source.parts.map(part => [part.part,part]));
  const protectedParts = new Set();
  for (const item of [...source.masters,...source.layouts,...source.themes]) {
    protectedParts.add(item.part);
    const rels = relationshipPart(item.part);
    if (inventory.has(rels)) protectedParts.add(rels);
    for (const rel of item.relationships ?? []) {
      if (!rel.external && rel.exists) protectedParts.add(rel.part);
    }
  }
  return [...protectedParts].map(part => inventory.get(part));
}

function hasLocalLayoutOverride(shape) {
  const hasFontOverride = style => fontKeys.some(key => Object.hasOwn(style,key));
  return shape.transform !== null || shape.styleReferences.length > 0 ||
    Boolean(shape.text.autoFit) || Object.keys(shape.text.bodyProperties).some(key => !key.startsWith('xmlns')) ||
    shape.text.listDefaults.length > 0 || shape.text.paragraphs.some(p =>
      p.bullet || Object.keys(p.properties).some(key => key !== 'lvl' && !key.startsWith('xmlns')) ||
      hasFontOverride(p.defaultRunStyle) || hasFontOverride(p.endRunStyle) ||
      p.runs.some(run => hasFontOverride(run.direct)));
}

function cloneTextProfileMatches(source, output) {
  const formatOf = run => fontKeys.map(key => run.resolved[key]?.value ?? null);
  const formats = textRuns(source).map(formatOf);
  return equal(source.placeholder,output.placeholder) &&
    equal(source.transform,output.transform) &&
    equal(source.styleReferences,output.styleReferences) &&
    equal(source.text.bodyProperties,output.text.bodyProperties) &&
    equal(source.text.autoFit,output.text.autoFit) &&
    equal(source.text.listDefaults,output.text.listDefaults) &&
    textRuns(output).every(run => formats.some(format => equal(format,formatOf(run))));
}

// A new presentation using a template. Partial edits use their existing preservation report.
export function checkTemplate(source, output, review) {
  if (!validate(review)) throw new Error(`INVALID_TEMPLATE_REVIEW: ${JSON.stringify(validate.errors)}`);
  const issues = [];
  if (source.status === 'partial' || output.status === 'partial') issues.push({code:'PPTX_READ_PARTIAL'});
  if (!equal(source.slideSize,output.slideSize)) issues.push({code:'SLIDE_SIZE_CHANGED'});
  const layouts = new Map(source.layouts.map(layout => [layout.part,layout]));
  const outputParts = new Map(output.parts.map(part => [part.part,part]));
  const protectedParts = templateParts(source);
  for (const part of protectedParts) {
    const actual = outputParts.get(part.part);
    if (!actual || actual.sha256 !== part.sha256 || actual.contentType !== part.contentType) {
      issues.push({code:'TEMPLATE_PART_CHANGED_OR_MISSING',part:part.part});
    }
  }
  for (const part of output.unlistedSlideParts) issues.push({code:'UNLISTED_SLIDE',part});

  const {baseline,exceptions,assets=[]} = review;
  const pages = new Map(output.slides.map(slide => [slide.page,slide]));
  const exceptionPages = new Set(exceptions.map(item => item.page));
  if (exceptionPages.size !== exceptions.length || exceptions.some(item => !pages.has(item.page))) {
    throw new Error('INVALID_TEMPLATE_REVIEW: duplicate or out-of-range exception page');
  }
  const fromLayout = Object.hasOwn(baseline,'layoutPart');
  const reference = fromLayout ? layouts.get(baseline.layoutPart) : source.slides.find(s => s.slideId === baseline.slideId);
  const layoutPart = fromLayout ? baseline.layoutPart : reference?.layoutPart;
  const roles = fromLayout ? [['title',baseline.titleIdx],['body',baseline.bodyIdx]] :
    [['title',baseline.titleShapeId],['body',baseline.bodyShapeId]];
  const match = fromLayout ? layoutMatch : idMatch;
  if (!reference || !layouts.has(layoutPart) || roles[0][1] === roles[1][1] ||
      (fromLayout && ['title','secHead','blank','titleOnly'].includes(reference.type))) {
    throw new Error('INVALID_TEMPLATE_BASELINE: choose a source body layout or slide with distinct title and body frames');
  }
  const frames = roles.map(([role,key]) => {
    const [shape,...duplicates] = match(reference.elements,key);
    const types = role === 'title' ? titleTypes : bodyTypes;
    if (duplicates.length || shape?.kind !== 'shape' || !shape.text || !hasBounds(shape) ||
        (fromLayout ? !types.has(shape.placeholder?.type) : textRuns(shape).length === 0)) {
      throw new Error(`INVALID_TEMPLATE_BASELINE: ${role} frame ${key}`);
    }
    return {role,key,shape};
  });

  const checkedBodyPages = [];
  for (const slide of output.slides) {
    const page = slide.page;
    const sourceLayout = layouts.get(slide.layoutPart);
    if (!sourceLayout || slide.masterPart !== sourceLayout.masterPart || slide.themePart !== sourceLayout.themePart) {
      issues.push({code:'SLIDE_TEMPLATE_LINK_CHANGED',page,layoutPart:slide.layoutPart});
    }
    if (slide.hidden) issues.push({code:'HIDDEN_SLIDE',page});
    if (exceptionPages.has(page)) continue;
    checkedBodyPages.push(page);
    if (slide.layoutPart !== layoutPart) {
      issues.push({code:'BODY_LAYOUT_MISMATCH',page,expected:layoutPart,actual:slide.layoutPart});
      continue;
    }
    for (const {role,key,shape:expected} of frames) {
      const [shape,...duplicates] = match(slide.elements,key);
      if (duplicates.length || shape?.kind !== 'shape' || !shape.text || textRuns(shape).length === 0) {
        issues.push({code:'BODY_FRAME_MISSING_OR_EMPTY',page,role,key});
        continue;
      }
      if (!equal(shape.geometry.pageBounds,expected.geometry.pageBounds)) {
        issues.push({code:'BODY_FRAME_GEOMETRY_MISMATCH',page,role,key});
      }
      if (fromLayout) {
        const linked = shape.placeholder?.type === expected.placeholder.type && shape.inheritance.some(
          item => item.scope === 'layout' && item.part === layoutPart && item.shapeId === expected.id
        );
        if (!linked) issues.push({code:'BODY_FRAME_LAYOUT_LINK_MISSING',page,role,key});
        if (hasLocalLayoutOverride(shape)) issues.push({code:'BODY_FRAME_LOCAL_OVERRIDE',page,role,key});
      } else if (!cloneTextProfileMatches(expected,shape)) {
        issues.push({code:'CLONED_FRAME_FORMAT_MISMATCH',page,role,key});
      }
    }
  }
  if (checkedBodyPages.length === 0) issues.push({code:'NO_BODY_PAGES_CHECKED'});
  for (const {page,sha256} of assets) {
    const found = pages.get(page)?.elements.some(shape => {
      const image = shape.image?.source;
      return shape.image?.embedId && image?.kind === 'image' && image.exists && !image.external &&
        outputParts.get(image.part)?.sha256 === sha256;
    });
    if (!found) issues.push({code:'EXPECTED_ASSET_MISSING',page,sha256});
  }
  return {
    status:issues.length ? 'failed' : 'passed',
    sourceSha256:source.source.sha256, outputSha256:output.source.sha256,
    baseline, checkedBodyPages, exceptions, checkedTemplateParts:protectedParts.length, checkedAssets:assets.length,
    issues, rendering:'not-run',
    scope:'Template part hashes, slide links, selected declared text-frame geometry and formatting, and planned top-level image hashes. PowerPoint rendering and content accuracy require separate review.'
  };
}
