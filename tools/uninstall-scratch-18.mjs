// Uninstalls a TEST install of Frontier App left by tools/verify-18-2.mjs (D-050), and nothing else: see lib18.mjs uninstallScratch().
// Run outside the Claude app:  powershell -NoProfile -File tools/outside.ps1 -Script tools\uninstall-scratch-18.mjs -Log tools\.out\uninstall-18.txt -Arg "C:\frontier-tmp\s182-...\Frontier App"
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { installed, uninstallScratch } from './lib18.mjs'

const dir = process.argv[2] ?? ''
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const env = { ...process.env, TEMP: join(dir, '..', 'temp'), TMP: join(dir, '..', 'temp') }
const r = uninstallScratch(dir, env)
console.log(JSON.stringify(r))
if (r.ran) for (let i = 0; i < 120 && (existsSync(join(dir, 'frontier-app.exe')) || installed('HKCU').length > 0); i++) await sleep(500)
console.log(JSON.stringify({ programLeft: existsSync(join(dir, 'frontier-app.exe')), entries: installed('HKCU') }))
console.log('done')
