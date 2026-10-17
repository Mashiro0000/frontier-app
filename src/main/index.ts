// First, so the data folder is pinned before any other module can read it (18.1).
import './dataFolder'
import { app, shell, session, BrowserWindow } from 'electron'
import { join } from 'path'
import { pathToFileURL } from 'url'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import icon from '../../resources/icon.png?asset'
import { registerIpc } from './ipc'
import { isAppUrl, isSafeExternalUrl } from './security'
import { installPermissionHandlers } from './voicePermissions'
import { microphoneGate, showMicrophoneState } from './voiceWindow'

// The app's own page: the Vite dev server while developing, otherwise the built file. Kept at module
// level because the message handlers are registered once, while a window can be created again.
const devUrl = is.dev ? process.env['ELECTRON_RENDERER_URL'] : undefined
const pageFile = join(__dirname, '../renderer/index.html')
const appUrl = devUrl ?? pathToFileURL(pageFile).href

// Set when the message handlers are registered: resolves once every conversation save in progress is on disk.
let savesDone: () => Promise<void> = async () => undefined
// Quitting does not wait longer than this for them, so a stuck disk can never keep the app from closing.
const SAVE_GRACE_MS = 5000

// The chat window's page, for the permission rules (15.4): only a request from THIS page can be answered yes.
let chatWindow: BrowserWindow | null = null

function createWindow(): void {
  // Create the browser window.
  const mainWindow = new BrowserWindow({
    width: 900,
    height: 670,
    show: false,
    title: 'Frontier App',
    autoHideMenuBar: true,
    ...(process.platform === 'linux' ? { icon } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      // D-004: the page runs sandboxed, cut off from the preload's world, with no Node.js. These are
      // also Electron's defaults; they are written out so nobody switches one off by accident. A
      // sandboxed preload may only require 'electron', 'events', 'timers' and 'url' (see preload).
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  chatWindow = mainWindow
  mainWindow.on('closed', () => {
    if (chatWindow === mainWindow) chatWindow = null
  })
  // The title says when the microphone is on, and the page cannot change it (15.4, D-047).
  showMicrophoneState(mainWindow)

  mainWindow.on('ready-to-show', () => {
    mainWindow.show()
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    // Only web links go to the browser. Anything else (file:, ms-msdt:, ...) could start a program.
    if (isSafeExternalUrl(details.url)) shell.openExternal(details.url)
    return { action: 'deny' }
  })

  // The window never leaves the app's own page. The preload's API is reachable from whatever page
  // is loaded in this window, so a navigation away would hand that API to another site.
  mainWindow.webContents.on('will-frame-navigate', (event) => {
    if (!isAppUrl(event.url, appUrl)) event.preventDefault()
  })

  // HMR for renderer base on electron-vite cli.
  // Load the remote URL for development or the local html file for production.
  if (devUrl) {
    mainWindow.loadURL(devUrl)
  } else {
    mainWindow.loadFile(pageFile)
  }
}

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.
app.whenReady().then(() => {
  // Set app user model id for windows
  electronApp.setAppUserModelId('com.frontier.app')

  // Default open or close DevTools by F12 in development
  // and ignore CommandOrControl + R in production.
  // see https://github.com/alex8088/electron-toolkit/tree/master/packages/utils
  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  // Until 15.4 the window had no permission handler, and Electron then says yes to every request the page makes: from here the answer is no unless a rule says yes.
  installPermissionHandlers(
    session.defaultSession,
    appUrl,
    microphoneGate,
    () => chatWindow?.webContents ?? null
  )
  savesDone = registerIpc(appUrl)
  createWindow()

  app.on('activate', function () {
    // On macOS it's common to re-create a window in the app when the
    // dock icon is clicked and there are no other windows open.
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

// Quit when all windows are closed, except on macOS. There, it's common
// for applications and their menu bar to stay active until the user quits
// explicitly with Cmd + Q.
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

// Closing the window ends the app, and a conversation being written at that moment must not be cut off
// halfway (D-016): hold the quit until the saves in progress have finished, then quit for real.
let savesFlushed = false
app.on('before-quit', (event) => {
  if (savesFlushed) return
  event.preventDefault()
  savesFlushed = true
  const grace = new Promise<void>((resolve) => setTimeout(resolve, SAVE_GRACE_MS))
  void Promise.race([savesDone(), grace]).finally(() => app.quit())
})

// In this file you can include the rest of your app's specific main process
// code. You can also put them in separate files and require them here.
