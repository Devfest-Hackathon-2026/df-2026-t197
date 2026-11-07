import { child, children, descendants, at, attr, attrs, relId, integer, bool, NS } from '../xml.mjs';
import { transform, resolveBounds } from './geometry.mjs';
import { readTextBody } from './text.mjs';

function nonVisual(node) { return children(node).find(n => NS.p.includes(n.namespaceURI) && /^nv.*Pr$/.test(n.localName)) ?? null; }
export function shapeIdentity(node) {
  const nv = nonVisual(node), cnv = child(nv,'p','cNvPr'), ph = at(nv,['p','nvPr'],['p','ph']);
  return { id:attr(cnv,'id'),name:attr(cnv,'name'),description:attr(cnv,'descr'),title:attr(cnv,'title'),placeholder:ph ? { type:attr(ph,'type') ?? 'obj',idx:integer(attr(ph,'idx')) ?? 0,declaredType:attr(ph,'type'),declaredIdx:attr(ph,'idx'),attributes:attrs(ph) } : null };
}
const shapeChildren = node => children(node).filter(n => !(NS.p.includes(n.namespaceURI) && ['nvGrpSpPr','grpSpPr','extLst'].includes(n.localName)));
export function topShapes(root) { return shapeChildren(at(root,['p','cSld'],['p','spTree'])); }

function matchPlaceholder(root, target, mode, pkg, part) {
  if (!root || !target) return null;
  const matches = topShapes(root).filter(node => {
    const ph = shapeIdentity(node).placeholder;
    return ph && (mode === 'idx' ? ph.idx === target.idx : ph.type === target.type);
  });
  if (matches.length > 1) { pkg.issue('AMBIGUOUS_PLACEHOLDER',part,{mode,placeholder:target},'error'); return null; }
  return matches[0] ?? null;
}
const sourceOf = (scope, part, node) => ({scope,part,shapeId:shapeIdentity(node).id});

async function chartData(pkg, part) {
  const root = await pkg.xml(part); if (!root) return null;
  const charts = descendants(root,'c','plotArea').flatMap(n => children(n).filter(c => NS.c.includes(c.namespaceURI) && /Chart$/.test(c.localName)));
  const series = [];
  const cached = container => {
    if (!container) return null;
    const formula = descendants(container,'c','f')[0]?.textContent ?? null;
    const caches = children(container).flatMap(n => ['strCache','numCache','strLit','numLit'].includes(n.localName) ? [n] : children(n).filter(c => ['strCache','numCache','strLit','numLit'].includes(c.localName)));
    return { formula, literal:child(container,'c','v')?.textContent ?? null, caches:caches.map(cache => ({ kind:cache.localName,declaredCount:integer(attr(child(cache,'c','ptCount'),'val')),points:children(cache,'c','pt').map(p => ({index:integer(attr(p,'idx')),value:child(p,'c','v')?.textContent ?? null})) })), multilevelLabels:descendants(container,'c','multiLvlStrCache').length > 0 };
  };
  for (const chart of charts) for (const ser of children(chart,'c','ser')) series.push({ chartType:chart.localName,index:integer(attr(child(ser,'c','idx'),'val')),order:integer(attr(child(ser,'c','order'),'val')),name:cached(child(ser,'c','tx')),categories:cached(child(ser,'c','cat') ?? child(ser,'c','xVal')),values:cached(child(ser,'c','val') ?? child(ser,'c','yVal')),bubbleSize:cached(child(ser,'c','bubbleSize')) });
  return { part,chartTypes:charts.map(n => n.localName),series,relationships:await pkg.relationships(part),embeddedDataValidation:'not-run',scope:'formulas and cached values only; workbook contents and data equality are not evaluated' };
}

export async function readElements(pkg, context) {
  const relationships = await pkg.relationships(context.part);
  const relation = id => relationships.find(r => r.id === id) ?? null;
  const ids = new Set();
  async function read(node, parentIds = [], groups = [], sequence = 0) {
    const identity = shapeIdentity(node);
    if (identity.id && ids.has(identity.id)) pkg.issue('DUPLICATE_SHAPE_ID',context.part,identity.id,'error');
    if (identity.id) ids.add(identity.id);
    const ph = identity.placeholder;
    const layoutNode = context.scope === 'slide' ? matchPlaceholder(context.layoutRoot,ph,'idx',pkg,context.layoutPart) : null;
    const layoutPh = layoutNode ? shapeIdentity(layoutNode).placeholder : ph;
    const masterNode = context.scope === 'master' ? null : matchPlaceholder(context.masterRoot,layoutPh,'type',pkg,context.masterPart);
    const chain = [
      layoutNode ? {node:layoutNode,source:sourceOf('layout',context.layoutPart,layoutNode)} : null,
      masterNode ? {node:masterNode,source:sourceOf('master',context.masterPart,masterNode)} : null
    ].filter(Boolean);
    if (ph && context.scope === 'slide' && context.layoutRoot && !layoutNode && ph.idx !== 4294967295) pkg.issue('PLACEHOLDER_LAYOUT_MATCH_MISSING',context.part,{shapeId:identity.id,idx:ph.idx});
    const directTransform = transform(node);
    const rawType = node.localName;
    const base = { ...identity,placeholder:ph ? {...ph,matchedLayoutType:layoutNode ? layoutPh.type : null} : null,order:sequence,parentIds,kind:rawType,part:context.part,transform:directTransform,inheritance:chain.map(c => c.source),geometry:resolveBounds([{transform:directTransform,source:sourceOf(context.scope,context.part,node)},...chain.map(c => ({transform:transform(c.node),source:c.source}))],groups) };
    base.xmlElement = { namespace:node.namespaceURI,localName:rawType };
    if (!NS.p.includes(node.namespaceURI)) {
      base.kind = 'unsupported-element';
      pkg.issue('SHAPE_CONTENT_NOT_DECODED',context.part,base.xmlElement);
      return base;
    }
    const textContext = { ...context,shapeId:identity.id,chain,placeholderType:layoutPh?.type ?? ph?.type };
    const body = child(node,'p','txBody');
    base.text = readTextBody(body,textContext);
    base.hasMath = node.getElementsByTagNameNS('http://schemas.openxmlformats.org/officeDocument/2006/math','oMath').length > 0;
    base.styleReferences = children(child(node,'p','style')).map(n => ({kind:n.localName,attributes:attrs(n)}));
    base.relationshipReferences = [];
    for (const item of [node,...Array.from(node.getElementsByTagName('*'))]) for (const a of Array.from(item.attributes ?? [])) {
      if (NS.r.includes(a.namespaceURI) && ['id','embed','link'].includes(a.localName)) {
        const action = attr(item,'action');
        // PowerPoint media/relative-navigation actions need no relationship ID.
        const intrinsicAction = NS.a.includes(item.namespaceURI) && ['hlinkClick','hlinkHover'].includes(item.localName) && /^(ppaction:\/\/(media|noaction)$|ppaction:\/\/hlinkshowjump\?jump=(firstslide|lastslide|lastslideviewed|nextslide|previousslide|endshow)$)/.test(action ?? '');
        const rel = relation(a.value);
        base.relationshipReferences.push({attribute:a.localName,id:a.value,action,relationship:rel,intrinsicAction:Boolean(!a.value && intrinsicAction)});
        if (!a.value && intrinsicAction) continue;
        if (!rel) pkg.issue('SHAPE_RELATIONSHIP_MISSING',context.part,{shapeId:identity.id,id:a.value},'error');
      }
    }
    if (rawType === 'grpSp') {
      base.kind = 'group'; base.children = [];
      for (const item of shapeChildren(node)) base.children.push(await read(item,[...parentIds,identity.id],[...groups,directTransform],base.children.length));
    } else if (rawType === 'pic') {
      const blip = at(node,['p','blipFill'],['a','blip']);
      base.kind = 'image'; base.image = { embedId:relId(blip,'embed'),linkId:relId(blip,'link'),source:relation(relId(blip,'embed') ?? relId(blip,'link')),crop:attrs(at(node,['p','blipFill'],['a','srcRect'])),ocr:'not-run' };
    } else if (rawType === 'graphicFrame') {
      const data = at(node,['a','graphic'],['a','graphicData']);
      const table = child(data,'a','tbl'), chart = child(data,'c','chart');
      base.graphicDataUri = attr(data,'uri');
      if (table) {
        base.kind = 'table';
        base.table = { columnWidths:children(child(table,'a','tblGrid'),'a','gridCol').map(n => integer(attr(n,'w'))),rows:children(table,'a','tr').map((row,index) => ({index,height:integer(attr(row,'h')),cells:children(row,'a','tc').map((cell,column) => ({column,attributes:attrs(cell),properties:attrs(child(cell,'a','tcPr')),text:readTextBody(child(cell,'a','txBody'),{part:context.part,shapeId:identity.id,scope:'table-cell',theme:context.theme}),styleResolution:'table styles and conditional formatting not resolved'}))})),properties:attrs(child(table,'a','tblPr')),styleId:at(table,['a','tblPr'],['a','tableStyleId'])?.textContent ?? null };
      } else if (chart) {
        base.kind = 'chart'; const chartRel = relation(relId(chart));
        if (chartRel?.kind === 'chart' && chartRel.exists) base.chart = await chartData(pkg,chartRel.part);
        else { base.chart = null; pkg.issue('CHART_RELATIONSHIP_INVALID',context.part,relId(chart),'error'); }
      } else { base.kind = 'unsupported-graphic'; pkg.issue('GRAPHIC_CONTENT_NOT_DECODED',context.part,{shapeId:identity.id,uri:base.graphicDataUri}); }
    } else if (rawType === 'cxnSp') {
      base.kind = 'connector';
      base.connections = ['stCxn','endCxn'].map(kind => ({kind,attributes:attrs(at(node,['p','nvCxnSpPr'],['p','cNvCxnSpPr'],['a',kind]))}));
    } else if (rawType === 'sp') {
      base.kind = 'shape'; base.presetGeometry = attr(at(node,['p','spPr'],['a','prstGeom']),'prst'); base.customGeometry = Boolean(at(node,['p','spPr'],['a','custGeom']));
    } else pkg.issue('SHAPE_CONTENT_NOT_DECODED',context.part,{shapeId:identity.id,type:rawType});
    return base;
  }
  const output = [];
  for (const node of topShapes(context.root)) output.push(await read(node,[],[],output.length));
  return output;
}
