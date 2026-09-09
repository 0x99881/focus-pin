(function startFocusPin() {
  'use strict';

  const store = window.paperStore;
  const i18n = window.focusI18n;
  const LOCAL_STATE_KEY = 'focus-pin-state-v2';
  const LEGACY_STATE_KEY = 'focus-memo-state-v1';
  const LEGACY_THEME_KEY = 'focus-memo-theme';
  const HORIZON_OPTIONS = [
    { id: 'week', label: '本周', hint: '7 天内' },
    { id: 'month', label: '本月', hint: '30 天内' },
    { id: 'half-year', label: '半年', hint: '6 个月内' },
    { id: 'unscheduled', label: '待安排', hint: '还没决定' }
  ];

  const fullApp = document.getElementById('fullApp');
  const compactApp = document.getElementById('compactApp');
  const content = document.getElementById('content');
  const paperList = document.getElementById('paperList');
  const saveStatus = document.getElementById('saveStatus');
  const todayNavCount = document.getElementById('todayNavCount');
  const headerSubtitle = document.getElementById('headerSubtitle');
  const trashCount = document.getElementById('trashCount');
  const compactTask = document.getElementById('compactTask');
  const sidebarReminder = document.getElementById('sidebarReminder');
  const themeButton = document.getElementById('themeButton');
  const languageButton = document.getElementById('languageButton');

  const preferredLanguage = String(navigator.language || '').toLowerCase().startsWith('zh') ? 'zh-CN' : 'en';
  let state = store.createInitialState(undefined, preferredLanguage);
  let drawingTool = 'pen';
  let drawingColor = 'auto';
  let drawingWidth = 2.8;
  let drawingSession = null;
  let paperMoveSession = null;
  let suppressPaperDoubleClickUntil = 0;
  let toastTimer = null;
  let saveTimer = null;
  let saveInFlight = null;
  let changeVersion = 0;
  let savedVersion = 0;
  let forceSnapshotPending = false;
  let undoStacks = new Map();
  let timerFinishHandled = false;
  let finishAudio = null;
  let finishMusicPlaying = false;
  let draggedTaskId = null;
  let activeHorizon = 'week';

  function escapeHtml(value) {
    return String(value ?? '')
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#039;');
  }

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function tr(value) {
    return i18n?.translateText(value, state.language) || String(value ?? '');
  }

  function applyUiLanguage(root = document) {
    i18n?.apply(root, state.language);
  }

  function confirmUi(message) {
    return window.confirm(tr(message));
  }

  function promptUi(message, value) {
    return window.prompt(tr(message), value);
  }

  function readLocal(key) {
    try {
      const value = localStorage.getItem(key);
      return value ? JSON.parse(value) : null;
    } catch {
      return null;
    }
  }

  function readLocalText(key) {
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  }

  function timestamp(value) {
    const parsed = new Date(value || 0).getTime();
    return Number.isFinite(parsed) ? parsed : 0;
  }

  function setSaveStatus(text, kind = '') {
    saveStatus.textContent = tr(text);
    saveStatus.className = `save-status ${kind}`.trim();
  }

  function writeLocalImmediately() {
    try {
      localStorage.setItem(LOCAL_STATE_KEY, JSON.stringify(state));
    } catch (error) {
      setSaveStatus('本地空间不足', 'error');
      console.error(error);
    }
  }

  function scheduleSave(forceSnapshot = false) {
    forceSnapshotPending ||= forceSnapshot;
    setSaveStatus('保存中…', 'saving');
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      persistPending().catch(() => {});
    }, 180);
  }

  async function persistPending() {
    clearTimeout(saveTimer);
    saveTimer = null;
    if (saveInFlight) {
      await saveInFlight;
      if (savedVersion < changeVersion) return persistPending();
      return true;
    }

    const versionToSave = changeVersion;
    const snapshot = clone(state);
    const forceSnapshot = forceSnapshotPending;
    forceSnapshotPending = false;
    saveInFlight = window.focusWindow
      .saveState(snapshot, { forceSnapshot })
      .then(() => {
        savedVersion = Math.max(savedVersion, versionToSave);
        if (savedVersion === changeVersion) setSaveStatus('已保存');
        return true;
      })
      .catch((error) => {
        forceSnapshotPending ||= forceSnapshot;
        setSaveStatus('保存失败，已留临时副本', 'error');
        console.error(error);
        setTimeout(() => {
          if (savedVersion < changeVersion) scheduleSave(forceSnapshotPending);
        }, 2000);
        return false;
      })
      .finally(() => {
        saveInFlight = null;
      });
    const result = await saveInFlight;
    if (result && savedVersion < changeVersion) return persistPending();
    return result;
  }

  function commit(nextState, options = {}) {
    state = nextState;
    changeVersion += 1;
    writeLocalImmediately();
    scheduleSave(Boolean(options.forceSnapshot));
    if (options.render !== false) renderAll();
  }

  function showToast(message) {
    let toast = document.getElementById('toast');
    if (!toast) {
      toast = document.createElement('div');
      toast.id = 'toast';
      toast.className = 'toast';
      toast.setAttribute('role', 'status');
      document.body.append(toast);
    }
    toast.textContent = tr(message);
    toast.classList.remove('hidden');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.add('hidden'), 2600);
  }

  function currentTask() {
    return state.tasks.find(
      (task) => task.id === state.currentTaskId && task.status === 'active'
    ) || null;
  }

  function effectiveRemaining() {
    if (!state.timer.running || !state.timer.deadline) return state.timer.remainingSeconds;
    const seconds = Math.ceil((new Date(state.timer.deadline).getTime() - Date.now()) / 1000);
    return Math.max(0, Math.min(state.timer.durationSeconds, seconds));
  }

  function focusDurationMinutes() {
    return Math.max(1, Math.round((state.timer.durationSeconds || store.FOCUS_DURATION_SECONDS) / 60));
  }

  function formatTime(seconds) {
    const safe = Math.max(0, Math.round(seconds));
    return `${String(Math.floor(safe / 60)).padStart(2, '0')}:${String(safe % 60).padStart(2, '0')}`;
  }

  function remainingPercent(remaining = effectiveRemaining()) {
    const duration = Math.max(1, Number(state.timer.durationSeconds) || store.FOCUS_DURATION_SECONDS);
    return Math.max(0, Math.min(100, (remaining / duration) * 100));
  }

  function formatClockTime(value) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '';
    return new Intl.DateTimeFormat(state.language === 'en' ? 'en' : 'zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false }).format(date);
  }

  function timerEndLabel(remaining = effectiveRemaining()) {
    if (state.timer.finished || remaining <= 0) return tr('本轮已经结束');
    const deadline = state.timer.running && state.timer.deadline
      ? new Date(state.timer.deadline)
      : new Date(Date.now() + remaining * 1000);
    const prefix = state.timer.running
      ? '预计'
      : remaining < state.timer.durationSeconds
        ? '继续后约'
        : '开始后约';
    return tr(`${prefix} ${formatClockTime(deadline)} 结束`);
  }

  function formatDate(value) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '';
    return new Intl.DateTimeFormat(state.language === 'en' ? 'en' : 'zh-CN', { month: 'numeric', day: 'numeric' }).format(date);
  }

  function paperTaskCount(paperId) {
    return state.tasks.filter((task) => task.paperId === paperId && task.status === 'active').length;
  }

  function renderChrome() {
    const today = store.activeTasks(state, 'today');
    headerSubtitle.textContent = '';
    todayNavCount.textContent = `${today.length}/3`;
    trashCount.textContent = String(state.trash.length);
    document.body.classList.toggle('theme-dark', state.theme === 'dark');
    if (themeButton) themeButton.textContent = state.theme === 'dark' ? '☀' : '◐';
    if (languageButton) {
      const english = state.language === 'en';
      languageButton.textContent = english ? 'ZH' : 'EN';
      languageButton.title = english ? 'Switch to Chinese' : '切换到英文';
      languageButton.setAttribute('aria-label', languageButton.title);
    }
    if (sidebarReminder) {
      sidebarReminder.textContent = state.reminders[0]?.text || '写一句只对你有用的话';
    }
    document.querySelectorAll('.nav-button').forEach((button) => {
      const active = button.dataset.view === state.view;
      button.classList.toggle('active', active);
      button.toggleAttribute('aria-current', active);
    });

    paperList.innerHTML = state.papers
      .map((entry, index) => {
        const activeCount = paperTaskCount(entry.id);
        const status = [activeCount ? `${activeCount} 件在推进` : '', entry.strokes.length ? '有手写痕迹' : '']
          .filter(Boolean)
          .join(' · ');
        return `
          <div class="paper-item ${entry.id === state.selectedPaperId ? 'active' : ''}">
            <button class="paper-select" data-action="select-paper" data-paper-id="${entry.id}">
              <strong><em>${String(index + 1).padStart(2, '0')}</em>${escapeHtml(entry.title)}</strong>
              ${status ? `<small>${status}</small>` : ''}
            </button>
            <button class="paper-delete" data-action="delete-paper" data-paper-id="${entry.id}" title="移到回收站" aria-label="删除主题纸">×</button>
          </div>`;
      })
      .join('');
  }

  function laneResultHtml(paper, lane) {
    const results = store
      .completedTasks(state)
      .filter((task) => task.paperId === paper.id && task.laneId === lane.id)
      .slice(0, 2);
    if (!results.length) return '';
    return `<div class="lane-results">
      ${results
        .map(
          (task) => `<p class="lane-result">✓ <b>${escapeHtml(task.text)}</b>${
            task.completionNote ? ` — ${escapeHtml(task.completionNote)}` : ''
          }</p>`
        )
        .join('')}
    </div>`;
  }

  function renderPaperPage() {
    const paper = store.selectedPaper(state);
    if (!paper) return '<section class="page"><div class="empty-state">没有主题纸</div></section>';
    const toolButton = (tool, icon, label) => `
      <button class="sketch-tool ${drawingTool === tool ? 'active' : ''}" data-action="drawing-tool" data-tool="${tool}" title="${label}">
        <i aria-hidden="true">${icon}</i><span>${label}</span>
      </button>`;
    return `
      <section class="page paper-page paper-workspace-page">
        <div class="paper-workspace-heading">
          <div>
            <input class="paper-title-input" data-field="paper-title" data-paper-id="${paper.id}" maxlength="80" value="${escapeHtml(paper.title)}" aria-label="主题纸标题" />
          </div>
          <span class="paper-hint">随手写，内容会自动保存</span>
        </div>

        <article id="paperCanvasStage" class="paper-sheet paper-canvas-stage ${paper.style} tool-${drawingTool} ${drawingTool === 'eraser' ? 'eraser-cursor' : ''}" data-paper-id="${paper.id}">
          <div class="paper-stage-toolbar" aria-label="电子纸工具">
            <div class="paper-tool-group mode-tools">
              ${toolButton('pen', '✎', '画笔')}
              ${toolButton('highlighter', '▰', '荧光笔')}
              ${toolButton('eraser', '◇', '橡皮')}
            </div>
            <div class="paper-tool-group ink-options" aria-label="笔迹颜色和粗细">
              ${[
                ['auto', '自动'],
                ['#d87856', '橙色'],
                ['#4d8794', '蓝色'],
                ['#e0b74f', '黄色']
              ].map(([color, label]) => `<button class="ink-color ${drawingColor === color ? 'active' : ''} ${color === 'auto' ? 'auto' : ''}" data-action="ink-color" data-color="${color}" title="${label}" style="--swatch:${color === 'auto' ? 'currentColor' : color}"><span></span></button>`).join('')}
              ${[
                [2.8, '细'],
                [5, '中'],
                [8, '粗']
              ].map(([width, label]) => `<button class="ink-width ${Number(drawingWidth) === width ? 'active' : ''}" data-action="ink-width" data-width="${width}" title="${label}"><i style="--dot:${width}px"></i></button>`).join('')}
            </div>
            <div class="paper-tool-group history-tools">
              <button class="sketch-tool" data-action="undo-stroke" title="撤销笔迹"><i aria-hidden="true">↶</i><span>撤销</span></button>
              <button class="sketch-tool quiet" data-action="clear-strokes" title="清空笔迹"><i aria-hidden="true">×</i><span>清空</span></button>
            </div>
            <div class="paper-tool-group paper-style-tools" aria-label="纸张样式">
              <button class="tool-button ${paper.style === 'grid' ? 'active' : ''}" data-action="paper-style" data-style="grid" title="格子纸">格</button>
              <button class="tool-button ${paper.style === 'dot' ? 'active' : ''}" data-action="paper-style" data-style="dot" title="点阵纸">点</button>
              <button class="tool-button ${paper.style === 'line' ? 'active' : ''}" data-action="paper-style" data-style="line" title="横线纸">线</button>
              <button class="tool-button ${paper.style === 'plain' ? 'active' : ''}" data-action="paper-style" data-style="plain" title="空白纸">空</button>
            </div>
          </div>

          <div class="paper-stage-tip"><strong>按住空白处直接画 · 双击添加文字</strong><span>文字和纸片仍可直接点选、修改和移动</span></div>
          <canvas id="sketchCanvas" aria-label="整张电子纸画布"></canvas>

          <div class="paper-object-layer">
            ${paper.freeNotes
              .map(
                (note) => `
                  <section class="paper-free-note paper-slip note-${note.color}" tabindex="0" style="left:${note.x}%;top:${note.y}%;width:${note.width}%" data-paper-note data-note-id="${note.id}" data-paper-id="${paper.id}" aria-label="文字纸片">
                    <header class="paper-object-handle note-handle" data-paper-drag-handle data-object-kind="note" title="按住移动这张纸片">
                      <span aria-hidden="true">⠿</span><small>纸片</small>
                      <button data-action="cycle-paper-note-color" data-note-id="${note.id}" data-paper-id="${paper.id}" title="换纸张颜色" aria-label="换纸张颜色">●</button>
                      <button data-action="delete-paper-note" data-note-id="${note.id}" data-paper-id="${paper.id}" title="删除纸片" aria-label="删除纸片">×</button>
                    </header>
                    <textarea class="paper-note-text" data-field="paper-note-text" data-note-id="${note.id}" data-paper-id="${paper.id}" maxlength="6000" placeholder="从这里开始写…">${escapeHtml(note.text)}</textarea>
                    <footer class="paper-note-actions">
                      <span>放到</span>
                      <button data-action="pin-paper-note" data-day="today" data-note-id="${note.id}" data-paper-id="${paper.id}" ${note.text.trim() ? '' : 'disabled'}>今天</button>
                      <button data-action="pin-paper-note" data-day="tomorrow" data-note-id="${note.id}" data-paper-id="${paper.id}" ${note.text.trim() ? '' : 'disabled'}>本周</button>
                    </footer>
                  </section>`
              )
              .join('')}
            ${paper.lanes
              .map(
                (lane, index) => `
                  <section class="canvas-lane-card paper-text-block" tabindex="0" style="--lane-index:${index};left:${lane.position.x}%;top:${lane.position.y}%" data-canvas-lane data-paper-id="${paper.id}" data-lane-id="${lane.id}" aria-label="${escapeHtml(lane.title)}文字块">
                    <header class="paper-object-handle lane-card-handle" data-paper-drag-handle data-object-kind="lane" title="按住移动这段文字">
                      <span class="object-grip" aria-hidden="true">⠿</span><input class="lane-title" data-field="lane-title" data-paper-id="${paper.id}" data-lane-id="${lane.id}" maxlength="80" value="${escapeHtml(lane.title)}" aria-label="方向名称" />
                    </header>
                    <label class="paper-text-line"><span>公司或目标：</span><input class="paper-input" data-field="company" data-paper-id="${paper.id}" data-lane-id="${lane.id}" maxlength="300" value="${escapeHtml(lane.company)}" placeholder="点这里写" /></label>
                    <label class="paper-text-line paper-text-thought"><span>随手想法：</span><textarea class="paper-textarea" data-field="notes" data-paper-id="${paper.id}" data-lane-id="${lane.id}" maxlength="6000" placeholder="先写几句，粗糙也没关系…">${escapeHtml(lane.notes)}</textarea></label>
                    <label class="paper-text-line"><span>下一步：</span><input class="paper-input" data-field="nextAction" data-paper-id="${paper.id}" data-lane-id="${lane.id}" maxlength="500" value="${escapeHtml(lane.nextAction)}" placeholder="写一件可以马上做的小事" /></label>
                    <div class="paper-block-actions" aria-label="把下一步放入待办">
                      <span>下一步放到</span>
                      <button data-action="pin-task" data-day="today" data-paper-id="${paper.id}" data-lane-id="${lane.id}">今天</button>
                      <button data-action="pin-task" data-day="tomorrow" data-paper-id="${paper.id}" data-lane-id="${lane.id}">本周</button>
                    </div>
                    ${laneResultHtml(paper, lane)}
                  </section>`
              )
              .join('')}
          </div>
        </article>
      </section>`;
  }

  function importanceLabel(level) {
    return ['有空再做', '可以等等', '正常推进', '重要，接下来做', '重且急，现在就做'][Math.max(1, Math.min(5, Number(level) || 3)) - 1];
  }

  function priorityTasks(currentState = state) {
    return store.activeTasks(currentState).sort((a, b) => b.importance - a.importance || a.order - b.order);
  }

  function missionTracks(currentState = state) {
    const ranked = priorityTasks(currentState);
    const current = ranked.find((task) => task.id === currentState.currentTaskId);
    const mainline = [...(current ? [current] : []), ...ranked.filter((task) => task.id !== current?.id)].slice(0, 3);
    const mainIds = new Set(mainline.map((task) => task.id));
    return { mainline, branches: ranked.filter((task) => !mainIds.has(task.id)) };
  }

  function missionTaskHtml(task, index, track) {
    const level = Math.max(1, Math.min(5, Number(task.importance) || 3));
    const isCurrent = task.id === state.currentTaskId;
    const role = isCurrent ? '当前主线' : track === 'mainline' ? `主线第 ${index + 1} 站` : '支线';
    return `<article class="task-priority-card mission-task importance-${level} ${track === 'mainline' ? 'mainline-task' : 'branch-task'} ${isCurrent ? 'current-mainline' : ''}" style="--importance-level: ${level}; --strength: ${level * 20}%" tabindex="0" data-task-priority-card data-task-id="${task.id}" data-importance="${level}" title="${role} · 重要度 ${level}/5 · ${escapeHtml(task.text)}">
      <span class="mission-station" aria-hidden="true"></span>
      <span class="priority-drag-handle" data-priority-drag-handle draggable="true" title="同重要度内拖动排序" aria-label="拖动调整同分顺序">⠿</span>
      <span class="pillar-position">${String(index + 1).padStart(2, '0')}</span>
      <div class="mission-task-copy"><small>${role}</small><h3>${escapeHtml(task.text)}</h3></div>
      <div class="mission-strength" aria-label="重要度 ${level}/5，${importanceLabel(level)}"><i><span></span></i><b><em>${level} 档</em><span> · ${importanceLabel(level)}</span></b></div>
      <div class="row-importance-picker" role="group" aria-label="${escapeHtml(task.text)}的重要度">
        ${[1, 2, 3, 4, 5].map((choice) => `<button class="importance-choice level-${choice} ${level === choice ? 'active' : ''}" data-action="set-task-importance" data-task-id="${task.id}" data-importance="${choice}" aria-label="设为重要度 ${choice}" aria-pressed="${level === choice}" title="重要度 ${choice}：${importanceLabel(choice)}">${choice}</button>`).join('')}
      </div>
      <div class="priority-row-actions">
        <button class="priority-row-button focus" data-action="focus-task" data-task-id="${task.id}">${isCurrent ? '继续' : '专注'}</button>
        <button class="priority-row-button complete" data-action="complete-task" data-task-id="${task.id}">完成</button>
        <button class="priority-row-button" data-action="edit-task" data-task-id="${task.id}">修改</button>
      </div>
    </article>`;
  }

  function renderPriorityPage() {
    const activeItems = priorityTasks();
    const { mainline, branches } = missionTracks();
    return `
      <section class="page priority-page">
        <div class="page-heading priority-heading">
          <div>
            <span class="eyebrow">方向比忙碌更重要</span>
            <h1>任务主线图</h1>
          </div>
          <span class="capacity-badge">主线 ${mainline.length} · 支线 ${branches.length}</span>
        </div>

        <section class="priority-section">
          <section class="priority-skyline task-priority-skyline horizontal-priority-skyline mission-map" aria-label="全部未完成事项任务主线图">
            ${activeItems.length ? `<div class="priority-direct-guide">
              <div class="priority-direct-copy">
                <strong>主线只留三件：当前任务在第一站</strong>
                <span>调高档位会向主线靠近；同档时抓住把手拖动。</span>
              </div>
              <div class="priority-color-legend" aria-label="五档重要度颜色">
                <span>轻</span>
                ${[1, 2, 3, 4, 5].map((level) => `<i class="level-${level}">${level}</i>`).join('')}
                <strong>重 / 急</strong>
              </div>
            </div>` : '<div class="empty-state">还没有未完成事项。</div>'}
            <div id="taskPriorityBoard" class="priority-board task-priority-board horizontal-priority-board mission-board ${activeItems.length > 12 ? 'many-items' : ''}">
              ${mainline.length ? `<section class="mission-track mainline-track" aria-label="主线任务">
                <header><div><span>主线</span><strong>现在推进</strong></div><small>当前 → 接下来 → 再下一步</small></header>
                <div class="mission-list">${mainline.map((task, index) => missionTaskHtml(task, index, 'mainline')).join('')}</div>
              </section>` : ''}
              ${branches.length ? `<section class="mission-track branch-track" aria-label="支线任务">
                <header><div><span>支线</span><strong>先放在旁边</strong></div><small>不会丢，需要时调高档位</small></header>
                <div class="mission-list">${branches.map((task, index) => missionTaskHtml(task, index, 'branch')).join('')}</div>
              </section>` : ''}
            </div>
          </section>
        </section>

      </section>`;
  }

  function localDayKey(value) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '';
    return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
  }

  function isToday(value) {
    return localDayKey(value) === localDayKey(new Date());
  }

  function horizonId(task) {
    if (HORIZON_OPTIONS.some((option) => option.id === task?.horizon)) return task.horizon;
    return task?.day === 'today' || task?.day === 'tomorrow' ? 'week' : 'unscheduled';
  }

  function horizonOption(id) {
    return HORIZON_OPTIONS.find((option) => option.id === id) || HORIZON_OPTIONS[3];
  }

  function todayCommitmentHtml(task, index, durationMinutes) {
    const level = Math.max(1, Math.min(5, Number(task.importance) || 3));
    const isCurrent = task.id === state.currentTaskId;
    return `<article class="today-commitment importance-${level} ${isCurrent ? 'current' : ''}">
      <div class="today-commitment-top">
        <span class="today-position">0${index + 1}</span>
        <span class="today-importance">重要度 ${level}</span>
      </div>
      <h2>${escapeHtml(task.text)}</h2>
      ${task.note ? `<p>${escapeHtml(task.note)}</p>` : ''}
      <div class="today-commitment-actions">
        <button class="primary-button" data-action="focus-task" data-task-id="${task.id}">${isCurrent ? '继续专注' : '开始专注'} · ${durationMinutes} 分钟</button>
        <button class="secondary-button complete-now" data-action="complete-task" data-task-id="${task.id}">✓ 完成</button>
        <button class="small-action" data-action="move-task" data-day="tomorrow" data-task-id="${task.id}">放回本周</button>
      </div>
    </article>`;
  }

  function emptyCommitmentHtml(index) {
    return `<button class="today-commitment empty" data-action="set-horizon-view" data-horizon="week" data-scroll-horizon="true">
      <span class="today-position">0${index + 1}</span>
      <strong>从本周挑一件</strong>
      <small>今天只装真正要完成的事</small>
    </button>`;
  }

  function horizonPickerHtml(task) {
    const currentHorizon = horizonId(task);
    return `<div class="horizon-picker" role="group" aria-label="${escapeHtml(task.text)}的完成周期">
      ${HORIZON_OPTIONS.map((option) => `<button class="horizon-choice ${currentHorizon === option.id ? 'active' : ''}" data-action="set-task-horizon" data-task-id="${task.id}" data-horizon="${option.id}" aria-pressed="${currentHorizon === option.id}" title="${option.hint}">${option.label}</button>`).join('')}
    </div>`;
  }

  function horizonTaskHtml(task) {
    const level = Math.max(1, Math.min(5, Number(task.importance) || 3));
    const todayIsFull = store.activeTasks(state, 'today').length >= store.TODAY_LIMIT;
    return `<article class="horizon-task-row importance-${level}">
      <span class="horizon-importance" title="重要度 ${level}/5">${level}</span>
      <div class="horizon-task-copy">
        <strong>${escapeHtml(task.text)}</strong>
        ${task.note ? `<small>${escapeHtml(task.note)}</small>` : ''}
      </div>
      ${horizonPickerHtml(task)}
      <div class="horizon-task-actions">
        <button class="small-action emphasis" data-action="move-task" data-day="today" data-task-id="${task.id}" ${todayIsFull ? 'disabled title="今天已经有三件"' : ''}>今天</button>
        <button class="small-action" data-action="edit-task" data-task-id="${task.id}">修改</button>
        <button class="small-action" data-action="complete-task" data-task-id="${task.id}">完成</button>
      </div>
    </article>`;
  }

  function taskScheduleLabel(task) {
    return task.day === 'today' ? '今天' : horizonOption(horizonId(task)).label;
  }

  function organizeTaskHtml(task, index, activeCount) {
    return `<article class="organize-task-row">
      <div class="organize-order">
        <button class="small-action" data-action="move-task-order" data-direction="up" data-task-id="${task.id}" ${index === 0 ? 'disabled' : ''} title="向上">↑</button>
        <span>${String(index + 1).padStart(2, '0')}</span>
        <button class="small-action" data-action="move-task-order" data-direction="down" data-task-id="${task.id}" ${index === activeCount - 1 ? 'disabled' : ''} title="向下">↓</button>
      </div>
      <div class="organize-task-copy">
        <div><span class="task-day ${task.day} horizon-${horizonId(task)}">${taskScheduleLabel(task)}</span><strong>${escapeHtml(task.text)}</strong></div>
        ${task.note ? `<small>${escapeHtml(task.note)}</small>` : ''}
      </div>
      <div class="organize-task-actions">
        ${task.day !== 'today' ? `<button class="small-action emphasis" data-action="move-task" data-day="today" data-task-id="${task.id}">今天</button>` : ''}
        ${task.day === 'today' ? `<button class="small-action" data-action="move-task" data-day="tomorrow" data-task-id="${task.id}">放回本周</button>` : ''}
        <button class="small-action" data-action="edit-task" data-task-id="${task.id}">修改</button>
        <button class="small-action" data-action="complete-task" data-task-id="${task.id}">完成</button>
        <button class="small-action" data-action="delete-task" data-task-id="${task.id}" title="移到回收站">×</button>
      </div>
    </article>`;
  }

  function renderOrganizePage() {
    const active = store.activeTasks(state);
    const completed = store.completedTasks(state);
    return `
      <section class="page organize-page">
        <div class="page-heading organize-heading">
          <div><h1>全部数据</h1></div>
          <button class="secondary-button export-button" data-action="export-workbook">导出整理表</button>
        </div>

        <section class="organize-capture panel-card">
          <strong class="organize-capture-title">快速收集</strong>
          <div class="quick-add"><input id="organizeTaskInput" class="quick-input" maxlength="500" placeholder="写下一件事，回车放进待安排" /><button class="primary-button" data-action="quick-add" data-day="inbox" data-horizon="unscheduled">加入待安排</button></div>
        </section>

        <div class="organize-grid">
          <section class="panel-card organize-list-card">
            <div class="panel-heading"><h2>全部未完成</h2><span>${active.length} 件 · 可调整先后</span></div>
            <div class="organize-task-list">${active.length ? active.map((task, index) => organizeTaskHtml(task, index, active.length)).join('') : '<div class="empty-state">还没有未完成的事。</div>'}</div>
          </section>

          <div class="side-stack">
            <section class="panel-card reminder-card">
              <div class="panel-heading"><h2>提醒句</h2><span>${state.reminders.length} 条</span></div>
              <div class="reminder-add"><input id="reminderInput" class="quick-input" maxlength="500" placeholder="写一句只对你有用的话" /><button class="primary-button" data-action="add-reminder">添加</button></div>
              <div class="reminder-list">${
                state.reminders.length
                  ? state.reminders.map((reminder) => `<div class="reminder-row"><p>${escapeHtml(reminder.text)}</p><div><button class="small-action" data-action="edit-reminder" data-reminder-id="${reminder.id}">修改</button><button class="small-action" data-action="delete-reminder" data-reminder-id="${reminder.id}">×</button></div></div>`).join('')
                  : '<div class="empty-state">旧版的提醒句和新写的提醒都会在这里。</div>'
              }</div>
            </section>

            <section class="panel-card organize-history-card">
              <div class="panel-heading"><h2>完成记录</h2><span>${completed.length} 件</span></div>
              <div class="organize-history-list">${
                completed.length
                  ? completed.map((task) => `<div class="organize-history-row"><div><strong>${escapeHtml(task.text)}</strong><small>${formatDate(task.completedAt)}${task.completionNote ? ` · ${escapeHtml(task.completionNote)}` : ''}</small></div><button class="small-action" data-action="restore-completed" data-task-id="${task.id}">恢复</button></div>`).join('')
                  : '<div class="empty-state">完成的事情会留在这里。</div>'
              }</div>
            </section>
          </div>
        </div>
      </section>`;
  }

  function renderCheckPage() {
    const today = store.activeTasks(state, 'today');
    const upcoming = store.activeTasks(state).filter((task) => task.day !== 'today');
    const horizonGroups = Object.fromEntries(
      HORIZON_OPTIONS.map((option) => [option.id, upcoming.filter((task) => horizonId(task) === option.id)])
    );
    const visibleHorizonTasks = horizonGroups[activeHorizon] || [];
    const completedToday = store.completedTasks(state).filter((task) => isToday(task.completedAt));
    const durationMinutes = focusDurationMinutes();
    const slots = Array.from({ length: store.TODAY_LIMIT }, (_, index) =>
      today[index] ? todayCommitmentHtml(today[index], index, durationMinutes) : emptyCommitmentHtml(index)
    ).join('');
    return `
      <section class="page check-page">
        <div class="page-heading check-heading">
          <div><span class="eyebrow">每日收口</span><h1>今天要完成</h1></div>
          <div class="daily-progress" aria-label="今天完成 ${completedToday.length} 件">
            <strong>${completedToday.length}</strong>
            <span>今天已完成</span>
          </div>
        </div>

        <section class="today-board" aria-label="今天的三件事">${slots}</section>

        <div class="today-quick-add panel-card">
          <input id="quickTaskInput" class="quick-input" maxlength="500" placeholder="写下一件具体的小事" />
          <button class="primary-button" data-action="quick-add" data-day="today" ${today.length >= store.TODAY_LIMIT ? 'disabled title="今天已经有三件"' : ''}>放到今天</button>
          <button class="secondary-button" data-action="quick-add" data-day="tomorrow" data-horizon="week">放到本周</button>
        </div>

        <section id="timeHorizonPanel" class="panel-card horizon-panel">
          <div class="horizon-heading">
            <div><span class="eyebrow">时间视野</span><h2>接下来往哪走</h2></div>
            <span>重要度决定先后，周期决定什么时候完成</span>
          </div>
          <div class="horizon-tabs" role="tablist" aria-label="完成周期">
            ${HORIZON_OPTIONS.map((option) => `<button class="horizon-tab ${activeHorizon === option.id ? 'active' : ''}" role="tab" aria-selected="${activeHorizon === option.id}" data-action="set-horizon-view" data-horizon="${option.id}"><strong>${option.label}</strong><span>${horizonGroups[option.id].length}</span><small>${option.hint}</small></button>`).join('')}
          </div>
          <div class="horizon-task-list">
            ${visibleHorizonTasks.length
              ? visibleHorizonTasks.map(horizonTaskHtml).join('')
              : `<div class="horizon-empty">${activeHorizon === 'unscheduled' ? '所有事情都已经有时间方向了。' : `这里还没有事情，可以从“${horizonOption('unscheduled').label}”移进来。`}</div>`}
          </div>
        </section>

        ${completedToday.length ? `<section class="panel-card today-completed-card">
          <div class="panel-heading"><h2>今天完成</h2><span>${completedToday.length} 件</span></div>
          <div class="today-completed-list">${completedToday.map((task) => `<article><span>✓</span><div><strong>${escapeHtml(task.text)}</strong>${task.completionNote ? `<small>${escapeHtml(task.completionNote)}</small>` : ''}</div></article>`).join('')}</div>
        </section>` : ''}
      </section>`;
  }

  function renderFocusPage() {
    const current = currentTask();
    const remaining = effectiveRemaining();
    const today = store.activeTasks(state, 'today');
    const focusSteps = current?.focusSteps || [];
    const nextFocusStep = focusSteps.find((step) => !step.completed) || null;
    const focusStepsFull = focusSteps.length >= store.MAX_FOCUS_STEPS;
    const durationMinutes = focusDurationMinutes();
    const presetMinutes = [15, 25, 35, 45, 60];
    const timerText = state.timer.finished ? '本轮完成' : state.timer.running ? '专注中' : remaining < state.timer.durationSeconds ? '已暂停' : '准备开始';
    const durationDisabled = state.timer.running ? 'disabled' : '';
    return `
      <section class="page focus-page">
        <article class="focus-card">
          <span class="eyebrow">当前主线</span>
          <h1>${current ? escapeHtml(current.text) : '今天还没有当前任务'}</h1>
          ${current?.note ? `<p class="focus-source">${escapeHtml(current.note)}</p>` : !current ? '<p class="focus-source">回到今日检查，先选一件。</p>' : ''}
          <div class="focus-workbench">
            <div id="focusClock" class="focus-clock" style="--remaining: ${remainingPercent(remaining)}%">
              <div id="focusTime" class="focus-time">${formatTime(remaining)}</div>
              <div id="focusState" class="focus-state">${timerText}</div>
              <div id="focusEndAt" class="focus-end-at">${timerEndLabel(remaining)}</div>
            </div>
            <section class="focus-steps-panel" aria-label="本轮步骤">
              <div class="focus-steps-heading">
                <div><strong>本轮步骤</strong><span>支线先记下，不切走</span></div>
                <b>${focusSteps.length}/${store.MAX_FOCUS_STEPS}</b>
              </div>
              <div class="focus-step-capture">
                <input id="focusStepInput" maxlength="240" placeholder="${!current ? '先选择一条主线' : focusStepsFull ? '三步已满，完成或删除后再加' : '例如：先整理资料目录'}" ${!current || focusStepsFull ? 'disabled' : ''} />
                <button class="small-action emphasis" data-action="add-focus-step" ${!current || focusStepsFull ? 'disabled' : ''}>记下</button>
              </div>
              <div class="focus-step-list">
                ${focusSteps.length
                  ? focusSteps.map((step, index) => `<div class="focus-step-row ${step.completed ? 'completed' : ''} ${step.id === nextFocusStep?.id ? 'current' : ''}">
                      <button class="focus-step-check" data-action="toggle-focus-step" data-step-id="${step.id}" data-task-id="${current.id}" aria-label="${tr(step.completed ? '恢复' : '完成')} ${escapeHtml(step.text)}">${step.completed ? '✓' : index + 1}</button>
                      <strong>${escapeHtml(step.text)}</strong>
                      <button class="focus-step-delete" data-action="delete-focus-step" data-step-id="${step.id}" data-task-id="${current.id}" aria-label="删除这一步" title="删除这一步">×</button>
                    </div>`).join('')
                  : '<div class="focus-step-empty">把这一轮要做的小步骤写在这里。</div>'}
              </div>
            </section>
          </div>
          <div class="focus-duration-panel">
            <div class="focus-duration-heading"><strong>专注时长</strong><span>提醒声音：内置轻提示音（倒计时结束后播放）</span></div>
            <div class="focus-duration-controls">
              <div class="duration-presets">
                ${presetMinutes
                  .map(
                    (minutes) => `<button class="small-action ${durationMinutes === minutes ? 'emphasis active' : ''}" data-action="set-focus-minutes" data-minutes="${minutes}" ${durationDisabled}>${minutes}</button>`
                  )
                  .join('')}
              </div>
              <label class="custom-duration">
                <span class="custom-duration-label">自定义</span>
                <input id="customFocusMinutes" type="number" min="${store.MIN_FOCUS_MINUTES}" max="${store.MAX_FOCUS_MINUTES}" step="1" value="${presetMinutes.includes(durationMinutes) ? '' : durationMinutes}" placeholder="1–240" ${durationDisabled} aria-label="自定义专注分钟数" />
                <span>分钟</span>
                <button class="small-action" data-action="apply-custom-focus-time" ${durationDisabled}>使用</button>
              </label>
            </div>
          </div>
          ${state.timer.finished
            ? `<section class="focus-finish-decision">
                <div><strong>这一轮结束了，接下来？</strong><span>${nextFocusStep ? `眼前一步：${escapeHtml(nextFocusStep.text)}` : '可以继续一轮，或完成整条主线。'}</span></div>
                <div class="focus-finish-actions">
                  <button class="secondary-button" data-action="complete-current-focus-step" ${nextFocusStep ? '' : 'disabled'}>✓ 完成本轮步骤</button>
                  <button class="secondary-button" data-action="complete-task" data-task-id="${current?.id || ''}" ${current ? '' : 'disabled'}>完成整条主线</button>
                  <button class="primary-button" data-action="restart-focus-round" ${current ? '' : 'disabled'}>再专注一轮</button>
                  <button class="secondary-button finish-music-stop" data-action="stop-finish-music" ${finishMusicPlaying ? '' : 'hidden'}>停止音乐</button>
                </div>
              </section>`
            : `<div class="focus-actions">
                <button class="primary-button" data-action="toggle-timer" ${current ? '' : 'disabled'}>${state.timer.running ? '暂停' : '开始专注'}</button>
                <button class="secondary-button" data-action="reset-timer" ${current ? '' : 'disabled'}>重新计时</button>
                <button class="secondary-button finish-music-stop" data-action="stop-finish-music" ${finishMusicPlaying ? '' : 'hidden'}>停止音乐</button>
                <button class="secondary-button" data-action="complete-task" data-task-id="${current?.id || ''}" ${current ? '' : 'disabled'}>完成整条主线</button>
              </div>`}
          ${
            today.length > 1
              ? `<div class="focus-switcher"><span class="field-label">切换任务：</span>${today
                  .map(
                    (task) => `<button class="small-action ${task.id === state.currentTaskId ? 'emphasis' : ''}" data-action="set-current" data-task-id="${task.id}">${escapeHtml(
                      task.text
                    )}</button>`
                  )
                  .join('')}</div>`
              : ''
          }
        </article>
      </section>`;
  }

  function renderCompact() {
    const current = currentTask();
    const currentStep = current?.focusSteps?.find((step) => !step.completed) || null;
    const remaining = effectiveRemaining();
    const compactTaskText = currentStep?.text || current?.text || tr('先从今日检查里选一件');
    compactTask.textContent = compactTaskText;
    compactTask.title = compactTaskText;
    const time = document.getElementById('compactTime');
    const status = document.getElementById('compactTimerStatus');
    const endAt = document.getElementById('compactEndAt');
    const progress = document.getElementById('compactProgressFill');
    const toggle = document.getElementById('compactToggleTimer');
    const stopMusic = document.getElementById('compactStopMusic');
    const complete = document.getElementById('compactComplete');
    if (time) time.textContent = formatTime(remaining);
    if (status) status.textContent = tr(state.timer.running ? '专注中' : state.timer.finished ? '本轮完成' : remaining < state.timer.durationSeconds ? '已暂停' : '准备开始');
    if (endAt) endAt.textContent = timerEndLabel(remaining);
    if (progress) progress.style.width = `${remainingPercent(remaining)}%`;
    if (toggle) {
      toggle.textContent = tr(state.timer.running ? '暂停' : state.timer.finished ? '重来' : '开始');
      toggle.disabled = !current;
    }
    if (stopMusic) stopMusic.hidden = !finishMusicPlaying;
    if (complete) {
      complete.disabled = !current;
      complete.dataset.taskId = current?.id || '';
    }
  }

  function renderAll() {
    fullApp.classList.toggle('hidden', state.compact);
    compactApp.classList.toggle('hidden', !state.compact);
    renderChrome();
    if (state.compact) {
      renderCompact();
      applyUiLanguage();
      return;
    }
    if (state.view === 'paper') content.innerHTML = renderPaperPage();
    else if (state.view === 'priority') content.innerHTML = renderPriorityPage();
    else if (state.view === 'check') content.innerHTML = renderCheckPage();
    else if (state.view === 'focus') content.innerHTML = renderFocusPage();
    else content.innerHTML = renderOrganizePage();
    applyUiLanguage();
    if (state.view === 'paper') requestAnimationFrame(() => {
      setupCanvas();
      setupPaperObjects();
    });
  }

  function updateTimerDisplays() {
    const remaining = effectiveRemaining();
    const fullTime = document.getElementById('focusTime');
    const compactTime = document.getElementById('compactTime');
    const fullClock = document.getElementById('focusClock');
    const fullEndAt = document.getElementById('focusEndAt');
    const compactEndAt = document.getElementById('compactEndAt');
    const compactProgress = document.getElementById('compactProgressFill');
    if (fullTime) fullTime.textContent = formatTime(remaining);
    if (compactTime) compactTime.textContent = formatTime(remaining);
    if (fullClock) fullClock.style.setProperty('--remaining', `${remainingPercent(remaining)}%`);
    if (fullEndAt) fullEndAt.textContent = timerEndLabel(remaining);
    if (compactEndAt) compactEndAt.textContent = timerEndLabel(remaining);
    if (compactProgress) compactProgress.style.width = `${remainingPercent(remaining)}%`;

    if (state.timer.running && remaining === 0 && !timerFinishHandled) {
      timerFinishHandled = true;
      playFinishMusic();
      commit(
        store.touch({
          ...state,
          timer: { ...state.timer, remainingSeconds: 0, running: false, deadline: null, finished: true }
        })
      );
    }
    if (remaining > 0) timerFinishHandled = false;
  }

  function updateFinishMusicControls(visible) {
    document.querySelectorAll('[data-action="stop-finish-music"]').forEach((button) => {
      button.hidden = !visible;
    });
  }

  function stopFinishMusic() {
    if (finishAudio) {
      finishAudio.stop?.();
      finishAudio = null;
    }
    finishMusicPlaying = false;
    updateFinishMusicControls(false);
  }

  function playFinishMusic() {
    stopFinishMusic();
    try {
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      const audio = new AudioContext();
      const oscillators = [];
      [0, 0.22, 0.44].forEach((delay, index) => {
        const oscillator = audio.createOscillator();
        const gain = audio.createGain();
        oscillator.frequency.value = [520, 660, 780][index];
        gain.gain.setValueAtTime(0.0001, audio.currentTime + delay);
        gain.gain.exponentialRampToValueAtTime(window.focusWindow.isSmoke ? 0.001 : 0.12, audio.currentTime + delay + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.0001, audio.currentTime + delay + 0.28);
        oscillator.connect(gain).connect(audio.destination);
        oscillator.start(audio.currentTime + delay);
        oscillator.stop(audio.currentTime + delay + 0.3);
        oscillators.push(oscillator);
      });
      const sound = {
        stop() {
          oscillators.forEach((oscillator) => {
            try { oscillator.stop(); } catch {}
          });
          void audio.close();
        }
      };
      finishAudio = sound;
      finishMusicPlaying = true;
      window.__finishMusicTest = { attempted: true, played: true, source: 'built-in-chime', error: null };
      updateFinishMusicControls(true);
      setTimeout(() => {
        if (finishAudio === sound) stopFinishMusic();
      }, 1000);
    } catch (error) {
      window.__finishMusicTest = { attempted: true, played: false, source: 'built-in-chime', error: error?.message || String(error) };
      // The visual finished state remains available if audio is unavailable.
    }
  }

  function toggleTimer() {
    const current = currentTask();
    if (!current) return showToast('先从今天的三件里选一件');
    const remaining = effectiveRemaining();
    if (state.timer.running) {
      commit(
        store.touch({
          ...state,
          timer: { ...state.timer, remainingSeconds: remaining, running: false, deadline: null }
        })
      );
      return;
    }
    stopFinishMusic();
    const durationSeconds = state.timer.durationSeconds || store.FOCUS_DURATION_SECONDS;
    const startFrom = remaining > 0 ? remaining : durationSeconds;
    timerFinishHandled = false;
    commit(
      store.touch({
        ...state,
        timer: {
          durationSeconds,
          remainingSeconds: startFrom,
          running: true,
          deadline: new Date(Date.now() + startFrom * 1000).toISOString(),
          finished: false
        }
      })
    );
  }

  function resetTimer() {
    if (!currentTask()) return;
    stopFinishMusic();
    const durationSeconds = state.timer.durationSeconds || store.FOCUS_DURATION_SECONDS;
    commit(
      store.touch({
        ...state,
        timer: {
          durationSeconds,
          remainingSeconds: durationSeconds,
          running: false,
          deadline: null,
          finished: false
        }
      })
    );
  }

  function restartFocusRound() {
    if (!currentTask()) return;
    stopFinishMusic();
    const durationSeconds = state.timer.durationSeconds || store.FOCUS_DURATION_SECONDS;
    timerFinishHandled = false;
    commit(
      store.touch({
        ...state,
        timer: {
          durationSeconds,
          remainingSeconds: durationSeconds,
          running: true,
          deadline: new Date(Date.now() + durationSeconds * 1000).toISOString(),
          finished: false
        }
      }),
      { forceSnapshot: true }
    );
  }

  function setFocusMinutes(value) {
    if (state.timer.running) return showToast('先暂停计时，再修改时长');
    const minutes = Math.round(Number(value));
    if (!Number.isFinite(minutes) || minutes < store.MIN_FOCUS_MINUTES || minutes > store.MAX_FOCUS_MINUTES) {
      showToast(`请输入 ${store.MIN_FOCUS_MINUTES} 到 ${store.MAX_FOCUS_MINUTES} 分钟`);
      return document.getElementById('customFocusMinutes')?.focus();
    }
    stopFinishMusic();
    commit(store.setFocusDuration(state, minutes), { forceSnapshot: true });
    showToast(`本轮专注时间已设为 ${minutes} 分钟`);
  }

  async function setCompact(compact) {
    if (state.compact !== compact) commit(store.touch({ ...state, compact }));
    else renderAll();
    await window.focusWindow.setMode(compact ? 'compact' : 'normal');
  }

  function updateLaneField(target) {
    const paperId = target.dataset.paperId;
    const laneId = target.dataset.laneId;
    const field = target.dataset.field;
    const allowed = ['title', 'company', 'notes', 'nextAction'];
    const actual = field === 'lane-title' ? 'title' : field;
    if (!allowed.includes(actual)) return;
    commit(store.updateLane(state, paperId, laneId, { [actual]: target.value }), { render: false });
  }

  function pinTask(button) {
    const paper = state.papers.find((candidate) => candidate.id === button.dataset.paperId);
    const lane = paper?.lanes.find((candidate) => candidate.id === button.dataset.laneId);
    if (!paper || !lane) return;
    const text = lane.nextAction.trim();
    if (!text) {
      showToast('先写下一个具体的“下一小步”');
      document.querySelector(`[data-field="nextAction"][data-lane-id="${lane.id}"]`)?.focus();
      return;
    }
    try {
      let next = store.addTask(state, { text, day: button.dataset.day, paperId: paper.id, laneId: lane.id });
      next = store.updateLane(next, paper.id, lane.id, { nextAction: '' });
      commit(next, { forceSnapshot: true });
      showToast(button.dataset.day === 'today' ? '已钉到今天' : '已放到本周');
    } catch (error) {
      if (error.message === 'TODAY_LIMIT_REACHED') showToast('今天已经有三件了。先完成一件，或放到本周。');
      else throw error;
    }
  }

  function pinPaperNote(button) {
    const paper = state.papers.find((candidate) => candidate.id === button.dataset.paperId);
    const note = paper?.freeNotes.find((candidate) => candidate.id === button.dataset.noteId);
    const text = note?.text.trim();
    if (!paper || !note || !text) return showToast('先在纸片里写下一件具体的事');
    try {
      commit(store.addTask(state, { text, day: button.dataset.day, paperId: paper.id }), { forceSnapshot: true });
      showToast(button.dataset.day === 'today' ? '纸片已钉到今天' : '纸片已放到本周');
    } catch (error) {
      if (error.message === 'TODAY_LIMIT_REACHED') showToast('今天已经有三件了。先完成一件，或放到本周。');
      else throw error;
    }
  }

  function addPaperNoteAt(canvas, event) {
    const paper = store.selectedPaper(state);
    if (!paper) return;
    const rect = canvas.getBoundingClientRect();
    const x = ((event.clientX - rect.left) / rect.width) * 100;
    const y = ((event.clientY - rect.top) / rect.height) * 100;
    const beforeIds = new Set(paper.freeNotes.map((note) => note.id));
    const next = store.addPaperNote(state, paper.id, { x, y, width: 24, color: 'cream' });
    const added = store.selectedPaper(next)?.freeNotes.find((note) => !beforeIds.has(note.id));
    drawingTool = 'pen';
    suppressPaperDoubleClickUntil = Date.now() + 500;
    commit(next, { forceSnapshot: true });
    requestAnimationFrame(() => {
      const noteInput = added ? document.querySelector(`[data-field="paper-note-text"][data-note-id="${added.id}"]`) : null;
      noteInput?.focus();
    });
  }

  function quickAdd(day, horizon) {
    const input = day === 'inbox'
      ? document.getElementById('organizeTaskInput') || document.getElementById('quickTaskInput')
      : document.getElementById('quickTaskInput') || document.getElementById('organizeTaskInput');
    const text = input?.value.trim();
    if (!text) return input?.focus();
    try {
      commit(store.addTask(state, { text, day, horizon }), { forceSnapshot: true });
      showToast(day === 'today' ? '已放到今天' : day === 'tomorrow' ? '已放到本周' : '已加入待安排');
    } catch (error) {
      if (error.message === 'TODAY_LIMIT_REACHED') showToast('今天已经有三件了。先完成一件，或放到本周。');
      else throw error;
    }
  }

  function openTaskEditor(taskId) {
    const task = state.tasks.find((candidate) => candidate.id === taskId);
    if (!task) return;
    const modal = document.createElement('div');
    modal.className = 'modal-backdrop';
    modal.innerHTML = `<section class="modal-card" role="dialog" aria-modal="true" aria-labelledby="editTaskTitle">
      <span class="eyebrow">修改待办</span>
      <h2 id="editTaskTitle">把事情写清楚一点</h2>
      <label class="field-label" for="taskEditText">事情</label>
      <input id="taskEditText" class="modal-input" maxlength="500" value="${escapeHtml(task.text)}" />
      <label class="field-label" for="taskEditNote">备注</label>
      <textarea id="taskEditNote" maxlength="1200" placeholder="补充背景、标准或想法…">${escapeHtml(task.note || '')}</textarea>
      <label class="field-label" for="taskEditImportance">重要度</label>
      <select id="taskEditImportance" class="modal-select">
        ${[5, 4, 3, 2, 1].map((level) => `<option value="${level}" ${task.importance === level ? 'selected' : ''}>${level} / 5 · ${importanceLabel(level)}</option>`).join('')}
      </select>
      <p class="rank-insert-hint">重要度改变后，会自动按高到低归位。</p>
      <div class="modal-actions"><button class="secondary-button" data-action="close-modal">取消</button><button class="primary-button" data-action="confirm-edit-task" data-task-id="${task.id}">保存</button></div>
    </section>`;
    document.body.append(modal);
    applyUiLanguage(modal);
    setTimeout(() => document.getElementById('taskEditText')?.focus(), 0);
  }

  function openNewPaperDialog() {
    document.querySelector('.modal-backdrop')?.remove();
    const modal = document.createElement('div');
    modal.className = 'modal-backdrop';
    modal.innerHTML = `<section class="modal-card compact-modal-card" role="dialog" aria-modal="true" aria-labelledby="newPaperTitle">
      <span class="eyebrow">新建主题电子纸</span>
      <h2 id="newPaperTitle">这张纸要用来想什么？</h2>
      <p>先写一个简单名字，之后随时可以在纸面上修改。</p>
      <label class="field-label" for="newPaperName">主题名字</label>
      <input id="newPaperName" class="modal-input" maxlength="80" value="${state.language === 'en' ? 'New focus' : '新主题'}" autocomplete="off" />
      <div class="modal-actions"><button class="secondary-button" data-action="close-modal">取消</button><button class="primary-button" data-action="confirm-new-paper">创建纸面</button></div>
    </section>`;
    document.body.append(modal);
    applyUiLanguage(modal);
    setTimeout(() => {
      const input = document.getElementById('newPaperName');
      input?.focus();
      input?.select();
    }, 0);
  }

  function openSidebarReminderEditor() {
    document.querySelector('.modal-backdrop')?.remove();
    const reminder = state.reminders[0] || null;
    const modal = document.createElement('div');
    modal.id = 'sidebarReminderModal';
    modal.className = 'modal-backdrop';
    modal.innerHTML = `<section class="modal-card compact-modal-card" role="dialog" aria-modal="true" aria-labelledby="sidebarReminderTitle">
      <span class="eyebrow">提醒自己</span>
      <h2 id="sidebarReminderTitle">留一句现在最需要看到的话</h2>
      <p>它会一直放在页面上方，想换的时候再点一下。</p>
      <label class="field-label" for="sidebarReminderInput">给自己的提醒</label>
      <input id="sidebarReminderInput" class="modal-input" maxlength="500" value="${escapeHtml(reminder?.text || '')}" placeholder="例如：一次只做一件事" autocomplete="off" />
      <div class="modal-actions"><button class="secondary-button" data-action="close-modal">取消</button><button class="primary-button" data-action="confirm-sidebar-reminder">保存提醒</button></div>
    </section>`;
    document.body.append(modal);
    applyUiLanguage(modal);
    setTimeout(() => {
      const input = document.getElementById('sidebarReminderInput');
      input?.focus();
      input?.select();
    }, 0);
  }

  function saveSidebarReminder() {
    const input = document.getElementById('sidebarReminderInput');
    const text = input?.value.trim() || '';
    if (!text) return input?.focus();
    const reminder = state.reminders[0] || null;
    const next = reminder ? store.updateReminder(state, reminder.id, text) : store.addReminder(state, text);
    commit(next, { forceSnapshot: true });
    document.getElementById('sidebarReminderModal')?.remove();
    showToast('页面上方提醒已更新');
  }

  function openQuickCapture() {
    if (state.compact) {
      setCompact(false).then(openQuickCapture);
      return;
    }
    const existing = document.getElementById('quickCaptureModal');
    if (existing) {
      existing.querySelector('#globalCaptureInput')?.focus();
      return;
    }
    const modal = document.createElement('div');
    modal.id = 'quickCaptureModal';
    modal.className = 'modal-backdrop quick-capture-backdrop';
    modal.innerHTML = `<section class="modal-card quick-capture-card" role="dialog" aria-modal="true" aria-labelledby="quickCaptureTitle">
      <span class="eyebrow">随手记</span>
      <h2 id="quickCaptureTitle">先接住，不用现在决定</h2>
      <input id="globalCaptureInput" class="modal-input" maxlength="500" placeholder="想到什么就写什么" autocomplete="off" />
      <div class="quick-capture-help"><span>自动放入“待安排”</span><kbd>Ctrl + Shift + Space</kbd></div>
      <div class="modal-actions"><button class="secondary-button" data-action="close-modal">取消</button><button class="primary-button" data-action="confirm-quick-capture">记下来</button></div>
    </section>`;
    document.body.append(modal);
    applyUiLanguage(modal);
    setTimeout(() => document.getElementById('globalCaptureInput')?.focus(), 0);
  }

  function saveQuickCapture() {
    const input = document.getElementById('globalCaptureInput');
    const text = input?.value.trim() || '';
    if (!text) return input?.focus();
    commit(store.addTask(state, { text, day: 'inbox', horizon: 'unscheduled' }), { forceSnapshot: true });
    document.getElementById('quickCaptureModal')?.remove();
    showToast('已记下，放在待安排');
  }

  async function exportWorkbook() {
    const button = document.querySelector('[data-action="export-workbook"]');
    if (button) button.disabled = true;
    try {
      const result = await window.focusWindow.openFocusWorkbook(state);
      if (result?.opened) showToast('整理表已经打开');
      else if (result?.path) showToast('整理表已保存到项目文件夹');
      else showToast('整理表没有打开，请稍后再试');
    } catch (error) {
      console.error(error);
      showToast('整理表导出失败，数据本身不受影响');
    } finally {
      if (button?.isConnected) button.disabled = false;
    }
  }

  function openCompletion(taskId) {
    const task = state.tasks.find((candidate) => candidate.id === taskId && candidate.status === 'active');
    if (!task) return;
    if (state.compact) {
      setCompact(false).then(() => openCompletion(taskId));
      return;
    }
    const modal = document.createElement('div');
    modal.className = 'modal-backdrop';
    modal.innerHTML = `<section class="modal-card" role="dialog" aria-modal="true" aria-labelledby="completeTitle">
      <span class="eyebrow">留下完成痕迹</span>
      <h2 id="completeTitle">${escapeHtml(task.text)}</h2>
      <p>简单写一句结果。它会回到原来的主题纸，也会留在完成记录里。</p>
      <textarea id="completionNote" maxlength="1200" placeholder="例如：整理完资料，并标出了下一步。"></textarea>
      <div class="modal-actions"><button class="secondary-button" data-action="close-modal">还没完成</button><button class="primary-button" data-action="confirm-complete" data-task-id="${task.id}">确认完成</button></div>
    </section>`;
    document.body.append(modal);
    applyUiLanguage(modal);
    setTimeout(() => document.getElementById('completionNote')?.focus(), 0);
  }

  function openTrash() {
    const modal = document.createElement('div');
    modal.className = 'modal-backdrop';
    modal.innerHTML = `<section class="modal-card" role="dialog" aria-modal="true">
      <div class="modal-title-row"><div><span class="eyebrow">可恢复</span><h2>回收站</h2></div><button class="secondary-button" data-action="close-modal">关闭</button></div>
      <p>删除的主题纸和任务都先放在这里，不会立刻消失。</p>
      <div class="trash-list">${
        state.trash.length
          ? state.trash
              .map(
                (entry) => `<div class="trash-row"><div><strong>${escapeHtml(
                  entry.kind === 'paper' ? entry.record.title : entry.record.text
                )}</strong><small>${entry.kind === 'paper' ? '主题纸' : entry.kind === 'reminder' ? '提醒句' : '任务'} · ${formatDate(entry.deletedAt)}</small></div><button class="secondary-button" data-action="restore-trash" data-trash-id="${entry.id}">恢复</button></div>`
              )
              .join('')
          : '<div class="empty-state">回收站是空的。</div>'
      }</div>
    </section>`;
    document.body.append(modal);
    applyUiLanguage(modal);
  }

  function closeModal(target) {
    target.closest('.modal-backdrop')?.remove();
  }

  function pushUndo(paperId, strokes) {
    const stack = undoStacks.get(paperId) || [];
    stack.push(clone(strokes));
    if (stack.length > 20) stack.shift();
    undoStacks.set(paperId, stack);
  }

  function pointToSegmentDistance(point, start, end) {
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    if (dx === 0 && dy === 0) return Math.hypot(point.x - start.x, point.y - start.y);
    const t = Math.max(0, Math.min(1, ((point.x - start.x) * dx + (point.y - start.y) * dy) / (dx * dx + dy * dy)));
    return Math.hypot(point.x - (start.x + t * dx), point.y - (start.y + t * dy));
  }

  function strokeTouches(stroke, point, thresholdX, thresholdY) {
    const normalized = { x: point.x / thresholdX, y: point.y / thresholdY };
    const transformed = stroke.points.map((candidate) => ({ x: candidate.x / thresholdX, y: candidate.y / thresholdY }));
    if (transformed.length === 1) return Math.hypot(normalized.x - transformed[0].x, normalized.y - transformed[0].y) <= 1;
    for (let index = 1; index < transformed.length; index += 1) {
      if (pointToSegmentDistance(normalized, transformed[index - 1], transformed[index]) <= 1) return true;
    }
    return false;
  }

  function drawStrokes(canvas, strokes, preview = null) {
    const rect = canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    const width = Math.max(1, Math.round(rect.width * dpr));
    const height = Math.max(1, Math.round(rect.height * dpr));
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }
    const context = canvas.getContext('2d');
    context.setTransform(dpr, 0, 0, dpr, 0, 0);
    context.clearRect(0, 0, rect.width, rect.height);
    [...strokes, ...(preview ? [preview] : [])].forEach((stroke) => {
      const points = stroke.points;
      if (!points.length) return;
      context.save();
      context.beginPath();
      const storedColor = stroke.color || 'auto';
      const oldDefaultColor = ['#264653', '#203640'].includes(storedColor.toLowerCase?.());
      const highlighter = stroke.kind === 'highlighter';
      context.strokeStyle = highlighter && storedColor === 'auto'
        ? '#e0b74f'
        : storedColor === 'auto' || (state.theme === 'dark' && oldDefaultColor)
          ? state.theme === 'dark' ? '#f2f4ef' : '#264653'
          : storedColor;
      context.globalAlpha = highlighter ? 0.34 : 1;
      context.lineWidth = stroke.width || 2.4;
      context.lineCap = 'round';
      context.lineJoin = 'round';
      context.moveTo(points[0].x * rect.width, points[0].y * rect.height);
      if (points.length === 1) context.lineTo(points[0].x * rect.width + 0.01, points[0].y * rect.height + 0.01);
      else points.slice(1).forEach((point) => context.lineTo(point.x * rect.width, point.y * rect.height));
      context.stroke();
      context.restore();
    });
  }

  function setupCanvas() {
    const canvas = document.getElementById('sketchCanvas');
    const paper = store.selectedPaper(state);
    if (!canvas || !paper) return;
    drawStrokes(canvas, paper.strokes);

    const normalizedPoint = (event) => {
      const rect = canvas.getBoundingClientRect();
      return {
        x: Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width)),
        y: Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height))
      };
    };

    canvas.onpointerdown = (event) => {
      if (event.button !== 0) return;
      try {
        canvas.setPointerCapture?.(event.pointerId);
      } catch {
        // Synthetic checks do not own a system pointer; real pointer input does.
      }
      const latestPaper = store.selectedPaper(state);
      if (!latestPaper) return;
      const point = normalizedPoint(event);
      drawingSession = {
        pointerId: event.pointerId,
        paperId: latestPaper.id,
        changed: false,
        originalStrokes: clone(latestPaper.strokes),
        baseStrokes: clone(latestPaper.strokes),
        stroke: ['pen', 'highlighter'].includes(drawingTool)
          ? {
              id: store.createId('stroke'),
              kind: drawingTool,
              color: drawingColor,
              width: drawingTool === 'highlighter' ? Math.max(12, drawingWidth * 2.2) : drawingWidth,
              points: [point]
            }
          : null
      };
      if (drawingTool === 'eraser') eraseAt(canvas, point);
      else if (drawingSession.stroke) drawStrokes(canvas, drawingSession.baseStrokes, drawingSession.stroke);
    };

    canvas.onpointermove = (event) => {
      if (!drawingSession || event.pointerId !== drawingSession.pointerId) return;
      const point = normalizedPoint(event);
      if (drawingTool === 'eraser') eraseAt(canvas, point);
      else if (drawingSession.stroke) {
        const previous = drawingSession.stroke.points.at(-1);
        if (Math.hypot(point.x - previous.x, point.y - previous.y) > 0.0015) {
          drawingSession.stroke.points.push(point);
          drawingSession.changed = true;
          drawStrokes(canvas, drawingSession.baseStrokes, drawingSession.stroke);
        }
      }
    };

    const finish = (event) => {
      if (!drawingSession || event.pointerId !== drawingSession.pointerId) return;
      const session = drawingSession;
      drawingSession = null;
      if (['pen', 'highlighter'].includes(drawingTool) && session.stroke) {
        if (session.changed) {
          pushUndo(session.paperId, session.baseStrokes);
          const latest = state.papers.find((candidate) => candidate.id === session.paperId);
          if (latest) commit(store.updatePaper(state, session.paperId, { strokes: [...session.baseStrokes, session.stroke] }), { render: false });
        } else {
          drawStrokes(canvas, session.baseStrokes);
        }
      } else if (session.changed) {
        pushUndo(session.paperId, session.originalStrokes);
        const latest = state.papers.find((candidate) => candidate.id === session.paperId);
        if (latest) commit(store.updatePaper(state, session.paperId, { strokes: session.baseStrokes }), { render: false });
      }
    };
    canvas.onpointerup = finish;
    canvas.onpointercancel = finish;
    canvas.ondblclick = (event) => {
      if (Date.now() >= suppressPaperDoubleClickUntil) addPaperNoteAt(canvas, event);
    };
  }

  function setupPaperObjects() {
    const stage = document.getElementById('paperCanvasStage');
    if (!stage) return;

    document.querySelectorAll('.paper-note-text').forEach((textarea) => {
      textarea.style.height = '0px';
      textarea.style.height = `${Math.max(54, textarea.scrollHeight)}px`;
    });

    document.querySelectorAll('.paper-text-block .paper-textarea').forEach((textarea) => {
      textarea.style.height = '0px';
      textarea.style.height = `${Math.max(44, textarea.scrollHeight)}px`;
    });

    document.querySelectorAll('[data-paper-drag-handle]').forEach((handle) => {
      handle.onpointerdown = (event) => {
        if (event.button !== 0 || event.target.closest('button, input, textarea') || window.innerWidth <= 980) return;
        const object = handle.closest('[data-canvas-lane], [data-paper-note]');
        if (!object) return;
        event.preventDefault();
        const stageRect = stage.getBoundingClientRect();
        const objectRect = object.getBoundingClientRect();
        paperMoveSession = {
          pointerId: event.pointerId,
          handle,
          object,
          kind: object.matches('[data-canvas-lane]') ? 'lane' : 'note',
          paperId: object.dataset.paperId,
          objectId: object.dataset.laneId || object.dataset.noteId,
          stageRect,
          objectRect,
          startX: event.clientX,
          startY: event.clientY,
          left: objectRect.left - stageRect.left,
          top: objectRect.top - stageRect.top
        };
        object.classList.add('moving');
        try {
          handle.setPointerCapture?.(event.pointerId);
        } catch {
          // Synthetic checks do not own a system pointer; real pointer input does.
        }
      };

      handle.onpointermove = (event) => {
        const session = paperMoveSession;
        if (!session || session.handle !== handle || session.pointerId !== event.pointerId) return;
        const nextLeft = Math.max(8, Math.min(session.stageRect.width - session.objectRect.width - 8, session.left + event.clientX - session.startX));
        const nextTop = Math.max(62, Math.min(session.stageRect.height - session.objectRect.height - 8, session.top + event.clientY - session.startY));
        session.object.style.left = `${nextLeft}px`;
        session.object.style.top = `${nextTop}px`;
        session.currentLeft = nextLeft;
        session.currentTop = nextTop;
      };

      const finishMove = (event) => {
        const session = paperMoveSession;
        if (!session || session.handle !== handle || session.pointerId !== event.pointerId) return;
        paperMoveSession = null;
        session.object.classList.remove('moving');
        const left = session.currentLeft ?? session.left;
        const top = session.currentTop ?? session.top;
        const x = (left / session.stageRect.width) * 100;
        const y = (top / session.stageRect.height) * 100;
        const next = session.kind === 'lane'
          ? store.updateLane(state, session.paperId, session.objectId, { position: { x, y } })
          : store.updatePaperNote(state, session.paperId, session.objectId, { x, y });
        commit(next, { render: false, forceSnapshot: true });
        showToast(session.kind === 'lane' ? '文字位置已保存' : '纸片位置已保存');
      };
      handle.onpointerup = finishMove;
      handle.onpointercancel = finishMove;
    });
  }

  function eraseAt(canvas, point) {
    if (!drawingSession) return;
    const rect = canvas.getBoundingClientRect();
    const thresholdX = 14 / rect.width;
    const thresholdY = 14 / rect.height;
    const remaining = drawingSession.baseStrokes.filter(
      (stroke) => !strokeTouches(stroke, point, thresholdX, thresholdY)
    );
    if (remaining.length !== drawingSession.baseStrokes.length) {
      drawingSession.baseStrokes = remaining;
      drawingSession.changed = true;
      drawStrokes(canvas, remaining);
    }
  }

  function handleClick(event) {
    const button = event.target.closest('button');
    if (!button || button.disabled) return;
    const action = button.dataset.action;

    if (action === 'open-quick-capture') {
      openQuickCapture();
      return;
    }
    if (action === 'confirm-quick-capture') {
      saveQuickCapture();
      return;
    }

    if (button.id === 'compactButton') return void setCompact(true);
    if (button.id === 'expandButton') return void setCompact(false);
    if (button.id === 'minimizeButton' || button.id === 'compactMinimizeButton') return void window.focusWindow.minimize();
    if (button.id === 'closeButton' || button.id === 'compactCloseButton') return void window.focusWindow.close();
    if (button.id === 'languageButton') {
      commit(store.touch({ ...state, language: state.language === 'en' ? 'zh-CN' : 'en' }), { forceSnapshot: true });
      return;
    }
    if (button.id === 'themeButton') {
      commit(store.touch({ ...state, theme: state.theme === 'dark' ? 'light' : 'dark' }));
      return;
    }
    if (button.id === 'newPaperButton') {
      openNewPaperDialog();
      return;
    }
    if (button.id === 'trashButton') return openTrash();
    if (button.id === 'reminderButton' || action === 'edit-sidebar-reminder') {
      openSidebarReminderEditor();
      return;
    }
    if (action === 'open-organize') {
      commit(store.touch({ ...state, view: 'organize' }));
      content.scrollTop = 0;
      return;
    }

    if (button.classList.contains('nav-button')) {
      commit(store.touch({ ...state, view: button.dataset.view }));
      content.scrollTop = 0;
      return;
    }
    if (action === 'select-paper' || action === 'open-paper') {
      commit(store.touch({ ...state, selectedPaperId: button.dataset.paperId, view: 'paper' }));
      content.scrollTop = 0;
    } else if (action === 'delete-paper') {
      if (!confirmUi('把这张主题纸移到回收站？之后可以恢复。')) return;
      try {
        commit(store.deletePaper(state, button.dataset.paperId), { forceSnapshot: true });
      } catch (error) {
        if (error.message === 'LAST_PAPER') showToast('至少保留一张主题纸');
      }
    } else if (action === 'paper-style') {
      const paper = store.selectedPaper(state);
      if (paper) commit(store.updatePaper(state, paper.id, { style: button.dataset.style }));
    } else if (action === 'drawing-tool') {
      if (!['pen', 'highlighter', 'eraser'].includes(button.dataset.tool)) return;
      drawingTool = button.dataset.tool;
      renderAll();
    } else if (action === 'ink-color') {
      drawingColor = button.dataset.color;
      if (!['pen', 'highlighter'].includes(drawingTool)) drawingTool = 'pen';
      renderAll();
    } else if (action === 'ink-width') {
      drawingWidth = Number(button.dataset.width) || 2.8;
      if (!['pen', 'highlighter'].includes(drawingTool)) drawingTool = 'pen';
      renderAll();
    } else if (action === 'undo-stroke') {
      const paper = store.selectedPaper(state);
      const stack = paper ? undoStacks.get(paper.id) : null;
      if (paper && stack?.length) commit(store.updatePaper(state, paper.id, { strokes: stack.pop() }));
      else showToast('现在没有可撤销的笔迹');
    } else if (action === 'clear-strokes') {
      const paper = store.selectedPaper(state);
      if (!paper?.strokes.length) return showToast('画板现在是空的');
      if (!confirmUi('清空这张画板上的笔迹？清空后仍可以点一次撤销。')) return;
      pushUndo(paper.id, paper.strokes);
      commit(store.updatePaper(state, paper.id, { strokes: [] }), { forceSnapshot: true });
      showToast('画板已清空，点撤销可以找回');
    } else if (action === 'pin-task') {
      pinTask(button);
    } else if (action === 'pin-paper-note') {
      pinPaperNote(button);
    } else if (action === 'cycle-paper-note-color') {
      const paper = state.papers.find((candidate) => candidate.id === button.dataset.paperId);
      const note = paper?.freeNotes.find((candidate) => candidate.id === button.dataset.noteId);
      if (!paper || !note) return;
      const colors = ['cream', 'blue', 'green', 'rose'];
      const nextColor = colors[(colors.indexOf(note.color) + 1) % colors.length];
      commit(store.updatePaperNote(state, paper.id, note.id, { color: nextColor }), { forceSnapshot: true });
      requestAnimationFrame(() => {
        const noteElement = document.querySelector(`[data-paper-note][data-note-id="${note.id}"]`);
        if (noteElement) handlePaperObjectSelection({ target: noteElement });
      });
    } else if (action === 'delete-paper-note') {
      if (!confirmUi('删除这张文字纸片？')) return;
      commit(store.deletePaperNote(state, button.dataset.paperId, button.dataset.noteId), { forceSnapshot: true });
    } else if (action === 'quick-add') {
      if (button.dataset.horizon) activeHorizon = button.dataset.horizon;
      quickAdd(button.dataset.day, button.dataset.horizon);
    } else if (action === 'set-horizon-view') {
      if (!HORIZON_OPTIONS.some((option) => option.id === button.dataset.horizon)) return;
      activeHorizon = button.dataset.horizon;
      const shouldScroll = button.dataset.scrollHorizon === 'true';
      renderAll();
      if (shouldScroll) requestAnimationFrame(() => document.getElementById('timeHorizonPanel')?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
    } else if (action === 'set-task-horizon') {
      if (!HORIZON_OPTIONS.some((option) => option.id === button.dataset.horizon)) return;
      const task = state.tasks.find((candidate) => candidate.id === button.dataset.taskId);
      if (!task) return;
      commit(store.setTaskHorizon(state, task.id, button.dataset.horizon), { forceSnapshot: true });
      showToast(`已放到${horizonOption(button.dataset.horizon).label}`);
    } else if (action === 'focus-task') {
      stopFinishMusic();
      const next = store.setCurrentTask(state, button.dataset.taskId);
      commit(store.touch({ ...next, view: 'focus' }));
      content.scrollTop = 0;
    } else if (action === 'set-current') {
      stopFinishMusic();
      commit(store.setCurrentTask(state, button.dataset.taskId));
      showToast('已设为专注任务');
    } else if (action === 'add-focus-step') {
      const task = currentTask();
      const input = document.getElementById('focusStepInput');
      const text = input?.value.trim() || '';
      if (!task || !text) return input?.focus();
      try {
        commit(store.addFocusStep(state, task.id, text), { forceSnapshot: true });
        showToast('支线已记下，继续当前主线');
      } catch (error) {
        if (error.message === 'FOCUS_STEP_LIMIT_REACHED') showToast('本轮最多放三步，先完成或删除一步');
        else throw error;
      }
    } else if (action === 'toggle-focus-step') {
      commit(store.toggleFocusStep(state, button.dataset.taskId, button.dataset.stepId), { forceSnapshot: true });
    } else if (action === 'delete-focus-step') {
      if (!confirmUi('删除这条本轮步骤？')) return;
      commit(store.deleteFocusStep(state, button.dataset.taskId, button.dataset.stepId), { forceSnapshot: true });
    } else if (action === 'complete-current-focus-step') {
      const task = currentTask();
      if (!task?.focusSteps?.some((step) => !step.completed)) return showToast('还没有需要完成的本轮步骤');
      stopFinishMusic();
      const next = store.completeNextFocusStep(state, task.id);
      commit(store.setFocusDuration(next, focusDurationMinutes()), { forceSnapshot: true });
      showToast('本轮步骤已完成');
    } else if (action === 'restart-focus-round') {
      restartFocusRound();
    } else if (action === 'move-task') {
      try {
        commit(store.moveTask(state, button.dataset.taskId, button.dataset.day), { forceSnapshot: true });
      } catch (error) {
        if (error.message === 'TODAY_LIMIT_REACHED') showToast('今天已经有三件了');
      }
    } else if (action === 'move-task-order') {
      const active = store.activeTasks(state);
      const index = active.findIndex((task) => task.id === button.dataset.taskId);
      const target = index + (button.dataset.direction === 'up' ? -1 : 1);
      commit(store.moveTaskOrder(state, button.dataset.taskId, target), { forceSnapshot: true });
    } else if (action === 'set-task-importance') {
      const task = state.tasks.find((candidate) => candidate.id === button.dataset.taskId);
      if (!task) return;
      const importance = Math.max(1, Math.min(5, Number(button.dataset.importance || 3)));
      commit(store.updateTask(state, task.id, { importance }), { forceSnapshot: true });
      showToast(`重要度已设为 ${importance}/5，排序已经更新`);
    } else if (action === 'edit-task') {
      openTaskEditor(button.dataset.taskId);
    } else if (action === 'confirm-edit-task') {
      const text = document.getElementById('taskEditText')?.value || '';
      const note = document.getElementById('taskEditNote')?.value || '';
      const importance = Number(document.getElementById('taskEditImportance')?.value || 3);
      if (!text.trim()) return document.getElementById('taskEditText')?.focus();
      closeModal(button);
      commit(store.updateTask(state, button.dataset.taskId, { text, note, importance }), { forceSnapshot: true });
      showToast('修改已经保存');
    } else if (action === 'confirm-new-paper') {
      const input = document.getElementById('newPaperName');
      const title = input?.value.trim() || '';
      if (!title) {
        showToast('先给这张纸写一个名字');
        return input?.focus();
      }
      closeModal(button);
      commit(store.addPaper(state, title), { forceSnapshot: true });
      content.scrollTop = 0;
      showToast('新主题纸已经建好');
    } else if (action === 'confirm-sidebar-reminder') {
      saveSidebarReminder();
    } else if (action === 'delete-task') {
      if (confirmUi('把这件事移到回收站？之后可以恢复。')) commit(store.deleteTask(state, button.dataset.taskId), { forceSnapshot: true });
    } else if (action === 'complete-task') {
      stopFinishMusic();
      openCompletion(button.dataset.taskId);
    } else if (action === 'confirm-complete') {
      const note = document.getElementById('completionNote')?.value || '';
      closeModal(button);
      commit(store.completeTask(state, button.dataset.taskId, note), { forceSnapshot: true });
      showToast('完成痕迹已经收好');
    } else if (action === 'close-modal') {
      closeModal(button);
    } else if (action === 'restore-trash') {
      commit(store.restoreTrash(state, button.dataset.trashId), { forceSnapshot: true });
      button.closest('.modal-backdrop')?.remove();
      openTrash();
      showToast('已经恢复');
    } else if (action === 'restore-completed') {
      commit(store.restoreCompletedTask(state, button.dataset.taskId), { forceSnapshot: true });
      showToast('已恢复到待安排');
    } else if (action === 'add-reminder') {
      const input = document.getElementById('reminderInput');
      if (!input?.value.trim()) return input?.focus();
      commit(store.addReminder(state, input.value), { forceSnapshot: true });
      showToast('提醒句已经收好');
    } else if (action === 'edit-reminder') {
      const reminder = state.reminders.find((entry) => entry.id === button.dataset.reminderId);
      if (!reminder) return;
      const text = promptUi('修改提醒句', reminder.text);
      if (text?.trim()) commit(store.updateReminder(state, reminder.id, text), { forceSnapshot: true });
    } else if (action === 'delete-reminder') {
      if (!confirmUi('把这条提醒放进回收站？')) return;
      commit(store.deleteReminder(state, button.dataset.reminderId), { forceSnapshot: true });
    } else if (action === 'export-workbook') {
      void exportWorkbook();
    } else if (action === 'open-focus') {
      commit(store.touch({ ...state, view: 'focus' }));
      content.scrollTop = 0;
    } else if (action === 'set-focus-minutes') {
      setFocusMinutes(button.dataset.minutes);
    } else if (action === 'apply-custom-focus-time') {
      setFocusMinutes(document.getElementById('customFocusMinutes')?.value);
    } else if (action === 'toggle-timer' || button.id === 'compactToggleTimer') {
      toggleTimer();
    } else if (action === 'reset-timer') {
      resetTimer();
    } else if (action === 'stop-finish-music') {
      stopFinishMusic();
      showToast('音乐已停止');
    }
  }

  function handleInput(event) {
    const target = event.target;
    if (target.dataset.field === 'paper-title') {
      commit(store.updatePaper(state, target.dataset.paperId, { title: target.value }), { render: false });
    } else if (target.dataset.field === 'paper-note-text') {
      commit(store.updatePaperNote(state, target.dataset.paperId, target.dataset.noteId, { text: target.value }), { render: false });
      target.style.height = '0px';
      target.style.height = `${Math.max(54, target.scrollHeight)}px`;
      target.closest('[data-paper-note]')?.querySelectorAll('[data-action="pin-paper-note"]').forEach((noteButton) => {
        noteButton.disabled = !target.value.trim();
      });
    } else if (target.dataset.laneId) {
      updateLaneField(target);
      if (target.matches('.paper-text-block .paper-textarea')) {
        target.style.height = '0px';
        target.style.height = `${Math.max(44, target.scrollHeight)}px`;
      }
    }
  }

  function handlePaperObjectSelection(event) {
    const selected = event.target.closest?.('.paper-text-block[data-canvas-lane], .paper-free-note[data-paper-note]') || null;
    document.querySelectorAll('.paper-text-block.selected, .paper-free-note.selected').forEach((block) => {
      block.classList.toggle('selected', block === selected);
    });
    selected?.classList.add('selected');
  }

  function handleKeydown(event) {
    if (event.ctrlKey && event.shiftKey && event.code === 'Space') {
      event.preventDefault();
      openQuickCapture();
      return;
    }
    if (event.key === 'Enter' && event.target.id === 'globalCaptureInput') {
      event.preventDefault();
      saveQuickCapture();
      return;
    }
    if (event.key === 'Enter' && event.target.id === 'newPaperName') {
      event.preventDefault();
      document.querySelector('[data-action="confirm-new-paper"]')?.click();
      return;
    }
    if (event.key === 'Enter' && event.target.id === 'sidebarReminderInput') {
      event.preventDefault();
      saveSidebarReminder();
      return;
    }
    if (event.key === 'Enter' && ['quickTaskInput', 'organizeTaskInput'].includes(event.target.id)) {
      event.preventDefault();
      quickAdd(event.target.id === 'organizeTaskInput' ? 'inbox' : event.shiftKey ? 'tomorrow' : 'today', event.shiftKey ? 'week' : undefined);
    }
    if (event.key === 'Enter' && event.target.id === 'customFocusMinutes') {
      event.preventDefault();
      document.querySelector('[data-action="apply-custom-focus-time"]')?.click();
    }
    if (event.key === 'Enter' && event.target.id === 'focusStepInput') {
      event.preventDefault();
      document.querySelector('[data-action="add-focus-step"]')?.click();
    }
    if (event.key === 'Enter' && event.target.id === 'reminderInput') {
      event.preventDefault();
      const value = event.target.value.trim();
      if (value) commit(store.addReminder(state, value), { forceSnapshot: true });
    }
    if (event.key === 'Escape') document.querySelector('.modal-backdrop')?.remove();
  }

  function clearPriorityDragState() {
    document.querySelectorAll('.task-priority-card.dragging, .task-priority-card.drop-target').forEach((card) => {
      card.classList.remove('dragging', 'drop-target');
    });
  }

  function handleDragStart(event) {
    if (event.target.closest('button')) return;
    const taskCard = event.target.closest('[data-task-priority-card]');
    if (!taskCard) return;
    draggedTaskId = taskCard.dataset.taskId || null;
    taskCard.classList.add('dragging');
    if (event.dataTransfer) {
      event.dataTransfer.effectAllowed = 'move';
      event.dataTransfer.setData('text/plain', draggedTaskId);
    }
  }

  function handleDragOver(event) {
    const card = draggedTaskId ? event.target.closest('[data-task-priority-card]') : null;
    if (!card || card.dataset.taskId === draggedTaskId) return;
    event.preventDefault();
    document.querySelectorAll('.task-priority-card.drop-target').forEach((entry) => entry.classList.remove('drop-target'));
    card.classList.add('drop-target');
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
  }

  function handleDrop(event) {
    const taskCard = draggedTaskId ? event.target.closest('[data-task-priority-card]') : null;
    if (!taskCard) return;
    event.preventDefault();
    const sourceTaskId = draggedTaskId;
    const targetTaskId = taskCard.dataset.taskId;
    draggedTaskId = null;
    clearPriorityDragState();
    if (!sourceTaskId || sourceTaskId === targetTaskId) return;
    const sourceTask = state.tasks.find((task) => task.id === sourceTaskId && task.status === 'active');
    const targetTask = state.tasks.find((task) => task.id === targetTaskId && task.status === 'active');
    if (!sourceTask || !targetTask) return;
    if (sourceTask.importance !== targetTask.importance) {
      showToast('不同重要度不用拖，直接点右边的数字调整');
      return;
    }
    let next = state;
    const targetIndex = store.activeTasks(next).findIndex((task) => task.id === targetTaskId);
    next = store.moveTaskOrder(next, sourceTaskId, targetIndex);
    commit(next, { forceSnapshot: true });
    showToast('同重要度顺序已调整');
  }

  function chineseUiFragments(root = document.body) {
    const fragments = [];
    const text = root.innerText || root.textContent || '';
    const textMatches = text.match(/[^\n]{0,28}[\u3400-\u9fff][^\n]{0,28}/gu) || [];
    fragments.push(...textMatches.map((entry) => entry.trim()).filter(Boolean));
    root.querySelectorAll?.('*').forEach((element) => {
      if (element.closest('.hidden')) return;
      ['title', 'aria-label', 'placeholder'].forEach((name) => {
        const value = element.getAttribute(name);
        if (value && /[\u3400-\u9fff]/u.test(value)) fragments.push(`${name}: ${value}`);
      });
      if (['INPUT', 'TEXTAREA'].includes(element.tagName) && element.value && /[\u3400-\u9fff]/u.test(element.value)) {
        fragments.push(`value: ${element.value}`);
      }
    });
    return [...new Set(fragments)];
  }

  function createEnglishDemoState() {
    let sample = store.createInitialState('2026-09-07T08:00:00.000Z', 'en');
    sample = store.addTask(sample, { text: 'Outline the first draft', day: 'today', importance: 5 });
    sample = store.addTask(sample, { text: 'Take a ten-minute walk', day: 'today', importance: 3 });
    sample = store.addTask(sample, { text: 'Compare two options', day: 'inbox', horizon: 'month', importance: 2 });
    sample = store.addReminder(sample, 'One thing at a time');
    return store.addFocusStep(sample, sample.currentTaskId, 'Open the source notes');
  }

  function checkEnglishUi() {
    const savedState = clone(state);
    const issues = [];
    let sample = createEnglishDemoState();
    const trashTask = store.activeTasks(sample).find((task) => task.text === 'Compare two options');
    if (trashTask) sample = store.deleteTask(sample, trashTask.id);

    ['check', 'focus', 'paper', 'priority', 'organize'].forEach((view) => {
      state = { ...sample, view, compact: false, language: 'en' };
      renderAll();
      updateTimerDisplays();
      issues.push(...chineseUiFragments().map((fragment) => `${view}: ${fragment}`));
    });

    state = { ...sample, view: 'focus', compact: true, language: 'en' };
    renderAll();
    updateTimerDisplays();
    issues.push(...chineseUiFragments(compactApp).map((fragment) => `compact: ${fragment}`));

    const currentId = store.activeTasks(state)[0]?.id;
    const modalChecks = [
      () => openTaskEditor(currentId),
      () => openNewPaperDialog(),
      () => openSidebarReminderEditor(),
      () => openQuickCapture(),
      () => openCompletion(currentId),
      () => openTrash()
    ];
    modalChecks.forEach((open, index) => {
      document.querySelector('.modal-backdrop')?.remove();
      open();
      const modal = document.querySelector('.modal-backdrop');
      if (modal) issues.push(...chineseUiFragments(modal).map((fragment) => `modal-${index + 1}: ${fragment}`));
    });
    document.querySelector('.modal-backdrop')?.remove();

    state = savedState;
    renderAll();
    return { ok: issues.length === 0, issues: issues.slice(0, 40) };
  }

  function checkEnglishResponsiveUi() {
    const savedState = clone(state);
    const sample = createEnglishDemoState();
    const views = {};
    ['check', 'focus', 'paper', 'priority', 'organize'].forEach((view) => {
      state = { ...sample, view, compact: false, language: 'en' };
      renderAll();
      updateTimerDisplays();
      const brand = document.querySelector('.brand')?.getBoundingClientRect();
      const nav = document.querySelector('.main-nav')?.getBoundingClientRect();
      const actions = document.querySelector('.window-actions')?.getBoundingClientRect();
      const page = content.firstElementChild;
      const contentRect = content.getBoundingClientRect();
      const pageRect = page?.getBoundingClientRect();
      views[view] = {
        headerFits: Boolean(brand && nav && actions && brand.right <= nav.left + 1 && nav.right <= actions.left + 1),
        pageFits: Boolean(pageRect && pageRect.left >= contentRect.left - 1 && pageRect.right <= contentRect.right + 1),
        noHorizontalOverflow: content.scrollWidth <= content.clientWidth + 1 && (!page || page.scrollWidth <= page.clientWidth + 1)
      };
      views[view].ok = views[view].headerFits && views[view].pageFits && views[view].noHorizontalOverflow;
    });
    state = savedState;
    renderAll();
    return { width: window.innerWidth, views, ok: Object.values(views).every((view) => view.ok) };
  }

  async function initialize() {
    const [diskResult, localV2, legacy] = await Promise.all([
      window.focusWindow.loadState().catch(() => ({ state: null, recovered: false })),
      Promise.resolve(readLocal(LOCAL_STATE_KEY)),
      Promise.resolve(readLocal(LEGACY_STATE_KEY))
    ]);
    const diskState = diskResult?.state;
    const currentTheme = ['light', 'dark'].includes(diskState?.theme)
      ? diskState.theme
      : ['light', 'dark'].includes(localV2?.theme)
        ? localV2.theme
        : null;
    let candidate = diskState || localV2 || store.createInitialState(undefined, preferredLanguage);
    if (diskState && localV2) {
      const diskIsNewer = timestamp(diskState.modifiedAt) >= timestamp(localV2.modifiedAt);
      candidate = store.mergeCurrentStates(diskIsNewer ? diskState : localV2, diskIsNewer ? localV2 : diskState);
    }
    const beforeLegacy = store.normalizeState(candidate);
    const mergedOldData = Boolean(legacy && !beforeLegacy.legacyMergedAt);
    candidate = store.mergeLegacyState(candidate, legacy);
    const oldTheme = readLocalText(LEGACY_THEME_KEY);
    if (currentTheme) {
      candidate = { ...candidate, theme: currentTheme };
    } else if (oldTheme === 'dark') {
      candidate = { ...candidate, theme: 'dark' };
    }
    state = store.touch({ ...store.normalizeState(candidate), view: 'check' });
    writeLocalImmediately();
    changeVersion = 1;
    renderAll();
    await window.focusWindow.setMode(state.compact ? 'compact' : 'normal');
    scheduleSave(!diskState || mergedOldData);
    if (diskResult?.recovered) setSaveStatus('已从备份恢复');
    else if (mergedOldData) {
      setSaveStatus('旧版数据已合并');
      showToast('旧版待办、提醒和记录已经合并');
    }
    window.__focusPinReady = true;
  }

  window.addEventListener('resize', () => {
    if (!state.compact && state.view === 'paper') requestAnimationFrame(() => {
      setupCanvas();
      setupPaperObjects();
    });
  });
  document.addEventListener('click', handleClick);
  document.addEventListener('input', handleInput);
  document.addEventListener('pointerdown', handlePaperObjectSelection);
  document.addEventListener('focusout', (event) => {
    if (event.target.dataset?.field === 'paper-title' || event.target.dataset?.field === 'lane-title') renderChrome();
  });
  document.addEventListener('keydown', handleKeydown);
  document.addEventListener('focusin', handlePaperObjectSelection);
  document.addEventListener('dragstart', handleDragStart);
  document.addEventListener('dragover', handleDragOver);
  document.addEventListener('drop', handleDrop);
  document.addEventListener('dragend', () => {
    draggedTaskId = null;
    clearPriorityDragState();
  });
  window.focusWindow.onQuickCapture(() => openQuickCapture());
  setInterval(updateTimerDisplays, 250);

  // Built-in end-to-end checks used by the desktop smoke run.
  window.__focusPinTest = {
    getState: () => clone(state),
    checkEnglishUi,
    checkEnglishResponsiveUi,
    showEnglishForCapture(view = 'check') {
      const compact = view === 'compact';
      state = { ...createEnglishDemoState(), view: compact ? 'focus' : view, compact, language: 'en' };
      renderAll();
      updateTimerDisplays();
      content.scrollTop = 0;
      return true;
    },
    async runCoreFlow() {
      let next = store.createInitialState('2026-09-07T08:00:00.000Z');
      const paper = store.selectedPaper(next);
      ['健康', '学习', '生活', '财务', '创作'].forEach((title) => {
        next = store.addPaper(next, title);
      });
      next = store.updateLane(next, paper.id, paper.lanes[0].id, {
        company: '示例目标 A',
        notes: '先收集材料，再决定从哪里开始。',
        nextAction: '整理资料目录'
      });
      next = store.updateLane(next, paper.id, paper.lanes[1].id, {
        company: '示例目标 B',
        notes: '比较两个可行方案。',
        nextAction: '比较两个方案'
      });
      next = store.updateLane(next, paper.id, paper.lanes[2].id, {
        company: '示例目标 C',
        notes: '把目标缩小成可以立刻开始的动作。',
        nextAction: '写下第一步'
      });
      next = store.addTask(next, { text: '整理资料目录', day: 'today', importance: 5, paperId: paper.id, laneId: paper.lanes[0].id });
      next = store.addTask(next, { text: '比较两个方案', day: 'today', importance: 2, paperId: paper.id, laneId: paper.lanes[1].id });
      next = store.addTask(next, { text: '写下第一步', day: 'today', importance: 4, paperId: paper.id, laneId: paper.lanes[2].id });
      let limitProtected = false;
      try {
        store.addTask(next, { text: '不该进入今天的第四件', day: 'today' });
      } catch (error) {
        limitProtected = error.message === 'TODAY_LIMIT_REACHED';
      }
      next = store.addTask(next, { text: '整理作品案例清单', day: 'tomorrow', importance: 1, paperId: paper.id });
      next = store.updatePaper(next, paper.id, {
        strokes: [
          {
            id: store.createId('stroke'),
            color: '#264653',
            width: 2.4,
            points: [
              { x: 0.08, y: 0.55 },
              { x: 0.18, y: 0.28 },
              { x: 0.31, y: 0.6 },
              { x: 0.44, y: 0.33 },
              { x: 0.58, y: 0.57 }
            ]
          }
        ]
      });
      next = store.touch({ ...next, selectedPaperId: paper.id, view: 'paper', compact: false });
      state = store.normalizeState(next);
      changeVersion += 1;
      writeLocalImmediately();
      renderAll();
      await window.focusWindow.setMode('normal');

      // Exercise the real controls, not just the state helpers.
      const paperTextBlocks = [...document.querySelectorAll('.paper-text-block[data-canvas-lane]')];
      const firstTextBlock = paperTextBlocks[0];
      const firstBlockActions = firstTextBlock?.querySelector('.paper-block-actions');
      const restingActionOpacity = firstBlockActions ? Number(getComputedStyle(firstBlockActions).opacity) : -1;
      const actionsHiddenAtRest = restingActionOpacity <= 0.05;
      if (firstTextBlock) handlePaperObjectSelection({ target: firstTextBlock });
      const selectedActionsInteractive = firstBlockActions && getComputedStyle(firstBlockActions).pointerEvents === 'auto';
      const actionsVisibleWhenSelected = firstTextBlock?.classList.contains('selected') && selectedActionsInteractive;
      firstTextBlock?.blur();
      const lightweightPaperBlocksWorked =
        paperTextBlocks.length === 3 &&
        paperTextBlocks.every((block) => !block.classList.contains('lane-card')) &&
        paperTextBlocks.every((block) => block.querySelectorAll('.paper-text-line').length === 3) &&
        actionsHiddenAtRest &&
        actionsVisibleWhenSelected;

      document.getElementById('newPaperButton').click();
      const newPaperInput = document.getElementById('newPaperName');
      const newPaperDialogOpened = Boolean(newPaperInput && document.querySelector('[data-action="confirm-new-paper"]'));
      newPaperInput.value = '测试新主题';
      newPaperInput.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      const newPaperCreated =
        state.papers[state.papers.length - 1]?.title === '测试新主题' &&
        state.view === 'paper' &&
        document.querySelectorAll('.paper-item').length === 7 &&
        !document.getElementById('newPaperName');
      const newPaperControlWorked = newPaperDialogOpened && newPaperCreated;
      state = store.normalizeState(next);
      changeVersion += 1;
      writeLocalImmediately();
      renderAll();

      const fourthInput = document.querySelector(`[data-field="nextAction"][data-lane-id="${paper.lanes[0].id}"]`);
      fourthInput.value = '今天不该出现的第四件';
      fourthInput.dispatchEvent(new Event('input', { bubbles: true }));
      document.querySelector(`[data-action="pin-task"][data-day="today"][data-lane-id="${paper.lanes[0].id}"]`).click();
      const uiLimitProtected = store.activeTasks(state, 'today').length === 3 && document.getElementById('toast')?.textContent.includes('三件');

      document.querySelector('[data-action="paper-style"][data-style="dot"]').click();
      const styleControlWorked = store.selectedPaper(state).style === 'dot';
      document.querySelector('[data-action="paper-style"][data-style="line"]').click();
      const linedPaperWorked = store.selectedPaper(state).style === 'line';
      document.querySelector('[data-action="paper-style"][data-style="grid"]').click();

      const defaultDrawingReady =
        drawingTool === 'pen' &&
        document.querySelector('[data-action="drawing-tool"][data-tool="pen"]')?.classList.contains('active') &&
        !document.querySelector('[data-action="drawing-tool"][data-tool="select"]') &&
        !document.querySelector('[data-action="drawing-tool"][data-tool="text"]');
      setupCanvas();
      const canvas = document.getElementById('sketchCanvas');
      const rect = canvas.getBoundingClientRect();
      const pointer = (type, x, y) =>
        canvas.dispatchEvent(
          new PointerEvent(type, {
            bubbles: true,
            pointerId: 17,
            button: 0,
            clientX: rect.left + rect.width * x,
            clientY: rect.top + rect.height * y
          })
        );
      pointer('pointerdown', 0.7, 0.25);
      pointer('pointermove', 0.78, 0.42);
      pointer('pointermove', 0.86, 0.27);
      pointer('pointerup', 0.86, 0.27);
      const drawingControlWorked = store.selectedPaper(state).strokes.length >= 2;

      document.querySelector('[data-action="drawing-tool"][data-tool="eraser"]').click();
      setupCanvas();
      const eraserCanvas = document.getElementById('sketchCanvas');
      const eraserRect = eraserCanvas.getBoundingClientRect();
      const erasePointer = (type, x, y) =>
        eraserCanvas.dispatchEvent(
          new PointerEvent(type, {
            bubbles: true,
            pointerId: 18,
            button: 0,
            clientX: eraserRect.left + eraserRect.width * x,
            clientY: eraserRect.top + eraserRect.height * y
          })
        );
      erasePointer('pointerdown', 0.7, 0.25);
      erasePointer('pointerup', 0.7, 0.25);
      const erasedStroke = store.selectedPaper(state).strokes.length === 1;
      document.querySelector('[data-action="undo-stroke"]').click();
      const restoredStroke = store.selectedPaper(state).strokes.length === 2;
      document.querySelector('[data-action="drawing-tool"][data-tool="pen"]').click();
      const eraserControlWorked = erasedStroke && restoredStroke;
      const originalClearConfirm = window.confirm;
      window.confirm = () => true;
      document.querySelector('[data-action="clear-strokes"]').click();
      const boardCleared = store.selectedPaper(state).strokes.length === 0;
      document.querySelector('[data-action="undo-stroke"]').click();
      const boardRestored = store.selectedPaper(state).strokes.length === 2;
      window.confirm = originalClearConfirm;
      const clearControlWorked = boardCleared && boardRestored;

      document.querySelector('[data-action="drawing-tool"][data-tool="highlighter"]').click();
      setupCanvas();
      const highlighterCanvas = document.getElementById('sketchCanvas');
      const highlighterRect = highlighterCanvas.getBoundingClientRect();
      const highlighterPointer = (type, x, y) =>
        highlighterCanvas.dispatchEvent(
          new PointerEvent(type, {
            bubbles: true,
            pointerId: 19,
            button: 0,
            clientX: highlighterRect.left + highlighterRect.width * x,
            clientY: highlighterRect.top + highlighterRect.height * y
          })
        );
      highlighterPointer('pointerdown', 0.48, 0.73);
      highlighterPointer('pointermove', 0.68, 0.73);
      highlighterPointer('pointerup', 0.68, 0.73);
      const highlighterControlWorked = store.selectedPaper(state).strokes.some((stroke) => stroke.kind === 'highlighter');

      const textCanvas = document.getElementById('sketchCanvas');
      const textRect = textCanvas.getBoundingClientRect();
      const strokesBeforeDoubleClick = store.selectedPaper(state).strokes.length;
      [20, 21].forEach((pointerId) => {
        ['pointerdown', 'pointerup'].forEach((type) => textCanvas.dispatchEvent(new PointerEvent(type, {
          bubbles: true,
          pointerId,
          button: 0,
          clientX: textRect.left + textRect.width * 0.08,
          clientY: textRect.top + textRect.height * 0.65
        })));
      });
      textCanvas.dispatchEvent(new MouseEvent('dblclick', {
        bubbles: true,
        button: 0,
        clientX: textRect.left + textRect.width * 0.08,
        clientY: textRect.top + textRect.height * 0.65
      }));
      const paperNote = store.selectedPaper(state).freeNotes[0];
      const paperNoteInput = paperNote
        ? document.querySelector(`[data-field="paper-note-text"][data-note-id="${paperNote.id}"]`)
        : null;
      if (paperNoteInput) {
        paperNoteInput.value = '双击纸面就能记下想法，再整理成下一步。';
        paperNoteInput.dispatchEvent(new Event('input', { bubbles: true }));
      }
      const paperNoteCreated =
        store.selectedPaper(state).freeNotes[0]?.text === '双击纸面就能记下想法，再整理成下一步。' &&
        store.selectedPaper(state).strokes.length === strokesBeforeDoubleClick &&
        drawingTool === 'pen';
      const paperNoteElement = paperNote
        ? document.querySelector(`[data-paper-note][data-note-id="${paperNote.id}"]`)
        : null;
      paperNoteInput?.blur();
      handlePaperObjectSelection({ target: textCanvas });
      const paperNoteActions = paperNoteElement?.querySelector('.paper-note-actions');
      const paperNoteQuietAtRest = paperNoteActions && getComputedStyle(paperNoteActions).pointerEvents === 'none';
      if (paperNoteElement) handlePaperObjectSelection({ target: paperNoteElement });
      const paperNoteRect = paperNoteElement?.getBoundingClientRect();
      const paperNoteStyleWorked =
        paperNoteElement?.classList.contains('paper-slip') &&
        paperNoteQuietAtRest &&
        paperNoteActions && getComputedStyle(paperNoteActions).pointerEvents === 'auto' &&
        paperNoteRect.width <= 312 &&
        paperNoteRect.height <= 170;
      document.querySelector(`[data-action="cycle-paper-note-color"][data-note-id="${paperNote?.id}"]`)?.click();
      const paperNoteColorWorked = store.selectedPaper(state).freeNotes[0]?.color === 'blue';

      const beforeNotePin = clone(state);
      document.querySelector(`[data-action="pin-paper-note"][data-day="tomorrow"][data-note-id="${paperNote?.id}"]`)?.click();
      const paperNotePinWorked = store.activeTasks(state, 'tomorrow').some(
        (task) => task.text === '双击纸面就能记下想法，再整理成下一步。' && task.paperId === paper.id
      );
      state = store.normalizeState(beforeNotePin);
      changeVersion += 1;
      writeLocalImmediately();
      renderAll();

      setupPaperObjects();
      const laneBeforeDrag = clone(store.selectedPaper(state).lanes[0].position);
      const laneGrip = document.querySelector(`[data-canvas-lane][data-lane-id="${paper.lanes[0].id}"] .object-grip`);
      const laneHandle = laneGrip?.closest('[data-paper-drag-handle]');
      const laneHandleRect = laneHandle?.getBoundingClientRect();
      if (laneGrip && laneHandleRect) {
        laneGrip.dispatchEvent(new PointerEvent('pointerdown', {
          bubbles: true,
          pointerId: 21,
          button: 0,
          clientX: laneHandleRect.left + 5,
          clientY: laneHandleRect.top + 5
        }));
        laneHandle.dispatchEvent(new PointerEvent('pointermove', {
          bubbles: true,
          pointerId: 21,
          button: 0,
          clientX: laneHandleRect.left + 45,
          clientY: laneHandleRect.top + 30
        }));
        laneHandle.dispatchEvent(new PointerEvent('pointerup', {
          bubbles: true,
          pointerId: 21,
          button: 0,
          clientX: laneHandleRect.left + 45,
          clientY: laneHandleRect.top + 30
        }));
      }
      const laneCardDragWorked =
        store.selectedPaper(state).lanes[0].position.x !== laneBeforeDrag.x ||
        store.selectedPaper(state).lanes[0].position.y !== laneBeforeDrag.y;
      state = store.updateLane(state, paper.id, paper.lanes[0].id, { position: laneBeforeDrag });
      changeVersion += 1;
      writeLocalImmediately();
      renderAll();

      document.querySelector('.nav-button[data-view="priority"]').click();
      const priorityPageOpened =
        state.view === 'priority' &&
        !document.querySelector('.theme-priority-section') &&
        document.querySelectorAll('[data-task-priority-card]').length === store.activeTasks(state).length;
      const missionMainlineCards = [...document.querySelectorAll('.mainline-track [data-task-priority-card]')];
      const missionBranchCards = [...document.querySelectorAll('.branch-track [data-task-priority-card]')];
      const missionMapWorked =
        document.querySelector('.priority-heading h1')?.textContent.trim() === '任务主线图' &&
        missionMainlineCards.length === Math.min(3, store.activeTasks(state).length) &&
        missionMainlineCards[0]?.dataset.taskId === state.currentTaskId &&
        missionBranchCards.length === Math.max(0, store.activeTasks(state).length - 3) &&
        [...document.querySelectorAll('.mission-strength')].every((element) => Boolean(element.querySelector('i span')));
      const priorityBefore = priorityTasks();
      const prioritySortApplied = priorityBefore.every((task, index) => index === 0 || task.importance <= priorityBefore[index - 1].importance);
      const firstPriorityTaskId = priorityBefore[0].id;
      const originalTaskOrder = store.activeTasks(state).map((task) => task.id).join('|');
      const originalImportance = priorityBefore[0].importance;
      document.querySelector(`[data-task-priority-card][data-task-id="${firstPriorityTaskId}"] [data-action="set-task-importance"][data-importance="4"]`).click();
      const priorityImportanceChanged =
        state.tasks.find((task) => task.id === firstPriorityTaskId)?.importance === 4 &&
        store.activeTasks(state).map((task) => task.id).join('|') === originalTaskOrder;
      document.querySelector(`[data-task-priority-card][data-task-id="${firstPriorityTaskId}"] [data-action="set-task-importance"][data-importance="5"]`).click();
      const priorityImportanceRestored =
        state.tasks.find((task) => task.id === firstPriorityTaskId)?.importance === originalImportance;
      const directScoreButtonsWorked =
        !document.getElementById('priorityInspector') &&
        [...document.querySelectorAll('[data-task-priority-card]')].every(
          (card) => card.querySelectorAll('[data-action="set-task-importance"]').length === 5
        );
      const beforePriorityDrag = clone(state);
      const dragSourceId = priorityBefore[1].id;
      state = store.updateTask(state, dragSourceId, { importance: originalImportance });
      changeVersion += 1;
      writeLocalImmediately();
      renderAll();
      const priorityDragHandlePresent =
        document.querySelectorAll('[data-priority-drag-handle]').length === store.activeTasks(state).length;
      const dragSource = document.querySelector(`[data-task-priority-card][data-task-id="${dragSourceId}"] [data-priority-drag-handle]`);
      const dragTarget = document.querySelector(`[data-task-priority-card][data-task-id="${firstPriorityTaskId}"]`);
      if (dragSource && dragTarget) {
        const transfer = new DataTransfer();
        dragSource.dispatchEvent(new DragEvent('dragstart', { bubbles: true, dataTransfer: transfer }));
        dragTarget.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: transfer }));
        dragTarget.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: transfer }));
      }
      const prioritySameScoreDragWorked =
        priorityTasks()[0]?.id === dragSourceId &&
        state.tasks.find((task) => task.id === dragSourceId)?.importance === originalImportance;
      state = store.normalizeState(beforePriorityDrag);
      changeVersion += 1;
      writeLocalImmediately();
      renderAll();
      const crossScoreSource = priorityTasks().find((task) => task.importance !== priorityTasks()[0]?.importance);
      const crossScoreBefore = clone(state);
      if (crossScoreSource) {
        const crossHandle = document.querySelector(`[data-task-priority-card][data-task-id="${crossScoreSource.id}"] [data-priority-drag-handle]`);
        const crossTarget = document.querySelector(`[data-task-priority-card][data-task-id="${firstPriorityTaskId}"]`);
        if (crossHandle && crossTarget) {
          const transfer = new DataTransfer();
          crossHandle.dispatchEvent(new DragEvent('dragstart', { bubbles: true, dataTransfer: transfer }));
          crossTarget.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: transfer }));
          crossTarget.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: transfer }));
        }
      }
      const priorityCrossScoreDragProtected =
        !crossScoreSource ||
        (state.tasks.find((task) => task.id === crossScoreSource.id)?.importance === crossScoreSource.importance &&
          store.activeTasks(state).map((task) => task.id).join('|') === store.activeTasks(crossScoreBefore).map((task) => task.id).join('|'));
      const missionFocusButtonsWorked = [...document.querySelectorAll('[data-task-priority-card]')].every(
        (card) => Boolean(card.querySelector('[data-action="focus-task"]'))
      );
      const priorityCompletionButton = document.querySelector(`[data-task-priority-card][data-task-id="${firstPriorityTaskId}"] [data-action="complete-task"]`);
      const priorityCompletionLinked = priorityCompletionButton?.dataset.taskId === firstPriorityTaskId;
      const beforePriorityCompletion = clone(state);
      priorityCompletionButton?.click();
      const priorityCompletionOpened =
        Boolean(document.querySelector('.modal-backdrop #completionNote')) &&
        document.querySelector('[data-action="confirm-complete"]')?.dataset.taskId === firstPriorityTaskId;
      if (priorityCompletionOpened) {
        document.getElementById('completionNote').value = '从重要程度线完成';
        document.querySelector('[data-action="confirm-complete"]').click();
      }
      const priorityCompletionWorked = store.completedTasks(state).some(
        (task) => task.id === firstPriorityTaskId && task.completionNote === '从重要程度线完成'
      );
      state = store.normalizeState(beforePriorityCompletion);
      changeVersion += 1;
      writeLocalImmediately();
      renderAll();

      const nonTodayFocusId = store.activeTasks(state, 'tomorrow')[0]?.id;
      document.querySelector(`[data-task-priority-card][data-task-id="${nonTodayFocusId}"] [data-action="focus-task"]`)?.click();
      const missionFocusWorked =
        Boolean(nonTodayFocusId) &&
        state.currentTaskId === nonTodayFocusId &&
        state.view === 'focus' &&
        document.querySelector('.focus-card h1')?.textContent === state.tasks.find((task) => task.id === nonTodayFocusId)?.text;

      document.querySelector('.nav-button[data-view="check"]').click();
      const navigationWorked = state.view === 'check' && Boolean(document.querySelector('.check-page'));
      const secondTodayTaskId = store.activeTasks(state, 'today')[1].id;
      document.querySelector(`[data-action="focus-task"][data-task-id="${secondTodayTaskId}"]`).click();
      const setCurrentWorked = state.currentTaskId === secondTodayTaskId && state.view === 'focus';
      const focusRenameWorked =
        document.querySelector('.nav-button[data-view="focus"]')?.textContent.trim() === '专注时间' &&
        document.querySelector('.focus-card .eyebrow')?.textContent.trim() === '当前主线';
      const focusStepOwnerId = state.currentTaskId;
      let focusStepInput = document.getElementById('focusStepInput');
      focusStepInput.value = '整理资料目录';
      focusStepInput.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      focusStepInput = document.getElementById('focusStepInput');
      focusStepInput.value = '写出三个要点';
      document.querySelector('[data-action="add-focus-step"]')?.click();
      const focusStepTask = state.tasks.find((task) => task.id === focusStepOwnerId);
      const secondFocusStepId = focusStepTask?.focusSteps?.[1]?.id;
      document.querySelector(`[data-action="toggle-focus-step"][data-step-id="${secondFocusStepId}"]`)?.click();
      const focusStepToggled = state.tasks.find((task) => task.id === focusStepOwnerId)?.focusSteps?.[1]?.completed === true;
      document.querySelector(`[data-action="toggle-focus-step"][data-step-id="${secondFocusStepId}"]`)?.click();
      const originalStepDeleteConfirm = window.confirm;
      window.confirm = () => true;
      document.querySelector(`[data-action="delete-focus-step"][data-step-id="${secondFocusStepId}"]`)?.click();
      window.confirm = originalStepDeleteConfirm;
      const focusStepControlsWorked =
        focusStepToggled &&
        state.tasks.find((task) => task.id === focusStepOwnerId)?.focusSteps?.length === 1 &&
        document.querySelectorAll('.focus-step-row').length === 1 &&
        document.querySelector('.focus-step-row strong')?.textContent === '整理资料目录';
      const timerSenseWorked =
        Boolean(document.getElementById('focusClock')) &&
        document.getElementById('focusEndAt')?.textContent.includes('结束') &&
        document.getElementById('focusClock')?.style.getPropertyValue('--remaining').includes('%');
      document.querySelector('[data-action="set-focus-minutes"][data-minutes="45"]').click();
      const presetFocusTimeWorked = state.timer.durationSeconds === 45 * 60 && state.timer.remainingSeconds === 45 * 60;
      const customFocusInput = document.getElementById('customFocusMinutes');
      customFocusInput.value = '52';
      customFocusInput.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      const customFocusTimeWorked =
        state.timer.durationSeconds === 52 * 60 &&
        state.timer.remainingSeconds === 52 * 60 &&
        document.getElementById('focusTime')?.textContent === '52:00';
      document.querySelector('[data-action="set-focus-minutes"][data-minutes="35"]').click();
      document.querySelector('[data-action="toggle-timer"]').click();
      const timerStarted = state.timer.running && Boolean(state.timer.deadline);
      document.querySelector('[data-action="toggle-timer"]').click();
      const timerPaused = !state.timer.running && state.timer.remainingSeconds <= state.timer.durationSeconds;
      state = store.touch({
        ...state,
        timer: {
          durationSeconds: store.FOCUS_DURATION_SECONDS,
          remainingSeconds: 1,
          running: false,
          deadline: null,
          finished: false
        }
      });
      changeVersion += 1;
      renderAll();
      document.querySelector('[data-action="toggle-timer"]').click();
      await new Promise((resolve) => setTimeout(resolve, 1250));
      updateTimerDisplays();
      const timerFinishWorked = state.timer.finished && state.timer.remainingSeconds === 0;
      for (let attempt = 0; attempt < 40 && !window.__finishMusicTest?.played && !window.__finishMusicTest?.error; attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      const reminderSoundWorked =
        window.__finishMusicTest?.played === true &&
        window.__finishMusicTest?.source === 'built-in-chime';
      const finishChoicesWorked =
        Boolean(document.querySelector('[data-action="complete-current-focus-step"]')) &&
        Boolean(document.querySelector('.focus-finish-decision [data-action="complete-task"]')) &&
        Boolean(document.querySelector('[data-action="restart-focus-round"]'));
      const finishMusicStopButton = document.querySelector('[data-action="stop-finish-music"]:not([hidden])');
      finishMusicStopButton?.click();
      const finishMusicStopWorked = Boolean(finishMusicStopButton?.hidden);
      document.querySelector('[data-action="complete-current-focus-step"]')?.click();
      const focusStepFinishWorked =
        state.tasks.find((task) => task.id === focusStepOwnerId)?.focusSteps?.[0]?.completed === true &&
        !state.timer.finished &&
        state.timer.remainingSeconds === state.timer.durationSeconds;
      state = store.touch({
        ...state,
        timer: { ...state.timer, remainingSeconds: 0, running: false, deadline: null, finished: true }
      });
      changeVersion += 1;
      renderAll();
      document.querySelector('[data-action="restart-focus-round"]')?.click();
      const restartFocusRoundWorked = state.timer.running && !state.timer.finished && Boolean(state.timer.deadline);
      document.querySelector('[data-action="toggle-timer"]')?.click();
      document.querySelector('[data-action="reset-timer"]').click();
      document.querySelector('[data-action="complete-task"]').click();
      const completionOpened = Boolean(document.querySelector('.modal-backdrop #completionNote'));
      document.getElementById('completionNote').value = '已经收藏并分了优先级';
      document.querySelector('[data-action="confirm-complete"]').click();
      const completionWorked =
        store.completedTasks(state)[0]?.completionNote === '已经收藏并分了优先级' &&
        store.activeTasks(state, 'today').length === 2;
      document.querySelector('.nav-button[data-view="check"]').click();
      const replacementInput = document.getElementById('quickTaskInput');
      replacementInput.value = '整理项目里的关键案例';
      document.querySelector('[data-action="quick-add"][data-day="today"]').click();
      const replacementAdded = store.activeTasks(state, 'today').length === 3;

      const tomorrowTaskId = store.activeTasks(state, 'tomorrow')[0].id;
      document.querySelector(`[data-action="set-task-horizon"][data-task-id="${tomorrowTaskId}"][data-horizon="month"]`).click();
      const horizonMovedToMonth = state.tasks.find((task) => task.id === tomorrowTaskId)?.horizon === 'month';
      document.querySelector('[data-action="set-horizon-view"][data-horizon="month"]').click();
      document.querySelector(`[data-action="set-task-horizon"][data-task-id="${tomorrowTaskId}"][data-horizon="week"]`).click();
      const horizonControlWorked =
        horizonMovedToMonth &&
        state.tasks.find((task) => task.id === tomorrowTaskId)?.horizon === 'week' &&
        state.tasks.find((task) => task.id === tomorrowTaskId)?.day === 'tomorrow';
      document.querySelector('[data-action="set-horizon-view"][data-horizon="week"]')?.click();
      document.querySelector('.nav-button[data-view="organize"]').click();
      const originalConfirm = window.confirm;
      window.confirm = () => true;
      document.querySelector(`[data-action="delete-task"][data-task-id="${tomorrowTaskId}"]`).click();
      const movedToTrash = store.activeTasks(state, 'tomorrow').length === 0 && state.trash.length === 1;
      document.getElementById('trashButton').click();
      document.querySelector('[data-action="restore-trash"]').click();
      document.querySelector('[data-action="close-modal"]')?.click();
      window.confirm = originalConfirm;
      const trashRestoreWorked =
        store.activeTasks(state, 'tomorrow').length === 1 && state.trash.length === 0;

      document.querySelector('.nav-button[data-view="organize"]').click();
      const organizePageOpened = state.view === 'organize' && Boolean(document.querySelector('.organize-page'));
      const organizerInput = document.getElementById('organizeTaskInput');
      organizerInput.value = '放在收集箱的想法';
      document.querySelector('[data-action="quick-add"][data-day="inbox"]').click();
      const inboxAdded = store.activeTasks(state, 'inbox').length === 1;
      const inboxTaskId = store.activeTasks(state, 'inbox')[0].id;
      document.querySelector(`[data-action="edit-task"][data-task-id="${inboxTaskId}"]`).click();
      document.getElementById('taskEditText').value = '整理过的收集箱想法';
      document.getElementById('taskEditNote').value = '旧版备注也能继续修改';
      document.querySelector(`[data-action="confirm-edit-task"][data-task-id="${inboxTaskId}"]`).click();
      const taskEditWorked = state.tasks.find((task) => task.id === inboxTaskId)?.note === '旧版备注也能继续修改';
      const firstActiveId = store.activeTasks(state)[0].id;
      document.querySelector(`[data-action="move-task-order"][data-direction="down"][data-task-id="${firstActiveId}"]`).click();
      const taskOrderMoved = store.activeTasks(state)[1].id === firstActiveId;
      document.querySelector(`[data-action="move-task-order"][data-direction="up"][data-task-id="${firstActiveId}"]`).click();
      const taskOrderRestored = store.activeTasks(state)[0].id === firstActiveId;
      const reminderInput = document.getElementById('reminderInput');
      reminderInput.value = '一次只做一件事';
      document.querySelector('[data-action="add-reminder"]').click();
      const reminderWorked = state.reminders.length === 1 && state.reminders[0].text === '一次只做一件事';
      const beforeSidebarReminderEdit = clone(state);
      document.getElementById('reminderButton').click();
      const sidebarReminderInput = document.getElementById('sidebarReminderInput');
      const sidebarReminderEditorOpened =
        Boolean(document.getElementById('sidebarReminderModal')) && sidebarReminderInput?.value === '一次只做一件事';
      if (sidebarReminderInput) {
        sidebarReminderInput.value = '先做眼前这一件';
        sidebarReminderInput.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      }
      const sidebarReminderCustomizationWorked =
        sidebarReminderEditorOpened &&
        !document.getElementById('sidebarReminderModal') &&
        state.reminders[0]?.text === '先做眼前这一件' &&
        document.getElementById('sidebarReminder')?.textContent === '先做眼前这一件';
      state = beforeSidebarReminderEdit;
      changeVersion += 1;
      writeLocalImmediately();
      renderAll();
      const beforeQuickCapture = clone(state);
      document.dispatchEvent(new KeyboardEvent('keydown', { code: 'Space', ctrlKey: true, shiftKey: true, bubbles: true }));
      const quickCaptureShortcutOpened = Boolean(document.getElementById('globalCaptureInput'));
      document.querySelector('#quickCaptureModal [data-action="close-modal"]')?.click();
      document.getElementById('quickCaptureButton')?.click();
      const quickCaptureInput = document.getElementById('globalCaptureInput');
      if (quickCaptureInput) {
        quickCaptureInput.value = '突然想到的一件事';
        quickCaptureInput.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      }
      const capturedTask = state.tasks.find((task) => task.text === '突然想到的一件事');
      const quickCaptureWorked =
        quickCaptureShortcutOpened &&
        capturedTask?.day === 'inbox' &&
        capturedTask?.horizon === 'unscheduled' &&
        !document.getElementById('quickCaptureModal');
      state = store.normalizeState(beforeQuickCapture);
      changeVersion += 1;
      writeLocalImmediately();
      renderAll();
      document.getElementById('themeButton').click();
      const themeWorked = state.theme === 'dark' && document.body.classList.contains('theme-dark');
      document.getElementById('themeButton').click();
      const workbook = await window.focusWindow.openFocusWorkbook(state);
      const workbookExported = Boolean(workbook?.opened && workbook.bytes > 0);

      forceSnapshotPending = true;
      await persistPending();
      document.getElementById('compactButton').click();
      await new Promise((resolve) => setTimeout(resolve, 120));
      const compactControls = document.querySelector('.compact-actions');
      const compactWindowControls = document.querySelector('.compact-window-actions');
      const compactQuietWorked =
        Number(getComputedStyle(compactControls).opacity) <= 0.05 &&
        getComputedStyle(compactControls).pointerEvents === 'none' &&
        Number(getComputedStyle(compactWindowControls).opacity) <= 0.05 &&
        Boolean(document.getElementById('compactProgressFill')) &&
        document.getElementById('compactEndAt')?.textContent.includes('结束');
      const compactFits =
        compactApp.scrollWidth <= compactApp.clientWidth + 1 &&
        compactApp.scrollHeight <= compactApp.clientHeight + 1 &&
        [...compactApp.querySelectorAll('h1, .compact-focus-row, .compact-progress, .compact-actions, .compact-window-actions')].every((element) => {
          const outer = compactApp.getBoundingClientRect();
          const inner = element.getBoundingClientRect();
          return inner.left >= outer.left - 1 && inner.right <= outer.right + 1 && inner.bottom <= outer.bottom + 1;
        });
      await persistPending();
      const disk = await window.focusWindow.loadState();
      const today = store.activeTasks(state, 'today');
      const tomorrow = store.activeTasks(state, 'tomorrow');
      const inbox = store.activeTasks(state, 'inbox');
      return {
        paperCount: state.papers.length,
        laneCount: state.papers[0].lanes.length,
        taskCount: state.tasks.length,
        todayCount: today.length,
        tomorrowCount: tomorrow.length,
        inboxCount: inbox.length,
        reminderCount: state.reminders.length,
        limitProtected: limitProtected && uiLimitProtected,
        focusMinutes: state.timer.durationSeconds / 60,
        strokeCount: state.papers[0].strokes.length,
        compactVisible: !compactApp.classList.contains('hidden') && fullApp.classList.contains('hidden'),
        persisted:
          disk?.state?.tasks?.length === state.tasks.length &&
          disk?.state?.papers?.[0]?.strokes?.length === state.papers[0].strokes.length &&
          disk?.state?.papers?.[0]?.freeNotes?.[0]?.text === state.papers[0].freeNotes[0]?.text &&
          disk?.state?.tasks?.find((task) => task.id === focusStepOwnerId)?.focusSteps?.[0]?.text === '整理资料目录',
        workbookExported,
        controlsWorked: lightweightPaperBlocksWorked && newPaperControlWorked && styleControlWorked && linedPaperWorked && defaultDrawingReady && drawingControlWorked && eraserControlWorked && clearControlWorked && highlighterControlWorked && paperNoteCreated && paperNoteStyleWorked && paperNoteColorWorked && paperNotePinWorked && laneCardDragWorked && priorityPageOpened && missionMapWorked && missionFocusButtonsWorked && missionFocusWorked && prioritySortApplied && priorityImportanceChanged && priorityImportanceRestored && directScoreButtonsWorked && priorityDragHandlePresent && prioritySameScoreDragWorked && priorityCrossScoreDragProtected && priorityCompletionLinked && priorityCompletionOpened && priorityCompletionWorked && navigationWorked && setCurrentWorked && focusRenameWorked && focusStepControlsWorked && timerSenseWorked && presetFocusTimeWorked && customFocusTimeWorked && timerStarted && timerPaused && timerFinishWorked && reminderSoundWorked && finishChoicesWorked && finishMusicStopWorked && focusStepFinishWorked && restartFocusRoundWorked && completionOpened && completionWorked && replacementAdded && horizonControlWorked && movedToTrash && trashRestoreWorked && organizePageOpened && inboxAdded && taskEditWorked && taskOrderMoved && taskOrderRestored && reminderWorked && sidebarReminderCustomizationWorked && quickCaptureWorked && compactQuietWorked && compactFits && themeWorked && workbookExported,
        controlChecks: { lightweightPaperBlocksWorked, newPaperControlWorked, styleControlWorked, linedPaperWorked, defaultDrawingReady, drawingControlWorked, eraserControlWorked, clearControlWorked, highlighterControlWorked, paperNoteCreated, paperNoteStyleWorked, paperNoteColorWorked, paperNotePinWorked, laneCardDragWorked, priorityPageOpened, missionMapWorked, missionFocusButtonsWorked, missionFocusWorked, prioritySortApplied, priorityImportanceChanged, priorityImportanceRestored, directScoreButtonsWorked, priorityDragHandlePresent, prioritySameScoreDragWorked, priorityCrossScoreDragProtected, priorityCompletionLinked, priorityCompletionOpened, priorityCompletionWorked, navigationWorked, setCurrentWorked, focusRenameWorked, focusStepControlsWorked, timerSenseWorked, presetFocusTimeWorked, customFocusTimeWorked, timerStarted, timerPaused, timerFinishWorked, reminderSoundWorked, finishChoicesWorked, finishMusicDebug: window.__finishMusicTest, finishMusicStopWorked, focusStepFinishWorked, restartFocusRoundWorked, completionOpened, completionWorked, replacementAdded, horizonControlWorked, movedToTrash, trashRestoreWorked, organizePageOpened, inboxAdded, taskEditWorked, taskOrderMoved, taskOrderRestored, reminderWorked, sidebarReminderCustomizationWorked, quickCaptureShortcutOpened, quickCaptureWorked, compactQuietWorked, compactFits, themeWorked, workbookExported }
      };
    },
    async showForCapture(view) {
      document.getElementById('toast')?.classList.add('hidden');
      if (view === 'compact') {
        await setCompact(true);
      } else {
        if (state.compact) await setCompact(false);
        state = store.touch({ ...state, view });
        changeVersion += 1;
        writeLocalImmediately();
        renderAll();
        content.scrollTop = 0;
        if (view === 'paper') {
          const firstBlock = document.querySelector('.paper-free-note[data-paper-note], .paper-text-block[data-canvas-lane]');
          if (firstBlock) handlePaperObjectSelection({ target: firstBlock });
        }
      }
      return true;
    },
    async prepareFocusCapture(finished = false) {
      if (state.compact) await setCompact(false);
      const task = store.activeTasks(state)[0];
      if (!task) return false;
      let next = store.setCurrentTask(state, task.id);
      const existingSteps = next.tasks.find((entry) => entry.id === task.id)?.focusSteps || [];
      if (!existingSteps.length) next = store.addFocusStep(next, task.id, '先整理资料目录');
      if ((next.tasks.find((entry) => entry.id === task.id)?.focusSteps || []).length < 2) {
        next = store.addFocusStep(next, task.id, '写出三个要点，再继续当前任务');
      }
      const durationSeconds = next.timer.durationSeconds || store.FOCUS_DURATION_SECONDS;
      stopFinishMusic();
      state = store.touch({
        ...next,
        view: 'focus',
        compact: false,
        timer: {
          durationSeconds,
          remainingSeconds: finished ? 0 : durationSeconds,
          running: false,
          deadline: null,
          finished: Boolean(finished)
        }
      });
      changeVersion += 1;
      writeLocalImmediately();
      renderAll();
      content.scrollTop = 0;
      return true;
    },
    checkFocusLayout() {
      const contentRect = content.getBoundingClientRect();
      const card = document.querySelector('.focus-card')?.getBoundingClientRect();
      const clock = document.getElementById('focusClock')?.getBoundingClientRect();
      const steps = document.querySelector('.focus-steps-panel')?.getBoundingClientRect();
      const page = document.querySelector('.focus-page');
      const rows = [...document.querySelectorAll('.focus-step-row')];
      const inside = (rect) => rect && rect.left >= contentRect.left - 1 && rect.right <= contentRect.right + 1;
      const workbenchFits =
        inside(clock) &&
        inside(steps) &&
        clock.right <= steps.left + 1 &&
        rows.length <= store.MAX_FOCUS_STEPS;
      return {
        noHorizontalOverflow: page ? page.scrollWidth <= page.clientWidth + 1 : false,
        cardInside: inside(card),
        workbenchFits,
        stepInputVisible: Boolean(document.getElementById('focusStepInput')),
        finishChoicesAvailable: true,
        ok: Boolean(page && inside(card) && workbenchFits && document.getElementById('focusStepInput') && page.scrollWidth <= page.clientWidth + 1)
      };
    },
    checkLayout() {
      const nav = document.querySelector('.main-nav')?.getBoundingClientRect();
      const brand = document.querySelector('.brand')?.getBoundingClientRect();
      const actions = document.querySelector('.window-actions')?.getBoundingClientRect();
      const contentRect = content.getBoundingClientRect();
      const skyline = document.querySelector('.priority-skyline');
      const taskBoard = document.getElementById('taskPriorityBoard');
      const taskBoardRect = taskBoard?.getBoundingClientRect();
      const taskCardElements = [...document.querySelectorAll('.task-priority-card')];
      const taskCards = taskCardElements.map((card) => card.getBoundingClientRect());
      const importanceLevels = taskCardElements.map((card) => Number(card.dataset.importance));
      const taskTitles = [...document.querySelectorAll('.task-priority-card h3')];
      const taskCardsUsable = taskCards.every((card) => card.width >= 300 && card.height >= 30);
      const taskRowsTopToBottom = taskCards.every((card, index) => index === 0 || card.top >= taskCards[index - 1].bottom + 1);
      const taskBarsLeftAligned =
        taskCardElements.length < 2 ||
        taskCardElements.every((card) => Math.abs(card.offsetLeft - taskCardElements[0].offsetLeft) <= 1);
      const taskRowsFullWidth = Boolean(
        taskBoardRect && taskCards.every((card) => card.width >= taskBoardRect.width - 56)
      );
      const directImportanceControls = taskCardElements.every(
        (card) =>
          card.querySelectorAll('.row-importance-picker [data-action="set-task-importance"]').length === 5 &&
          card.querySelectorAll('.row-importance-picker .importance-choice.active').length === 1
      );
      const rowActionsPresent = taskCardElements.every(
        (card) =>
          Boolean(card.querySelector('[data-action="complete-task"]')) &&
          Boolean(card.querySelector('[data-action="edit-task"]'))
      );
      const activeLevelColors = taskCardElements.map(
        (card) => getComputedStyle(card.querySelector('.importance-choice.active')).backgroundColor
      );
      const distinctLevelColors = new Set(activeLevelColors).size >= new Set(importanceLevels).size;
      const sortedByImportance = importanceLevels.every((level, index) => index === 0 || level <= importanceLevels[index - 1]);
      const taskTitlesReadable = taskTitles.every((title) => title.scrollWidth <= title.clientWidth + 1);
      const directGuidePresent = Boolean(document.querySelector('.priority-direct-guide'));
      const detachedInspectorRemoved = !document.getElementById('priorityInspector');
      const skylineInside = Boolean(
        skyline && taskBoardRect && taskBoardRect.left >= contentRect.left - 1 && taskBoardRect.right <= contentRect.right + 1
      );
      const taskBoardNoScroll = Boolean(taskBoard && taskBoard.scrollWidth <= taskBoard.clientWidth + 1);
      const noTaskCardOverlap = taskCards.every((card, index) =>
        taskCards.slice(index + 1).every((other) => {
          const horizontal = Math.min(card.right, other.right) - Math.max(card.left, other.left);
          const vertical = Math.min(card.bottom, other.bottom) - Math.max(card.top, other.top);
          return horizontal <= 1 || vertical <= 1;
        })
      );
      return {
        width: window.innerWidth,
        navCount: document.querySelectorAll('.nav-button').length,
        headerFits: Boolean(nav && brand && actions && brand.right <= nav.left + 1 && nav.right <= actions.left + 1),
        noHorizontalOverflow: content.scrollWidth <= content.clientWidth + 1,
        skylineInside,
        taskCardCount: taskCards.length,
        taskCardsUsable,
        taskRowsTopToBottom,
        taskBarsLeftAligned,
        taskRowsFullWidth,
        directImportanceControls,
        rowActionsPresent,
        distinctLevelColors,
        sortedByImportance,
        taskTitlesReadable,
        directGuidePresent,
        detachedInspectorRemoved,
        taskBoardNoScroll,
        taskCardRects: taskCards.map((card) => ({ width: card.width, height: card.height, bottom: card.bottom })),
        noTaskCardOverlap,
        ok:
          document.querySelectorAll('.nav-button').length === 5 &&
          Boolean(nav && brand && actions && brand.right <= nav.left + 1 && nav.right <= actions.left + 1) &&
          content.scrollWidth <= content.clientWidth + 1 &&
          skylineInside &&
          taskCards.length === store.activeTasks(state).length &&
          taskCardsUsable &&
          taskRowsTopToBottom &&
          taskBarsLeftAligned &&
          taskRowsFullWidth &&
          directImportanceControls &&
          rowActionsPresent &&
          distinctLevelColors &&
          sortedByImportance &&
          taskTitlesReadable &&
          directGuidePresent &&
          detachedInspectorRemoved &&
          taskBoardNoScroll &&
          noTaskCardOverlap
      };
    },
    checkTwentyTaskLine(keepPreview = false) {
      const originalState = state;
      let previewState = clone(state);
      let activeCount = store.activeTasks(previewState).length;
      while (activeCount < 20) {
        previewState = store.addTask(previewState, {
          text: `同屏检查事项 ${activeCount + 1}`,
          day: 'tomorrow'
        });
        activeCount = store.activeTasks(previewState).length;
      }
      state = store.touch({ ...previewState, view: 'priority', compact: false });
      renderAll();
      const board = document.getElementById('taskPriorityBoard');
      const boardRect = board?.getBoundingClientRect();
      const cardElements = [...document.querySelectorAll('.task-priority-card')];
      const cards = cardElements.map((card) => card.getBoundingClientRect());
      const levels = cardElements.map((card) => Number(card.dataset.importance));
      const titles = [...document.querySelectorAll('.task-priority-card h3')];
      const activeLevelColors = cardElements.map(
        (card) => getComputedStyle(card.querySelector('.importance-choice.active')).backgroundColor
      );
      const noOverlap = cards.every((card, index) =>
        cards.slice(index + 1).every((other) => {
          const horizontal = Math.min(card.right, other.right) - Math.max(card.left, other.left);
          const vertical = Math.min(card.bottom, other.bottom) - Math.max(card.top, other.top);
          return horizontal <= 1 || vertical <= 1;
        })
      );
      const result = {
        count: cards.length,
        noHorizontalScroll: Boolean(board && board.scrollWidth <= board.clientWidth + 1),
        allInside: Boolean(boardRect && cards.every((card) => card.left >= boardRect.left - 1 && card.right <= boardRect.right + 1)),
        singleColumn:
          cardElements.length < 2 ||
          cardElements.every((card) => Math.abs(card.offsetLeft - cardElements[0].offsetLeft) <= 1),
        topToBottom: cards.every((card, index) => index === 0 || card.top >= cards[index - 1].bottom),
        leftAligned:
          cardElements.length < 2 ||
          cardElements.every((card) => Math.abs(card.offsetLeft - cardElements[0].offsetLeft) <= 1),
        fullWidthRows: Boolean(boardRect && cards.every((card) => card.width >= boardRect.width - 56)),
        directImportanceControls: cardElements.every(
          (card) =>
            card.querySelectorAll('.row-importance-picker [data-action="set-task-importance"]').length === 5 &&
            card.querySelectorAll('.row-importance-picker .importance-choice.active').length === 1
        ),
        rowActionsPresent: cardElements.every(
          (card) =>
            Boolean(card.querySelector('[data-action="complete-task"]')) &&
            Boolean(card.querySelector('[data-action="edit-task"]'))
        ),
        distinctLevelColors: new Set(activeLevelColors).size >= new Set(levels).size,
        sortedByImportance: levels.every((level, index) => index === 0 || level <= levels[index - 1]),
        directGuidePresent: Boolean(document.querySelector('.priority-direct-guide')),
        detachedInspectorRemoved: !document.getElementById('priorityInspector'),
        fullNamesFit: titles.every((title) => title.scrollWidth <= title.clientWidth + 1),
        clippedTitles: titles.map((title, index) => ({ index, scrollWidth: title.scrollWidth, clientWidth: title.clientWidth })).filter((entry) => entry.scrollWidth > entry.clientWidth + 1),
        minimumWidth: cards.length ? Math.min(...cards.map((card) => card.width)) : 0,
        noOverlap
      };
      result.ok =
        result.count >= 20 &&
        result.noHorizontalScroll &&
        result.allInside &&
        result.singleColumn &&
        result.topToBottom &&
        result.leftAligned &&
        result.fullWidthRows &&
        result.directImportanceControls &&
        result.rowActionsPresent &&
        result.distinctLevelColors &&
        result.sortedByImportance &&
        result.directGuidePresent &&
        result.detachedInspectorRemoved &&
        result.fullNamesFit &&
        result.minimumWidth >= 300 &&
        result.noOverlap;
      if (!keepPreview) {
        state = originalState;
        renderAll();
        content.scrollTop = 0;
      }
      return result;
    },
    checkOrganizeLayout() {
      const contentRect = content.getBoundingClientRect();
      const page = document.querySelector('.organize-page');
      const rows = [...document.querySelectorAll('.organize-task-row, .reminder-row, .organize-history-row')];
      const rowsInside = rows.every((row) => {
        const rect = row.getBoundingClientRect();
        return rect.left >= contentRect.left - 1 && rect.right <= contentRect.right + 1 && row.scrollWidth <= row.clientWidth + 1;
      });
      const activeNav = document.querySelector('.nav-button.active')?.dataset.view;
      return {
        width: window.innerWidth,
        pageVisible: Boolean(page),
        activeNav,
        noHorizontalOverflow: content.scrollWidth <= content.clientWidth + 1,
        rowsInside,
        ok: Boolean(page) && activeNav === 'organize' && content.scrollWidth <= content.clientWidth + 1 && rowsInside
      };
    },
    checkTodayLayout() {
      const contentRect = content.getBoundingClientRect();
      const page = document.querySelector('.check-page');
      const cards = [...document.querySelectorAll('.today-commitment')];
      const tabs = [...document.querySelectorAll('.horizon-tab')];
      const rows = [...document.querySelectorAll('.horizon-task-row')];
      const insideContent = (element) => {
        const rect = element.getBoundingClientRect();
        return rect.left >= contentRect.left - 1 && rect.right <= contentRect.right + 1 && element.scrollWidth <= element.clientWidth + 1;
      };
      const todayCardsInside = cards.every(insideContent);
      const horizonControlsInside = [...tabs, ...rows].every(insideContent);
      const activeNav = document.querySelector('.nav-button.active')?.dataset.view;
      const horizonButtonsWork = rows.every((row) => row.querySelectorAll('[data-action="set-task-horizon"]').length === 4);
      return {
        width: window.innerWidth,
        pageVisible: Boolean(page),
        activeNav,
        todayCardCount: cards.length,
        horizonTabCount: tabs.length,
        noHorizontalOverflow: content.scrollWidth <= content.clientWidth + 1,
        todayCardsInside,
        horizonControlsInside,
        horizonButtonsWork,
        ok:
          Boolean(page) &&
          activeNav === 'check' &&
          cards.length === store.TODAY_LIMIT &&
          tabs.length === HORIZON_OPTIONS.length &&
          content.scrollWidth <= content.clientWidth + 1 &&
          todayCardsInside &&
          horizonControlsInside &&
          horizonButtonsWork
      };
    },
    checkSketchLayout() {
      const canvas = document.getElementById('sketchCanvas');
      const tools = [...document.querySelectorAll('.sketch-tool')];
      const stage = document.getElementById('paperCanvasStage');
      const toolbar = document.querySelector('.paper-stage-toolbar');
      const laneCards = [...document.querySelectorAll('[data-canvas-lane]')];
      const dragHandles = [...document.querySelectorAll('[data-paper-drag-handle]')];
      if (!canvas || !stage || !toolbar) return { ok: false, toolCount: tools.length };
      const canvasRect = canvas.getBoundingClientRect();
      const stageRect = stage.getBoundingClientRect();
      const toolbarRect = toolbar.getBoundingClientRect();
      const toolsInsidePage = tools.every((tool) => {
        const rect = tool.getBoundingClientRect();
        return rect.left >= stageRect.left - 1 && rect.right <= stageRect.right + 1;
      });
      const canvasFillsPaper =
        Math.abs(canvasRect.left - stageRect.left) <= 1 &&
        Math.abs(canvasRect.right - stageRect.right) <= 1 &&
        Math.abs(canvasRect.top - stageRect.top) <= 1 &&
        Math.abs(canvasRect.bottom - stageRect.bottom) <= 1;
      const toolbarOnPaper =
        toolbarRect.left >= stageRect.left && toolbarRect.right <= stageRect.right && toolbarRect.top >= stageRect.top;
      const cardsInsidePaper = laneCards.every((card) => {
        const rect = card.getBoundingClientRect();
        return rect.left >= stageRect.left - 1 && rect.right <= stageRect.right + 1 && rect.bottom <= stageRect.bottom + 1;
      });
      return {
        toolCount: tools.length,
        colorCount: document.querySelectorAll('.ink-color').length,
        widthCount: document.querySelectorAll('.ink-width').length,
        canvasFillsPaper,
        toolbarOnPaper,
        toolsInsidePage,
        laneCardCount: laneCards.length,
        dragHandleCount: dragHandles.length,
        cardsInsidePaper,
        canvasHeight: canvasRect.height,
        noHorizontalOverflow: content.scrollWidth <= content.clientWidth + 1,
        ok:
          tools.length === 5 &&
          document.querySelectorAll('.ink-color').length === 4 &&
          document.querySelectorAll('.ink-width').length === 3 &&
          canvasFillsPaper &&
          toolbarOnPaper &&
          toolsInsidePage &&
          laneCards.length === 3 &&
          dragHandles.length >= 4 &&
          cardsInsidePaper &&
          canvasRect.height >= 700 &&
          content.scrollWidth <= content.clientWidth + 1
      };
    }
  };

  initialize().catch((error) => {
    console.error(error);
    content.innerHTML = '<section class="page"><div class="empty-state">启动时遇到问题。你的本地副本仍然保留着，请重新打开应用。</div></section>';
    setSaveStatus('启动失败', 'error');
  });
})();
