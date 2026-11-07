import { validateDeck } from './schema.mjs';

export function patchDeck(source, operations) {
  validateDeck(source);
  if (!Array.isArray(operations) || operations.length > 100) throw new Error('Patch must contain at most 100 operations');
  const deck = structuredClone(source);
  const index = id => { const i = deck.slides.findIndex(s => s.id === id); if (i < 0) throw new Error(`Unknown slide: ${id}`); return i; };
  for (const op of operations) {
    if (!op || typeof op !== 'object' || Array.isArray(op)) throw new Error('Invalid operation');
    const allowed = { replace: ['op','id','slide'], insert: ['op','after','slide'], remove: ['op','id'], reorder: ['op','ids'] }[op.op];
    if (!allowed || Object.keys(op).some(k => !allowed.includes(k))) throw new Error(`Invalid operation fields: ${op.op}`);
    if (op.op === 'replace') { const i = index(op.id); if (op.slide?.id !== op.id) throw new Error('Replacement must preserve slide id'); deck.slides[i] = structuredClone(op.slide); }
    if (op.op === 'insert') deck.slides.splice(op.after === undefined ? deck.slides.length : index(op.after) + 1, 0, structuredClone(op.slide));
    if (op.op === 'remove') deck.slides.splice(index(op.id), 1);
    if (op.op === 'reorder') {
      if (!Array.isArray(op.ids) || op.ids.length !== deck.slides.length || new Set(op.ids).size !== deck.slides.length) throw new Error('Reorder must list every slide id once');
      deck.slides = op.ids.map(id => deck.slides[index(id)]);
    }
  }
  return validateDeck(deck);
}
