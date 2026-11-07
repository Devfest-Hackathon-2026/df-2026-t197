import { child, children, at, attr, attrs, integer, bool } from '../xml.mjs';

export function runStyle(node) {
  if (!node) return {};
  const result = { attributes: attrs(node) };
  const size = integer(attr(node, 'sz')); if (size !== null) result.fontSizePt = size / 100;
  for (const [name, field] of [['b','bold'],['i','italic']]) { const v = bool(attr(node,name)); if (v !== null) result[field] = v; }
  if (attr(node,'u') !== null) result.underline = attr(node,'u');
  for (const [name, field] of [['latin','latinFont'],['ea','eastAsianFont'],['cs','complexScriptFont']]) {
    const face = attr(child(node,'a',name),'typeface'); if (face !== null) result[field] = face;
  }
  const fill = child(node,'a','solidFill');
  const color = children(fill).find(n => ['srgbClr','schemeClr','sysClr','scrgbClr','hslClr','prstClr'].includes(n.localName));
  if (color) result.color = { kind: color.localName, value: attr(color,'val'), attributes: attrs(color), transforms: children(color).map(n => ({ name:n.localName, attributes:attrs(n) })) };
  if (child(node,'a','noFill')) result.color = { kind: 'noFill' };
  return result;
}

export function readTheme(root) {
  const elements = child(root,'a','themeElements');
  const fontScheme = child(elements,'a','fontScheme');
  const fonts = {};
  for (const [name, key] of [['majorFont','major'],['minorFont','minor']]) {
    const font = child(fontScheme,'a',name);
    fonts[key] = { latin: attr(child(font,'a','latin'),'typeface'), ea: attr(child(font,'a','ea'),'typeface'), cs: attr(child(font,'a','cs'),'typeface'), supplemental: Object.fromEntries(children(font,'a','font').map(n => [attr(n,'script'),attr(n,'typeface')])) };
  }
  const colors = {};
  for (const entry of children(child(elements,'a','clrScheme'))) {
    const color = children(entry)[0];
    colors[entry.localName] = color ? { kind:color.localName, ...attrs(color) } : null;
  }
  return { name:attr(root,'name'), fontSchemeName:attr(fontScheme,'name'), fonts, colors };
}

function themeFont(value, text, theme) {
  const match = /^\+(mj|mn)-(lt|ea|cs)$/.exec(value ?? '');
  if (!match) return { value, themeToken: false, resolved: true };
  const family = theme?.fonts[match[1] === 'mj' ? 'major' : 'minor'];
  const key = { lt:'latin', ea:'ea', cs:'cs' }[match[2]];
  let resolved = family?.[key] || null, languageFallback = null;
  if (!resolved && key === 'ea' && /[\u3040-\u30ff]/.test(text)) { resolved = family?.supplemental.Jpan || null; languageFallback = 'Jpan'; }
  return { value:resolved, themeToken:value, resolved:Boolean(resolved), languageFallback };
}

function listDefault(shape, level) {
  const list = at(shape,['p','txBody'],['a','lstStyle']);
  return [child(list,'a',`lvl${level + 1}pPr`), child(list,'a','defPPr')].filter(Boolean);
}

function inheritedLayers(context, level) {
  const layers = [];
  for (const entry of context.chain ?? []) {
    for (const p of listDefault(entry.node, level)) layers.push({ node:child(p,'a','defRPr'), source:{ ...entry.source, location:`list-level-${level + 1}` } });
    // Only paragraph defaults are inherited here; sample run text on a master is not content.
    const paragraphs = children(at(entry.node,['p','txBody']),'a','p');
    for (const p of paragraphs) if ((integer(attr(child(p,'a','pPr'),'lvl')) ?? 0) === level) {
      const defaults = at(p,['a','pPr'],['a','defRPr']);
      if (defaults) { layers.push({ node:defaults, source:{ ...entry.source, location:`paragraph-default-level-${level + 1}` } }); break; }
    }
  }
  const phType = context.placeholderType;
  const category = ['title','ctrTitle'].includes(phType) ? 'titleStyle' : ['body','subTitle','obj','vertBody','vertObj'].includes(phType) ? 'bodyStyle' : 'otherStyle';
  const masterStyle = at(context.masterRoot,['p','txStyles'],['p',category]);
  for (const p of [child(masterStyle,'a',`lvl${level + 1}pPr`),child(masterStyle,'a','defPPr')].filter(Boolean)) layers.push({ node:child(p,'a','defRPr'), source:{ scope:'master-text-style',part:context.masterPart,location:`${category}/level-${level + 1}` } });
  const defaults = child(context.presentationRoot,'p','defaultTextStyle');
  for (const p of [child(defaults,'a',`lvl${level + 1}pPr`),child(defaults,'a','defPPr')].filter(Boolean)) layers.push({ node:child(p,'a','defRPr'), source:{ scope:'presentation-default',part:context.presentationPart,location:`level-${level + 1}` } });
  return layers.filter(l => l.node);
}

function resolveStyle(layers, text, theme) {
  const resolved = {};
  for (const layer of layers) {
    const style = runStyle(layer.node);
    for (const key of ['fontSizePt','bold','italic','underline','latinFont','eastAsianFont','complexScriptFont','color']) {
      if (Object.hasOwn(style,key) && !Object.hasOwn(resolved,key)) resolved[key] = { value:style[key], source:layer.source };
    }
  }
  for (const key of ['latinFont','eastAsianFont','complexScriptFont']) if (resolved[key]) {
    const value = resolved[key].value;
    resolved[key] = { ...resolved[key], declaredValue:value, theme:themeFont(value,text,theme) };
  }
  return resolved;
}

export function readTextBody(body, context = {}) {
  if (!body) return null;
  const bodyPr = child(body,'a','bodyPr');
  const autoFit = ['noAutofit','normAutofit','spAutoFit'].map(kind => child(bodyPr,'a',kind)).find(Boolean);
  const paragraphs = children(body,'a','p').map((p, index) => {
    const pPr = child(p,'a','pPr');
    const rawLevel = integer(attr(pPr,'lvl')); const level = rawLevel ?? 0;
    const bullet = children(pPr).find(n => ['buNone','buChar','buAutoNum','buBlip'].includes(n.localName));
    const runs = [];
    for (const item of children(p)) {
      if (!['r','fld','br'].some(name => child({childNodes:[item]},'a',name))) continue;
      const text = item.localName === 'br' ? '\n' : child(item,'a','t')?.textContent ?? '';
      const rPr = child(item,'a','rPr');
      const defaults = child(pPr,'a','defRPr');
      const source = { scope:context.scope ?? 'slide', part:context.part, shapeId:context.shapeId, paragraph:index };
      const localList = child(body,'a','lstStyle');
      const levels = [child(localList,'a',`lvl${level + 1}pPr`),child(localList,'a','defPPr')].filter(Boolean);
      const layers = [
        { node:rPr, source:{...source,location:'run'} },
        { node:defaults, source:{...source,location:'paragraph-default'} },
        ...levels.map(n => ({node:child(n,'a','defRPr'),source:{...source,location:`local-list-level-${level+1}`}})),
        ...inheritedLayers(context,level)
      ].filter(l => l.node);
      runs.push({ kind:item.localName === 'fld' ? 'field' : item.localName === 'br' ? 'break' : 'text', text, field:item.localName === 'fld' ? { id:attr(item,'id'),type:attr(item,'type') } : null, direct:runStyle(rPr), resolved:resolveStyle(layers,text,context.theme) });
    }
    return { index, level, rawLevel, properties:attrs(pPr), defaultRunStyle:runStyle(child(pPr,'a','defRPr')), endRunStyle:runStyle(child(p,'a','endParaRPr')), bullet:bullet ? { kind:bullet.localName,attributes:attrs(bullet) } : null, runs, text:runs.map(r => r.text).join('') };
  });
  return { text:paragraphs.map(p => p.text).join('\n'), bodyProperties:attrs(bodyPr), autoFit:autoFit ? {kind:autoFit.localName,attributes:attrs(autoFit)} : null, listDefaults:children(child(body,'a','lstStyle')).map(n => ({level:n.localName,properties:attrs(n),runStyle:runStyle(child(n,'a','defRPr'))})), paragraphs, resolutionScope:'selected declared run/paragraph/list/master/presentation properties; not PowerPoint rendering or complete style computation' };
}
