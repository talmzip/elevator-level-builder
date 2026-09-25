// All levels in localStorage under one key, in the export shape plus the open level: { version, levels, current }.
import { isValidLevel, newId, newLevel } from './model.js';

const KEY = 'elevator-level-builder';
const VERSION = 1;

export let current = 0; // index of the level on screen; stored so a reload reopens it
export const levels = load();

function load() {
  try {
    const data = JSON.parse(localStorage.getItem(KEY));
    const stored = data?.version === VERSION && Array.isArray(data.levels) ? data.levels.filter(isValidLevel) : [];
    if (stored.length) {
      current = Number.isInteger(data.current) && stored[data.current] ? data.current : 0;
      return stored;
    }
  } catch {
    // Unreadable storage: start fresh.
  }
  return [newLevel()];
}

export const exportJson = () => JSON.stringify({ version: VERSION, levels }, null, 2);

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
export function remove(index) {
  if (levels.length === 1) levels[0] = newLevel();
  else levels.splice(index, 1);
  save();
  return Math.min(index, levels.length - 1);
}

// Appends the file's levels (fresh ids, so re-importing an export never collides). Throws on an invalid file.
export function importJson(text) {
  const data = JSON.parse(text);
  if (data?.version !== VERSION || !Array.isArray(data.levels) || !data.levels.length || !data.levels.every(isValidLevel)) {
    throw new Error('invalid level file');
  }
  for (const level of data.levels) levels.push({ ...level, id: newId() });
  save();
  return data.levels.length;
}
