// All levels in localStorage under one key, in the export shape: { version, levels }.
import { isValidLevel, newId, newLevel } from './model.js';

const KEY = 'elevator-level-builder';
const VERSION = 1;

export const levels = load();

function load() {
  try {
    const data = JSON.parse(localStorage.getItem(KEY));
    const stored = data?.version === VERSION && Array.isArray(data.levels) ? data.levels.filter(isValidLevel) : [];
    if (stored.length) return stored;
  } catch {
    // Unreadable storage: start fresh.
  }
  return [newLevel()];
}

export const exportJson = () => JSON.stringify({ version: VERSION, levels }, null, 2);

export function save() {
  localStorage.setItem(KEY, exportJson());
}

// Each list op saves and returns the index to show next.
export function add(level) {
  levels.push(level);
  save();
  return levels.length - 1;
}

export const duplicate = index => add({ ...levels[index], id: newId(), name: `${levels[index].name} copy` });

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
