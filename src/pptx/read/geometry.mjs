import { child, at, attr, integer, bool } from '../xml.mjs';

export function transform(shape) {
  const x = child(shape, 'p', 'xfrm') ?? at(shape, ['p','spPr'], ['a','xfrm']) ?? at(shape, ['p','grpSpPr'], ['a','xfrm']);
  if (!x) return null;
  const pair = (name, a, b) => { const n = child(x, 'a', name); return n ? { [a]: integer(attr(n, a)), [b]: integer(attr(n, b)) } : null; };
  return { offset: pair('off','x','y'), extent: pair('ext','cx','cy'), childOffset: pair('chOff','x','y'), childExtent: pair('chExt','cx','cy'), rotation: integer(attr(x,'rot')), flipH: bool(attr(x,'flipH')), flipV: bool(attr(x,'flipV')) };
}

export function resolveBounds(chain, groups = []) {
  const result = {}, sources = {};
  for (const [field, key] of [['x','offset'],['y','offset'],['cx','extent'],['cy','extent']]) {
    const candidate = chain.find(c => c.transform?.[key]?.[field] !== null && c.transform?.[key]?.[field] !== undefined);
    result[field] = candidate?.transform[key][field] ?? null; sources[field] = candidate?.source ?? null;
  }
  const transformed = chain.find(c => c.transform);
  const rotation = transformed?.transform.rotation ?? 0;
  const bounds = Object.values(result).every(v => v !== null) ? { x: result.x, y: result.y, width: result.cx, height: result.cy, unit: 'EMU' } : null;
  let pageBounds = bounds ? { ...bounds } : null;
  let unresolved = rotation !== 0;
  for (const group of [...groups].reverse()) {
    const t = group;
    if (!pageBounds || t?.rotation || t?.flipH || t?.flipV || !t?.offset || !t?.extent || !t?.childOffset || !t?.childExtent || !(t.childExtent.cx > 0 && t.childExtent.cy > 0)) { unresolved = true; break; }
    if ([t.offset.x,t.offset.y,t.extent.cx,t.extent.cy,t.childOffset.x,t.childOffset.y].some(v => v === null)) { unresolved = true; break; }
    const sx = t.extent.cx / t.childExtent.cx, sy = t.extent.cy / t.childExtent.cy;
    pageBounds = { x: t.offset.x + (pageBounds.x - t.childOffset.x) * sx, y: t.offset.y + (pageBounds.y - t.childOffset.y) * sy, width: pageBounds.width * sx, height: pageBounds.height * sy, unit:'EMU' };
  }
  return { bounds, sources, pageBounds: unresolved ? null : pageBounds, rotationUnits: rotation, pageBoundsStatus: unresolved ? 'unsupported-rotation-or-group-transform' : bounds ? 'resolved-unrotated' : 'unknown' };
}
