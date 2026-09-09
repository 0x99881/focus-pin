'use strict';

const { app, BrowserWindow, globalShortcut, ipcMain, screen, shell } = require('electron');
const fs = require('node:fs/promises');
const fsSync = require('node:fs');
const path = require('node:path');
const { loadState, saveState } = require('./persistence');
const { buildFocusWorkbookBuffer } = require('./excel-export');

const WINDOW_SIZES = {
  normal: { width: 1180, height: 780, minWidth: 860, minHeight: 620 },
  compact: { width: 260, height: 96, minWidth: 240, minHeight: 88 }
};
const BOUNDS_FILE = 'window-bounds-v2.json';
const BOUNDS_SAVE_DELAY_MS = 300;
const SMOKE_USER_DATA_PATH = path.join(__dirname, '..', '.smoke-user-data', String(process.pid));
const FOCUS_WORKBOOK_PATHS = {
  'zh-CN': path.join(__dirname, '..', '专注钉整理表.xlsx'),
  en: path.join(__dirname, '..', 'focus-pin-export.xlsx')
};
const APP_ICON_PATH = path.join(__dirname, '..', 'assets', 'app-icon.ico');

app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
app.commandLine.appendSwitch('disable-background-media-suspend');

let mainWindow = null;
let windowMode = 'normal';
let saveBoundsTimer = null;
let stateSaveQueue = Promise.resolve();

if (process.env.FOCUS_MEMO_SMOKE === '1') {
  fsSync.rmSync(SMOKE_USER_DATA_PATH, { recursive: true, force: true });
  app.setPath('userData', SMOKE_USER_DATA_PATH);
}

function getBoundsPath() {
  return path.join(app.getPath('userData'), BOUNDS_FILE);
}

function isVisible(bounds) {
  return screen.getAllDisplays().some(({ workArea }) => {
    const width = Math.min(bounds.x + bounds.width, workArea.x + workArea.width) - Math.max(bounds.x, workArea.x);
    const height = Math.min(bounds.y + bounds.height, workArea.y + workArea.height) - Math.max(bounds.y, workArea.y);
    return width >= 180 && height >= 120;
  });
}

function readSavedBounds() {
  try {
    const bounds = JSON.parse(fsSync.readFileSync(getBoundsPath(), 'utf8'));
    if (
      Number.isFinite(bounds.x) &&
      Number.isFinite(bounds.y) &&
      Number.isFinite(bounds.width) &&
      Number.isFinite(bounds.height) &&
      bounds.width >= WINDOW_SIZES.normal.minWidth &&
      bounds.height >= WINDOW_SIZES.normal.minHeight &&
      isVisible(bounds)
    ) {
      return bounds;
    }
  } catch (error) {
    if (error.code !== 'ENOENT') console.warn('Unable to read saved window position.', error);
  }
  return null;
}

function saveBounds() {
  if (!mainWindow || mainWindow.isDestroyed() || windowMode !== 'normal') return;
  try {
    fsSync.writeFileSync(getBoundsPath(), JSON.stringify(mainWindow.getBounds()));
  } catch (error) {
    console.warn('Unable to save window position.', error);
  }
}

function scheduleBoundsSave() {
  clearTimeout(saveBoundsTimer);
  saveBoundsTimer = setTimeout(saveBounds, BOUNDS_SAVE_DELAY_MS);
}

function setWindowMode(mode) {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  const target = mode === 'compact' ? 'compact' : 'normal';
  const size = WINDOW_SIZES[target];
  const previousMode = windowMode;
  windowMode = target;
  mainWindow.setResizable(target !== 'compact');
  mainWindow.setMinimumSize(size.minWidth, size.minHeight);
  if (target === 'compact') {
    const current = mainWindow.getBounds();
    const display = screen.getDisplayMatching(current).workArea;
    const x = Math.min(Math.max(current.x + current.width - size.width, display.x), display.x + display.width - size.width);
    const y = Math.min(Math.max(current.y, display.y), display.y + display.height - size.height);
    mainWindow.setBounds({ x, y, width: size.width, height: size.height }, true);
  } else if (previousMode !== 'normal') {
    const saved = readSavedBounds();
    if (saved) mainWindow.setBounds(saved, true);
    else mainWindow.setSize(size.width, size.height, true);
    mainWindow.center();
  }
  mainWindow.setAlwaysOnTop(target === 'compact', target === 'compact' ? 'screen-saver' : 'normal');
}

function showQuickCapture() {
  if (!mainWindow || mainWindow.isDestroyed()) return false;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
  if (mainWindow.webContents.isLoading()) {
    mainWindow.webContents.once('did-finish-load', () => mainWindow?.webContents.send('quick-capture:open'));
  } else {
    mainWindow.webContents.send('quick-capture:open');
  }
  return true;
}

async function openFocusWorkbook(state) {
  const exportName = state?.language === 'en' ? 'focus-pin-export.xlsx' : '专注钉整理表.xlsx';
  const targetPath = process.env.FOCUS_MEMO_SMOKE === '1'
    ? path.join(app.getPath('userData'), exportName)
    : FOCUS_WORKBOOK_PATHS[state?.language === 'en' ? 'en' : 'zh-CN'];
  const buffer = buildFocusWorkbookBuffer(state);
  await fs.writeFile(targetPath, buffer);
  if (process.env.FOCUS_MEMO_SMOKE === '1') {
    return { opened: true, path: targetPath, bytes: buffer.length, simulated: true };
  }
  const error = await shell.openPath(targetPath);
  return { opened: !error, path: targetPath, bytes: buffer.length, error: error || null };
}

async function waitForRendererReady() {
  await mainWindow.webContents.executeJavaScript(`new Promise((resolve, reject) => {
    const started = Date.now();
    const poll = () => {
      if (window.__focusPinReady && window.__focusPinTest) return resolve(true);
      if (Date.now() - started > 8000) return reject(new Error('Renderer did not become ready.'));
      setTimeout(poll, 40);
    };
    poll();
  })`);
}

async function runSmokeTest() {
  try {
    await waitForRendererReady();
    const result = await mainWindow.webContents.executeJavaScript('window.__focusPinTest.runCoreFlow()');
    result.englishUi = await mainWindow.webContents.executeJavaScript('window.__focusPinTest.checkEnglishUi()');
    if (!mainWindow.isVisible()) {
      mainWindow.showInactive();
      await new Promise((resolve) => setTimeout(resolve, 120));
    }
    setWindowMode('compact');
    await new Promise((resolve) => setTimeout(resolve, 80));
    result.compactAlwaysOnTop = mainWindow.isAlwaysOnTop();
    result.compactBounds = mainWindow.getBounds();
    result.compactSuperSmall =
      result.compactBounds.width <= WINDOW_SIZES.compact.width + 4 &&
      result.compactBounds.height <= WINDOW_SIZES.compact.height + 4;
    if (
      result.paperCount !== 6 ||
      result.laneCount !== 3 ||
      result.todayCount !== 3 ||
      result.tomorrowCount !== 1 ||
      result.inboxCount !== 1 ||
      result.reminderCount !== 1 ||
      !result.limitProtected ||
      result.focusMinutes !== 25 ||
      result.strokeCount < 1 ||
      !result.compactVisible ||
      !result.persisted ||
      !result.workbookExported ||
      !result.controlsWorked ||
      !result.englishUi?.ok ||
      !result.compactAlwaysOnTop ||
      !result.compactSuperSmall
    ) {
      throw new Error(`Core smoke failed: ${JSON.stringify(result)}`);
    }

    const reloadFinished = new Promise((resolve) => mainWindow.webContents.once('did-finish-load', resolve));
    mainWindow.webContents.reload();
    await reloadFinished;
    await waitForRendererReady();
    const reloadedState = await mainWindow.webContents.executeJavaScript('window.__focusPinTest.getState()');
    result.reloaded =
      reloadedState.tasks?.length === result.taskCount &&
      reloadedState.reminders?.length === result.reminderCount &&
      reloadedState.papers?.[0]?.strokes?.length === result.strokeCount &&
      reloadedState.papers?.[0]?.freeNotes?.[0]?.text === '双击纸面就能记下想法，再整理成下一步。' &&
      reloadedState.tasks?.some((task) => task.focusSteps?.some((step) => step.text === '整理资料目录')) &&
      reloadedState.timer?.durationSeconds === 25 * 60;
    result.defaultViewIsToday = reloadedState.view === 'check';
    if (!result.reloaded) throw new Error(`Reload recovery failed: ${JSON.stringify(reloadedState)}`);
    if (!result.defaultViewIsToday) throw new Error(`Today must be the default view: ${reloadedState.view}`);

    await mainWindow.webContents.executeJavaScript('window.__focusPinTest.showForCapture("priority")');
    await new Promise((resolve) => setTimeout(resolve, 500));
    result.normalNotAlwaysOnTop = !mainWindow.isAlwaysOnTop();
    if (!result.normalNotAlwaysOnTop) {
      throw new Error('Normal window must not stay always on top.');
    }
    for (let attempt = 0; attempt < 5; attempt += 1) {
      mainWindow.setSize(WINDOW_SIZES.normal.minWidth, WINDOW_SIZES.normal.minHeight, false);
      await new Promise((resolve) => setTimeout(resolve, 260));
      result.narrowWindowBounds = mainWindow.getBounds();
      result.narrowLayout = await mainWindow.webContents.executeJavaScript('window.__focusPinTest.checkLayout()');
      if (result.narrowWindowBounds.width <= WINDOW_SIZES.normal.minWidth + 4) break;
    }
    if (!result.narrowLayout?.ok || result.narrowWindowBounds.width > WINDOW_SIZES.normal.minWidth + 4) {
      throw new Error(
        `Narrow layout failed: ${JSON.stringify({ bounds: result.narrowWindowBounds, layout: result.narrowLayout })}`
      );
    }
    result.twentyTaskLine = await mainWindow.webContents.executeJavaScript(
      'window.__focusPinTest.checkTwentyTaskLine()'
    );
    if (!result.twentyTaskLine?.ok) {
      throw new Error(`Twenty item priority line failed: ${JSON.stringify(result.twentyTaskLine)}`);
    }
    await mainWindow.webContents.executeJavaScript('window.__focusPinTest.showForCapture("organize")');
    await new Promise((resolve) => setTimeout(resolve, 260));
    result.organizeNarrowLayout = await mainWindow.webContents.executeJavaScript(
      'window.__focusPinTest.checkOrganizeLayout()'
    );
    if (!result.organizeNarrowLayout?.ok) {
      throw new Error(`Organizer narrow layout failed: ${JSON.stringify(result.organizeNarrowLayout)}`);
    }
    await mainWindow.webContents.executeJavaScript('window.__focusPinTest.showForCapture("check")');
    await new Promise((resolve) => setTimeout(resolve, 260));
    result.todayNarrowLayout = await mainWindow.webContents.executeJavaScript(
      'window.__focusPinTest.checkTodayLayout()'
    );
    if (!result.todayNarrowLayout?.ok) {
      throw new Error(`Today check narrow layout failed: ${JSON.stringify(result.todayNarrowLayout)}`);
    }
    await mainWindow.webContents.executeJavaScript('window.__focusPinTest.showForCapture("paper")');
    await new Promise((resolve) => setTimeout(resolve, 260));
    result.sketchLayout = await mainWindow.webContents.executeJavaScript('window.__focusPinTest.checkSketchLayout()');
    if (!result.sketchLayout?.ok) {
      throw new Error(`Sketch toolbar layout failed: ${JSON.stringify(result.sketchLayout)}`);
    }
    await mainWindow.webContents.executeJavaScript('window.__focusPinTest.prepareFocusCapture(false)');
    await new Promise((resolve) => setTimeout(resolve, 260));
    result.focusNarrowLayout = await mainWindow.webContents.executeJavaScript('window.__focusPinTest.checkFocusLayout()');
    if (!result.focusNarrowLayout?.ok) {
      throw new Error(`Focus narrow layout failed: ${JSON.stringify(result.focusNarrowLayout)}`);
    }
    result.englishResponsive = await mainWindow.webContents.executeJavaScript(
      'window.__focusPinTest.checkEnglishResponsiveUi()'
    );
    if (!result.englishResponsive?.ok) {
      throw new Error(`English responsive layout failed: ${JSON.stringify(result.englishResponsive)}`);
    }
    mainWindow.setSize(WINDOW_SIZES.normal.width, WINDOW_SIZES.normal.height, false);
    await new Promise((resolve) => setTimeout(resolve, 350));

    if (process.env.FOCUS_MEMO_VISUAL_QA === '1') {
      const qaDir = path.join(app.getPath('temp'), `focus-pin-qa-${process.pid}`);
      await fs.mkdir(qaDir, { recursive: true });
      const saveCurrentFrame = async (filePath) => {
        try {
          await mainWindow.webContents.capturePage();
        } catch {
          // A freshly reloaded Windows surface can briefly be unavailable; the retries below handle it.
        }
        await new Promise((resolve) => setTimeout(resolve, 80));
        for (let attempt = 0; attempt < 5; attempt += 1) {
          try {
            const png = (await mainWindow.webContents.capturePage()).toPNG();
            if (png.length > 1000) {
              await fs.writeFile(filePath, png);
              return;
            }
          } catch {
            // Retry after Windows finishes presenting the surface.
          }
          await new Promise((resolve) => setTimeout(resolve, 120));
        }
        throw new Error(`Unable to capture ${filePath}`);
      };

      await mainWindow.webContents.executeJavaScript('window.__focusPinTest.showForCapture("organize")');
      await new Promise((resolve) => setTimeout(resolve, 400));
      const organizeReloaded = new Promise((resolve) => mainWindow.webContents.once('did-finish-load', resolve));
      mainWindow.webContents.reload();
      await organizeReloaded;
      await waitForRendererReady();
      await mainWindow.webContents.executeJavaScript('window.__focusPinTest.showForCapture("organize")');
      await new Promise((resolve) => setTimeout(resolve, 700));
      const organizePath = path.join(qaDir, '00-organize.png');
      await saveCurrentFrame(organizePath);

      await mainWindow.webContents.executeJavaScript(
        'if (document.body.classList.contains("theme-dark")) document.getElementById("themeButton").click()'
      );
      await mainWindow.webContents.executeJavaScript('window.__focusPinTest.showForCapture("priority")');
      await mainWindow.webContents.executeJavaScript('window.__focusPinTest.checkTwentyTaskLine(true)');
      await new Promise((resolve) => setTimeout(resolve, 500));
      const priorityPath = path.join(qaDir, '02-priority.png');
      await saveCurrentFrame(priorityPath);

      await mainWindow.webContents.executeJavaScript(
        'if (!document.body.classList.contains("theme-dark")) document.getElementById("themeButton").click()'
      );
      await mainWindow.webContents.executeJavaScript('window.__focusPinTest.showForCapture("paper")');
      await new Promise((resolve) => setTimeout(resolve, 400));
      const paperReloaded = new Promise((resolve) => mainWindow.webContents.once('did-finish-load', resolve));
      mainWindow.webContents.reload();
      await paperReloaded;
      await waitForRendererReady();
      await mainWindow.webContents.executeJavaScript('window.__focusPinTest.showForCapture("paper")');
      await new Promise((resolve) => setTimeout(resolve, 700));
      const paperPath = path.join(qaDir, '01-paper-dark.png');
      await saveCurrentFrame(paperPath);

      await mainWindow.webContents.executeJavaScript('window.__focusPinTest.showForCapture("check")');
      await new Promise((resolve) => setTimeout(resolve, 500));
      const checkPath = path.join(qaDir, '03-check.png');
      await saveCurrentFrame(checkPath);

      await mainWindow.webContents.executeJavaScript('document.getElementById("quickCaptureButton").click()');
      await new Promise((resolve) => setTimeout(resolve, 220));
      const quickCapturePath = path.join(qaDir, '05-quick-capture.png');
      await saveCurrentFrame(quickCapturePath);
      await mainWindow.webContents.executeJavaScript('document.querySelector("#quickCaptureModal [data-action=close-modal]")?.click()');

      await mainWindow.webContents.executeJavaScript('document.getElementById("reminderButton").click()');
      await new Promise((resolve) => setTimeout(resolve, 220));
      const reminderEditorPath = path.join(qaDir, '07-reminder-editor.png');
      await saveCurrentFrame(reminderEditorPath);
      await mainWindow.webContents.executeJavaScript('document.querySelector("#sidebarReminderModal [data-action=close-modal]")?.click()');

      await mainWindow.webContents.executeJavaScript('window.__focusPinTest.prepareFocusCapture(false)');
      await new Promise((resolve) => setTimeout(resolve, 500));
      const focusPath = path.join(qaDir, '04-focus.png');
      await saveCurrentFrame(focusPath);

      await mainWindow.webContents.executeJavaScript('window.__focusPinTest.prepareFocusCapture(true)');
      await new Promise((resolve) => setTimeout(resolve, 320));
      const focusFinishedPath = path.join(qaDir, '08-focus-finished.png');
      await saveCurrentFrame(focusFinishedPath);

      await mainWindow.webContents.executeJavaScript('window.__focusPinTest.prepareFocusCapture(false)');
      await mainWindow.webContents.executeJavaScript('window.__focusPinTest.showForCapture("compact")');
      await new Promise((resolve) => setTimeout(resolve, 280));
      const compactPath = path.join(qaDir, '06-compact.png');
      await saveCurrentFrame(compactPath);
      await mainWindow.webContents.executeJavaScript('document.getElementById("compactApp")?.classList.add("show-controls")');
      await new Promise((resolve) => setTimeout(resolve, 220));
      const compactHoverLayout = await mainWindow.webContents.executeJavaScript(`(() => {
        const app = document.getElementById('compactApp');
        const timer = document.getElementById('compactTime')?.parentElement;
        const actions = document.querySelector('.compact-actions');
        const rect = (element) => element ? Object.fromEntries(['x', 'y', 'width', 'height', 'right', 'bottom'].map((key) => [key, element.getBoundingClientRect()[key]])) : null;
        return { app: rect(app), timer: rect(timer), actions: rect(actions), timerText: timer?.innerText || '' };
      })()`);
      await fs.writeFile(path.join(qaDir, '10-compact-layout.json'), JSON.stringify(compactHoverLayout, null, 2));
      const compactHoverPath = path.join(qaDir, '09-compact-hover.png');
      await saveCurrentFrame(compactHoverPath);
      await mainWindow.webContents.executeJavaScript('document.getElementById("compactApp")?.classList.remove("show-controls")');
      setWindowMode('normal');
      await mainWindow.webContents.executeJavaScript('window.__focusPinTest.showEnglishForCapture("check")');
      await new Promise((resolve) => setTimeout(resolve, 420));
      const englishCheckPath = path.join(qaDir, '11-english-check.png');
      await saveCurrentFrame(englishCheckPath);
      await mainWindow.webContents.executeJavaScript('window.__focusPinTest.showEnglishForCapture("focus")');
      await new Promise((resolve) => setTimeout(resolve, 320));
      const englishFocusPath = path.join(qaDir, '12-english-focus.png');
      await saveCurrentFrame(englishFocusPath);
      await mainWindow.webContents.executeJavaScript('window.__focusPinTest.showEnglishForCapture("compact")');
      setWindowMode('compact');
      await new Promise((resolve) => setTimeout(resolve, 260));
      await mainWindow.webContents.executeJavaScript('document.getElementById("compactApp")?.classList.add("show-controls")');
      const englishCompactPath = path.join(qaDir, '13-english-compact.png');
      await saveCurrentFrame(englishCompactPath);
      console.log(`VISUAL_QA_OK ${JSON.stringify({ paperPath, priorityPath, checkPath, focusPath, focusFinishedPath, organizePath, quickCapturePath, reminderEditorPath, compactPath, compactHoverPath, englishCheckPath, englishFocusPath, englishCompactPath, result })}`);
    } else {
      console.log(`SMOKE_OK ${JSON.stringify(result)}`);
    }
    app.quit();
  } catch (error) {
    console.error(error);
    if (process.env.FOCUS_MEMO_SMOKE === '1') {
      try {
        fsSync.writeFileSync(path.join(app.getPath('userData'), 'smoke-error.txt'), error?.stack || String(error));
      } catch {
        // Keep the original smoke failure as the reported error.
      }
    }
    app.exit(1);
  }
}

function createWindow() {
  const smoke = process.env.FOCUS_MEMO_SMOKE === '1';
  const visualQa = process.env.FOCUS_MEMO_VISUAL_QA === '1';
  const savedBounds = smoke ? null : readSavedBounds();
  const normal = WINDOW_SIZES.normal;
  mainWindow = new BrowserWindow({
    width: savedBounds?.width || normal.width,
    height: savedBounds?.height || normal.height,
    x: savedBounds?.x,
    y: savedBounds?.y,
    minWidth: normal.minWidth,
    minHeight: normal.minHeight,
    frame: false,
    resizable: true,
    movable: true,
    show: !smoke || visualQa,
    alwaysOnTop: false,
    backgroundColor: '#e9e3d5',
    icon: APP_ICON_PATH,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: false
    }
  });

  mainWindow.on('resize', scheduleBoundsSave);
  mainWindow.on('move', scheduleBoundsSave);
  mainWindow.on('close', saveBounds);
  mainWindow.on('closed', () => {
    clearTimeout(saveBoundsTimer);
    mainWindow = null;
  });
  mainWindow.loadFile(path.join(__dirname, 'index.html'));
  if (smoke) mainWindow.webContents.once('did-finish-load', runSmokeTest);
}

app.whenReady().then(() => {
  app.setAppUserModelId('com.focus-pin.desktop');
  ipcMain.handle('window:set-mode', (_event, mode) => {
    setWindowMode(mode);
    return windowMode;
  });
  ipcMain.handle('window:minimize', () => mainWindow?.minimize());
  ipcMain.handle('window:close', () => mainWindow?.close());
  ipcMain.handle('window:quick-capture', () => showQuickCapture());
  ipcMain.handle('state:load', () => loadState(app.getPath('userData')));
  ipcMain.handle('state:save', (_event, state, options = {}) => {
    stateSaveQueue = stateSaveQueue
      .catch(() => undefined)
      .then(() => saveState(app.getPath('userData'), state, options));
    return stateSaveQueue;
  });
  ipcMain.handle('excel:open-focus-workbook', (_event, state) => openFocusWorkbook(state));

  createWindow();
  if (process.env.FOCUS_MEMO_SMOKE !== '1') {
    const registered = globalShortcut.register('CommandOrControl+Shift+Space', showQuickCapture);
    if (!registered) console.warn('Unable to register the quick-capture shortcut.');
  }
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
});
