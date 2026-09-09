(function attachPaperStore(globalScope) {
  'use strict';

  const VERSION = 6;
  const TODAY_LIMIT = 3;
  const MAX_FOCUS_STEPS = 3;
  const FOCUS_DURATION_SECONDS = 25 * 60;
  const MIN_FOCUS_MINUTES = 1;
  const MAX_FOCUS_MINUTES = 240;
  const VALID_DAYS = ['today', 'tomorrow', 'inbox'];
  const VALID_HORIZONS = ['week', 'month', 'half-year', 'unscheduled'];
  const VALID_VIEWS = ['paper', 'priority', 'check', 'focus', 'organize'];
  const VALID_PAPER_STYLES = ['grid', 'dot', 'line', 'plain'];
  const DEFAULT_IMPORTANCE_SEQUENCE = [5, 2, 4, 1, 3];
  const MAX_TEXT = 600;
  const MAX_NOTES = 6000;

  function nowIso() {
    return new Date().toISOString();
  }

  function createId(prefix = 'id') {
    const random =
      globalThis.crypto?.randomUUID?.().replaceAll('-', '') ||
      `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 12)}`;
    return `${prefix}_${random}`;
  }

  function cleanText(value, max = MAX_TEXT) {
    return String(value ?? '').trim().slice(0, max);
  }

  function cleanDraft(value, max = MAX_NOTES) {
    return String(value ?? '').slice(0, max);
  }

  function validIso(value, fallback = nowIso()) {
    if (typeof value !== 'string') return fallback;
    return Number.isNaN(new Date(value).getTime()) ? fallback : value;
  }

  function asArray(value) {
    return Array.isArray(value) ? value : [];
  }

  function finiteNumber(value, fallback = 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  }

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  function normalizeImportance(value, index = 0) {
    const fallback = DEFAULT_IMPORTANCE_SEQUENCE[index % DEFAULT_IMPORTANCE_SEQUENCE.length];
    return clamp(Math.round(finiteNumber(value, fallback)), 1, 5);
  }

  function normalizeFocusDurationSeconds(value = FOCUS_DURATION_SECONDS) {
    return clamp(
      Math.round(finiteNumber(value, FOCUS_DURATION_SECONDS) / 60) * 60,
      MIN_FOCUS_MINUTES * 60,
      MAX_FOCUS_MINUTES * 60
    );
  }

  function normalizeHorizon(value, day = 'inbox') {
    if (VALID_HORIZONS.includes(value)) return value;
    return day === 'today' || day === 'tomorrow' ? 'week' : 'unscheduled';
  }

  function idleTimer(durationSeconds = FOCUS_DURATION_SECONDS) {
    const duration = normalizeFocusDurationSeconds(durationSeconds);
    return {
      durationSeconds: duration,
      remainingSeconds: duration,
      running: false,
      deadline: null,
      finished: false
    };
  }

  function defaultLanePosition(index = 0) {
    return {
      x: 3 + Math.max(0, Math.min(2, index)) * 32,
      y: 15
    };
  }

  function createLane(title, index = 0) {
    return {
      id: createId('lane'),
      title,
      company: '',
      notes: '',
      nextAction: '',
      position: defaultLanePosition(index)
    };
  }

  function normalizeLanguage(value, fallback = 'zh-CN') {
    return value === 'en' ? 'en' : value === 'zh-CN' ? 'zh-CN' : fallback;
  }

  function defaultPaperText(language = 'zh-CN') {
    return normalizeLanguage(language) === 'en'
      ? { title: 'My Focus', lanes: ['What matters', 'Options', 'Next step'] }
      : { title: '我的专注', lanes: ['重要的事', '可以选择', '下一步'] };
  }

  function createPaper(title, createdAt = nowIso(), template = 'general', language = 'zh-CN') {
    const defaults = defaultPaperText(language);
    const laneTitles = defaults.lanes;
    return {
      id: createId('paper'),
      title: cleanText(title, 80) || defaults.title,
      style: 'grid',
      createdAt,
      updatedAt: createdAt,
      lanes: laneTitles.map((laneTitle, index) => createLane(laneTitle, index)),
      strokes: [],
      freeNotes: []
    };
  }

  function createInitialState(createdAt = nowIso(), language = 'zh-CN') {
    const safeLanguage = normalizeLanguage(language);
    const paper = createPaper(defaultPaperText(safeLanguage).title, createdAt, 'general', safeLanguage);
    return {
      version: VERSION,
      modifiedAt: createdAt,
      language: safeLanguage,
      papers: [paper],
      selectedPaperId: paper.id,
      tasks: [],
      reminders: [],
      trash: [],
      view: 'paper',
      compact: false,
      pinned: false,
      theme: 'light',
      legacyMergedAt: null,
      currentTaskId: null,
      timer: {
        durationSeconds: FOCUS_DURATION_SECONDS,
        remainingSeconds: FOCUS_DURATION_SECONDS,
        running: false,
        deadline: null,
        finished: false
      }
    };
  }

  function normalizePaperPosition(value, fallback) {
    return {
      x: clamp(finiteNumber(value?.x, fallback.x), 1, 68),
      y: clamp(finiteNumber(value?.y, fallback.y), 7, 76)
    };
  }

  function normalizeLane(value, fallbackTitle, seen, index = 0) {
    const id = uniqueId(value?.id, 'lane', seen);
    return {
      id,
      title: cleanText(value?.title, 80) || fallbackTitle,
      company: cleanDraft(value?.company, 300),
      notes: cleanDraft(value?.notes, MAX_NOTES),
      nextAction: cleanDraft(value?.nextAction, 500),
      position: normalizePaperPosition(value?.position, defaultLanePosition(index))
    };
  }

  function normalizePoint(value) {
    if (!value || typeof value !== 'object') return null;
    return {
      x: clamp(finiteNumber(value.x), 0, 1),
      y: clamp(finiteNumber(value.y), 0, 1)
    };
  }

  function normalizeStroke(value, seen) {
    if (!value || typeof value !== 'object') return null;
    const points = asArray(value.points)
      .map(normalizePoint)
      .filter(Boolean);
    if (!points.length) return null;
    return {
      id: uniqueId(value.id, 'stroke', seen),
      kind: value.kind === 'highlighter' ? 'highlighter' : 'pen',
      color: value.color === 'auto' ? 'auto' : /^#[0-9a-f]{6}$/i.test(value.color) ? value.color : 'auto',
      width: clamp(finiteNumber(value.width, 2.4), 1, 24),
      points
    };
  }

  function normalizeFreeNote(value, index, seen) {
    if (!value || typeof value !== 'object') return null;
    const createdAt = validIso(value.createdAt);
    const width = clamp(finiteNumber(value.width, 24), 18, 36);
    return {
      id: uniqueId(value.id, 'note', seen),
      text: cleanDraft(value.text, MAX_NOTES),
      x: clamp(finiteNumber(value.x, 6 + (index % 2) * 44), 1, Math.max(1, 98 - width)),
      y: clamp(finiteNumber(value.y, 52 + Math.floor(index / 3) * 12), 8, 88),
      width,
      color: ['cream', 'blue', 'green', 'rose'].includes(value.color) ? value.color : 'cream',
      createdAt,
      updatedAt: validIso(value.updatedAt, createdAt)
    };
  }

  function normalizeFocusStep(value, seen) {
    if (!value || typeof value !== 'object') return null;
    const text = cleanText(value.text, 240);
    if (!text) return null;
    const createdAt = validIso(value.createdAt);
    const completed = Boolean(value.completed);
    return {
      id: uniqueId(value.id, 'step', seen),
      text,
      completed,
      createdAt,
      completedAt: completed ? validIso(value.completedAt, createdAt) : null
    };
  }

  function normalizePaper(value, index, seen, language = 'zh-CN') {
    if (!value || typeof value !== 'object') return null;
    const createdAt = validIso(value.createdAt);
    const fallbackTitles = defaultPaperText(language).lanes;
    const incomingLanes = asArray(value.lanes).slice(0, 3);
    const lanes = fallbackTitles.map((title, laneIndex) =>
      normalizeLane(incomingLanes[laneIndex], title, seen, laneIndex)
    );
    return {
      id: uniqueId(value.id, 'paper', seen),
      title: cleanText(value.title, 80) || (normalizeLanguage(language) === 'en' ? `Focus paper ${index + 1}` : `主题纸 ${index + 1}`),
      style: VALID_PAPER_STYLES.includes(value.style) ? value.style : 'grid',
      createdAt,
      updatedAt: validIso(value.updatedAt, createdAt),
      lanes,
      strokes: asArray(value.strokes)
        .map((stroke) => normalizeStroke(stroke, seen))
        .filter(Boolean),
      freeNotes: asArray(value.freeNotes)
        .slice(0, 200)
        .map((note, noteIndex) => normalizeFreeNote(note, noteIndex, seen))
        .filter(Boolean)
    };
  }

  function normalizeTask(value, index, seen, paperIds, laneIds) {
    if (!value || typeof value !== 'object') return null;
    const text = cleanText(value.text, 500);
    if (!text) return null;
    const status = value.status === 'completed' ? 'completed' : 'active';
    let day = VALID_DAYS.includes(value.day) ? value.day : 'tomorrow';
    const horizon = normalizeHorizon(value.horizon, day);
    if (day !== 'today') day = horizon === 'week' ? 'tomorrow' : 'inbox';
    const createdAt = validIso(value.createdAt);
    const paperId = paperIds.has(value.paperId) ? value.paperId : null;
    const laneId = paperId && laneIds.has(value.laneId) ? value.laneId : null;
    return {
      id: uniqueId(value.id, 'task', seen),
      text,
      paperId,
      laneId,
      day,
      horizon,
      status,
      order: Number.isFinite(Number(value.order)) ? Number(value.order) : index + 1,
      importance: normalizeImportance(value.importance, index),
      createdAt,
      completedAt: status === 'completed' ? validIso(value.completedAt, createdAt) : null,
      note: cleanText(value.note, 1200) || null,
      completionNote:
        status === 'completed' ? cleanText(value.completionNote, 1200) || null : null,
      focusSteps: asArray(value.focusSteps)
        .slice(0, MAX_FOCUS_STEPS)
        .map((step) => normalizeFocusStep(step, seen))
        .filter(Boolean)
    };
  }

  function normalizeReminder(value, index, seen) {
    if (!value || typeof value !== 'object') return null;
    const text = cleanText(value.text, 500);
    if (!text) return null;
    return {
      id: uniqueId(value.id, 'reminder', seen),
      text,
      order: Number.isFinite(Number(value.order)) ? Number(value.order) : index + 1,
      createdAt: validIso(value.createdAt)
    };
  }

  function uniqueId(value, prefix, seen) {
    let id = typeof value === 'string' && /^[a-zA-Z0-9:_-]+$/.test(value) ? value : createId(prefix);
    while (seen.has(id)) id = createId(prefix);
    seen.add(id);
    return id;
  }

  function normalizeTrash(value, seen) {
    if (!value || typeof value !== 'object') return null;
    if (!['paper', 'task', 'reminder'].includes(value.kind) || !value.record || typeof value.record !== 'object') {
      return null;
    }
    const record = JSON.parse(JSON.stringify(value.record));
    return {
      id: uniqueId(value.id, 'trash', seen),
      kind: value.kind,
      record,
      deletedAt: validIso(value.deletedAt)
    };
  }

  function migrateLegacyState(value) {
    const base = createInitialState(validIso(value?.modifiedAt, nowIso()));
    const paper = base.papers[0];
    const oldItems = asArray(value?.items).filter((item) => item?.type === 'todo' && cleanText(item.text));
    base.tasks = oldItems.map((item, index) => {
      const completed = item.status === 'completed';
      const day = !completed && index === oldItems.findIndex((candidate) => candidate.status !== 'completed') ? 'today' : 'inbox';
      return {
        id: typeof item.id === 'string' ? item.id : createId('task'),
        text: cleanText(item.text, 500),
        paperId: paper.id,
        laneId: null,
        day,
        status: completed ? 'completed' : 'active',
        order: index + 1,
        importance: normalizeImportance(item.importance, index),
        createdAt: validIso(item.createdAt),
        completedAt: completed ? validIso(item.completedAt, validIso(item.createdAt)) : null,
        note: cleanText(item.note, 1200) || null,
        completionNote: completed ? cleanText(item.completionNote || item.note, 1200) || null : null,
        focusSteps: []
      };
    });
    base.reminders = asArray(value?.slogans)
      .map((slogan, index) => ({
        id: typeof slogan?.id === 'string' ? slogan.id : createId('reminder'),
        text: cleanText(slogan?.text, 500),
        order: Number.isFinite(Number(slogan?.order)) ? Number(slogan.order) : index + 1,
        createdAt: validIso(slogan?.createdAt)
      }))
      .filter((reminder) => reminder.text);
    base.trash = asArray(value?.trash)
      .map((entry) => {
        if (!entry || !['todo', 'slogan'].includes(entry.type) || !cleanText(entry.text, 500)) return null;
        const kind = entry.type === 'slogan' ? 'reminder' : 'task';
        const record = kind === 'reminder'
          ? {
              id: typeof entry.id === 'string' ? entry.id : createId('reminder'),
              text: cleanText(entry.text, 500),
              order: Number.isFinite(Number(entry.order)) ? Number(entry.order) : 1,
              createdAt: validIso(entry.createdAt)
            }
          : {
              id: typeof entry.id === 'string' ? entry.id : createId('task'),
              text: cleanText(entry.text, 500),
              paperId: paper.id,
              laneId: null,
              day: 'inbox',
              horizon: 'unscheduled',
              status: entry.status === 'completed' ? 'completed' : 'active',
              order: Number.isFinite(Number(entry.order)) ? Number(entry.order) : 1,
              createdAt: validIso(entry.createdAt),
              completedAt: entry.completedAt ? validIso(entry.completedAt) : null,
              note: cleanText(entry.note, 1200) || null,
              completionNote: cleanText(entry.completionNote, 1200) || null
            };
        return { id: createId('trash'), kind, record, deletedAt: validIso(entry.deletedAt) };
      })
      .filter(Boolean);
    base.currentTaskId = base.tasks.find((task) => task.status === 'active' && task.day === 'today')?.id || null;
    base.compact = Boolean(value?.compact);
    base.pinned = value?.pinned !== false;
    base.legacyMergedAt = nowIso();
    base.modifiedAt = validIso(value?.modifiedAt, nowIso());
    return base;
  }

  function normalizeState(value) {
    if (value && typeof value === 'object' && !Array.isArray(value) && value.version !== VERSION && value.items) {
      value = migrateLegacyState(value);
    }
    if (!value || typeof value !== 'object' || Array.isArray(value)) return createInitialState();

    const language = normalizeLanguage(value.language, 'zh-CN');
    const seen = new Set();
    let papers = asArray(value.papers)
      .map((paper, index) => normalizePaper(paper, index, seen, language))
      .filter(Boolean);
    if (!papers.length) papers = createInitialState(nowIso(), language).papers;

    const paperIds = new Set(papers.map((paper) => paper.id));
    const laneIds = new Set(papers.flatMap((paper) => paper.lanes.map((lane) => lane.id)));
    let tasks = asArray(value.tasks)
      .map((task, index) => normalizeTask(task, index, seen, paperIds, laneIds))
      .filter(Boolean)
      .sort((a, b) => a.order - b.order || new Date(a.createdAt) - new Date(b.createdAt));

    const reminders = asArray(value.reminders)
      .map((reminder, index) => normalizeReminder(reminder, index, seen))
      .filter(Boolean)
      .sort((a, b) => a.order - b.order || new Date(a.createdAt) - new Date(b.createdAt));

    // Old or damaged data may contain more than three active items for today.
    // Keep the first three in today and move the rest to tomorrow instead of dropping anything.
    let activeTodaySeen = 0;
    tasks = tasks.map((task) => {
      if (task.status !== 'active' || task.day !== 'today') return task;
      activeTodaySeen += 1;
      return activeTodaySeen <= TODAY_LIMIT ? task : { ...task, day: 'tomorrow' };
    });

    const activeToday = tasks.filter((task) => task.status === 'active' && task.day === 'today');
    const activeAll = tasks.filter((task) => task.status === 'active');
    const requestedCurrent = activeAll.find((task) => task.id === value.currentTaskId);
    const currentTaskId = requestedCurrent?.id || activeToday[0]?.id || null;
    const currentWasRepaired = Boolean(value.currentTaskId) && value.currentTaskId !== currentTaskId;

    const rawTimer = value.timer && typeof value.timer === 'object' ? value.timer : {};
    const durationSeconds = normalizeFocusDurationSeconds(rawTimer.durationSeconds);
    let remainingSeconds = clamp(
      Math.round(finiteNumber(rawTimer.remainingSeconds, durationSeconds)),
      0,
      durationSeconds
    );
    let running = Boolean(rawTimer.running) && remainingSeconds > 0 && currentTaskId && !currentWasRepaired;
    let deadline = typeof rawTimer.deadline === 'string' ? rawTimer.deadline : null;
    if (running && !deadline) running = false;
    if (running && deadline) {
      const deadlineMs = new Date(deadline).getTime();
      if (Number.isFinite(deadlineMs)) {
        remainingSeconds = clamp(Math.ceil((deadlineMs - Date.now()) / 1000), 0, durationSeconds);
        if (remainingSeconds === 0) running = false;
      } else {
        deadline = null;
        running = false;
      }
    }
    if (currentWasRepaired) {
      remainingSeconds = durationSeconds;
      deadline = null;
    }

    return {
      version: VERSION,
      modifiedAt: validIso(value.modifiedAt, nowIso()),
      language,
      papers,
      selectedPaperId: paperIds.has(value.selectedPaperId) ? value.selectedPaperId : papers[0].id,
      tasks,
      reminders,
      trash: asArray(value.trash)
        .map((entry) => normalizeTrash(entry, seen))
        .filter(Boolean)
        .sort((a, b) => new Date(b.deletedAt) - new Date(a.deletedAt)),
      view: VALID_VIEWS.includes(value.view) ? value.view : 'paper',
      compact: Boolean(value.compact),
      pinned: Boolean(value.pinned),
      theme: value.theme === 'dark' ? 'dark' : 'light',
      legacyMergedAt: typeof value.legacyMergedAt === 'string' ? validIso(value.legacyMergedAt) : null,
      currentTaskId,
      timer: {
        durationSeconds,
        remainingSeconds,
        running: Boolean(running),
        deadline: running ? deadline : null,
        finished: remainingSeconds === 0
      }
    };
  }

  function touch(state, modifiedAt = nowIso()) {
    return { ...state, version: VERSION, modifiedAt };
  }

  function selectedPaper(state) {
    return state.papers.find((paper) => paper.id === state.selectedPaperId) || state.papers[0] || null;
  }

  function activeTasks(state, day) {
    return state.tasks
      .filter((task) => task.status === 'active' && (!day || task.day === day))
      .sort((a, b) => a.order - b.order || new Date(a.createdAt) - new Date(b.createdAt));
  }

  function completedTasks(state) {
    return state.tasks
      .filter((task) => task.status === 'completed')
      .sort((a, b) => new Date(b.completedAt) - new Date(a.completedAt));
  }

  function addPaper(state, title, targetIndex) {
    const createdAt = nowIso();
    const paper = createPaper(title, createdAt, 'general', state.language);
    const papers = [...state.papers, paper];
    if (targetIndex !== undefined) {
      papers.pop();
      const safeTarget = clamp(Math.round(finiteNumber(targetIndex, papers.length)), 0, papers.length);
      papers.splice(safeTarget, 0, paper);
    }
    return touch({ ...state, papers, selectedPaperId: paper.id, view: 'paper' }, createdAt);
  }

  function movePaper(state, paperId, targetIndex) {
    const fromIndex = state.papers.findIndex((paper) => paper.id === paperId);
    if (fromIndex < 0 || state.papers.length < 2) return state;
    const safeTarget = clamp(Math.round(finiteNumber(targetIndex, fromIndex)), 0, state.papers.length - 1);
    if (safeTarget === fromIndex) return state;
    const papers = [...state.papers];
    const [paper] = papers.splice(fromIndex, 1);
    papers.splice(safeTarget, 0, paper);
    return touch({ ...state, papers });
  }

  function updatePaper(state, paperId, changes) {
    const changedAt = nowIso();
    return touch({
      ...state,
      papers: state.papers.map((paper) =>
        paper.id === paperId ? { ...paper, ...changes, id: paper.id, updatedAt: changedAt } : paper
      )
    }, changedAt);
  }

  function updateLane(state, paperId, laneId, changes) {
    const paper = state.papers.find((candidate) => candidate.id === paperId);
    if (!paper) return state;
    return updatePaper(state, paperId, {
      lanes: paper.lanes.map((lane) => (lane.id === laneId ? { ...lane, ...changes, id: lane.id } : lane))
    });
  }

  function addPaperNote(state, paperId, input = {}) {
    const paper = state.papers.find((candidate) => candidate.id === paperId);
    if (!paper) return state;
    const createdAt = nowIso();
    const width = clamp(finiteNumber(input.width, 24), 18, 36);
    const note = {
      id: createId('note'),
      text: cleanDraft(input.text, MAX_NOTES),
      x: clamp(finiteNumber(input.x, 6), 1, Math.max(1, 98 - width)),
      y: clamp(finiteNumber(input.y, 54), 8, 88),
      width,
      color: ['cream', 'blue', 'green', 'rose'].includes(input.color) ? input.color : 'cream',
      createdAt,
      updatedAt: createdAt
    };
    return updatePaper(state, paperId, { freeNotes: [...paper.freeNotes, note] });
  }

  function updatePaperNote(state, paperId, noteId, changes = {}) {
    const paper = state.papers.find((candidate) => candidate.id === paperId);
    const note = paper?.freeNotes.find((candidate) => candidate.id === noteId);
    if (!paper || !note) return state;
    const updatedAt = nowIso();
    const width = Object.hasOwn(changes, 'width') ? clamp(finiteNumber(changes.width, note.width), 18, 36) : note.width;
    const updated = {
      ...note,
      text: Object.hasOwn(changes, 'text') ? cleanDraft(changes.text, MAX_NOTES) : note.text,
      x: Object.hasOwn(changes, 'x')
        ? clamp(finiteNumber(changes.x, note.x), 1, Math.max(1, 98 - width))
        : clamp(note.x, 1, Math.max(1, 98 - width)),
      y: Object.hasOwn(changes, 'y') ? clamp(finiteNumber(changes.y, note.y), 8, 88) : note.y,
      width,
      color: Object.hasOwn(changes, 'color') && ['cream', 'blue', 'green', 'rose'].includes(changes.color)
        ? changes.color
        : note.color,
      updatedAt
    };
    return updatePaper(state, paperId, {
      freeNotes: paper.freeNotes.map((candidate) => (candidate.id === noteId ? updated : candidate))
    });
  }

  function deletePaperNote(state, paperId, noteId) {
    const paper = state.papers.find((candidate) => candidate.id === paperId);
    if (!paper?.freeNotes.some((note) => note.id === noteId)) return state;
    return updatePaper(state, paperId, { freeNotes: paper.freeNotes.filter((note) => note.id !== noteId) });
  }

  function todayCount(state) {
    return activeTasks(state, 'today').length;
  }

  function addTask(state, input) {
    const text = cleanText(input?.text, 500);
    if (!text) throw new Error('TASK_TEXT_REQUIRED');
    let day = VALID_DAYS.includes(input?.day) ? input.day : 'inbox';
    const horizon = normalizeHorizon(input?.horizon, day);
    if (day !== 'today') day = horizon === 'week' ? 'tomorrow' : 'inbox';
    if (day === 'today' && todayCount(state) >= TODAY_LIMIT) throw new Error('TODAY_LIMIT_REACHED');
    const createdAt = nowIso();
    const task = {
      id: createId('task'),
      text,
      paperId: state.papers.some((paper) => paper.id === input.paperId) ? input.paperId : null,
      laneId: state.papers.some((paper) => paper.lanes.some((lane) => lane.id === input.laneId)) ? input.laneId : null,
      day,
      horizon,
      status: 'active',
      order: Math.max(0, ...state.tasks.map((candidate) => Number(candidate.order) || 0)) + 1,
      importance: Object.hasOwn(input || {}, 'importance') ? normalizeImportance(input.importance, 4) : 3,
      createdAt,
      completedAt: null,
      note: cleanText(input?.note, 1200) || null,
      completionNote: null,
      focusSteps: []
    };
    const currentTaskId = state.currentTaskId || (day === 'today' ? task.id : null);
    return touch({ ...state, tasks: [...state.tasks, task], currentTaskId }, createdAt);
  }

  function moveTask(state, taskId, day) {
    if (!VALID_DAYS.includes(day)) return state;
    const task = state.tasks.find((candidate) => candidate.id === taskId && candidate.status === 'active');
    if (!task || task.day === day) return state;
    if (day === 'today' && todayCount(state) >= TODAY_LIMIT) throw new Error('TODAY_LIMIT_REACHED');
    let currentTaskId = state.currentTaskId;
    if (day === 'tomorrow' && currentTaskId === taskId) {
      currentTaskId = activeTasks(state, 'today').find((candidate) => candidate.id !== taskId)?.id || null;
    }
    if (day === 'today' && !currentTaskId) currentTaskId = taskId;
    const currentChanged = currentTaskId !== state.currentTaskId;
    return touch({
      ...state,
      currentTaskId,
      timer: currentChanged
        ? idleTimer(state.timer?.durationSeconds)
        : state.timer,
      tasks: state.tasks.map((candidate) => {
        if (candidate.id !== taskId) return candidate;
        const horizon = day === 'today' || day === 'tomorrow' ? 'week' : 'unscheduled';
        return { ...candidate, day, horizon };
      })
    });
  }

  function setTaskHorizon(state, taskId, horizon) {
    if (!VALID_HORIZONS.includes(horizon)) return state;
    const task = state.tasks.find((candidate) => candidate.id === taskId && candidate.status === 'active');
    if (!task || task.day === 'today' || (task.horizon === horizon && task.day === (horizon === 'week' ? 'tomorrow' : 'inbox'))) return state;
    const day = horizon === 'week' ? 'tomorrow' : 'inbox';
    return touch({
      ...state,
      tasks: state.tasks.map((candidate) =>
        candidate.id === taskId ? { ...candidate, day, horizon } : candidate
      )
    });
  }

  function updateTask(state, taskId, changes) {
    const task = state.tasks.find((candidate) => candidate.id === taskId);
    if (!task) return state;
    const text = Object.hasOwn(changes || {}, 'text') ? cleanText(changes.text, 500) : task.text;
    if (!text) return state;
    const note = Object.hasOwn(changes || {}, 'note') ? cleanText(changes.note, 1200) || null : task.note;
    const importance = Object.hasOwn(changes || {}, 'importance')
      ? normalizeImportance(changes.importance, 4)
      : task.importance;
    return touch({
      ...state,
      tasks: state.tasks.map((candidate) =>
        candidate.id === taskId ? { ...candidate, text, note, importance } : candidate
      )
    });
  }

  function moveTaskOrder(state, taskId, targetIndex) {
    const active = activeTasks(state);
    const fromIndex = active.findIndex((task) => task.id === taskId);
    if (fromIndex < 0 || active.length < 2) return state;
    const safeTarget = clamp(Math.round(finiteNumber(targetIndex, fromIndex)), 0, active.length - 1);
    if (safeTarget === fromIndex) return state;
    const reordered = [...active];
    const [task] = reordered.splice(fromIndex, 1);
    reordered.splice(safeTarget, 0, task);
    const orderById = new Map(reordered.map((entry, index) => [entry.id, index + 1]));
    return touch({
      ...state,
      tasks: state.tasks.map((entry) =>
        orderById.has(entry.id) ? { ...entry, order: orderById.get(entry.id) } : entry
      )
    });
  }

  function setCurrentTask(state, taskId) {
    const task = state.tasks.find(
      (candidate) => candidate.id === taskId && candidate.status === 'active'
    );
    if (!task || state.currentTaskId === taskId) return state;
    return touch({
      ...state,
      currentTaskId: taskId,
      timer: idleTimer(state.timer?.durationSeconds)
    });
  }

  function addFocusStep(state, taskId, text) {
    const value = cleanText(text, 240);
    const task = state.tasks.find((candidate) => candidate.id === taskId && candidate.status === 'active');
    if (!task || !value) return state;
    const focusSteps = asArray(task.focusSteps);
    if (focusSteps.length >= MAX_FOCUS_STEPS) throw new Error('FOCUS_STEP_LIMIT_REACHED');
    const createdAt = nowIso();
    const step = {
      id: createId('step'),
      text: value,
      completed: false,
      createdAt,
      completedAt: null
    };
    return touch({
      ...state,
      tasks: state.tasks.map((candidate) =>
        candidate.id === taskId ? { ...candidate, focusSteps: [...focusSteps, step] } : candidate
      )
    }, createdAt);
  }

  function toggleFocusStep(state, taskId, stepId) {
    const task = state.tasks.find((candidate) => candidate.id === taskId && candidate.status === 'active');
    const step = task?.focusSteps?.find((candidate) => candidate.id === stepId);
    if (!task || !step) return state;
    const completed = !step.completed;
    const changedAt = nowIso();
    return touch({
      ...state,
      tasks: state.tasks.map((candidate) =>
        candidate.id === taskId
          ? {
              ...candidate,
              focusSteps: candidate.focusSteps.map((entry) =>
                entry.id === stepId
                  ? { ...entry, completed, completedAt: completed ? changedAt : null }
                  : entry
              )
            }
          : candidate
      )
    }, changedAt);
  }

  function completeNextFocusStep(state, taskId) {
    const task = state.tasks.find((candidate) => candidate.id === taskId && candidate.status === 'active');
    const step = task?.focusSteps?.find((candidate) => !candidate.completed);
    return step ? toggleFocusStep(state, taskId, step.id) : state;
  }

  function deleteFocusStep(state, taskId, stepId) {
    const task = state.tasks.find((candidate) => candidate.id === taskId && candidate.status === 'active');
    if (!task?.focusSteps?.some((step) => step.id === stepId)) return state;
    return touch({
      ...state,
      tasks: state.tasks.map((candidate) =>
        candidate.id === taskId
          ? { ...candidate, focusSteps: candidate.focusSteps.filter((step) => step.id !== stepId) }
          : candidate
      )
    });
  }

  function setFocusDuration(state, minutes) {
    const parsed = Number(minutes);
    if (!Number.isFinite(parsed)) return state;
    const durationSeconds = clamp(Math.round(parsed), MIN_FOCUS_MINUTES, MAX_FOCUS_MINUTES) * 60;
    return touch({ ...state, timer: idleTimer(durationSeconds) });
  }

  function completeTask(state, taskId, completionNote = '') {
    const task = state.tasks.find((candidate) => candidate.id === taskId && candidate.status === 'active');
    if (!task) return state;
    const completedAt = nowIso();
    const tasks = state.tasks.map((candidate) =>
      candidate.id === taskId
        ? {
            ...candidate,
            status: 'completed',
            completedAt,
            completionNote: cleanText(completionNote, 1200) || null
          }
        : candidate
    );
    const nextCurrent = activeTasks({ ...state, tasks }, 'today')[0]?.id || null;
    return touch({
      ...state,
      tasks,
      currentTaskId: state.currentTaskId === taskId ? nextCurrent : state.currentTaskId,
      timer: idleTimer(state.timer?.durationSeconds)
    }, completedAt);
  }

  function restoreCompletedTask(state, taskId) {
    const task = state.tasks.find((candidate) => candidate.id === taskId && candidate.status === 'completed');
    if (!task) return state;
    return touch({
      ...state,
      tasks: state.tasks.map((candidate) =>
        candidate.id === taskId
          ? { ...candidate, status: 'active', day: 'inbox', horizon: 'unscheduled', completedAt: null, completionNote: null }
          : candidate
      )
    });
  }

  function addReminder(state, text) {
    const value = cleanText(text, 500);
    if (!value) return state;
    const createdAt = nowIso();
    const reminder = {
      id: createId('reminder'),
      text: value,
      order: Math.max(0, ...state.reminders.map((entry) => Number(entry.order) || 0)) + 1,
      createdAt
    };
    return touch({ ...state, reminders: [...state.reminders, reminder] }, createdAt);
  }

  function updateReminder(state, reminderId, text) {
    const value = cleanText(text, 500);
    if (!value || !state.reminders.some((entry) => entry.id === reminderId)) return state;
    return touch({
      ...state,
      reminders: state.reminders.map((entry) => (entry.id === reminderId ? { ...entry, text: value } : entry))
    });
  }

  function deleteReminder(state, reminderId) {
    const reminder = state.reminders.find((entry) => entry.id === reminderId);
    if (!reminder) return state;
    const deletedAt = nowIso();
    return touch({
      ...state,
      reminders: state.reminders.filter((entry) => entry.id !== reminderId),
      trash: [{ id: createId('trash'), kind: 'reminder', record: reminder, deletedAt }, ...state.trash]
    }, deletedAt);
  }

  function deleteTask(state, taskId) {
    const task = state.tasks.find((candidate) => candidate.id === taskId);
    if (!task) return state;
    const deletedAt = nowIso();
    const tasks = state.tasks.filter((candidate) => candidate.id !== taskId);
    const nextCurrent =
      state.currentTaskId === taskId ? activeTasks({ ...state, tasks }, 'today')[0]?.id || null : state.currentTaskId;
    const currentChanged = nextCurrent !== state.currentTaskId;
    return touch({
      ...state,
      tasks,
      currentTaskId: nextCurrent,
      timer: currentChanged
        ? idleTimer(state.timer?.durationSeconds)
        : state.timer,
      trash: [
        { id: createId('trash'), kind: 'task', record: task, deletedAt },
        ...state.trash
      ]
    }, deletedAt);
  }

  function deletePaper(state, paperId) {
    if (state.papers.length <= 1) throw new Error('LAST_PAPER');
    const paper = state.papers.find((candidate) => candidate.id === paperId);
    if (!paper) return state;
    const deletedAt = nowIso();
    const papers = state.papers.filter((candidate) => candidate.id !== paperId);
    return touch({
      ...state,
      papers,
      selectedPaperId: state.selectedPaperId === paperId ? papers[0].id : state.selectedPaperId,
      trash: [{ id: createId('trash'), kind: 'paper', record: paper, deletedAt }, ...state.trash]
    }, deletedAt);
  }

  function restoreTrash(state, trashId) {
    const entry = state.trash.find((candidate) => candidate.id === trashId);
    if (!entry) return state;
    const remainingTrash = state.trash.filter((candidate) => candidate.id !== trashId);
    if (entry.kind === 'paper') {
      const collision = state.papers.some((paper) => paper.id === entry.record.id);
      const paper = collision ? { ...entry.record, id: createId('paper') } : entry.record;
      return touch({ ...state, papers: [...state.papers, paper], selectedPaperId: paper.id, trash: remainingTrash });
    }
    if (entry.kind === 'reminder') {
      const collision = state.reminders.some((reminder) => reminder.id === entry.record.id);
      const reminder = collision ? { ...entry.record, id: createId('reminder') } : entry.record;
      return touch({ ...state, reminders: [...state.reminders, reminder], trash: remainingTrash });
    }
    const collision = state.tasks.some((task) => task.id === entry.record.id);
    let task = collision ? { ...entry.record, id: createId('task') } : entry.record;
    task = { ...task, horizon: normalizeHorizon(task.horizon, task.day) };
    if (task.day !== 'today') task = { ...task, day: task.horizon === 'week' ? 'tomorrow' : 'inbox' };
    if (task.status === 'active' && task.day === 'today' && todayCount(state) >= TODAY_LIMIT) {
      task = { ...task, day: 'tomorrow' };
    }
    const currentTaskId = state.currentTaskId || (task.status === 'active' && task.day === 'today' ? task.id : null);
    return touch({ ...state, tasks: [...state.tasks, task], currentTaskId, trash: remainingTrash });
  }

  function taskIdentity(task) {
    return `${cleanText(task?.text, 500).toLocaleLowerCase()}|${validIso(task?.createdAt, new Date(0).toISOString())}`;
  }

  function reminderIdentity(reminder) {
    return `${cleanText(reminder?.text, 500).toLocaleLowerCase()}|${validIso(reminder?.createdAt, new Date(0).toISOString())}`;
  }

  function mergeCurrentStates(primaryValue, secondaryValue) {
    if (!primaryValue) return normalizeState(secondaryValue);
    if (!secondaryValue) return normalizeState(primaryValue);
    const primary = normalizeState(primaryValue);
    const secondary = normalizeState(secondaryValue);

    const paperIds = new Set(primary.papers.map((paper) => paper.id));
    const paperKeys = new Set(primary.papers.map((paper) => `${paper.title}|${paper.createdAt}`));
    const papers = [...primary.papers];
    secondary.papers.forEach((paper) => {
      const key = `${paper.title}|${paper.createdAt}`;
      if (!paperIds.has(paper.id) && !paperKeys.has(key)) {
        papers.push(paper);
        paperIds.add(paper.id);
        paperKeys.add(key);
      }
    });

    const taskIds = new Set(primary.tasks.map((task) => task.id));
    const taskKeys = new Set(primary.tasks.map(taskIdentity));
    const tasks = [...primary.tasks];
    secondary.tasks.forEach((task) => {
      const key = taskIdentity(task);
      if (!taskIds.has(task.id) && !taskKeys.has(key)) {
        tasks.push(task);
        taskIds.add(task.id);
        taskKeys.add(key);
      }
    });

    const reminderIds = new Set(primary.reminders.map((reminder) => reminder.id));
    const reminderKeys = new Set(primary.reminders.map(reminderIdentity));
    const reminders = [...primary.reminders];
    secondary.reminders.forEach((reminder) => {
      const key = reminderIdentity(reminder);
      if (!reminderIds.has(reminder.id) && !reminderKeys.has(key)) {
        reminders.push(reminder);
        reminderIds.add(reminder.id);
        reminderKeys.add(key);
      }
    });

    const trashIds = new Set(primary.trash.map((entry) => entry.id));
    const trash = [...primary.trash, ...secondary.trash.filter((entry) => !trashIds.has(entry.id))];
    const modifiedAt = timestampOf(primary.modifiedAt) >= timestampOf(secondary.modifiedAt)
      ? primary.modifiedAt
      : secondary.modifiedAt;
    return normalizeState({ ...primary, papers, tasks, reminders, trash, modifiedAt });
  }

  function timestampOf(value) {
    const parsed = new Date(value || 0).getTime();
    return Number.isFinite(parsed) ? parsed : 0;
  }

  function mergeLegacyState(currentValue, legacyValue, mergedAt = nowIso()) {
    const current = normalizeState(currentValue);
    if (!legacyValue || typeof legacyValue !== 'object' || current.legacyMergedAt) return current;
    const legacy = migrateLegacyState(legacyValue);
    const taskById = new Map(current.tasks.map((task) => [task.id, task]));
    const taskByKey = new Map(current.tasks.map((task) => [taskIdentity(task), task]));
    const tasks = [...current.tasks];
    legacy.tasks.forEach((legacyTask) => {
      const existing = taskById.get(legacyTask.id) || taskByKey.get(taskIdentity(legacyTask));
      if (existing) {
        if ((!existing.note && legacyTask.note) || (!existing.completionNote && legacyTask.completionNote)) {
          const index = tasks.findIndex((task) => task.id === existing.id);
          tasks[index] = {
            ...existing,
            note: existing.note || legacyTask.note,
            completionNote: existing.completionNote || legacyTask.completionNote
          };
        }
        return;
      }
      const task = legacyTask.status === 'active' ? { ...legacyTask, day: 'inbox' } : legacyTask;
      tasks.push(task);
      taskById.set(task.id, task);
      taskByKey.set(taskIdentity(task), task);
    });

    const reminderIds = new Set(current.reminders.map((reminder) => reminder.id));
    const reminderKeys = new Set(current.reminders.map(reminderIdentity));
    const reminders = [...current.reminders];
    legacy.reminders.forEach((reminder) => {
      const key = reminderIdentity(reminder);
      if (!reminderIds.has(reminder.id) && !reminderKeys.has(key)) reminders.push(reminder);
    });

    const trashIds = new Set(current.trash.map((entry) => entry.id));
    const trash = [...current.trash, ...legacy.trash.filter((entry) => !trashIds.has(entry.id))];
    return normalizeState({
      ...current,
      tasks,
      reminders,
      trash,
      pinned: typeof legacyValue.pinned === 'boolean' ? legacyValue.pinned : current.pinned,
      legacyMergedAt: validIso(mergedAt),
      modifiedAt: validIso(mergedAt)
    });
  }

  const api = {
    VERSION,
    TODAY_LIMIT,
    MAX_FOCUS_STEPS,
    FOCUS_DURATION_SECONDS,
    MIN_FOCUS_MINUTES,
    MAX_FOCUS_MINUTES,
    createId,
    createPaper,
    createInitialState,
    normalizeState,
    migrateLegacyState,
    touch,
    selectedPaper,
    activeTasks,
    completedTasks,
    addPaper,
    movePaper,
    updatePaper,
    updateLane,
    addPaperNote,
    updatePaperNote,
    deletePaperNote,
    addTask,
    moveTask,
    setTaskHorizon,
    updateTask,
    moveTaskOrder,
    setCurrentTask,
    setFocusDuration,
    addFocusStep,
    toggleFocusStep,
    completeNextFocusStep,
    deleteFocusStep,
    completeTask,
    restoreCompletedTask,
    addReminder,
    updateReminder,
    deleteReminder,
    deleteTask,
    deletePaper,
    restoreTrash,
    mergeCurrentStates,
    mergeLegacyState
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (globalScope) globalScope.paperStore = api;
})(typeof window !== 'undefined' ? window : globalThis);
