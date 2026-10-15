// Slice 14.1 (D-045): THE PROBE, the gate of Stage 14. Can a connector (an MCP server: a program that stays and talks over its standard streams) live in the Stage 13 box,
// reliably, through the launcher's serve mode? The battery runs against the reference server (tools/fixtures14/ref-server.mjs, no package) in three placements:
//   box       the launcher's serve mode, no network: every forbidden thing must be stopped, every allowed thing must work
//   box+net   the same with the network ability: the internet is reached, this PC's loopback still is not
//   plain     the program started directly (the "as you" placement): the SAME battery must find every door open, or the checks prove nothing
// and it measures the time of a round trip. Each placement runs twice (ROUNDS). The stop rule of the plan: if the box cannot talk reliably, Stage 14's boxed placement stops here.
//
// Run: FRONTIER_MAY_REMOVE=1 TEMP=C:\frontier-tmp node tools/probe-14-1.mjs [rounds]
//   It removes the one folder it makes (C:\frontier-tmp\probe14-<random>) at its end, so it runs only with the owner's narrow permission (2026-10-09), under tools/fsguard.mjs.
import './ts-resolve.mjs'
import { checker } from './cdp.mjs'
import crypto from 'node:crypto'
import fs from 'node:fs'
import net from 'node:net'
import os from 'node:os'
import { win32 } from 'node:path'
import { execFileSync, spawn } from 'node:child_process'
import { installFsGuard } from './fsguard.mjs'
import { REPO_URL, TOOLS } from './paths.mjs'

if (process.env.FRONTIER_MAY_REMOVE !== '1' || os.tmpdir().toLowerCase() !== 'c:\\frontier-tmp') {
  console.log('NOT RUN: needs FRONTIER_MAY_REMOVE=1 and TEMP=C:\\frontier-tmp (the owner\'s narrow permission: only folders this run makes there are removed).')
  process.exit(3)
}
const ROUNDS = Number(process.argv[2] ?? 2)
const ROOT = win32.join('C:\\frontier-tmp', `probe14-${crypto.randomBytes(4).toString('hex')}`)
fs.mkdirSync(ROOT, { recursive: true })
const guard = installFsGuard({ write: [ROOT], remove: [ROOT] })
const check = checker()
const { createCommandRunner, listMounts, sweepMounts } = await import(`${REPO_URL}/src/main/commandRunner.ts`)
const { connectMcp, createStdioWire, McpError } = await import(`${REPO_URL}/src/main/mcpClient.ts`)

const NODE = win32.join(process.env.ProgramFiles, 'nodejs', 'node.exe')
const RUN = win32.join(ROOT, 'run')
const HOME = win32.join(RUN, 'connectors', 'probe')
const APP = win32.join(HOME, 'app')
const DATA = win32.join(HOME, 'data')
for (const d of [APP, DATA]) fs.mkdirSync(d, { recursive: true })
fs.copyFileSync(win32.join(TOOLS, 'fixtures14', 'ref-server.mjs'), win32.join(APP, 'ref-server.mjs'))
const CANARY = win32.join(ROOT, 'canary.txt')
fs.writeFileSync(CANARY, 'CANARY-14-1')
const runner = createCommandRunner({ runRoot: RUN })

// a listener on this PC's loopback: the box must not reach it, a plain program must
const listener = net.createServer((s) => s.end())
await new Promise((r) => listener.listen(0, '127.0.0.1', r))
const LOOP_PORT = listener.address().port
const ms = (t0) => Date.now() - t0

async function startBox(network, era = 'modern') {
  const handle = await runner.serve({
    container: 'FrontierApp.Probe14',
    homeDir: HOME,
    dataDir: DATA,
    program: NODE,
    args: ['<<HOME>>\\app\\ref-server.mjs', '--era', era],
    network
  })
  if (!('stdin' in handle)) throw new Error('the box did not start: ' + JSON.stringify(handle))
  let tail = ''
  handle.stderr.on('data', (c) => {
    tail = (tail + c.toString('utf8')).slice(-2000)
  })
  return { streams: handle, end: () => handle.close(), ended: handle.ended, kill: () => handle.kill(), tail: () => tail }
}

function startPlain(era = 'modern') {
  const child = spawn(NODE, [win32.join(APP, 'ref-server.mjs'), '--era', era], { cwd: DATA, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true })
  child.stderr.resume()
  const ended = new Promise((resolve) => child.on('close', (code) => resolve({ kind: 'ended', exitCode: code, inputEnded: true, leftoverAfter: 0 })))
  return { streams: child, end: () => child.stdin.end(), ended, kill: () => child.kill(), tail: () => '' }
}

const textOf = (answer) => (answer.kind === 'result' ? answer.result.content?.[0]?.text ?? '' : `RPC ${answer.code} ${answer.message}`)

async function battery(label, place, started) {
  const t0 = Date.now()
  const wire = createStdioWire(started.streams)
  let session
  try {
    session = await connectMcp(wire, { signal: AbortSignal.timeout(60000) })
  } catch (error) {
    check(`${label}: the protocol opens`, false, `${error.message} | ${started.tail()}`)
    return
  }
  check(`${label}: the protocol opens (${session.era} ${session.version}) in ${ms(t0)} ms`, session.era === 'modern')
  const call = (name, args = {}, timeout = 30000) => session.callTool(name, args, AbortSignal.timeout(timeout))
  const listed = await session.listTools(AbortSignal.timeout(30000))
  check(`${label}: tools/list answers (${listed.tools.length} tools)`, listed.tools.length === 14)

  const t1 = Date.now()
  let good = 0
  for (let i = 0; i < 1000; i++) {
    const said = textOf(await call('echo', { text: `n${i}` }))
    if (said === `n${i}`) good++
  }
  const each = ms(t1) / 1000
  check(`${label}: 1,000 round trips in order (${each.toFixed(2)} ms each)`, good === 1000)

  const unicode = 'héllo 😀 ✓ 中文 \u00e9\u0301'
  check(`${label}: UTF-8 and emoji arrive unchanged`, textOf(await call('echo', { text: unicode })) === unicode)
  const big = textOf(await call('big', { chars: 900_000 }))
  check(`${label}: a message of about 0.9 MB arrives whole`, big.length === 900_000)

  const t2 = Date.now()
  check(`${label}: a 100 MB flood of the error stream does not stall it`, textOf(await call('spam', { mb: 100 }, 120000)) === 'spammed', `${ms(t2)} ms`)
  check(`${label}: and it still answers afterwards`, textOf(await call('echo', { text: 'after' })) === 'after')

  const who = JSON.parse(textOf(await call('whoami')))
  if (place === 'plain') {
    check(`${label}: (plain) the environment is the person's own`, who.env.includes('APPDATA') || who.env.includes('USERNAME'))
  } else {
    check(`${label}: (box) the environment is the box's own: no APPDATA, no USERNAME, no app variables`, !who.env.includes('APPDATA') && !who.env.includes('USERNAME') && !who.env.some((k) => /^(FRONTIER|ELECTRON|NODE_OPTIONS)/i.test(k)), who.env.join(','))
    check(`${label}: (box) it works in its data folder on a drive letter of its own`, /^[D-Z]:\\data$/i.test(who.cwd), who.cwd)
  }

  const read = textOf(await call('fs', { op: 'read', path: CANARY }))
  const home = textOf(await call('fs', { op: 'list', path: os.homedir() }))
  const ownWrite = textOf(await call('fs', { op: 'write', path: 'written.txt' }))
  const appWrite = textOf(await call('fs', { op: 'write', path: '..\\app\\planted.txt' }))
  const appRead = textOf(await call('fs', { op: 'read', path: '..\\app\\ref-server.mjs' }))
  const loop = textOf(await call('net', { host: '127.0.0.1', port: LOOP_PORT }))
  const internet = textOf(await call('net', { host: '1.1.1.1', port: 443 }))
  check(`${label}: it can write in its own data folder`, ownWrite === 'ok written', ownWrite)
  check(`${label}: it can read its own copy of its folder`, appRead.startsWith('ok '), appRead)
  if (place === 'plain') {
    check(`${label}: (plain, every door open) it reads a file outside`, read === 'ok CANARY-14-1', read)
    check(`${label}: (plain) it lists the user folder`, home.startsWith('ok '), home)
    check(`${label}: (plain) it writes into its program folder`, appWrite === 'ok written', appWrite)
    check(`${label}: (plain) it reaches this PC's loopback`, loop === 'ok connected', loop)
    check(`${label}: (plain) it reaches the internet`, internet === 'ok connected', internet)
  } else {
    check(`${label}: (box) it cannot read a file outside`, read.startsWith('error '), read)
    check(`${label}: (box) it cannot even list the user folder`, home.startsWith('error '), home)
    check(`${label}: (box) it cannot write into its program folder`, appWrite.startsWith('error '), appWrite)
    check(`${label}: (box) it cannot reach this PC's loopback`, loop.startsWith('error '), loop)
    if (place === 'box') check(`${label}: (box, no network) it cannot reach the internet`, internet.startsWith('error '), internet)
    else check(`${label}: (box WITH network) it reaches the internet`, internet === 'ok connected', internet)
  }
  // the planted file is taken away again by the probe (it is inside ROOT)
  fs.rmSync(win32.join(APP, 'planted.txt'), { force: true })

  // a cancelled call: the server stops and never answers it; the connection lives on
  const t3 = Date.now()
  let stopped = false
  try {
    await session.callTool('sleep', { ms: 30000 }, AbortSignal.timeout(300))
  } catch (error) {
    stopped = error instanceof McpError && error.fault === 'timeout'
  }
  check(`${label}: a call past its clock ends at once and is cancelled at the server (${ms(t3)} ms)`, stopped && ms(t3) < 3000)
  check(`${label}: the connection lives on after it`, textOf(await call('echo', { text: 'still' })) === 'still')

  // closing the input ends it (the stdio transport's shutdown)
  const t4 = Date.now()
  started.end()
  const end = await Promise.race([started.ended, new Promise((r) => setTimeout(() => r({ kind: 'hang' }), 20000))])
  check(`${label}: closing its input ends it (${ms(t4)} ms)`, end.kind === 'ended' && end.inputEnded === true && end.leftoverAfter === 0, JSON.stringify(end))
  return each
}

async function tooBig(label, started) {
  const session = await connectMcp(createStdioWire(started.streams), { signal: AbortSignal.timeout(60000) })
  let fault = null
  try {
    await session.callTool('big', { chars: 1_500_000 }, AbortSignal.timeout(30000))
  } catch (error) {
    fault = error.fault
  }
  check(`${label}: a message larger than 1 MB ends the connection`, fault === 'closed', String(fault))
  started.kill()
  await started.ended
}

async function appDies(label) {
  // a stand-in app starts a boxed connector and is then killed (not its children): the launcher must notice and end the box
  const child = spawn(process.execPath, [win32.join(TOOLS, 'fixtures14', 'fake-app.mjs')], {
    env: { ...process.env, FA_REPO_URL: REPO_URL, FA_ROOT: RUN, FA_HOME: HOME, FA_DATA: DATA, FA_NODE: NODE, FA_CONTAINER: 'FrontierApp.Probe14' },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true
  })
  let said = ''
  child.stdout.on('data', (c) => (said += c))
  child.stderr.on('data', (c) => (said += c))
  const t0 = Date.now()
  while (!/SERVERPID (\d+)/.test(said) && ms(t0) < 60000 && child.exitCode === null) await new Promise((r) => setTimeout(r, 100))
  const pid = Number(/SERVERPID (\d+)/.exec(said)?.[1] ?? 0)
  check(`${label}: the stand-in app started a boxed connector`, pid > 0, said.slice(0, 300))
  if (pid === 0) return
  const alive = (p) => execFileSync('tasklist.exe', ['/FI', `PID eq ${p}`, '/NH'], { encoding: 'utf8', windowsHide: true }).includes(String(p))
  check(`${label}: the connector is running`, alive(pid))
  execFileSync('taskkill.exe', ['/PID', String(child.pid), '/F'], { windowsHide: true, stdio: 'ignore' })
  const t1 = Date.now()
  while (alive(pid) && ms(t1) < 15000) await new Promise((r) => setTimeout(r, 250))
  check(`${label}: killing the app (only the app) ends the connector within 15 s (${ms(t1)} ms)`, !alive(pid))
  // Node ends the launcher with the app (libuv), so the launcher cannot take its drive letter away: the app's start-up sweep does (Stage 13, sweepMounts)
  await new Promise((r) => setTimeout(r, 1000))
  const left = listMounts(RUN)
  const swept = sweepMounts(RUN)
  check(`${label}: what a killed app leaves (${left.length} drive letter) is taken away by the start-up sweep`, listMounts(RUN).length === 0 && swept.length === left.length)
}

const timings = []
try {
  for (let round = 1; round <= ROUNDS; round++) {
    timings.push({ box: await battery(`round ${round} box`, 'box', await startBox(false)) })
    timings.push({ net: await battery(`round ${round} box+net`, 'box+net', await startBox(true)) })
    timings.push({ plain: await battery(`round ${round} plain`, 'plain', startPlain()) })
    // the older revision in the box, and one that says nothing to an unknown request (the probe times out and falls back)
    for (const era of ['legacy', 'silent-legacy']) {
      const s = await startBox(false, era)
      const t0 = Date.now()
      try {
        const session = await connectMcp(createStdioWire(s.streams), { signal: AbortSignal.timeout(60000) })
        const listed = await session.listTools(AbortSignal.timeout(30000))
        const said = await session.callTool('echo', { text: 'legacy' }, AbortSignal.timeout(30000))
        check(`round ${round} box ${era}: falls back to the handshake (${session.version}) in ${ms(t0)} ms and calls work`, session.era === 'legacy' && listed.tools.length === 14 && textOf(said) === 'legacy')
      } catch (error) {
        check(`round ${round} box ${era}: falls back to the handshake`, false, `${error.message} | ${s.tail()}`)
      }
      s.end()
      await s.ended
    }
    await tooBig(`round ${round} box`, await startBox(false))
    check(`round ${round}: no drive letter is left by a stopped, a closed or a killed connector`, listMounts(RUN).length === 0, JSON.stringify(listMounts(RUN)))
    await appDies(`round ${round}`)
  }
  check('no drive letter of the probe is left', listMounts(RUN).length === 0, JSON.stringify(listMounts(RUN)))
  console.log('TIMINGS ' + JSON.stringify(timings))
} catch (error) {
  check(`the probe ran to its end: ${String(error?.stack ?? error).slice(0, 600)}`, false)
} finally {
  listener.close()
  runner.stopAll()
  await new Promise((r) => setTimeout(r, 2000))
  try {
    fs.rmSync(ROOT, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 })
  } catch (error) {
    console.log(`(the probe folder ${ROOT} could not be removed: ${error.message})`)
  }
  guard.uninstall?.()
}
const ok = check.summary()
process.exit(ok ? 0 : 1)
