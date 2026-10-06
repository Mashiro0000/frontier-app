// Registry scenarios: temporarily replaces A:\frontier-app\registry\models.json with a deliberately broken or altered
// variant, runs the app on a fresh EFS scratch profile, runs verify-3-6.mjs, and ALWAYS puts the good file back
// (copied from a saved good copy; verified by hash before and after).
// usage: node run-scenario.mjs <scenario>
import { REPO_WIN } from './paths.mjs'
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { spawn, spawnSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { OUT, SHOTS } from './paths.mjs'
import { ensureSeeds } from './drive.mjs'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const REGISTRY = `${REPO_WIN}\\registry\\models.json`
const GOOD = join(OUT, 'registry-saved.json') // a copy of the project's registry taken at first use; regress.mjs deletes it so each regression starts from the current file
const sha = (p) => createHash('sha256').update(readFileSync(p)).digest('hex').slice(0, 16)
const scenario = process.argv[2]
ensureSeeds()

if (!existsSync(GOOD)) {
  // first use: the file in the project must be the verified one; keep a copy of it
  copyFileSync(REGISTRY, GOOD)
  console.log(`saved the good registry as ${GOOD} (sha ${sha(GOOD)})`)
}
const goodSha = sha(GOOD)
if (sha(REGISTRY) !== goodSha) {
  // Either an earlier scenario run was killed half way and left a broken variant behind, or the file was changed on purpose. Do not guess:
  // overwriting would lose a deliberate edit. `git diff registry/models.json` shows which; RESTORE_REGISTRY=1 puts the saved copy back.
  if (process.env.RESTORE_REGISTRY === '1') copyFileSync(GOOD, REGISTRY)
  else { console.error(`ABORT: the project's registry/models.json (sha ${sha(REGISTRY)}) is not the saved copy (${goodSha}, ${GOOD}). Nothing was changed. If a killed run left a broken variant: git checkout registry/models.json (or RESTORE_REGISTRY=1); if you changed it on purpose: delete the saved copy.`); process.exit(2) }
}

const good = JSON.parse(readFileSync(GOOD, 'utf8'))
const clone = (v) => JSON.parse(JSON.stringify(v))
const withModels = (fn) => { const r = clone(good); fn(r); return JSON.stringify(r, null, 2) + '\n' }
const OPUS = 'claude-opus-5-5', SONNET = 'claude-sonnet-5-5', FABLE = 'claude-fable-5-1'
// The scenarios that break ONE entry break Fable's (they broke Claude Haiku 4.5's until that model was removed on 2026-10-06, D-036); emptying
// its effortLevels while its effort stays set is the same fault the Haiku variant had ("effort is set, but capabilities.effortLevels is empty").

// scenario -> { file: text to put in registry/models.json, preseed?: file to copy in as preferences.json }
const SCENARIOS = {
  'wrong-version': { file: withModels((r) => { r.schemaVersion = '0.1' }) },
  'no-usable-models': { file: withModels((r) => { r.models.forEach((m) => { m.effrot = m.effort; delete m.effort }) }) },
  'default-missing': { file: withModels((r) => { r.defaultModelId = 'claude-nope' }) },
  'default-is-broken-entry': { file: withModels((r) => { r.models.find((m) => m.id === OPUS).effort = 'extreme' }) },
  'one-bad-entry': { file: withModels((r) => { r.models.find((m) => m.id === FABLE).capabilities.effortLevels = [] }) },
  'unknown-provider': { file: withModels((r) => { r.models.find((m) => m.id === FABLE).provider = 'gemini' }) },
  'reordered': { file: withModels((r) => { r.models.reverse() }) },
  'default-sonnet': { file: withModels((r) => { r.defaultModelId = SONNET }) },
  'saved-skipped': { file: withModels((r) => { r.models.find((m) => m.id === FABLE).capabilities.effortLevels = [] }), preseed: join(OUT, 'seeds', 'valid-fable.json') },
  // syntax error: the BUILD must refuse it, loudly, before any window exists
  'broken-json-syntax': { file: JSON.stringify(good, null, 2).slice(0, 400) + '\n', build: true }
}
const def = SCENARIOS[scenario]
if (!def) { console.error('unknown scenario. Known: ' + Object.keys(SCENARIOS).join(', ')); process.exit(2) }

let exitCode = 1
try {
  writeFileSync(REGISTRY, def.file)
  console.log(`[${scenario}] registry/models.json replaced (sha ${sha(REGISTRY)}, good is ${goodSha})`)
  const profile = join(process.env.APPDATA, 'frontier-app-test-scratch-s3d')
  if (profile === join(process.env.APPDATA, 'frontier-app')) throw new Error('scratch profile equals the real profile')

  if (def.build) {
    // dev server with a registry that is not even valid JSON: it must not produce a window
    const logPath = join(OUT, `scenario-${scenario}.log`)
    const cmd = `npm run dev -- --remoteDebuggingPort 9224 -- --user-data-dir=${profile}`
    mkdirSync(profile, { recursive: true })
    const child = spawn('cmd.exe', ['/c', cmd], { cwd: REPO_WIN, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
    let out = ''
    child.stdout.on('data', (d) => (out += d))
    child.stderr.on('data', (d) => (out += d))
    let exited = null
    child.on('exit', (code) => { exited = code })
    await new Promise((r) => setTimeout(r, 30000))
    let windowOpened = false
    try { windowOpened = (await (await fetch('http://127.0.0.1:9224/json')).json()).some((t) => t.type === 'page') } catch { /* no debug port: no window */ }
    spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { encoding: 'utf8' })
    writeFileSync(logPath, out)
    const mentions = /models\.json|JSON|Unexpected|Expected/i.test(out)
    console.log(`[${scenario}] after 30 s: dev command ${exited === null ? 'still running' : 'exited with code ' + exited}; a window opened: ${windowOpened}`)
    console.log(`[${scenario}] its output mentions the file / a JSON error: ${mentions}`)
    console.log(out.split('\n').filter((l) => /error|models\.json|JSON|Unexpected/i.test(l)).slice(0, 6).map((l) => '    ' + l.slice(0, 200)).join('\n'))
    const ok = !windowOpened && mentions
    console.log(`${ok ? 'PASS' : 'FAIL'}  [${scenario}] a registry that is not valid JSON stops the build/dev start loudly, and no window is shown`)
    exitCode = ok ? 0 : 1
  } else {
    const env = { ...process.env, USER_DATA_DIR: profile, WIPE_USER_DATA: '1', MOCK_PORT: '8790', LOG_LABEL: `s3d-${scenario}`, SCENARIO: scenario, ORIGINAL_REGISTRY: GOOD, NODE_NO_WARNINGS: '1' }
    if (def.preseed) env.PRESEED_FILE = def.preseed
    else delete env.PRESEED_FILE
    const run = spawnSync(process.execPath, [join(here, 'run-with-app.mjs'), 'dev', 'verify-3-6.mjs', SHOTS, '9222'], { env, encoding: 'utf8', timeout: 240000 })
    const out = (run.stdout ?? '') + (run.stderr ?? '')
    writeFileSync(join(OUT, `scenario-${scenario}.out.txt`), out)
    for (const line of out.split('\n')) if (/^(FAIL|\d+\/\d+ checks|ABORT|!!)/.test(line)) console.log('    ' + line.slice(0, 260))
    exitCode = run.status ?? 1
  }
} finally {
  copyFileSync(GOOD, REGISTRY)
  const after = sha(REGISTRY)
  console.log(`[${scenario}] registry/models.json restored: sha ${after} -> ${after === goodSha ? 'IDENTICAL to the good copy' : '!!! NOT THE GOOD COPY'}`)
  if (after !== goodSha) exitCode = 3
}
process.exit(exitCode)
