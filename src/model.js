// Level shape (design § 6): factories, palette defaults, ids, immutable edits, validation.
import { allPieces, fits, kidPiece } from './rules.js';

export const newId = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36);

export const newLevel = (rows = 6, cols = 6) => ({
  id: newId(),
  name: 'Untitled',
  rows,
  cols,
  kid: { row: rows - 1, col: Math.floor(cols / 2) },
  pieces: [],
});

// Palette defaults: rigid 2×1, accordion 4×1, twin 2 (+ partner 2), turner 3.
export function createPiece(type, id, row, col) {
  switch (type) {
    case 'rigid': return { id, type, row, col, w: 2, h: 1, axis: 'h' };
    case 'accordion': return { id, type, row, col, w: 4, h: 1, axis: 'h' };
    case 'twin': return { id, type, row, col, length: 2, orientation: 'h', partner: null };
    case 'turner': return { id, type, row, col, length: 3, orientation: 'h' };
  }
}

export function nextPieceId(level, offset = 0) {
  const max = Math.max(0, ...level.pieces.map(piece => Number(piece.id.slice(1)) || 0));
  return `p${max + 1 + offset}`;
}

export const getPiece = (level, id) => (id === 'kid' ? kidPiece(level) : level.pieces.find(piece => piece.id === id));

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
    case 'accordion':
      return isInt(piece.w, 1) && isInt(piece.h, 1) && isDirection(piece.axis)
        && (piece.w === piece.h || piece.axis === (piece.w > piece.h ? 'h' : 'v'));
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
