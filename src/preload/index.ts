import { contextBridge } from 'electron'

// The window is sandboxed (D-004), so this file may only require 'electron' (contextBridge,
// ipcRenderer, ...), 'events', 'timers' and 'url'. It cannot require npm packages or other files at
// run time; the build tool bundles any file this one imports. Keep it that way, or the preload fails
// to load and the page silently gets no `window.api`.
//
// Everything listed in `api` is everything the page can ever ask the main process for. The scaffold
// also exposed Electron's whole `ipcRenderer` as `window.electron`, which would let any script in
// the page call any channel, including the ones that will hold the API key. It is gone.
const api = {}

contextBridge.exposeInMainWorld('api', api)
