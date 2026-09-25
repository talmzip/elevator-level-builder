// Board: draws grid, exit, pieces, hint dots, drag ghosts and the selected piece's edge handles. Turns pointer input
// on the board and the palette into taps, moves, slides, edge resizes, long-press rotations and palette drops.
import { allPieces, axisOf, cellsOf, fits, moveTo, rectOf, resizedFromEdge, slideRange } from './rules.js';
import { createPiece, getPiece } from './model.js';

const TAP_SLOP = 8; // px a pointer may travel and still count as a tap
const LONG_PRESS_MS = 500;
const INSET = 3; // px gap between a piece and its cell borders
const HANDLE = 24; // px touch thickness of an edge handle
const SVG_NS = 'http://www.w3.org/2000/svg';

let boardEl;
let handlers;
let view; // { level, mode, selectedId, pendingId, ghost, dots: { type, spots } | null }
let cell;
let drag = null;

// handlers: tap(pieceId | null, row, col), move(pieceId, row, col), rotate(pieceId), resize(original, sized),
// resizeEnd(), arm(type), drop(type, row, col)
export function initBoard(el, paletteEl, boardHandlers) {
  boardEl = el;
  handlers = boardHandlers;
  el.addEventListener('pointerdown', onBoardDown);
  paletteEl.addEventListener('pointerdown', onPaletteDown);
  for (const target of [el, paletteEl]) {
    target.addEventListener('pointermove', onMove);
    target.addEventListener('pointerup', onUp);
    target.addEventListener('pointercancel', onCancel);
    target.addEventListener('contextmenu', event => event.preventDefault()); // long-press belongs to us
  }
}

// view.ghost: a piece to show as a red ghost (an Edit resize with no room).
export function renderBoard(nextView, cellSize) {
  view = nextView;
  cell = cellSize;
  document.documentElement.style.setProperty('--cell', `${cell}px`);
  draw();
}

export const pieceElement = id => boardEl.querySelector(`[data-id="${id}"]`);

export function shake(id) {
  const el = pieceElement(id);
  if (!el) return;
  el.classList.remove('shake');
  void el.offsetWidth; // restart the animation
  el.classList.add('shake');
}

function draw() {
  const { level } = view;
  boardEl.style.width = `${level.cols * cell}px`;
  boardEl.style.height = `${level.rows * cell}px`;
  const exit = document.createElement('div');
  exit.className = 'exit';
  exit.textContent = 'EXIT';
  exit.style.left = `${level.kid.col * cell}px`;
  const selected = view.mode === 'edit' && view.selectedId !== 'kid' && getPiece(level, view.selectedId);
  const dots = view.dots ? view.dots.spots.map(([row, col]) => dotEl(view.dots.type, row, col)) : [];
  boardEl.replaceChildren(exit, twinLinks(level), ...allPieces(level).map(pieceEl), ...dots, ...(selected ? handlesOf(selected) : []));
  if (view.ghost) showGhost(view.ghost, false);
}

function pieceEl(piece) {
  const { row, col, w, h } = rectOf(piece);
  const el = document.createElement('div');
  el.className = `piece ${piece.type}`;
  el.classList.toggle('selected', piece.id === view.selectedId);
  el.classList.toggle('pending', piece.id === view.pendingId);
  el.dataset.id = piece.id;
  Object.assign(el.style, {
    left: `${col * cell + INSET}px`,
    top: `${row * cell + INSET}px`,
    width: `${w * cell - 2 * INSET}px`,
    height: `${h * cell - 2 * INSET}px`,
  });
  if (piece.type === 'turner') {
    const pivot = document.createElement('i');
    pivot.className = 'pivot';
    const along = ((piece.length - 1) / 2 + 0.5) * cell - INSET;
    const across = cell / 2 - INSET;
    pivot.style.left = `${piece.orientation === 'h' ? along : across}px`;
    pivot.style.top = `${piece.orientation === 'h' ? across : along}px`;
    el.append(pivot);
  }
  return el;
}

// A small tappable mark in the piece's colour, centred on a top-left cell the piece could take.
function dotEl(type, row, col) {
  const el = document.createElement('div');
  el.className = `dot ${type}`;
  el.style.left = `${(col + 0.5) * cell}px`;
  el.style.top = `${(row + 0.5) * cell}px`;
  return el;
}

// Translucent preview of where a drag lands: green when legal, red when not.
function showGhost(piece, isValid) {
  const el = pieceEl(piece);
  el.className = `piece ${piece.type} ghost`;
  el.classList.toggle('invalid', !isValid);
  delete el.dataset.id;
  boardEl.querySelector('.ghost')?.remove();
  boardEl.append(el);
}

// Strips straddling each resizable edge: all four sides of a block, the two ends of a line.
function handlesOf(piece) {
  const { row, col, w, h } = rectOf(piece);
  const isLine = piece.type === 'twin' || piece.type === 'turner';
  const edges = !isLine ? ['left', 'right', 'top', 'bottom'] : piece.orientation === 'h' ? ['left', 'right'] : ['top', 'bottom'];
  const boxes = {
    left: [col * cell - HANDLE / 2, row * cell, HANDLE, h * cell],
    right: [(col + w) * cell - HANDLE / 2, row * cell, HANDLE, h * cell],
    top: [col * cell, row * cell - HANDLE / 2, w * cell, HANDLE],
    bottom: [col * cell, (row + h) * cell - HANDLE / 2, w * cell, HANDLE],
  };
  return edges.map(edge => {
    const [left, top, width, height] = boxes[edge];
    const el = document.createElement('div');
    el.className = `handle ${edge}`;
    el.dataset.edge = edge;
    Object.assign(el.style, { left: `${left}px`, top: `${top}px`, width: `${width}px`, height: `${height}px` });
    return el;
  });
}

// A dashed line between each twin pair's centres, so the pair reads as linked.
function twinLinks(level) {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.classList.add('links');
  const centre = piece => {
    const { row, col, w, h } = rectOf(piece);
    return [(col + w / 2) * cell, (row + h / 2) * cell];
  };
  for (const twin of level.pieces) {
    const partner = level.pieces.find(piece => piece.id === twin.partner);
    if (twin.type !== 'twin' || !partner || twin.id > partner.id) continue;
    const [x1, y1] = centre(twin);
    const [x2, y2] = centre(partner);
    const line = document.createElementNS(SVG_NS, 'line');
    Object.entries({ x1, y1, x2, y2 }).forEach(([name, value]) => line.setAttribute(name, value));
    svg.append(line);
  }
  return svg;
}

function cellAt(event) {
  const box = boardEl.getBoundingClientRect();
  return [
    Math.floor((event.clientY - box.top - boardEl.clientTop) / cell),
    Math.floor((event.clientX - box.left - boardEl.clientLeft) / cell),
  ];
}

const pieceAt = (row, col) => allPieces(view.level).find(piece => cellsOf(piece).some(([r, c]) => r === row && c === col))?.id ?? null;

function onBoardDown(event) {
  if (drag) return; // one pointer at a time
  const edge = event.target.closest('.handle')?.dataset.edge;
  const isDot = Boolean(event.target.closest('.dot'));
  const [row, col] = cellAt(event);
  // A dot can sit on the selected piece in Play: tapping it is a dot tap, dragging it still drags the piece.
  const id = edge ? view.selectedId : isDot ? pieceAt(row, col) : event.target.closest('.piece')?.dataset.id ?? null;
  const canRotate = view.mode === 'edit' && !edge && !isDot && id && id !== 'kid' && id !== view.pendingId;
  drag = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, time: event.timeStamp, id, edge, isDot, canRotate, row, col, isMoving: false, to: null };
  if (edge) {
    drag.original = getPiece(view.level, id);
    drag.cells = 0;
  }
  boardEl.setPointerCapture(event.pointerId);
}

function onPaletteDown(event) {
  const type = event.target.closest('[data-type]')?.dataset.type;
  if (drag || !type) return;
  drag = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, type, isMoving: false, to: null };
  event.currentTarget.setPointerCapture(event.pointerId);
}

function onMove(event) {
  if (!drag || event.pointerId !== drag.pointerId) return;
  const dx = event.clientX - drag.x;
  const dy = event.clientY - drag.y;
  if (!drag.isMoving && Math.hypot(dx, dy) < TAP_SLOP) return;
  drag.isMoving = true;
  if (drag.type) dragNew(event);
  else if (drag.edge) dragEdge(dx, dy);
  else if (drag.id) dragPiece(dx, dy);
}

// From the palette: the default piece centred on the finger's cell.
function dragNew(event) {
  const piece = createPiece(drag.type, 'new', 0, 0);
  const { w, h } = rectOf(piece);
  const [row, col] = cellAt(event);
  drag.to = moveTo(piece, row - Math.floor((h - 1) / 2), col - Math.floor((w - 1) / 2));
  drag.isValid = fits(view.level, drag.to);
  showGhost(drag.to, drag.isValid);
}

// Reports each whole-cell change; main resizes live and redraws.
function dragEdge(dx, dy) {
  const isSide = drag.edge === 'left' || drag.edge === 'right';
  const cells = Math.round((isSide ? dx : dy) / cell);
  if (cells === drag.cells) return;
  drag.cells = cells;
  handlers.resize(drag.original, resizedFromEdge(view.level, drag.original, drag.edge, cells));
}

// Edit: any cell, green or red. Play: along the axis up to the first obstacle, so always legal.
function dragPiece(dx, dy) {
  const piece = getPiece(view.level, drag.id);
  drag.to = view.mode === 'play'
    ? slid(piece, dx, dy)
    : moveTo(piece, piece.row + Math.round(dy / cell), piece.col + Math.round(dx / cell));
  drag.isValid = view.mode === 'play' || fits(view.level, drag.to);
  showGhost(drag.to, drag.isValid);
}

function slid(piece, dx, dy) {
  const { min, max } = slideRange(view.level, piece);
  const isHorizontal = axisOf(piece) === 'h';
  const steps = Math.min(max, Math.max(min, Math.round((isHorizontal ? dx : dy) / cell)));
  return isHorizontal ? moveTo(piece, piece.row, piece.col + steps) : moveTo(piece, piece.row + steps, piece.col);
}

function onUp(event) {
  if (!drag || event.pointerId !== drag.pointerId) return;
  const { id, type, edge, isDot, canRotate, time, row, col, isMoving, to, isValid } = drag;
  drag = null;
  if (!isMoving) {
    if (type) return handlers.arm(type);
    // Long-press rotates only on a lift without movement; moving after the hold was a drag.
    if (canRotate && event.timeStamp - time >= LONG_PRESS_MS) return handlers.rotate(id);
    return handlers.tap(isDot ? null : id, row, col);
  }
  if (edge) return handlers.resizeEnd();
  if (to && isValid && type) return handlers.drop(type, to.row, to.col);
  const from = id && getPiece(view.level, id);
  if (to && isValid && from && (to.row !== from.row || to.col !== from.col)) return handlers.move(id, to.row, to.col);
  draw(); // cancelled: clear the ghost
}

function onCancel(event) {
  if (!drag || event.pointerId !== drag.pointerId) return;
  const { edge } = drag;
  drag = null;
  if (edge) handlers.resizeEnd();
  else draw();
}
