const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("macroStudio", {
  getRunShortcut: () => ipcRenderer.invoke("get-run-shortcut"),
  setRunShortcut: (shortcut) => ipcRenderer.invoke("set-run-shortcut", shortcut),
  runMacros: (scripts) => ipcRenderer.invoke("run-macros", scripts),
  stopMacro: () => ipcRenderer.invoke("stop-macro"),
  toggleMacroPaused: () => ipcRenderer.invoke("toggle-macro-paused"),
  getExecutionLogPath: () => ipcRenderer.invoke("get-execution-log-path"),
  openExecutionLog: () => ipcRenderer.invoke("open-execution-log"),
  getCursorPosition: () => ipcRenderer.invoke("get-cursor-position"),
  getForegroundApp: () => ipcRenderer.invoke("get-foreground-app"),
  getOpenApps: () => ipcRenderer.invoke("get-open-apps"),
  getPrimaryDisplay: () => ipcRenderer.invoke("get-primary-display"),
  getCursorColor: () => ipcRenderer.invoke("get-cursor-color"),
  loadMacroState: () => ipcRenderer.invoke("load-macro-state"),
  saveMacroState: (state) => ipcRenderer.invoke("save-macro-state", state),
  getAiConfig: (provider) => ipcRenderer.invoke("get-ai-config", provider),
  getAiProviders: () => ipcRenderer.invoke("get-ai-providers"),
  setAiConfig: (config) => ipcRenderer.invoke("set-ai-config", config),
  generateBlocksWithAi: (prompt, includeScreen, provider) => ipcRenderer.invoke("generate-blocks-with-ai", prompt, includeScreen, provider),
  onRunShortcut: (callback) => ipcRenderer.on("run-shortcut", callback),
  onPauseShortcut: (callback) => ipcRenderer.on("pause-shortcut", callback),
  onUpdateStatus: (callback) => ipcRenderer.on("update-status", (_event, payload) => callback(payload)),
  quitAndInstallUpdate: () => ipcRenderer.invoke("quit-and-install-update")
});