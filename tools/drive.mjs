// Test driver (lives outside the project on purpose). Runs one or more window suites via run-with-app.mjs,
// each launch on a scratch profile INSIDE the real %APPDATA% (so the EFS conditions of this PC apply),
// and prints only the totals and the FAIL lines. Output of every run goes to <label>.out.txt.
import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { OUT, SHOTS } from './paths.mjs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

export const here = dirname(fileURLToPath(import.meta.url))
export { OUT }
export const APPDATA = process.env.APPDATA
export const REAL_PROFILE = join(APPDATA, 'frontier-app')
export const scratch = (name) => {
  const dir = join(APPDATA, `frontier-app-test-scratch-${name}`)
  if (dir.toLowerCase() === REAL_PROFILE.toLowerCase()) throw new Error('scratch profile equals the real profile')
  return dir
}

/**
 * A force-killed Electron lingers for a few seconds and keeps its debug port. The next launch must not connect to
 * that dying page (this made verify-2-3's "dialog is closed at first" fail once): wait until the port refuses.
 */
function waitForPortFree(port) {
  const script = `const t0 = Date.now(); const p = ${Number(port)};
    (async () => { while (Date.now() - t0 < 30000) { try { await fetch('http://127.0.0.1:' + p + '/json'); } catch { process.exit(0) } await new Promise(r => setTimeout(r, 250)) } console.error('port ' + p + ' still busy after 30 s'); process.exit(1) })()`
  const r = spawnSync(process.execPath, ['-e', script], { encoding: 'utf8' })
  if (r.status !== 0) throw new Error(r.stderr.trim() || `debug port ${port} did not become free`)
}

/** The seed files for verify-3-5 (stale, corrupt and hostile preferences.json) are generated, not committed (one is 5 MB). */
export function ensureSeeds() {
  const manifest = join(OUT, 'seeds', 'manifest.json')
  if (!existsSync(manifest)) {
    const r = spawnSync(process.execPath, [join(here, 'make-seeds.mjs')], { encoding: 'utf8' })
    if (r.status !== 0) throw new Error('make-seeds.mjs failed: ' + (r.stderr || r.stdout))
  }
  return JSON.parse(readFileSync(manifest, 'utf8'))
}

/** The first line of a run's output that says why a script died (an uncaught error, the page going away, an abort). */
function crashReason(text, { app = true } = {}) {
  const lines = text.split('\n')
  const pick = (re) => lines.find((l) => re.test(l))
  const first =
    pick(/^ABORT/) ??
    pick(/^[\w.]*Error: /) ??
    pick(/^\[?[\w.]*Error[\]:]/) ??
    pick(/^Warning: Detected unsettled top-level await/) ??
    lines.find((l) => /^node:internal/.test(l)) ?? 'no error line (it exited without printing a summary)'
  // the page/app went away: the connection helpers now say so, and the runner says what state the app was in
  const appLines = lines.filter((l) => /^(!! the app exited|app state at the end)/.test(l))
  if (app && appLines.length === 0) appLines.push('(no app-state line: the runner did not get to print one)')
  return [first.trim(), ...appLines.map((l) => l.trim())].join(' | ').slice(0, 400)
}

/**
 * Reads what a launch printed. A suite that dies before its "N/M checks passed" line (an uncaught error, the page or the app going
 * away) used to be shown as "0/0", which looks like "zero checks ran" and hides the reason. It is now a CRASH, with the checks that
 * did pass before it and the first line that says why.
 */
function analyse(out, run) {
  const lines = out.split('\n')
  const totals = lines.map((l) => l.match(/^(\d+)\/(\d+) checks passed/)).filter(Boolean)
  const fails = lines.filter((l) => /^(FAIL|ABORT|!!)/.test(l))
  const passed = totals.reduce((n, m) => n + Number(m[1]), 0)
  const total = totals.reduce((n, m) => n + Number(m[2]), 0)
  const crashes = []
  const parts = out.split(/^===== (.+?) =====$/m) // [before, name1, body1, name2, body2, ...]
  for (let i = 1; i < parts.length; i += 2) {
    const body = parts[i + 1]
    const exit = body.match(/^-- .+ exit code (\d+)/m)
    if (exit && exit[1] !== '0' && !/^\d+\/\d+ checks passed/m.test(body)) {
      crashes.push({ name: parts[i], passLines: (body.match(/^PASS /gm) ?? []).length, reason: crashReason(body + '\n' + parts.slice(i + 2).join('\n')) })
    }
  }
  if (run?.error) crashes.push({ name: '(the run itself)', passLines: 0, reason: String(run.error.message ?? run.error).slice(0, 200) })
  const detail = crashes.length
    ? `CRASHED ${crashes.map((c) => `${c.name} died after ${c.passLines} passing checks: ${c.reason}`).join('; ')}`
    : `${passed}/${total}`
  return { fails, passed, total, crashes, detail }
}

/** Runs one launch. Returns { code, passed, total, fails[], crashes[], detail, ok }. */
export function runApp(options) {
  const first = runAppOnce(options)
  // A launch whose window or app was LOST (the suite died because its page connection closed, or the app was gone) is run once more, and
  // the summary says so. Evidence points at something outside the app: an instance started from the Claude desktop app's preview ran
  // against the real profile and shut down at the same second as one lost window, and the other two losses came at moments when the
  // desktop app was used (see tools/README.md). A real crash will show again on the retry; a retry that passes is reported as RETRIED,
  // never hidden. NO_RETRY=1 turns it off (negative controls, when diagnosing).
  const lost = /the page connection (is )?closed|app state at the end: (GONE|ALREADY EXITED)/
  if (!first.ok && process.env.NO_RETRY !== '1' && first.crashes.length > 0 && first.crashes.every((c) => lost.test(c.reason)) && first.fails.every((f) => /^!! the app exited by itself/.test(f))) {
    console.log(`!! RETRY: ${options.label} lost its window or its app (${first.crashes[0].reason.slice(0, 150)}); launching it once more`)
    const second = runAppOnce({ ...options, label: `${options.label}-retry` })
    second.detail = `${second.detail}  [RETRIED: the first attempt lost its window: ${first.crashes[0].reason.slice(0, 110)}]`
    return second
  }
  return first
}

function runAppOnce({ label, mode = 'dev', scripts, env = {}, port = 9222, timeoutMs = 300000 }) {
  if (process.env.NO_PORT_WAIT !== "1") waitForPortFree(port)
  const fullEnv = {
    ...process.env,
    NODE_NO_WARNINGS: '1',
    LOG_LABEL: label,
    ...env
  }
  // anything left over from a previous run in this process must not leak in
  for (const k of ['PRESEED_FILE']) if (!(k in env)) delete fullEnv[k]
  const run = spawnSync(process.execPath, [join(here, 'run-with-app.mjs'), mode, scripts, SHOTS, String(port)], {
    env: fullEnv,
    encoding: 'utf8',
    timeout: timeoutMs,
    maxBuffer: 64 * 1024 * 1024
  })
  const out = (run.stdout ?? '') + (run.stderr ?? '')
  writeFileSync(join(OUT, `${label}.out.txt`), out)
  const { fails, passed, total, crashes, detail } = analyse(out, run)
  const ok = run.status === 0 && fails.length === 0 && crashes.length === 0 && total > 0 && passed === total
  console.log(`${ok ? 'OK  ' : 'BAD '} ${label.padEnd(18)} ${scripts.padEnd(60)} ${detail}  (exit ${run.status})`)
  for (const f of fails.slice(0, 12)) console.log('       ' + f.slice(0, 240))
  return { code: run.status, passed, total, fails, crashes, detail, ok }
}

/** Runs a plain Node script. */
export function runNode({ label, script, args = [], env = {} }) {
  const run = spawnSync(process.execPath, [join(here, script), ...args], { env: { ...process.env, NODE_NO_WARNINGS: '1', ...env }, encoding: 'utf8', timeout: 300000, maxBuffer: 64 * 1024 * 1024 })
  const out = (run.stdout ?? '') + (run.stderr ?? '')
  writeFileSync(join(OUT, `${label}.out.txt`), out)
  const m = [...out.matchAll(/^(\d+)\/(\d+) checks passed/gm)].at(-1)
  const fails = out.split('\n').filter((l) => /^(FAIL|ABORT)/.test(l))
  const ok = run.status === 0 && !!m && m[1] === m[2] && fails.length === 0
  const detail = m ? m[1] + '/' + m[2] : `CRASHED after ${(out.match(/^PASS /gm) ?? []).length} passing checks: ${run.error ? String(run.error.message).slice(0, 200) : crashReason(out)}`
  console.log(`${ok ? 'OK  ' : 'BAD '} ${label.padEnd(18)} ${script.padEnd(60)} ${detail}  (exit ${run.status})`)
  for (const f of fails.slice(0, 12)) console.log('       ' + f.slice(0, 240))
  return { ok, detail }
}

export const profileFile = (dir, name) => join(dir, name)
export { existsSync, readFileSync, statSync }
