// Shared helpers for the Stage 3 window suites (test harness; lives outside the project on purpose).
import { REPO } from './paths.mjs'
import { readFileSync, existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { sleep } from './cdp.mjs'

export const REGISTRY_PATH = `${REPO}/registry/models.json`
export const readRegistry = () => JSON.parse(readFileSync(REGISTRY_PATH, 'utf8'))
export const sha = (text) => createHash('sha256').update(text ?? '').digest('hex').slice(0, 16)

/** Helpers bound to one page (and optionally one scratch profile and one mock server). */
export function helpers(page, { userData, mockUrl } = {}) {
  const ev = (expr) => page.evaluate(expr)
  const prefFile = userData ? join(userData, 'preferences.json') : null
  const h = {
    ev,
    prefFile,
    /** The raw text of preferences.json in the scratch profile, or null if there is none. */
    prefs: () => (prefFile && existsSync(prefFile) ? readFileSync(prefFile, 'utf8') : null),
    /**
     * Any leftover file named after OUR preferences file (a temp copy, a backup...). Only that name counts:
     * Chromium keeps its own 'Preferences' beside ours and saves it through 'Preferences~RF<hex>.TMP', which
     * a looser match caught once, by timing.
     */
    strayFiles: () => (userData ? readdirSync(userData).filter((n) => n.toLowerCase().startsWith('preferences.json') && n.toLowerCase() !== 'preferences.json') : []),
    menu: () =>
      ev(`(() => {
        const s = document.querySelector('.header-select')
        if (!s) return null
        return { values: [...s.options].map((o) => o.value), labels: [...s.options].map((o) => o.textContent), value: s.value, label: s.selectedOptions[0]?.textContent ?? null, disabled: s.disabled, title: s.title, aria: s.getAttribute('aria-label') }
      })()`),
    status: () => ev(`window.api.settings.getStatus()`),
    /** Changes the menu the way a script can: set the value, fire a bubbling change event. */
    chooseInPage: (id) => ev(`(() => { const s = document.querySelector('.header-select'); s.value = ${JSON.stringify(id)}; s.dispatchEvent(new Event('change', { bubbles: true })); return s.value })()`),
    /** Waits until main reports `id` as the selected model (and the menu shows it). */
    settle: async (id, timeoutMs = 6000) => {
      const t0 = Date.now()
      while (Date.now() - t0 < timeoutMs) {
        const [status, menu] = [await h.status(), await h.menu()]
        if (status.selectedModelId === id && menu?.value === id) return Date.now() - t0
        await sleep(40)
      }
      throw new Error(`timed out waiting for the selected model to become ${id}`)
    },
    mockReqs: async () => (await fetch(`${mockUrl}/__requests`)).json(),
    badges: () => ev(`[...document.querySelectorAll('.app-badge')].map((b) => ({ text: b.textContent, warn: b.classList.contains('app-badge-warn'), alert: b.getAttribute('role') === 'alert', title: b.title }))`),
    settingsText: async () => {
      await page.click('.header-button@Settings')
      await page.waitFor(`!!document.querySelector('dialog.settings')?.open`)
      const text = await ev(`document.querySelector('dialog.settings').innerText`)
      await page.press('Escape')
      await sleep(150)
      return text
    },
    lastAssistant: (expr) => ev(`(() => { const a = [...document.querySelectorAll('.message-assistant')].at(-1); return a ? (${expr}) : null })()`),
    send: async (text) => {
      await ev(`(() => { const t = document.querySelector('.composer-input'); t.focus(); t.select() })()`)
      await page.type(text)
      await page.press('Enter')
    },
    sendAndWait: async (text, timeoutMs = 15000) => {
      await h.send(text)
      await sleep(100)
      await page.waitFor(`!!document.querySelector('.composer-button[type=submit]')`, { timeoutMs })
    },
    /**
     * Sends a message and returns the request the mock received for it (or null). sendAndWait only waits for the Send button to be
     * back, which is also true BEFORE the reply has started: a check that reads the mock straight after it can find nothing (this
     * ended three sabotage runs of the Stage 7.1 suite at an unrelated line). This waits until the mock has really RECEIVED a new
     * request, and then until the reply is over. If none arrives within 8 s the message is sent once more and the retry is
     * reported loudly ("!!", which the drivers count), so the rate stays visible instead of hiding in the retry.
     */
    askMock: async (text, { timeoutMs = 15000 } = {}) => {
      const before = (await h.mockReqs()).length
      const arrived = async () => {
        const t0 = Date.now()
        while (Date.now() - t0 < 8000) {
          if ((await h.mockReqs()).length > before) return true
          await sleep(50)
        }
        return false
      }
      await h.send(text)
      if (!(await arrived())) {
        console.log(`!! retry: no request reached the mock within 8 s of sending ${JSON.stringify(text.slice(0, 40))}; page: ${await ev(`JSON.stringify({ visibility: document.visibilityState, focus: document.hasFocus(), active: document.activeElement?.className, input: document.querySelector('.composer-input')?.value?.slice(0, 40), replying: !document.querySelector('.composer-button[type=submit]'), dialogs: [...document.querySelectorAll('dialog')].filter((d) => d.open).map((d) => d.className), messages: [...document.querySelectorAll('.message')].map((m) => m.innerText.slice(0, 60).split(String.fromCharCode(10)).join(' ')) })`)}; model: ${await ev(`window.api.settings.getStatus().then((s) => s.selectedModelId)`).catch(() => '?')}; sending once more`)
        await h.send(text)
        if (!(await arrived())) return null
      }
      await page.waitFor(`!!document.querySelector('.composer-button[type=submit]')`, { timeoutMs })
      const reqs = await h.mockReqs()
      return reqs.length > before ? reqs.at(-1) : null
    }
  }
  // 7.2: a reply is drawn as Markdown (paragraphs are elements, trailing spaces are not shown), so the text a person SEES is innerText
  h.bubbleText = () => h.lastAssistant(`a.querySelector('.bubble')?.innerText ?? null`)
  h.noteText = () => h.lastAssistant(`a.querySelector('.message-note')?.textContent ?? null`)
  return h
}

/** A small deterministic random-number generator, so a failing run can be repeated exactly. */
export function lcg(seed) {
  let state = seed >>> 0
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0
    return state / 2 ** 32
  }
}
