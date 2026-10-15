// Slices 14.3, 14.5 and 14.6 (D-045): THE CONNECTORS SERVICE WITH REAL PROGRAMS, under plain Node, Windows only. The real service, store, audit log, runtime and core; the REAL box
// of Stage 13 in its serve mode (a container of the connector's own); a program that runs "as you"; a web address served on this PC's loopback. A played person (the system's
// box and the file dialog). The reference server is tools/fixtures14/ref-server.mjs (no package). What it shows:
//   A. adding a program: the box shows exactly what runs, a no adds nothing, the checks on the name, the arguments and the file;
//   B. starting it in the box and listing its tools (what is offered and what is not, and why);
//   C. switching a tool on: the box shows the connector's own words and the arguments; a tool that is not offered is never switched on;
//   D. a reply that calls it: asked, run in the box, labelled; inside the box the program sees only its copy and its data folder, which stays between starts;
//   E. Stop everything during a call: the call ends at once and so does the connector; F. a connector with no call for a while is stopped;
//   G. a tool the connector changes after it was switched on is switched off and marked; a reply cannot call it;
//   H. the grants: the network, and a copy of the workspace (an argument names it; without the grant it does not start);
//   I. "as you": only after the name is typed and the box says yes; it then has the person's rights; back into the box at once;
//   J. a web address: a token sealed, never shown, held like an API key; a wrong token says so;
//   K. removing one: asked, its folder and token gone; L. the caps (10 connectors, 20 tools on); M. the app closing; N. the audit log of it all.
//
// Run: FRONTIER_MAY_REMOVE=1 FRONTIER_KEEP_TEMP=1 TEMP=C:\frontier-tmp TMP=C:\frontier-tmp node tools/verify-14-3.mjs      (ONLY=A,B,D runs some parts; later parts need earlier ones)
//   It removes its own folder and the code under test removes connectors' folders inside it, so it will not start without FRONTIER_MAY_REMOVE=1 (set only when the owner has allowed
//   removing in words), and it works under the guard of tools/fsguard.mjs: this process can write and remove only inside its own new folder in C:\frontier-tmp. The box uses a few
//   fixed connector ids, so the containers it makes are the same ones every run.
import './ts-resolve.mjs'
import { checker } from './cdp.mjs'
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import { win32 } from 'node:path'
import { installFsGuard } from './fsguard.mjs'
import { REPO_URL, TOOLS } from './paths.mjs'

if (process.env.FRONTIER_MAY_REMOVE !== '1') {
  console.log('NOT RUN: this suite removes folders it made itself and tests code that removes. Set FRONTIER_MAY_REMOVE=1 only when the owner has allowed it in words.')
  process.exit(3)
}
if (os.tmpdir().toLowerCase() !== 'c:\\frontier-tmp') {
  console.log(`NOT RUN: the temp folder is ${os.tmpdir()}; a check that removes may only work in C:\\frontier-tmp.`)
  process.exit(3)
}
const check = checker()
const ONLY = process.env.ONLY ? new Set(process.env.ONLY.split(',')) : null
const guard = async (name, fn) => {
  if (ONLY && !ONLY.has(name)) return
  try {
    await fn()
  } catch (error) {
    check(`${name} did not run to its end: ${String(error?.stack ?? error).slice(0, 700)}`, false)
  }
}
const show = (v) => JSON.stringify(v)?.slice(0, 400)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const SRC = `${REPO_URL}/src`
const serviceMod = await import(`${SRC}/main/connectorService.ts`)
const storeMod = await import(`${SRC}/main/connectorStore.ts`)
const boxMod = await import(`${SRC}/main/programBox.ts`)
const runnerMod = await import(`${SRC}/main/commandRunner.ts`)
const progMod = await import(`${SRC}/main/programTools.ts`)
const gateMod = await import(`${SRC}/main/systemQuestion.ts`)
const auditLogMod = await import(`${SRC}/main/auditLog.ts`)
const replyMod = await import(`${SRC}/main/replyTools.ts`)
const regMod = await import(`${SRC}/main/toolRegistry.ts`)
const dataMod = await import(`${SRC}/main/dataFolderGuard.ts`)
const secretsMod = await import(`${SRC}/main/secrets.ts`)
const { CONNECTOR_LIMITS } = await import(`${SRC}/shared/connectors.ts`)
const J = win32.join
const KEY = 'sk-ant-FAKE-KEY-for-the-checks-0123456789'
const TOKEN = 'tok-for-the-checks-7f3a9c2e'
const IDS = ['aaaa00000001', 'aaaa00000002', 'aaaa00000003', 'aaaa00000004', 'aaaa00000005', 'aaaa00000006', 'aaaa00000007', 'aaaa00000008', 'aaaa00000009', 'aaaa00000010', 'aaaa00000011', 'aaaa00000012']

// ----- the scratch world -----
const ROOT = fs.realpathSync.native(fs.mkdtempSync(J(os.tmpdir(), 'frontier-143-')))
const fsGuard = installFsGuard({ write: [ROOT], remove: [ROOT] })
const children = []
process.on('exit', () => {
  // every connector and box ends first (a part that failed may have left them running, and they hold files in the folder)
  try {
    svc?.stopAll()
    box?.stopAll()
  } catch {
    /* ending the rest matters more */
  }
  for (const c of children) {
    try {
      c.kill()
    } catch {
      /* gone */
    }
  }
  try {
    fs.rmSync(ROOT, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
  } catch {
    /* left for the system */
  }
})
const SERVERS = J(ROOT, 'servers', 'ref')
fs.mkdirSync(J(SERVERS, 'lib'), { recursive: true })
fs.writeFileSync(J(SERVERS, 'package.json'), '{"name":"ref","type":"module"}')
fs.copyFileSync(J(TOOLS, 'fixtures14', 'ref-server.mjs'), J(SERVERS, 'lib', 'ref-server.mjs'))
fs.writeFileSync(J(SERVERS, '.env'), `SECRET=${KEY}`) // a hidden, secret-looking file: never copied into the box
const PROGRAM = J(SERVERS, 'lib', 'ref-server.mjs')
const APPDATA = J(ROOT, 'appdata')
fs.mkdirSync(APPDATA)
fs.writeFileSync(J(APPDATA, 'keys.txt'), 'the app data')
fs.writeFileSync(J(ROOT, 'secret.txt'), 'a file of the person, outside the box')
const WS = J(ROOT, 'ws')
fs.mkdirSync(J(WS, 'src'), { recursive: true })
fs.writeFileSync(J(WS, 'src', 'a.txt'), 'workspace file')
fs.writeFileSync(J(WS, 'readme.md'), 'hello')
fs.writeFileSync(J(WS, '.env'), 'HIDDEN=1')
const RUN = J(ROOT, 'run')

// ----- the played person, the box, the service -----
const asked = []
const answers = []
const picks = []
const clock = { t: 1_000_000 }
const gate = gateMod.createQuestionGate(async (_owner, question) => {
  asked.push(question)
  return answers.length === 0 ? true : answers.shift()
}, () => (clock.t += 5_000)) // every look at the clock is a few seconds later: the pause after a no (3 s) is always over by the next question
const secrets = {
  isAvailable: () => true,
  encrypt: (plain) => Buffer.from(`SEALED:${Buffer.from(plain).toString('hex')}`),
  decrypt: (blob) => {
    const t = blob.toString()
    if (!t.startsWith('SEALED:')) throw new Error('not sealed here')
    return Buffer.from(t.slice(7), 'hex').toString()
  }
}
const writeMode = async () => ({ form: 'plain' })
const store = storeMod.createConnectorStore({ pathOf: () => J(APPDATA, 'connectors.json'), box: secrets, writeMode })
const auditLog = auditLogMod.createAuditLog({ pathOf: () => J(APPDATA, 'audit', 'log.jsonl'), box: secrets, writeMode })
const events = []
let auditFailures = 0
const box = boxMod.createProgramBox({ workspaceRoot: () => null, tempDir: ROOT, fixedRunRoot: () => RUN })
const ids = [...IDS]
function makeService(extra = {}) {
  return serviceMod.createConnectorService({
    store,
    gate,
    secrets,
    box: () => box.get(),
    nodePath: () => progMod.resolveProgram('node', progMod.defaultPlaces()),
    workspaceRoot: () => WS,
    pickProgram: async () => (picks.length === 0 ? null : picks.shift()),
    forbidden: async (p) => p.toLowerCase().startsWith(APPDATA.toLowerCase()),
    savedKeys: async () => [{ provider: 'anthropic', key: KEY }],
    record: async (e) => {
      events.push(e)
      try {
        await auditLog.append(e)
      } catch {
        auditFailures++
      }
    },
    connectorId: () => ids.shift(),
    ...extra
  })
}
const svc = makeService()
const byName = async (name) => (await svc.status()).connectors.find((c) => c.name === name)
const what = () => events.filter((e) => e.type === 'connector').map((e) => e.what)

/** A reply with the build's one tool and the connector tools that are on now; `answer` is what the person says to each question. */
async function reply(service = svc) {
  const tools = await service.forReply()
  const ids = await service.onIds()
  const enabled = Object.fromEntries(ids.map((id) => [id, true]))
  const runtime = replyMod.createToolRuntime({
    tools: regMod.createToolRegistry(regMod.BUILT_IN_TOOLS),
    gate,
    guard: dataMod.createDataFolderGuard({ roots: () => [APPDATA] }),
    record: async (e) => void events.push(e),
    holdsSavedKey: async (text) => secretsMod.heldKey(text, [{ provider: 'anthropic', key: KEY }, ...(await service.tokens()).map((key) => ({ provider: 'anthropic', key }))]) !== null
  })
  const ctl = new AbortController()
  const r = runtime.forReply({ owner: null, signal: ctl.signal, settings: { enabled, caps: { steps: 20, seconds: 120 } }, search: async () => { throw new Error('no search') }, connectors: tools })
  let n = 0
  const call = async (name, input) => (await r.runTurn([{ id: `c${++n}`, name, input: { why: 'for the checks', ...input } }])).results[0]
  return { r, call, ctl, specs: r.specs().map((s) => s.name) }
}
const inner = (text) => text.split('\n----\n')[1]?.split('\n----')[0] ?? text

// ============================ A. adding a program ============================
await guard('A', async () => {
  check('A: no connectors at first; nothing is running', (await svc.status()).connectors.length === 0)
  picks.push(PROGRAM)
  answers.push(false)
  const no = await svc.addLocal(null, { name: 'Ref', args: ['--era', 'modern'] })
  const q = asked.at(-1)
  check('A: the box for adding shows exactly what runs, whole: node, the file and its arguments', q?.detail.includes(`node ${PROGRAM} --era modern`), q?.detail.slice(0, 300))
  check('A: ...the folder a copy of which it gets (the one with package.json above the file), and that it runs in the box with no network', q?.detail.includes(`read-only copy of the folder ${SERVERS}`) && /no network/.test(q?.detail ?? ''))
  check('A: a no adds nothing', no.ok === false && no.cancelled === true && (await svc.status()).connectors.length === 0)
  picks.push(PROGRAM)
  const yes = await svc.addLocal(null, { name: 'Ref', args: ['--era', 'modern'] })
  const c = await byName('Ref')
  check('A: a yes adds it, in the box, with no tool on and no grant', yes.ok && c?.place === 'box' && c.tools.length === 0 && c.network === false && c.folder === null && c.state === 'stopped', show(c))
  check('A: the record says it was added', what().includes('added'))
  const before = asked.length
  check('A: a name that is taken, empty or too long is refused before anything is asked', (await svc.addLocal(null, { name: 'ref', args: [] })).ok === false && (await svc.addLocal(null, { name: ' ', args: [] })).ok === false && (await svc.addLocal(null, { name: 'x'.repeat(41), args: [] })).ok === false && asked.length === before)
  check('A: too many arguments, or one with an invisible character, is refused', (await svc.addLocal(null, { name: 'B', args: Array(21).fill('a') })).ok === false && (await svc.addLocal(null, { name: 'B', args: ['a\u200bb'] })).ok === false)
  const cancelled = await svc.addLocal(null, { name: 'B', args: [] })
  check('A: closing the file dialog adds nothing', cancelled.ok === false && cancelled.cancelled === true)
  fs.writeFileSync(J(ROOT, 'notes.txt'), 'x')
  picks.push(J(ROOT, 'notes.txt'))
  check('A: a file that is not a script for node or an .exe is refused', /\.js, \.mjs, \.cjs/.test((await svc.addLocal(null, { name: 'B', args: [] })).error ?? ''))
  fs.writeFileSync(J(APPDATA, 'evil.mjs'), '')
  picks.push(J(APPDATA, 'evil.mjs'))
  check("A: a program in the app's own data folder is refused", /not one a connector may be given/.test((await svc.addLocal(null, { name: 'B', args: [] })).error ?? '') && asked.length === before)
  const stored = fs.readFileSync(J(APPDATA, 'connectors.json'), 'utf8')
  check('A: connectors.json holds it exactly as the app writes it', storeMod.parseConnectors(stored)?.length === 1)
})

// ============================ B. starting it in the box ============================
let ref
await guard('B', async () => {
  ref = await byName('Ref')
  const t0 = Date.now()
  const r = await svc.refresh({ id: ref.id })
  const ms = Date.now() - t0
  ref = await byName('Ref')
  check('B: "Check its tools" starts it in the box and lists its 14 tools', r.ok && ref.state === 'running' && ref.tools.length === 14 && ref.version === '2026-07-28', `${ms} ms ${show(r.ok ? '' : r)}`)
  const tool = (n) => ref.tools.find((t) => t.name === n)
  check('B: the tools the box can show are offered, named ref__<name>', tool('echo').id === 'ref__echo' && tool('opts').id === 'ref__opts' && tool('echo').notOffered === null)
  check('B: the ones it cannot are listed with the reason', /object of its own/.test(tool('nested').notOffered ?? '') && /100,000/.test(tool('longtext').notOffered ?? '') && tool('nested').id === null)
  check('B: every tool starts off; the read-only claim is shown', ref.tools.every((t) => !t.on) && tool('echo').readOnlyClaim === true)
  check('B: the record says it was started', what().includes('started'))
  const homes = fs.readdirSync(J(RUN, 'connectors'))
  check("B: its folder is <run root>\\connectors\\<id>, with its data folder and a copy of its program's folder", homes.includes(ref.id) && fs.existsSync(J(RUN, 'connectors', ref.id, 'data')) && fs.readdirSync(J(RUN, 'connectors', ref.id, 'scratch')).length === 1)
  const copy = J(RUN, 'connectors', ref.id, 'scratch', fs.readdirSync(J(RUN, 'connectors', ref.id, 'scratch'))[0])
  check('B: the copy holds the program and leaves out the hidden, secret-looking .env', fs.existsSync(J(copy, 'lib', 'ref-server.mjs')) && !fs.existsSync(J(copy, '.env')))
})

// ============================ C. switching a tool on ============================
await guard('C', async () => {
  answers.push(false)
  const no = await svc.setTool(null, { id: ref.id, name: 'echo', on: true })
  const q = asked.at(-1)
  check("C: the box shows the connector's own words, the name the model calls it, the arguments and where it runs", /Says back the text it is given\./.test(q.detail) && /ref__echo/.test(q.detail) && /text \(text, up to/.test(q.detail) && /locked box/.test(q.detail) && /says this tool only reads/.test(q.detail), q.detail.slice(0, 400))
  check('C: a no leaves it off', no.ok === false && (await byName('Ref')).tools.find((t) => t.name === 'echo').on === false)
  for (const name of ['echo', 'whoami', 'fs', 'sleep', 'net']) {
    const r = await svc.setTool(null, { id: ref.id, name, on: true })
    if (!r.ok) check(`C: switching ${name} on failed`, false, r.error)
  }
  ref = await byName('Ref')
  check('C: a yes switches it on (five tools now)', ['echo', 'whoami', 'fs', 'sleep', 'net'].every((n) => ref.tools.find((t) => t.name === n).on) && (await svc.status()).toolsOn === 5)
  const before = asked.length
  const nested = await svc.setTool(null, { id: ref.id, name: 'nested', on: true })
  check('C: a tool that is not offered is never switched on, and nobody is asked', nested.ok === false && asked.length === before && /cannot be offered/.test(nested.error))
  check('C: the record says which tools were switched on', events.filter((e) => e.type === 'connector' && e.what === 'tool-on').map((e) => e.tool).sort().join() === 'ref__echo,ref__fs,ref__net,ref__sleep,ref__whoami')
})

// ============================ D. a reply that calls it ============================
await guard('D', async () => {
  const { call, specs } = await reply()
  check('D: the reply offers the five tools that are on (and no other connector tool)', ['ref__echo', 'ref__fs', 'ref__net', 'ref__sleep', 'ref__whoami'].every((n) => specs.includes(n)) && specs.filter((n) => n.includes('__')).length === 5, show(specs))
  const before = asked.length
  const r = await call('ref__echo', { text: 'hello from the model' })
  check('D: a call is asked about, runs in the box, and comes back labelled', asked.length === before + 1 && !r.isError && /text from outside/.test(r.text) && inner(r.text).trim() === 'hello from the model', r.text.slice(0, 200))
  const kinds = events.filter((e) => e.call === events.filter((x) => x.type === 'asked').at(-1).call).map((e) => e.type).join()
  check('D: the record of the call: asked, answered, ran, the numbers, the result', kinds === 'asked,answered,ran,connector-call,result', kinds)
  const who = JSON.parse(inner((await call('ref__whoami', {})).text))
  check("D: in the box, the program has an environment made from nothing (the system's few; none of the app's or the person's own)", !who.env.some((k) => /^(FRONTIER.*|ELECTRON.*|USERNAME|USERDOMAIN|COMPUTERNAME|APPDATA|OneDrive.*|NODE_OPTIONS)$/i.test(k)) && who.env.length < 15, show(who.env))
  check('D: ...it works in its data folder, on a drive letter of the box', /^[A-Z]:\\data$/i.test(who.cwd), who.cwd)
  const outside = inner((await call('ref__fs', { op: 'read', path: J(ROOT, 'secret.txt') })).text)
  check("D: it cannot read the person's files", /^error (EPERM|EACCES|ENOENT)/.test(outside), outside)
  const appData = inner((await call('ref__fs', { op: 'read', path: J(APPDATA, 'keys.txt') })).text)
  check("D: ...nor the app's data", /^error/.test(appData), appData)
  const ownCopy = inner((await call('ref__fs', { op: 'write', path: who.script })).text)
  check('D: it cannot change its own copy (read-only)', /^error/.test(ownCopy), ownCopy)
  const wrote = inner((await call('ref__fs', { op: 'write', path: 'kept.txt' })).text)
  check('D: it can write in its data folder', wrote === 'ok written', wrote)
  const net = inner((await call('ref__net', { host: '1.1.1.1', port: 443 })).text)
  check('D: it has no network (no grant)', /^error/.test(net), net)
  await svc.refresh({ id: ref.id }) // a new start: a new copy, the same data folder
  const kept = inner((await call('ref__fs', { op: 'read', path: 'kept.txt' })).text)
  check('D: its data folder stays between starts', kept === 'ok written by the server', kept)
  check("D: the person's own .env next to the program was never copied (and a key in it never reached the box)", !fs.readdirSync(J(RUN, 'connectors', ref.id, 'scratch')).some((d) => fs.existsSync(J(RUN, 'connectors', ref.id, 'scratch', d, '.env'))))
})

// ============================ E. Stop everything during a call ============================
await guard('E', async () => {
  const { r, ctl } = await reply()
  setTimeout(() => ctl.abort(), 1500)
  const t0 = Date.now()
  const turn = await r.runTurn([{ id: 's1', name: 'ref__sleep', input: { ms: 30_000, why: 'wait' } }])
  const ms = Date.now() - t0
  check('E: Stop ends the call at once, and the reply ends', turn.ended === 'stopped' && ms < 5000, `${turn.ended} ${ms} ms`)
  await sleep(500)
  check('E: ...and the connector is stopped too (it starts again when it is next needed)', (await byName('Ref')).state !== 'running' && what().includes('stopped'))
  const again = await (await reply()).call('ref__echo', { text: 'back' })
  check('E: the next call starts it again', inner(again.text).trim() === 'back')
})

// ============================ F. idle ============================
await guard('F', async () => {
  await svc.stop({ id: ref.id })
  const idle = makeService({ idleMs: 1500 })
  await idle.refresh({ id: ref.id })
  check('F: (a service with a short idle time) it runs', (await idle.status()).connectors.find((c) => c.id === ref.id).state === 'running')
  await sleep(3500)
  check('F: with no call for its idle time, it is stopped', (await idle.status()).connectors.find((c) => c.id === ref.id).state === 'stopped')
  idle.stopAll()
})

// ============================ G. a tool that changes ============================
await guard('G', async () => {
  picks.push(PROGRAM)
  const added = await svc.addLocal(null, { name: 'Rug', args: ['--mode', 'rug-pull-restart'] })
  let rug = await byName('Rug')
  await svc.refresh({ id: rug.id })
  const on = await svc.setTool(null, { id: rug.id, name: 'echo', on: true })
  const oldReply = await reply()
  check('G: (a second connector whose echo changes at its next start) it is added, and echo is on', added.ok && on.ok && oldReply.specs.includes('rug__echo'))
  await svc.refresh({ id: rug.id }) // the next start: echo now says something else
  rug = await byName('Rug')
  const echo = rug.tools.find((t) => t.name === 'echo')
  check('G: the changed tool is switched off and marked "changed"', echo.on === false && echo.changed === true && /now also something new/.test(echo.description), show(echo))
  check('G: the record says so', events.some((e) => e.type === 'connector' && e.what === 'tool-changed' && e.tool === 'rug__echo'))
  check('G: a new reply does not offer it', !(await reply()).specs.includes('rug__echo'))
  const before = asked.length
  const stale = await oldReply.call('rug__echo', { text: 'x' })
  check("G: even a reply whose settings were read before the change cannot call it: the connector's own check refuses it, and nothing is sent", stale.isError && /not switched on any more/.test(stale.text) && asked.length === before + 1, stale.text)
  oldReply.r.setSettings({ enabled: Object.fromEntries((await svc.onIds()).map((id) => [id, true])), caps: { steps: 20, seconds: 120 } }) // what the app does before every turn
  const turned = await oldReply.call('rug__echo', { text: 'x' })
  check('G: with the settings read again (as the app does before every turn), it is refused before anybody is asked', turned.isError && /switched off/.test(turned.text) && asked.length === before + 1, turned.text)
  const back = await svc.setTool(null, { id: rug.id, name: 'echo', on: true })
  check('G: after the person reads it again and says yes, it is on again and no longer "changed"', back.ok && (await byName('Rug')).tools.find((t) => t.name === 'echo').changed === false)
  await svc.setTool(null, { id: rug.id, name: 'echo', on: false })
  check('G: switching off is done at once, without a question', asked.length === before + 2 && !(await byName('Rug')).tools.find((t) => t.name === 'echo').on)
})

// ============================ H. the grants ============================
await guard('H', async () => {
  const loop = http.createServer((_q, s) => s.end('loop')).listen(0, '127.0.0.1')
  await new Promise((r) => loop.once('listening', r))
  const port = loop.address().port
  answers.push(false)
  const no = await svc.setGrant(null, { id: ref.id, grant: 'network', on: true })
  check('H: the network is asked about, and a no gives nothing', no.ok === false && /use the network/.test(asked.at(-1).message) && !(await byName('Ref')).network)
  const yes = await svc.setGrant(null, { id: ref.id, grant: 'network', on: true })
  check('H: a yes gives it, and the connector is stopped so that it starts with it', yes.ok && (await byName('Ref')).network && (await byName('Ref')).state !== 'running')
  const { call } = await reply()
  const lo = inner((await call('ref__net', { host: '127.0.0.1', port })).text)
  check('H: with the network, this PC itself is still out of reach', /^error/.test(lo), lo)
  const out = inner((await call('ref__net', { host: '1.1.1.1', port: 443 })).text)
  check('H: (with the network, the internet is reached when this PC has it)', out === 'ok connected' || /^error/.test(out), out)
  const off = await svc.setGrant(null, { id: ref.id, grant: 'network', on: false })
  check('H: taking it back is done at once', off.ok && !(await byName('Ref')).network)
  loop.close()

  picks.push(PROGRAM)
  await svc.addLocal(null, { name: 'Ws', args: ['<<WORKSPACE>>'] })
  const ws = await byName('Ws')
  const without = await svc.refresh({ id: ws.id })
  check('H: an argument that names the workspace copy, without the grant: it does not start, and says why', without.ok === false && /may not see a copy of the workspace/.test(without.error), without.error)
  const grant = await svc.setGrant(null, { id: ws.id, grant: 'workspace', on: true })
  check('H: the copy of the workspace is asked about (and the box says what it can then do)', grant.ok && /copy of the workspace folder/.test(asked.at(-1).message))
  const started = await svc.refresh({ id: ws.id })
  await svc.setTool(null, { id: ws.id, name: 'whoami', on: true })
  await svc.setTool(null, { id: ws.id, name: 'fs', on: true })
  const r2 = await reply()
  const who = JSON.parse(inner((await r2.call('ws__whoami', {})).text))
  const listed = inner((await r2.call('ws__fs', { op: 'list', path: who.argv.at(-1) })).text)
  check('H: with the grant it starts, and the argument names its copy of the workspace (two names: src and readme.md; not .env)', started.ok && /^[A-Z]:\\scratch\\/.test(who.argv.at(-1)) && listed === 'ok 2 entries', `${who.argv.at(-1)} ${listed}`)
  const write = inner((await r2.call('ws__fs', { op: 'write', path: `${who.argv.at(-1)}\\readme.md` })).text)
  check('H: the copy cannot be changed, and the real folder is as it was', /^error/.test(write) && fs.readFileSync(J(WS, 'readme.md'), 'utf8') === 'hello', write)
})

// ============================ I. "as you" ============================
await guard('I', async () => {
  const before = asked.length
  const wrong = await svc.setPlace(null, { id: ref.id, place: 'as-you', typed: 'ref' })
  check('I: without the name typed exactly, nothing is asked and nothing changes', wrong.ok === false && asked.length === before && (await byName('Ref')).place === 'box')
  answers.push(false)
  const no = await svc.setPlace(null, { id: ref.id, place: 'as-you', typed: 'Ref' })
  check('I: with it, the box asks, in strong words; a no keeps it boxed', no.ok === false && /every right you have/.test(asked.at(-1).message) && /NOT be in the box/.test(asked.at(-1).detail) && (await byName('Ref')).place === 'box')
  const yes = await svc.setPlace(null, { id: ref.id, place: 'as-you', typed: 'Ref' })
  check('I: a yes makes it run as the person, and its grants are dropped', yes.ok && (await byName('Ref')).place === 'as-you' && /NOT boxed/.test((await byName('Ref')).where))
  const { call } = await reply()
  const outside = inner((await call('ref__fs', { op: 'read', path: J(ROOT, 'secret.txt') })).text)
  const who = JSON.parse(inner((await call('ref__whoami', {})).text))
  check('I: as the person it can read their files (which is what the box said)', outside.startsWith('ok a file of the person'), outside)
  check("I: ...it is the real node and its own file, without the app's variables", /node\.exe$/i.test(who.execPath) && who.script.toLowerCase() === PROGRAM.toLowerCase() && !who.env.some((k) => /^FRONTIER/i.test(k)), show(who))
  const beforeBack = asked.length
  const back = await svc.setPlace(null, { id: ref.id, place: 'box', typed: '' })
  check('I: back into the box at once, without a question', back.ok && (await byName('Ref')).place === 'box' && asked.length === beforeBack)
  check('I: the record has both', what().includes('as-you-on') && what().includes('as-you-off'))
})

// ============================ J. a web address ============================
let remoteServer
await guard('J', async () => {
  remoteServer = spawn(process.execPath, [J(TOOLS, 'fixtures14', 'ref-server.mjs'), '--http', '0', '--token', TOKEN], { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true })
  children.push(remoteServer)
  remoteServer.stderr.resume()
  const port = await new Promise((resolve, reject) => {
    let text = ''
    remoteServer.stdout.on('data', (c) => {
      text += c
      const m = /LISTENING (\d+)/.exec(text)
      if (m) resolve(Number(m[1]))
    })
    setTimeout(() => reject(new Error('no port')), 10_000)
  })
  const url = `http://127.0.0.1:${port}/mcp`
  check('J: an address that is not used is refused before anything is asked', /Only https/.test((await svc.addRemote(null, { name: 'Web', url: 'http://example.com/mcp', token: '' })).error ?? ''))
  const added = await svc.addRemote(null, { name: 'Web', url, token: TOKEN })
  const q = asked.at(-1)
  check('J: the box shows the address whole, says a token goes with it, and that what is sent leaves this PC', added.ok && q.detail.includes(url) && /With the token you pasted/.test(q.detail) && !q.detail.includes(TOKEN) && /leaves this PC/.test(q.detail))
  const web = await byName('Web')
  check('J: the page is told only that it has a token, never the token', web.hasToken === true && !JSON.stringify(await svc.status()).includes(TOKEN))
  check('J: connectors.json holds the token sealed, never as it is', !fs.readFileSync(J(APPDATA, 'connectors.json'), 'utf8').includes(TOKEN))
  const listed = await svc.refresh({ id: web.id })
  check('J: it is reached with the token and its tools are listed', listed.ok && (await byName('Web')).tools.length === 14, show(listed.ok ? '' : listed))
  await svc.setTool(null, { id: web.id, name: 'echo', on: true })
  const { call } = await reply()
  const r = await call('web__echo', { text: 'over http' })
  check('J: a call goes to the address and comes back labelled', inner(r.text).trim() === 'over http')
  const before = asked.length
  const leak = await call('web__echo', { text: `the token is ${TOKEN}` })
  check('J: an argument that holds the token is refused like a saved key, before anybody is asked', leak.isError && /must never be sent/.test(leak.text) && asked.length === before)
  await svc.addRemote(null, { name: 'Wrong', url, token: 'not-the-token-at-all' })
  const wrong = await svc.refresh({ id: (await byName('Wrong')).id })
  check('J: with a wrong token, it says the address refused it', wrong.ok === false && /token|refused|sign/i.test(wrong.error), wrong.error)
})

// ============================ K. removing one ============================
await guard('K', async () => {
  const ws = await byName('Ws')
  const home = J(RUN, 'connectors', ws.id)
  check('K: (its folder is there)', fs.existsSync(home))
  answers.push(false)
  const no = await svc.remove(null, { id: ws.id })
  check('K: removing asks first; a no keeps it', no.ok === false && /Remove the connector "Ws"/.test(asked.at(-1).message) && fs.existsSync(home))
  const yes = await svc.remove(null, { id: ws.id })
  await sleep(300)
  check('K: a yes removes it, stops it, and deletes its folder in the box (and nothing else)', yes.ok && (await byName('Ws')) === undefined && !fs.existsSync(home) && fs.existsSync(J(RUN, 'connectors', ref.id)) && fs.existsSync(WS))
  const web = await byName('Web')
  await svc.remove(null, { id: web.id })
  check('K: removing a web address forgets its token', !(await svc.tokens()).includes(TOKEN))
  check('K: the record says it was removed', what().filter((w) => w === 'removed').length === 2)
})

// ============================ L. the caps ============================
await guard('L', async () => {
  const rug = await byName('Rug')
  await svc.refresh({ id: rug.id })
  const offered = (await byName('Rug')).tools.filter((t) => t.id !== null).map((t) => t.name)
  const refOffered = (await byName('Ref')).tools.filter((t) => t.id !== null && !t.on).map((t) => t.name)
  let made = 0
  for (const name of [...refOffered, ...offered]) {
    if ((await svc.status()).toolsOn >= CONNECTOR_LIMITS.toolsOn) break
    if ((await svc.setTool(null, { id: refOffered.includes(name) && made < refOffered.length ? ref.id : rug.id, name, on: true })).ok) made++
  }
  const st = await svc.status()
  const left = st.connectors.find((c) => c.name === 'Rug').tools.find((t) => t.id !== null && !t.on)
  const before = asked.length
  const over = left === undefined ? { ok: true } : await svc.setTool(null, { id: rug.id, name: left.name, on: true })
  check(`L: at most ${CONNECTOR_LIMITS.toolsOn} connector tools are on; the next is refused before anybody is asked`, st.toolsOn === CONNECTOR_LIMITS.toolsOn && over.ok === false && asked.length === before, `${st.toolsOn} ${show(over)}`)
  check(`L: a reply offers them all (${CONNECTOR_LIMITS.toolsOn})`, (await reply()).specs.filter((n) => n.includes('__')).length === CONNECTOR_LIMITS.toolsOn)
  let n = (await svc.status()).connectors.length
  while (n < CONNECTOR_LIMITS.connectors) {
    if (!(await svc.addRemote(null, { name: `Extra ${n}`, url: 'https://mcp.example.com/', token: '' })).ok) break
    n++
  }
  const eleventh = await svc.addRemote(null, { name: 'One too many', url: 'https://mcp.example.com/', token: '' })
  check(`L: at most ${CONNECTOR_LIMITS.connectors} connectors`, n === CONNECTOR_LIMITS.connectors && eleventh.ok === false && /already 10 connectors/.test(eleventh.error), eleventh.error)
})

// ============================ M. the app closing ============================
await guard('M', async () => {
  await svc.refresh({ id: ref.id })
  await svc.refresh({ id: (await byName('Rug')).id })
  check('M: (two connectors run)', (await svc.status()).connectors.filter((c) => c.state === 'running').length === 2)
  svc.stopAll()
  box.stopAll()
  await sleep(4000)
  check('M: when the app closes, every connector is ended', (await svc.status()).connectors.every((c) => c.state !== 'running'))
  check('M: no drive letter of the box is left', runnerMod.listMounts(RUN).length === 0, show(runnerMod.listMounts(RUN)))
  const late = await svc.refresh({ id: ref.id })
  check('M: after that, nothing starts', late.ok === false && /closing/.test(late.error), late.error)
})

// ============================ N. the audit log ============================
await guard('N', async () => {
  const kinds = new Set(what())
  check('N: every kind of event was recorded', ['added', 'started', 'stopped', 'tool-on', 'tool-off', 'tool-changed', 'network-on', 'network-off', 'folder-on', 'as-you-on', 'as-you-off', 'removed', 'failed'].every((k) => kinds.has(k)), [...kinds].join())
  check('N: every event was kept by the real audit log (each line proved by reading it back)', auditFailures === 0, `${auditFailures} failed`)
  const snap = await auditLog.read()
  check('N: the log reads back with nothing skipped', snap.skipped === 0 && snap.events.length >= events.filter((e) => e.type === 'connector').length, show({ skipped: snap.skipped, n: snap.events?.length }))
})

check('the guard under the real file system refused nothing (the code under test wrote and removed only inside the folders it was given)', fsGuard.refusals.length === 0, show(fsGuard.refusals.slice(0, 3)))
const ok = check.summary()
process.exit(ok ? 0 : 1)
