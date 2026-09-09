const ITEM_TYPES = ['todo'];
const TRASHABLE_TYPES = ['todo', 'slogan'];
const VALID_TABS = ['todo', 'history', 'slogan', 'trash'];
const VALID_SELECTED_KINDS = ['item', 'slogan'];
const MIN_FOCUS_MINUTES = 1;
const MAX_FOCUS_MINUTES = 240;
const DEFAULT_FOCUS_MINUTES = 25;
const MAX_ITEM_TEXT_LENGTH = 500;
const MAX_NOTE_LENGTH = 500;

function nowIso() {
  return new Date().toISOString();
}

function createInitialState() {
  return {
    modifiedAt: new Date(0).toISOString(),
    items: [],
    slogans: [],
    trash: [],
    selectedId: null,
    selectedKind: null,
    activeTab: 'todo',
    compact: false,
    pinned: true,
    backstage: false,
    timerView: false,
    focusMinutes: DEFAULT_FOCUS_MINUTES,
    focusMode: 'standard',
    timerRemainingSeconds: DEFAULT_FOCUS_MINUTES * 60,
    timerRunning: false,
    timerFinished: false
  };
}

function createId(prefix = 'id') {
  const random =
    globalThis.crypto?.randomUUID?.().replaceAll('-', '') ||
    `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 12)}`;
  return `${prefix}_${random}`;
}

function activeItems(state, type) {
  return state.items
    .filter((item) => item.type === type && item.status === 'active')
    .sort((a, b) => a.order - b.order);
}

function focusModeForMinutes(minutes) {
  if (minutes === 5) return 'ice';
  if (minutes === 25) return 'standard';
  if (minutes === 45) return 'deep';
  return 'custom';
}

function cleanText(value, maxLength = MAX_ITEM_TEXT_LENGTH) {
  const text = String(value ?? '').trim();
  return text.length > maxLength ? text.slice(0, maxLength) : text;
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function validIso(value, fallback = nowIso()) {
  if (typeof value !== 'string') return fallback;
  return Number.isNaN(new Date(value).getTime()) ? fallback : value;
}

function stateModifiedAt(value, records) {
  if (typeof value === 'string' && !Number.isNaN(new Date(value).getTime())) return value;
  const timestamps = [
    ...records.items.flatMap((item) => [item.createdAt, item.completedAt]),
    ...records.slogans.map((item) => item.createdAt),
    ...records.trash.flatMap((item) => [item.createdAt, item.deletedAt])
  ].filter((entry) => typeof entry === 'string' && !Number.isNaN(new Date(entry).getTime()));
  return timestamps.length
    ? new Date(Math.max(...timestamps.map((entry) => new Date(entry).getTime()))).toISOString()
    : new Date(0).toISOString();
}

function clampInteger(value, min, max, fallback) {
  if (value === null || value === undefined || value === '') return fallback;
  const number = Number(value);
  if (!Number.isInteger(number)) return fallback;
  return Math.min(max, Math.max(min, number));
}

function nextOrder(records, type) {
  return Math.max(0, ...records.filter((record) => !type || record.type === type).map((record) => record.order || 0)) + 1;
}

function usableId(value) {
  return typeof value === 'string' && /^[a-zA-Z0-9:_-]+$/.test(value);
}

function uniqueId(value, prefix, seen) {
  let id = usableId(value) ? value : createId(prefix);
  while (seen.has(id)) id = createId(prefix);
  seen.add(id);
  return id;
}

function normalizedOrder(records) {
  return records
    .sort((a, b) => {
      const orderDiff = (a.order || 0) - (b.order || 0);
      if (orderDiff !== 0) return orderDiff;
      return new Date(a.createdAt) - new Date(b.createdAt);
    })
    .map((record, index) => ({ ...record, order: index + 1 }));
}

function normalizeState(value) {
  const base = createInitialState();
  if (!value || typeof value !== 'object') return base;

  const seenIds = new Set();
  const focusMinutes = clampInteger(value.focusMinutes, MIN_FOCUS_MINUTES, MAX_FOCUS_MINUTES, DEFAULT_FOCUS_MINUTES);
  const maxTimerSeconds = focusMinutes * 60;
  const timerRemainingSeconds = clampInteger(value.timerRemainingSeconds, 0, maxTimerSeconds, maxTimerSeconds);
  const timerFinished = timerRemainingSeconds === 0;
  const timerRunning = Boolean(value.timerRunning) && timerRemainingSeconds > 0 && !timerFinished;

  const items = normalizedOrder(
    asArray(value.items)
      .filter((item) => item && item.type === 'todo')
      .map((item) => {
        const text = cleanText(item.text);
        if (!text) return null;
        const status = item.status === 'completed' ? 'completed' : 'active';
        const completedAt = status === 'completed' ? validIso(item.completedAt, validIso(item.createdAt)) : null;
        const completionNote =
          status === 'completed' && typeof item.completionNote === 'string'
            ? cleanText(item.completionNote, MAX_NOTE_LENGTH) || null
            : null;
        const note =
          typeof item.note === 'string' ? cleanText(item.note, MAX_NOTE_LENGTH) || null : null;
        return {
          id: uniqueId(item.id, 'todo', seenIds),
          type: 'todo',
          text,
          createdAt: validIso(item.createdAt),
          completedAt,
          note,
          completionNote,
          status,
          order: clampInteger(item.order, 1, Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER)
        };
      })
      .filter(Boolean)
  );

  const slogans = normalizedOrder(
    asArray(value.slogans)
      .map((slogan) => {
        const text = cleanText(slogan?.text);
        if (!text) return null;
        return {
          id: uniqueId(slogan.id, 'slogan', seenIds),
          type: 'slogan',
          text,
          createdAt: validIso(slogan.createdAt),
          order: clampInteger(slogan.order, 1, Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER)
        };
      })
      .filter(Boolean)
  );

  const trash = asArray(value.trash)
    .map((record) => {
      if (!record || !TRASHABLE_TYPES.includes(record.type)) return null;
      const text = cleanText(record.text);
      if (!text) return null;
      const originalKind = record.originalKind === 'slogan' || record.type === 'slogan' ? 'slogan' : 'item';
      return {
        ...record,
        id: uniqueId(record.id, record.type, seenIds),
        type: record.type,
        text,
        createdAt: validIso(record.createdAt),
        completedAt: record.type === 'todo' && record.completedAt ? validIso(record.completedAt) : null,
        deletedAt: validIso(record.deletedAt),
        originalKind
      };
    })
    .filter(Boolean)
    .sort((a, b) => new Date(b.deletedAt) - new Date(a.deletedAt));

  const selectedRecordExists =
    value.selectedKind === 'item'
      ? items.some((item) => item.id === value.selectedId)
      : value.selectedKind === 'slogan' && slogans.some((slogan) => slogan.id === value.selectedId);

  return {
    ...base,
    modifiedAt: stateModifiedAt(value.modifiedAt, { items, slogans, trash }),
    items,
    slogans,
    trash,
    selectedId: selectedRecordExists ? value.selectedId : null,
    selectedKind: selectedRecordExists && VALID_SELECTED_KINDS.includes(value.selectedKind) ? value.selectedKind : null,
    activeTab: VALID_TABS.includes(value.activeTab) ? value.activeTab : base.activeTab,
    compact: Boolean(value.compact),
    pinned: value.pinned !== false,
    backstage: Boolean(value.backstage),
    timerView: Boolean(value.timerView),
    focusMinutes,
    focusMode: focusModeForMinutes(focusMinutes),
    timerRemainingSeconds,
    timerRunning,
    timerFinished
  };
}

function completedTodos(state) {
  return state.items
    .filter((item) => item.type === 'todo' && item.status === 'completed')
    .sort((a, b) => new Date(b.completedAt) - new Date(a.completedAt));
}

function addItem(state, type, text, createdAt = nowIso()) {
  if (!ITEM_TYPES.includes(type)) throw new Error(`Unsupported item type: ${type}`);
  const textValue = cleanText(text);
  if (!textValue) return state;

  const nextItemOrder = nextOrder(state.items, type);
  const item = {
    id: createId(type),
    type,
    text: textValue,
    createdAt: validIso(createdAt),
    completedAt: null,
    note: null,
    completionNote: null,
    status: 'active',
    order: nextItemOrder
  };

  return {
    ...state,
    items: [...state.items, item],
    selectedId: item.id,
    selectedKind: 'item'
  };
}

function updateItemText(state, id, text) {
  const textValue = cleanText(text);
  if (!textValue) return state;
  return {
    ...state,
    items: state.items.map((item) => (item.id === id ? { ...item, text: textValue } : item))
  };
}

function updateItemNote(state, id, note) {
  const noteValue = cleanText(note, MAX_NOTE_LENGTH) || null;
  return {
    ...state,
    items: state.items.map((item) => (item.id === id ? { ...item, note: noteValue } : item))
  };
}

function completeTodo(state, id, completedAt = nowIso(), completionNote = '') {
  if (!state.items.some((item) => item.id === id && item.type === 'todo' && item.status === 'active')) return state;
  const note = cleanText(completionNote, MAX_NOTE_LENGTH) || null;
  return {
    ...state,
    items: state.items.map((item) =>
      item.id === id && item.type === 'todo' && item.status === 'active'
        ? { ...item, status: 'completed', completedAt: validIso(completedAt), completionNote: note }
        : item
    ),
    selectedId: state.selectedId === id ? null : state.selectedId,
    selectedKind: state.selectedId === id ? null : state.selectedKind
  };
}

function restoreCompletedTodo(state, id) {
  if (!state.items.some((item) => item.id === id && item.type === 'todo' && item.status === 'completed')) return state;
  const nextItemOrder = nextOrder(state.items, 'todo');
  return {
    ...state,
    items: state.items.map((item) =>
      item.id === id && item.type === 'todo' && item.status === 'completed'
        ? { ...item, status: 'active', completedAt: null, completionNote: null, order: nextItemOrder }
        : item
    ),
    selectedId: id,
    selectedKind: 'item',
    activeTab: 'todo'
  };
}

function addSlogan(state, text, createdAt = nowIso()) {
  const textValue = cleanText(text);
  if (!textValue) return state;
  const slogan = {
    id: createId('slogan'),
    type: 'slogan',
    text: textValue,
    createdAt: validIso(createdAt),
    order: nextOrder(state.slogans)
  };
  return {
    ...state,
    slogans: [...state.slogans, slogan],
    selectedId: slogan.id,
    selectedKind: 'slogan'
  };
}

function updateSloganText(state, id, text) {
  const textValue = cleanText(text);
  if (!textValue) return state;
  return {
    ...state,
    slogans: state.slogans.map((slogan) => (slogan.id === id ? { ...slogan, text: textValue } : slogan))
  };
}

function reorderTodoByDrop(state, draggedId, targetId) {
  if (draggedId === targetId) return state;
  const todos = activeItems(state, 'todo');
  const from = todos.findIndex((todo) => todo.id === draggedId);
  const to = todos.findIndex((todo) => todo.id === targetId);
  if (from < 0 || to < 0) return state;

  const reordered = [...todos];
  const [dragged] = reordered.splice(from, 1);
  reordered.splice(to, 0, dragged);
  const orderMap = new Map(reordered.map((todo, index) => [todo.id, index + 1]));

  return {
    ...state,
    items: state.items.map((item) => (orderMap.has(item.id) ? { ...item, order: orderMap.get(item.id) } : item))
  };
}

function pinTodoToTop(state, id) {
  const todos = activeItems(state, 'todo');
  const selectedIndex = todos.findIndex((todo) => todo.id === id);
  if (selectedIndex <= 0) return state;

  const selected = todos[selectedIndex];
  const reordered = [selected, ...todos.filter((todo) => todo.id !== id)];
  const orderMap = new Map(reordered.map((todo, index) => [todo.id, index + 1]));

  return {
    ...state,
    items: state.items.map((item) => (orderMap.has(item.id) ? { ...item, order: orderMap.get(item.id) } : item))
  };
}

function restoreTodoOrder(state, orderedIds) {
  if (!Array.isArray(orderedIds)) return state;
  const todos = activeItems(state, 'todo');
  const todoById = new Map(todos.map((todo) => [todo.id, todo]));
  const restored = [];
  const seen = new Set();

  orderedIds.forEach((id) => {
    if (!seen.has(id) && todoById.has(id)) {
      restored.push(todoById.get(id));
      seen.add(id);
    }
  });
  todos.forEach((todo) => {
    if (!seen.has(todo.id)) restored.push(todo);
  });

  if (restored.every((todo, index) => todo.id === todos[index]?.id)) return state;
  const orderMap = new Map(restored.map((todo, index) => [todo.id, index + 1]));
  return {
    ...state,
    items: state.items.map((item) => (orderMap.has(item.id) ? { ...item, order: orderMap.get(item.id) } : item))
  };
}

function softDelete(state, kind, id, deletedAt = nowIso()) {
  if (!['item', 'slogan'].includes(kind)) return state;
  const source = kind === 'item' ? state.items : state.slogans;
  const record = source.find((entry) => entry.id === id);
  if (!record || !TRASHABLE_TYPES.includes(record.type)) return state;

  const trashRecord = {
    ...record,
    deletedAt: validIso(deletedAt),
    originalKind: kind
  };

  return {
    ...state,
    items: kind === 'item' ? state.items.filter((item) => item.id !== id) : state.items,
    slogans: kind === 'slogan' ? state.slogans.filter((slogan) => slogan.id !== id) : state.slogans,
    trash: [trashRecord, ...state.trash],
    selectedId: state.selectedId === id ? null : state.selectedId,
    selectedKind: state.selectedId === id ? null : state.selectedKind
  };
}

function restoreFromTrash(state, id) {
  const record = state.trash.find((entry) => entry.id === id);
  if (!record) return state;
  const originalKind = record.originalKind === 'slogan' ? 'slogan' : 'item';
  const restored = { ...record };
  delete restored.deletedAt;
  delete restored.originalKind;
  if (originalKind === 'item') restored.order = nextOrder(state.items, restored.type);
  if (originalKind === 'slogan') restored.order = nextOrder(state.slogans);

  return {
    ...state,
    items: originalKind === 'item' ? [...state.items, restored] : state.items,
    slogans: originalKind === 'slogan' ? [...state.slogans, restored] : state.slogans,
    trash: state.trash.filter((entry) => entry.id !== id),
    selectedId: restored.id,
    selectedKind: originalKind
  };
}

function permanentlyDelete(state, id) {
  return {
    ...state,
    trash: state.trash.filter((entry) => entry.id !== id)
  };
}

function selectedRecord(state) {
  if (!state.selectedId || !state.selectedKind) return null;
  if (state.selectedKind === 'item') {
    return state.items.find((item) => item.id === state.selectedId) || null;
  }
  if (state.selectedKind === 'slogan') {
    return state.slogans.find((slogan) => slogan.id === state.selectedId) || null;
  }
  return null;
}

const store = {
  createInitialState,
  normalizeState,
  addItem,
  updateItemText,
  updateItemNote,
  completeTodo,
  restoreCompletedTodo,
  addSlogan,
  updateSloganText,
  reorderTodoByDrop,
  softDelete,
  restoreFromTrash,
  permanentlyDelete,
  activeItems,
  completedTodos,
  selectedRecord,
  pinTodoToTop,
  restoreTodoOrder,
  focusModeForMinutes,
  MIN_FOCUS_MINUTES,
  MAX_FOCUS_MINUTES,
  DEFAULT_FOCUS_MINUTES,
  MAX_ITEM_TEXT_LENGTH,
  MAX_NOTE_LENGTH
};

if (typeof module !== 'undefined') {
  module.exports = store;
}

if (typeof window !== 'undefined') {
  window.store = store;
}
