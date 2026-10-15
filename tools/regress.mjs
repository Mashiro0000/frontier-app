// The regression driver. Runs the whole earlier set against the tree as it is:
// plain-Node suites, dev-window suites, the seeded-profile launches, the registry scenarios, Stage 4's suites, then the BUILT app.
// usage: node tools/regress.mjs <tag> [node|window|seeds|scenarios|stage4|preview]...   (default: all of them, in that order)
// Outputs of every run go to tools/.out/<label>.out.txt; the summary is printed and appended to tools/.out/regress-<tag>.txt.
// PROVIDER_TEST / REGISTRY_TEST (env): the plain-Node provider and registry suites to run (defaults: the current ones).
//
// Since the incident of 2026-10-09 (D-044) the whole run is started as `node tools/guarded-window.mjs tools/regress.mjs <tag> ...`, which makes the run's own folder in C:\frontier-tmp,
// puts TEMP there and confines every Node process of the run to removing only that folder, the throwaway profiles and the repo's `out` folder. This file removes nothing itself.
// The plain-Node suites are started so that no other guard stands over them: the older ones through tools/guarded.mjs (its own fresh folder), the 13.x ones and the guard's own
// directly (they have the guard in them and need TEMP to be C:\frontier-tmp itself and FRONTIER_MAY_REMOVE=1, which the owner has allowed in words).
import { REPO_WIN } from './paths.mjs'
import { spawnSync } from 'node:child_process'
import { appendFileSync, copyFileSync, statSync, writeFileSync } from 'node:fs'
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
// launchers that seed their own profile (run54.mjs, run55.mjs): their exit code decides, and the totals line they print is shown
const launcher = (script, mode, label, what) => {
  const r = spawnSync(process.execPath, [join(here, script), mode], { encoding: 'utf8', timeout: 900000, env: { ...process.env, NODE_NO_WARNINGS: '1' } })
  const out = (r.stdout ?? '') + (r.stderr ?? '')
  const total = out.match(/(\d+\/\d+|CRASHED[^\n]*?)\s+\(exit/)?.[1] ?? 'no summary'
  note(r.status === 0, `${r.status === 0 ? 'OK  ' : 'BAD '} ${pfx(label).padEnd(26)} ${what.padEnd(58)} ${total}`)
}

// The suites that have the guard of tools/fsguard.mjs in them, and the one that is the guard's own: run directly, without the window wrapper's preload (their own guard is stricter).
const OWN_GUARD = new Set(['verify-13-2.mjs', 'verify-13-3.mjs', 'verify-13-4.mjs', 'verify-13-5.mjs', 'verify-fsguard.mjs', 'verify-14-2.mjs', 'verify-14-3.mjs'])
// A launcher that starts Electron on a throwaway profile is not a plain-Node suite: it stays under the wrapper's preload like every window launcher.
const LAUNCHERS = new Set(['run91.mjs'])
const NO_PRELOAD = { NODE_OPTIONS: '' }
function nodeSuite(label, script) {
  // (the suites of the real box take about five minutes on their own, more beside the rest of a regression: they get fifteen, since Stage 14)
  if (OWN_GUARD.has(script)) return runNode({ label: pfx(label), script, env: { ...NO_PRELOAD, TEMP: 'C:\\frontier-tmp', TMP: 'C:\\frontier-tmp', FRONTIER_MAY_REMOVE: '1' }, timeoutMs: 900000 })
  if (LAUNCHERS.has(script)) return runNode({ label: pfx(label), script })
  // an older plain-Node suite: under the wrapper's guard like every window launcher (writes are not limited; what it may remove is its own folder, the throwaway profiles in Roaming and out)
  // (these suites make throwaway folders in the real AppData to test this PC's EFS conditions (D-010), so they get the real one back)
  return runNode({ label: pfx(label), script, env: process.env.FRONTIER_REAL_APPDATA ? { APPDATA: process.env.FRONTIER_REAL_APPDATA } : {} })
}

if (parts.includes('node')) {
  for (const [label, script] of [['provider', process.env.PROVIDER_TEST ?? 'provider-node-test-5.mjs'], ['registry', process.env.REGISTRY_TEST ?? 'verify-5-2.mjs'], ['store', 'verify-4-1.mjs'], ['adapter', 'provider-adapter-test-5.mjs'], ['credstore', 'verify-5-3-store.mjs'], ['store54', 'verify-5-4-store.mjs'], ['openai', 'provider-openai-test-5.mjs'], ['rankings', 'verify-6-1.mjs'], ['effort', 'verify-7-1.mjs'], ['markdown', 'verify-7-2.mjs'], ['rewrite', 'verify-7-3.mjs'], ['instructions', 'verify-7-4.mjs'], ['usage', 'verify-8-1.mjs'], ['limits', 'verify-8-2.mjs'], ['askfirst', 'verify-8-3.mjs'], ['backupfile', 'verify-8b-1.mjs'], ['restore', 'verify-8b-2.mjs'], ['encrypt', 'verify-8b-3.mjs'], ['wording', 'verify-8b-wording.mjs'], ['attach91', 'verify-9-1.mjs'], ['images91', 'run91.mjs'], ['attach92', 'verify-9-2.mjs'], ['attach93', 'verify-9-3.mjs'], ['cost94', 'verify-9-4.mjs'], ['backup95', 'verify-9-5.mjs'], ['question101', 'verify-10-1.mjs'], ['instructions102', 'verify-10-2.mjs'], ['memory103', 'verify-10-3.mjs'], ['notes104', 'verify-10-4.mjs'], ['projects105', 'verify-10-5.mjs'], ['projreq106', 'verify-10-6.mjs'], ['backup107', 'verify-10-7.mjs'], ['tools111', 'verify-11-1.mjs'], ['folder111', 'verify-11-1-folder.mjs'], ['tools112', 'verify-11-2.mjs'], ['tools113', 'verify-11-3.mjs'], ['tools114', 'verify-11-4.mjs'], ['tools115', 'verify-11-5.mjs'], ['tools116', 'verify-11-6.mjs'], ['tools117', 'verify-11-7.mjs'], ['workspace121', 'verify-12-1.mjs'], ['workspace122', 'verify-12-2.mjs'], ['workspace123', 'verify-12-3.mjs'], ['proposals124', 'verify-12-4.mjs'], ['review125', 'verify-12-5.mjs'], ['apply126', 'verify-12-6.mjs'], ['cost127', 'verify-12-7.mjs'], ['launcher132', 'verify-13-2.mjs'], ['fsguard', 'verify-fsguard.mjs'], ['scratch133', 'verify-13-3.mjs'], ['programs134', 'verify-13-4.mjs'], ['programs135', 'verify-13-5.mjs'], ['costs136', 'verify-13-6.mjs'], ['connectors142', 'verify-14-2.mjs'], ['connectors143', 'verify-14-3.mjs'], ['costs147', 'verify-14-7.mjs'],...(process.env.EXTRA_NODE_TESTS ? process.env.EXTRA_NODE_TESTS.split(',').map((t, i) => ['extra' + i, t]) : [])]) {
    const r = nodeSuite(label, script)
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
  launcher('run54.mjs', 'dev', 'w54', 'verify-5-4 (who answered, file v3 since 7.4)')
  launcher('run55.mjs', 'dev', 'w55', 'verify-5-5 (two providers)')
  launcher('run62.mjs', 'dev', 'w62', 'verify-6-2/3 (task menu, rankings damaged)')
  launcher('run71.mjs', 'dev', 'w71', 'verify-7-1 (effort menu, restart, damaged efforts)')
  launcher('run72.mjs', 'dev', 'w72', 'verify-7-2 (Markdown replies, links, Copy)')
  launcher('run73.mjs', 'dev', 'w73', 'verify-7-3 (Copy, Regenerate, Edit and send again)')
  launcher('run74.mjs', 'dev', 'w74', 'verify-7-4 (instructions per chat; seeded v1, v2, v3 files)')
  launcher('run81.mjs', 'dev', 'w81', 'verify-8-1 (usage ledger; restart with a cut-off ledger)')
  launcher('run82.mjs', 'dev', 'w82', 'verify-8-2 (spending limits; restart; damaged limits.json)')
  launcher('run83.mjs', 'dev', 'w83', 'verify-8-3 (the question before a large request; restart; damaged file)')
  launcher('run8b.mjs', 'dev', 'w8b', 'verify-8b (backing up and restoring chats; the system dialogs replaced from main)')
  launcher('run8b3.mjs', 'dev', 'w8b3', 'verify-8b3 (encrypting chats on the real secure storage; restart; a lost key; the key back)')
  launcher('run92.mjs', 'dev', 'w92', 'verify-9-2 (attaching files: the dialog, chips, paste, drop, caps)')
  launcher('run95.mjs', 'dev', 'w95', 'verify-9-5 (backups with files: back up, delete, restore, put back sealed)')
  launcher('run94.mjs', 'dev', 'w94', 'verify-9-4 (what files are guessed to cost: the question, a limit, the ledger)')
  launcher('run101.mjs', 'dev', 'w101', 'verify-10-1 (the system question before the app may spend more)')
  launcher('run102.mjs', 'dev', 'w102', 'verify-10-2 (the instructions for every chat)')
  launcher('run104.mjs', 'dev', 'w104', 'verify-10-4 (memory: the page, Remember..., the notes in every request)')
  launcher('run105.mjs', 'dev', 'w105', 'verify-10-5 (projects: the page, chats in a project, History, deleting)')
  launcher('run106.mjs', 'dev', 'w106', 'verify-10-6 (a project in every request of its chats)')
  launcher('run107.mjs', 'dev', 'w107', 'verify-10-7 (backups with the projects and the notes)')
  launcher('run111.mjs', 'dev', 'w111', 'verify-11-1 (nothing new reachable from the page; no tools in a request; a tool call gets nothing)')
  launcher('run112.mjs', 'dev', 'w112', 'verify-11-2 (the audit log: the Tools page, export, delete all, encryption on and off)')
  launcher('run113.mjs', 'dev', 'w113', 'verify-11-3 (the provider loop: a search asked about and run, Stop everything, the caps, both providers)')
  launcher('run114.mjs', 'dev', 'w114', 'verify-11-4 (the window for tools: the switch and caps, the call in the reply, the pages under it, Stop everything, History)')
  launcher('run115.mjs', 'dev', 'w115', 'verify-11-5 (a hostile page: asked again for each search, nothing of yours touched, the rules and the label)')
  launcher('run116.mjs', 'dev', 'w116', 'verify-11-6 (what a search costs: the fee in the ledger, the sums, the limit that stops a search before it is asked)')
  launcher('run123.mjs', 'dev', 'w123', 'verify-12-3 (the code workspace: the Tools page, the folder dialog, the two boxes, a reply that lists and reads, hidden files, refusals)')
  launcher('run125.mjs', 'dev', 'w125', 'verify-12-5 (the Review window and the list of changes: the window as a second page, its policy and bridge, the scroll rule, drop, Escape)')
  launcher('run126.mjs', 'dev', 'w126', 'verify-12-6 (apply and undo: the box, a no and a yes, the applied list, undo, deleting the history, what the pages cannot do)')
  launcher('run127.mjs', 'dev', 'w127', 'verify-12-7 (what a file costs: the question in the middle of a reply, the limit, a proposal\'s text)')
  launcher('run135.mjs', 'dev', 'w135', 'verify-13-5 (running programs: the real box, the self-test, a run on a copy, Stop everything, the switch off)')
  launcher('run146.mjs', 'dev', 'w146', 'verify-14-6 (connectors: adding a program, its tools in the box, a tool on, a call asked and run, an address with a token, removing)')
  launcher('run93.mjs', 'dev', 'w93', 'verify-9-3 (sending and saving files: both providers, History, delete, encryption, the sweep, a model that cannot read them)')
  rec(seeded('w76', 'dev', 'setup-key.mjs,verify-7-6w.mjs', { USER_DATA_DIR: scratch('s76'), WIPE_USER_DATA: '1', MOCK_PORT: MOCK }), pfx('w76'), 'verify-7-6 (header one row, chat bar under the box)')
  const mtime = statSync(join(P, 'preferences.json')).mtimeMs
  rec(seeded('34b', 'dev', 'verify-3-4b.mjs', { USER_DATA_DIR: P, MOCK_PORT: MOCK, EXPECT_MODEL: 'claude-fable-5-1', PREFS_MTIME_MS: String(mtime) }), pfx('34b'), 'verify-3-4b (restart)')
}

if (parts.includes('seeds')) {
  const manifest = ensureSeeds()
  for (const m of manifest) {
    rec(seeded(`s3c-${m.name}`, 'dev', 'verify-3-5.mjs', { USER_DATA_DIR: scratch('s5seed'), WIPE_USER_DATA: '1', PRESEED_FILE: m.file, EXPECT_MODEL: m.expectModel, SEED_SHA: m.sha, SEED_NAME: m.name, WARN_ABOUT: m.warnAbout ? String(m.warnAbout) : '' }), pfx(`s3c-${m.name}`).slice(0, 26), 'verify-3-5 (saved choice)')
  }
}

if (parts.includes('scenarios')) {
  // the scenarios compare against a saved copy of the project's registry: it is made again from the current file (nothing is removed: the wrapper allows only its own folder)
  copyFileSync(join(REPO_WIN, 'registry', 'models.json'), join(OUT, 'registry-saved.json'))
  for (const s of ['wrong-version', 'no-usable-models', 'default-missing', 'default-is-broken-entry', 'one-bad-entry', 'unknown-provider', 'reordered', 'default-sonnet', 'saved-skipped', 'broken-json-syntax']) {
    const run = spawnSync(process.execPath, [join(here, 'run-scenario.mjs'), s], { encoding: 'utf8', timeout: 900000, env: { ...process.env, NODE_NO_WARNINGS: '1' } })
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
  launcher('run54.mjs', 'preview', 'prev-w54', 'built: verify-5-4')
  launcher('run55.mjs', 'preview', 'prev-w55', 'built: verify-5-5')
  launcher('run62.mjs', 'preview', 'prev-w62', 'built: verify-6-2 (menu, marks)')
  launcher('run71.mjs', 'preview', 'prev-w71', 'built: verify-7-1 (effort menu, restart, seeds)')
  launcher('run72.mjs', 'preview', 'prev-w72', 'built: verify-7-2 (Markdown replies, links, Copy)')
  launcher('run73.mjs', 'preview', 'prev-w73', 'built: verify-7-3 (Copy, Regenerate, Edit and send again)')
  launcher('run74.mjs', 'preview', 'prev-w74', 'built: verify-7-4 (instructions per chat)')
  launcher('run81.mjs', 'preview', 'prev-w81', 'built: verify-8-1 (usage ledger, restart)')
  launcher('run82.mjs', 'preview', 'prev-w82', 'built: verify-8-2 (spending limits, restart, damaged file)')
  launcher('run83.mjs', 'preview', 'prev-w83', 'built: verify-8-3 (the question before a large request, restart, damaged file)')
  launcher('run8b.mjs', 'preview', 'prev-w8b', 'built: verify-8b (backing up and restoring chats)')
  launcher('run8b3.mjs', 'preview', 'prev-w8b3', 'built: verify-8b3 (encrypting chats; restart; a lost key; the key back)')
  launcher('run92.mjs', 'preview', 'prev-w92', 'built: verify-9-2 (attaching files)')
  launcher('run95.mjs', 'preview', 'prev-w95', 'built: verify-9-5 (backups with files)')
  launcher('run94.mjs', 'preview', 'prev-w94', 'built: verify-9-4 (what files are guessed to cost)')
  launcher('run101.mjs', 'preview', 'prev-w101', 'built: verify-10-1 (the system question)')
  launcher('run102.mjs', 'preview', 'prev-w102', 'built: verify-10-2 (the instructions for every chat)')
  launcher('run104.mjs', 'preview', 'prev-w104', 'built: verify-10-4 (memory)')
  launcher('run105.mjs', 'preview', 'prev-w105', 'built: verify-10-5 (projects)')
  launcher('run106.mjs', 'preview', 'prev-w106', 'built: verify-10-6 (projects in requests)')
  launcher('run107.mjs', 'preview', 'prev-w107', 'built: verify-10-7 (backups with projects and notes)')
  launcher('run111.mjs', 'preview', 'prev-w111', 'built: verify-11-1 (nothing new reachable; no tools in a request)')
  launcher('run112.mjs', 'preview', 'prev-w112', 'built: verify-11-2 (the audit log)')
  launcher('run113.mjs', 'preview', 'prev-w113', 'built: verify-11-3 (the provider loop)')
  launcher('run114.mjs', 'preview', 'prev-w114', 'built: verify-11-4 (the window for tools)')
  launcher('run115.mjs', 'preview', 'prev-w115', 'built: verify-11-5 (a hostile page)')
  launcher('run116.mjs', 'preview', 'prev-w116', 'built: verify-11-6 (what a search costs)')
  launcher('run123.mjs', 'preview', 'prev-w123', 'built: verify-12-3 (the code workspace)')
  launcher('run125.mjs', 'preview', 'prev-w125', 'built: verify-12-5 (the Review window)')
  launcher('run126.mjs', 'preview', 'prev-w126', 'built: verify-12-6 (apply and undo)')
  launcher('run127.mjs', 'preview', 'prev-w127', 'built: verify-12-7 (what a file costs)')
  launcher('run135.mjs', 'preview', 'prev-w135', 'built: verify-13-5 (running programs)')
  launcher('run146.mjs', 'preview', 'prev-w146', 'built: verify-14-6 (connectors)')
  launcher('run93.mjs', 'preview', 'prev-w93', 'built: verify-9-3 (sending and saving files)')
  rec(seeded('prev-w76', 'preview', 'setup-key.mjs,verify-7-6w.mjs', { USER_DATA_DIR: scratch('s76p'), WIPE_USER_DATA: '1', MOCK_PORT: MOCK }), pfx('prev-w76'), 'built: verify-7-6 (header one row, chat bar)')
  stage4('preview')
}

const clean = results.filter(Boolean).length
const last = `\n${clean}/${results.length} runs clean`
console.log(last)
appendFileSync(summary, last + '\n')
process.exit(results.every(Boolean) ? 0 : 1)
