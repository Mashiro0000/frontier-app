// Helpers of the Stage 18 install checks (D-050): what Windows says is installed, and the guarded uninstall of a TEST install.
// The owner allowed (17 October 2026) the uninstaller to remove only what a test's own install made: its scratch install folder under
// C:\frontier-tmp\s182-..., the Start-menu and desktop shortcuts and the per-user "installed apps" entry. uninstallScratch() runs the
// uninstaller only when Windows' record of the install names exactly such a folder, and only with the switches the record itself gives.
import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'

export const ps = (command) => execFileSync('powershell', ['-NoProfile', '-Command', command], { encoding: 'utf8' }).trim()
const psJson = (command) => { const t = ps(command); return t ? JSON.parse(t) : null }

/** Every "installed apps" entry named Frontier App in one hive, with the install location electron-builder keeps in Software\<id>. */
export function installed(hive = 'HKCU') {
  const list = psJson(`ConvertTo-Json -Compress -InputObject @(Get-ChildItem '${hive}:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall' -ErrorAction SilentlyContinue | ForEach-Object { $p = Get-ItemProperty $_.PSPath -ErrorAction SilentlyContinue; if ($p.DisplayName -like 'Frontier App*') { $i = Get-ItemProperty ('${hive}:\\Software\\' + $_.PSChildName) -ErrorAction SilentlyContinue; [pscustomobject]@{ key = $_.PSChildName; name = $p.DisplayName; version = $p.DisplayVersion; uninstall = $p.UninstallString; quiet = $p.QuietUninstallString; location = $i.InstallLocation } } })`)
  return Array.isArray(list) ? list : list ? [list] : []
}

/** Whether a Software\<id> key of the app is left (electron-builder's own record of the install). */
export const installKeyLeft = (key) => ps(`Test-Path 'HKCU:\\Software\\${key}'`) === 'True'

const SCRATCH = /^C:\\frontier-tmp\\s182-\d+\\Frontier App$/

/** The guarded uninstall of a test install in `dir`. Returns { ran, reason, status }. Never runs for anything but a scratch folder. */
export function uninstallScratch(dir, env = process.env) {
  if (!SCRATCH.test(dir)) return { ran: false, reason: `not a test folder: ${dir}` }
  const entries = installed('HKCU')
  if (entries.length !== 1) return { ran: false, reason: `expected exactly one Frontier App entry, found ${entries.length}` }
  const [e] = entries
  if (e.location !== dir) return { ran: false, reason: `the entry's location is ${e.location}, not ${dir}` }
  const exe = join(dir, 'Uninstall frontier-app.exe')
  const expected = `"${exe}" /currentuser /S`
  if (e.quiet !== expected) return { ran: false, reason: `the quiet uninstall line is ${e.quiet}, not ${expected}` }
  if (!existsSync(exe)) return { ran: false, reason: `no uninstaller at ${exe}` }
  const r = spawnSync(exe, ['/currentuser', '/S'], { timeout: 120000, stdio: 'ignore', env })
  return { ran: true, status: r.status, error: r.error?.message }
}
