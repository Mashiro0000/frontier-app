import { contextBridge, ipcRenderer } from 'electron'
import { REVIEW_CHANNELS, type ChangeActionResult, type ReviewModel } from '../shared/changes'

// The preload of the Review window (Stage 12.5, D-042): the window main opens to show a proposed change. It is a different preload from the chat page's, so the chat
// page's `window.api` does not exist here and this `window.review` does not exist there. The window is sandboxed (as the chat page is): this file may only require
// 'electron'. It gives the page six things and no way to name a file, a path or a channel: the change it shows (main knows which), "the whole difference was
// scrolled to its end", "ask to apply", "drop it", "close", and a notice that another change is to be shown. Main answers only the window it opened.
contextBridge.exposeInMainWorld('review', {
  get: (): Promise<ReviewModel | null> => ipcRenderer.invoke(REVIEW_CHANNELS.get),
  reachedEnd: (): Promise<boolean> => ipcRenderer.invoke(REVIEW_CHANNELS.reachedEnd),
  apply: (): Promise<ChangeActionResult> => ipcRenderer.invoke(REVIEW_CHANNELS.apply),
  drop: (): Promise<boolean> => ipcRenderer.invoke(REVIEW_CHANNELS.drop),
  close: (): Promise<void> => ipcRenderer.invoke(REVIEW_CHANNELS.close),
  onChanged: (listener: () => void): void => {
    ipcRenderer.on(REVIEW_CHANNELS.changed, () => listener())
  }
})
