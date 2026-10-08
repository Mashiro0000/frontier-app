import { app, BrowserWindow, dialog } from 'electron'
import { join } from 'path'
import type { PickPaths } from './attachmentService'
import type { Pickers } from './backupService'
import { plainQuestion, type Askers } from './chatEncryptionService'
import type { AskPerson } from './systemQuestion'

// The system's own dialogs for backups and for how chats are kept (D-034, D-035): the save and open dialogs for a backup, and the message box that asks
// before the chats are turned back into plain files; since Stage 9.2 (D-037), the open dialog for attaching files; and since Stage 10.1 (D-039), the
// message box that asks before any change that lets the app spend more (`askPerson`, since 10.2 also before text that goes out with every message),
// and since 10.4 the save dialog for exporting the notes (`pickNotesExportPath`). The person decides in a window
// that the operating system draws and the page cannot reach, so the page never supplies a path and never answers the question. This is the only file that opens a dialog. `dialog` is looked up each time it is used
// (not copied at start), so a test can stand in for the person from the main process's inspector, as the tests do for `shell.openExternal`.

const BACKUP_FILTER = { name: 'Frontier chat backup', extensions: ['jsonl'] }
const ANY_FILTER = { name: 'All files', extensions: ['*'] }

const windowOf = (owner: unknown): BrowserWindow | undefined =>
  owner instanceof BrowserWindow ? owner : undefined

export const systemPickers: Pickers = {
  savePath: async (owner, suggestedName, title = 'Back up chats') => {
    const options = {
      title,
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

const NOTES_FILTER = { name: 'Text file', extensions: ['txt'] }

/** The system's save dialog for "Export all..." on the Memory page (D-039): the person places the plain text file of their notes; null if they close it. */
export const pickNotesExportPath = async (
  owner: unknown,
  suggestedName: string
): Promise<string | null> => {
  const options = {
    title: 'Export your notes',
    defaultPath: join(app.getPath('documents'), suggestedName),
    filters: [NOTES_FILTER],
    properties: ['showOverwriteConfirmation' as const]
  }
  const window = windowOf(owner)
  const result = window
    ? await dialog.showSaveDialog(window, options)
    : await dialog.showSaveDialog(options)
  return result.canceled || !result.filePath ? null : result.filePath
}

export const systemAskers: Askers = {
  confirmPlain: async (owner, facts) => {
    const { title, message, detail } = plainQuestion(facts)
    const options = {
      type: 'warning' as const,
      title,
      message,
      detail,
      buttons: [
        facts.keyUsable ? 'Go back to plain files' : 'Turn encryption off',
        'Keep encryption'
      ],
      defaultId: 1, // the safe answer has the focus, and Escape is the same answer
      cancelId: 1,
      noLink: true
    }
    const window = windowOf(owner)
    const result = window
      ? await dialog.showMessageBox(window, options)
      : await dialog.showMessageBox(options)
    return result.response === 0
  }
}

/**
 * A yes-or-no question in the system's own message box, for the window that asked (D-039; the rules are in systemQuestion.ts). The yes button names
 * the change and is never the default: "no" has the focus, and Escape or closing the box gives the same answer, so only a deliberate click on yes says
 * yes. The page cannot reach the box: it is drawn by the operating system, modal to the app's window.
 */
export const askPerson: AskPerson = async (owner, question) => {
  const options = {
    type: 'warning' as const,
    title: question.title,
    message: question.message,
    detail: question.detail,
    buttons: [question.yes, question.no],
    defaultId: 1,
    cancelId: 1,
    noLink: true
  }
  const window = windowOf(owner)
  const result = window
    ? await dialog.showMessageBox(window, options)
    : await dialog.showMessageBox(options)
  return result.response === 0
}

/**
 * The open dialog for "Attach..." (D-037): one or more files, for the window that asked. What the person chooses goes to main only; the page learns the
 * names of the files that were kept. ONE filter, "All files": a text file can have any extension (what a file is, is decided by its bytes). With "All
 * files" first and "Images" second, the real Windows dialog opened on "Images" (which hid every PDF and text file), most likely because Windows reuses the
 * filter position of an earlier dialog of this program (not proven). With one filter there is no other position to land on.
 */
export const pickAttachmentPaths: PickPaths = async (owner) => {
  const options = {
    title: 'Attach files',
    filters: [ANY_FILTER],
    properties: ['openFile' as const, 'multiSelections' as const]
  }
  const window = windowOf(owner)
  const result = window
    ? await dialog.showOpenDialog(window, options)
    : await dialog.showOpenDialog(options)
  return result.canceled || result.filePaths.length === 0 ? null : result.filePaths
}
