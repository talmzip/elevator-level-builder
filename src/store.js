// All levels in localStorage under one key, in the export shape plus the open level: { version, levels, current }.
import { isValidLevel, newId, newLevel, upgradeLevel, withAccordionsInLimits, withKidCentred } from './model.js';

const KEY = 'elevator-level-builder';
const VERSION = 2; // 2: accordions with head, fold side and state (version 1 files are upgraded on load and import)

// A file's levels in the current shape, and a note naming the levels that lost an accordion in the upgrade.
function upgraded(data) {
  if (data?.version !== 1 && data?.version !== VERSION) return null;
  if (!Array.isArray(data.levels)) return null;
  if (data.version === VERSION) return { levels: data.levels, note: '' };
  const results = data.levels.map(level => (level && Array.isArray(level.pieces) ? upgradeLevel(level) : { level, lost: 0 }));
  const hit = results.flatMap(({ lost }, index) => (lost ? [index + 1] : []));
  const note = hit.length ? `Accordions now fold. No room to convert one in level${hit.length === 1 ? '' : 's'} ${hit.join(', ')}; it was removed.` : '';
  return { levels: results.map(({ level }) => level), note };
}

export let loadNote = ''; // set when loading upgraded stored levels and had to remove something

export let current = 0; // index of the level on screen; stored so a reload reopens it
export const levels = load();

function load() {
  try {
    const data = JSON.parse(localStorage.getItem(KEY));
    const file = upgraded(data);
    loadNote = file?.note ?? '';
    const stored = file ? file.levels.filter(isValidLevel).map(withKidCentred).map(withAccordionsInLimits) : [];
    if (stored.length) {
      current = Number.isInteger(data.current) && stored[data.current] ? data.current : 0;
      return stored;
    }
  } catch {
    // Unreadable storage: start fresh.
  }
  return [newLevel()];
}

// The levels at these indices (all by default) in list order, as an export file.
export const exportJson = (indices = levels.keys()) =>
  JSON.stringify({ version: VERSION, levels: [...indices].sort((a, b) => a - b).map(index => levels[index]) }, null, 2);

export function save() {
  localStorage.setItem(KEY, JSON.stringify({ version: VERSION, levels, current }));
}

export function open(index) {
  current = index;
  save();
}

// Each list op saves and returns the index to show next. New levels go right after the given one.
export function insertAfter(index, level) {
  levels.splice(index + 1, 0, level);
  save();
  return index + 1;
}

export const duplicate = index => insertAfter(index, { ...levels[index], id: newId(), name: `${levels[index].name} copy` });

export function replace(index, level) {
  levels[index] = level;
  save();
  return index;
}

// Moves a level to another place in the order; the open level stays open wherever it lands.
export function move(from, to) {
  const open = levels[current];
  levels.splice(to, 0, ...levels.splice(from, 1));
  current = levels.indexOf(open);
  save();
}

// The last level is cleared instead of removed.
export const remove = index => removeMany([index]);

// Removes these levels; the open level stays open if kept, otherwise the next remaining one opens. Removing every
// level leaves one empty level.
export function removeMany(indices) {
  const doomed = new Set(indices);
  const open = levels[current];
  const before = levels.slice(0, current).filter((_, index) => !doomed.has(index)).length;
  const kept = levels.filter((_, index) => !doomed.has(index));
  levels.splice(0, levels.length, ...(kept.length ? kept : [newLevel()]));
  current = levels.includes(open) ? levels.indexOf(open) : Math.min(before, levels.length - 1);
  save();
  return current;
}

// Inserts these levels in order after the given index (−1: at the start); returns the first one's index.
export function insertAllAfter(index, newLevels) {
  levels.splice(index + 1, 0, ...newLevels);
  save();
  return index + 1;
}

// An import file's levels in file order, ready to insert (fresh ids, so re-importing an export never collides), and
// the upgrade note. Throws on an invalid file.
export function parseImport(text) {
  const file = upgraded(JSON.parse(text));
  if (!file || !file.levels.length || !file.levels.every(isValidLevel)) throw new Error('invalid level file');
  return { levels: file.levels.map(level => ({ ...withAccordionsInLimits(withKidCentred(level)), id: newId() })), note: file.note };
}
