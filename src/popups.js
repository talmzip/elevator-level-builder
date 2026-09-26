// Floating panels: grid size, and the selected piece's controls (Edit and Play variants).
import { FOLD_SIDES, HEAD_DIRS, accordionWith, foldSideFor, lineAxis, maxSide, maxTurnerLength, resize, twinTransfer } from './rules.js';

const piecePopup = document.getElementById('piece-popup');
const gridPopup = document.getElementById('grid-popup');
const menuPopup = document.getElementById('menu-popup');
const GAP = 8;

function el(tag, className, text = '') {
  const node = document.createElement(tag);
  node.className = className;
  node.textContent = text;
  return node;
}

function button(text, onClick, className = '') {
  const node = el('button', className, text);
  node.type = 'button';
  node.addEventListener('click', onClick);
  return node;
}

// Discrete slider. onLive (Edit resizes) reports every step; onChange fires on release.
function slider(label, min, max, step, value, format, onChange, onLive) {
  const row = el('label', 'control');
  const input = Object.assign(document.createElement('input'), { type: 'range', min, max, step, value, disabled: min === max });
  const output = el('output', '', format(value));
  input.addEventListener('input', () => {
    const next = Number(input.value);
    output.textContent = format(next);
    onLive?.(next);
  });
  input.addEventListener('change', () => onChange(Number(input.value)));
  row.append(el('span', '', label), input, output);
  return row;
}

const TEXT = { left: '←', right: '→', up: '↑', down: '↓', false: 'Exposed', true: 'Folded' };

// A label and a segmented row of buttons, the current value pressed.
function choiceRow(label, values, current, choose) {
  const row = el('div', 'control choice');
  const buttons = el('div', 'segments');
  for (const value of values) {
    const node = button(TEXT[value], () => value !== current && choose(value));
    node.setAttribute('aria-pressed', value === current);
    node.setAttribute('aria-label', `${label} ${value}`);
    buttons.append(node);
  }
  row.append(el('span', '', label), buttons);
  return row;
}

function actionRow(...buttons) {
  const row = el('div', 'popup-actions');
  row.append(...buttons);
  return row;
}

// Design § 3 (Edit) and § 4 (Play) tables. Rotation is a long-press on the board, not a control here.
function controlsFor({ level, piece, mode, apply, resizeLive, resizeEnd, remove }) {
  if (mode === 'play') {
    // Accordion and turner cycle by tap alone; twins keep a slider for fine control, committed on release.
    if (piece.type !== 'twin') return [];
    const partner = level.pieces.find(other => other.id === piece.partner);
    return [slider('Length', 1, piece.length + partner.length - 1, 1, piece.length, String,
      length => apply(twinTransfer(level, piece, length)))];
  }

  // Edit sliders resize live; a release after a step with no room snaps back.
  const live = (label, min, max, step, value, sized) =>
    slider(label, min, max, step, value, String, resizeEnd, next => resizeLive(piece, sized(next)));
  const remover = actionRow(button('Delete', () => remove(piece), 'danger'));
  // Accordion changes keep the tail in place; no room shakes.
  const change = changes => apply([accordionWith(piece, changes)]);
  switch (piece.type) {
    case 'accordion': return [
      choiceRow('Head', HEAD_DIRS, piece.dir, dir => change({ dir, side: foldSideFor(dir, piece.side) })),
      choiceRow('Fold side', FOLD_SIDES[lineAxis(piece.dir)], piece.side, side => change({ side })),
      choiceRow('Starts', [false, true], piece.folded, folded => change({ folded })),
      remover,
    ];
    case 'rigid': return [
      live('Width', 1, maxSide(level, 'h'), 1, piece.w, w => resize(piece, w, piece.h)),
      live('Height', 1, maxSide(level, 'v'), 1, piece.h, h => resize(piece, piece.w, h)),
      remover,
    ];
    case 'twin': return [
      live('Length', 1, maxSide(level, piece.orientation), 1, piece.length, length => ({ ...piece, length })),
      remover,
    ];
    case 'turner': return [
      live('Length', 3, maxTurnerLength(level, piece.orientation), 2, piece.length, length => ({ ...piece, length })),
      remover,
    ];
    default: return [];
  }
}

// Keeps the popup on screen: above the target when there's room, otherwise below.
function place(popup, target) {
  const { offsetWidth: width, offsetHeight: height } = popup;
  let top = target.top - height - GAP;
  if (top < GAP) top = target.bottom + GAP;
  top = Math.max(GAP, Math.min(top, window.innerHeight - height - GAP));
  const left = Math.max(GAP, Math.min(target.left + target.width / 2 - width / 2, window.innerWidth - width - GAP));
  popup.style.top = `${top}px`;
  popup.style.left = `${left}px`;
}

// view: { level, piece, mode, anchor, apply, resizeLive, resizeEnd, remove } or null to hide.
export function renderPiecePopup(view) {
  const controls = view ? controlsFor(view) : [];
  piecePopup.hidden = !controls.length;
  if (!controls.length) return;
  piecePopup.replaceChildren(...controls);
  place(piecePopup, view.anchor.getBoundingClientRect());
}

// view: { level, anchor, resizeGrid(rows, cols), close } or null to hide.
export function renderGridPopup(view) {
  gridPopup.hidden = !view;
  if (!view) return;
  const { level, anchor, resizeGrid, close } = view;
  const stepper = (label, value, set) => {
    const row = el('div', 'stepper');
    const step = delta => button(delta < 0 ? '−' : '+', () => set(value + delta));
    const [minus, plus] = [step(-1), step(1)];
    minus.disabled = value <= 3;
    plus.disabled = value >= 10;
    row.append(el('span', '', label), minus, el('output', '', String(value)), plus);
    return row;
  };
  gridPopup.replaceChildren(
    el('h2', '', 'Grid size'),
    stepper('Rows', level.rows, rows => resizeGrid(rows, level.cols)),
    stepper('Columns', level.cols, cols => resizeGrid(level.rows, cols)),
    button('Done', close, 'primary'),
  );
  place(gridPopup, anchor.getBoundingClientRect());
}

// view: { anchor, items: [[label, onClick], …] } or null to hide.
export function renderMenuPopup(view) {
  menuPopup.hidden = !view;
  if (!view) return;
  menuPopup.replaceChildren(...view.items.map(([label, onClick]) => button(label, onClick)));
  place(menuPopup, view.anchor.getBoundingClientRect());
}
