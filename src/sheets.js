// Bottom sheets: the level list (open, drag to reorder) and the generator. Each rebuilds only when its content
// changes and otherwise updates in place, so streaming worker updates never swallow a tap.
import { MOVES_MAX, TYPES } from './generator.js';

const levelsSheet = document.getElementById('levels-sheet');
const genSheet = document.getElementById('gen-sheet');
const TYPE_LABELS = { rigid: 'Rigid', accordion: 'Accordion', twin: 'Twins', turner: 'Turner' };

let builtLevels = null; // signature of the list on screen
let isReordering = false; // a row is being dragged: hold rebuilds
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

// view: { levels, current, mode, selected, importCount, message, movesText(level), open(index), move(from, to),
// toggle(id), setAll(isOn), select(), cancel(), exportSelected(), deleteSelected(), exportAll(), import(),
// place(afterIndex), close } or null to hide. Modes: 'browse' (open, drag to reorder), 'select' (tick levels to
// export or delete), 'place' (tap the level the import goes after).
export function renderLevelsSheet(view) {
  levelsSheet.hidden = !view;
  if (!view) {
    builtLevels = null;
    return;
  }
  const signature = JSON.stringify([view.mode, view.current, view.levels.map(level => [level.id, level.name])]);
  if (signature !== builtLevels && !isReordering) {
    const isFirst = builtLevels === null;
    builtLevels = signature;
    levelsSheet.replaceChildren(levelsHeader(view), levelsList(view), el('p', 'sheet-note'), levelsFooter(view));
    if (isFirst) levelsSheet.querySelector('.current')?.scrollIntoView({ block: 'nearest' });
  }
  // In place, so a streaming update never rebuilds a button under the finger.
  const count = view.selected.size;
  levelsSheet.querySelectorAll('.level-row[data-id]').forEach(row => {
    const level = view.levels[row.dataset.index];
    row.querySelector('.moves').textContent = level ? view.movesText(level) : '';
    row.classList.toggle('selected', view.selected.has(row.dataset.id));
  });
  const set = (selector, text, isDisabled) => {
    const node = levelsSheet.querySelector(selector);
    if (!node) return;
    node.textContent = text;
    if (isDisabled !== undefined) node.disabled = isDisabled;
  };
  set('.select-count', `${count} selected`);
  set('.select-all', count === view.levels.length ? 'None' : 'All');
  set('.export-selected', `Export (${count})`, !count);
  set('.delete-selected', `Delete (${count})`, !count);
  set('.sheet-note', view.message ?? '');
}

function levelsHeader(view) {
  const row = el('div', 'sheet-header');
  if (view.mode === 'select') {
    const tools = el('div', 'header-tools');
    tools.append(button('All', () => view.setAll(view.selected.size !== view.levels.length), 'select-all'), button('Cancel', view.cancel));
    row.append(el('h2', 'select-count'), tools);
  } else if (view.mode === 'place') {
    row.append(el('h2', '', `Insert ${view.importCount} level${view.importCount === 1 ? '' : 's'} after…`), button('Cancel', view.cancel));
  } else {
    const tools = el('div', 'header-tools');
    tools.append(button('Select', view.select), button('Done', view.close, 'primary'));
    row.append(el('h2', '', 'Levels'), tools);
  }
  return row;
}

function levelsList(view) {
  const list = el('ol', `level-list ${view.mode}`);
  if (view.mode === 'place') {
    const start = el('li', 'level-row place-start', 'At the start');
    start.addEventListener('click', () => view.place(-1));
    list.append(start);
  }
  view.levels.forEach((level, index) => {
    const row = el('li', 'level-row');
    row.classList.toggle('current', index === view.current);
    Object.assign(row.dataset, { index, id: level.id });
    const trailing = view.mode === 'browse' ? el('span', 'grip', '≡') : el('span', 'mark');
    if (view.mode === 'browse') trailing.setAttribute('aria-label', 'Drag to reorder');
    row.append(el('span', 'num', String(index + 1)), el('span', 'name', level.name), el('span', 'moves'), trailing);
    row.addEventListener('click', event => {
      if (event.target.closest('.grip')) return;
      if (view.mode === 'select') view.toggle(level.id);
      else if (view.mode === 'place') view.place(index);
      else view.open(index);
    });
    if (view.mode === 'browse') trailing.addEventListener('pointerdown', event => startReorder(event, row, list, view.move));
    list.append(row);
  });
  return list;
}

function levelsFooter(view) {
  const row = el('div', 'popup-actions');
  if (view.mode === 'select') {
    row.append(button('', view.exportSelected, 'export-selected'), button('', view.deleteSelected, 'danger delete-selected'));
  } else if (view.mode === 'browse') {
    row.append(button('Import', view.import), button('Export all', view.exportAll));
  }
  return row;
}

const AUTOSCROLL_EDGE = 48; // px inside the list's visible area (between pinned header and footer) where a drag scrolls
const AUTOSCROLL_STEP = 8; // px per frame

// Live reorder: the dragged row follows the finger, the rows it passes slide out of the way and every number shows
// its position-to-be. Near the sheet's edges the list scrolls. The order is committed on release.
function startReorder(event, row, list, move) {
  event.preventDefault();
  const rows = [...list.children];
  const from = rows.indexOf(row);
  const pitch = rows.length > 1 ? rows[1].offsetTop - rows[0].offsetTop : row.offsetHeight;
  const startY = event.clientY;
  const startScroll = levelsSheet.scrollTop;
  let lastY = startY;
  let to = from;
  let frame = 0;
  isReordering = true;
  row.classList.add('dragging');
  list.classList.add('reordering');

  const layout = () => {
    const dy = lastY - startY + levelsSheet.scrollTop - startScroll;
    to = Math.max(0, Math.min(rows.length - 1, from + Math.round(dy / pitch)));
    rows.forEach((other, index) => {
      let position = index;
      if (other === row) {
        other.style.transform = `translateY(${dy}px)`;
        position = to;
      } else {
        const shift = from < to && index > from && index <= to ? -1 : from > to && index >= to && index < from ? 1 : 0;
        other.style.transform = shift ? `translateY(${shift * pitch}px)` : '';
        position = index + shift;
      }
      other.querySelector('.num').textContent = String(position + 1);
    });
  };
  const autoscroll = () => {
    const top = levelsSheet.querySelector('.sheet-header').getBoundingClientRect().bottom;
    const footer = levelsSheet.querySelector(':scope > .popup-actions');
    const bottom = footer?.offsetHeight ? footer.getBoundingClientRect().top : levelsSheet.getBoundingClientRect().bottom;
    const step = lastY < top + AUTOSCROLL_EDGE ? -AUTOSCROLL_STEP : lastY > bottom - AUTOSCROLL_EDGE ? AUTOSCROLL_STEP : 0;
    if (step) {
      levelsSheet.scrollTop += step;
      layout();
    }
    frame = requestAnimationFrame(autoscroll);
  };
  const onMove = moveEvent => {
    if (moveEvent.pointerId !== event.pointerId) return;
    lastY = moveEvent.clientY;
    layout();
  };
  const onEnd = endEvent => {
    if (endEvent.pointerId !== event.pointerId) return;
    cancelAnimationFrame(frame);
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', onEnd);
    window.removeEventListener('pointercancel', onEnd);
    rows.forEach(other => { other.style.transform = ''; });
    isReordering = false;
    builtLevels = null; // rebuild with the new order
    move(from, endEvent.type === 'pointercancel' ? from : to);
  };
  window.addEventListener('pointermove', onMove);
  window.addEventListener('pointerup', onEnd);
  window.addEventListener('pointercancel', onEnd);
  frame = requestAnimationFrame(autoscroll);
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
