// What finding secrets comes to. The title keeps, level by level, which of
// its secrets have ever been found (each by its key, the same every time the
// level is built). Every secret in a level unlocks a finish for the blaster
// in its colours; every secret in all ten opens Echo, the bonus level, and
// the ending runs a paragraph longer. DOM-free.
import { LEVEL_DEFS, secretsIn } from './levels.js';

/** The secrets found in a level, from the saved record: a list of keys, each once. */
export function foundIn(record, id) {
  return new Set((record && record[id]) || []);
}

/** The record with one more secret found in level `id` (a new object; the old is untouched). */
export function withFound(record, id, key) {
  const had = foundIn(record, id);
  if (had.has(key)) return record || {};
  return { ...(record || {}), [id]: [...had, key] };
}

/** Has every secret in this level been found? */
export function levelComplete(record, def) {
  return foundIn(record, def.id).size >= secretsIn(def);
}

/** Every secret in all ten: Echo opens, and the ending runs longer. */
export function everySecret(record) {
  return LEVEL_DEFS.every((L) => levelComplete(record, L));
}

/** The blaster finishes the record has unlocked: the standard, and one for each level whose every secret is found. */
export function finishesOpen(record) {
  return ['standard', ...LEVEL_DEFS.filter((L) => levelComplete(record, L)).map((L) => L.key)];
}

/**
 * The blaster's finishes: the body, the grip and the barrel of the gun in
 * your hand. The standard, then one in each level's colours.
 */
export const FINISHES = {
  standard: { name: 'Standard', body: '#2a3140', grip: '#1a1f28', barrel: '#3a4556' },
  edge: { name: 'Edge of the Grid', body: '#1c0c42', grip: '#0d0620', barrel: '#7f5cff' },
  wilds: { name: 'Wireframe Wilds', body: '#0c3340', grip: '#04151a', barrel: '#3dff9a' },
  farm: { name: 'Render Farm', body: '#1e2a3a', grip: '#0e141c', barrel: '#27d9ff' },
  foundry: { name: 'The Foundry', body: '#4a2616', grip: '#1e0e06', barrel: '#ff8a3a' },
  freeway: { name: 'Night Freeway', body: '#23233a', grip: '#101018', barrel: '#ffd36a' },
  rain: { name: 'Rain City', body: '#2a1a30', grip: '#120a16', barrel: '#ff4fd8' },
  underline: { name: 'Underline', body: '#3a3226', grip: '#1a160f', barrel: '#ffd08a' },
  harbour: { name: 'Harbour at Dawn', body: '#28405a', grip: '#101c28', barrel: '#ffb38a' },
  ridge: { name: 'Pine Ridge', body: '#2e3a2a', grip: '#141a12', barrel: '#e8f2ff' },
  workshop: { name: 'The Workshop', body: '#5a3a22', grip: '#2a1a0e', barrel: '#d8c49a' },
};
