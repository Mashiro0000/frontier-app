// Slice 18.6 (D-050) in the real window: Settings > Updates, against the stand-in for GitHub's downloads (tools/update-server.mjs, in this process) and a release key made for
// the run (tools/run186.mjs hands the app its public half by FRONTIER_UPDATE_KEY, which only a run from source reads), with the system's message box stood in for from the
// main inspector. What it shows, on the real window and the real path:
//   A. the section: off, "Not checked yet", the version, no "Check now"; nothing goes to the server while it is off;
//   B. turning on asks in the system's box (the words are read); after a no it is off and nothing was asked of the server; after a yes it is on, updates.json says so,
//      ONE check is made, and the newer version is shown with its size and notes;
//   C. Install asks in the box; "Not now" downloads nothing and is kept; a yes downloads the installer into the data folder (the signed bytes), and running from source
//      it is not run (the sentence says why); "Check now" makes one more request;
//   D. the page alone cannot do more: its own setOn(true) still meets the box (a no leaves it off), Install while off is refused;
//   E. turning off asks nothing; "Check now" goes; the section fits at 320 px; the console stays clean.
// Needs: USER_DATA_DIR (scratch), INSPECT_PORT, UPDATE_PORT, UPDATE_TEST_PRIVATE_PEM.
import './temp-on-a.mjs'
import './ts-resolve.mjs'
import { connect, checker, sleep } from './cdp.mjs'
import { assertScratchProfile } from './profile-guard.mjs'
import { mainInspector } from './lib4.mjs'
import { installQuestions } from './lib10.mjs'
import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { envelope, manifestFor, privateFromPem } from './release-lib.mjs'
import { startUpdateServer } from './update-server.mjs'

const port = Number(process.argv[3] ?? 9222)
const userData = process.env.USER_DATA_DIR
const inspectPort = Number(process.env.INSPECT_PORT)
const updatePort = Number(process.env.UPDATE_PORT)
if (!userData || !inspectPort || !updatePort || !process.env.UPDATE_TEST_PRIVATE_PEM) throw new Error('USER_DATA_DIR, INSPECT_PORT, UPDATE_PORT and UPDATE_TEST_PRIVATE_PEM must be set')
const check = checker()
const ONLY = process.env.ONLY ? new Set(process.env.ONLY.split(',')) : null
const part = async (name, fn) => { if (ONLY && !ONLY.has(name)) return; try { await fn() } catch (error) { check(`${name} did not run to its end: ${String(error?.stack ?? error).slice(0, 500)}`, false) } }
const show = (v) => JSON.stringify(v)?.slice(0, 600)
const sha = (b) => createHash('sha256').update(b).digest('hex')

const server = await startUpdateServer(updatePort)
const privateKey = privateFromPem(process.env.UPDATE_TEST_PRIVATE_PEM)
const repo = 'Mashiro0000/frontier-app-releases' // the build's own RELEASES_REPO: the app checks the address against it
const INSTALLER = Buffer.concat([Buffer.from('MZ stand-in installer for the window check '), Buffer.alloc(200_000, 9)])
const m = manifestFor({ repo, version: '0.2.0', date: '2026-10-20', notes: 'Faster replies.\nA new Updates section.', size: INSTALLER.length, sha256: sha(INSTALLER) })
server.setInstaller(m.installer.name, INSTALLER)
server.setEnvelope(envelope(m, privateKey))

const page = await connect(port)
await assertScratchProfile()
const main = await mainInspector(inspectPort)
const Q = await installQuestions(main, { fallback: 'no' })
const ev = (expression) => page.evaluate(expression)
const sleepUntil = async (predicate, ms = 8000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await predicate()) return true; await sleep(100) } return false }
const clickOn = async (expr) => {
  const ok = await ev(`(() => { const el = ${expr}; if (!el) return false; el.scrollIntoView({ block: 'center' }); el.setAttribute('data-click', '1'); return true })()`)
  if (!ok) throw new Error(`nothing to click: ${expr}`)
  await sleep(80)
  await page.click('[data-click="1"]')
  await ev(`document.querySelector('[data-click="1"]')?.removeAttribute('data-click')`)
}
const button = (scope, text) => `[...document.querySelectorAll(${JSON.stringify(scope + ' button')})].find((b) => b.textContent.trim() === ${JSON.stringify(text)})`
const section = () => ev(`(() => { const s = document.querySelector('.updates-section'); if (!s) return null; const sw = s.querySelector('[role=switch]'); return { text: s.innerText, on: sw?.getAttribute('aria-checked'), disabled: sw?.disabled, checkNow: !!${button('.updates-section', 'Check now')}, install: !!${button('.updates-section', 'Install...')} } })()`)
const openSettings = async () => {
  await page.click('.header-button@Settings')
  await page.waitFor(`!!document.querySelector('dialog.settings')?.open`)
  await ev(`document.getElementById('settings-updates-heading').scrollIntoView({ block: 'start' })`)
  await sleep(300)
}
const closeSettings = async () => { await page.press('Escape'); await sleep(250) }
const reopen = async () => { await closeSettings(); await openSettings() }
const toggle = () => clickOn(`document.querySelector('.updates-section [role=switch]')`)
const checks = () => server.requests.filter((r) => /\/releases\/latest\//.test(r.path)).length
const downloads = () => server.requests.filter((r) => /\/releases\/download\//.test(r.path)).length
const settingsFile = () => { try { return JSON.parse(readFileSync(join(userData, 'updates.json'), 'utf8')) } catch { return null } }

try {
  await part('A', async () => {
    await openSettings()
    const s = await section()
    check('A: Settings has an Updates section', s !== null && /Updates/.test(s.text), show(s))
    check('A: it is off, not checked yet, version 0.1.0, no "Check now"', s?.on === 'false' && /Not checked yet/.test(s.text) && /This is version 0\.1\.0/.test(s.text) && !s.checkNow, show(s))
    check('A: the hint names where it reads from', /github\.com\/Mashiro0000\/frontier-app-releases/.test(s?.text ?? ''))
    check('A: no updates.json yet', !existsSync(join(userData, 'updates.json')))
    await sleep(1500)
    check('A: nothing was asked of the server while it is off', server.requests.length === 0, show(server.requests.map((r) => r.path)))
  })

  await part('B', async () => {
    await Q.reset(); await Q.queue('no')
    await toggle()
    await sleepUntil(async () => (await Q.count()) === 1)
    await sleep(400)
    const asked = await Q.asked()
    const o = asked[0]?.options
    check('B: turning on asks in the system\'s box, for the window', asked.length === 1 && asked[0].withWindow, show(asked))
    check('B: ... "Let this app check for updates once a day?", with what is sent and that installs ask', o?.message === 'Let this app check for updates once a day?' && /Nothing about you, your chats or your keys is sent/.test(o?.detail ?? '') && /asks you here first/.test(o?.detail ?? '') && o?.buttons?.includes('Turn on'), show(o))
    const s = await section()
    check('B: after a no it is still off, and nothing was asked of the server', s?.on === 'false' && server.requests.length === 0, show(s))
    await sleep(3300)
    await Q.queue('yes')
    await toggle()
    check('B: after a yes it is on', await sleepUntil(async () => (await section())?.on === 'true'))
    check('B: updates.json says on', settingsFile()?.on === true, show(settingsFile()))
    check('B: one check was made', await sleepUntil(async () => checks() === 1), String(checks()))
    await sleepUntil(async () => /is available/.test((await section())?.text ?? ''))
    await reopen()
    const t = (await section())?.text ?? ''
    check('B: the newer version is shown, with its date, size and notes', /Version 0\.2\.0 \(2026-10-20, 0\.2 MB\) is\s+available/.test(t) && /Faster replies\./.test(t) && /A new Updates section\./.test(t), t)
    check('B: "Last checked" replaces "Not checked yet"', /Last checked/.test(t) && !/Not checked yet/.test(t))
    check('B: nothing was downloaded', downloads() === 0)
    check('B: one check only (no second one by itself)', checks() === 1)
  })

  await part('C', async () => {
    await sleep(3300)
    await Q.reset(); await Q.queue('no')
    await clickOn(button('.updates-section', 'Install...'))
    if (!(await sleepUntil(async () => (await Q.count()) === 1))) console.log(`(no question after the first Install click; the section says: ${show(await section())}; settings: ${show(settingsFile())})`)
    await sleep(500)
    const o = (await Q.asked())[0]?.options
    check('C: Install asks in the box: "Install Frontier App 0.2.0?"', o?.message === 'Install Frontier App 0.2.0?' && /You have version 0\.1\.0/.test(o?.detail ?? '') && /github\.com\/Mashiro0000\/frontier-app-releases/.test(o?.detail ?? '') && o?.buttons?.includes('Download and install') && o?.buttons?.includes('Not now'), show(o))
    check('C: the notes are quoted in the box, each line on its own', /"Faster replies\."\n"A new Updates section\."/.test(o?.detail ?? ''), show(o?.detail))
    check('C: "Not now" downloads nothing', downloads() === 0)
    check('C: ... and is kept in updates.json', settingsFile()?.declined === '0.2.0', show(settingsFile()))
    await sleep(3300)
    await Q.queue('yes')
    await clickOn(button('.updates-section', 'Install...'))
    check('C: after a yes the installer is downloaded once', await sleepUntil(async () => downloads() === 1, 10000), String(downloads()))
    await sleepUntil(async () => /Only the installed app runs an installer/.test((await section())?.text ?? ''), 8000)
    const t = (await section())?.text ?? ''
    check('C: running from source it says it was downloaded and checked, and not run', /The update was downloaded and checked\. Only the installed app runs an installer\./.test(t), t)
    const file = join(userData, 'updates', 'frontier-app-0.2.0-setup.exe')
    check('C: the file in the data folder is the signed installer, byte for byte', existsSync(file) && sha(readFileSync(file)) === sha(INSTALLER))
    check('C: the app is still running (nothing was run, nothing closed)', (await ev('1 + 1')) === 2)
    const before = checks()
    await clickOn(button('.updates-section', 'Check now'))
    check('C: "Check now" makes one more request', await sleepUntil(async () => checks() === before + 1), String(checks() - before))
  })

  await part('D', async () => {
    await sleep(3300)
    await Q.reset()
    const off = await ev('window.api.updates.setOn(false)')
    check('D: (setup) off from the page is at once, without a question', off.ok && off.status.on === false && (await Q.count()) === 0)
    await Q.queue('no')
    const r = await ev('window.api.updates.setOn(true)')
    check('D: the page\'s own setOn(true) still meets the box; a no leaves it off', !r.ok && (await Q.count()) === 1 && settingsFile()?.on === false, show(r))
    const i = await ev('window.api.updates.install()')
    check('D: Install while off is refused', !i.ok && /off/.test(i.error), show(i))
    const n = await ev('window.api.updates.checkNow()')
    check('D: "Check now" while off is refused', !n.ok, show(n))
    const odd = await ev(`(async () => { try { return await window.api.updates.setOn('yes') } catch (e) { return { thrown: String(e) } } })()`)
    check('D: a value that is not true or false is not understood', odd.ok === false, show(odd))
  })

  await part('E', async () => {
    await reopen()
    await sleep(3300)
    await Q.reset(); await Q.queue('yes')
    await toggle()
    await sleepUntil(async () => (await section())?.on === 'true')
    await Q.reset()
    await toggle()
    check('E: turning off asks nothing and is at once', await sleepUntil(async () => (await section())?.on === 'false') && (await Q.count()) === 0)
    check('E: "Check now" is gone while off', (await section())?.checkNow === false)
    await page.send('Emulation.setDeviceMetricsOverride', { width: 320, height: 640, deviceScaleFactor: 1, mobile: false })
    await sleep(400)
    const fit = await ev(`(() => { const s = document.querySelector('.updates-section'); const r = s.getBoundingClientRect(); return { width: r.width, scroll: s.scrollWidth, client: s.clientWidth, over: [...s.querySelectorAll('*')].filter((e) => e.getBoundingClientRect().right > r.right + 1).map((e) => e.className || e.tagName).slice(0, 5) } })()`)
    check('E: the section fits at 320 px (nothing sticks out)', fit.scroll <= fit.client + 1 && fit.over.length === 0, show(fit))
    await page.send('Emulation.clearDeviceMetricsOverride', {})
    await closeSettings()
    check('E: the page logged no errors and no warnings', page.problems.length === 0, show(page.problems))
  })
} catch (error) {
  check(`the suite stopped before its end: ${String(error?.stack ?? error).slice(0, 400)}`, false)
}

await server.close()
main.close?.()
page.close()
process.exit(check.summary() ? 0 : 1)
