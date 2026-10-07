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
  }
}

contextBridge.exposeInMainWorld('api', api)
