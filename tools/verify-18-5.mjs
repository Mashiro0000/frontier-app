// Slice 18.5 on this PC: an installed 0.1.0 updated in place by a 0.1.1 installer run the way the app runs it (D-050). Run it OUTSIDE the Claude app (tools/outside.ps1):
//   powershell -NoProfile -File tools/outside.ps1 -Script tools\verify-18-5.mjs -Log tools\.out\verify-18-5.out.txt
// Needs dist/frontier-app-0.1.0-setup.exe and dist-nc-v011/frontier-app-0.1.1-setup.exe (npx electron-builder --win -c.extraMetadata.version=0.1.1 -c.directories.output=dist-nc-v011).
//   P. before anything: no Frontier App installed, no shortcut of that name; a snapshot of the real data folder;
//   I. 0.1.0 installed silently into a fresh scratch folder;
//   U. the 0.1.1 installer run with --updated /S, as updateService runs it, but WITHOUT --force-run: that would start the updated app on the owner's real profile, so the
//      start after an update is not tried here;
//   C. after: still one entry, now 0.1.1, in the same folder; the program's app.asar says 0.1.1; both shortcuts kept and pointing at the program; the real data folder as before;
//   X. the guarded uninstall (lib18.mjs): everything gone, the real data folder as before.
// The owner allowed (17 October 2026) the uninstaller to remove only what this test's install made.
import { checker } from './cdp.mjs'
import { createRequire } from 'node:module'
import { existsSync, readdirSync, statSync, mkdirSync } from 'node:fs'
import { join, sep } from 'node:path'
import { spawnSync } from 'node:child_process'
import { REPO } from './paths.mjs'
import { installed, installKeyLeft, ps, uninstallScratch } from './lib18.mjs'

const check = checker()
const show = (v) => JSON.stringify(v)?.slice(0, 400)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const asar = createRequire(join(REPO, 'package.json'))('@electron/asar')
const OLD = join(REPO, 'dist', 'frontier-app-0.1.0-setup.exe').replaceAll('/', '\\')
const NEW = join(REPO, 'dist-nc-v011', 'frontier-app-0.1.1-setup.exe').replaceAll('/', '\\')
const RUN = `C:\\frontier-tmp\\s182-${Date.now()}`
const DIR = `${RUN}\\Frontier App`
const DATA = join(process.env.APPDATA, 'frontier-app')
const DESKTOP_LNK = join(ps("[Environment]::GetFolderPath('Desktop')"), 'Frontier App.lnk')
const START_LNK = join(ps("[Environment]::GetFolderPath('Programs')"), 'Frontier App.lnk')
const env = () => ({ ...process.env, TEMP: join(RUN, 'temp'), TMP: join(RUN, 'temp') })
const run = (exe, args) => spawnSync(exe, [args], { windowsVerbatimArguments: true, timeout: 240000, stdio: 'ignore', env: env() })
const target = (lnk) => existsSync(lnk) ? ps(`(New-Object -ComObject WScript.Shell).CreateShortcut('${lnk}').TargetPath`) : null
// @electron/asar keeps an archive's header after the first read: forget it, or the updated file is read with the old header.
const asarVersion = () => { try { asar.uncache(join(DIR, 'resources', 'app.asar')); return JSON.parse(asar.extractFile(join(DIR, 'resources', 'app.asar'), 'package.json'.split('/').join(sep)).toString()).version } catch { return null } }
const snapshot = (root) => {
  const out = []
  const walk = (dir, rel) => { let names = []; try { names = readdirSync(dir, { withFileTypes: true }) } catch { return } for (const d of names) { const p = join(dir, d.name); const r = rel ? `${rel}/${d.name}` : d.name; if (d.isDirectory()) { out.push(`${r}/`); walk(p, r) } else { try { const s = statSync(p); out.push(`${r} ${s.size} ${s.mtimeMs}`) } catch { out.push(`${r} ?`) } } } }
  walk(root, '')
  return out.sort()
}
const same = (a, b) => a.length === b.length && a.every((x, i) => x === b[i])

check('P: this runs outside the Claude app', !process.env.CLAUDECODE)
check('P: both installers are there', existsSync(OLD) && existsSync(NEW), show({ OLD, NEW }))
const pre = { hkcu: installed('HKCU'), hklm: installed('HKLM'), desktop: existsSync(DESKTOP_LNK), start: existsSync(START_LNK) }
const ok = !process.env.CLAUDECODE && existsSync(OLD) && existsSync(NEW) && pre.hkcu.length === 0 && pre.hklm.length === 0 && !pre.desktop && !pre.start && !existsSync(RUN)
check('P: nothing of Frontier App is installed, no shortcut of that name', ok, show(pre))
if (!ok) { console.log('STOPPED before installing: a precondition failed, nothing was installed.'); process.exit(check.summary() ? 0 : 1) }
const dataBefore = snapshot(DATA)
check('P: the real data folder was read', dataBefore.length > 0, `${dataBefore.length} entries`)
mkdirSync(join(RUN, 'temp'), { recursive: true })

const i = run(OLD, `/S /D=${DIR}`)
const first = installed('HKCU')
check('I: 0.1.0 installed into the scratch folder', i.status === 0 && first.length === 1 && first[0].version === '0.1.0' && first[0].location === DIR && asarVersion() === '0.1.0', show({ status: i.status, first, asar: asarVersion() }))

const u = run(NEW, '--updated /S')
await sleep(1500)
const after = installed('HKCU')
check('U: the 0.1.1 installer run as an update ends with code 0', u.status === 0, show({ status: u.status, error: u.error?.message }))
check('C: still one entry, now 0.1.1, in the same folder', after.length === 1 && after[0].version === '0.1.1' && after[0].location === DIR, show(after))
check('C: the program\'s app.asar is 0.1.1', asarVersion() === '0.1.1', show(asarVersion()))
check('C: the program is there', existsSync(join(DIR, 'frontier-app.exe')) && existsSync(join(DIR, 'Uninstall frontier-app.exe')))
check('C: both shortcuts kept, pointing at the program', target(DESKTOP_LNK) === `${DIR}\\frontier-app.exe` && target(START_LNK) === `${DIR}\\frontier-app.exe`, show({ d: target(DESKTOP_LNK), s: target(START_LNK) }))
check('C: no HKLM entry', installed('HKLM').length === 0)
check('C: no "Frontier App" data folder in Roaming', !existsSync(join(process.env.APPDATA, 'Frontier App')))
const dataMid = snapshot(DATA)
check('C: the real data folder is exactly as before', same(dataBefore, dataMid), show([...dataBefore.filter((x) => !dataMid.includes(x)), ...dataMid.filter((x) => !dataBefore.includes(x))].slice(0, 10)))

const un = uninstallScratch(DIR, env())
check('X: the guarded uninstall ran', un.ran && un.status === 0, show(un))
for (let n = 0; n < 120 && (existsSync(join(DIR, 'frontier-app.exe')) || installed('HKCU').length > 0); n++) await sleep(500)
check('X: the program, the entry, the record and both shortcuts are gone', !existsSync(join(DIR, 'frontier-app.exe')) && installed('HKCU').length === 0 && (!after[0]?.key || !installKeyLeft(after[0].key)) && !existsSync(DESKTOP_LNK) && !existsSync(START_LNK))
const dataAfter = snapshot(DATA)
check('X: the real data folder is exactly as before', same(dataBefore, dataAfter))
console.log(`(left, as the owner's rule wants: ${RUN})`)
process.exit(check.summary() ? 0 : 1)
