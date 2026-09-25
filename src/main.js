// Boot and wiring: app state, Edit / Play modes, palette, level navigation and file actions.
import { allPieces, fits, isSolved, moveTo } from './rules.js';
import { createPiece, getPiece, newLevel, nextPieceId, withPiece, withoutPiece } from './model.js';
import * as store from './store.js';
import { initBoard, pieceElement, renderBoard, shake } from './board.js';
import { renderGridPopup, renderPiecePopup } from './popups.js';

const EXIT_DEPTH = 0.6; // exit strip above the board, in cells (matches .stage padding in style.css)
const FLASH_MS = 1800;

const $ = id => document.getElementById(id);
const ui = {
  name: $('name'), edit: $('edit-btn'), play: $('play-btn'), size: $('size-btn'),
  stage: $('stage'), board: $('board'), solved: $('solved'), side: $('side'),
  palette: $('palette'), playTools: $('play-tools'), undo: $('undo-btn'), reset: $('reset-btn'), hint: $('hint'),
  prev: $('prev-btn'), next: $('next-btn'), position: $('position'),
  actions: $('actions'), importFile: $('import-file'),
};

const state = {
  index: 0,
  play: null, // { level, start, history } while playing
  selectedId: null,
  armed: null, // palette type waiting for a cell
  pendingTwin: null, // first twin placed, waiting for its partner (not saved until paired)
  isGridOpen: false,
};
let flashTimer = null;

const level = () => (state.play ? state.play.level : store.levels[state.index]);

// Every edit saves immediately; every play action is undoable.
function commit(next) {
  if (state.play) {
    state.play.history.push(state.play.level);
    state.play.level = next;
  } else {
    store.levels[state.index] = next;
    store.save();
  }
  render();
}

// Commits the pieces if legal; otherwise snaps back and shakes the selected piece.
function apply(...pieces) {
  if (pieces.every(Boolean) && fits(level(), ...pieces)) return commit(withPiece(level(), ...pieces));
  render();
  shake(state.selectedId);
}

function remove(piece) {
  state.selectedId = null;
  commit(withoutPiece(level(), piece));
}

function resizeGrid(rows, cols) {
  const next = { ...level(), rows, cols };
  if (!fits(next, ...allPieces(next))) return false;
  commit(next);
  return true;
}

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
  ui.hint.textContent = state.play ? 'Drag along lanes. Tap a creature for its ability.'
    : state.pendingTwin ? 'Tap a cell for the partner twin.'
    : state.armed ? 'Tap a cell to place.'
    : 'Choose a creature, then tap a cell.';
}

function onBoardTap(id, row, col) {
  const current = level();
  if (state.pendingTwin) {
    const first = state.pendingTwin;
    const partner = { ...createPiece('twin', nextPieceId(current, 1), row, col), partner: first.id };
    clearTransient();
    // A piece or a blocked cell cancels the pair.
    if (!id && fits(current, first, partner)) return commit(withPiece(current, { ...first, partner: partner.id }, partner));
    return render();
  }
  if (state.armed && !id) {
    const piece = createPiece(state.armed, nextPieceId(current), row, col);
    if (!fits(current, piece)) return flash('No room there.');
    if (piece.type === 'twin') {
      state.pendingTwin = piece;
      return render();
    }
    state.armed = null;
    return commit(withPiece(current, piece));
  }
  state.armed = null;
  state.selectedId = id;
  render();
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
  const edited = store.levels[state.index];
  // Levels are immutable, so the edited level itself is the snapshot Edit returns to.
  state.play = isPlay ? { level: edited, start: edited, history: [] } : null;
  render();
}

function showLevel(index) {
  ui.name.blur(); // let render show the new level's name
  clearTransient();
  state.index = index;
  render();
}

function exportLevels() {
  const url = URL.createObjectURL(new Blob([store.exportJson()], { type: 'application/json' }));
  Object.assign(document.createElement('a'), { href: url, download: 'elevator-levels.json' }).click();
  setTimeout(() => URL.revokeObjectURL(url));
}

async function importLevels(file) {
  try {
    const count = store.importJson(await file.text());
    render();
    flash(`Imported ${count} level${count === 1 ? '' : 's'}.`);
  } catch {
    flash('Not a valid level file.');
  }
}

// Largest cell that fits the board (plus exit strip) beside or above the tools without scrolling.
function cellSize(current) {
  const isSideBelow = ui.side.offsetTop > ui.stage.offsetTop;
  const reserved = isSideBelow ? ui.side.offsetHeight + 24 : 16;
  const height = window.innerHeight - ui.stage.getBoundingClientRect().top - reserved;
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

  ui.position.textContent = `Level ${state.index + 1} of ${store.levels.length}`;
  ui.prev.disabled = isPlay || state.index === 0;
  ui.next.disabled = isPlay || state.index === store.levels.length - 1;
  for (const button of ui.actions.querySelectorAll('button')) button.disabled = isPlay;
  ui.solved.hidden = !(isPlay && isSolved(current));

  const shown = state.pendingTwin ? withPiece(current, state.pendingTwin) : current;
  renderBoard({ level: shown, mode: isPlay ? 'play' : 'edit', selectedId: state.selectedId, pendingId: state.pendingTwin?.id }, cellSize(current));
  const selected = state.selectedId && getPiece(current, state.selectedId);
  renderPiecePopup(selected ? { level: current, piece: selected, mode: isPlay ? 'play' : 'edit', anchor: pieceElement(selected.id), apply, remove } : null);
  renderGridPopup(state.isGridOpen ? { level: current, anchor: ui.size, resizeGrid, close: () => { state.isGridOpen = false; render(); } } : null);
}

initBoard(ui.board, { tap: onBoardTap, move: onBoardMove });

// Tapping empty space outside the board and panels dismisses the selection, palette and grid popup.
document.addEventListener('pointerdown', event => {
  const target = event.target;
  const closesGrid = state.isGridOpen && !target.closest('#grid-popup, #size-btn');
  const clearsSelection = (state.selectedId || state.armed || state.pendingTwin) && !target.closest('#board, #piece-popup, #palette, #grid-popup');
  if (!closesGrid && !clearsSelection) return;
  if (closesGrid) state.isGridOpen = false;
  if (clearsSelection) clearTransient();
  render();
});

ui.name.addEventListener('input', () => {
  store.levels[state.index] = { ...store.levels[state.index], name: ui.name.value };
  store.save();
});
ui.edit.addEventListener('click', () => setMode(false));
ui.play.addEventListener('click', () => setMode(true));
ui.size.addEventListener('click', () => {
  state.isGridOpen = !state.isGridOpen;
  render();
});

ui.palette.addEventListener('click', event => {
  const type = event.target.closest('[data-type]')?.dataset.type;
  if (!type) return;
  const wasArmed = state.armed;
  clearTransient(); // another palette button cancels a half-placed twin pair
  state.armed = wasArmed === type ? null : type;
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

ui.prev.addEventListener('click', () => showLevel(state.index - 1));
ui.next.addEventListener('click', () => showLevel(state.index + 1));
$('new-btn').addEventListener('click', () => showLevel(store.add(newLevel())));
$('duplicate-btn').addEventListener('click', () => showLevel(store.duplicate(state.index)));
$('delete-btn').addEventListener('click', () => {
  if (confirm(`Delete "${level().name}"?`)) showLevel(store.remove(state.index));
});
$('export-btn').addEventListener('click', exportLevels);
$('import-btn').addEventListener('click', () => ui.importFile.click());
ui.importFile.addEventListener('change', () => {
  const [file] = ui.importFile.files;
  ui.importFile.value = '';
  if (file) importLevels(file);
});

window.addEventListener('resize', render);
render();
