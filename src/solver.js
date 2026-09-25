// Fewest Play moves to solve a level: breadth-first search over arrangements. A move is one Undo step — a slide
// of any distance, an accordion or turner tap, or a twin transfer to any length (the Play slider). Pure, no DOM.
import { abilityStep, allPieces, fits, isSolved, moveTo, slideSpots, twinTransfer } from './rules.js';
import { withPiece } from './model.js';

const MAX_STATES = 200000; // search budget; past it the answer is only a lower bound

const pieceKey = piece => (piece.type === 'twin' || piece.type === 'turner'
  ? `${piece.row},${piece.col},${piece.length},${piece.orientation}`
  : `${piece.row},${piece.col},${piece.w},${piece.h},${piece.axis}`);

const stateKey = level => `${level.kid.row},${level.kid.col}|${level.pieces.map(pieceKey).join('|')}`;

// Every arrangement one move away.
function nextStates(level) {
  const states = [];
  const add = (...pieces) => states.push(withPiece(level, ...pieces));
  for (const piece of allPieces(level)) {
    for (const [row, col] of slideSpots(level, piece)) add(moveTo(piece, row, col));
    if (piece.type === 'accordion' || piece.type === 'turner') {
      const step = abilityStep(level, piece);
      if (step) add(...step);
    }
    // Each pair once, from the twin whose id sorts first.
    if (piece.type === 'twin' && piece.id < piece.partner) {
      const partner = level.pieces.find(other => other.id === piece.partner);
      for (let length = 1; length < piece.length + partner.length; length++) {
        const pair = twinTransfer(level, piece, length);
        if (length !== piece.length && fits(level, ...pair)) add(...pair);
      }
    }
  }
  return states;
}

// { moves: n } when solvable in n; { moves: null } when no arrangement reaches the exit;
// { moves: null, atLeast: n } when the budget ran out before depth n was fully searched.
export function minMoves(level) {
  const seen = new Set([stateKey(level)]);
  let frontier = [level];
  for (let depth = 1; frontier.length; depth++) {
    const next = [];
    for (const state of frontier) {
      for (const candidate of nextStates(state)) {
        if (isSolved(candidate)) return { moves: depth };
        const key = stateKey(candidate);
        if (seen.has(key)) continue;
        if (seen.size >= MAX_STATES) return { moves: null, atLeast: depth };
        seen.add(key);
        next.push(candidate);
      }
    }
    frontier = next;
  }
  return { moves: null };
}
