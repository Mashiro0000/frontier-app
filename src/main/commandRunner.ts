import { execFile, execFileSync, spawn, type ChildProcess } from 'child_process'
import { createHash, randomBytes } from 'crypto'
import { promises as fs } from 'fs'
import { win32 } from 'path'
import launcherText from './launcher/commandLauncher.ps1?raw'
import { RUN_ARGS, RUN_LIMITS, type NotRunWhy, type RunOutcome } from '../shared/run'

// Running ONE program in a box (Stage 13.2, D-043). Nothing in the app calls this yet (13.3 makes the scratch folder, 13.4 the tool).
//
// The box is an AppContainer with no capabilities inside a job object, made by a fixed PowerShell/C# launcher that is part of the app
// (launcher/commandLauncher.ps1, bundled as text). This file is the only place that starts it. What it does:
//   - checks the request, field by field (a field more or less is a refusal): the program must be an .exe under the Windows folder, or the
//     installed node.exe (of which a private copy is run: the container cannot read the one in Program Files, D-043); the arguments are
//     bounded and hold no NUL; the scratch folder must lie inside the run root and not be a link; every number is within RUN_LIMITS;
//   - writes the launcher to disk, named by its hash, and checks it again before every run (a launcher that is not the one inside the app is
//     put right, or the run is refused);
//   - hands the launcher ONE json spec file; nothing is ever put on a command line but the two file names, so no argument can become code;
//   - waits for it with a clock of its own, ends it if it hangs, ends the whole run on Stop everything (an AbortSignal) and when the app ends
//     (the launcher also watches the app's process and ends the job by itself if the app dies);
//   - reads the result back strictly. Anything it does not understand is "not run", never a guess.
// There is NO way to run a program without the box: if the box cannot be made, the answer is `isolation-unavailable` and nothing ran.
//
// No Electron imports, so it can be checked under plain Node with any folder.

export interface RunnerDeps {
  /** A folder of the app's own on a local drive (never a drive root): holds launcher/, tools/, specs/ and, later, the scratch folders. */
  runRoot: string
  /** The process id of the app, which the launcher watches. Default: this process. */
  parentPid?: number
  /** The Windows folder. Default: %SystemRoot%. */
  systemRoot?: string
  /** Where an installed node.exe may come from. Default: %ProgramFiles% and %ProgramFiles(x86)%. */
  programFilesDirs?: string[]
  /** For checks only: a stand-in for powershell.exe (the app never passes this). */
  powershellPath?: string
  /** For checks only: the arguments the stand-in is given instead of PowerShell's (the app never passes this). */
  launcherArguments?: (launcherPath: string, specPath: string) => string[]
  /** For checks only: how long the launcher may take beyond the program's own clock (starting PowerShell, making the box, ending it). */
  launcherGraceMs?: number
}

export interface CommandRunner {
  run(request: unknown, options?: { signal?: AbortSignal }): Promise<RunOutcome>
  /** Ends every run that is going on (the app is closing). Synchronous on purpose. */
  stopAll(): void
  /** How many runs are going on now. */
  live(): number
  /** The folders this runner uses. */
  readonly folders: { launcher: string; tools: string; specs: string }
}

export const LAUNCHER_TEXT = launcherText.replace(/\r\n/g, '\n')
export const LAUNCHER_SHA256 = createHash('sha256').update(LAUNCHER_TEXT, 'utf8').digest('hex')

/** The name of the container (made on first use, kept: it is an entry of this user, no administrator is involved). */
export const CONTAINER_NAME = 'FrontierApp.Run'

const DEFAULT_GRACE_MS = 45_000
const ALLOWED_FIELDS = new Set([
  'program',
  'args',
  'scratchDir',
  'timeoutMs',
  'memoryBytes',
  'maxProcesses',
  'outputBytes'
])

export interface CheckedRequest {
  program: string
  args: string[]
  scratchDir: string
  timeoutMs: number
  memoryBytes: number
  maxProcesses: number
  outputBytes: number
}

type Checked = { ok: true; request: CheckedRequest } | { ok: false; message: string }

const refuse = (message: string): Checked => ({ ok: false, message })
const DRIVE_PATH = /^[A-Za-z]:\\/

/** No lone half of a surrogate pair (it cannot be written as UTF-8 and would reach the program as something else). */
function wellFormed(text: string): boolean {
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i)
    if (c >= 0xd800 && c <= 0xdbff) {
      const d = text.charCodeAt(i + 1)
      if (d >= 0xdc00 && d <= 0xdfff) i++
      else return false
    } else if (c >= 0xdc00 && c <= 0xdfff) return false
  }
  return true
}

async function exists(path: string): Promise<boolean> {
  try {
    await fs.access(path)
    return true
  } catch {
    return false
  }
}

/** `child` is inside `parent` (both already resolved), compared as Windows does: without regard to case, and only below, never equal. */
export function isInside(parent: string, child: string): boolean {
  const p = parent.toLowerCase().replace(/\\+$/, '') + '\\'
  return child.toLowerCase().startsWith(p) && child.length > p.length
}

function integerIn(
  value: unknown,
  range: { min: number; max: number; default: number },
  name: string
): number | string {
  if (value === undefined) return range.default
  if (typeof value !== 'number' || !Number.isInteger(value)) return `${name} must be a whole number`
  if (value < range.min || value > range.max)
    return `${name} must be from ${range.min} to ${range.max}`
  return value
}

/** The pure part of the checks: shapes and numbers. The files (does the program exist, is the folder a link) are looked at in `run`. */
export function checkRequest(input: unknown, runRoot: string): Checked {
  if (typeof input !== 'object' || input === null || Array.isArray(input))
    return refuse('the request is not an object')
  const o = input as Record<string, unknown>
  for (const key of Object.keys(o))
    if (!ALLOWED_FIELDS.has(key))
      return refuse(`the request has a field it should not have: ${key.slice(0, 40)}`)
  const { program, args, scratchDir } = o
  if (
    typeof program !== 'string' ||
    program.length === 0 ||
    program.length > 260 ||
    program.includes('\0') ||
    !DRIVE_PATH.test(program)
  ) {
    return refuse('the program is not a full path on a local drive')
  }
  if (!/\.exe$/i.test(program))
    return refuse(
      'the program is not an .exe file (scripts and .cmd or .bat files need a shell: start the interpreter instead)'
    )
  if (!Array.isArray(args)) return refuse('the arguments are not a list')
  if (args.length > RUN_ARGS.count) return refuse(`more than ${RUN_ARGS.count} arguments`)
  let total = 0
  for (const a of args) {
    if (typeof a !== 'string') return refuse('an argument is not text')
    if (a.length > RUN_ARGS.charsEach)
      return refuse(`an argument is longer than ${RUN_ARGS.charsEach} characters`)
    if (a.includes('\0')) return refuse('an argument holds a NUL character')
    if (!wellFormed(a))
      return refuse('an argument holds a broken character (half of a surrogate pair)')
    total += a.length + 3
  }
  if (total > RUN_ARGS.charsTotal)
    return refuse(`the arguments together are longer than ${RUN_ARGS.charsTotal} characters`)
  if (typeof scratchDir !== 'string' || !DRIVE_PATH.test(scratchDir) || scratchDir.includes('\0'))
    return refuse('the folder is not a full path on a local drive')
  const root = win32.resolve(runRoot)
  const scratch = win32.resolve(scratchDir)
  if (!isInside(root, scratch)) return refuse('the folder is not inside the run root')
  const timeoutMs = integerIn(o.timeoutMs, RUN_LIMITS.timeoutMs, 'timeoutMs')
  if (typeof timeoutMs === 'string') return refuse(timeoutMs)
  const memoryBytes = integerIn(o.memoryBytes, RUN_LIMITS.memoryBytes, 'memoryBytes')
  if (typeof memoryBytes === 'string') return refuse(memoryBytes)
  const maxProcesses = integerIn(o.maxProcesses, RUN_LIMITS.maxProcesses, 'maxProcesses')
  if (typeof maxProcesses === 'string') return refuse(maxProcesses)
  const outputBytes = integerIn(o.outputBytes, RUN_LIMITS.outputBytes, 'outputBytes')
  if (typeof outputBytes === 'string') return refuse(outputBytes)
  return {
    ok: true,
    request: {
      program: win32.resolve(program),
      args: args.slice() as string[],
      scratchDir: scratch,
      timeoutMs,
      memoryBytes,
      maxProcesses,
      outputBytes
    }
  }
}

/** What the launcher wrote, checked strictly. Anything else is a launcher that failed. */
export function parseLauncherResult(
  text: string
): { ok: true; value: Record<string, unknown> } | { ok: false; message: string } {
  let value: unknown
  try {
    value = JSON.parse(text.charCodeAt(0) === 0xfeff ? text.slice(1) : text)
  } catch {
    return { ok: false, message: 'the launcher left a result that is not JSON' }
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    return { ok: false, message: 'the launcher left a result that is not an object' }
  const r = value as Record<string, unknown>
  if (typeof r.ok !== 'boolean') return { ok: false, message: 'the launcher result has no ok' }
  if (!r.ok) {
    if (typeof r.stage !== 'string' || typeof r.error !== 'string')
      return { ok: false, message: 'the launcher result is malformed' }
    return { ok: true, value: r }
  }
  const numbers = [
    'exitCode',
    'elapsedMs',
    'peakJobMemory',
    'activeBeforeKill',
    'activeAfterKill',
    'stdoutBytes',
    'stderrBytes'
  ]
  for (const n of numbers)
    if (typeof r[n] !== 'number' || !Number.isFinite(r[n]) || (r[n] as number) < -1)
      return { ok: false, message: `the launcher result has a bad ${n}` }
  if (typeof r.timedOut !== 'boolean' || typeof r.parentGone !== 'boolean')
    return { ok: false, message: 'the launcher result has a bad flag' }
  if (typeof r.stdout !== 'string' || typeof r.stderr !== 'string')
    return { ok: false, message: 'the launcher result has no output' }
  return { ok: true, value: r }
}

const ISOLATION_STAGES = new Set([
  'container',
  'grants',
  'mount',
  'job',
  'pipes',
  'attributes',
  'create-process',
  'assign',
  'run'
])

function cleanMessage(text: unknown): string {
  // one short line, with no control character: it ends up in a sentence shown to the person
  let line = ''
  for (const ch of String(text ?? '')) {
    const code = ch.codePointAt(0) ?? 0
    line += code < 32 || code === 127 ? ' ' : ch
  }
  return line.trim().slice(0, 300)
}

export function createCommandRunner(deps: RunnerDeps): CommandRunner {
  const runRoot = win32.resolve(deps.runRoot)
  if (!DRIVE_PATH.test(runRoot) || runRoot.length < 6)
    throw new Error('the run root must be a folder on a local drive, not a drive root')
  const systemRoot = win32.resolve(deps.systemRoot ?? process.env.SystemRoot ?? 'C:\\Windows')
  const programFilesDirs = (
    deps.programFilesDirs ??
    [process.env.ProgramFiles, process.env['ProgramFiles(x86)']].filter((d): d is string => !!d)
  ).map((d) => win32.resolve(d))
  const powershell =
    deps.powershellPath ??
    win32.join(systemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
  const launcherArguments =
    deps.launcherArguments ??
    ((launcherPath: string, specPath: string): string[] => [
      '-NoProfile',
      '-NonInteractive',
      '-ExecutionPolicy',
      'Bypass',
      '-File',
      launcherPath,
      '-SpecPath',
      specPath
    ])
  const grace = deps.launcherGraceMs ?? DEFAULT_GRACE_MS
  const parentPid = deps.parentPid ?? process.pid
  const folders = {
    launcher: win32.join(runRoot, 'launcher'),
    tools: win32.join(runRoot, 'tools'),
    specs: win32.join(runRoot, 'specs')
  }
  const children = new Map<ChildProcess, string>() // the launcher process -> the scratch folder it was given
  let toolsQueue: Promise<unknown> = Promise.resolve()
  let stopped = false

  async function ensureLauncher(): Promise<string | NotRun> {
    const path = win32.join(folders.launcher, `commandLauncher-${LAUNCHER_SHA256.slice(0, 16)}.ps1`)
    try {
      await fs.mkdir(folders.launcher, { recursive: true })
      let current: string | null = null
      try {
        current = await fs.readFile(path, 'utf8')
      } catch {
        current = null
      }
      if (
        current === null ||
        createHash('sha256').update(current, 'utf8').digest('hex') !== LAUNCHER_SHA256
      ) {
        await fs.writeFile(path, LAUNCHER_TEXT, 'utf8')
        const back = await fs.readFile(path, 'utf8')
        if (createHash('sha256').update(back, 'utf8').digest('hex') !== LAUNCHER_SHA256) {
          return notRun(
            'launcher-modified',
            'the launcher on disk is not the one inside the app and could not be put right'
          )
        }
      }
      return path
    } catch (error) {
      return notRun(
        'launcher-modified',
        `the launcher could not be written: ${cleanMessage((error as Error).message)}`
      )
    }
  }

  /** A private, read-only-for-the-box copy of node.exe: the installed one cannot be read from inside the container (D-043). */
  function ensureNodeCopy(source: string): Promise<string | NotRun> {
    const job = toolsQueue.then(async (): Promise<string | NotRun> => {
      const target = win32.join(folders.tools, 'node.exe')
      try {
        await fs.mkdir(folders.tools, { recursive: true })
        const from = await fs.stat(source)
        let same = false
        try {
          const have = await fs.stat(target)
          same = have.size === from.size && Math.abs(have.mtimeMs - from.mtimeMs) < 2000
        } catch {
          same = false
        }
        if (!same) {
          const temporary = target + '.new'
          await fs.copyFile(source, temporary)
          await fs.utimes(temporary, from.atime, from.mtime)
          await fs.rm(target, { force: true })
          await fs.rename(temporary, target)
        }
        return target
      } catch (error) {
        return notRun(
          'launcher-failed',
          `the private copy of node.exe could not be made: ${cleanMessage((error as Error).message)}`
        )
      }
    })
    toolsQueue = job.catch(() => undefined)
    return job
  }

  async function lookAtFiles(request: CheckedRequest): Promise<string | NotRun> {
    // the program: a plain file (not a link), either under the Windows folder or an installed node.exe
    let program = request.program
    try {
      const info = await fs.lstat(program)
      if (!info.isFile() || info.isSymbolicLink())
        return notRun('refused', 'the program is not an ordinary file')
    } catch {
      return notRun('refused', 'the program is not there')
    }
    if (isInside(systemRoot, program)) return program
    if (
      win32.basename(program).toLowerCase() === 'node.exe' &&
      programFilesDirs.some((d) => isInside(d, program))
    ) {
      const copy = await ensureNodeCopy(program)
      if (typeof copy !== 'string') return copy
      program = copy
      return program
    }
    return notRun(
      'refused',
      'the program is neither in the Windows folder nor the installed node.exe'
    )
  }

  async function lookAtScratch(request: CheckedRequest): Promise<NotRun | null> {
    try {
      const info = await fs.lstat(request.scratchDir)
      if (!info.isDirectory() || info.isSymbolicLink())
        return notRun('refused', 'the folder is not an ordinary folder')
    } catch {
      return notRun('refused', 'the folder is not there')
    }
    return null
  }

  function kill(child: ChildProcess): Promise<void> {
    return new Promise((resolve) => {
      if (child.pid === undefined || child.exitCode !== null) return resolve()
      execFile('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true }, () =>
        resolve()
      )
    })
  }

  async function run(input: unknown, options?: { signal?: AbortSignal }): Promise<RunOutcome> {
    if (stopped) return notRun('aborted', 'the app is closing')
    const signal = options?.signal
    if (signal?.aborted) return notRun('aborted', 'stopped before it started')
    const checked = checkRequest(input, runRoot)
    if (!checked.ok) return notRun('refused', checked.message)
    const request = checked.request
    const scratchProblem = await lookAtScratch(request)
    if (scratchProblem) return scratchProblem
    const programToRun = await lookAtFiles(request)
    if (typeof programToRun !== 'string') return programToRun
    const launcherPath = await ensureLauncher()
    if (typeof launcherPath !== 'string') return launcherPath
    if (signal?.aborted) return notRun('aborted', 'stopped before it started')

    const id = randomBytes(8).toString('hex')
    const specPath = win32.join(folders.specs, `${id}.json`)
    const resultPath = win32.join(folders.specs, `${id}.result.json`)
    try {
      await fs.mkdir(folders.specs, { recursive: true })
      await fs.writeFile(
        specPath,
        JSON.stringify({
          version: 1,
          container: CONTAINER_NAME,
          runRoot,
          scratchDir: request.scratchDir,
          toolsDir: folders.tools,
          program: programToRun,
          args: request.args,
          timeoutMs: request.timeoutMs,
          memoryBytes: request.memoryBytes,
          maxProcesses: request.maxProcesses,
          capBytes: request.outputBytes,
          parentPid,
          result: resultPath
        }),
        'utf8'
      )
      // The folder must exist as a tools folder even when the program is not node (the launcher gives the container read access to it).
      await fs.mkdir(folders.tools, { recursive: true })
    } catch (error) {
      return notRun(
        'launcher-failed',
        `the spec could not be written: ${cleanMessage((error as Error).message)}`
      )
    }

    try {
      let child: ChildProcess
      try {
        child = spawn(powershell, launcherArguments(launcherPath, specPath), {
          windowsHide: true,
          stdio: ['ignore', 'pipe', 'pipe']
        })
      } catch (error) {
        // Windows can refuse to start a program in ways that throw at once (a policy, a bad file): never an uncaught error
        return notRun(
          'launcher-failed',
          `the launcher could not be started: ${cleanMessage((error as Error).message)}`
        )
      }
      children.set(child, request.scratchDir)
      let said = ''
      const take = (chunk: Buffer): void => {
        if (said.length < 2000) said += chunk.toString('utf8')
      }
      child.stdout?.on('data', take)
      child.stderr?.on('data', take)
      let why: 'timeout' | 'abort' | null = null
      const watchdog = setTimeout(() => {
        why = 'timeout'
        void kill(child)
      }, request.timeoutMs + grace)
      const onAbort = (): void => {
        why = 'abort'
        void kill(child)
      }
      signal?.addEventListener('abort', onAbort, { once: true })
      const closed = await new Promise<number | null>((resolve) => {
        child.on('error', () => resolve(null))
        child.on('close', (code) => resolve(code))
      })
      clearTimeout(watchdog)
      signal?.removeEventListener('abort', onAbort)
      children.delete(child)
      if (stopped && why === null) why = 'abort' // stopAll ended it
      // an ended launcher cannot take its drive letter away itself
      if (why !== null || !(await exists(resultPath))) unmountFolder(request.scratchDir)
      if (why === 'abort') return notRun('aborted', 'stopped while it ran')
      if (why === 'timeout')
        return notRun('launcher-timeout', 'the launcher did not finish in time and was ended')
      let text: string
      try {
        text = await fs.readFile(resultPath, 'utf8')
      } catch {
        return notRun(
          'launcher-failed',
          `the launcher left no result${closed === null ? '' : ` (it ended with code ${closed})`}${said ? `: ${cleanMessage(said).slice(0, 160)}` : ''}`
        )
      }
      const parsed = parseLauncherResult(text)
      if (!parsed.ok) {
        unmountFolder(request.scratchDir)
        return notRun('launcher-failed', parsed.message)
      }
      const r = parsed.value
      if (!r.ok) {
        const stage = String(r.stage)
        const message = cleanMessage(r.error)
        return notRun(
          ISOLATION_STAGES.has(stage) ? 'isolation-unavailable' : 'launcher-failed',
          `${stage}: ${message}`
        )
      }
      if (r.parentGone === true) return notRun('aborted', 'the app was closing')
      return {
        kind: 'ran',
        exitCode: r.exitCode as number,
        timedOut: r.timedOut as boolean,
        elapsedMs: r.elapsedMs as number,
        stdout: r.stdout as string,
        stderr: r.stderr as string,
        stdoutBytes: r.stdoutBytes as number,
        stderrBytes: r.stderrBytes as number,
        peakMemoryBytes: Math.max(0, r.peakJobMemory as number),
        leftoverKilled: r.activeBeforeKill as number,
        leftoverAfter: r.activeAfterKill as number
      }
    } finally {
      await fs.rm(specPath, { force: true }).catch(() => undefined)
      await fs.rm(resultPath, { force: true }).catch(() => undefined)
    }
  }

  function stopAll(): void {
    stopped = true
    for (const [child, scratch] of children) {
      if (child.pid !== undefined) {
        try {
          execFileSync('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], {
            windowsHide: true,
            stdio: 'ignore'
          })
        } catch {
          /* already gone */
        }
      }
      unmountFolder(scratch)
    }
  }

  return { run, stopAll, live: () => children.size, folders }
}

type NotRun = Extract<RunOutcome, { kind: 'not-run' }>
function notRun(why: NotRunWhy, message: string): NotRun {
  return { kind: 'not-run', why, message }
}

/**
 * The drive letters that point into the run root (what the launcher makes with DefineDosDevice, the same as `subst`). A launcher that is
 * ended in the middle leaves its letter behind; 13.3 sweeps at start-up, and this is what it uses.
 */
export function listMounts(runRootInput: string): { letter: string; target: string }[] {
  const root = win32.resolve(runRootInput)
  return mountList().filter((m) => isInside(root, win32.resolve(m.target)))
}

/** Every drive letter made with subst (or DefineDosDevice) in this logon session, as `subst` lists them. */
function mountList(): { letter: string; target: string }[] {
  let text = ''
  try {
    text = execFileSync('subst.exe', [], { windowsHide: true, encoding: 'utf8' })
  } catch {
    return []
  }
  const found: { letter: string; target: string }[] = []
  for (const line of text.split(/\r?\n/)) {
    const m = /^([A-Za-z]):\\: => (.+)$/.exec(line.trim())
    if (m) found.push({ letter: m[1].toUpperCase(), target: m[2] })
  }
  return found
}

/** Takes away the drive letters of one run's scratch folder: used when a launcher was ended and could not do it itself. */
export function unmountFolder(folder: string): void {
  const here = win32.resolve(folder).toLowerCase()
  for (const { letter, target } of mountList()) {
    if (win32.resolve(target).toLowerCase() !== here) continue
    try {
      execFileSync('subst.exe', [`${letter}:`, '/d'], { windowsHide: true, stdio: 'ignore' })
    } catch {
      /* in use: the start-up sweep (13.3) tries again */
    }
  }
}

/** Takes away every drive letter that points into the run root. Returns the letters it removed. */
export function sweepMounts(runRootInput: string): string[] {
  const removed: string[] = []
  for (const { letter } of listMounts(runRootInput)) {
    try {
      execFileSync('subst.exe', [`${letter}:`, '/d'], { windowsHide: true, stdio: 'ignore' })
      removed.push(letter)
    } catch {
      /* in use: left, and said by the caller if it matters */
    }
  }
  return removed
}
