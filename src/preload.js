'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('focusWindow', {
  isSmoke: process.env.FOCUS_MEMO_SMOKE === '1',
  setMode: (mode) => ipcRenderer.invoke('window:set-mode', mode),
  showQuickCapture: () => ipcRenderer.invoke('window:quick-capture'),
  onQuickCapture: (callback) => {
    const handler = () => callback();
    ipcRenderer.on('quick-capture:open', handler);
    return () => ipcRenderer.removeListener('quick-capture:open', handler);
  },
  minimize: () => ipcRenderer.invoke('window:minimize'),
  close: () => ipcRenderer.invoke('window:close'),
  loadState: () => ipcRenderer.invoke('state:load'),
  saveState: (state, options) => ipcRenderer.invoke('state:save', state, options),
  openFocusWorkbook: (state) => ipcRenderer.invoke('excel:open-focus-workbook', state)
});
