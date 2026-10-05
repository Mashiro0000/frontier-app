import { app, BrowserWindow, dialog } from 'electron'
import { join } from 'path'
import type { Pickers } from './backupService'

// The system's own save and open dialogs for backups (D-034). The person decides where a backup goes and which file is read, in a window that
// the operating system draws and the page cannot reach, so the page never supplies a path. `dialog` is looked up each time it is used (not
// copied at start), so a test can stand in for the person from the main process's inspector, as the tests do for `shell.openExternal`.

const BACKUP_FILTER = { name: 'Frontier chat backup', extensions: ['jsonl'] }
const ANY_FILTER = { name: 'All files', extensions: ['*'] }

const windowOf = (owner: unknown): BrowserWindow | undefined =>
  owner instanceof BrowserWindow ? owner : undefined

export const systemPickers: Pickers = {
  savePath: async (owner, suggestedName) => {
    const options = {
      title: 'Back up chats',
      defaultPath: join(app.getPath('documents'), suggestedName),
      filters: [BACKUP_FILTER],
      properties: ['showOverwriteConfirmation' as const]
    }
    const window = windowOf(owner)
    const result = window
      ? await dialog.showSaveDialog(window, options)
      : await dialog.showSaveDialog(options)
    return result.canceled || !result.filePath ? null : result.filePath
  },

  openPath: async (owner) => {
    const options = {
      title: 'Restore chats from a backup',
      defaultPath: app.getPath('documents'),
      filters: [BACKUP_FILTER, ANY_FILTER],
      properties: ['openFile' as const]
    }
    const window = windowOf(owner)
    const result = window
      ? await dialog.showOpenDialog(window, options)
      : await dialog.showOpenDialog(options)
    return result.canceled || result.filePaths.length === 0 ? null : result.filePaths[0]
  }
}
