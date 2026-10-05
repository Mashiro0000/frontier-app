// Helpers for the Stage 8b.3 / 8b.4 window suites (verify-8b3-w.mjs and its restarts). Test tooling only.
import './ts-resolve.mjs'
import { connect, checker, sleep } from './cdp.mjs'
import { assertScratchProfile } from './profile-guard.mjs'
import { h4, mainInspector } from './lib4.mjs'
import { createHash } from 'node:crypto'
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

export const sha = (buffer) => createHash('sha256').update(buffer).digest('hex').slice(0, 16)
export const ENVELOPE_FORMAT = 'frontier-chat-encrypted'
export const UUID_JSON = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.json$/

/** Connects to the running app and returns everything a suite needs: the page, its helpers, the main inspector, and where things are. */
export async function start() {
  const shots = process.argv[2]
  const port = Number(process.argv[3] ?? 9222)
  const userData = process.env.USER_DATA_DIR
  const FILES = process.env.FILES_DIR
  const inspectPort = Number(process.env.INSPECT_PORT)
  const mockPort = process.env.MOCK_PORT
  if (!userData || !FILES || !inspectPort) throw new Error('USER_DATA_DIR, FILES_DIR and INSPECT_PORT must be set')
  const check = checker()
  const page = await connect(port)
  await assertScratchProfile()
  const H = h4(page, { userData, mockUrl: mockPort ? `http://127.0.0.1:${mockPort}` : undefined })
  const main = await mainInspector(inspectPort)
  const convDir = join(userData, 'conversations')
  const settingFile = join(userData, 'chat-encryption.json')
  const ev = H.ev
  const W = {
    shots, page, H, ev, main, check, userData, FILES, convDir, settingFile, sleep,
    /** The names of the saved chat files, and a checksum of each; and of the setting, if there is one. */
    folder: () => {
      const names = existsSync(convDir) ? readdirSync(convDir).sort() : []
      return {
        files: Object.fromEntries(names.map((n) => [n, sha(readFileSync(join(convDir, n)))])),
        setting: existsSync(settingFile) ? sha(readFileSync(settingFile)) : null
      }
    },
    chatFiles: () => (existsSync(convDir) ? readdirSync(convDir).filter((n) => UUID_JSON.test(n)).sort() : []),
    strays: () => (existsSync(convDir) ? readdirSync(convDir).filter((n) => !UUID_JSON.test(n)) : []),
    text: (name) => readFileSync(join(convDir, name), 'utf8'),
    isEnvelope: (name) => { try { return JSON.parse(readFileSync(join(convDir, name), 'utf8')).format === ENVELOPE_FORMAT } catch { return false } },
    saveState: (name, value) => writeFileSync(join(FILES, name), JSON.stringify(value, null, 1)),
    loadState: (name) => JSON.parse(readFileSync(join(FILES, name), 'utf8')),
    /** Settings: open, wait until the "Saved chats" section has looked at the chats, read it, close. */
    openSettings: async () => {
      await page.click('.header-button@Settings')
      await page.waitFor(`!!document.querySelector('dialog.settings')?.open`)
      await page.waitFor(`(() => { const s = document.getElementById('settings-storage-heading')?.closest('section')?.querySelector('.settings-status'); return !!s && s.innerText !== 'Checking...' })()`, { timeoutMs: 15000, label: 'the Saved chats section to look at the chats' })
      await sleep(80)
    },
    closeSettings: async () => { await page.press('Escape'); await page.waitFor(`!document.querySelector('dialog.settings')?.open`, { timeoutMs: 4000 }); await sleep(120) },
    section: () => ev(`(() => { const h = document.getElementById('settings-storage-heading'); const s = h?.closest('section'); if (!s) return null; return { text: s.innerText, line: s.querySelector('.settings-status')?.innerText ?? '', buttons: [...s.querySelectorAll('button')].map((b) => ({ text: b.textContent.trim(), disabled: b.disabled })), alerts: [...s.querySelectorAll('[role=alert]')].map((e) => e.innerText), notes: [...s.querySelectorAll('[role=status]')].map((e) => e.innerText) } })()`),
    clickSection: async (text) => { await ev(`(() => { const s = document.getElementById('settings-storage-heading').closest('section'); [...s.querySelectorAll('button')].find((b) => b.textContent.trim() === ${JSON.stringify(text)})?.scrollIntoView({ block: 'center' }) })()`); await sleep(80); await page.click(`#settings-storage-heading ~ .settings-actions button@${text}`) },
    waitNote: (re) => page.waitFor(`(() => { const s = document.getElementById('settings-storage-heading').closest('section'); return [...s.querySelectorAll('[role=status],[role=alert]')].some((e) => ${re}.test(e.innerText)) })()`, { timeoutMs: 30000, label: `a notice like ${re}` }),
    historyRows: () => ev(`[...document.querySelectorAll('dialog.history .history-row .history-title')].map((e) => e.textContent)`),
    storage: () => ev(`window.api.history.storage()`),
    badge: (text) => ev(`[...document.querySelectorAll('.app-badge')].find((b) => b.textContent === ${JSON.stringify(text)}) ? { title: [...document.querySelectorAll('.app-badge')].find((b) => b.textContent === ${JSON.stringify(text)}).title } : null`)
  }
  /** The system's dialogs, played from here: a queue of answers per kind; every ask is recorded, with what the profile looked like at the moment it was asked. */
  W.installDialogs = async () => {
    await main.inMain(`(() => {
      const { dialog } = process.mainModule.require('electron')
      const fs = process.mainModule.require('fs')
      const path = process.mainModule.require('path')
      const convDir = ${JSON.stringify(convDir)}
      const settingFile = ${JSON.stringify(settingFile)}
      globalThis.__picks = { save: [], open: [], box: [], calls: [], hold: null, release: null }
      const at = () => {
        let names = []
        try { names = fs.readdirSync(convDir) } catch (e) { names = [] }
        const chat = names.filter((n) => /^[0-9a-f-]{36}[.]json$/.test(n))
        return { settingThere: fs.existsSync(settingFile), chatFiles: chat.length, plain: chat.filter((n) => fs.readFileSync(path.join(convDir, n), 'utf8').startsWith('{"version":3,')).length, tmp: names.filter((n) => n.endsWith('.tmp')).length }
      }
      const answer = async (kind, args) => {
        const p = globalThis.__picks
        p.calls.push({ kind, withWindow: args.length > 1, options: args[args.length - 1], at: at() })
        if (p.hold) await p.hold
        const next = p[kind].shift()
        if (kind === 'box') return { response: next === undefined ? 1 : next, checkboxChecked: false }
        if (next === undefined || next === null) return kind === 'save' ? { canceled: true } : { canceled: true, filePaths: [] }
        return kind === 'save' ? { canceled: false, filePath: next } : { canceled: false, filePaths: [next] }
      }
      dialog.showSaveDialog = (...args) => answer('save', args)
      dialog.showOpenDialog = (...args) => answer('open', args)
      dialog.showMessageBox = (...args) => answer('box', args)
      return true
    })()`)
    return {
      queue: (kind, value) => main.inMain(`globalThis.__picks.${kind}.push(${JSON.stringify(value)}); true`),
      calls: async () => JSON.parse(await main.inMain('JSON.stringify(globalThis.__picks.calls)')),
      reset: () => main.inMain('globalThis.__picks.calls.length = 0; true'),
      hold: () => main.inMain(`(() => { const p = globalThis.__picks; p.hold = new Promise((r) => { p.release = r }); return true })()`),
      release: () => main.inMain(`(() => { const p = globalThis.__picks; const r = p.release; p.hold = null; r(); return true })()`)
    }
  }
  return W
}
