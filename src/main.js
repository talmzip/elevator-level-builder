// Boot and wiring: app state, Edit / Play modes, palette, level navigation and file actions.
import { abilityStep, fitResized, fitSpots, fits, isSolved, laneClear, moveTo, regrid, rotated, slideSpots } from './rules.js';
import { createPiece, getPiece, newLevel, nextPieceId, withPiece, withoutPiece } from './model.js';
import * as store from './store.js';
import { initBoard, pieceElement, renderBoard, shake } from './board.js';
import { renderGridPopup, renderMenuPopup, renderPiecePopup } from './popups.js';
import { initMoves, movesOf, movesText, wantMoves } from './moves.js';
import { renderGeneratorSheet, renderLevelsSheet, sheetTop } from './sheets.js';
import { checkRequest } from './generator.js';

const EXIT_DEPTH = 0.6; // exit strip above the board, in cells (matches .stage padding in style.css)
const FLASH_MS = 1800;
const POOL_SIZE = 5; // generated levels kept ready
const DOUBLE_TAP_MS = 350; // taps closer than this count as a double tap
const SEARCH_WORKERS = Math.max(1, Math.min(4, (navigator.hardwareConcurrency || 2) - 1));

const $ = id => document.getElementById(id);
const ui = {
  name: $('name'), lane: $('lane'), moves: $('moves'), edit: $('edit-btn'), play: $('play-btn'), size: $('size-btn'),
  stage: $('stage'), board: $('board'), solved: $('solved'), side: $('side'),
  palette: $('palette'), playTools: $('play-tools'), undo: $('undo-btn'), reset: $('reset-btn'), hint: $('hint'),
  prev: $('prev-btn'), next: $('next-btn'), position: $('position'),
  actions: $('actions'), newButton: $('new-btn'), importFile: $('import-file'),
};

const state = {
  play: null, // { level, start, history } while playing
  selectedId: null,
  armed: null, // palette type waiting for a cell
  pendingTwin: null, // first twin placed, waiting for its partner (not saved until paired)
  isGridOpen: false,
  isResizeBlocked: false, // the last live resize step had no room, so the release snaps back
  isNewOpen: false, // the New menu: empty level or generate
  list: null, // the levels sheet: { mode: 'browse' | 'select' | 'place', selected: Set of ids, importing, message }
  gen: null, // the generator sheet: { request, pool, workers, tried, hardest, isRunning, lastFound, pending }
};
let flashTimer = null;

const level = () => (state.play ? state.play.level : store.levels[store.current]);

function saveEdit(next) {
  store.levels[store.current] = next;
  store.save();
}

// Every edit saves immediately; every play action is undoable.
function commit(next) {
  if (state.play) {
    state.play.history.push(state.play.level);
    state.play.level = next;
  } else {
    saveEdit(next);
  }
  render();
}

// Commits the pieces if legal; otherwise (null or no room) snaps back and shakes the selected piece.
function apply(pieces) {
  if (pieces && fits(level(), ...pieces)) return commit(withPiece(level(), ...pieces));
  render();
  shake(state.selectedId);
}

// Edit sliders and edge handles: each step saves at once if the size fits either way round; otherwise the
// attempt shows as a red ghost. Only the board redraws, so the slider under the finger survives.
function resizeLive(original, sized) {
  const fitted = fitResized(level(), original, sized);
  state.isResizeBlocked = !fitted;
  if (fitted) saveEdit(withPiece(level(), fitted));
  drawBoard(fitted ? null : sized);
}

function resizeEnd() {
  const isBlocked = state.isResizeBlocked;
  state.isResizeBlocked = false;
  render();
  if (isBlocked) shake(state.selectedId);
}

// Long-press in Edit: select and rotate, fitted like a resize.
function rotate(id) {
  const piece = getPiece(level(), id);
  const turned = fitResized(level(), piece, rotated(piece));
  state.selectedId = id;
  apply(turned && [turned]);
}

function remove(piece) {
  state.selectedId = null;
  commit(withoutPiece(level(), piece));
}

const resizeGrid = (rows, cols) => commit(regrid(level(), rows, cols));

function clearTransient() {
  state.selectedId = null;
  state.armed = null;
  state.pendingTwin = null;
}

function flash(message) {
  clearTimeout(flashTimer);
  ui.hint.textContent = message;
  ui.hint.classList.add('flash');
  flashTimer = setTimeout(() => {
    flashTimer = null;
    ui.hint.classList.remove('flash');
    renderHint();
  }, FLASH_MS);
}

function renderHint() {
  if (flashTimer) return;
  ui.hint.textContent = state.play ? 'Drag along lanes. Tap a creature to use its ability.'
    : state.pendingTwin ? 'Tap a dot for the partner twin.'
    : state.armed ? 'Tap a dot to place.'
    : state.selectedId && getPiece(level(), state.selectedId)?.type === 'accordion' ? 'Turn its head, pick its fold side or fold it.'
    : state.selectedId && state.selectedId !== 'kid' ? 'Drag an edge to resize. Long-press to rotate.'
    : 'Drag a creature onto the board, or tap it then a cell.';
}

// Hint dots (design § 3, § 4): in Edit, every cell where the armed or partner piece fits; in Play, every spot the
// selected piece can slide to. Derived from state, so they clear with the selection, the palette and the mode.
function hintDots() {
  const current = level();
  if (state.play) {
    const piece = state.selectedId && getPiece(current, state.selectedId);
    return piece ? { type: piece.type, spots: slideSpots(current, piece) } : null;
  }
  if (state.pendingTwin) return { type: 'twin', spots: fitSpots(withPiece(current, state.pendingTwin), createPiece('twin', 'new', 0, 0)) };
  return state.armed ? { type: state.armed, spots: fitSpots(current, createPiece(state.armed, 'new', 0, 0)) } : null;
}

const isDotted = (row, col) => Boolean(hintDots()?.spots.some(([r, c]) => r === row && c === col));

// id is null for an empty cell or a tapped dot.
function onBoardTap(id, row, col) {
  const current = level();
  if (state.play) {
    if (!id && isDotted(row, col)) return onBoardMove(state.selectedId, row, col); // slide there: one Undo step
    state.selectedId = id;
    const piece = id && getPiece(current, id);
    // Accordion, turner and twin cycle their ability on tap; kid and rigid have none.
    return piece && piece.type !== 'kid' && piece.type !== 'rigid' ? apply(abilityStep(current, piece)) : render();
  }
  if (state.pendingTwin) {
    const first = state.pendingTwin;
    const partner = { ...createPiece('twin', nextPieceId(current, 1), row, col), partner: first.id };
    clearTransient();
    // A piece or a blocked cell cancels the pair.
    if (!id && fits(current, first, partner)) return commit(withPiece(current, { ...first, partner: partner.id }, partner));
    return render();
  }
  if (state.armed && !id && isDotted(row, col)) return place(state.armed, row, col);
  state.armed = null; // any other tap cancels the palette
  state.selectedId = id;
  render();
}

// A new piece from the palette (a dotted cell or a valid drop, so it fits); a twin waits for its partner.
function place(type, row, col) {
  const current = level();
  const piece = createPiece(type, nextPieceId(current), row, col);
  if (type === 'twin') {
    state.pendingTwin = piece;
    return render();
  }
  state.armed = null;
  commit(withPiece(current, piece));
}

function arm(type) {
  const wasArmed = state.armed;
  clearTransient(); // another palette button cancels a half-placed twin pair
  state.armed = wasArmed === type ? null : type;
  render();
}

function drop(type, row, col) {
  clearTransient();
  place(type, row, col);
}

function onBoardMove(id, row, col) {
  if (state.pendingTwin) {
    clearTransient();
    return render();
  }
  const next = withPiece(level(), moveTo(getPiece(level(), id), row, col));
  if (isSolved(next)) state.selectedId = null; // keep the Solved banner clear of popups
  commit(next);
}

function setMode(isPlay) {
  if (isPlay === Boolean(state.play)) return;
  clearTransient();
  state.isGridOpen = false;
  state.isNewOpen = false;
  closeGenerator();
  const edited = store.levels[store.current];
  // Levels are immutable, so the edited level itself is the snapshot Edit returns to.
  state.play = isPlay ? { level: edited, start: edited, history: [] } : null;
  render();
}

// In Play, the arrows move to the next level's playtest, so a whole set can be played without Edit.
function showLevel(index) {
  ui.name.blur(); // let render show the new level's name
  clearTransient();
  store.open(index);
  const shown = store.levels[index];
  if (state.play) state.play = { level: shown, start: shown, history: [] };
  render();
}

const plural = (count, word) => `${count} ${word}${count === 1 ? '' : 's'}`;

function download(json, filename) {
  const url = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
  Object.assign(document.createElement('a'), { href: url, download: filename }).click();
  setTimeout(() => URL.revokeObjectURL(url));
}

// 1-based list positions for a file name: "4-13" for a run, "3,5,9" for scattered picks, "1-3,7" mixed.
function positionsLabel(indices) {
  const runs = [];
  for (const index of [...indices].sort((a, b) => a - b)) {
    const run = runs.at(-1);
    if (run && index === run[1] + 1) run[1] = index;
    else runs.push([index, index]);
  }
  return runs.map(([first, last]) => (first === last ? `${first + 1}` : `${first + 1}-${last + 1}`)).join(',');
}

const selectedIndices = () => store.levels.flatMap((level, index) => (state.list.selected.has(level.id) ? [index] : []));

const setList = changes => {
  state.list = { mode: 'browse', selected: new Set(), importing: [], message: '', ...changes };
  render();
};

function exportSelected() {
  const indices = selectedIndices();
  download(store.exportJson(indices), `levels-${positionsLabel(indices)}.json`);
  setList({ message: `Exported ${plural(indices.length, 'level')}.` });
}

function deleteSelected() {
  const indices = selectedIndices();
  if (!confirm(`Delete ${plural(indices.length, 'level')}?`)) return;
  const open = store.removeMany(indices);
  state.list = { mode: 'browse', selected: new Set(), importing: [], message: `Deleted ${plural(indices.length, 'level')}.` };
  showLevel(open);
}

// A valid file switches the list to placing its levels; they go in, in file order, after the tapped level.
async function importLevels(file) {
  try {
    const { levels, note } = store.parseImport(await file.text());
    setList({ mode: 'place', importing: levels, message: note });
  } catch {
    setList({ message: 'Not a valid level file.' });
  }
}

function placeImport(afterIndex) {
  const { importing } = state.list;
  const first = store.insertAllAfter(afterIndex, importing);
  state.list = { mode: 'browse', selected: new Set(), importing: [], message: `Imported ${plural(importing.length, 'level')}.` };
  showLevel(first);
}

// Largest cell that fits the board (plus exit strip) beside or above the tools, and above an open sheet that
// spans it, without scrolling.
function cellSize(current) {
  const isSideBelow = ui.side.offsetTop > ui.stage.offsetTop;
  const reserved = isSideBelow ? ui.side.offsetHeight + 24 : 16;
  const stage = ui.stage.getBoundingClientRect();
  const sheet = sheetTop();
  const isCovered = sheet && sheet.left < stage.right && sheet.right > stage.left;
  const bottom = isCovered ? Math.min(sheet.top - 12, window.innerHeight - reserved) : window.innerHeight - reserved;
  const height = bottom - stage.top;
  const width = ui.stage.clientWidth - 4; // board border
  return Math.max(24, Math.floor(Math.min(width / current.cols, height / (current.rows + EXIT_DEPTH))));
}

function render() {
  const current = level();
  const isPlay = Boolean(state.play);
  if (document.activeElement !== ui.name) ui.name.value = current.name;
  ui.name.disabled = isPlay;
  ui.edit.setAttribute('aria-pressed', !isPlay);
  ui.play.setAttribute('aria-pressed', isPlay);
  ui.size.textContent = `${current.rows} × ${current.cols}`;
  ui.size.disabled = isPlay;

  ui.palette.hidden = isPlay;
  ui.playTools.hidden = !isPlay;
  for (const button of ui.palette.querySelectorAll('[data-type]')) button.setAttribute('aria-pressed', button.dataset.type === state.armed);
  ui.undo.disabled = !state.play?.history.length;
  ui.reset.disabled = !state.play?.history.length;
  renderHint();

  ui.position.textContent = `Level ${store.current + 1} of ${store.levels.length}`;
  ui.prev.disabled = store.current === 0;
  ui.next.disabled = store.current === store.levels.length - 1;
  for (const button of ui.actions.querySelectorAll('button')) button.disabled = isPlay;
  ui.solved.hidden = !(isPlay && isSolved(current));
  const edited = store.levels[store.current];
  wantMoves([edited, ...(state.list ? store.levels : [])]);
  renderMoves();
  renderMenuPopup(state.isNewOpen ? { anchor: ui.newButton, items: [['Empty level', addEmpty], ['Generate…', openGenerator]] } : null);
  renderSheets();

  drawBoard();
  const selected = state.selectedId && getPiece(current, state.selectedId);
  renderPiecePopup(selected
    ? { level: current, piece: selected, mode: isPlay ? 'play' : 'edit', anchor: pieceElement(selected.id), apply, resizeLive, resizeEnd, remove }
    : null);
  renderGridPopup(state.isGridOpen ? { level: current, anchor: ui.size, resizeGrid, close: () => { state.isGridOpen = false; render(); } } : null);
}

// ghost: a piece to show as a red ghost (a live resize with no room).
function drawBoard(ghost = null) {
  const current = level();
  const shown = state.pendingTwin ? withPiece(current, state.pendingTwin) : current;
  const mode = state.play ? 'play' : 'edit';
  renderBoard({ level: shown, mode, selectedId: state.selectedId, pendingId: state.pendingTwin?.id, ghost, dots: hintDots() }, cellSize(current));
  const isClear = laneClear(current);
  ui.lane.textContent = isClear ? 'Lane clear' : 'Lane blocked';
  ui.lane.classList.toggle('blocked', !isClear);
}

// Fewest moves for the edited level (winning move excluded), from the moves cache.
function renderMoves() {
  const result = movesOf(store.levels[store.current]);
  const isBad = result?.moves === null && result.atLeast === undefined;
  const count = movesText(result);
  ui.moves.textContent = !result ? 'Solving…' : result.error ? '' : isBad ? 'Unsolvable' : `Min ${count} move${count === '1' ? '' : 's'}`;
  ui.moves.classList.toggle('blocked', isBad);
}

function renderSheets() {
  const list = state.list;
  renderLevelsSheet(list && {
    levels: store.levels,
    current: store.current,
    mode: list.mode,
    selected: list.selected,
    importCount: list.importing.length,
    message: list.message,
    movesText: level => movesText(movesOf(level)),
    open: index => {
      state.list = null;
      showLevel(index);
    },
    move: (from, to) => {
      store.move(from, to);
      render();
    },
    toggle: id => {
      if (!list.selected.delete(id)) list.selected.add(id);
      renderSheets();
    },
    setAll: isOn => {
      list.selected = new Set(isOn ? store.levels.map(level => level.id) : []);
      renderSheets();
    },
    select: () => setList({ mode: 'select' }),
    cancel: () => setList({}),
    exportSelected,
    deleteSelected,
    exportAll: () => {
      download(store.exportJson(), 'elevator-levels.json');
      setList({ message: `Exported all ${plural(store.levels.length, 'level')}.` });
    },
    import: () => ui.importFile.click(),
    place: placeImport,
    close: () => {
      state.list = null;
      render();
    },
  });
  const gen = state.gen;
  renderGeneratorSheet(gen && {
    request: gen.request,
    status: generatorStatus(gen),
    canGenerate: !checkRequest(gen.request).length && (gen.pool.length > 0 || gen.isRunning),
    canAgain: Boolean(store.levels[store.current].gen) && !checkRequest(gen.request).length && (gen.pool.length > 0 || gen.isRunning),
    set: setRequest,
    generate: () => takeGenerated('new'),
    again: () => takeGenerated('again'),
    close: closeGenerator,
  });
}

function addEmpty() {
  state.isNewOpen = false;
  showLevel(store.insertAfter(store.current, newLevel()));
}

// Generator (design § 5 → Generator): parallel workers search the request and fill a pool of ready levels; Generate and
// Again take from it at once. Any input change restarts the search.
function openGenerator() {
  state.isNewOpen = false;
  const current = store.levels[store.current];
  const request = current.gen ?? { rows: current.rows, cols: current.cols, moves: 5, types: ['rigid'] };
  state.gen = { request, pool: [], workers: [], tried: [], hardest: -1, isRunning: false, lastFound: true, pending: null };
  startSearch();
  render();
}

function closeGenerator() {
  if (!state.gen) return;
  stopSearch();
  state.gen = null;
  render();
}

function setRequest(request) {
  const gen = state.gen;
  stopSearch();
  Object.assign(gen, { request, pool: [], hardest: -1, lastFound: true, pending: null });
  startSearch();
  render();
}

function startSearch() {
  const gen = state.gen;
  if (checkRequest(gen.request).length) return;
  gen.isRunning = true;
  gen.tried = [];
  let running = SEARCH_WORKERS;
  let found = 0;
  gen.workers = Array.from({ length: SEARCH_WORKERS }, (_, n) => {
    const worker = new Worker(new URL('./generator-worker.js', import.meta.url), { type: 'module' });
    worker.addEventListener('message', ({ data }) => {
      if (state.gen !== gen || !gen.workers.includes(worker)) return;
      if (data.type === 'level') {
        found++;
        gen.pool.push(data.level);
        if (gen.pending) takeGenerated(gen.pending);
        if (gen.pool.length >= POOL_SIZE) finishSearch(found);
      } else if (data.type === 'progress') {
        gen.tried[n] = data.tried;
        gen.hardest = Math.max(gen.hardest, data.hardest);
      } else if (data.type === 'done' && --running === 0) {
        finishSearch(found);
      }
      renderSheets();
    });
    worker.addEventListener('error', () => {
      if (--running === 0) finishSearch(found);
    });
    worker.postMessage(gen.request);
    return worker;
  });
}

function finishSearch(found) {
  const gen = state.gen;
  stopSearch();
  gen.lastFound = found > 0;
  gen.pending = null;
  render();
}

function stopSearch() {
  const gen = state.gen;
  gen.workers.forEach(worker => worker.terminate());
  gen.workers = [];
  gen.isRunning = false;
}

// A ready level as a new level after the current one ('new') or in place of the current one ('again'). With none
// ready yet, waits for the search. Refills the pool in the background while the last run found levels.
function takeGenerated(kind) {
  const gen = state.gen;
  const level = gen.pool.shift();
  if (!level) {
    gen.pending = kind;
    return renderSheets();
  }
  gen.pending = null;
  showLevel(kind === 'new' ? store.insertAfter(store.current, level) : store.replace(store.current, level));
  if (!gen.isRunning && gen.lastFound) startSearch();
}

function generatorStatus(gen) {
  const problems = checkRequest(gen.request);
  if (problems.length) return { text: problems.join(' '), isBad: true };
  const tried = gen.tried.reduce((sum, n) => sum + (n || 0), 0);
  const hardest = gen.hardest >= 0 ? ` · hardest seen ${gen.hardest}` : '';
  if (gen.pending) return { text: `Generating… ${tried} layouts tried${hardest}`, isBad: false };
  if (gen.pool.length) return { text: `✓ ${gen.pool.length} ready${gen.isRunning ? ', finding more…' : ''}`, isBad: false };
  if (gen.isRunning) return { text: `Searching… ${tried} layouts tried${hardest}`, isBad: false };
  if (gen.hardest >= gen.request.moves) {
    return { text: 'None found where every chosen creature is needed. Try fewer creatures or another grid size.', isBad: true };
  }
  return {
    text: gen.hardest < 0 ? 'Not found — no solvable layouts. Grow the grid or pick other creatures.'
      : `Not found — hardest seen: ${gen.hardest} moves. Grow the grid, add creature types or lower the moves.`,
    isBad: true,
  };
}

initMoves(() => {
  renderMoves();
  renderSheets();
});

initBoard(ui.board, ui.palette, { tap: onBoardTap, move: onBoardMove, rotate, resize: resizeLive, resizeEnd, arm, drop });

// Tapping empty space outside the board and panels dismisses the selection, palette and grid popup.
document.addEventListener('pointerdown', event => {
  const target = event.target;
  const closesGrid = state.isGridOpen && !target.closest('#grid-popup, #size-btn');
  const closesNew = state.isNewOpen && !target.closest('#menu-popup, #new-btn');
  const clearsSelection = (state.selectedId || state.armed || state.pendingTwin) && !target.closest('#board, #piece-popup, #palette, #grid-popup, .sheet');
  if (!closesGrid && !closesNew && !clearsSelection) return;
  if (closesGrid) state.isGridOpen = false;
  if (closesNew) state.isNewOpen = false;
  if (clearsSelection) clearTransient();
  render();
});

ui.name.addEventListener('input', () => {
  store.levels[store.current] = { ...store.levels[store.current], name: ui.name.value };
  store.save();
});
ui.edit.addEventListener('click', () => setMode(false));
ui.play.addEventListener('click', () => setMode(true));
ui.size.addEventListener('click', () => {
  state.isGridOpen = !state.isGridOpen;
  render();
});

ui.undo.addEventListener('click', () => {
  state.play.level = state.play.history.pop();
  render();
});
ui.reset.addEventListener('click', () => {
  state.play.level = state.play.start;
  state.play.history = [];
  render();
});

ui.prev.addEventListener('click', () => showLevel(store.current - 1));
ui.next.addEventListener('click', () => showLevel(store.current + 1));
ui.position.addEventListener('click', () => {
  if (!state.list) return setList({});
  state.list = null;
  render();
});
ui.newButton.addEventListener('click', () => {
  state.isNewOpen = !state.isNewOpen;
  render();
});
$('duplicate-btn').addEventListener('click', () => showLevel(store.duplicate(store.current)));
$('delete-btn').addEventListener('click', () => {
  if (confirm(`Delete "${level().name}"?`)) showLevel(store.remove(store.current));
});
ui.importFile.addEventListener('change', () => {
  const [file] = ui.importFile.files;
  ui.importFile.value = '';
  if (file) importLevels(file);
});

// No zoom: iOS ignores user-scalable=no, so its pinch gestures are cancelled here; ctrl+wheel is a trackpad pinch.
const noZoom = event => event.preventDefault();
document.addEventListener('gesturestart', noZoom);
document.addEventListener('gesturechange', noZoom);
document.addEventListener('touchmove', event => event.touches.length > 1 && event.preventDefault(), { passive: false });
document.addEventListener('wheel', event => event.ctrlKey && event.preventDefault(), { passive: false });
document.addEventListener('contextmenu', event => event.target !== ui.name && event.preventDefault());
// Double-tap zoom where touch-action isn't honoured: a second tap within DOUBLE_TAP_MS outside the controls is
// cancelled. Buttons, the name field, the board and the palette keep every tap (they opt out of zoom in CSS).
let lastTapEnd = 0;
document.addEventListener('touchend', event => {
  const isControl = event.target.closest('button, input, #board, #palette, .grip');
  if (!isControl && event.timeStamp - lastTapEnd < DOUBLE_TAP_MS) event.preventDefault();
  lastTapEnd = event.timeStamp;
}, { passive: false });

window.addEventListener('resize', render);
render();
if (store.loadNote) setTimeout(() => alert(store.loadNote)); // stored levels lost something in a format upgrade
