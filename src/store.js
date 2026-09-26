// All levels in localStorage under one key, in the export shape plus the open level: { version, levels, current }.
import { isValidLevel, newId, newLevel, withKidCentred } from './model.js';

const KEY = 'elevator-level-builder';
const VERSION = 1;

export let current = 0; // index of the level on screen; stored so a reload reopens it
export const levels = load();

function load() {
  try {
    const data = JSON.parse(localStorage.getItem(KEY));
    const stored = data?.version === VERSION && Array.isArray(data.levels) ? data.levels.filter(isValidLevel).map(withKidCentred) : [];
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

// An import file's levels in file order, ready to insert (fresh ids, so re-importing an export never collides).
// Throws on an invalid file.
export function parseImport(text) {
  const data = JSON.parse(text);
  if (data?.version !== VERSION || !Array.isArray(data.levels) || !data.levels.length || !data.levels.every(isValidLevel)) {
    throw new Error('invalid level file');
  }
  return data.levels.map(level => ({ ...withKidCentred(level), id: newId() }));
}
