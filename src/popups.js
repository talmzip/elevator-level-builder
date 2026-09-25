// Floating panels: grid size, and the selected piece's controls (Edit and Play variants).
import { accordionStates, resize, turnerRotated, turnerTurn, twinTransfer } from './rules.js';

const piecePopup = document.getElementById('piece-popup');
const gridPopup = document.getElementById('grid-popup');
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

// Discrete slider; commits on release so an illegal value can snap back without fighting the finger.
function slider(label, min, max, step, value, format, onChange) {
  const row = el('label', 'control');
  const input = Object.assign(document.createElement('input'), { type: 'range', min, max, step, value, disabled: min === max });
  const output = el('output', '', format(value));
  input.addEventListener('input', () => { output.textContent = format(Number(input.value)); });
  input.addEventListener('change', () => onChange(Number(input.value)));
  row.append(el('span', '', label), input, output);
  return row;
}

function actionRow(...buttons) {
  const row = el('div', 'popup-actions');
  row.append(...buttons);
  return row;
}

const flip = direction => (direction === 'h' ? 'v' : 'h');
const largestOdd = n => (n % 2 ? n : n - 1);

// Design § 3 (Edit) and § 4 (Play) tables. apply(...pieces) commits or snaps back; remove(piece) deletes.
function controlsFor({ level, piece, mode, apply, remove }) {
  const partner = level.pieces.find(other => other.id === piece.partner);
  const twinLength = () => slider('Length', 1, piece.length + partner.length - 1, 1, piece.length, String,
    length => apply(...twinTransfer(level, piece, length)));

  if (mode === 'play') {
    switch (piece.type) {
      case 'accordion': {
        const states = accordionStates(level, piece);
        const current = states.findIndex(state => state.w === piece.w && state.h === piece.h);
        return [slider('Shape', 0, states.length - 1, 1, current, index => `${states[index].w}×${states[index].h}`,
          index => apply(resize(piece, states[index].w, states[index].h)))];
      }
      case 'twin': return [twinLength()];
      case 'turner': return [slider('Turn', 0, 1, 1, piece.orientation === 'h' ? 0 : 1, value => (value ? '90°' : '0°'),
        () => apply(turnerTurn(level, piece)))];
      default: return [];
    }
  }

  const remover = button('Delete', () => remove(piece), 'danger');
  const orienter = next => button('Orientation', () => apply(next));
  const sizeSliders = () => [
    slider('Width', 1, level.cols - 1, 1, piece.w, String, w => apply(resize(piece, w, piece.h))),
    slider('Height', 1, level.rows - 1, 1, piece.h, String, h => apply(resize(piece, piece.w, h))),
  ];
  switch (piece.type) {
    case 'rigid': return [
      ...sizeSliders(),
      actionRow(...(piece.w === piece.h ? [orienter({ ...piece, axis: flip(piece.axis) })] : []), remover),
    ];
    case 'accordion': return [...sizeSliders(), actionRow(remover)];
    case 'twin': return [twinLength(), actionRow(orienter({ ...piece, orientation: flip(piece.orientation) }), remover)];
    case 'turner': {
      const max = Math.max(3, largestOdd((piece.orientation === 'h' ? level.cols : level.rows) - 1));
      return [
        slider('Length', 3, max, 2, piece.length, String, length => apply({ ...piece, length })),
        actionRow(orienter(turnerRotated(piece)), remover),
      ];
    }
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

// view: { level, piece, mode, anchor, apply, remove } or null to hide.
export function renderPiecePopup(view) {
  const controls = view ? controlsFor(view) : [];
  piecePopup.hidden = !controls.length;
  if (!controls.length) return;
  piecePopup.replaceChildren(...controls);
  place(piecePopup, view.anchor.getBoundingClientRect());
}

// view: { level, anchor, resizeGrid(rows, cols) → boolean, close } or null to hide.
export function renderGridPopup(view) {
  gridPopup.hidden = !view;
  if (!view) return;
  const { level, anchor, resizeGrid, close } = view;
  const note = el('p', 'popup-note');
  const stepper = (label, value, set) => {
    const row = el('div', 'stepper');
    const step = delta => button(delta < 0 ? '−' : '+', () => {
      if (!set(value + delta)) note.textContent = 'A piece is in the way. Move it first.';
    });
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
    note,
    button('Done', close, 'primary'),
  );
  place(gridPopup, anchor.getBoundingClientRect());
}
