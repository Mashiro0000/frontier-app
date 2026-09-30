import { resolve } from 'path'
import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'

// What the installed Electron actually runs. electron-vite 5.0.0 only knows Electron up to 39; for a
// newer one it silently falls back to its OLDEST targets (Node 16.17, Chrome 108). Set these by hand
// and update them whenever Electron is upgraded. Read the real values from the Electron binary:
//   ELECTRON_RUN_AS_NODE=1 node_modules/electron/dist/electron.exe -e "console.log(process.versions)"
// Electron 44.5.1 = Node 24.21.0, Chromium 152.
const NODE_TARGET = 'node24.21'
const CHROME_TARGET = 'chrome152'

export default defineConfig({
  main: { build: { target: NODE_TARGET } },
  preload: { build: { target: NODE_TARGET } },
  renderer: {
    build: { target: CHROME_TARGET },
    resolve: {
      alias: {
        '@renderer': resolve('src/renderer/src')
      }
    },
    plugins: [react()]
  }
})
