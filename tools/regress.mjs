// The regression driver. Runs the whole earlier set against the tree as it is:
// plain-Node suites, dev-window suites, the seeded-profile launches, the registry scenarios, Stage 4's suites, then the BUILT app.
// usage: node tools/regress.mjs <tag> [node|window|seeds|scenarios|stage4|preview]...   (default: all of them, in that order)
// Outputs of every run go to tools/.out/<label>.out.txt; the summary is printed and appended to tools/.out/regress-<tag>.txt.
// PROVIDER_TEST / REGISTRY_TEST (env): the plain-Node provider and registry suites to run (defaults: the current ones).
import { REPO_WIN } from './paths.mjs'
import { spawnSync } from 'node:child_process'
import { appendFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { OUT, ensureSeeds, here, runApp, runNode, scratch } from './drive.mjs'

const [tag, ...wanted] = process.argv.slice(2)
if (!tag) { console.error('usage: node tools/regress.mjs <tag> [parts...]'); process.exit(2) }
const parts = wanted.length ? wanted : ['node', 'window', 'seeds', 'scenarios', 'stage4', 'preview']
const summary = join(OUT, `regress-${tag}.txt`)
writeFileSync(summary, `# regression ${tag} started ${new Date().toISOString()}\n`)
const results = []
const note = (ok, line) => { results.push(ok); console.log(line); appendFileSync(summary, line + '\n') }
const rec = (r, label, scripts) => note(r.ok, `${r.ok ? 'OK  ' : 'BAD '} ${label.padEnd(26)} ${String(scripts).padEnd(58)} ${r.detail ?? (r.passed !== undefined ? r.passed + '/' + r.total : '')}`)
const P = scratch('s5reg')
const MOCK = '8790'
const pfx = (x) => `${tag}-${x}`

const seeded = (label, mode, scripts, env) => runApp({ label: pfx(label), mode, scripts, env })

if (parts.includes('node')) {
  for (const [label, script] of [['provider', process.env.PROVIDER_TEST ?? 'provider-node-test-5.mjs'], ['registry', process.env.REGISTRY_TEST ?? 'verify-5-2.mjs'], ['store', 'verify-4-1.mjs'], ['adapter', 'provider-adapter-test-5.mjs'], ['credstore', 'verify-5-3-store.mjs'], ['store54', 'verify-5-4-store.mjs'], ...(process.env.EXTRA_NODE_TESTS ? process.env.EXTRA_NODE_TESTS.split(',').map((t, i) => ['extra' + i, t]) : [])]) {
    const r = runNode({ label: pfx(label), script })
    note(r.ok, `${r.ok ? 'OK  ' : 'BAD '} ${pfx(label).padEnd(26)} ${script}`)
  }
}

if (parts.includes('window')) {
  const base = { USER_DATA_DIR: P, WIPE_USER_DATA: '1', MOCK_PORT: MOCK }
  rec(seeded('s1', 'dev', 'setup-key.mjs,verify-1-1.mjs,verify-1-2b.mjs,verify-1-3.mjs,verify-1-3-errors.mjs', base), pfx('s1'), 'stage 1 chain')
  rec(seeded('23', 'dev', 'verify-2-3.mjs', { USER_DATA_DIR: P, WIPE_USER_DATA: '1' }), pfx('23'), 'verify-2-3')
  rec(seeded('23b', 'dev', 'verify-2-3b.mjs', { USER_DATA_DIR: P }), pfx('23b'), 'verify-2-3b (restart)')
  rec(seeded('24', 'dev', 'verify-2-4.mjs', base), pfx('24'), 'verify-2-4')
  rec(seeded('34', 'dev', 'verify-3-4.mjs', base), pfx('34'), 'verify-3-4')
  rec(seeded('w53', 'dev', 'verify-5-3.mjs', { USER_DATA_DIR: scratch('s5w53'), WIPE_USER_DATA: '1', MOCK_PORT: '8797', INSPECT_PORT: '9230' }), pfx('w53'), 'verify-5-3 (keys, Settings)')
  const w54 = spawnSync(process.execPath, [join(here, 'run54.mjs'), 'dev'], { encoding: 'utf8', timeout: 400000, env: { ...process.env, NODE_NO_WARNINGS: '1' } })
  const w54out = (w54.stdout ?? '') + (w54.stderr ?? '')
  const w54total = w54out.match(/(\d+\/\d+|CRASHED[^\n]*?)\s+\(exit/)?.[1] ?? 'no summary' // the line run54.mjs prints through drive.mjs
  note(w54.status === 0, `${w54.status === 0 ? 'OK  ' : 'BAD '} ${pfx('w54').padEnd(26)} ${'verify-5-4 (who answered, file v2)'.padEnd(58)} ${w54total}`)
  const mtime = statSync(join(P, 'preferences.json')).mtimeMs
  rec(seeded('34b', 'dev', 'verify-3-4b.mjs', { USER_DATA_DIR: P, MOCK_PORT: MOCK, EXPECT_MODEL: 'claude-haiku-4-5-20251001', PREFS_MTIME_MS: String(mtime) }), pfx('34b'), 'verify-3-4b (restart)')
}

if (parts.includes('seeds')) {
  const manifest = ensureSeeds()
  for (const m of manifest) {
    rec(seeded(`s3c-${m.name}`, 'dev', 'verify-3-5.mjs', { USER_DATA_DIR: scratch('s5seed'), WIPE_USER_DATA: '1', PRESEED_FILE: m.file, EXPECT_MODEL: m.expectModel, SEED_SHA: m.sha, SEED_NAME: m.name, WARN_ABOUT: m.warnAbout ? String(m.warnAbout) : '' }), pfx(`s3c-${m.name}`).slice(0, 26), 'verify-3-5 (saved choice)')
  }
}

if (parts.includes('scenarios')) {
  rmSync(join(OUT, 'registry-saved.json'), { force: true }) // the scenarios save the project's current registry as their baseline
  for (const s of ['wrong-version', 'no-usable-models', 'default-missing', 'default-is-broken-entry', 'one-bad-entry', 'unknown-provider', 'reordered', 'default-sonnet', 'saved-skipped', 'broken-json-syntax']) {
    const run = spawnSync(process.execPath, [join(here, 'run-scenario.mjs'), s], { encoding: 'utf8', timeout: 400000, env: { ...process.env, NODE_NO_WARNINGS: '1' } })
    const out = (run.stdout ?? '') + (run.stderr ?? '')
    writeFileSync(join(OUT, `${pfx('scenario-' + s)}.out.txt`), out)
    const ok = run.status === 0 && /IDENTICAL to the good copy/.test(out)
    note(ok, `${ok ? 'OK  ' : 'BAD '} scenario ${s.padEnd(26)} exit ${run.status}  ${(out.match(/\d+\/\d+ checks passed/g) ?? []).join(' ')}`)
    if (!ok) for (const l of out.split('\n').filter((x) => /FAIL|ABORT|!!/.test(x)).slice(0, 8)) console.log('       ' + l)
  }
}

function stage4(mode) {
  const p = mode === 'preview' ? 'p' : 'd'
  const r = spawnSync(process.execPath, [join(here, 'final-new.mjs'), mode], { encoding: 'utf8', timeout: 3600000, env: { ...process.env, NODE_NO_WARNINGS: '1' }, maxBuffer: 64 * 1024 * 1024 })
  const out = (r.stdout ?? '') + (r.stderr ?? '')
  writeFileSync(join(OUT, `${pfx('stage4-' + mode)}.out.txt`), out)
  for (const l of out.split('\n').filter((x) => /^(OK|BAD) /.test(x))) note(l.startsWith('OK'), `${l} [stage4 ${mode}]`)
  if (!/runs clean/.test(out)) note(false, `BAD stage4 ${mode}: no summary`)
  void p
}
if (parts.includes('stage4')) stage4('dev')

if (parts.includes('preview')) {
  const build = spawnSync('cmd.exe', ['/c', 'npx electron-vite build'], { cwd: REPO_WIN, encoding: 'utf8', timeout: 600000 })
  note(build.status === 0, `${build.status === 0 ? 'OK  ' : 'BAD '} electron-vite build (exit ${build.status})`)
  const base = { USER_DATA_DIR: scratch('s5prev'), WIPE_USER_DATA: '1', MOCK_PORT: MOCK }
  rec(seeded('prev-s1', 'preview', 'setup-key.mjs,verify-prod.mjs,verify-1-3.mjs', base), pfx('prev-s1'), 'built: prod + chat suite')
  rec(seeded('prev-24', 'preview', 'verify-2-4.mjs', base), pfx('prev-24'), 'built: verify-2-4')
  rec(seeded('prev-34', 'preview', 'verify-3-4.mjs', base), pfx('prev-34'), 'built: verify-3-4')
  rec(seeded('prev-w53', 'preview', 'verify-5-3.mjs', { USER_DATA_DIR: scratch('s5w53p'), WIPE_USER_DATA: '1', MOCK_PORT: '8797', INSPECT_PORT: '9230' }), pfx('prev-w53'), 'built: verify-5-3')
  stage4('preview')
}

const clean = results.filter(Boolean).length
const last = `\n${clean}/${results.length} runs clean`
console.log(last)
appendFileSync(summary, last + '\n')
process.exit(results.every(Boolean) ? 0 : 1)
