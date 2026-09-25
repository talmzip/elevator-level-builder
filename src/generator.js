// Level generator (design § 5 → Generator). A request is { rows, cols, moves, types }: the grid, the fewest moves wanted
// (winning move excluded) and the creature types that must take part. Random layouts of those types are explored
// in full; any arrangement exactly `moves` from the exit whose every fewest-move solution moves each type is a
// level. Too easy or too open adds a creature, stuck removes one. Pure, no DOM.
import { accordionStates, axisOf, fitSpots, maxSide, maxTurnerLength, moveTo, rectOf, resize } from './rules.js';
import { newId } from './model.js';
import { explore, isTypeNeeded } from './solver.js';

export const TYPES = ['rigid', 'accordion', 'twin', 'turner'];
export const MOVES_MAX = 40;
const LAYOUT_STATES = 15000; // one layout's search budget; past it the layout is too open
const SEARCH_MS = 15000; // one search run, then it reports what it found
const LEVELS_PER_RUN = 5; // ready levels to collect before a run stops early
const CANDIDATES_CHECKED = 40; // arrangements at the right distance tried against the every-type rule per layout
const MIN_CELLS = { rigid: 2, accordion: 2, twin: 2, turner: 3 }; // smallest footprint (twins: the pair)

const random = n => Math.floor(Math.random() * n);
const pick = list => list[random(list.length)];
const direction = () => (random(2) ? 'h' : 'v');

// Problems visible without searching, as short sentences; empty when the request can be searched.
export function checkRequest({ rows, cols, types }) {
  const problems = [];
  if (!types.length) problems.push('Pick at least one creature.');
  if (types.includes('turner') && Math.min(rows, cols) < 4) problems.push('A turner needs a grid of at least 4 × 4.');
  const cells = 1 + types.reduce((sum, type) => sum + MIN_CELLS[type], 0);
  if (cells > rows * cols) problems.push(`These creatures don't fit a ${rows} × ${cols} grid.`);
  return problems;
}

// Random sizes within the grid's limits, weighted small so layouts stay puzzle-like.
function randomPieces(level, type, id) {
  switch (type) {
    case 'rigid': {
      const axis = direction();
      const length = Math.min(2 + random(2), maxSide(level, axis));
      return [axis === 'h' ? resize({ id, type, row: 0, col: 0, axis }, length, 1) : resize({ id, type, row: 0, col: 0, axis }, 1, length)];
    }
    case 'accordion': {
      const area = 2 + random(3);
      const states = accordionStates(level, { w: area, h: 1 });
      const { w, h } = pick(states);
      return [resize({ id, type, row: 0, col: 0, axis: direction() }, w, h)];
    }
    case 'twin': {
      const partnerId = `${id}b`;
      const twin = (twinId, partner) => {
        const orientation = direction();
        return { id: twinId, type, row: 0, col: 0, length: Math.min(1 + random(3), maxSide(level, orientation)), orientation, partner };
      };
      return [twin(id, partnerId), twin(partnerId, id)];
    }
    case 'turner': {
      const orientation = direction();
      const length = random(4) === 0 ? 5 : 3;
      return [{ id, type, row: 0, col: 0, length: Math.min(length, maxTurnerLength(level, orientation)), orientation }];
    }
  }
}

// A rigid or twin sliding vertically in the kid's column can never leave it, so it would block the exit for good.
function blocksForever(piece, kidCol) {
  if (piece.type !== 'rigid' && piece.type !== 'twin') return false;
  const { col, w } = rectOf(moveTo(piece, 0, piece.col));
  return axisOf(piece) === 'v' && col <= kidCol && kidCol < col + w;
}

// count creatures (a twin pair is one) of the requested types, each type at least once, at random free spots.
// Null when one doesn't fit.
function randomLayout({ rows, cols, types }, count) {
  let level = { rows, cols, kid: { row: rows - 1, col: random(cols) }, pieces: [] };
  const chosen = [...types, ...Array.from({ length: Math.max(0, count - types.length) }, () => pick(types))];
  chosen.forEach((type, n) => {
    if (!level) return;
    for (const piece of randomPieces(level, type, `p${n + 1}`)) {
      const spots = level && fitSpots(level, piece).filter(([row, col]) => !blocksForever(moveTo(piece, row, col), level.kid.col));
      level = spots?.length ? { ...level, pieces: [...level.pieces, moveTo(piece, ...pick(spots))] } : null;
    }
  });
  return level;
}

// Pieces renamed p1, p2, … in order, twin partners following.
function renumbered(pieces) {
  const ids = new Map(pieces.map((piece, n) => [piece.id, `p${n + 1}`]));
  return pieces.map(piece => ({ ...piece, id: ids.get(piece.id), ...(piece.partner && { partner: ids.get(piece.partner) }) }));
}

// One level from an explored layout, or null: a random arrangement at the right distance that needs every type.
function levelFrom(graph, request) {
  const { distance, states } = graph;
  const candidates = [];
  distance.forEach((d, i) => d === request.moves && candidates.push(i));
  for (let n = 0; n < CANDIDATES_CHECKED && candidates.length; n++) {
    const i = candidates.splice(random(candidates.length), 1)[0];
    if (request.types.every(type => isTypeNeeded(graph, i, type))) {
      const { kid, pieces } = states[i];
      const { rows, cols, moves, types } = request;
      return { id: newId(), name: `Generated · ${moves} moves`, rows, cols, kid, pieces: renumbered(pieces), gen: { rows, cols, moves, types } };
    }
  }
  return null;
}

// Runs until LEVELS_PER_RUN levels or SEARCH_MS. report({ type: 'level', level }) per level found,
// report({ type: 'progress', tried, hardest }) per layout (hardest: most moves seen, −1 none), then
// report({ type: 'done', found, hardest }).
export function search(request, report) {
  const deadline = Date.now() + SEARCH_MS;
  const least = request.types.length;
  let count = Math.max(least, Math.round((request.rows * request.cols) / 6)); // about puzzle density
  let tried = 0;
  let found = 0;
  let hardest = -1;
  while (found < LEVELS_PER_RUN && Date.now() < deadline) {
    const layout = randomLayout(request, count);
    tried++;
    if (!layout) {
      count = Math.max(least, count - 1); // too crowded to place
      continue;
    }
    const graph = explore(layout, LAYOUT_STATES, deadline);
    if (!graph) {
      count++; // too open: more creatures
      continue;
    }
    const most = graph.distance.reduce((max, d) => Math.max(max, d), -1);
    hardest = Math.max(hardest, most);
    if (most < 0) count = Math.max(least, count - 1); // stuck: fewer creatures
    else if (most < request.moves) count++; // too easy: more creatures
    const level = most >= request.moves && levelFrom(graph, request);
    if (level) {
      found++;
      report({ type: 'level', level });
    }
    report({ type: 'progress', tried, hardest });
  }
  report({ type: 'done', found, hardest });
}
