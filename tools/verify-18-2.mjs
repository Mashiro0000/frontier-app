// Slice 18.2: the installer, installed and uninstalled on this PC (D-050). Run it OUTSIDE the Claude app's container, as the owner's own
// programs run (see outside.ps1):  powershell -NoProfile -File tools/outside.ps1 -Script tools\verify-18-2.mjs -Log tools\.out\verify-18-2.out.txt
// Needs dist/frontier-app-0.1.0-setup.exe (npm run build:win). What it shows:
//   P. before anything: no Frontier App installed, no shortcut of that name, so nothing of the owner's can be touched; a snapshot of the real data folder;
//   G. the installer refuses --delete-app-data (exit 2, nothing installed);
//   I. a silent per-user install into a fresh scratch folder (C:\frontier-tmp\s182-<time>\Frontier App), without admin;
//   C. what it made: the program (its app.asar the same bytes as the build's), the uninstaller, the entry in the per-user "installed apps" list
//      (HKCU, pointing at the scratch folder; nothing in HKLM), a Start-menu and a desktop shortcut to the program; the app was NOT started;
//   L. the installed program starts on a scratch profile and shows the app's page;
//   U. the uninstall, ONLY after checking the entry names exactly this run's scratch folder; it runs the uninstaller with /S and nothing else;
//   A. after: the folder, the entry and both shortcuts are gone, and the real data folder is exactly as before (names, sizes, times).
// The owner allowed (17 October 2026) the uninstaller to remove only what this test's install made: the scratch install folder, the two
// shortcuts and the "installed apps" entry. Nothing else is removed by this script or by what it starts.
import { checker } from './cdp.mjs'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { spawn, spawnSync, execFileSync } from 'node:child_process'
import { REPO } from './paths.mjs'
import { installed, installKeyLeft, uninstallScratch } from './lib18.mjs'

const check = checker()
const show = (v) => JSON.stringify(v)?.slice(0, 500)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const ps = (command) => execFileSync('powershell', ['-NoProfile', '-Command', command], { encoding: 'utf8' }).trim()
const filesUnder = (dir) => { try { return readdirSync(dir, { recursive: true, withFileTypes: true }).filter((d) => d.isFile()).length } catch { return 0 } }
const sha = (file) => createHash('sha256').update(readFileSync(file)).digest('hex')

const SETUP = join(REPO, 'dist', 'frontier-app-0.1.0-setup.exe').replaceAll('/', '\\')
const UNPACKED_ASAR = join(REPO, 'dist', 'win-unpacked', 'resources', 'app.asar')
const RUN = `C:\\frontier-tmp\\s182-${Date.now()}`
const DIR = `${RUN}\\Frontier App`
const GUARD_DIR = `${RUN}\\guard\\Frontier App`
const DATA = join(process.env.APPDATA, 'frontier-app')
const DESKTOP = ps("[Environment]::GetFolderPath('Desktop')")
const PROGRAMS = ps("[Environment]::GetFolderPath('Programs')")
const DESKTOP_LNK = join(DESKTOP, 'Frontier App.lnk')
const START_LNK = join(PROGRAMS, 'Frontier App.lnk')

const entries = installed
const shortcutTarget = (lnk) => existsSync(lnk) ? ps(`(New-Object -ComObject WScript.Shell).CreateShortcut('${lnk}').TargetPath`) : null
const snapshot = (root) => {
  const out = []
  const walk = (dir, rel) => {
    let names = []
    try { names = readdirSync(dir, { withFileTypes: true }) } catch { return }
    for (const d of names) {
      const p = join(dir, d.name); const r = rel ? `${rel}/${d.name}` : d.name
      if (d.isDirectory()) { out.push(`${r}/`); walk(p, r) } else { try { const s = statSync(p); out.push(`${r} ${s.size} ${s.mtimeMs}`) } catch { out.push(`${r} ?`) } }
    }
  }
  walk(root, '')
  return out.sort()
}
const appRunning = () => ps(`@(Get-CimInstance Win32_Process | Where-Object { ($_.Name -eq 'frontier-app.exe' -or $_.Name -eq 'electron.exe') -and $_.CommandLine -notmatch '--type=' } | ForEach-Object { $_.ExecutablePath }) -join '|'`)
// The NSIS command line: /D= must come last and unquoted, so the line is written by hand (Node would quote the space in "Frontier App").
// The installer's and the uninstaller's own temporary files (NSIS unpacks its helpers there and removes them) go into this run's folder on C:.
const childEnv = () => ({ ...process.env, TEMP: join(RUN, 'temp'), TMP: join(RUN, 'temp') })
const runSetup = (args, timeout = 240000) => spawnSync(SETUP, [args], { windowsVerbatimArguments: true, timeout, stdio: 'ignore', env: childEnv() })

console.log(`run folder: ${RUN}\nreal data folder: ${DATA}\ndesktop: ${DESKTOP}\nstart menu: ${PROGRAMS}`)

// P
check('P: the installer is there', existsSync(SETUP), SETUP)
check('P: this runs outside the Claude app (started by tools/outside.ps1, not by Claude Code)', !process.env.CLAUDECODE)
const before = { hkcu: entries('HKCU'), hklm: entries('HKLM'), desktop: existsSync(DESKTOP_LNK), start: existsSync(START_LNK) }
check('P: no Frontier App is installed (no entry in HKCU or HKLM)', before.hkcu.length === 0 && before.hklm.length === 0, show(before))
check('P: no "Frontier App" shortcut on the desktop or in the Start menu', !before.desktop && !before.start, show(before))
check('P: the run folder is new', !existsSync(RUN))
const running = appRunning()
console.log(`(Frontier App or Electron running before the test: ${running || 'none'})`)
const dataBefore = snapshot(DATA)
check('P: the real data folder was read', dataBefore.length > 0, `${dataBefore.length} entries`)
const preOk = !process.env.CLAUDECODE && existsSync(SETUP) && before.hkcu.length === 0 && before.hklm.length === 0 && !before.desktop && !before.start && !existsSync(RUN)
if (!preOk) { console.log('STOPPED before installing: a precondition failed, nothing was installed.'); process.exit(check.summary() ? 0 : 1) }
mkdirSync(join(RUN, 'temp'), { recursive: true })

// G
const g = runSetup(`/S --delete-app-data /D=${GUARD_DIR}`)
check('G: the installer given --delete-app-data ends with code 2', g.status === 2, show({ status: g.status, error: g.error?.message }))
check('G: ... and installs nothing (no file, no entry, no shortcut)', filesUnder(GUARD_DIR) === 0 && entries('HKCU').length === 0 && !existsSync(DESKTOP_LNK) && !existsSync(START_LNK))

// I
const t0 = Date.now()
const inst = runSetup(`/S /D=${DIR}`)
console.log(`(install took ${Date.now() - t0} ms, code ${inst.status})`)
check('I: the silent install ends with code 0', inst.status === 0, show({ status: inst.status, error: inst.error?.message }))

// C
const after = entries('HKCU')
check('C: the program is in the scratch folder', existsSync(join(DIR, 'frontier-app.exe')))
check('C: the uninstaller is there', existsSync(join(DIR, 'Uninstall frontier-app.exe')))
check('C: its app.asar is the build\'s, byte for byte', existsSync(join(DIR, 'resources', 'app.asar')) && sha(join(DIR, 'resources', 'app.asar')) === sha(UNPACKED_ASAR))
check('C: one "installed apps" entry, per user (HKCU)', after.length === 1, show(after))
check('C: none for all users (HKLM)', entries('HKLM').length === 0)
const entry = after[0] ?? {}
check('C: the entry is named Frontier App, version 0.1.0', entry.name === 'Frontier App' && entry.version === '0.1.0', show(entry))
check('C: the entry\'s location is exactly this run\'s scratch folder', entry.location === DIR, show(entry.location))
check('C: the entry\'s uninstaller is the one in that folder', entry.quiet === `"${DIR}\\Uninstall frontier-app.exe" /currentuser /S`, show(entry.quiet))
check('C: a desktop shortcut to the program', shortcutTarget(DESKTOP_LNK) === `${DIR}\\frontier-app.exe`, show(shortcutTarget(DESKTOP_LNK)))
check('C: a Start-menu shortcut to the program', shortcutTarget(START_LNK) === `${DIR}\\frontier-app.exe`, show(shortcutTarget(START_LNK)))
check('C: the installer did not start the app', !appRunning().toLowerCase().includes(DIR.toLowerCase()), appRunning())
check('C: no "Frontier App" data folder was made in Roaming', !existsSync(join(process.env.APPDATA, 'Frontier App')))

// L
{
  const profile = `${RUN}\\profile`
  const child = spawn(join(DIR, 'frontier-app.exe'), [`--user-data-dir=${profile}`, '--remote-debugging-port=9243'], { stdio: 'ignore' })
  child.on('error', (e) => console.log(`(the installed program could not be started: ${e.message})`))
  let page = null
  for (let i = 0; i < 60 && !page; i++) { await sleep(500); try { page = (await (await fetch('http://127.0.0.1:9243/json')).json()).find((t) => t.type === 'page') } catch {} }
  check('L: the installed program starts on a scratch profile and shows the app\'s page', !!page && page.url.endsWith('/resources/app.asar/out/renderer/index.html'), page?.url)
  try { execFileSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' }) } catch {}
  for (let i = 0; i < 20 && appRunning().toLowerCase().includes(DIR.toLowerCase()); i++) await sleep(500)
  check('L: ... and is closed again', !appRunning().toLowerCase().includes(DIR.toLowerCase()))
}

// U
const un = uninstallScratch(DIR, childEnv())
check('U: the guarded uninstall ran (the entry names exactly this run\'s scratch folder and its own quiet line)', un.ran && un.status === 0, show(un))
if (un.ran) for (let i = 0; i < 120 && (existsSync(join(DIR, 'frontier-app.exe')) || entries('HKCU').length > 0); i++) await sleep(500)

// A
await sleep(1000)
check('A: the program folder is gone', !existsSync(join(DIR, 'frontier-app.exe')), show(existsSync(DIR) ? readdirSync(DIR) : 'gone'))
check('A: the "installed apps" entry is gone', entries('HKCU').length === 0)
check('A: the install record (HKCU\Software\<id>) is gone', !entry.key || !installKeyLeft(entry.key))
check('A: the desktop shortcut is gone', !existsSync(DESKTOP_LNK))
check('A: the Start-menu shortcut is gone', !existsSync(START_LNK))
const dataAfter = snapshot(DATA)
const changed = [...dataBefore.filter((x) => !dataAfter.includes(x)), ...dataAfter.filter((x) => !dataBefore.includes(x))]
check('A: the real data folder is exactly as before (names, sizes, times)', changed.length === 0, show(changed.slice(0, 10)))
console.log(`(left, as the owner's rule wants: ${RUN} with the guard folder and the scratch profile)`)

process.exit(check.summary() ? 0 : 1)
