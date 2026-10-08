import { randomBytes } from 'crypto'
import { app, BrowserWindow, ipcMain, session, type IpcMainInvokeEvent } from 'electron'
import { join } from 'path'
import { REVIEW_CHANNELS, type ChangeActionResult, type ReviewModel } from '../shared/changes'
import { reviewHtml } from './reviewPage'
import type { ChangesService } from './reviewService'

// The Review window (Stage 12.5, D-042): a window of its own that main opens to show ONE proposed change whole, which the chat page cannot script, read or click.
// It is made like the chat window (sandboxed, no Node, context isolated) and shut tighter: its own preload (so that the chat page's `window.api` is not in it), a
// session of its own that allows no permission and cancels every request that is not its own `data:` page, no navigation, no new window, no webview. Main
// answers its six messages only when they come from THAT window's top frame (`isReviewSender`): the chat page has no way to send them (its bridge has no such
// function and the preload that has one is not loaded there) and a frame inside any page cannot either. What it shows came from a model that may have read a
// hostile file: main made every text visible first (reviewModel.ts) and the page draws it with `textContent` (reviewPage.ts).

const PARTITION = 'frontier-review'

/** The part of an Electron IPC event that the check reads (a plain shape, so that it is checked under plain Node with played events). */
export interface ReviewSenderEvent {
  sender: unknown
  senderFrame: { url: string } | null
}

/**
 * True only for a message from the Review window's own top frame, loaded from the `data:` page main made: the window's web contents, its main frame, and an
 * address that starts with `data:text/html`. Anything else (the chat page, a frame, a page that navigated away) is not it.
 */
export function isReviewSender(
  event: ReviewSenderEvent & { sender: { mainFrame?: unknown } },
  reviewContents: unknown
): boolean {
  if (reviewContents === null || reviewContents === undefined) return false
  const frame = event.senderFrame
  return (
    event.sender === reviewContents &&
    frame !== null &&
    frame === event.sender.mainFrame &&
    frame.url.startsWith('data:text/html')
  )
}

export interface ReviewWindows {
  /** Shows the change `id` in the Review window (made if it is not open; brought to the front if it is). `owner` is the chat window that asked. */
  open(id: unknown, owner: BrowserWindow | null): Promise<ChangeActionResult>
  /** Closes it, if it is open (the app is quitting, or the change was dropped elsewhere). */
  close(): void
  /** Tells an open window that its change may have changed (it asks main again). */
  refresh(): void
}

export interface ReviewWindowsOptions {
  service: ChangesService
}

export function createReviewWindows(options: ReviewWindowsOptions): ReviewWindows {
  const { service } = options
  let win: BrowserWindow | null = null
  let current: string | null = null

  const contents = (): Electron.WebContents | null =>
    win !== null && !win.isDestroyed() ? win.webContents : null

  /** Every message from the window passes this: a message from anything else is refused with an error and does nothing. */
  const only =
    <A extends unknown[], R>(handler: (event: IpcMainInvokeEvent, ...args: A) => Promise<R> | R) =>
    (event: IpcMainInvokeEvent, ...args: A): Promise<R> => {
      if (!isReviewSender(event, contents())) {
        throw new Error('Blocked: this call did not come from the Review window.')
      }
      return Promise.resolve(handler(event, ...args))
    }

  ipcMain.handle(
    REVIEW_CHANNELS.get,
    only(async (): Promise<ReviewModel | null> => service.model(current))
  )
  ipcMain.handle(
    REVIEW_CHANNELS.reachedEnd,
    only(async (): Promise<boolean> => service.markReachedEnd(current))
  )
  ipcMain.handle(
    REVIEW_CHANNELS.apply,
    only(async (): Promise<ChangeActionResult> => service.apply(current, win))
  )
  ipcMain.handle(
    REVIEW_CHANNELS.drop,
    only(async (): Promise<boolean> => {
      const dropped = service.drop(current)
      return dropped
    })
  )
  ipcMain.handle(
    REVIEW_CHANNELS.close,
    only(async (): Promise<void> => {
      win?.close()
    })
  )

  function make(owner: BrowserWindow | null): BrowserWindow {
    const ses = session.fromPartition(PARTITION) // in memory: nothing of this window is kept
    ses.setPermissionRequestHandler((_contents, _permission, callback) => callback(false))
    ses.setPermissionCheckHandler(() => false)
    ses.webRequest.onBeforeRequest((details, callback) => {
      callback({ cancel: !details.url.startsWith('data:') && !details.url.startsWith('devtools:') })
    })
    const window = new BrowserWindow({
      width: 1000,
      height: 760,
      minWidth: 360,
      minHeight: 360,
      show: false,
      autoHideMenuBar: true,
      title: 'Review a change',
      ...(owner !== null && !owner.isDestroyed() ? { parent: owner } : {}),
      webPreferences: {
        preload: join(__dirname, '../preload/review.js'),
        partition: PARTITION,
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        webSecurity: true,
        allowRunningInsecureContent: false,
        spellcheck: false,
        // The tools of the browser are for developing the app; a packaged app has none, so a page cannot be opened up and changed by hand.
        devTools: !app.isPackaged
      }
    })
    window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
    window.webContents.on('will-navigate', (event) => event.preventDefault())
    window.webContents.on('will-redirect', (event) => event.preventDefault())
    window.webContents.on('will-attach-webview', (event) => event.preventDefault())
    window.once('ready-to-show', () => window.show())
    window.on('closed', () => {
      if (win === window) {
        win = null
        current = null
      }
    })
    const nonce = randomBytes(18).toString('base64url')
    void window.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(reviewHtml(nonce))}`)
    return window
  }

  return {
    open: async (id, owner) => {
      if (typeof id !== 'string' || (await service.model(id)) === null) {
        return { ok: false, error: 'That change is not there any more.' }
      }
      current = id
      if (win !== null && !win.isDestroyed()) {
        win.webContents.send(REVIEW_CHANNELS.changed)
        if (win.isMinimized()) win.restore()
        win.focus()
      } else {
        win = make(owner)
      }
      return { ok: true }
    },
    close: () => {
      if (win !== null && !win.isDestroyed()) win.close()
    },
    refresh: () => {
      const web = contents()
      if (web !== null) web.send(REVIEW_CHANNELS.changed)
    }
  }
}
