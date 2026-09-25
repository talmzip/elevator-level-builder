// Play-move search. A move is one Undo step — a slide of any distance, an accordion or turner tap, or a twin
// transfer to any length (the Play slider). Counts exclude the winning move: a level whose lane is clear is 0.
// Pure, no DOM.
import { accordionStates, allPieces, axisOf, cellsOf, moveTo, rectOf, resize, turnerRotated, twinTransfer } from './rules.js';
import { withPiece } from './model.js';

const MAX_STATES = 200000; // minMoves budget; past it the answer is only a lower bound

const pieceKey = piece => {
  if (piece.type === 'kid') return `${piece.row},${piece.col}`;
  if (piece.type === 'twin' || piece.type === 'turner') return `${piece.row},${piece.col},${piece.length},${piece.orientation}`;
  return `${piece.row},${piece.col},${piece.w},${piece.h},${piece.axis}`;
};

// An arrangement's key is its pieces' keys (kid first) joined; a move's key replaces just the changed ones.
const keysOf = level => allPieces(level).map(pieceKey);
function keyAfter(keys, changes) {
  const next = [...keys];
  for (const [n, piece] of changes) next[n] = pieceKey(piece);
  return next.join('|');
}
const applied = (level, changes) => withPiece(level, ...changes.map(([, piece]) => piece));
const isWin = changes => changes[0][1].type === 'kid' && changes[0][1].row < 0;

// Which piece covers each cell (index into allPieces + 1, 0 free), row-major.
function occupancy(level, pieces) {
  const grid = new Uint8Array(level.rows * level.cols);
  pieces.forEach((piece, n) => {
    const { row, col, w, h } = rectOf(piece);
    for (let r = row; r < row + h; r++) grid.fill(n + 1, r * level.cols + col, r * level.cols + col + w);
  });
  return grid;
}

// Same spots as rules.slideSpots, read from the occupancy grid: step by step, each step needs the strip of cells
// just past the leading edge free. The kid may take the exit, the virtual cell above row 0.
function slides(level, grid, piece) {
  const { row, col, w, h } = rectOf(piece);
  const { cols } = level;
  const columnFree = c => {
    for (let r = row; r < row + h; r++) if (grid[r * cols + c]) return false;
    return true;
  };
  const rowFree = r => {
    for (let c = col; c < col + w; c++) if (grid[r * cols + c]) return false;
    return true;
  };
  const spots = [];
  if (axisOf(piece) === 'h') {
    for (let c = col - 1; c >= 0 && columnFree(c); c--) spots.push([row, c]);
    for (let c = col + w; c < cols && columnFree(c); c++) spots.push([row, c - w + 1]);
  } else {
    let r = row - 1;
    for (; r >= 0 && rowFree(r); r--) spots.push([r, col]);
    if (r === -1 && piece.type === 'kid') spots.push([-1, col]);
    for (let down = row + h; down < level.rows && rowFree(down); down++) spots.push([down - h + 1, col]);
  }
  return spots;
}

// The changed pieces sit inside the grid on cells that are free or their own, without overlapping each other.
function fitsGrid(level, grid, pieces, owners) {
  const used = new Set();
  return pieces.flatMap(cellsOf).every(([r, c]) => {
    const cell = r * level.cols + c;
    if (r < 0 || r >= level.rows || c < 0 || c >= level.cols || used.has(cell)) return false;
    used.add(cell);
    return grid[cell] === 0 || owners.includes(grid[cell]);
  });
}

// rules.abilityStep for an accordion, on the grid: the next shape in its cycle that fits, or null.
function accordionStep(level, grid, piece, owner) {
  const states = accordionStates(level, piece);
  const current = states.findIndex(({ w, h }) => w === piece.w && h === piece.h);
  for (let step = 1; step < states.length; step++) {
    const { w, h } = states[(current + step) % states.length];
    const next = resize(piece, w, h);
    if (fitsGrid(level, grid, [next], [owner])) return next;
  }
  return null;
}

// rules.turnerTurn on the grid: the turned turner if its new cells and one pair of opposite sweep quadrants are
// clear, or null.
function turnerStep(level, grid, piece, owner) {
  const turned = turnerRotated(piece);
  if (!fitsGrid(level, grid, [turned], [owner])) return null;
  const arm = (piece.length - 1) / 2;
  const [cr, cc] = piece.orientation === 'h' ? [piece.row, piece.col + arm] : [piece.row + arm, piece.col];
  const quadrant = (sr, sc) => {
    const cells = [];
    for (let i = 1; i <= arm; i++) for (let j = 1; j <= arm; j++) cells.push([cr + sr * i, cc + sc * j]);
    return cells;
  };
  const clear = cells => cells.every(([r, c]) => r >= 0 && r < level.rows && c >= 0 && c < level.cols
    && (grid[r * level.cols + c] === 0 || grid[r * level.cols + c] === owner));
  return clear([...quadrant(-1, -1), ...quadrant(1, 1)]) || clear([...quadrant(-1, 1), ...quadrant(1, -1)]) ? turned : null;
}

// Every move from this arrangement: the type of the creature that moved and the changed pieces as
// [index into allPieces, piece] pairs.
function movesFrom(level) {
  const moves = [];
  const pieces = allPieces(level);
  const indexOf = id => pieces.findIndex(piece => piece.id === id);
  const add = (type, ...changed) => moves.push({ type, changes: changed.map(piece => [indexOf(piece.id), piece]) });
  const grid = occupancy(level, pieces);
  pieces.forEach((piece, n) => {
    for (const [row, col] of slides(level, grid, piece)) moves.push({ type: piece.type, changes: [[n, moveTo(piece, row, col)]] });
    const step = piece.type === 'accordion' ? accordionStep(level, grid, piece, n + 1)
      : piece.type === 'turner' ? turnerStep(level, grid, piece, n + 1) : null;
    if (step) moves.push({ type: piece.type, changes: [[n, step]] });
    // Each pair once, from the twin whose id sorts first.
    if (piece.type === 'twin' && piece.id < piece.partner) {
      const partner = indexOf(piece.partner);
      const owners = [n + 1, partner + 1];
      for (let length = 1; length < piece.length + pieces[partner].length; length++) {
        const pair = twinTransfer(level, piece, length);
        if (length !== piece.length && fitsGrid(level, grid, pair, owners)) add('twin', ...pair);
      }
    }
  });
  return moves;
}

// { moves: n } when solvable in n; { moves: null } when no arrangement reaches the exit;
// { moves: null, atLeast: n } when the budget ran out before n moves were fully searched.
export function minMoves(level) {
  const seen = new Set([keysOf(level).join('|')]);
  let frontier = [level];
  for (let depth = 0; frontier.length; depth++) {
    const next = [];
    for (const state of frontier) {
      const keys = keysOf(state);
      for (const { changes } of movesFrom(state)) {
        if (isWin(changes)) return { moves: depth };
        const key = keyAfter(keys, changes);
        if (seen.has(key)) continue;
        if (seen.size >= MAX_STATES) return { moves: null, atLeast: depth };
        seen.add(key);
        next.push(applied(state, changes));
      }
    }
    frontier = next;
  }
  return { moves: null };
}

const TYPES = ['kid', 'rigid', 'accordion', 'twin', 'turner'];

// Every arrangement reachable from start, and each one's fewest moves to solve (−1: never). Moves are stored as
// flat [target, type index, …] lists. Null when the search passes maxStates or the deadline (ms timestamp).
export function explore(start, maxStates, deadline) {
  const index = new Map([[keysOf(start).join('|'), 0]]);
  const states = [start];
  const moves = [];
  const winning = [];
  for (let i = 0; i < states.length; i++) {
    if (states.length > maxStates || (i % 500 === 0 && Date.now() > deadline)) return null;
    const out = [];
    const keys = keysOf(states[i]);
    for (const { type, changes } of movesFrom(states[i])) {
      if (isWin(changes)) {
        winning.push(i);
        continue;
      }
      const key = keyAfter(keys, changes);
      let j = index.get(key);
      if (j === undefined) {
        j = states.length;
        index.set(key, j);
        states.push(applied(states[i], changes));
      }
      out.push(j, TYPES.indexOf(type));
    }
    moves.push(out);
  }

  // Breadth-first backwards from the arrangements with the winning move open.
  const before = states.map(() => []);
  moves.forEach((out, i) => {
    for (let k = 0; k < out.length; k += 2) before[out[k]].push(i);
  });
  const distance = new Int32Array(states.length).fill(-1);
  const queue = [];
  for (const i of winning) {
    if (distance[i] < 0) {
      distance[i] = 0;
      queue.push(i);
    }
  }
  for (let head = 0; head < queue.length; head++) {
    const i = queue[head];
    for (const j of before[i]) {
      if (distance[j] < 0) {
        distance[j] = distance[i] + 1;
        queue.push(j);
      }
    }
  }
  return { states, moves, distance };
}

// Whether every fewest-move solution from arrangement i moves a creature of this type.
export function isTypeNeeded(graph, i, type) {
  const { moves, distance } = graph;
  const typeIndex = TYPES.indexOf(type);
  const avoidable = new Map();
  const canAvoid = at => {
    if (distance[at] === 0) return true;
    if (avoidable.has(at)) return avoidable.get(at);
    let result = false;
    const out = moves[at];
    for (let k = 0; k < out.length && !result; k += 2) {
      result = out[k + 1] !== typeIndex && distance[out[k]] === distance[at] - 1 && canAvoid(out[k]);
    }
    avoidable.set(at, result);
    return result;
  };
  return !canAvoid(i);
}
