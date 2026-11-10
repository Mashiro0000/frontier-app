// Stage 23.2 to 23.7 (D-055) in the real window against the mock: the actions under a message as icons (each still named, Copy turns into a check); one
// model pill under the box (the model and its effort; no Task menu there, the Task menu in the chooser); the box's Instructions / Memory / Project as icons
// while off and with their words while on, the empty chat's chips without the two the box has; code coloured for a known language and left plain for an
// unknown one, its text unchanged; the shortcuts (Ctrl+/ lists them, Ctrl+Shift+O a new chat, Esc stops a reply); Settings with a close button at the top
// and none at the foot. Screenshots in shots23.
// Needs: MOCK_PORT, USER_DATA_DIR (scratch) and setup-key.mjs.
import './ts-resolve.mjs'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { connect, checker, sleep } from './cdp.mjs'
import { assertScratchProfile } from './profile-guard.mjs'
import { helpers } from './lib3.mjs'
import { sayYesFromMain } from './lib10.mjs'

const shots = join(process.argv[2], '..', 'shots23')
mkdirSync(shots, { recursive: true })
const port = Number(process.argv[3] ?? 9222)
const mockUrl = `http://127.0.0.1:${process.env.MOCK_PORT}`
const userData = process.env.USER_DATA_DIR
if (!process.env.MOCK_PORT || !userData) throw new Error('MOCK_PORT and USER_DATA_DIR must be set')

const check = checker()
// Saving a note asks in the system's own box (D-039): the suite answers it from main, so no real box ever appears on the screen.
const { main, Q } = await sayYesFromMain()
const page = await connect(port)
await assertScratchProfile()
const H = helpers(page, { userData, mockUrl })
const { ev } = H
const READY = `document.readyState === 'complete' && !!document.querySelector('.composer-input')`
const key = async (k, code, vk, modifiers) => {
  await page.send('Input.dispatchKeyEvent', { type: 'keyDown', modifiers, key: k, code, windowsVirtualKeyCode: vk })
  await page.send('Input.dispatchKeyEvent', { type: 'keyUp', modifiers, key: k, code, windowsVirtualKeyCode: vk })
  await sleep(400)
}
const CTRL = 2, SHIFT = 8
const openDialogs = () => ev(`[...document.querySelectorAll('dialog')].filter((d) => d.open).map((d) => d.className)`)
const FENCE = '```'

try {
  await page.waitFor(READY, { timeoutMs: 20000 })

  // ============ D. the empty chat's chips, the box's buttons ============
  const chips = await ev(`[...document.querySelectorAll('.empty-chips .chip')].map((c) => c.textContent.trim())`)
  check('D: the empty chat\'s chips no longer repeat the box (no Projects, no Instructions); Experts is one', !chips.includes('Projects') && !chips.includes('Instructions') && chips.includes('Experts') && chips.includes('Web search'), JSON.stringify(chips))
  await page.click('.chip@Experts'); await sleep(400)
  check('D: the Experts chip opens Experts', (await openDialogs()).some((c) => c.split(' ').includes('experts')))
  await page.press('Escape'); await sleep(300)
  const labels = () => ev(`['chat-instructions', 'chat-memory', 'chat-project'].map((c) => { const l = document.querySelector('.' + c + ' .chat-label'); return c + ':' + (l.classList.contains('visually-hidden') ? 'hidden' : 'shown') + ':' + document.querySelector('.' + c).textContent.trim() })`)
  check('D: Instructions, Memory and Project are icons while nothing goes with the messages, still named', JSON.stringify(await labels()) === JSON.stringify(['chat-instructions:shown:Instructions', 'chat-memory:shown:Memory', 'chat-project:shown:Project']) /* (Stage 24, D-056) while off they are rows of the "+" menu, with their words */ && (await ev(`['chat-instructions', 'chat-memory', 'chat-project'].every((c) => !!document.querySelector('.chat-menu .' + c))`)), JSON.stringify(await labels()))
  const asked = (await Q.asked()).length
  const added = await ev(`window.api.memory.add('A test note.', 'all').then((r) => r.ok)`)
  check('D: saving the note asked in the system box (answered by the suite, not shown on screen)', (await Q.asked()).length === asked + 1)
  await ev(`document.querySelector('.chat-memory').click()`); await sleep(900); await page.press('Escape'); await sleep(600) // the page reads the notes again when Memory opens
  const after = await labels()
  check('D: with a note going with every message, Memory shows its word and the count', added && after[1].startsWith('chat-memory:shown:Memory') && /1$/.test(after[1]), JSON.stringify({ added, after }))

  // ============ B. one model pill ============
  const pill = await ev(`(() => { const p = document.querySelector('.composer-menus'); return { pill: p.classList.contains('model-pill'), aria: p.getAttribute('aria-label'), model: !!p.querySelector('.header-select'), effort: !!p.querySelector('.effort-select'), task: [...p.querySelectorAll('.task-select')].some((t) => !t.closest('dialog')), radius: getComputedStyle(p).borderRadius } })()`)
  check('B: under the box, one pill named "Model and effort": the model and its effort, no Task menu', pill.pill && pill.aria === 'Model and effort' && pill.model && pill.effort && !pill.task && parseFloat(pill.radius) > 100, JSON.stringify(pill))
  await page.click('.header-select'); await sleep(500)
  check('B: the Task menu is in the model chooser', await ev(`!!document.querySelector('dialog.model-chooser[open] .model-chooser-task .task-select')`))
  await ev(`(() => { const s = document.querySelector('dialog.model-chooser .task-select'); s.value = 'coding'; s.dispatchEvent(new Event('change', { bubbles: true })); return true })()`)
  await sleep(300)
  check('B: choosing a task there marks models as suggested in the chooser', (await ev(`document.querySelector('dialog.model-chooser').innerText`)).toLowerCase().includes('suggested'))
  await page.screenshot(join(shots, '23-3-chooser-task.png'))
  await page.press('Escape'); await sleep(300)

  // ============ A. the actions as icons, C. code colours ============
  await H.askMock(`[[mock:say]] Here:\n\n${FENCE}js\nconst n = 42 // the answer\n${FENCE}\n\n${FENCE}weird\nconst plain = 1\n${FENCE}`)
  await sleep(500)
  const actions = await ev(`[...document.querySelectorAll('.message-assistant .message-action')].map((b) => ({ name: b.textContent.trim(), icon: !!b.querySelector('svg.icon'), w: Math.round(b.getBoundingClientRect().width), title: b.title.length }))`)
  check('A: under a reply the actions are icons (an svg, 40 px wide at most), each still named for screen readers and with its tooltip', actions.length >= 3 && actions.every((a) => a.icon && a.w <= 40 && a.name.length > 0 && a.title > 10) && actions.map((a) => a.name).includes('Regenerate'), JSON.stringify(actions))
  const mine = await ev(`[...document.querySelectorAll('.message-user .message-action')].map((b) => b.textContent.trim())`)
  check('A: the person\'s own message has Edit among them', mine.includes('Edit'), JSON.stringify(mine))
  await ev(`[...document.querySelectorAll('.message-assistant .message-action')].find((b) => b.textContent.trim() === 'Copy').click()`)
  await sleep(300)
  check('A: Copy turns into a check named "Copied"', await ev(`[...document.querySelectorAll('.message-assistant .message-action')].some((b) => b.textContent.trim() === 'Copied')`))
  const code = await ev(`[...document.querySelectorAll('.message-assistant .md-pre code')].map((c) => ({ text: c.textContent, tones: [...c.querySelectorAll('[class^=tok-]')].map((s) => s.className + ':' + s.textContent) }))`)
  check('C: a js block is coloured: the keyword, the number, the comment', JSON.stringify(code[0]?.tones) === JSON.stringify(['tok-keyword:const', 'tok-number:42', 'tok-comment:// the answer']), JSON.stringify(code))
  check('C: its text is exactly what was written', code[0]?.text === 'const n = 42 // the answer')
  check('C: a block in a language it does not know stays plain', code[1]?.tones.length === 0 && code[1]?.text === 'const plain = 1')
  const colours = await ev(`(() => { const s = document.querySelector('.tok-keyword'); const c = getComputedStyle(s).color; const p = getComputedStyle(s.closest('.md-pre')).color; return { c, p } })()`)
  check('C: the keyword has its own colour', colours.c !== colours.p, JSON.stringify(colours))
  await page.screenshot(join(shots, '23-2-icons-code.png'))

  // ============ E. shortcuts ============
  await key('/', 'Slash', 191, CTRL)
  const list = await ev(`[...document.querySelectorAll('dialog.shortcuts[open] .shortcuts-row')].map((r) => r.innerText.replace(/\\s+/g, ' ').trim())`)
  check('E: Ctrl+/ lists the shortcuts', list.length === 4 && list.some((r) => r.startsWith('Ctrl+Shift+O')) && list.some((r) => r.startsWith('Esc')), JSON.stringify(list))
  await page.screenshot(join(shots, '23-6-shortcuts.png'))
  await page.press('Escape'); await sleep(300)
  check('E: Esc closes the list', !(await openDialogs()).some((c) => c.includes('shortcuts')))
  await H.send('[[mock:slow]] go')
  await page.waitFor(`!document.querySelector('.composer-button[type=submit]')`, { timeoutMs: 8000 })
  await sleep(600)
  await page.press('Escape')
  await page.waitFor(`!!document.querySelector('.composer-button[type=submit]')`, { timeoutMs: 8000 })
  check('E: Esc stops a reply that is arriving', (await ev(`[...document.querySelectorAll('.message-assistant')].at(-1).innerText`)).includes('tick'))
  const before = await ev(`document.querySelectorAll('.message').length`)
  await key('O', 'KeyO', 79, CTRL | SHIFT)
  check('E: Ctrl+Shift+O starts a new chat', before > 0 && (await ev(`document.querySelectorAll('.message').length`)) === 0)
  await key('O', 'KeyO', 79, CTRL | SHIFT)
  check('E: ...and does nothing in an empty chat', (await ev(`document.querySelectorAll('.message').length`)) === 0)

  // ============ F. Settings ============
  await page.click('.header-button@Settings')
  await page.waitFor(`!!document.querySelector('dialog.settings')?.open`, { timeoutMs: 4000 })
  const top = await ev(`(() => { const t = document.querySelector('dialog.settings .settings-top'); const x = t?.querySelector('.settings-close'); return { sticky: t && getComputedStyle(t).position, height: t && Math.round(t.getBoundingClientRect().height), x: !!x && x.getAttribute('aria-label'), xRight: x && Math.round(t.getBoundingClientRect().right - x.getBoundingClientRect().right), footer: !!document.querySelector('dialog.settings .settings-footer'), placeholder: document.querySelector('dialog.settings .settings-input')?.placeholder } })()`)
  check('F: Settings has a close button at the right of its title row, which stays in view, the row as tall as the old title (58 px)', top.sticky === 'sticky' && top.x === 'Close Settings' && top.xRight <= 0 && top.height === 58, JSON.stringify(top))
  check('F: no Close at the foot; the key box says what to paste', !top.footer && /^Paste/.test(top.placeholder ?? ''), JSON.stringify(top))
  const words = await ev(`document.querySelector('dialog.settings form.settings-section').innerText.length`)
  check('F: a key section is short (under 330 characters)', words < 330, String(words))
  await page.screenshot(join(shots, '23-7-settings.png'))
  await page.click('.settings-close'); await sleep(300)
  check('F: the X closes Settings', !(await ev(`document.querySelector('dialog.settings').open`)))
} catch (error) {
  check('the suite ran to the end', false, error?.stack ?? String(error))
}
main.close()
process.exit(check.summary() ? 0 : 1)
