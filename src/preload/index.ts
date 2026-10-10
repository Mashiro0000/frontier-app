import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import { CHANNELS, type ChatStreamEvent, type FrontierApi } from '../shared/ipc'

// The window is sandboxed (D-004), so this file may only require 'electron' (contextBridge,
// ipcRenderer, ...), 'events', 'timers' and 'url'. It cannot require npm packages or other files at
// run time; the build tool bundles any file this one imports (the shared contract is one). Keep it
// that way, or the preload fails to load and the page silently gets no `window.api`.
//
// Everything listed in `api` is everything the page can ever ask the main process for. Each function
// sends one named message; the page never gets Electron's `ipcRenderer` itself, which would let any
// script in the page call any channel.
const api: FrontierApi = {
  settings: {
    getStatus: () => ipcRenderer.invoke(CHANNELS.settingsStatus),
    setApiKey: (provider, key) => ipcRenderer.invoke(CHANNELS.settingsSetApiKey, { provider, key }),
    clearApiKey: (provider) => ipcRenderer.invoke(CHANNELS.settingsClearApiKey, provider),
    testApiKey: (provider) => ipcRenderer.invoke(CHANNELS.settingsTestApiKey, provider),
    setModel: (modelId) => ipcRenderer.invoke(CHANNELS.settingsSetModel, modelId),
    setEffort: (modelId, level) =>
      ipcRenderer.invoke(CHANNELS.settingsSetEffort, { modelId, level }),
    setLimits: (choice) => ipcRenderer.invoke(CHANNELS.settingsSetLimits, choice),
    setAskFirst: (choice) => ipcRenderer.invoke(CHANNELS.settingsSetAskFirst, choice)
  },
  chat: {
    start: (request) => ipcRenderer.send(CHANNELS.chatStart, request),
    cancel: (streamId) => ipcRenderer.send(CHANNELS.chatCancel, streamId),
    confirm: (streamId) => ipcRenderer.send(CHANNELS.chatConfirm, streamId),
    onEvent: (listener) => {
      // Hand the page only the event's data, not Electron's event object around it.
      const handler = (_event: IpcRendererEvent, reply: ChatStreamEvent): void => listener(reply)
      ipcRenderer.on(CHANNELS.chatEvent, handler)
      return () => {
        ipcRenderer.removeListener(CHANNELS.chatEvent, handler)
      }
    }
  },
  usage: {
    summary: (conversationId) => ipcRenderer.invoke(CHANNELS.usageSummary, conversationId)
  },
  history: {
    list: () => ipcRenderer.invoke(CHANNELS.historyList),
    load: (id) => ipcRenderer.invoke(CHANNELS.historyLoad, id),
    save: (conversation) => ipcRenderer.invoke(CHANNELS.historySave, conversation),
    remove: (id) => ipcRenderer.invoke(CHANNELS.historyRemove, id),
    exportChats: (request) => ipcRenderer.invoke(CHANNELS.historyExport, request),
    restoreLook: () => ipcRenderer.invoke(CHANNELS.historyRestoreLook),
    restoreApply: (token) => ipcRenderer.invoke(CHANNELS.historyRestoreApply, token),
    restoreCancel: (token) => ipcRenderer.send(CHANNELS.historyRestoreCancel, token),
    storage: () => ipcRenderer.invoke(CHANNELS.historyStorage),
    encryptChats: () => ipcRenderer.invoke(CHANNELS.historyEncrypt),
    decryptChats: () => ipcRenderer.invoke(CHANNELS.historyDecrypt)
  },
  attachments: {
    pick: () => ipcRenderer.invoke(CHANNELS.attachmentsPick),
    addBytes: (name, bytes) => ipcRenderer.invoke(CHANNELS.attachmentsAddBytes, { name, bytes }),
    discard: (id) => ipcRenderer.send(CHANNELS.attachmentsDiscard, id),
    describe: (ids) => ipcRenderer.invoke(CHANNELS.attachmentsDescribe, ids)
  },
  instructions: {
    getEveryChat: () => ipcRenderer.invoke(CHANNELS.instructionsGetEveryChat),
    setEveryChat: (text, saveAnyway) =>
      ipcRenderer.invoke(CHANNELS.instructionsSetEveryChat, { text, saveAnyway }),
    checkForChat: (text, saveAnyway) =>
      ipcRenderer.invoke(CHANNELS.instructionsCheckForChat, { text, saveAnyway })
  },
  memory: {
    status: () => ipcRenderer.invoke(CHANNELS.memoryStatus),
    add: (text, scope, saveAnyway) =>
      ipcRenderer.invoke(CHANNELS.memoryAdd, { text, scope, saveAnyway }),
    edit: (id, text, saveAnyway) =>
      ipcRenderer.invoke(CHANNELS.memoryEdit, { id, text, saveAnyway }),
    remove: (id) => ipcRenderer.invoke(CHANNELS.memoryRemove, { id }),
    removeAll: () => ipcRenderer.invoke(CHANNELS.memoryRemoveAll),
    setOn: (on) => ipcRenderer.invoke(CHANNELS.memorySetOn, on),
    exportAll: () => ipcRenderer.invoke(CHANNELS.memoryExport)
  },
  audit: {
    read: () => ipcRenderer.invoke(CHANNELS.auditRead),
    exportAll: () => ipcRenderer.invoke(CHANNELS.auditExport),
    deleteAll: () => ipcRenderer.invoke(CHANNELS.auditDeleteAll)
  },
  tools: {
    status: () => ipcRenderer.invoke(CHANNELS.toolsStatus),
    setEnabled: (tool, on) => ipcRenderer.invoke(CHANNELS.toolsSetEnabled, { tool, on }),
    setCaps: (caps) => ipcRenderer.invoke(CHANNELS.toolsSetCaps, caps),
    reset: () => ipcRenderer.invoke(CHANNELS.toolsReset)
  },
  workspace: {
    status: () => ipcRenderer.invoke(CHANNELS.workspaceStatus),
    choose: () => ipcRenderer.invoke(CHANNELS.workspaceChoose),
    clear: () => ipcRenderer.invoke(CHANNELS.workspaceClear),
    setOn: (on) => ipcRenderer.invoke(CHANNELS.workspaceSetOn, { on })
  },
  programs: {
    status: () => ipcRenderer.invoke(CHANNELS.programsStatus),
    setOn: (on) => ipcRenderer.invoke(CHANNELS.programsSetOn, { on }),
    stopTest: () => ipcRenderer.invoke(CHANNELS.programsStopTest)
  },
  changes: {
    list: () => ipcRenderer.invoke(CHANNELS.changesList),
    review: (id) => ipcRenderer.invoke(CHANNELS.changesReview, { id }),
    applied: () => ipcRenderer.invoke(CHANNELS.changesApplied),
    undo: (id) => ipcRenderer.invoke(CHANNELS.changesUndo, { id }),
    clearHistory: () => ipcRenderer.invoke(CHANNELS.changesClearUndo)
  },
  projects: {
    status: () => ipcRenderer.invoke(CHANNELS.projectsStatus),
    create: (name) => ipcRenderer.invoke(CHANNELS.projectsCreate, { name }),
    rename: (id, name) => ipcRenderer.invoke(CHANNELS.projectsRename, { id, name }),
    setInstructions: (id, text, saveAnyway) =>
      ipcRenderer.invoke(CHANNELS.projectsSetInstructions, { id, text, saveAnyway }),
    addFiles: (id) => ipcRenderer.invoke(CHANNELS.projectsAddFiles, { id }),
    removeFile: (id, fileId) => ipcRenderer.invoke(CHANNELS.projectsRemoveFile, { id, fileId }),
    remove: (id) => ipcRenderer.invoke(CHANNELS.projectsRemove, { id }),
    removeAll: () => ipcRenderer.invoke(CHANNELS.projectsRemoveAll)
  }
}

contextBridge.exposeInMainWorld('api', api)
