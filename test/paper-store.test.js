'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const store = require('../src/paper-store');

test('initial state is one neutral paper with three lanes and a fixed 25 minute timer', () => {
  const state = store.createInitialState('2026-09-07T00:00:00.000Z');
  assert.equal(state.papers.length, 1);
  assert.equal(state.papers[0].title, '我的专注');
  assert.deepEqual(state.papers[0].lanes.map((lane) => lane.title), ['重要的事', '可以选择', '下一步']);
  assert.deepEqual(state.papers[0].lanes.map((lane) => lane.position.x), [3, 35, 67]);
  assert.deepEqual(state.papers[0].freeNotes, []);
  assert.equal(state.timer.durationSeconds, 25 * 60);
  assert.equal(state.timer.remainingSeconds, 25 * 60);
});

test('English initial state is fully neutral and localized', () => {
  const state = store.createInitialState('2026-09-07T00:00:00.000Z', 'en');
  assert.equal(state.language, 'en');
  assert.equal(state.papers[0].title, 'My Focus');
  assert.deepEqual(state.papers[0].lanes.map((lane) => lane.title), ['What matters', 'Options', 'Next step']);
});

test('focus duration can be customized and survives normalization and task changes', () => {
  let state = store.createInitialState();
  state = store.addTask(state, { text: '测试自定义专注', day: 'today' });
  state = store.setFocusDuration(state, 52);
  assert.equal(state.timer.durationSeconds, 52 * 60);
  assert.equal(state.timer.remainingSeconds, 52 * 60);
  state = store.normalizeState(state);
  assert.equal(state.timer.durationSeconds, 52 * 60);
  state = store.addTask(state, { text: '切换后的任务', day: 'today' });
  state = store.setCurrentTask(state, store.activeTasks(state, 'today')[1].id);
  assert.equal(state.timer.durationSeconds, 52 * 60);
  assert.equal(state.timer.remainingSeconds, 52 * 60);
});

test('focus steps stay attached to their main task and keep a three-step limit', () => {
  let state = store.createInitialState();
  state = store.addTask(state, { text: '整理项目', day: 'today' });
  const taskId = state.currentTaskId;
  state = store.addFocusStep(state, taskId, '整理资料目录');
  state = store.addFocusStep(state, taskId, '写出三个要点');
  state = store.addFocusStep(state, taskId, '完成第一版');
  assert.throws(() => store.addFocusStep(state, taskId, '第四步'), /FOCUS_STEP_LIMIT_REACHED/);

  const firstStepId = state.tasks.find((task) => task.id === taskId).focusSteps[0].id;
  state = store.completeNextFocusStep(state, taskId);
  assert.equal(state.tasks.find((task) => task.id === taskId).focusSteps[0].completed, true);
  state = store.toggleFocusStep(state, taskId, firstStepId);
  assert.equal(state.tasks.find((task) => task.id === taskId).focusSteps[0].completed, false);
  state = store.deleteFocusStep(state, taskId, firstStepId);
  state = store.normalizeState(state);
  assert.deepEqual(state.tasks.find((task) => task.id === taskId).focusSteps.map((step) => step.text), [
    '写出三个要点',
    '完成第一版'
  ]);
});

test('a task outside today can be selected directly from the mission map and survives reload', () => {
  let state = store.createInitialState();
  state = store.addTask(state, { text: '今天的主线', day: 'today' });
  state = store.addTask(state, { text: '本周的支线', day: 'tomorrow' });
  const branchId = store.activeTasks(state, 'tomorrow')[0].id;
  state = store.setCurrentTask(state, branchId);
  assert.equal(state.currentTaskId, branchId);
  assert.equal(store.normalizeState(state).currentTaskId, branchId);
  assert.equal(store.activeTasks(state, 'today').length, 1);
});

test('new themes use a general paper and can be ranked manually', () => {
  let state = store.createInitialState();
  state = store.addPaper(state, '生活');
  state = store.addPaper(state, '学习');
  assert.deepEqual(state.papers[1].lanes.map((lane) => lane.title), ['重要的事', '可以选择', '下一步']);
  const englishId = state.papers[2].id;
  state = store.movePaper(state, englishId, 0);
  assert.deepEqual(state.papers.map((paper) => paper.title), ['学习', '我的专注', '生活']);
  assert.equal(state.selectedPaperId, englishId);
});

test('a new theme can be inserted at a chosen rank and shifts the rest back', () => {
  let state = store.createInitialState();
  state = store.addPaper(state, '生活');
  state = store.addPaper(state, '学习', 1);
  assert.deepEqual(state.papers.map((paper) => paper.title), ['我的专注', '学习', '生活']);
  assert.equal(state.selectedPaperId, state.papers[1].id);
});

test('lined paper style is preserved during normalization', () => {
  const state = store.createInitialState();
  state.papers[0].style = 'line';
  assert.equal(store.normalizeState(state).papers[0].style, 'line');
});

test('automatic pen color survives saving so strokes stay visible in both themes', () => {
  const state = store.createInitialState();
  state.papers[0].strokes = [{ id: 'stroke-auto', color: 'auto', width: 2.8, points: [{ x: 0.2, y: 0.3 }] }];
  const normalized = store.normalizeState(state);
  assert.equal(normalized.papers[0].strokes[0].color, 'auto');
  assert.equal(normalized.papers[0].strokes[0].width, 2.8);
});

test('canvas paper preserves highlighter strokes, movable cards, and free notes', () => {
  let state = store.createInitialState();
  const paper = store.selectedPaper(state);
  const lane = paper.lanes[0];
  state = store.updateLane(state, paper.id, lane.id, { position: { x: 19, y: 28 } });
  state = store.updatePaper(state, paper.id, {
    strokes: [{ id: 'highlight-one', kind: 'highlighter', color: '#e0b74f', width: 16, points: [{ x: 0.1, y: 0.2 }] }]
  });
  state = store.addPaperNote(state, paper.id, { text: '先随手写，再整理', x: 24, y: 62, color: 'blue' });
  const note = store.selectedPaper(state).freeNotes[0];
  state = store.updatePaperNote(state, paper.id, note.id, { text: '可以直接钉成任务', x: 31, y: 57 });
  const normalized = store.normalizeState(state);
  const normalizedPaper = store.selectedPaper(normalized);
  assert.deepEqual(normalizedPaper.lanes[0].position, { x: 19, y: 28 });
  assert.equal(normalizedPaper.strokes[0].kind, 'highlighter');
  assert.equal(normalizedPaper.strokes[0].width, 16);
  assert.equal(normalizedPaper.freeNotes[0].text, '可以直接钉成任务');
  assert.equal(normalizedPaper.freeNotes[0].color, 'blue');
  state = store.deletePaperNote(normalized, paper.id, note.id);
  assert.equal(store.selectedPaper(state).freeNotes.length, 0);
});

test('today accepts no more than three active tasks and keeps extra work in tomorrow', () => {
  let state = store.createInitialState();
  state = store.addTask(state, { text: '第一件', day: 'today' });
  state = store.addTask(state, { text: '第二件', day: 'today' });
  state = store.addTask(state, { text: '第三件', day: 'today' });
  assert.throws(() => store.addTask(state, { text: '第四件', day: 'today' }), /TODAY_LIMIT_REACHED/);
  state = store.addTask(state, { text: '明天再做', day: 'tomorrow' });
  assert.equal(store.activeTasks(state, 'today').length, 3);
  assert.equal(store.activeTasks(state, 'tomorrow').length, 1);
  assert.equal(store.activeTasks(state, 'today')[0].horizon, 'week');
  assert.equal(store.activeTasks(state, 'tomorrow')[0].horizon, 'week');
});

test('tasks can move between week, month, half year, and unscheduled without losing content', () => {
  let state = store.createInitialState();
  state = store.addTask(state, { text: '安排时间范围', day: 'tomorrow', note: '内容必须保留', importance: 4 });
  const taskId = store.activeTasks(state)[0].id;
  state = store.setTaskHorizon(state, taskId, 'month');
  let task = state.tasks.find((candidate) => candidate.id === taskId);
  assert.equal(task.horizon, 'month');
  assert.equal(task.day, 'inbox');
  assert.equal(task.text, '安排时间范围');
  assert.equal(task.note, '内容必须保留');
  assert.equal(task.importance, 4);
  state = store.setTaskHorizon(state, taskId, 'half-year');
  assert.equal(state.tasks.find((candidate) => candidate.id === taskId).horizon, 'half-year');
  state = store.setTaskHorizon(state, taskId, 'unscheduled');
  assert.equal(state.tasks.find((candidate) => candidate.id === taskId).horizon, 'unscheduled');
  state = store.moveTask(state, taskId, 'today');
  task = state.tasks.find((candidate) => candidate.id === taskId);
  assert.equal(task.horizon, 'week');
  assert.equal(task.day, 'today');
});

test('importance is independent from the manual task position', () => {
  let state = store.createInitialState();
  state = store.addTask(state, { text: '高柱子', day: 'tomorrow', importance: 5 });
  state = store.addTask(state, { text: '低柱子', day: 'tomorrow', importance: 1 });
  state = store.addTask(state, { text: '中柱子', day: 'tomorrow', importance: 3 });
  const highId = store.activeTasks(state)[0].id;
  state = store.moveTaskOrder(state, highId, 2);
  assert.deepEqual(store.activeTasks(state).map((task) => task.text), ['低柱子', '中柱子', '高柱子']);
  assert.deepEqual(store.activeTasks(state).map((task) => task.importance), [1, 3, 5]);
});

test('old tasks receive safe non-sorted importance levels without losing their order', () => {
  const state = store.createInitialState();
  state.tasks = Array.from({ length: 5 }, (_, index) => ({
    id: `old-importance-${index}`,
    text: `旧事项 ${index + 1}`,
    day: 'tomorrow',
    status: 'active',
    order: index + 1,
    createdAt: `2026-09-07T00:0${index}:00.000Z`
  }));
  const normalized = store.normalizeState(state);
  assert.deepEqual(store.activeTasks(normalized).map((task) => task.text), ['旧事项 1', '旧事项 2', '旧事项 3', '旧事项 4', '旧事项 5']);
  assert.deepEqual(store.activeTasks(normalized).map((task) => task.importance), [5, 2, 4, 1, 3]);
});

test('completion note remains linked to its original paper lane', () => {
  let state = store.createInitialState();
  const paper = store.selectedPaper(state);
  const lane = paper.lanes[0];
  state = store.addTask(state, {
    text: '整理三个选项',
    day: 'today',
    paperId: paper.id,
    laneId: lane.id
  });
  const task = store.activeTasks(state, 'today')[0];
  state = store.completeTask(state, task.id, '已经收藏并分了优先级');
  const completed = store.completedTasks(state)[0];
  assert.equal(completed.paperId, paper.id);
  assert.equal(completed.laneId, lane.id);
  assert.equal(completed.completionNote, '已经收藏并分了优先级');
  assert.equal(state.currentTaskId, null);
});

test('delete is recoverable and restoring a today task respects the three item limit', () => {
  let state = store.createInitialState();
  state = store.addTask(state, { text: '会被恢复', day: 'today' });
  const deletedId = store.activeTasks(state, 'today')[0].id;
  state = store.deleteTask(state, deletedId);
  const trashId = state.trash[0].id;
  state = store.addTask(state, { text: 'A', day: 'today' });
  state = store.addTask(state, { text: 'B', day: 'today' });
  state = store.addTask(state, { text: 'C', day: 'today' });
  state = store.restoreTrash(state, trashId);
  const restored = state.tasks.find((task) => task.text === '会被恢复');
  assert.equal(restored.day, 'tomorrow');
  assert.equal(state.trash.length, 0);
});

test('legacy memo data migrates without losing active or completed items', () => {
  const migrated = store.normalizeState({
    modifiedAt: '2026-09-06T01:00:00.000Z',
    compact: true,
    items: [
      { id: 'old-a', type: 'todo', text: '旧待办', note: '旧备注', status: 'active', createdAt: '2026-09-06T00:00:00.000Z' },
      { id: 'old-b', type: 'todo', text: '旧完成', status: 'completed', completionNote: '做完了', createdAt: '2026-09-05T00:00:00.000Z', completedAt: '2026-09-05T02:00:00.000Z' }
    ],
    slogans: [{ id: 'old-r', type: 'slogan', text: '先做眼前这一件', createdAt: '2026-09-04T00:00:00.000Z', order: 1 }]
  });
  assert.equal(migrated.version, store.VERSION);
  assert.equal(migrated.tasks.length, 2);
  assert.equal(store.activeTasks(migrated, 'today').length, 1);
  assert.equal(migrated.tasks[0].note, '旧备注');
  assert.equal(store.completedTasks(migrated)[0].completionNote, '做完了');
  assert.equal(migrated.reminders[0].text, '先做眼前这一件');
  assert.equal(migrated.compact, true);
});

test('merges old and new Pin data once without duplicating matching tasks', () => {
  let current = store.createInitialState('2026-09-07T00:00:00.000Z');
  current.tasks = [{
    id: 'new-task',
    text: '同一件事',
    note: null,
    paperId: current.papers[0].id,
    laneId: null,
    day: 'today',
    status: 'active',
    order: 1,
    createdAt: '2026-07-01T00:00:00.000Z',
    completedAt: null,
    completionNote: null
  }];
  const legacy = {
    pinned: true,
    items: [
      { id: 'old-same', type: 'todo', text: '同一件事', note: '旧版备注', status: 'active', order: 1, createdAt: '2026-07-01T00:00:00.000Z' },
      { id: 'old-extra', type: 'todo', text: '只在旧版', status: 'active', order: 2, createdAt: '2026-07-02T00:00:00.000Z' }
    ],
    slogans: [{ id: 'old-reminder', type: 'slogan', text: '不要同时做两件事', order: 1, createdAt: '2026-07-03T00:00:00.000Z' }],
    trash: []
  };

  const merged = store.mergeLegacyState(current, legacy, '2026-09-07T01:00:00.000Z');
  const mergedAgain = store.mergeLegacyState(merged, legacy, '2026-09-07T02:00:00.000Z');
  assert.equal(merged.tasks.length, 2);
  assert.equal(merged.tasks.find((task) => task.text === '同一件事').note, '旧版备注');
  assert.equal(merged.tasks.find((task) => task.text === '只在旧版').day, 'inbox');
  assert.equal(merged.reminders[0].text, '不要同时做两件事');
  assert.equal(merged.pinned, true);
  assert.equal(mergedAgain.tasks.length, 2);
  assert.equal(mergedAgain.reminders.length, 1);
});

test('organizer can edit, reorder, restore, and recover reminders', () => {
  let state = store.createInitialState();
  state = store.addTask(state, { text: '收集来的第一件', day: 'inbox', note: '原备注' });
  state = store.addTask(state, { text: '收集来的第二件', day: 'inbox' });
  const firstId = store.activeTasks(state)[0].id;
  state = store.updateTask(state, firstId, { text: '改清楚的第一件', note: '新备注' });
  state = store.moveTaskOrder(state, firstId, 1);
  assert.equal(store.activeTasks(state)[1].text, '改清楚的第一件');
  assert.equal(store.activeTasks(state)[1].note, '新备注');

  const secondId = store.activeTasks(state)[0].id;
  state = store.completeTask(state, secondId, '完成结果');
  state = store.restoreCompletedTask(state, secondId);
  assert.equal(state.tasks.find((task) => task.id === secondId).day, 'inbox');
  assert.equal(state.tasks.find((task) => task.id === secondId).status, 'active');

  state = store.addReminder(state, '慢一点，只做一件');
  const reminderId = state.reminders[0].id;
  state = store.deleteReminder(state, reminderId);
  assert.equal(state.reminders.length, 0);
  state = store.restoreTrash(state, state.trash[0].id);
  assert.equal(state.reminders[0].text, '慢一点，只做一件');
});

test('normalization repairs an overfull today list without dropping tasks', () => {
  let state = store.createInitialState();
  const paper = store.selectedPaper(state);
  state.tasks = Array.from({ length: 5 }, (_, index) => ({
    id: `manual-${index}`,
    text: `任务 ${index}`,
    paperId: paper.id,
    laneId: null,
    day: 'today',
    status: 'active',
    order: index + 1,
    createdAt: new Date(2026, 8, 7, 8, index).toISOString(),
    completedAt: null,
    completionNote: null
  }));
  const normalized = store.normalizeState(state);
  assert.equal(normalized.tasks.length, 5);
  assert.equal(store.activeTasks(normalized, 'today').length, 3);
  assert.equal(store.activeTasks(normalized, 'tomorrow').length, 2);
});

test('moving or deleting the current task safely resets the focus timer', () => {
  let state = store.createInitialState();
  state = store.addTask(state, { text: '当前', day: 'today' });
  state = store.addTask(state, { text: '下一件', day: 'today' });
  state.timer = {
    durationSeconds: store.FOCUS_DURATION_SECONDS,
    remainingSeconds: 1200,
    running: true,
    deadline: new Date(Date.now() + 1200 * 1000).toISOString(),
    finished: false
  };
  const currentId = state.currentTaskId;
  state = store.moveTask(state, currentId, 'tomorrow');
  assert.equal(state.timer.running, false);
  assert.equal(state.timer.remainingSeconds, store.FOCUS_DURATION_SECONDS);
  assert.equal(state.currentTaskId, store.activeTasks(state, 'today')[0].id);

  state.timer = { ...state.timer, remainingSeconds: 900, running: true, deadline: new Date(Date.now() + 900000).toISOString() };
  state = store.deleteTask(state, state.currentTaskId);
  assert.equal(state.currentTaskId, null);
  assert.equal(state.timer.running, false);
  assert.equal(state.timer.remainingSeconds, store.FOCUS_DURATION_SECONDS);
});
