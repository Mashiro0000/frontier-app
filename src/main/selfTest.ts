import { randomBytes } from 'crypto'
import { promises as fs } from 'fs'
import net from 'net'
import { win32 } from 'path'
import {
  SELFTEST_PROBES,
  type SelfTestId,
  type SelfTestLine,
  type SelfTestReport
} from '../shared/programs'
import type { RunOutcome } from '../shared/run'
import { listMounts, type CommandRunner } from './commandRunner'
import { removeScratch } from './scratchCopy'

// The self-test (Stage 13.5, D-043, plan G): before the "Run programs" switch goes on, the app puts a small program in the box and tries, from inside it, everything a
// boxed program must NOT be able to do: read a file of the app's data folder and one in the person's temp folder, list the user folder, write in the data folder and in
// the launcher's and the program copy's folders, reach the network (a listener on this computer's own loopback is waiting for it), start with the app's environment,
// run for ever, ask for too much memory. Two lines are the other way round (the program starts and works in its own folder): a test in which nothing runs would
// "fail to read a canary" too. WHAT IS BELIEVED is what the app sees from OUTSIDE: the canary files are still what they were, the files the program tried to write
// are not there, the listener heard nobody, the clock and the memory limit ended the other two, and nothing is left; the program's own words are read as well, but
// never trusted alone. If any line is not good the switch stays off, and there is no fallback without the box. No Electron imports: the folders are handed in.

/** The program that runs in the box (run 1). It prints one line of JSON about what it saw. Kept as lines so that it needs no escaping. */
export const SELFTEST_SCRIPT = [
  "'use strict'",
  "const fs = require('fs')",
  "const net = require('net')",
  'const spec = JSON.parse(process.argv[2])',
  "const out = { hello: 'in the box', env: Object.keys(process.env).sort() }",
  "const attempt = (name, f) => { try { out[name] = 'DONE:' + String(f()).slice(0, 40) } catch (e) { out[name] = 'ERR:' + (e && e.code ? e.code : 'other') } }",
  "attempt('own', () => { fs.writeFileSync('own.txt', 'own'); return fs.readFileSync('own.txt', 'utf8') })",
  "attempt('readData', () => fs.readFileSync(spec.readData, 'utf8'))",
  "attempt('readTemp', () => fs.readFileSync(spec.readTemp, 'utf8'))",
  "attempt('listHome', () => fs.readdirSync(spec.home).length)",
  "attempt('writeData', () => fs.writeFileSync(spec.writeData, 'x'))",
  "attempt('writeLauncher', () => fs.writeFileSync(spec.writeLauncher, 'x'))",
  "attempt('writeTools', () => fs.writeFileSync(spec.writeTools, 'x'))",
  "attempt('appendNode', () => fs.appendFileSync(process.execPath, 'x'))",
  'let finished = false',
  'const finish = () => { if (finished) return; finished = true; console.log(JSON.stringify(out)); process.exit(0) }',
  "const sock = net.connect({ host: '127.0.0.1', port: spec.port })",
  "sock.on('connect', () => { out.net = 'CONNECTED'; sock.destroy(); finish() })",
  "sock.on('error', (e) => { out.net = 'ERR:' + (e && e.code ? e.code : 'other'); finish() })",
  "setTimeout(() => { if (out.net === undefined) out.net = 'TIMEOUT'; finish() }, 4000)"
].join('\n')

/** The program that never stops (run 2) and the one that asks for more and more memory (run 3). */
const FOR_EVER = ['-e', 'while (true) {}']
const GREEDY = ['-e', 'const a = []; for (;;) { a.push(Buffer.alloc(32 * 1024 * 1024, 1)) }']

/** The environment a boxed program is given, and nothing more (commandLauncher.ps1; verify-13-2 checks the same list). */
const ENVIRONMENT = [
  'comspec',
  'home',
  'localappdata',
  'path',
  'pathext',
  'systemroot',
  'temp',
  'tmp',
  'userprofile',
  'windir'
]

export interface SelfTestTiming {
  /** The clock the for-ever program is given, and the longest it may take to be ended. */
  timeMs: number
  timeSlackMs: number
  /** The memory limit of the greedy program. */
  memoryBytes: number
}

export const SELFTEST_TIMING: Readonly<SelfTestTiming> = Object.freeze({
  timeMs: 3000,
  timeSlackMs: 7000,
  memoryBytes: 128 * 1024 * 1024
})

export interface SelfTestOptions {
  runner: CommandRunner
  runRoot: string
  /** The installed node.exe (a full path), or null when there is none. */
  nodePath: string | null
  /** Folders of the app and the person where the canaries are laid: the app's data folder and the temp folder. The user folder is only listed. */
  dataDir: string
  tempDir: string
  homeDir: string
  signal?: AbortSignal
  now?: () => number
  timing?: Partial<SelfTestTiming>
}

/** What the judge is given: everything seen from outside, and what the program said. */
export interface SelfTestEvidence {
  first: RunOutcome
  inner: Record<string, unknown> | null
  /** The two canary texts, and whether each file is still exactly as it was. */
  secrets: readonly string[]
  canariesIntact: boolean
  /** The files the program tried to write, and whether any of them exists now. */
  wroteSomething: boolean
  /** The private copy of node.exe: its size before and after. */
  nodeSizes: { before: number | null; after: number | null }
  /** How many times the listener on this computer's loopback heard anybody. */
  listenerHits: number
  time: RunOutcome
  memory: RunOutcome
  /** Processes still running after any run, drive letters still mounted, runs still going. */
  leftovers: { processes: number; mounts: number; live: number }
  timing: Readonly<SelfTestTiming>
}

const line = (id: SelfTestId, good: boolean, detail: string): SelfTestLine => ({
  id,
  label: SELFTEST_PROBES.find((p) => p.id === id)?.label ?? id,
  good,
  detail
})

const refused = (v: unknown): boolean => typeof v === 'string' && v.startsWith('ERR:')
const seconds = (ms: number): string => `${(ms / 1000).toFixed(1)} seconds`

/** The lines of the report from the evidence. Pure: the checks play the evidence, true and false. */
export function judgeSelfTest(e: SelfTestEvidence): SelfTestLine[] {
  const said = e.inner
  const ran = e.first.kind === 'ran' && e.first.exitCode === 0 && said !== null
  const text = e.first.kind === 'ran' ? `${e.first.stdout}\n${e.first.stderr}` : ''
  const leaked = e.secrets.some((s) => s !== '' && text.includes(s))
  const lines: SelfTestLine[] = []
  lines.push(
    line(
      'ran',
      ran && said?.hello === 'in the box',
      ran
        ? said?.hello === 'in the box'
          ? 'It started and answered.'
          : 'It started but did not answer as it should.'
        : e.first.kind === 'not-run'
          ? `It did not start: ${e.first.message.slice(0, 120)}`
          : 'It did not finish well.'
    )
  )
  lines.push(
    line(
      'own',
      ran && said?.own === 'DONE:own',
      ran && said?.own === 'DONE:own'
        ? 'It wrote and read a file in its own folder.'
        : 'It could not use its own folder.'
    )
  )
  const refusedRead = (key: string): boolean => ran && refused(said?.[key])
  lines.push(
    line(
      'read-data',
      refusedRead('readData') && !leaked,
      refusedRead('readData') && !leaked ? 'Refused.' : 'It was NOT stopped from reading it.'
    )
  )
  lines.push(
    line(
      'read-temp',
      refusedRead('readTemp') && !leaked,
      refusedRead('readTemp') && !leaked ? 'Refused.' : 'It was NOT stopped from reading it.'
    )
  )
  lines.push(
    line(
      'list-home',
      refusedRead('listHome'),
      refusedRead('listHome') ? 'Refused.' : 'It was NOT stopped from listing it.'
    )
  )
  lines.push(
    line(
      'write-data',
      ran && refused(said?.writeData) && !e.wroteSomething && e.canariesIntact,
      ran && refused(said?.writeData) && !e.wroteSomething && e.canariesIntact
        ? 'Refused, and nothing was made.'
        : 'It was NOT stopped from writing there.'
    )
  )
  const sizes = e.nodeSizes
  const nodeSame = sizes.before !== null && sizes.before === sizes.after
  const stoppedAtLauncher =
    ran &&
    refused(said?.writeLauncher) &&
    refused(said?.writeTools) &&
    refused(said?.appendNode) &&
    nodeSame &&
    !e.wroteSomething
  lines.push(
    line(
      'write-launcher',
      stoppedAtLauncher,
      stoppedAtLauncher
        ? 'Refused, and the copy is as it was.'
        : 'It was NOT stopped from changing them.'
    )
  )
  const noNet = ran && e.listenerHits === 0 && (said?.net === undefined || said.net !== 'CONNECTED')
  lines.push(
    line(
      'network',
      noNet && typeof said?.net === 'string' && (refused(said.net) || said.net === 'TIMEOUT'),
      noNet ? 'Nobody connected.' : 'It REACHED this computer over the network.'
    )
  )
  const names = Array.isArray(said?.env)
    ? (said.env as unknown[]).map((n) => String(n).toLowerCase()).sort()
    : []
  const envGood = ran && JSON.stringify(names) === JSON.stringify(ENVIRONMENT)
  lines.push(
    line(
      'environment',
      envGood,
      envGood ? 'Only the fixed small set of names.' : 'The environment holds names it should not.'
    )
  )
  const timeGood =
    e.time.kind === 'ran' &&
    e.time.timedOut &&
    e.time.elapsedMs <= e.timing.timeMs + e.timing.timeSlackMs
  lines.push(
    line(
      'time',
      timeGood,
      e.time.kind !== 'ran'
        ? 'It could not be tried.'
        : timeGood
          ? `Ended by its clock after ${seconds(e.time.elapsedMs)}.`
          : 'It was NOT ended by its clock.'
    )
  )
  const memGood = e.memory.kind === 'ran' && !e.memory.timedOut && e.memory.exitCode !== 0
  lines.push(
    line(
      'memory',
      memGood,
      e.memory.kind !== 'ran'
        ? 'It could not be tried.'
        : memGood
          ? 'Ended at its limit.'
          : 'It was NOT ended at its memory limit.'
    )
  )
  const cleanGood =
    e.leftovers.processes === 0 && e.leftovers.mounts === 0 && e.leftovers.live === 0
  lines.push(
    line(
      'clean',
      cleanGood,
      cleanGood ? 'Nothing left running or mounted.' : 'Something was left running or mounted.'
    )
  )
  return lines
}

const leftoverProcesses = (o: RunOutcome): number => (o.kind === 'ran' ? o.leftoverAfter : 0)

function parseInner(stdout: string): Record<string, unknown> | null {
  const last = stdout.trim().split('\n').at(-1) ?? ''
  try {
    const value = JSON.parse(last) as unknown
    return value !== null && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : null
  } catch {
    return null
  }
}

async function exists(path: string): Promise<boolean> {
  try {
    await fs.lstat(path)
    return true
  } catch {
    return false
  }
}

async function sizeOf(path: string): Promise<number | null> {
  try {
    return (await fs.stat(path)).size
  } catch {
    return null
  }
}

/** A listener on this computer's own loopback that counts who connects; closed by the caller. */
async function listen(): Promise<{ port: number; hits: () => number; close: () => Promise<void> }> {
  let hits = 0
  const server = net.createServer((socket) => {
    hits++
    socket.destroy()
  })
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => resolve())
  })
  const address = server.address()
  return {
    port: typeof address === 'object' && address !== null ? address.port : 0,
    hits: () => hits,
    close: () => new Promise<void>((resolve) => server.close(() => resolve()))
  }
}

/** The names the test gives its own files: a canary in the data folder, one in the temp folder, and the file it tries to write. Ten hex digits of chance each. */
const OWN_FILES = [
  /^selftest-canary-[0-9a-f]{10}\.txt$/,
  /^selftest-write-[0-9a-f]{10}\.txt$/,
  /^frontier-selftest-[0-9a-f]{10}\.txt$/
]

/**
 * At start-up: removes what a test that was cut off (a crash, a power cut) left in these folders, by the exact pattern of the names the test gives its files and nothing
 * else (a file of the person's with a similar name stays). Answers how many it removed. Never throws.
 */
export async function sweepSelfTest(folders: readonly string[]): Promise<number> {
  let removed = 0
  for (const folder of folders) {
    let names: string[] = []
    try {
      names = await fs.readdir(folder)
    } catch {
      continue
    }
    for (const name of names) {
      if (!OWN_FILES.some((pattern) => pattern.test(name))) continue
      try {
        const info = await fs.lstat(win32.join(folder, name))
        if (!info.isFile() || info.isSymbolicLink()) continue
        await fs.rm(win32.join(folder, name), { force: true })
        removed++
      } catch {
        /* left; the next start tries again */
      }
    }
  }
  return removed
}

/** Runs the whole test and answers with the report. Never throws: a fault is a report that is not ok, with the reason. */
export async function runSelfTest(options: SelfTestOptions): Promise<SelfTestReport> {
  const now = options.now ?? Date.now
  const started = now()
  const timing = { ...SELFTEST_TIMING, ...(options.timing ?? {}) }
  const failed = (message: string): SelfTestReport => ({
    at: now(),
    ok: false,
    lines: [],
    ms: now() - started,
    message
  })
  if (options.nodePath === null) {
    return failed(
      'Node.js is not installed on this PC, and the self-test needs it to run a small program in the box.'
    )
  }
  const id = randomBytes(5).toString('hex')
  const secrets = [
    `SELFTEST-SECRET-${randomBytes(8).toString('hex')}`,
    `SELFTEST-SECRET-${randomBytes(8).toString('hex')}`
  ]
  const canaryData = win32.join(options.dataDir, `selftest-canary-${id}.txt`)
  const canaryTemp = win32.join(options.tempDir, `frontier-selftest-${id}.txt`)
  const writeData = win32.join(options.dataDir, `selftest-write-${id}.txt`)
  const folders = options.runner.folders
  const writeLauncher = win32.join(folders.launcher, `selftest-write-${id}.txt`)
  const writeTools = win32.join(folders.tools, `selftest-write-${id}.txt`)
  const nodeCopy = win32.join(folders.tools, 'node.exe')
  const scratch = win32.join(win32.resolve(options.runRoot), 'scratch', `selftest-${id}`)
  let server: Awaited<ReturnType<typeof listen>> | null = null
  const made: string[] = []
  try {
    await fs.mkdir(options.dataDir, { recursive: true })
    await fs.mkdir(options.tempDir, { recursive: true })
    await fs.writeFile(canaryData, secrets[0], { flag: 'wx' })
    made.push(canaryData)
    await fs.writeFile(canaryTemp, secrets[1], { flag: 'wx' })
    made.push(canaryTemp)
    await fs.mkdir(scratch, { recursive: true })
    await fs.writeFile(win32.join(scratch, 'selftest.cjs'), SELFTEST_SCRIPT, { flag: 'wx' })
    server = await listen()
    const spec = JSON.stringify({
      readData: canaryData,
      readTemp: canaryTemp,
      home: options.homeDir,
      writeData,
      writeLauncher,
      writeTools,
      port: server.port
    })
    const nodeBefore = await sizeOf(nodeCopy)
    const run = (args: string[], extra: Record<string, number>): Promise<RunOutcome> =>
      options.runner.run(
        { program: options.nodePath, args, scratchDir: scratch, ...extra },
        { signal: options.signal }
      )
    const first = await run(['selftest.cjs', spec], { timeoutMs: 30_000 })
    // the copy of node.exe exists after the first run (the runner makes it); its size is read before and after the later runs too
    const nodeAfterFirst = await sizeOf(nodeCopy)
    const time = await run(FOR_EVER, { timeoutMs: timing.timeMs })
    const memory = await run(GREEDY, { timeoutMs: 20_000, memoryBytes: timing.memoryBytes })
    const intact =
      (await fs.readFile(canaryData, 'utf8').catch(() => null)) === secrets[0] &&
      (await fs.readFile(canaryTemp, 'utf8').catch(() => null)) === secrets[1]
    const wrote =
      (await exists(writeData)) || (await exists(writeLauncher)) || (await exists(writeTools))
    const evidence: SelfTestEvidence = {
      first,
      inner: first.kind === 'ran' ? parseInner(first.stdout) : null,
      secrets,
      canariesIntact: intact,
      wroteSomething: wrote,
      nodeSizes: { before: nodeBefore ?? nodeAfterFirst, after: await sizeOf(nodeCopy) },
      listenerHits: server.hits(),
      time,
      memory,
      leftovers: {
        processes: leftoverProcesses(first) + leftoverProcesses(time) + leftoverProcesses(memory),
        mounts: listMounts(options.runRoot).length,
        live: options.runner.live()
      },
      timing
    }
    const lines = judgeSelfTest(evidence)
    const aborted =
      [first, time, memory].some((o) => o.kind === 'not-run' && o.why === 'aborted') ||
      options.signal?.aborted === true
    return {
      at: now(),
      ok: !aborted && lines.length === SELFTEST_PROBES.length && lines.every((l) => l.good),
      lines,
      ms: now() - started,
      message: aborted ? 'The test was stopped before it finished.' : null
    }
  } catch (error) {
    console.error('The self-test failed:', error instanceof Error ? error.message : error)
    return failed('The self-test could not be made on this PC.')
  } finally {
    if (server !== null) await server.close().catch(() => undefined)
    // what the test made itself goes: the canaries, and the scratch folder it ran in
    for (const file of made) await fs.rm(file, { force: true }).catch(() => undefined)
    for (const file of [writeData, writeLauncher, writeTools]) {
      await fs.rm(file, { force: true }).catch(() => undefined)
    }
    await removeScratch(scratch, options.runRoot).catch(() => false)
  }
}
