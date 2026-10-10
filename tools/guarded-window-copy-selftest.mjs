// What tools/guarded-window-copy.mjs gives a script, as one line of facts (run it through the wrapper with FRONTIER_COPY_NODE_MODULES=0 to leave node_modules out):
//   node tools/guarded-window-copy.mjs tools/guarded-window-copy-selftest.mjs
// It changes nothing outside the run's own folder: it makes and removes one file there, and tries to remove one name that does not exist outside it (the guard refuses by the name,
// so nothing real is ever named).
import fs from 'node:fs'
import { win32 } from 'node:path'

const run = process.env.FRONTIER_GUARD_ROOT ?? ''
const cwd = process.cwd()
const facts = { cwd, run, temp: process.env.TEMP, npmCache: process.env.npm_config_cache, preload: /harness-guard-preload/.test(process.env.NODE_OPTIONS ?? '') }
facts.cwdInRun = run !== '' && cwd.toLowerCase().startsWith(run.toLowerCase() + '\\')
facts.hasGit = fs.existsSync(win32.join(cwd, '.git'))
facts.hasSrc = fs.existsSync(win32.join(cwd, 'src', 'main', 'ipc.ts'))
facts.hasOut = fs.existsSync(win32.join(cwd, 'out'))
facts.hasPdf = fs.readdirSync(cwd).some((n) => /\.pdf$/i.test(n))
// a removal inside the run's folder is allowed (the copy is the run's own), one outside it is refused by its name
const sentinel = win32.join(cwd, 'selftest-sentinel.txt')
fs.writeFileSync(sentinel, 'x')
fs.rmSync(sentinel)
facts.removedInside = !fs.existsSync(sentinel)
const outside = win32.join('C:\\frontier-tmp', `guarded-copy-selftest-no-such-${process.pid}`)
try {
  fs.rmSync(outside, { recursive: true, force: true })
  facts.refusedOutside = false
} catch (error) {
  facts.refusedOutside = error?.code === 'EFSGUARD' || /not inside a folder/.test(String(error?.message))
}
console.log('FACTS ' + JSON.stringify(facts))
process.exit(facts.cwdInRun && !facts.hasGit && facts.hasSrc && !facts.hasOut && !facts.hasPdf && facts.removedInside && facts.refusedOutside && facts.preload ? 0 : 1)
