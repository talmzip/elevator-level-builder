// Bottom sheets: the level list (open, drag to reorder) and the generator. Each rebuilds only when its content
// changes and otherwise updates in place, so streaming worker updates never swallow a tap.
import { MOVES_MAX, TYPES } from './generator.js';

const levelsSheet = document.getElementById('levels-sheet');
const genSheet = document.getElementById('gen-sheet');
const TYPE_LABELS = { rigid: 'Rigid', accordion: 'Accordion', twin: 'Twins', turner: 'Turner' };

let builtLevels = null; // signature of the list on screen
let reorder = null; // { row, pointerId, from } while a row is dragged
let builtGen = null; // signature of the generator inputs on screen

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

function header(title, close) {
  const row = el('div', 'sheet-header');
  row.append(el('h2', '', title), button('Done', close, 'primary'));
  return row;
}

// view: { levels, current, movesText(level), open(index), move(from, to), close } or null to hide.
export function renderLevelsSheet(view) {
  levelsSheet.hidden = !view;
  if (!view) {
    builtLevels = null;
    return;
  }
  const signature = JSON.stringify([view.current, view.levels.map(level => [level.id, level.name])]);
  if (signature !== builtLevels && !reorder) {
    builtLevels = signature;
    const list = el('ol', 'level-list');
    view.levels.forEach((level, index) => {
      const row = el('li', 'level-row');
      row.classList.toggle('current', index === view.current);
      row.dataset.index = index;
      const grip = el('span', 'grip', '≡');
      grip.setAttribute('aria-label', 'Drag to reorder');
      row.append(el('span', 'num', String(index + 1)), el('span', 'name', level.name), el('span', 'moves'), grip);
      row.addEventListener('click', event => !event.target.closest('.grip') && view.open(index));
      grip.addEventListener('pointerdown', event => startReorder(event, row, list, view.move));
      list.append(row);
    });
    levelsSheet.replaceChildren(header('Levels', view.close), list);
    levelsSheet.querySelector('.current')?.scrollIntoView({ block: 'nearest' });
  }
  levelsSheet.querySelectorAll('.level-row').forEach(row => {
    const level = view.levels[row.dataset.index];
    if (level) row.querySelector('.moves').textContent = view.movesText(level);
  });
}

// The dragged row follows the pointer through the list; the order is committed on release. Listens on the window:
// moving the row in the DOM drops pointer capture.
function startReorder(event, row, list, move) {
  event.preventDefault();
  reorder = { row, pointerId: event.pointerId, from: Number(row.dataset.index) };
  row.classList.add('dragging');
  const onMove = moveEvent => {
    if (moveEvent.pointerId !== reorder.pointerId) return;
    const others = [...list.children].filter(other => other !== row);
    const before = others.find(other => {
      const box = other.getBoundingClientRect();
      return moveEvent.clientY < box.top + box.height / 2;
    });
    list.insertBefore(row, before ?? null);
  };
  const onEnd = endEvent => {
    if (endEvent.pointerId !== reorder.pointerId) return;
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', onEnd);
    window.removeEventListener('pointercancel', onEnd);
    const { from } = reorder;
    const to = [...list.children].indexOf(row);
    reorder = null;
    builtLevels = null; // rebuild with the new numbering
    move(from, to);
  };
  window.addEventListener('pointermove', onMove);
  window.addEventListener('pointerup', onEnd);
  window.addEventListener('pointercancel', onEnd);
}

function stepper(label, value, min, max, set) {
  const row = el('div', 'stepper');
  const minus = button('−', () => set(value - 1));
  const plus = button('+', () => set(value + 1));
  minus.disabled = value <= min;
  plus.disabled = value >= max;
  row.append(el('span', '', label), minus, el('output', '', String(value)), plus);
  return row;
}

// view: { request, status: { text, isBad }, canGenerate, canAgain, set(request), generate(), again(), close } or null.
export function renderGeneratorSheet(view) {
  genSheet.hidden = !view;
  if (!view) {
    builtGen = null;
    return;
  }
  const { request, set } = view;
  const signature = JSON.stringify(request);
  if (signature !== builtGen) {
    builtGen = signature;
    const change = field => value => set({ ...request, [field]: value });
    const types = el('div', 'type-chips');
    for (const type of TYPES) {
      const isOn = request.types.includes(type);
      const chip = button('', () => set({ ...request, types: isOn ? request.types.filter(t => t !== type) : TYPES.filter(t => t === type || request.types.includes(t)) }), 'type-chip');
      chip.setAttribute('aria-pressed', isOn);
      const icon = el('span', 'icon');
      icon.append(...(type === 'twin' ? [el('i', 'twin'), el('i', 'twin')] : [el('i', type)]));
      chip.append(icon, TYPE_LABELS[type]);
      types.append(chip);
    }
    const actions = el('div', 'popup-actions');
    actions.append(button('Again', () => view.again(), 'again-btn'), button('Generate', () => view.generate(), 'primary generate-btn'));
    genSheet.replaceChildren(
      header('Generate', view.close),
      stepper('Rows', request.rows, 3, 10, change('rows')),
      stepper('Columns', request.cols, 3, 10, change('cols')),
      stepper('Moves', request.moves, 1, MOVES_MAX, change('moves')),
      types,
      el('p', 'gen-status'),
      actions,
    );
  }
  const status = genSheet.querySelector('.gen-status');
  status.textContent = view.status.text;
  status.classList.toggle('bad', view.status.isBad);
  genSheet.querySelector('.generate-btn').disabled = !view.canGenerate;
  genSheet.querySelector('.again-btn').disabled = !view.canAgain;
}

export const sheetTop = () => [levelsSheet, genSheet].find(sheet => !sheet.hidden)?.getBoundingClientRect() ?? null;
