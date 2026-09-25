// Board: draws grid, exit and pieces; turns pointer input into taps and drags.
import { allPieces, axisOf, fits, moveTo, rectOf, slideRange } from './rules.js';
import { getPiece, withPiece } from './model.js';

const TAP_SLOP = 8; // px a pointer may travel and still count as a tap
const INSET = 3; // px gap between a piece and its cell borders
const SVG_NS = 'http://www.w3.org/2000/svg';

let boardEl;
let handlers;
let view; // { level, mode, selectedId, pendingId }
let cell;
let drag = null;

// handlers: tap(pieceId | null, row, col), move(pieceId, row, col)
export function initBoard(el, boardHandlers) {
  boardEl = el;
  handlers = boardHandlers;
  el.addEventListener('pointerdown', onDown);
  el.addEventListener('pointermove', onMove);
  el.addEventListener('pointerup', onUp);
  el.addEventListener('pointercancel', () => {
    drag = null;
    draw(view.level);
  });
}

export function renderBoard(nextView, cellSize) {
  view = nextView;
  cell = cellSize;
  document.documentElement.style.setProperty('--cell', `${cell}px`);
  draw(view.level);
}

export const pieceElement = id => boardEl.querySelector(`[data-id="${id}"]`);

export function shake(id) {
  const el = pieceElement(id);
  if (!el) return;
  el.classList.remove('shake');
  void el.offsetWidth; // restart the animation
  el.classList.add('shake');
}

function draw(level, invalidId = null) {
  boardEl.style.width = `${level.cols * cell}px`;
  boardEl.style.height = `${level.rows * cell}px`;
  const exit = document.createElement('div');
  exit.className = 'exit';
  exit.textContent = 'EXIT';
  exit.style.left = `${level.kid.col * cell}px`;
  const pieces = allPieces(level).map(piece => pieceEl(piece, piece.id === invalidId));
  boardEl.replaceChildren(exit, twinLinks(level), ...pieces);
}

function pieceEl(piece, isInvalid) {
  const { row, col, w, h } = rectOf(piece);
  const el = document.createElement('div');
  el.className = `piece ${piece.type}`;
  el.classList.toggle('selected', piece.id === view.selectedId);
  el.classList.toggle('pending', piece.id === view.pendingId);
  el.classList.toggle('invalid', isInvalid);
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

function onDown(event) {
  if (drag) return; // one pointer at a time
  const box = boardEl.getBoundingClientRect();
  drag = {
    pointerId: event.pointerId,
    id: event.target.closest('.piece')?.dataset.id ?? null,
    x: event.clientX,
    y: event.clientY,
    row: Math.floor((event.clientY - box.top - boardEl.clientTop) / cell),
    col: Math.floor((event.clientX - box.left - boardEl.clientLeft) / cell),
    isMoving: false,
    to: null,
  };
  boardEl.setPointerCapture(event.pointerId);
}

function onMove(event) {
  if (!drag || event.pointerId !== drag.pointerId) return;
  const dx = event.clientX - drag.x;
  const dy = event.clientY - drag.y;
  if (!drag.isMoving && Math.hypot(dx, dy) < TAP_SLOP) return;
  drag.isMoving = true;
  if (!drag.id) return;
  const piece = getPiece(view.level, drag.id);
  // Edit: free move to any cell. Play: slide along the axis, stopping at the first obstacle.
  drag.to = view.mode === 'play'
    ? slid(piece, dx, dy)
    : moveTo(piece, piece.row + Math.round(dy / cell), piece.col + Math.round(dx / cell));
  drag.isValid = view.mode === 'play' || fits(view.level, drag.to);
  draw(withPiece(view.level, drag.to), drag.isValid ? null : drag.id);
}

function slid(piece, dx, dy) {
  const { min, max } = slideRange(view.level, piece);
  const isHorizontal = axisOf(piece) === 'h';
  const steps = Math.min(max, Math.max(min, Math.round((isHorizontal ? dx : dy) / cell)));
  return isHorizontal ? moveTo(piece, piece.row, piece.col + steps) : moveTo(piece, piece.row + steps, piece.col);
}

function onUp(event) {
  if (!drag || event.pointerId !== drag.pointerId) return;
  const { id, row, col, isMoving, to, isValid } = drag;
  drag = null;
  if (!isMoving) return handlers.tap(id, row, col);
  const from = id && getPiece(view.level, id);
  if (to && isValid && (to.row !== from.row || to.col !== from.col)) handlers.move(id, to.row, to.col);
  else draw(view.level);
}
