const test = require('node:test');
const assert = require('node:assert/strict');
const {
  createInitialState,
  normalizeState,
  addItem,
  completeTodo,
  restoreCompletedTodo,
  addSlogan,
  softDelete,
  restoreFromTrash,
  permanentlyDelete,
  activeItems,
  completedTodos,
  reorderTodoByDrop,
  pinTodoToTop,
  restoreTodoOrder,
  updateItemNote,
  focusModeForMinutes,
  MAX_ITEM_TEXT_LENGTH,
  MAX_NOTE_LENGTH
} = require('../src/store');

test('initial state starts with an old sync timestamp', () => {
  assert.equal(createInitialState().modifiedAt, '1970-01-01T00:00:00.000Z');
});

test('normalization derives a sync timestamp for legacy saved data', () => {
  const state = normalizeState({
    items: [{
      id: 'todo_legacy',
      type: 'todo',
      text: '旧数据',
      createdAt: '2026-07-19T01:02:03.000Z',
      completedAt: null,
      status: 'active',
      order: 1
    }]
  });
  assert.equal(state.modifiedAt, '2026-07-19T01:02:03.000Z');
});

test('adds todos with creation time and rejects removed item types', () => {
  let state = createInitialState();
  state = addItem(state, 'todo', '写第一件事', '2026-06-01T01:00:00.000Z');

  assert.equal(state.items.length, 1);
  assert.equal(state.items[0].createdAt, '2026-06-01T01:00:00.000Z');
  assert.throws(() => addItem(state, 'memo', '一条备忘录'), /Unsupported item type/);
});

test('completes todo with completion time and keeps it in history', () => {
  let state = createInitialState();
  state = addItem(state, 'todo', '完成这件事', '2026-06-01T01:00:00.000Z');
  const todoId = state.items[0].id;
  state = completeTodo(state, todoId, '2026-06-01T04:00:00.000Z');

  assert.equal(activeItems(state, 'todo').length, 0);
  assert.equal(completedTodos(state).length, 1);
  assert.equal(completedTodos(state)[0].completedAt, '2026-06-01T04:00:00.000Z');
});

test('restores completed todo back to active list', () => {
  let state = createInitialState();
  state = addItem(state, 'todo', '误点完成的事', '2026-06-01T01:00:00.000Z');
  const todoId = state.items[0].id;
  state = completeTodo(state, todoId, '2026-06-01T04:00:00.000Z');
  state = restoreCompletedTodo(state, todoId);

  assert.equal(completedTodos(state).length, 0);
  assert.equal(activeItems(state, 'todo').length, 1);
  assert.equal(activeItems(state, 'todo')[0].completedAt, null);
});

test('ignores stale restore and duplicate completion requests', () => {
  let state = createInitialState();
  state = addItem(state, 'todo', '只完成一次', '2026-06-01T01:00:00.000Z');
  const todoId = state.items[0].id;
  state = completeTodo(state, todoId, '2026-06-01T04:00:00.000Z');
  const afterFirstComplete = completeTodo(state, todoId, '2026-06-01T05:00:00.000Z');
  const afterMissingRestore = restoreCompletedTodo({ ...afterFirstComplete, selectedId: null, selectedKind: null }, 'missing');

  assert.equal(afterFirstComplete.items[0].completedAt, '2026-06-01T04:00:00.000Z');
  assert.equal(afterMissingRestore.selectedId, null);
  assert.equal(afterMissingRestore.selectedKind, null);
});

test('moves deleted todos and slogans to trash, then restores them', () => {
  let state = createInitialState();
  state = addItem(state, 'todo', '不能丢的待办', '2026-06-01T01:00:00.000Z');
  state = addSlogan(state, '先做眼前这一件', '2026-06-01T01:10:00.000Z');

  const todoId = state.items[0].id;
  const sloganId = state.slogans[0].id;
  state = softDelete(state, 'item', todoId, '2026-06-01T02:00:00.000Z');
  state = softDelete(state, 'slogan', sloganId, '2026-06-01T02:10:00.000Z');

  assert.equal(state.items.length, 0);
  assert.equal(state.slogans.length, 0);
  assert.equal(state.trash.length, 2);

  state = restoreFromTrash(state, todoId);
  assert.equal(state.items.length, 1);
  assert.equal(state.trash.length, 1);
});

test('permanently deletes trash records', () => {
  let state = createInitialState();
  state = addItem(state, 'todo', '删除测试', '2026-06-01T01:00:00.000Z');
  const id = state.items[0].id;
  state = softDelete(state, 'item', id, '2026-06-01T02:00:00.000Z');
  state = permanentlyDelete(state, id);

  assert.equal(state.trash.length, 0);
});

test('sanitizes runtime timestamps and preserves increasing order after deletion gaps', () => {
  let state = createInitialState();
  state = addItem(state, 'todo', '非法时间', 'not-a-date');
  state = addSlogan(state, '第一句', '2026-06-01T01:00:00.000Z');
  state = addSlogan(state, '第二句', '2026-06-01T01:01:00.000Z');
  state = softDelete(state, 'slogan', state.slogans[0].id, '2026-06-01T02:00:00.000Z');
  state = addSlogan(state, '第三句', '2026-06-01T01:02:00.000Z');

  assert.doesNotThrow(() => new Date(state.items[0].createdAt).toISOString());
  assert.deepEqual(state.slogans.map((slogan) => slogan.order), [2, 3]);
});

test('reorders todos by drag target', () => {
  let state = createInitialState();
  state = addItem(state, 'todo', 'A', '2026-06-01T01:00:00.000Z');
  state = addItem(state, 'todo', 'B', '2026-06-01T01:01:00.000Z');
  state = addItem(state, 'todo', 'C', '2026-06-01T01:02:00.000Z');
  const [a, , c] = activeItems(state, 'todo');

  state = reorderTodoByDrop(state, c.id, a.id);

  assert.deepEqual(activeItems(state, 'todo').map((item) => item.text), ['C', 'A', 'B']);
});

test('pins an active todo to the top with one action', () => {
  let state = createInitialState();
  state = addItem(state, 'todo', 'A', '2026-06-01T01:00:00.000Z');
  state = addItem(state, 'todo', 'B', '2026-06-01T01:01:00.000Z');
  state = addItem(state, 'todo', 'C', '2026-06-01T01:02:00.000Z');
  const [, b, c] = activeItems(state, 'todo');

  state = pinTodoToTop(state, c.id);
  assert.deepEqual(activeItems(state, 'todo').map((item) => item.text), ['C', 'A', 'B']);

  const alreadyPinned = pinTodoToTop(state, c.id);
  const completed = completeTodo(alreadyPinned, b.id, '2026-06-01T02:00:00.000Z');
  assert.equal(alreadyPinned, state);
  assert.equal(pinTodoToTop(completed, b.id), completed);
  assert.equal(pinTodoToTop(completed, 'missing'), completed);
});

test('restores the previous todo order without overwriting newer items', () => {
  let state = createInitialState();
  state = addItem(state, 'todo', 'A', '2026-06-01T01:00:00.000Z');
  state = addItem(state, 'todo', 'B', '2026-06-01T01:01:00.000Z');
  state = addItem(state, 'todo', 'C', '2026-06-01T01:02:00.000Z');
  const originalOrder = activeItems(state, 'todo').map((item) => item.id);
  state = pinTodoToTop(state, originalOrder[2]);
  state = addItem(state, 'todo', 'D', '2026-06-01T01:03:00.000Z');

  state = restoreTodoOrder(state, originalOrder);

  assert.deepEqual(activeItems(state, 'todo').map((item) => item.text), ['A', 'B', 'C', 'D']);
  assert.equal(restoreTodoOrder(state, originalOrder), state);
  assert.equal(restoreTodoOrder(state, null), state);
});

test('normalizes corrupted saved state without keeping stale feature types', () => {
  const state = normalizeState({
    items: [
      { id: 'bad id"><script>', type: 'todo', text: '  A  ', createdAt: 'bad', status: 'active', order: 10 },
      { id: 'legacy', type: 'memo', text: '旧备忘', createdAt: '2026-06-01T01:00:00.000Z', status: 'active', order: 1 },
      { id: 'done', type: 'todo', text: '完成项', createdAt: '2026-06-01T02:00:00.000Z', status: 'completed', completedAt: '2026-06-01T03:00:00.000Z', order: 2 }
    ],
    slogans: [{ id: 's1', type: 'slogan', text: ' 提醒 ', createdAt: '2026-06-01T04:00:00.000Z', order: 1 }],
    trash: [{ id: 't1', type: 'slogan', text: '删掉的提醒', createdAt: 'bad', deletedAt: 'bad', originalKind: 'slogan' }],
    activeTab: 'memo',
    selectedId: 'missing',
    selectedKind: 'item',
    focusMinutes: 999,
    timerRemainingSeconds: -1,
    timerRunning: true
  });

  assert.equal(state.items.length, 2);
  assert.deepEqual(state.items.map((item) => item.type), ['todo', 'todo']);
  assert.equal(state.items[0].text, '完成项');
  assert.equal(state.slogans[0].text, '提醒');
  assert.equal(state.activeTab, 'todo');
  assert.equal(state.selectedId, null);
  assert.equal(state.focusMinutes, 240);
  assert.equal(state.timerRemainingSeconds, 0);
  assert.equal(state.timerRunning, false);
  assert.equal(state.timerFinished, true);
  assert.match(state.items.find((item) => item.text === 'A').id, /^[a-zA-Z0-9:_-]+$/);
});

test('normalizes stale timer finished flag without freezing a running timer', () => {
  const state = normalizeState({
    focusMinutes: 25,
    timerRemainingSeconds: 60,
    timerRunning: true,
    timerFinished: true
  });

  assert.equal(state.timerRemainingSeconds, 60);
  assert.equal(state.timerRunning, true);
  assert.equal(state.timerFinished, false);
});

test('normalizes empty numeric fields to defaults instead of minimum values', () => {
  const state = normalizeState({
    focusMinutes: null,
    timerRemainingSeconds: ''
  });

  assert.equal(state.focusMinutes, 25);
  assert.equal(state.timerRemainingSeconds, 25 * 60);
  assert.equal(state.timerFinished, false);
});

test('caps item text, item note, and completion note to safe lengths', () => {
  const huge = '字'.repeat(2000);
  let state = addItem(createInitialState(), 'todo', huge, '2026-06-01T01:00:00.000Z');
  const todoId = state.items[0].id;

  assert.equal(state.items[0].text.length, MAX_ITEM_TEXT_LENGTH);

  state = updateItemNote(state, todoId, huge);
  assert.equal(state.items[0].note.length, MAX_NOTE_LENGTH);

  state = completeTodo(state, todoId, '2026-06-01T02:00:00.000Z', huge);
  assert.equal(completedTodos(state)[0].completionNote.length, MAX_NOTE_LENGTH);
});

test('exposes focusModeForMinutes so the renderer cannot drift from the store', () => {
  assert.equal(focusModeForMinutes(5), 'ice');
  assert.equal(focusModeForMinutes(25), 'standard');
  assert.equal(focusModeForMinutes(45), 'deep');
  assert.equal(focusModeForMinutes(7), 'custom');
});

test('completeTodo rejects ids that are not active todos', () => {
  let state = addItem(createInitialState(), 'todo', '只完成一次', '2026-06-01T01:00:00.000Z');
  const todoId = state.items[0].id;
  state = completeTodo(state, todoId, '2026-06-01T02:00:00.000Z', '说明');

  const secondAttempt = completeTodo(state, todoId, '2026-06-01T03:00:00.000Z', '不会写入');
  const missingAttempt = completeTodo(state, 'missing', '2026-06-01T03:00:00.000Z');

  assert.equal(state.items[0].completionNote, '说明');
  assert.equal(secondAttempt, state);
  assert.equal(missingAttempt, state);
});

test('updateItemNote returns equivalent state when target id is unknown', () => {
  let state = addItem(createInitialState(), 'todo', '保留备注', '2026-06-01T01:00:00.000Z');
  state = updateItemNote(state, state.items[0].id, '已有备注');
  const before = state.items[0].note;
  const after = updateItemNote(state, 'missing', '无操作');

  assert.equal(after.items[0].note, before);
  assert.notEqual(after, state);
});
