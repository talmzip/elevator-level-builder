// Grid rules shared with the game (Game-Design § 2 → Grid rules). Pure functions, no DOM.

const key = (row, col) => `${row},${col}`;

export const kidPiece = level => ({ id: 'kid', type: 'kid', row: level.kid.row, col: level.kid.col });
export const allPieces = level => [kidPiece(level), ...level.pieces];
export const moveTo = (piece, row, col) => ({ ...piece, row, col });
export const inBounds = (level, row, col) => row >= 0 && row < level.rows && col >= 0 && col < level.cols;
export const isSolved = level => level.kid.row < 0;

// Footprint rectangle; a piece's position is its top-left cell.
export function rectOf(piece) {
  const { row, col } = piece;
  if (piece.type === 'kid') return { row, col, w: 1, h: 1 };
  if (piece.type === 'twin' || piece.type === 'turner') {
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
  return piece.type === 'twin' || piece.type === 'turner' ? piece.orientation : piece.axis;
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

// New w×h anchored at the top-left cell. Axis = longer side; a square keeps its previous axis.
export const resize = (piece, w, h) => ({ ...piece, w, h, axis: w === h ? piece.axis : w > h ? 'h' : 'v' });

// Every w×h rectangle of the accordion's area that fits the grid, widest first (4 → 4×1, 2×2, 1×4).
export function accordionStates(level, piece) {
  const area = piece.w * piece.h;
  const states = [];
  for (let w = Math.min(area, level.cols); w >= 1; w--) {
    if (area % w === 0 && area / w <= level.rows) states.push({ w, h: area / w });
  }
  return states;
}

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
