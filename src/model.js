// Level shape (design § 6): factories, palette defaults, ids, immutable edits, validation.
import { FOLD_SIDES, HEAD_DIRS, accordionWith, allPieces, exitCol, fits, kidPiece, lineAxis, maxSide, nearestFit } from './rules.js';

export const newId = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36);

export const newLevel = (rows = 6, cols = 6) => ({
  id: newId(),
  name: 'Untitled',
  rows,
  cols,
  kid: { row: rows - 1, col: exitCol(cols) },
  pieces: [],
});

// Palette defaults: rigid 2×1, accordion exposed head right / fold side down, twin 2 (+ partner 2), turner 3.
export function createPiece(type, id, row, col) {
  switch (type) {
    case 'rigid': return { id, type, row, col, w: 2, h: 1, axis: 'h' };
    case 'accordion': return { id, type, row, col, dir: 'right', side: 'down', folded: false };
    case 'twin': return { id, type, row, col, length: 2, orientation: 'h', partner: null };
    case 'turner': return { id, type, row, col, length: 3, orientation: 'h' };
  }
}

export function nextPieceId(level, offset = 0) {
  const max = Math.max(0, ...level.pieces.map(piece => Number(piece.id.slice(1)) || 0));
  return `p${max + 1 + offset}`;
}

export const getPiece = (level, id) => (id === 'kid' ? kidPiece(level) : level.pieces.find(piece => piece.id === id));

// Levels from before the exit column was fixed: the kid moved into it, at the free row nearest its own.
// Unchanged when it's already there or the column has no free cell.
export function withKidCentred(level) {
  const col = exitCol(level.cols);
  if (level.kid.col === col) return level;
  const rows = [...Array(level.rows).keys()].sort((a, b) => Math.abs(a - level.kid.row) - Math.abs(b - level.kid.row));
  const row = rows.find(r => fits(level, { ...kidPiece(level), row: r, col }));
  return row === undefined ? level : { ...level, kid: { row, col } };
}

// Exposed accordions longer than the grid allows (a line spans at most grid − 1) folded, where the fold fits.
export function withAccordionsInLimits(level) {
  let next = level;
  for (const piece of level.pieces) {
    if (piece.type !== 'accordion' || piece.folded || maxSide(level, lineAxis(piece.dir)) >= 4) continue;
    const folded = accordionWith(piece, { folded: true });
    if (fits(next, folded)) next = withPiece(next, folded);
  }
  return next;
}

// Copy of the level with these pieces replaced by id, or appended when new.
export function withPiece(level, ...pieces) {
  const next = { ...level, pieces: [...level.pieces] };
  for (const piece of pieces) {
    if (piece.type === 'kid') {
      next.kid = { row: piece.row, col: piece.col };
      continue;
    }
    const index = next.pieces.findIndex(existing => existing.id === piece.id);
    if (index < 0) next.pieces.push(piece);
    else next.pieces[index] = piece;
  }
  return next;
}

// Removing a twin removes its partner too.
export const withoutPiece = (level, piece) => ({
  ...level,
  pieces: level.pieces.filter(other => other.id !== piece.id && other.id !== piece.partner),
});

const isInt = (value, min, max = Infinity) => Number.isInteger(value) && value >= min && value <= max;
const isDirection = value => value === 'h' || value === 'v';

function isValidPiece(piece, level) {
  if (!piece || typeof piece.id !== 'string' || !isInt(piece.row, 0) || !isInt(piece.col, 0)) return false;
  switch (piece.type) {
    case 'rigid':
      return isInt(piece.w, 1) && isInt(piece.h, 1) && isDirection(piece.axis)
        && (piece.w === piece.h || piece.axis === (piece.w > piece.h ? 'h' : 'v'));
    case 'accordion':
      return HEAD_DIRS.includes(piece.dir) && FOLD_SIDES[lineAxis(piece.dir)].includes(piece.side) && typeof piece.folded === 'boolean';
    case 'twin': {
      const partner = level.pieces.find(other => other?.id === piece.partner);
      return isInt(piece.length, 1) && isDirection(piece.orientation)
        && partner !== piece && partner?.type === 'twin' && partner.partner === piece.id;
    }
    case 'turner':
      return isInt(piece.length, 3) && piece.length % 2 === 1 && isDirection(piece.orientation);
    default:
      return false;
  }
}

// Schema (design § 6) plus grid rules: every piece inside the grid, no overlaps.
export function isValidLevel(level) {
  if (!level || typeof level.id !== 'string' || typeof level.name !== 'string') return false;
  if (!isInt(level.rows, 3, 10) || !isInt(level.cols, 3, 10) || !Array.isArray(level.pieces)) return false;
  if (!level.kid || !isInt(level.kid.row, 0) || !isInt(level.kid.col, 0)) return false;
  const ids = new Set(level.pieces.map(piece => piece?.id));
  if (ids.size !== level.pieces.length || ids.has('kid')) return false;
  return level.pieces.every(piece => isValidPiece(piece, level)) && fits(level, ...allPieces(level));
}

// A version 1 level (accordions as w × h of any area) in version 2 shape. A 4-long line becomes exposed with its head
// at the right / bottom end, a 2×2 folded; any other size becomes 4 cells, exposed or folded, where it fits nearest.
// lost counts accordions with no room anywhere, which are removed.
export function upgradeLevel(level) {
  const isOld = piece => piece.type === 'accordion' && 'w' in piece;
  let next = { ...level, pieces: level.pieces.filter(piece => !isOld(piece)) };
  const placed = new Map();
  for (const old of level.pieces.filter(isOld)) {
    const dir = old.axis === 'v' ? 'down' : 'right';
    const base = { id: old.id, type: 'accordion', row: old.row, col: old.col, dir, side: dir === 'right' ? 'down' : 'right' };
    const isTooLong = maxSide(level, lineAxis(dir)) < 4; // an exposed line may span at most grid − 1
    const states = isTooLong ? [true] : old.w === 2 && old.h === 2 ? [true, false] : [false, true];
    const candidates = states.map(folded => ({ ...base, folded }));
    const piece = candidates.find(candidate => fits(next, candidate))
      ?? candidates.map(candidate => nearestFit(next, candidate)).find(Boolean);
    if (!piece) continue;
    placed.set(piece.id, piece);
    next = { ...next, pieces: [...next.pieces, piece] };
  }
  const pieces = level.pieces.map(piece => (isOld(piece) ? placed.get(piece.id) : piece)).filter(Boolean);
  return { level: { ...level, pieces }, lost: level.pieces.filter(isOld).length - placed.size };
}
