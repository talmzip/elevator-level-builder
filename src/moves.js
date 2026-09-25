// Fewest-moves results per arrangement, cached and solved one level at a time in a worker, most wanted first.
const cache = new Map(); // arrangement key → { moves, atLeast? } | { error: true }
let wanted = []; // [key, level] in priority order, not yet cached
let job = null; // { key, worker }
let onSolved = () => {};

// Name and gen don't change the answer.
const keyOf = ({ rows, cols, kid, pieces }) => JSON.stringify({ rows, cols, kid, pieces });

export function initMoves(solved) {
  onSolved = solved;
}

// The cached result, or undefined while unsolved.
export const movesOf = level => cache.get(keyOf(level));

// Replaces the wanted list; a running job no longer wanted is dropped.
export function wantMoves(levels) {
  wanted = levels.map(level => [keyOf(level), level]).filter(([key]) => !cache.has(key));
  if (job && !wanted.some(([key]) => key === job.key)) {
    job.worker.terminate();
    job = null;
  }
  next();
}

function next() {
  while (wanted.length && cache.has(wanted[0][0])) wanted.shift();
  if (job || !wanted.length) return;
  const [key, level] = wanted.shift();
  const worker = new Worker(new URL('./solver-worker.js', import.meta.url), { type: 'module' });
  job = { key, worker };
  const finish = result => {
    worker.terminate();
    cache.set(key, result);
    job = null;
    onSolved();
    next();
  };
  worker.addEventListener('message', ({ data }) => finish(data));
  worker.addEventListener('error', () => finish({ error: true }));
  worker.postMessage(level);
}

// Short count for lists: "7", "6+", "✕" (unsolvable), "…" (solving), "" (error).
export function movesText(result) {
  if (!result) return '…';
  if (result.error) return '';
  if (result.moves !== null) return String(result.moves);
  return result.atLeast !== undefined ? `${result.atLeast}+` : '✕';
}
