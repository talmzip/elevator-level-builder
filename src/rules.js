// Grid rules shared with the game (Game-Design § 2 → Grid rules). Pure functions, no DOM.

const key = (row, col) => `${row},${col}`;
const flip = direction => (direction === 'h' ? 'v' : 'h');
const largestOdd = n => (n % 2 ? n : n - 1);
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const isLine = piece => piece.type === 'twin' || piece.type === 'turner';

export const kidPiece = level => ({ id: 'kid', type: 'kid', row: level.kid.row, col: level.kid.col });
export const allPieces = level => [kidPiece(level), ...level.pieces];
export const moveTo = (piece, row, col) => ({ ...piece, row, col });
export const inBounds = (level, row, col) => row >= 0 && row < level.rows && col >= 0 && col < level.cols;
export const isSolved = level => level.kid.row < 0;
// The exit (and so the kid) always sits in the centre column, right of centre on an even width.
export const exitCol = cols => Math.floor(cols / 2);

// Accordion (Game-Design § 2 → Grid rules): always 4 cells, a head direction (tail → head), a fold side and a state.
// Exposed: tail, a, b, head in a line. Folded: hinged between a and b, the head half flips over the top onto the fold
// side, so b lies beside a and the head beside the tail — a 2×2 at the tail end. The tail never moves.
const STEPS = { left: [0, -1], right: [0, 1], up: [-1, 0], down: [1, 0] };
export const HEAD_DIRS = ['left', 'right', 'up', 'down'];
export const lineAxis = dir => (dir === 'left' || dir === 'right' ? 'h' : 'v');
export const FOLD_SIDES = { h: ['up', 'down'], v: ['left', 'right'] }; // sides of a line on each axis
const ACCORDION_LENGTH = 4;

// The fold side kept when the head turns within its axis, otherwise the new axis's default (down / right).
export const foldSideFor = (dir, side) => (FOLD_SIDES[lineAxis(dir)].includes(side) ? side : FOLD_SIDES[lineAxis(dir)][1]);

// Tail, a, b, head cells from the tail cell.
export function accordionCells(tail, dir, side, folded) {
  const [r, c] = tail;
  const [dr, dc] = STEPS[dir];
  const [sr, sc] = STEPS[side];
  if (!folded) return [0, 1, 2, 3].map(k => [r + dr * k, c + dc * k]);
  return [[r, c], [r + dr, c + dc], [r + dr + sr, c + dc + sc], [r + sr, c + sc]];
}

// The tail is the footprint's corner away from the head and, folded, away from the fold side.
export function accordionTail(piece) {
  const { row, col, w, h } = rectOf(piece);
  const [dr, dc] = STEPS[piece.dir];
  const [sr, sc] = STEPS[piece.side];
  return [dr > 0 || (dr === 0 && sr > 0) ? row : row + h - 1, dc > 0 || (dc === 0 && sc > 0) ? col : col + w - 1];
}

// The accordion with its head direction, fold side or state changed and its tail kept.
export function accordionWith(piece, changes) {
  const next = { ...piece, ...changes };
  const cells = accordionCells(accordionTail(piece), next.dir, next.side, next.folded);
  return { ...next, row: Math.min(...cells.map(([r]) => r)), col: Math.min(...cells.map(([, c]) => c)) };
}

// An Edit change to an accordion (head, fold side, state). Folded, head and side rearrange inside the same 2×2; exposed,
// reversing the head or changing the side keeps the same cells; otherwise the tail stays put when that fits, else the
// nearest spot that fits. Null when nothing fits. Only Play folding needs a fixed tail; editing just needs to land.
export function accordionEdited(level, piece, changes) {
  const next = { ...piece, ...changes };
  next.side = foldSideFor(next.dir, next.side);
  const isSameCells = next.folded === piece.folded && (piece.folded || lineAxis(next.dir) === lineAxis(piece.dir));
  if (isSameCells) return next;
  const anchored = accordionWith(piece, next);
  return fits(level, anchored) ? anchored : nearestFit(level, anchored);
}

// Footprint rectangle; a piece's position is its top-left cell.
export function rectOf(piece) {
  const { row, col } = piece;
  if (piece.type === 'kid') return { row, col, w: 1, h: 1 };
  if (piece.type === 'accordion') {
    if (piece.folded) return { row, col, w: 2, h: 2 };
    return lineAxis(piece.dir) === 'h' ? { row, col, w: ACCORDION_LENGTH, h: 1 } : { row, col, w: 1, h: ACCORDION_LENGTH };
  }
  if (isLine(piece)) {
    return piece.orientation === 'h' ? { row, col, w: piece.length, h: 1 } : { row, col, w: 1, h: piece.length };
  }
  return { row, col, w: piece.w, h: piece.h };
}

export function cellsOf(piece) {
  const { row, col, w, h } = rectOf(piece);
  const cells = [];
  for (let r = row; r < row + h; r++) for (let c = col; c < col + w; c++) cells.push([r, c]);
  return cells;
}

export function axisOf(piece) {
  if (piece.type === 'kid') return 'v';
  if (piece.type === 'accordion') return lineAxis(piece.dir);
  return isLine(piece) ? piece.orientation : piece.axis;
}

function occupied(level, ignoreIds) {
  const taken = new Set();
  for (const piece of allPieces(level)) {
    if (!ignoreIds.includes(piece.id)) for (const [r, c] of cellsOf(piece)) taken.add(key(r, c));
  }
  return taken;
}

// Every cell is inside the grid, not covered by a piece outside ignoreIds, and listed only once.
function cellsFree(level, cells, ignoreIds) {
  const taken = occupied(level, ignoreIds);
  return cells.every(([r, c]) => {
    if (!inBounds(level, r, c) || taken.has(key(r, c))) return false;
    taken.add(key(r, c));
    return true;
  });
}

// The pieces (new or moved versions of existing ones) sit in the grid without overlapping anything or each other.
export const fits = (level, ...pieces) => cellsFree(level, pieces.flatMap(cellsOf), pieces.map(piece => piece.id));

// How many free cells the piece can slide back (min, ≤ 0) and forward (max, ≥ 0) along its axis.
export function slideRange(level, piece) {
  const [dr, dc] = axisOf(piece) === 'h' ? [0, 1] : [1, 0];
  const taken = occupied(level, [piece.id]);
  // The kid may also enter the exit: the virtual cell above row 0 in its own column.
  const isOpen = ([r, c]) => !taken.has(key(r, c)) && (inBounds(level, r, c) || (piece.type === 'kid' && r === -1));
  const reach = dir => {
    let steps = 0;
    while (cellsOf(moveTo(piece, piece.row + dir * (steps + 1) * dr, piece.col + dir * (steps + 1) * dc)).every(isOpen)) steps++;
    return steps;
  };
  return { min: -reach(-1), max: reach(1) };
}

// Top-left cell of every spot the piece can slide to along its axis (the kid's may be the exit, row −1).
export function slideSpots(level, piece) {
  const { min, max } = slideRange(level, piece);
  const [dr, dc] = axisOf(piece) === 'h' ? [0, 1] : [1, 0];
  const spots = [];
  for (let steps = min; steps <= max; steps++) if (steps) spots.push([piece.row + steps * dr, piece.col + steps * dc]);
  return spots;
}

// Every top-left cell where the piece fits.
export function fitSpots(level, piece) {
  const spots = [];
  for (let row = 0; row < level.rows; row++) {
    for (let col = 0; col < level.cols; col++) if (fits(level, moveTo(piece, row, col))) spots.push([row, col]);
  }
  return spots;
}

// New w×h anchored at the top-left cell. Axis = longer side; a square keeps its previous axis.
export const resize = (piece, w, h) => ({ ...piece, w, h, axis: w === h ? piece.axis : w > h ? 'h' : 'v' });

// Sets the twin to newLength; its partner takes the rest. Both change at their tail ends, so heads stay put.
// Legality (no growth into occupied cells) is `fits` on the returned pair.
export function twinTransfer(level, twin, newLength) {
  const partner = level.pieces.find(piece => piece.id === twin.partner);
  const total = twin.length + partner.length;
  return [{ ...twin, length: newLength }, { ...partner, length: total - newLength }];
}

const centreOf = piece => {
  const arm = (piece.length - 1) / 2;
  return piece.orientation === 'h' ? [piece.row, piece.col + arm] : [piece.row + arm, piece.col];
};

// The turner rotated 90° about its centre cell (same footprint clockwise or counter-clockwise).
export function turnerRotated(piece) {
  const arm = (piece.length - 1) / 2;
  const [cr, cc] = centreOf(piece);
  return piece.orientation === 'h'
    ? { ...piece, orientation: 'v', row: cr - arm, col: cc }
    : { ...piece, orientation: 'h', row: cr, col: cc - arm };
}

// Legal turn, or null. Needs a free destination and one clear sweep direction. Each arm sweeps the
// quadrant box between its start and end cells; clockwise and counter-clockwise use opposite diagonal quadrants.
export function turnerTurn(level, piece) {
  const turned = turnerRotated(piece);
  if (!fits(level, turned)) return null;
  const arm = (piece.length - 1) / 2;
  const [cr, cc] = centreOf(piece);
  const quadrant = (sr, sc) => {
    const cells = [];
    for (let i = 1; i <= arm; i++) for (let j = 1; j <= arm; j++) cells.push([cr + sr * i, cc + sc * j]);
    return cells;
  };
  const sweepClear = cells => cellsFree(level, cells, [piece.id]);
  const clear = sweepClear([...quadrant(-1, -1), ...quadrant(1, 1)]) || sweepClear([...quadrant(-1, 1), ...quadrant(1, -1)]);
  return clear ? turned : null;
}

// Every cell between the kid and the exit, in the kid's column, is free.
export function laneClear(level) {
  const lane = [];
  for (let row = 0; row < level.kid.row; row++) lane.push([row, level.kid.col]);
  return cellsFree(level, lane, []);
}

// Play tap: the ability's next step as the changed pieces, or null when there's no room. Accordion → fold /
// unfold, turner → turn, twin → one cell from its partner (legality of the pair is `fits`).
export function abilityStep(level, piece) {
  switch (piece.type) {
    case 'accordion': {
      const next = accordionWith(piece, { folded: !piece.folded });
      return fits(level, next) ? [next] : null;
    }
    case 'turner': {
      const turned = turnerTurn(level, piece);
      return turned && [turned];
    }
    case 'twin': {
      const partner = level.pieces.find(other => other.id === piece.partner);
      return partner.length > 1 ? twinTransfer(level, piece, piece.length + 1) : null;
    }
    default: return null;
  }
}

// Edit size limits: a side or line spans at most grid − 1 cells; a turner is odd and at least 3.
export const maxSide = (level, direction) => (direction === 'h' ? level.cols : level.rows) - 1;
export const maxTurnerLength = (level, orientation) => Math.max(3, largestOdd(maxSide(level, orientation)));

// The piece with a w×h footprint (a line takes the side along its orientation), kept within the size limits. An
// accordion keeps its 4 cells; exposed, it folds when its line no longer fits the size limit.
function sizedTo(level, piece, w, h) {
  if (piece.type === 'accordion') {
    return !piece.folded && maxSide(level, axisOf(piece)) < ACCORDION_LENGTH ? accordionWith(piece, { folded: true }) : piece;
  }
  const along = piece.orientation === 'h' ? w : h;
  if (piece.type === 'turner') return { ...piece, length: clamp(largestOdd(along), 3, maxTurnerLength(level, piece.orientation)) };
  if (piece.type === 'twin') return { ...piece, length: clamp(along, 1, maxSide(level, piece.orientation)) };
  return resize(piece, clamp(w, 1, maxSide(level, 'h')), clamp(h, 1, maxSide(level, 'v')));
}

const EDGES = { left: ['w', -1], right: ['w', 1], top: ['h', -1], bottom: ['h', 1] };

// The piece with one edge dragged `cells` along its axis (right / down positive); the opposite edge stays put.
export function resizedFromEdge(level, piece, edge, cells) {
  const rect = rectOf(piece);
  const [side, sign] = EDGES[edge];
  const size = { w: rect.w, h: rect.h, [side]: rect[side] + sign * cells };
  const sized = sizedTo(level, piece, size.w, size.h);
  const after = rectOf(sized);
  return sign < 0 ? moveTo(sized, rect.row + rect.h - after.h, rect.col + rect.w - after.w) : sized;
}

// The resized or rotated piece where it fits: at its own position first, else with its start or its far end
// (right / bottom) where the original's was, so a size that hits something grows the other way. Null if none fits.
export function fitResized(level, original, sized) {
  const before = rectOf(original);
  const after = rectOf(sized);
  const rows = new Set([sized.row, before.row, before.row + before.h - after.h]);
  const cols = new Set([sized.col, before.col, before.col + before.w - after.w]);
  for (const row of rows) {
    for (const col of cols) {
      const candidate = moveTo(sized, row, col);
      if (fits(level, candidate)) return candidate;
    }
  }
  return null;
}

// Edit rotation: blocks swap w and h (a square toggles its axis), twins flip at their head, turners turn about the centre.
export function rotated(piece) {
  if (piece.type === 'turner') return turnerRotated(piece);
  if (piece.type === 'twin') return { ...piece, orientation: flip(piece.orientation) };
  return piece.w === piece.h ? { ...piece, axis: flip(piece.axis) } : resize(piece, piece.h, piece.w);
}

// The spot nearest the piece's position (fewest cells away) where it fits, or null.
export function nearestFit(level, piece) {
  const distance = ([row, col]) => Math.abs(row - piece.row) + Math.abs(col - piece.col);
  const [spot] = fitSpots(level, piece).sort((a, b) => distance(a) - distance(b));
  return spot ? moveTo(piece, ...spot) : null;
}

// One size step smaller (a block loses from its longer side, an exposed accordion folds), or null at the minimum.
function shrunk(piece) {
  if (piece.type === 'accordion') return piece.folded ? null : accordionWith(piece, { folded: true });
  if (piece.type === 'twin') return piece.length > 1 ? { ...piece, length: piece.length - 1 } : null;
  if (piece.type === 'turner') return piece.length > 3 ? { ...piece, length: piece.length - 2 } : null;
  if (piece.w > 1 && piece.w >= piece.h) return resize(piece, piece.w - 1, piece.h);
  return piece.h > 1 ? resize(piece, piece.w, piece.h - 1) : null;
}

// The level on a new grid size; never blocks. The kid moves to the new exit column, its row clamped inside. Each piece is capped to the size limits
// and moved to the nearest free spot (pieces already inside go first, so they keep their cells). With no spot free
// it shrinks a step and retries; only at minimum size is it dropped, and a twin then takes its partner with it.
export function regrid(level, rows, cols) {
  const kid = { row: clamp(level.kid.row, 0, rows - 1), col: exitCol(cols) };
  let next = { ...level, rows, cols, kid, pieces: [] };
  const isInside = piece => {
    const { row, col, w, h } = rectOf(piece);
    return row + h <= rows && col + w <= cols;
  };
  for (const piece of [...level.pieces].sort((a, b) => isInside(b) - isInside(a))) {
    const { w, h } = rectOf(piece);
    let sized = sizedTo(next, piece, w, h);
    let placed = null;
    while (sized && !(placed = nearestFit(next, sized))) sized = shrunk(sized);
    if (placed) next = { ...next, pieces: [...next.pieces, placed] };
  }
  const kept = new Map(next.pieces.map(piece => [piece.id, piece]));
  const pieces = level.pieces.map(piece => kept.get(piece.id))
    .filter(piece => piece && (piece.type !== 'twin' || kept.has(piece.partner)));
  return { ...next, pieces };
}
