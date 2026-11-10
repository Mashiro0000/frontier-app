// Probe (23.6): which step closed the app in verify-23-2w? Each step, then 2 s, then "alive?" (the page still answers). Order: the least likely first.
// Needs: MOCK_PORT, USER_DATA_DIR (scratch) and setup-key.mjs.
import './ts-resolve.mjs'
import { connect, checker, sleep } from './cdp.mjs'
import { assertScratchProfile } from './profile-guard.mjs'
import { helpers } from './lib3.mjs'

const port = Number(process.argv[3] ?? 9222)
const check = checker()
const page = await connect(port)
await assertScratchProfile()
const H = helpers(page, { userData: process.env.USER_DATA_DIR, mockUrl: `http://127.0.0.1:${process.env.MOCK_PORT}` })
const { ev } = H
const key = async (k, code, vk, modifiers) => {
  await page.send('Input.dispatchKeyEvent', { type: 'keyDown', modifiers, key: k, code, windowsVirtualKeyCode: vk })
  await page.send('Input.dispatchKeyEvent', { type: 'keyUp', modifiers, key: k, code, windowsVirtualKeyCode: vk })
}
const alive = async (step) => {
  await sleep(2000)
  let ok = false
  try { ok = (await ev(`document.readyState`)) === 'complete' } catch { ok = false }
  check(`alive after: ${step}`, ok)
  if (!ok) process.exit(1)
}
try {
  await page.waitFor(`document.readyState === 'complete' && !!document.querySelector('.composer-input')`, { timeoutMs: 20000 })
  await key('O', 'KeyO', 79, 10); await alive('Ctrl+Shift+O in an empty chat (focus in the box)')
  await ev(`document.activeElement.blur()`)
  await key('O', 'KeyO', 79, 10); await alive('Ctrl+Shift+O in an empty chat (focus on the page)')
  await H.askMock('hello'); await alive('a reply')
  await key('O', 'KeyO', 79, 10); await alive('Ctrl+Shift+O after a reply')
  check('  ...it started a new chat', (await ev(`document.querySelectorAll('.message').length`)) === 0)
  await H.send('[[mock:slow]] go'); await sleep(800)
  await page.press('Escape'); await alive('Esc during a slow reply')
  await page.click('.sidebar-new'); await alive('New chat from the sidebar after a stopped reply')
  await H.send('[[mock:slow]] go'); await sleep(800)
  await page.press('Escape'); await sleep(500)
  await key('O', 'KeyO', 79, 10); await alive('Ctrl+Shift+O after a stopped reply')
  await key('O', 'KeyO', 79, 10); await alive('Ctrl+Shift+O again, in the empty chat')
} catch (error) {
  check('the probe ran to the end', false, error?.stack ?? String(error))
}
process.exit(check.summary() ? 0 : 1)
