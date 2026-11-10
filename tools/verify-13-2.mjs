// Slice 13.2 (D-043): THE LAUNCHER INSIDE THE APP, under plain Node, Windows only, with the REAL launcher, the REAL AppContainer and the REAL job (nothing here is a
// stand-in except where a launcher that fails is needed, and that one is compiled by this suite). What it shows:
//   A. the request is checked field by field (a field more or less is a refusal; the program, the arguments, the folder, every number);
//   B. the launcher is a text kept in the app: ASCII, hashed, written to disk by the runner and put right when changed; it has no unsandboxed mode;
//   C. real runs: output, exit code, the drive-letter root, files that stay in the scratch folder, the minimal environment (nothing of the app), the clock,
//      memory, process count and output limits, the system programs, a private read-only copy of node.exe, three runs at once, the letter taken away;
//   D. HOSTILE ARGUMENTS: about sixty strings that shells, quoting rules and command lines treat specially arrive exactly as they were, in the program;
//   E. the launcher's own defence: hostile specs handed to it directly are refused before anything is made;
//   F. a launcher that dies, hangs, says nonsense or says the box could not be made (a stand-in compiled here): never a guess, never a run;
//   G. Stop everything (an AbortSignal and stopAll) and the death of the app: the box is gone and the drive letter with it;
//   H. what the source must keep true (the only place that starts the launcher; nothing wired to it yet);
//   I. (13.7) the process is made INSIDE the job and is counted there; a Stop at sixteen different moments of the start leaves no process, no letter and no spec file;
//   J. (13.7) runs started at the same moment never share a drive letter and never fail to make their box (the gate of the launcher).
// The 50 checks of the probe (tools/probe-13-1.mjs) run against this launcher too: PROBE_LAUNCHER=product node tools/probe-13-1.mjs 2.
//
// Run: FRONTIER_MAY_REMOVE=1 node tools/verify-13-2.mjs
//   It REMOVES things (result files, the folders of its own temp folder), so it will not start unless FRONTIER_MAY_REMOVE=1 is set, and that is set only when the owner has allowed
//   removing in words (his rule of 2026-10-09 after the A: incident). Even then the guard under the real file system (tools/fsguard.mjs) lets this process write and remove ONLY inside
//   its own temp folder; the working folder is that temp folder, so a launcher that writes to a relative path (the control lResultPath) lands there and not in the repo.
import './ts-resolve.mjs'
import { checker } from './cdp.mjs'
import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import { win32 } from 'node:path'
import { execFileSync, spawn, spawnSync } from 'node:child_process'
import { installFsGuard } from './fsguard.mjs'
import { REPO, REPO_URL, TOOLS } from './paths.mjs'

if (process.env.FRONTIER_MAY_REMOVE !== '1') {
  console.log('NOT RUN: this suite removes folders it made itself and tests code that removes. Nothing is removed from any drive unless the owner has allowed it in words; set FRONTIER_MAY_REMOVE=1 only then.')
  process.exit(3)
}
if (os.tmpdir().toLowerCase() !== 'c:\\frontier-tmp') {
  // the owner's scope of 2026-10-09: what a check removes lies in C:\frontier-tmp (paths.mjs puts TEMP there when the repo is on C:), made by the same run
  console.log(`NOT RUN: the temp folder is ${os.tmpdir()}; a check that removes may only work in C:\\frontier-tmp (run it from a copy of the repo on C:).`)
  process.exit(3)
}
const check = checker()
// ONLY=A,E runs only those sections (the negative controls run the part that can notice their sabotage, not all four minutes)
const ONLY = process.env.ONLY ? new Set(process.env.ONLY.split(',')) : null
const guard = async (name, fn) => {
  if (ONLY && !ONLY.has(name)) return
  try {
    await fn()
  } catch (error) {
    check(`${name} did not run to its end: ${String(error?.stack ?? error).slice(0, 500)}`, false)
  }
}
const show = (v) => JSON.stringify(v)?.slice(0, 300)
const SRC = `${REPO_URL}/src`
const runnerMod = await import(`${SRC}/main/commandRunner.ts`)
const { createCommandRunner, checkRequest, isInside, parseLauncherResult, listMounts, sweepMounts, unmountFolder, LAUNCHER_TEXT, LAUNCHER_SHA256, CONTAINER_NAME } = runnerMod
const runMod = await import(`${SRC}/shared/run.ts`)
const { RUN_LIMITS, RUN_ARGS } = runMod
const J = win32.join
const sha = (t) => crypto.createHash('sha256').update(t, 'utf8').digest('hex')
const source = (rel) => fs.readFileSync(`${REPO}/${rel}`, 'utf8')
const wait = (ms) => new Promise((r) => setTimeout(r, ms))
async function until(fn, ms = 20000, step = 100) {
  const t0 = Date.now()
  for (;;) {
    const v = await fn()
    if (v) return v
    if (Date.now() - t0 > ms) return null
    await wait(step)
  }
}
const alive = (pid) => {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

const ROOT = fs.realpathSync.native(fs.mkdtempSync(J(os.tmpdir(), 'frontier-132-')))
// from here on this process can write and remove only inside ROOT; programs it starts (the launcher) are not watched, but they work in ROOT (the working folder is ROOT)
const fsGuard = installFsGuard({ write: [ROOT], remove: [ROOT] })
process.chdir(ROOT)
process.on('exit', () => {
  try {
    sweepMounts(ROOT)
    process.chdir(os.tmpdir()) // Windows will not remove a folder that is some process's working folder
    fs.rmSync(ROOT, { recursive: true, force: true })
  } catch {
    /* left for the system */
  }
})
const runRoot = J(ROOT, 'run')
fs.mkdirSync(runRoot, { recursive: true })
let n = 0
const scratch = (name) => {
  const d = J(runRoot, 'scratch', `${name}-${++n}`)
  fs.mkdirSync(d, { recursive: true })
  return d
}
const NODE = J(process.env.ProgramFiles ?? 'C:\\Program Files', 'nodejs', 'node.exe')
const runner = createCommandRunner({ runRoot })
const R = (dir, args, extra = {}) => runner.run({ program: NODE, args, scratchDir: dir, ...extra })
const put = (dir, name, text) => fs.writeFileSync(J(dir, name), text)
const readJson = (dir, name) => JSON.parse(fs.readFileSync(J(dir, name), 'utf8'))
// a box that did not write its file is a failed check, not a crashed suite
const readJsonOr = (dir, name, fallback) => (fs.existsSync(J(dir, name)) ? readJson(dir, name) : fallback)
const letterOf = (out) => /([A-Z]):\\/.exec(out.stdout ?? '')?.[1] ?? null
const noMounts = () => listMounts(runRoot).length === 0
const cp = (s) => String.fromCodePoint(...s)

// ============================ A. the request =============================
await guard('A', async () => {
  const good = { program: 'C:\\Windows\\System32\\whoami.exe', args: [], scratchDir: J(runRoot, 'scratch', 'a') }
  const ok = (input) => checkRequest(input, runRoot)
  const bad = (name, input, fragment) => {
    const r = ok(input)
    check(`A: ${name} is refused`, r.ok === false && (!fragment || r.message.includes(fragment)), r.ok ? 'ACCEPTED' : r.message)
  }
  const accepted = ok(good)
  check('A: a good request is accepted, and every number has its default', accepted.ok && accepted.request.timeoutMs === RUN_LIMITS.timeoutMs.default && accepted.request.memoryBytes === RUN_LIMITS.memoryBytes.default && accepted.request.maxProcesses === 64 && accepted.request.outputBytes === 65536 && accepted.request.diskBytes === 512 * 1024 * 1024, show(accepted))
  check('A: the defaults are the plan\'s numbers (120 s, 1 GB, 64 processes, 64 KB)', RUN_LIMITS.timeoutMs.max === 120000 && RUN_LIMITS.memoryBytes.max === 1024 ** 3 && RUN_LIMITS.maxProcesses.max === 64 && RUN_LIMITS.outputBytes.max === 65536 && RUN_LIMITS.runsPerReply === 5 && RUN_LIMITS.msPerReply === 240000 && RUN_LIMITS.copyFiles === 20000 && RUN_LIMITS.copyBytes === 100 * 1024 * 1024 && RUN_LIMITS.modelChars === 20000)
  for (const [name, v] of [['null', null], ['an array', []], ['a string', 'x'], ['a number', 5], ['undefined', undefined]]) bad(`a request that is ${name}`, v, 'not an object')
  bad('a field more', { ...good, shell: true }, 'a field it should not have')
  bad('an environment', { ...good, env: { A: '1' } }, 'a field it should not have')
  bad('a working folder of the caller\'s choice', { ...good, cwd: 'C:\\' }, 'a field it should not have')
  bad('a missing program', { args: [], scratchDir: good.scratchDir })
  bad('a relative program', { ...good, program: 'whoami.exe' }, 'full path')
  bad('a program on a share', { ...good, program: '\\\\localhost\\c$\\Windows\\System32\\whoami.exe' }, 'full path')
  bad('a program with the long-path prefix', { ...good, program: '\\\\?\\C:\\Windows\\System32\\whoami.exe' }, 'full path')
  bad('a program with a NUL', { ...good, program: 'C:\\Windows\\System32\\whoami.exe\0.txt' }, 'full path')
  bad('a program that is not an .exe', { ...good, program: 'C:\\Windows\\System32\\x.cmd' }, '.exe')
  for (const ext of ['bat', 'ps1', 'vbs', 'js', 'com', 'lnk', 'dll', 'exe.txt', 'exe ']) bad(`a program ending .${ext}`, { ...good, program: `C:\\Windows\\System32\\x.${ext}` }, '.exe')
  bad('arguments that are not a list', { ...good, args: 'a b' }, 'not a list')
  bad('an argument that is not text', { ...good, args: [1] }, 'not text')
  bad(`more than ${RUN_ARGS.count} arguments`, { ...good, args: new Array(RUN_ARGS.count + 1).fill('a') }, 'arguments')
  bad(`an argument of ${RUN_ARGS.charsEach + 1} characters`, { ...good, args: ['x'.repeat(RUN_ARGS.charsEach + 1)] }, 'longer')
  bad('an argument with a NUL', { ...good, args: ['a\0b'] }, 'NUL')
  bad('an argument with half of a surrogate pair', { ...good, args: ['a' + String.fromCharCode(0xd83d)] }, 'broken')
  bad('an argument that is the second half of a pair', { ...good, args: [String.fromCharCode(0xde00)] }, 'broken')
  bad('arguments together longer than the total', { ...good, args: new Array(5).fill('x'.repeat(7000)) }, 'together')
  check('A: a whole emoji and a pair at the end are fine', ok({ ...good, args: ['a' + cp([0x1f600]), cp([0x1f600])] }).ok === true)
  check(`A: ${RUN_ARGS.count} arguments and one of ${RUN_ARGS.charsEach} characters are fine`, ok({ ...good, args: new Array(RUN_ARGS.count - 1).fill('a').concat(['b'.repeat(RUN_ARGS.charsEach)]) }).ok === true)
  bad('a folder that is the run root', { ...good, scratchDir: runRoot }, 'inside')
  bad('a folder above the run root', { ...good, scratchDir: ROOT }, 'inside')
  bad('a sibling whose name starts like the run root', { ...good, scratchDir: runRoot + '-evil\\x' }, 'inside')
  bad('a folder that leaves by ..', { ...good, scratchDir: J(runRoot, 'scratch', '..', '..', 'x') }, 'inside')
  bad('a relative folder', { ...good, scratchDir: 'scratch\\a' }, 'full path')
  bad('a folder on a share', { ...good, scratchDir: '\\\\localhost\\c$\\x' }, 'full path')
  check('A: a folder that goes down and back up inside the run root is fine (and written in its tidy form)', ok({ ...good, scratchDir: J(runRoot, 'scratch', 'a', '..', 'b') }).request?.scratchDir === J(runRoot, 'scratch', 'b'))
  check('A: the run root is compared without regard to letter case', ok({ ...good, scratchDir: runRoot.toUpperCase() + '\\SCRATCH\\A' }).ok === true)
  for (const [field, values] of [
    ['timeoutMs', [99, 120001, 1.5, '5000', NaN, Infinity, -1, null]],
    ['memoryBytes', [1, 16 * 1024 * 1024 - 1, 1024 ** 3 + 1, '1', 2.5]],
    ['maxProcesses', [0, 65, 1.5, '5']],
    ['outputBytes', [0, 65537, '10']],
    ['diskBytes', [0, 1024 * 1024 - 1, 512 * 1024 * 1024 + 1, '5', 1.5]]
  ]) {
    for (const v of values) bad(`${field} = ${String(v)}`, { ...good, [field]: v })
  }
  for (const [field, v] of [['timeoutMs', 100], ['timeoutMs', 120000], ['memoryBytes', 16 * 1024 * 1024], ['memoryBytes', 1024 ** 3], ['maxProcesses', 1], ['maxProcesses', 64], ['outputBytes', 1], ['outputBytes', 65536], ['diskBytes', 1024 * 1024], ['diskBytes', 512 * 1024 * 1024]]) {
    check(`A: ${field} = ${v} (the edge) is accepted`, ok({ ...good, [field]: v }).ok === true)
  }
  check('A: isInside is strict (never equal), case-blind and cannot be fooled by a longer name', isInside('C:\\a', 'c:\\A\\b') && !isInside('C:\\a', 'C:\\a') && !isInside('C:\\a', 'C:\\ab\\c') && !isInside('C:\\a\\', 'C:\\a'))
  const lr = (o) => parseLauncherResult(JSON.stringify(o))
  const base = { ok: true, exitCode: 0, timedOut: false, parentGone: false, elapsedMs: 1, peakJobMemory: 1, activeBeforeKill: 0, activeAfterKill: 0, stdout: '', stderr: '', stdoutBytes: 0, stderrBytes: 0, diskExceeded: false, scratchBytes: 0 }
  check('A: a good launcher result is read', lr(base).ok === true)
  for (const [name, o] of [
    ['an exit code that is text', { ...base, exitCode: 'x' }],
    ['a clock that is infinite', { ...base, elapsedMs: 1e999 }],
    ['no stdout', { ...base, stdout: undefined }],
    ['stderr that is a number', { ...base, stderr: 5 }],
    ['a flag that is a number', { ...base, timedOut: 1 }],
    ['no diskExceeded', { ...base, diskExceeded: undefined }],
    ['a scratch size that is text', { ...base, scratchBytes: 'big' }],
    ['no ok', { exitCode: 0 }],
    ['ok false without a stage', { ok: false, error: 'x' }],
    ['an array', [1]],
    ['a null', null]
  ]) {
    const r = lr(o)
    check(`A: a launcher result with ${name} is not believed`, r.ok === false, show(r))
  }
  check('A: a launcher result that is not JSON is not believed', parseLauncherResult('hello').ok === false && parseLauncherResult('').ok === false)
  check('A: a byte-order mark before the result is tolerated', parseLauncherResult('\ufeff' + JSON.stringify(base)).ok === true)
})

// ============================ B. the launcher text =======================
await guard('B', async () => {
  const file = source('src/main/launcher/commandLauncher.ps1')
  check('B: the launcher text in the app is ASCII only (no encoding to get wrong)', /^[\x00-\x7f]*$/.test(LAUNCHER_TEXT))
  check('B: the text in the app is the file, with LF line ends', LAUNCHER_TEXT === file.replace(/\r\n/g, '\n'))
  check('B: its hash is the SHA-256 of that text', LAUNCHER_SHA256 === sha(LAUNCHER_TEXT) && /^[0-9a-f]{64}$/.test(LAUNCHER_SHA256))
  check('B: the container has NO capabilities (that is what removes the network)', /CapabilityCount = 0/.test(LAUNCHER_TEXT) && /sc\.Capabilities = IntPtr\.Zero/.test(LAUNCHER_TEXT))
  check('B: the job kills on close, counts processes, limits memory, and shuts the desktop, clipboard and handles', /0x2000 \| 0x8 \| 0x400 \| 0x200/.test(LAUNCHER_TEXT) && /ActiveProcessLimit = maxProcesses/.test(LAUNCHER_TEXT) && /JobMemoryLimit/.test(LAUNCHER_TEXT) && /UIRestrictionsClass = 0xFF/.test(LAUNCHER_TEXT))
  // (13.7: the process is made INSIDE the job, by the job list attribute of CreateProcess, so that there is no moment at which a process of the box exists outside it: a launcher that was ended
  // between CreateProcess and a later AssignProcessToJobObject used to leave a suspended process that nothing ended; found when a Stop landed in that moment, 10 October 2026)
  check('B: the process is made SUSPENDED and INSIDE the job (the job list attribute), is checked to be in it, and only then resumed', /uint flags = [^;]*CREATE_SUSPENDED/.test(LAUNCHER_TEXT) && /UpdateProcThreadAttribute\(attr, 0, ATTR_JOB_LIST, jlMem/.test(LAUNCHER_TEXT) && LAUNCHER_TEXT.indexOf('UpdateProcThreadAttribute(attr, 0, ATTR_JOB_LIST') < LAUNCHER_TEXT.indexOf('CreateProcessW(program') && LAUNCHER_TEXT.indexOf('IsProcessInJob(pi.hProcess, job') > LAUNCHER_TEXT.indexOf('CreateProcessW(program') && LAUNCHER_TEXT.indexOf('IsProcessInJob(pi.hProcess, job') < LAUNCHER_TEXT.indexOf('ResumeThread(pi.hThread) =='))
  // (the comment that tells the story names the call, so only the code lines are looked at: no line that is a comment in C# or in PowerShell)
  const LAUNCHER_CODE = LAUNCHER_TEXT.split('\n').filter((line) => !/^\s*(\/\/|#)/.test(line)).join('\n')
  check('B: there is no AssignProcessToJobObject any more (an assignment after the process exists is the gap this closes)', !/AssignProcessToJobObject/.test(LAUNCHER_CODE) && LAUNCHER_CODE.length > 1000)
  check('B: one launcher at a time makes the container and takes a drive letter: a named gate, taken before the container and let go in a finally after the letter (13.7)', /new Mutex\(false, "Local\\\\FrontierApp\.RunBox\.Gate"\)/.test(LAUNCHER_TEXT) && /gate\.WaitOne\(60000\)/.test(LAUNCHER_TEXT) &&
    // (since 14: the serve mode of a connector comes first in the file and takes the same gate the same way; the run mode is the last of the two)
    (LAUNCHER_TEXT.match(/\[Box\]::Enter\(\)/g) ?? []).length === 2 && (LAUNCHER_TEXT.match(/\} finally \{ \[Box\]::Leave\(\) \}/g) ?? []).length === 2 &&
    LAUNCHER_TEXT.lastIndexOf('[Box]::Enter()') < LAUNCHER_TEXT.lastIndexOf('[Box]::ContainerSid(') && LAUNCHER_TEXT.indexOf('[Box]::Mount($scratch)') > LAUNCHER_TEXT.lastIndexOf('[Box]::Enter()') && LAUNCHER_TEXT.indexOf('[Box]::Mount($scratch)') < LAUNCHER_TEXT.lastIndexOf('} finally { [Box]::Leave() }') && LAUNCHER_TEXT.lastIndexOf('} finally { [Box]::Leave() }') < LAUNCHER_TEXT.indexOf('[Box]::Run($sid') &&
    LAUNCHER_TEXT.indexOf('[Box]::Enter()') < LAUNCHER_TEXT.indexOf('[Box]::ContainerSid(') && LAUNCHER_TEXT.indexOf('[Box]::Mount($homeDir)') > LAUNCHER_TEXT.indexOf('[Box]::Enter()') && LAUNCHER_TEXT.indexOf('[Box]::Mount($homeDir)') < LAUNCHER_TEXT.indexOf('} finally { [Box]::Leave() }') && LAUNCHER_TEXT.indexOf('} finally { [Box]::Leave() }') < LAUNCHER_TEXT.indexOf('[Box]::Serve($sid'))
  check('B: only the three pipe ends are inherited', /ATTR_HANDLE_LIST/.test(LAUNCHER_TEXT) && /new IntPtr\[\] \{ inR, outW, errW \}/.test(LAUNCHER_TEXT))
  check('B: it watches the size of the scratch folder (every quarter of a second) and ends the job past the cap', /TreeBytes\(scratch, diskBytes\) > diskBytes/.test(LAUNCHER_TEXT) && /DiskExceeded = true/.test(LAUNCHER_TEXT) && /MAX_DISK = 536870912/.test(LAUNCHER_TEXT))
  check('B: it takes ONE parameter, the spec file, and nothing else', /param\(\[Parameter\(Mandatory = \$true\)\]\[string\]\$SpecPath\)/.test(LAUNCHER_TEXT) && (LAUNCHER_TEXT.match(/^param\(/gm) ?? []).length === 1)
  check('B: there is no unsandboxed way in it (no plain mode, no switch, no fallback)', !/\bplain\b|unsandbox|nocontainer|-Mode|fallback/i.test(LAUNCHER_TEXT.replace(/^#.*$/gm, '').replace(/'[^'\n]*'/g, "''")) && (LAUNCHER_TEXT.match(/\$spec\.mode/g) ?? []).length === (LAUNCHER_TEXT.match(/\[string\]\$spec\.mode -ne 'serve'/g) ?? []).length, 'the comments say there is none; the code has no word for one')
  check('B: it does not run what it is given (no Invoke-Expression, no Start-Process, no & call, no cmd /c)', !/Invoke-Expression|\biex\b|Start-Process|\bcmd(\.exe)?\s+\/c|\[scriptblock\]::Create|Invoke-Command/i.test(LAUNCHER_TEXT.replace(/^#.*$/gm, '')))
  check('B: the folders it grants on must be inside the run root and not links; the scratch and tools folders must not overlap', /StartsWith\(\$runRoot \+ '\\'/.test(LAUNCHER_TEXT) && /ReparsePoint/.test(LAUNCHER_TEXT) && /overlap/.test(LAUNCHER_TEXT))
  check('B: the environment is built from nothing and has LOCALAPPDATA but never APPDATA', /\$envd\['SystemRoot'\]/.test(LAUNCHER_TEXT) && /'LOCALAPPDATA'/.test(LAUNCHER_TEXT) && !/\$envd\['APPDATA'\]|\bAPPDATA'/.test(LAUNCHER_TEXT.replace(/LOCALAPPDATA/g, '')))
  check('B: the container name must begin FrontierApp.', /\^FrontierApp\\\./.test(LAUNCHER_TEXT) && CONTAINER_NAME === 'FrontierApp.Run')
  check('B: the drive letter is taken away before the result is written', LAUNCHER_TEXT.indexOf('[Box]::Unmount($mounted, $scratch); $mounted = $null') < LAUNCHER_TEXT.lastIndexOf('Write-Result $out'))
})

// ============================ C. real runs ===============================
const launcherFile = () => J(runner.folders.launcher, `commandLauncher-${LAUNCHER_SHA256.slice(0, 16)}.ps1`)
await guard('C', async () => {
  const d = scratch('hello')
  put(d, 'hello.cjs', "console.log('out', process.cwd()); console.error('err'); require('fs').writeFileSync('made.txt', 'made inside'); process.exit(7)")
  const t0 = Date.now()
  const out = await R(d, ['hello.cjs'])
  check('C: a run gives its output, its error stream and its exit code', out.kind === 'ran' && out.exitCode === 7 && /^out [A-Z]:\\\r?\n$/.test(out.stdout) && out.stderr === 'err\n', show(out))
  check('C: the program works in the ROOT of a drive letter (its folder has no ancestors)', /^[D-Z]$/.test(letterOf(out) ?? ''), out.stdout)
  check('C: what the program made is in the scratch folder afterwards', fs.existsSync(J(d, 'made.txt')) && fs.readFileSync(J(d, 'made.txt'), 'utf8') === 'made inside')
  check('C: no process is left, none ended with it, no spec file is left, no drive letter is left', out.leftoverAfter === 0 && out.leftoverKilled === 0 && noMounts() && fs.readdirSync(runner.folders.specs).length === 0, `${show(listMounts(runRoot))} ${fs.readdirSync(runner.folders.specs)}`)
  check('C: the clock is the program\'s own (the whole run, including the container, took longer than it reports)', out.elapsedMs < Date.now() - t0 - 300, `${out.elapsedMs} of ${Date.now() - t0} ms`)
  check('C: the launcher was written to the app\'s folder, named by its hash, byte for byte', fs.existsSync(launcherFile()) && fs.readFileSync(launcherFile(), 'utf8') === LAUNCHER_TEXT)

  put(d, 'argv.cjs', "require('fs').writeFileSync('argv.json', JSON.stringify(process.argv.slice(2)))")
  const code0 = await R(d, ['-e', 'process.exit(0)'])
  check('C: exit code 0', code0.kind === 'ran' && code0.exitCode === 0)
  const crash = await R(d, ['-e', 'process.abort()'])
  check('C: a program that aborts is a run with an exit code, not a failure of the runner', crash.kind === 'ran' && crash.exitCode !== 0, show(crash))
  const big = await R(d, ['-e', 'process.exit(3221225477)'])
  check('C: an exit code as big as a Windows crash code (3221225477) is read as the unsigned number it is', big.kind === 'ran' && big.exitCode === 3221225477, show(big))

  // ---- the environment: nothing of the app
  process.env.FRONTIER_CANARY_KEY = 'sk-ant-canary-' + crypto.randomBytes(6).toString('hex')
  process.env.OPENAI_API_KEY = 'sk-canary-' + crypto.randomBytes(6).toString('hex')
  put(d, 'env.cjs', "require('fs').writeFileSync('env.json', JSON.stringify({ env: process.env, home: require('os').homedir() }))")
  const e = await R(d, ['env.cjs'])
  const seen = readJsonOr(d, 'env.json', { env: {}, home: '' })
  const keys = Object.keys(seen.env).map((k) => k.toLowerCase()).sort()
  check('C: the environment is the fixed small set and no more', e.kind === 'ran' && JSON.stringify(keys) === JSON.stringify(['comspec', 'home', 'localappdata', 'path', 'pathext', 'systemroot', 'temp', 'tmp', 'userprofile', 'windir']), keys.join(','))
  check('C: no key, no token and no APPDATA of the app reaches it', !JSON.stringify(seen).includes(process.env.FRONTIER_CANARY_KEY) && !JSON.stringify(seen).includes(process.env.OPENAI_API_KEY) && !('APPDATA' in seen.env) && !JSON.stringify(seen).includes(process.env.USERNAME ?? '\u0000no-user'), keys.join(','))
  const lt = seen.env.LOCALAPPDATA ?? ''
  check('C: its home is the drive root; its local app data and temp are in the folder the launcher made for it (.frontier-box), not in the user\'s', ['HOME', 'USERPROFILE'].every((k) => /^[A-Z]:\\$/.test(seen.env[k])) && /^[A-Z]:\\\.frontier-box\\Packages\\frontierapp\.run\\AC$/.test(lt) && seen.env.TEMP === lt + '\\Temp' && seen.env.TMP === lt + '\\Temp', show({ home: seen.env.HOME, lt, temp: seen.env.TEMP }))
  check('C: the private tools folder leads its PATH', seen.env.PATH.toLowerCase().startsWith(runner.folders.tools.toLowerCase() + ';'), seen.env.PATH)
  put(d, 'tmp.cjs', "const fs = require('fs'); const os = require('os'); const f = os.tmpdir() + '\\\\made-in-temp.txt'; fs.writeFileSync(f, 'x'); fs.writeFileSync('tmp.json', JSON.stringify({ tmp: os.tmpdir(), wrote: fs.existsSync(f) }))")
  await R(d, ['tmp.cjs'])
  const tj = readJsonOr(d, 'tmp.json', {})
  check('C: the box\'s temp folder exists and works, and it is inside the scratch folder (so nothing it writes there reaches the real temp folder)', tj.wrote === true && fs.existsSync(J(d, '.frontier-box', 'Packages', 'frontierapp.run', 'AC', 'Temp', 'made-in-temp.txt')), show(tj))
  delete process.env.FRONTIER_CANARY_KEY
  delete process.env.OPENAI_API_KEY

  // ---- the limits, one by one
  put(d, 'loop.cjs', 'for (;;);')
  const tl = await R(d, ['loop.cjs'], { timeoutMs: 1500 })
  check('C: an endless loop is ended at its clock, and nothing is left', tl.kind === 'ran' && tl.timedOut === true && tl.elapsedMs >= 1400 && tl.elapsedMs < 5000 && tl.leftoverAfter === 0 && noMounts(), show(tl))
  put(d, 'mem.cjs', "const keep = []; let mb = 0; for (;;) { keep.push(Buffer.alloc(8 * 1024 * 1024, 1)); mb += 8; require('fs').writeSync(1, 'MB ' + mb + '\\n'); if (mb >= 400) break }")
  const mem = await R(d, ['mem.cjs'], { memoryBytes: 128 * 1024 * 1024 })
  const reached = Number((mem.stdout.match(/MB (\d+)/g) ?? ['MB 0']).pop().slice(3))
  check('C: a memory limit of 128 MB stops an allocation loop before 400 MB, and the peak stays near the limit', mem.kind === 'ran' && reached < 200 && mem.exitCode !== 0 && mem.peakMemoryBytes < 160 * 1024 * 1024, `reached ${reached}, peak ${mem.peakMemoryBytes}`)
  const mem2 = await R(d, ['mem.cjs'], { memoryBytes: 1024 ** 3 })
  check('C: the same program reaches 400 MB with the default 1 GB (the limit is what stopped it)', mem2.kind === 'ran' && /MB 400/.test(mem2.stdout) && mem2.exitCode === 0, mem2.stdout.slice(-40))
  put(d, 'flood.cjs', "const c = 'x'.repeat(65536); for (let i = 0; i < 200; i++) require('fs').writeSync(1, c)")
  const fl = await R(d, ['flood.cjs'], { outputBytes: 1000 })
  check('C: output is kept up to the cap and counted past it', fl.kind === 'ran' && fl.stdout.length === 1000 && fl.stdoutBytes === 200 * 65536, `${fl.stdout.length} of ${fl.stdoutBytes}`)
  const fl2 = await R(d, ['flood.cjs'], { timeoutMs: 20000 })
  check('C: an output of 13 MB with the largest cap gives 64 KB and ends', fl2.kind === 'ran' && fl2.stdout.length === 65536 && fl2.stdoutBytes === 200 * 65536, `${fl2.stdout.length}`)
  put(d, 'fill.cjs', "const fs = require('fs'); const mb = Number(process.argv[2]); let i = 0; const timer = setInterval(() => { fs.writeFileSync('fill-' + (i++) + '.bin', Buffer.alloc(1024 * 1024, 1)); if (i >= mb) { clearInterval(timer); setTimeout(() => process.exit(0), 300) } }, 20)")
  const fillBig = await R(d, ['fill.cjs', '200'], { diskBytes: 5 * 1024 * 1024, timeoutMs: 30000 })
  check('C: a program that writes past the disk cap (5 MB; it tries 200) is ended for it, and says so', fillBig.kind === 'ran' && fillBig.diskExceeded === true && fillBig.timedOut === false && fillBig.scratchBytes >= 5 * 1024 * 1024 && fillBig.scratchBytes < 60 * 1024 * 1024 && fillBig.leftoverAfter === 0, show(fillBig))
  const filesMade = fs.readdirSync(d).filter((f) => f.startsWith('fill-')).length
  check('C: it was ended long before it had written what it wanted', filesMade > 0 && filesMade < 100, `${filesMade} files`)
  for (const f of fs.readdirSync(d).filter((x) => x.startsWith('fill-'))) fs.rmSync(J(d, f))
  const fillSmall = await R(d, ['fill.cjs', '2'], { diskBytes: 5 * 1024 * 1024 })
  check('C: a program that stays within the cap is not touched, and the size of the folder is reported', fillSmall.kind === 'ran' && fillSmall.diskExceeded === false && fillSmall.exitCode === 0 && fillSmall.scratchBytes >= 2 * 1024 * 1024, show(fillSmall))
  for (const f of fs.readdirSync(d).filter((x) => x.startsWith('fill-'))) fs.rmSync(J(d, f))
  // (10 October 2026: the children are node sleepers now. The counting loop of cmd.exe that they used to be does not stay alive in the box on the Windows build of this PC any more: it
  // exits at once, so the run had nothing left to end; the property is the same, and it is kept by a child that really sleeps and that is not tied to its parent's exit)
  put(d, 'kids.cjs', "const cp = require('child_process'); let ok = 0, bad = 0; for (let i = 0; i < 20; i++) { try { const c = cp.spawn(process.execPath, ['-e', 'setTimeout(function(){},120000)'], { detached: true, stdio: 'ignore', windowsHide: true }); c.on('error', () => {}); c.unref(); if (c.pid) ok++; else bad++ } catch { bad++ } } setTimeout(() => { require('fs').writeFileSync('kids.json', JSON.stringify({ ok, bad })); process.exit(0) }, 1500)")
  const kids = await R(d, ['kids.cjs'], { maxProcesses: 6, timeoutMs: 20000 })
  const kj = readJsonOr(d, 'kids.json', { ok: 99, bad: 0 })
  check('C: a limit of 6 processes lets at most 5 children start', kids.kind === 'ran' && kj.ok <= 5 && kj.bad >= 15, show(kj))
  check('C: the children that were running were ended with the run', kids.leftoverKilled >= 1 && kids.leftoverAfter === 0, show({ k: kids.leftoverKilled, a: kids.leftoverAfter }))
  put(d, 'child.cjs', "const c = require('child_process').spawn(process.execPath, ['-e', 'setTimeout(function(){},120000)'], { detached: true, stdio: 'ignore', windowsHide: true }); c.unref(); setTimeout(() => { require('fs').writeFileSync('child.pid', String(c.pid)); process.exit(0) }, 800)")
  const ch = await R(d, ['child.cjs'])
  const cpid = fs.existsSync(J(d, 'child.pid')) ? Number(fs.readFileSync(J(d, 'child.pid'), 'utf8')) : 0
  await wait(500)
  check('C: a child left running by the program is ended when the run ends', ch.kind === 'ran' && ch.leftoverKilled >= 1 && cpid > 0 && !alive(cpid), show({ cpid, alive: alive(cpid), k: ch.leftoverKilled }))

  // ---- the programs
  const sys = (prog, args) => runner.run({ program: prog, args, scratchDir: d })
  const who = await sys('C:\\Windows\\System32\\whoami.exe', [])
  check('C: a program of the Windows folder runs (whoami)', who.kind === 'ran' && who.exitCode === 0 && who.stdout.length > 0, show(who))
  const ver = await sys('C:\\Windows\\System32\\cmd.exe', ['/c', 'ver'])
  check('C: cmd.exe runs', ver.kind === 'ran' && ver.exitCode === 0 && /Windows/.test(ver.stdout), show(ver))
  const ps = await sys('C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', 'Write-Output (1+1)'])
  check('C: powershell.exe runs inside the box', ps.kind === 'ran' && ps.exitCode === 0 && ps.stdout.trim() === '2', show(ps))

  // ---- the private copy of node.exe
  const copy = J(runner.folders.tools, 'node.exe')
  check('C: node ran from a private copy, the same size as the installed one', fs.existsSync(copy) && fs.statSync(copy).size === fs.statSync(NODE).size)
  put(d, 'self.cjs', "const fs = require('fs'); const r = {}; const t = (n, f) => { try { f(); r[n] = 'DONE' } catch (e) { r[n] = e.code } }; t('append', () => fs.appendFileSync(process.execPath, 'x')); t('delete', () => fs.unlinkSync(process.execPath)); t('rename', () => fs.renameSync(process.execPath, process.execPath + '.x')); t('read', () => fs.readFileSync(process.execPath).length); r.execPath = process.execPath; fs.writeFileSync('self.json', JSON.stringify(r))")
  await R(d, ['self.cjs'])
  const self = readJsonOr(d, 'self.json', {})
  check('C: the box can run its copy of node but not change, delete or move it', self.append === 'EPERM' && self.delete === 'EPERM' && self.rename === 'EPERM' && self.read === 'DONE', show(self))
  check('C: the copy is unchanged after the box tried', fs.statSync(copy).size === fs.statSync(NODE).size)
  fs.appendFileSync(copy, 'tampered')
  const again = await R(d, ['-e', 'process.exit(0)'])
  check('C: a changed copy is replaced before the next run', again.kind === 'ran' && fs.statSync(copy).size === fs.statSync(NODE).size, `${fs.statSync(copy).size} vs ${fs.statSync(NODE).size}`)

  // ---- three at once
  const ds = [scratch('par'), scratch('par'), scratch('par')]
  for (const x of ds) put(x, 'p.cjs', "require('fs').writeFileSync('who.txt', process.cwd()); setTimeout(() => process.exit(0), 2500)")
  const outs = await Promise.all(ds.map((x) => R(x, ['p.cjs'])))
  const letters = ds.map((x) => (fs.existsSync(J(x, 'who.txt')) ? fs.readFileSync(J(x, 'who.txt'), 'utf8') : ''))
  check('C: three runs at once all finish, each with a drive letter of its own', outs.every((o) => o.kind === 'ran' && o.exitCode === 0) && letters.every((l) => l !== '') && new Set(letters).size === 3, show({ letters, outs: outs.map((o) => (o.kind === 'ran' ? o.exitCode : `${o.why}: ${o.message}`)) }))
  check('C: and every letter is gone afterwards', noMounts())

  // ---- what a person would see in the box's words later: refused things never start
  const g = fs.existsSync(J(process.env.LOCALAPPDATA ?? '', 'Programs', 'PortableGit', 'mingw64', 'bin', 'git.exe')) ? J(process.env.LOCALAPPDATA, 'Programs', 'PortableGit', 'mingw64', 'bin', 'git.exe') : null
  if (g) {
    const r = await runner.run({ program: g, args: ['--version'], scratchDir: d })
    check('C: git.exe in the user\'s folder is refused (it is not in the Windows folder)', r.kind === 'not-run' && r.why === 'refused', show(r))
  }
  fs.copyFileSync(J(runner.folders.tools, 'node.exe'), J(d, 'node.exe'))
  const fake = await runner.run({ program: J(d, 'node.exe'), args: ['-v'], scratchDir: d })
  check('C: a file called node.exe that is not in Program Files is refused', fake.kind === 'not-run' && fake.why === 'refused', show(fake))
  const missing = await runner.run({ program: 'C:\\Windows\\System32\\nothing-here.exe', args: [], scratchDir: d })
  check('C: a program that is not there is refused', missing.kind === 'not-run' && missing.why === 'refused' && /not there/.test(missing.message), show(missing))
  const dirAsProgram = await runner.run({ program: 'C:\\Windows\\System32\\en-US.exe', args: [], scratchDir: d })
  check('C: another missing name is refused too', dirAsProgram.kind === 'not-run')
  const noScratch = await runner.run({ program: NODE, args: ['-v'], scratchDir: J(runRoot, 'scratch', 'never-made') })
  check('C: a folder that is not there is refused', noScratch.kind === 'not-run' && noScratch.why === 'refused', show(noScratch))
  put(runRoot, 'afile.txt', 'x')
  const fileAsDir = await runner.run({ program: NODE, args: ['-v'], scratchDir: J(runRoot, 'afile.txt') })
  check('C: a file given as the folder is refused', fileAsDir.kind === 'not-run' && fileAsDir.why === 'refused', show(fileAsDir))
  const target = scratch('linktarget')
  const link = J(runRoot, 'scratch', 'a-link')
  fs.symlinkSync(target, link, 'junction')
  const viaLink = await runner.run({ program: NODE, args: ['-v'], scratchDir: link })
  check('C: a junction given as the folder is refused', viaLink.kind === 'not-run' && viaLink.why === 'refused' && /ordinary folder/.test(viaLink.message), show(viaLink))
  fs.rmdirSync(link)
  const refusedStartsNothing = noMounts() && fs.readdirSync(runner.folders.specs).length === 0
  check('C: refusals start nothing (no letter, no spec file)', refusedStartsNothing)
})

// ============================ D. hostile arguments =======================
await guard('D', async () => {
  const d = scratch('argv')
  put(d, 'argv.cjs', "require('fs').writeFileSync('argv.json', JSON.stringify(process.argv.slice(2)))")
  const HOSTILE = [
    '', ' ', 'a b', 'a  b', '\t', 'tab\there', 'line\nbreak', 'cr\rlf', 'cr\r\nlf', 'q"uote', '"', '""', '"""', '\\"', '\\\\"', '\\\\\\"', 'C:\\x\\', 'C:\\x y\\', 'ends with backslash\\', 'ends with two\\\\', '\\\\server\\share\\',
    '&', '|', '<', '>', '^', '%PATH%', '%', '!', '!PATH!', '$(whoami)', '`whoami`', '${env:PATH}', ';', '&&', '||', '2>&1', '> out.txt', '*', '?', '~', '--', '-e', '--eval=1', '--inspect', '@file', '#', "'single'", '"double"', 'a"b c"d', '"a b" "c d"',
    'A'.repeat(4000), 'x'.repeat(RUN_ARGS.charsEach),
    'é', 'ü', cp([0x65e5, 0x672c, 0x8a9e]), cp([0x1f600]), cp([0x202e]) + 'rtl', cp([0x200b]) + 'zwsp', 'a' + cp([0x301]), cp([0xfeff]) + 'bom', 'C:\\Program Files\\x', 'a=b', '/c', '/?', '-NoProfile', '-File x', 'trail ', ' lead', 'x', ',', 'a,b', '{}', '[]', '..\\..\\x', 'CON', 'NUL', 'x:y', '\\\\?\\C:\\x'
  ]
  const total = HOSTILE.reduce((s, a) => s + a.length + 3, 0)
  check('D: the hostile list is within the argument caps (so the runner takes it)', HOSTILE.length <= RUN_ARGS.count && total <= RUN_ARGS.charsTotal, `${HOSTILE.length} args, ${total} chars`)
  const out = await R(d, ['argv.cjs', ...HOSTILE])
  check('D: the run with all of them worked', out.kind === 'ran' && out.exitCode === 0, show(out))
  const got = fs.existsSync(J(d, 'argv.json')) ? readJson(d, 'argv.json') : null
  check(`D: all ${HOSTILE.length} arguments arrived exactly as they were, in order`, !!got && got.length === HOSTILE.length && HOSTILE.every((a, i) => got[i] === a), got ? (got.findIndex((a, i) => a !== HOSTILE[i]) >= 0 ? `first difference at ${got.findIndex((a, i) => a !== HOSTILE[i])}: ${show(got[got.findIndex((a, i) => a !== HOSTILE[i])])} instead of ${show(HOSTILE[got.findIndex((a, i) => a !== HOSTILE[i])])}` : `length ${got.length}`) : 'no file')
  // every one of them alone too (an argument that eats the next one would hide in the long list)
  let alone = 0
  const odd = []
  for (const a of ['', '"', '\\"', 'C:\\x y\\', '%PATH%', '& whoami', 'a"b c"d', '\\\\"', cp([0x1f600])]) {
    fs.rmSync(J(d, 'argv.json'), { force: true })
    await R(d, ['argv.cjs', a, 'next'])
    const g = fs.existsSync(J(d, 'argv.json')) ? readJson(d, 'argv.json') : null
    if (g && g.length === 2 && g[0] === a && g[1] === 'next') alone++
    else odd.push(show(a) + ' -> ' + show(g))
  }
  check('D: nine of the nastiest, each alone and followed by one more argument, arrive as exactly two', alone === 9, odd.join(' | '))
  // a shell program given the dangerous characters: they are one argument, the program sees them, and nothing the shell would do happens
  const marker = J(d, 'MUST-NOT-EXIST.txt')
  const cmd = await runner.run({ program: 'C:\\Windows\\System32\\cmd.exe', args: ['/c', 'echo', 'hi', '&', 'echo', 'x', '>', 'MUST-NOT-EXIST.txt'], scratchDir: d })
  check('D: cmd.exe is a program like any other: the person sees its arguments; it can only write inside the scratch folder', cmd.kind === 'ran' && !fs.existsSync(J(runRoot, 'MUST-NOT-EXIST.txt')) && !fs.existsSync(J(ROOT, 'MUST-NOT-EXIST.txt')), show(cmd))
  void marker
  check('D: nothing the arguments said to do happened outside (no file made at the run root, the folder above, or in the temp folder)', !fs.existsSync(J(runRoot, 'out.txt')) && !fs.existsSync(J(ROOT, 'out.txt')) && !fs.existsSync(J(os.tmpdir(), 'out.txt')))
})

// ============================ E. the launcher's own defence ==============
await guard('E', async () => {
  const d = scratch('spec')
  await R(d, ['-e', 'process.exit(0)']) // makes the launcher file and the tools folder
  const tools = runner.folders.tools
  const resultPath = J(runner.folders.specs, 'hostile.result.json')
  const template = () => ({
    version: 1, container: 'FrontierApp.Test132', runRoot, scratchDir: d, toolsDir: tools, program: J(tools, 'node.exe'), args: ['-v'],
    timeoutMs: 5000, memoryBytes: 256 * 1024 * 1024, maxProcesses: 8, capBytes: 1000, diskBytes: 100 * 1024 * 1024, parentPid: 0, result: resultPath
  })
  const give = (spec, raw) => {
    fs.rmSync(resultPath, { force: true })
    const specPath = J(runner.folders.specs, 'hostile.json')
    fs.writeFileSync(specPath, raw ?? JSON.stringify(spec))
    const p = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', launcherFile(), '-SpecPath', specPath], { encoding: 'utf8', timeout: 90000, windowsHide: true })
    let r = null
    try {
      r = JSON.parse(fs.readFileSync(resultPath, 'utf8'))
    } catch {
      r = null
    }
    return { r, status: p.status }
  }
  const base = give(template())
  check('E: the template spec itself works (so each change below is the only reason for a refusal)', base.r?.ok === true && base.r.exitCode === 0 && /v\d+\./.test(base.r.stdout), show(base.r))
  const noLetter = () => noMounts()
  const refused = (name, spec, fragment, raw) => {
    const x = give(spec, raw)
    check(`E: ${name} is refused by the launcher before anything is made`, x.r?.ok === false && x.r.stage === 'check-spec' && (!fragment || x.r.error.includes(fragment)) && noLetter(), show(x.r))
  }
  const mutate = (patch) => ({ ...template(), ...patch })
  refused('version 3', mutate({ version: 3 }), 'version')
  refused('a run spec that says version 2 (the serve spec of a connector since 14: it is read as one, and its fields are not those)', mutate({ version: 2 }), 'mode')
  refused('a field more', mutate({ shell: 'cmd' }), 'too many')
  const missing = template()
  delete missing.capBytes
  refused('a missing field', missing, 'capBytes')
  refused('a container that is not ours', mutate({ container: 'Evil.Box' }), 'not ours')
  refused('a container name with a space', mutate({ container: 'FrontierApp.a b' }), 'not ours')
  refused('a container name that is too long', mutate({ container: 'FrontierApp.' + 'a'.repeat(41) }), 'not ours')
  for (const v of [99, 120001]) refused(`timeoutMs ${v}`, mutate({ timeoutMs: v }), 'timeoutMs')
  for (const v of [1, 1024 ** 3 + 1, 2 * 1024 ** 3]) refused(`memoryBytes ${v}`, mutate({ memoryBytes: v }), 'memoryBytes')
  for (const v of [0, 65, 1000]) refused(`maxProcesses ${v}`, mutate({ maxProcesses: v }), 'maxProcesses')
  for (const v of [0, 65537]) refused(`capBytes ${v}`, mutate({ capBytes: v }), 'capBytes')
  for (const v of [0, 1024 * 1024 - 1, 512 * 1024 * 1024 + 1]) refused(`diskBytes ${v}`, mutate({ diskBytes: v }), 'diskBytes')
  refused('a negative parent', mutate({ parentPid: -1 }), 'parentPid')
  refused('101 arguments', mutate({ args: new Array(101).fill('a') }), 'too many arguments')
  refused('an argument of 8193 characters', mutate({ args: ['x'.repeat(8193)] }), 'too long')
  refused('an argument with a NUL', mutate({ args: ['a\u0000b'] }), 'NUL', JSON.stringify(mutate({ args: ['a\u0000b'] })))
  refused('a scratch folder outside the run root', mutate({ scratchDir: ROOT }), 'outside')
  refused('a scratch folder that is the run root', mutate({ scratchDir: runRoot }), 'outside')
  refused('a scratch folder in a sibling that starts like the run root', mutate({ scratchDir: runRoot + '-evil' }), 'outside')
  fs.mkdirSync(runRoot + '-evil', { recursive: true })
  refused('the same sibling when it exists', mutate({ scratchDir: runRoot + '-evil' }), 'outside')
  refused('the user\'s profile as the scratch folder', mutate({ scratchDir: process.env.USERPROFILE }), 'outside')
  // drive roots that are only STRINGS: letters nothing is mounted on, so that even a launcher that lost its check could do nothing with them
  const NO_DRIVE = [...'QPONMLKJ'].filter((l) => !fs.existsSync(l + ':\\'))
  refused('a drive root as the run root', mutate({ runRoot: NO_DRIVE[0] + ':\\' }), 'drive root')
  refused('a drive root in small letters as the run root', mutate({ runRoot: NO_DRIVE[1].toLowerCase() + ':\\' }), 'drive root')
  refused('a tools folder that is the scratch folder', mutate({ toolsDir: d }), 'overlap')
  fs.mkdirSync(J(d, 'tools-inside'), { recursive: true })
  refused('a tools folder inside the scratch folder', mutate({ toolsDir: J(d, 'tools-inside') }), 'overlap')
  refused('a scratch folder inside the tools folder', mutate({ scratchDir: J(tools, 'inner') }), 'not there')
  fs.mkdirSync(J(tools, 'inner'), { recursive: true })
  refused('the same when it exists', mutate({ scratchDir: J(tools, 'inner') }), 'overlap')
  const linkTarget = scratch('lt')
  const link = J(runRoot, 'scratch', 'spec-link')
  fs.symlinkSync(linkTarget, link, 'junction')
  refused('a scratch folder that is a junction', mutate({ scratchDir: link }), 'link')
  refused('a tools folder that is a junction', mutate({ toolsDir: link }), 'link')
  fs.rmdirSync(link)
  refused('a scratch folder that is not there', mutate({ scratchDir: J(runRoot, 'scratch', 'nope') }), 'not there')
  refused('a program that is not an .exe', mutate({ program: J(d, 'x.cmd') }), '.exe')
  refused('an .exe that is not there', mutate({ program: J(d, 'nothing.exe') }), '.exe')
  refused('a relative program', mutate({ program: 'node.exe' }), 'absolute')
  refused('a share as the program', mutate({ program: '\\\\localhost\\c$\\Windows\\System32\\whoami.exe' }), 'absolute')
  refused('a relative scratch folder', mutate({ scratchDir: 'scratch\\x' }), 'absolute')
  fs.rmSync(resultPath, { force: true })
  const notJson = give(null, 'this is { not json')
  check('E: a spec that is not JSON makes the launcher stop (exit code 2) without writing anything', notJson.r === null && notJson.status === 2, show(notJson))
  const nores = template()
  nores.result = 'result.json'
  fs.rmSync(resultPath, { force: true })
  const noRes = give(nores)
  check('E: a spec whose result path is not absolute makes the launcher stop (exit code 2) without writing anywhere', noRes.r === null && noRes.status === 2 && !fs.existsSync(J(process.cwd(), 'result.json')) && !fs.existsSync(J(runRoot, 'result.json')) && !fs.existsSync(J(d, 'result.json')), show(noRes))
  for (const odd of ['\\\\localhost\\c$\\x\\r.json', 'C:r.json', '\\r.json', '']) {
    const x = template()
    x.result = odd
    const g = give(x)
    check(`E: a result path like ${show(odd)} is not used either`, g.r === null && g.status === 2, show(g))
  }
  fs.rmSync(J(runner.folders.specs, 'hostile.json'), { force: true })
  fs.rmSync(resultPath, { force: true })
  check('E: after all of those, no drive letter and no process of the box is left', noMounts())
  fs.rmSync(runRoot + '-evil', { recursive: true, force: true })
})

// ============================ F. a launcher that fails ===================
let standin = null
await guard('F', async () => {
  standin = J(TOOLS, 'standin-launcher.cjs')
  check('F: the stand-in launcher is there', fs.existsSync(standin))
  const d = scratch('standin')
  const pidFile = J(ROOT, 'standin.pid')
  const via = async (mode, extra = {}) => {
    process.env.STANDIN_MODE = mode
    process.env.STANDIN_PIDFILE = pidFile
    fs.rmSync(pidFile, { force: true })
    const r = createCommandRunner({ runRoot, powershellPath: process.execPath, launcherArguments: (_launcher, spec) => [standin, spec], launcherGraceMs: 1500 })
    const t0 = Date.now()
    const out = await r.run({ program: NODE, args: ['-v'], scratchDir: d, timeoutMs: 1000, ...extra })
    return { out, ms: Date.now() - t0, pid: fs.existsSync(pidFile) ? Number(fs.readFileSync(pidFile, 'utf8')) : 0 }
  }
  process.env.STANDIN_SPECCOPY = J(ROOT, 'spec-copy.json')
  const fine = await via('fine')
  const sp = JSON.parse(fs.readFileSync(process.env.STANDIN_SPECCOPY, 'utf8'))
  const wantKeys = ['args', 'capBytes', 'container', 'diskBytes', 'maxProcesses', 'memoryBytes', 'parentPid', 'program', 'result', 'runRoot', 'scratchDir', 'timeoutMs', 'toolsDir', 'version']
  const parts = {
    keys: JSON.stringify(Object.keys(sp).sort()) === JSON.stringify(wantKeys),
    version: sp.version === 1,
    container: sp.container === CONTAINER_NAME,
    roots: sp.runRoot === runRoot && sp.scratchDir === d && sp.toolsDir === runner.folders.tools,
    program: sp.program.toLowerCase() === J(runner.folders.tools, 'node.exe').toLowerCase(),
    parent: sp.parentPid === process.pid,
    numbers: sp.timeoutMs === 1000 && sp.memoryBytes === 1024 ** 3 && sp.maxProcesses === 64 && sp.capBytes === 65536 && sp.diskBytes === 512 * 1024 * 1024,
    args: JSON.stringify(sp.args) === '["-v"]',
    result: sp.result.toLowerCase().startsWith(runner.folders.specs.toLowerCase() + '\\') && /\.result\.json$/.test(sp.result)
  }
  check('F: the spec the runner writes has exactly the fields the launcher reads, with the right values', Object.values(parts).every(Boolean), show(parts))
  const lim = await (async () => {
    const r = createCommandRunner({ runRoot, powershellPath: process.execPath, launcherArguments: (_l, spec) => [standin, spec], launcherGraceMs: 1500 })
    await r.run({ program: NODE, args: ['x'], scratchDir: d, timeoutMs: 777, memoryBytes: 33 * 1024 * 1024, maxProcesses: 3, outputBytes: 99, diskBytes: 7 * 1024 * 1024 })
    return JSON.parse(fs.readFileSync(process.env.STANDIN_SPECCOPY, 'utf8'))
  })()
  check('F: the numbers the caller chose are the numbers in the spec (each in its own field)', lim.timeoutMs === 777 && lim.memoryBytes === 33 * 1024 * 1024 && lim.maxProcesses === 3 && lim.capBytes === 99 && lim.diskBytes === 7 * 1024 * 1024 && JSON.stringify(lim.args) === '["x"]', show(lim))
  check('F: the stand-in that answers properly gives a result (so each failure below is the stand-in\'s own)', fine.out.kind === 'ran' && fine.out.stdout === 'from the stand-in' && fine.out.exitCode === 0, show(fine.out))
  const dies = await via('exit1')
  check('F: a launcher that dies at once is "launcher-failed", with its exit code in the words, and nothing ran', dies.out.kind === 'not-run' && dies.out.why === 'launcher-failed' && /no result/.test(dies.out.message) && /code 1/.test(dies.out.message), show(dies.out))
  const hang = await via('hang')
  await wait(500)
  check('F: a launcher that hangs is ended after the clock plus the grace, and is gone', hang.out.kind === 'not-run' && hang.out.why === 'launcher-timeout' && hang.ms >= 2400 && hang.ms < 9000 && hang.pid > 0 && !alive(hang.pid), `${show(hang.out)} ${hang.ms} ms, pid ${hang.pid} alive ${alive(hang.pid)}`)
  for (const [mode, name] of [['garbage', 'a result that is not JSON'], ['array', 'a result that is an array'], ['badtypes', 'a result with an exit code that is text'], ['nostdout', 'a result with no output']]) {
    const x = await via(mode)
    check(`F: ${name} is "launcher-failed", never a guess`, x.out.kind === 'not-run' && x.out.why === 'launcher-failed', show(x.out))
  }
  const cont = await via('container')
  check('F: "the box could not be made" is "isolation-unavailable" with the reason on ONE line, and nothing ran', cont.out.kind === 'not-run' && cont.out.why === 'isolation-unavailable' && /container: AppContainer profile/.test(cont.out.message) && !/[\r\n]/.test(cont.out.message), show(cont.out))
  const cs = await via('checkspec')
  check('F: the launcher refusing the spec is "launcher-failed" (a bug of ours, not the PC)', cs.out.kind === 'not-run' && cs.out.why === 'launcher-failed', show(cs.out))
  const pg = await via('parentgone')
  check('F: "the app was closing" is "aborted"', pg.out.kind === 'not-run' && pg.out.why === 'aborted', show(pg.out))
  const nothing = createCommandRunner({ runRoot, powershellPath: J(ROOT, 'no-such-powershell.exe') })
  const none = await nothing.run({ program: NODE, args: ['-v'], scratchDir: d })
  check('F: no PowerShell at all is "launcher-failed" and nothing ran', none.kind === 'not-run' && none.why === 'launcher-failed', show(none))
  delete process.env.STANDIN_MODE
  delete process.env.STANDIN_PIDFILE
  check('F: there is no way to run the program without the launcher (every failure above ran nothing, left no letter and no spec file)', noMounts() && fs.readdirSync(runner.folders.specs).length === 0, show({ mounts: listMounts(runRoot), specs: fs.readdirSync(runner.folders.specs) }))
  // the launcher on disk changed
  const path = launcherFile()
  fs.appendFileSync(path, '\n# changed by someone\n')
  const healed = await R(scratch('heal'), ['-e', 'process.exit(0)'])
  check('F: a launcher file that was changed is written again before the run', healed.kind === 'ran' && fs.readFileSync(path, 'utf8') === LAUNCHER_TEXT)
  fs.rmSync(path, { force: true })
  fs.mkdirSync(path)
  const blocked = await R(scratch('block'), ['-e', 'process.exit(0)'])
  check('F: a launcher file that cannot be put right (a folder is in its place) stops the run: "launcher-modified"', blocked.kind === 'not-run' && blocked.why === 'launcher-modified', show(blocked))
  fs.rmdirSync(path)
  const back = await R(scratch('back'), ['-e', 'process.exit(0)'])
  check('F: and it works again when the way is clear', back.kind === 'ran')
})

// ============================ G. Stop everything, the app's end ===========
await guard('G', async () => {
  const sleepy = "require('fs').writeFileSync('box.pid', String(process.pid)); setTimeout(() => {}, 120000)"
  // ---- an AbortSignal
  const d1 = scratch('abort')
  put(d1, 'sleepy.cjs', sleepy)
  const ac = new AbortController()
  const p1 = runner.run({ program: NODE, args: ['sleepy.cjs'], scratchDir: d1, timeoutMs: 120000 }, { signal: ac.signal })
  const started = await until(() => fs.existsSync(J(d1, 'box.pid')), 30000)
  check('G: the long run started', !!started)
  const boxPid = Number(fs.readFileSync(J(d1, 'box.pid'), 'utf8'))
  check('G: the runner knows it is running', runner.live() >= 1)
  const t1 = Date.now()
  ac.abort()
  const out = await p1
  check('G: Stop (an AbortSignal) gives "aborted" within seconds', out.kind === 'not-run' && out.why === 'aborted' && Date.now() - t1 < 8000, `${show(out)} ${Date.now() - t1} ms`)
  const gone = await until(() => !alive(boxPid), 8000)
  check('G: and the program in the box is gone', !!gone, `pid ${boxPid}`)
  check('G: the drive letter is gone and the runner has nothing running', (await until(() => noMounts() && runner.live() === 0, 8000)) !== null, show(listMounts(runRoot)))
  const pre = new AbortController()
  pre.abort()
  const early = await runner.run({ program: NODE, args: ['-v'], scratchDir: d1 }, { signal: pre.signal })
  check('G: a signal that is already aborted starts nothing', early.kind === 'not-run' && early.why === 'aborted')

  // ---- the app's end: the launcher watches the app and ends the box by itself
  const d2 = scratch('appdies')
  put(d2, 'sleepy.cjs', sleepy)
  const fake = J(ROOT, 'fakeapp.mjs')
  fs.writeFileSync(
    fake,
    `import '${REPO_URL}/tools/ts-resolve.mjs'\nconst { createCommandRunner } = await import('${SRC}/main/commandRunner.ts')\nconst runner = createCommandRunner({ runRoot: process.env.FA_ROOT })\nrunner.run({ program: process.env.FA_NODE, args: ['sleepy.cjs'], scratchDir: process.env.FA_SCRATCH, timeoutMs: 120000 }).then((o) => console.log('OUTCOME ' + JSON.stringify(o)))\nsetInterval(() => {}, 1000)\n`
  )
  const app = spawn(process.execPath, [fake], { env: { ...process.env, FA_ROOT: runRoot, FA_NODE: NODE, FA_SCRATCH: d2 }, stdio: 'ignore', windowsHide: true })
  const up = await until(() => fs.existsSync(J(d2, 'box.pid')), 40000)
  check('G: a run started by a stand-in "app" is going', !!up)
  const box2 = Number(fs.readFileSync(J(d2, 'box.pid'), 'utf8'))
  const psCount = () => Number(execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', `(Get-CimInstance Win32_Process -Filter "Name='powershell.exe'" | Where-Object { $_.ProcessId -ne $PID -and $_.CommandLine -like '*${runRoot.replace(/'/g, "''")}*commandLauncher-*' } | Measure-Object).Count`], { encoding: 'utf8', windowsHide: true }).trim())
  check('G: its launcher (a PowerShell) is running, and so is its drive letter', psCount() >= 1 && listMounts(runRoot).length === 1, `${psCount()} ${show(listMounts(runRoot))}`)
  process.kill(app.pid, 'SIGKILL') // the app is killed WITHOUT a chance to clean up; its children (the launcher) are not touched
  const t2 = Date.now()
  const boxGone = await until(() => !alive(box2), 25000)
  check('G: the app is killed: the program in the box is gone within seconds', !!boxGone, `${Date.now() - t2} ms`)
  const psGone = await until(() => psCount() === 0, 25000)
  check('G: ...and so is the launcher (Node ends the children of a process that dies)', !!psGone, `${psCount()} left`)
  const left = listMounts(runRoot)
  check('G: the drive letter MAY stay behind (the launcher was ended with the app and could not take it away): at most the one of that run', left.length <= 1 && left.every((m) => m.target.toLowerCase() === d2.toLowerCase()), show(left))
  const swept2 = sweepMounts(runRoot)
  check('G: and the sweep that the app makes at start-up takes it away', noMounts() && swept2.length === left.length, show(swept2))
  const specLeft = fs.readdirSync(runner.folders.specs).length
  void specLeft

  // ---- the launcher's own watch: the "app" is a helper process that is not the launcher's parent, so only the launcher's own watch can notice its death
  const dW = scratch('watch')
  put(dW, 'sleepy.cjs', sleepy)
  const helper = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 120000)'], { stdio: 'ignore', windowsHide: true })
  const specW = J(runner.folders.specs, 'watch.json')
  const resW = J(runner.folders.specs, 'watch.result.json')
  fs.rmSync(resW, { force: true })
  fs.writeFileSync(specW, JSON.stringify({ version: 1, container: 'FrontierApp.Test132', runRoot, scratchDir: dW, toolsDir: runner.folders.tools, program: J(runner.folders.tools, 'node.exe'), args: ['sleepy.cjs'], timeoutMs: 120000, memoryBytes: 256 * 1024 * 1024, maxProcesses: 8, capBytes: 1000, diskBytes: 100 * 1024 * 1024, parentPid: helper.pid, result: resW }))
  const lp = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', launcherFile(), '-SpecPath', specW], { stdio: 'ignore', windowsHide: true })
  let lpDone = false
  lp.on('exit', () => (lpDone = true))
  const upW = await until(() => fs.existsSync(J(dW, 'box.pid')), 40000)
  check('G: a launcher watching a helper "app" has started its box', !!upW)
  const boxW = Number(fs.readFileSync(J(dW, 'box.pid'), 'utf8'))
  check('G: while the "app" lives, the box lives and its letter is there', alive(boxW) && listMounts(runRoot).length === 1)
  const tW = Date.now()
  helper.kill() // the "app" dies
  const wGone = await until(() => !alive(boxW) && lpDone, 25000)
  check('G: the "app" dies: the launcher ends the box BY ITSELF and exits', !!wGone, `${Date.now() - tW} ms`)
  check('G: ...it took its drive letter away first, and said why in the result', noMounts() && fs.existsSync(resW) && JSON.parse(fs.readFileSync(resW, 'utf8')).parentGone === true, fs.existsSync(resW) ? fs.readFileSync(resW, 'utf8').slice(0, 200) : 'no result')
  fs.rmSync(specW, { force: true })
  fs.rmSync(resW, { force: true })

  // ---- stopAll (the app is closing, by its own hand)
  const d3 = scratch('stopall')
  put(d3, 'sleepy.cjs', sleepy)
  const r3 = createCommandRunner({ runRoot })
  const p3 = r3.run({ program: NODE, args: ['sleepy.cjs'], scratchDir: d3, timeoutMs: 120000 })
  await until(() => fs.existsSync(J(d3, 'box.pid')), 40000)
  const box3 = Number(fs.readFileSync(J(d3, 'box.pid'), 'utf8'))
  r3.stopAll()
  const o3 = await p3
  check('G: stopAll ends a run that is going: "aborted"', o3.kind === 'not-run' && o3.why === 'aborted', show(o3))
  check('G: ...and the program, the launcher and the letter with it', (await until(() => !alive(box3) && noMounts(), 8000)) !== null)
  const after = await r3.run({ program: NODE, args: ['-v'], scratchDir: d3 })
  check('G: after stopAll the runner starts nothing (the app is closing)', after.kind === 'not-run' && after.why === 'aborted')

  // ---- the letters
  const outsideFolder = J(ROOT, 'outside-mount')
  const insideFolder = J(runRoot, 'scratch', 'inside-mount')
  fs.mkdirSync(outsideFolder, { recursive: true })
  fs.mkdirSync(insideFolder, { recursive: true })
  const free = [...'YXWVUTSR'].filter((l) => !fs.existsSync(l + ':\\'))
  spawnSync('subst.exe', [free[0] + ':', insideFolder])
  spawnSync('subst.exe', [free[1] + ':', outsideFolder])
  check('G: listMounts finds the letter that points into the run root, and not the one that points elsewhere', listMounts(runRoot).length === 1 && listMounts(runRoot)[0].letter === free[0], show(listMounts(runRoot)))
  check('G: unmountFolder takes away only the letters of that one folder', (unmountFolder(outsideFolder), fs.existsSync(free[1] + ':\\') === false && fs.existsSync(free[0] + ':\\') === true))
  const swept = sweepMounts(runRoot)
  check('G: sweepMounts takes away what points into the run root', swept.join() === free[0] && !fs.existsSync(free[0] + ':\\'), show(swept))
})

// ============================ H. the source ===============================
await guard('H', async () => {
  const runnerSrc = source('src/main/commandRunner.ts')
  const code = runnerSrc.replace(/^\s*\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '')
  const cpImport = /import \{([^}]*)\} from 'child_process'/.exec(runnerSrc)
  const cpNames = (cpImport?.[1] ?? '').split(',').map((x) => x.trim().replace(/^type /, '')).filter(Boolean).sort()
  check('H: the runner uses only spawn, execFile and execFileSync of child_process (no exec of a string, so no shell), and no shell option', JSON.stringify(cpNames) === JSON.stringify(['ChildProcess', 'execFile', 'execFileSync', 'spawn']) && !/\bshell\s*:\s*(true|'|")/.test(code) && !/cmd(\.exe)?['"`,\s]+\/c/.test(code), cpNames.join())
  check('H: every process it starts is started with a list of arguments', (code.match(/\b(spawn|execFile|execFileSync)\(/g) ?? []).length >= 5 && !/spawn\(`|execFile\(`/.test(code))
  check('H: the only text it puts on the launcher\'s command line is two file names that it made', /'-File',\s*launcherPath,\s*'-SpecPath',\s*specPath/.test(code))
  check('H: the spec is written as JSON, never built from text', /JSON\.stringify\(\{\s*version: 1/.test(code))
  const srcFiles = []
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = `${dir}/${e.name}`
      if (e.isDirectory()) walk(p)
      else if (/\.(ts|tsx)$/.test(e.name)) srcFiles.push(p)
    }
  }
  walk(`${REPO}/src`)
  const users = srcFiles.filter((f) => /from ['"][^'"]*(commandRunner|commandLauncher)[^'"]*['"]/.test(fs.readFileSync(f, 'utf8')) && !/commandRunner\.ts$/.test(f))
  // scratchCopy.ts (13.3) takes two helpers from the runner (isInside, sweepMounts), and the run tool (programTools.ts, 13.4) runs through it and resolves the program with isInside;
  // (13.5) the box (programBox.ts) makes the runner and the self-test (selfTest.ts) runs through it; nothing else uses it
  // (14, on purpose: the connectors' service and the wiring take isInside from it, to keep a connector's folder and its removal inside the folder for connectors)
  const others = users.filter((f) => !/(scratchCopy|programTools|programBox|selfTest|connectorService|ipc)\.ts$/.test(f))
  check('H: nothing else in the app imports the runner but the scratch copy (13.3), the run tool (13.4), the box and the self-test (13.5), and the connectors\' service and the wiring (14)', others.length === 0, others.join(', '))
  const powershellUsers = srcFiles.filter((f) => /powershell/i.test(fs.readFileSync(f, 'utf8')))
  // (13.4, on purpose: the run tool names PowerShell only to REFUSE it, as a program a run may never use: in the model's description of the tool and in its list of programs that are not run)
  const refusalOnly = (file) => fs.readFileSync(file, 'utf8').split('\n').filter((l) => /powershell/i.test(l)).every((l) => /cmd, PowerShell and script hosts are refused/.test(l) || /^\s*'powershell(_ise)?',?\s*$/.test(l))
  // (23.5, D-055, on purpose: the code colourer names it only as the language of a code block, the key of its colours; it starts nothing)
  const colourOnly = (file) => fs.readFileSync(file, 'utf8').split('\n').filter((l) => /powershell/i.test(l)).every((l) => /^\s*powershell: \{$/.test(l))
  const startsIt = powershellUsers.filter((f) => !(/programTools\.ts$/.test(f) && refusalOnly(f)) && !(/markdown[\\/]colour\.ts$/.test(f) && colourOnly(f)))
  check('H: commandRunner.ts is the only file of the app that names PowerShell to start it (the run tool names it only to refuse it)', startsIt.length === 1 && /commandRunner\.ts$/.test(startsIt[0]), powershellUsers.join(', '))
  check('H: the launcher is bundled as text (?raw), not read from a path at run time', /commandLauncher\.ps1\?raw/.test(runnerSrc))
  check('H: the runner has no flag, option or environment variable that turns the box off', !/process\.env\.FRONTIER_[A-Z_]*/.test(code) && !/sandbox\s*[:=]\s*false|noBox|unsandboxed|insecure/i.test(code))
  const shared = source('src/shared/run.ts')
  check('H: src/shared/run.ts has no imports (plain data)', !/^import /m.test(shared))
})

// ============================ I. the process is IN the job, and a Stop at any moment leaves nothing ===========================
// (13.7, 10 October 2026: a Stop that landed between the creation of the process and its assignment to the job left a suspended process that nothing ended. The process is now made
// INSIDE the job by the job list attribute and checked there; these runs look from outside: what is in the job is counted and has a peak of memory, and Stops at sixteen different
// moments of the start leave no process of the box, no drive letter and no spec file behind. All of it with programs that end by themselves or are ended by the run.)
await guard('I', async () => {
  const specsIn = () => (fs.existsSync(runner.folders.specs) ? fs.readdirSync(runner.folders.specs) : [])
  const specsBefore = new Set(specsIn())
  const d = scratch('injob')
  put(d, 'nap.cjs', 'setTimeout(function () {}, 2500)')
  const nap = await R(d, ['nap.cjs'], { timeoutMs: 700 })
  check('I: a program that is still running when its clock ends was counted in the job (at least one process), and was ended with it', nap.kind === 'ran' && nap.timedOut === true && nap.leftoverKilled >= 1 && nap.leftoverAfter === 0, show(nap))
  const quick = await R(d, ['-e', 'process.exit(0)'])
  check('I: the job has a peak of memory for a program that ran (the process was in it from the start)', quick.kind === 'ran' && quick.exitCode === 0 && quick.peakMemoryBytes > 4 * 1024 * 1024, show(quick))

  // Stops at sixteen moments, one run after the other: the launcher takes about one to three seconds to make the box (PowerShell, the compile, the container, the letter, the process)
  const sleepy = "require('fs').writeFileSync('box.pid', String(process.pid)); setTimeout(() => {}, 120000)"
  const offsets = [0, 500, 1000, 1500, 2000, 2400, 2700, 3000, 3200, 3400, 3600, 3800, 4000, 4300, 4600, 5000]
  const kinds = []
  const pids = []
  for (const ms of offsets) {
    const dir = scratch('storm')
    put(dir, 'sleepy.cjs', sleepy)
    const ac = new AbortController()
    const p = runner.run({ program: NODE, args: ['sleepy.cjs'], scratchDir: dir, timeoutMs: 120000 }, { signal: ac.signal })
    await wait(ms)
    ac.abort()
    const o = await p
    kinds.push(`${o.kind}:${o.why ?? ''}`)
    if (fs.existsSync(J(dir, 'box.pid'))) pids.push(Number(fs.readFileSync(J(dir, 'box.pid'), 'utf8')))
  }
  check('I: every one of them came back as "aborted", and some of them had started the program (the moments cover the start)', kinds.every((k) => k === 'not-run:aborted') && pids.length >= 1 && pids.length < offsets.length, `${kinds.join(' ')} | started ${pids.length}`)
  await until(() => noMounts() && runner.live() === 0, 15000)
  await wait(1500)
  const toolsLike = runner.folders.tools.replace(/'/g, "''")
  const strays = () =>
    execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', `Get-CimInstance Win32_Process | Where-Object { $_.ProcessId -ne $PID -and $_.CommandLine -like '*${toolsLike}*' } | ForEach-Object { $_.ProcessId }`], { encoding: 'utf8', windowsHide: true })
      .split(/\r?\n/)
      .map((s) => s.trim())
      .filter(Boolean)
      .map(Number)
  const left = strays()
  for (const pid of left) {
    try {
      process.kill(pid, 'SIGKILL') // only so that a failed check does not leave a program of the box running on the PC
    } catch {
      /* gone */
    }
  }
  check('I: and nothing of the box is left running (no process made from the private node.exe), whenever the Stop came', left.length === 0, left.join(','))
  // (a spec file that an app killed hard left behind in G is not this section's)
  const specsNew = specsIn().filter((f) => !specsBefore.has(f))
  check('I: no drive letter and no spec file of these runs is left either', noMounts() && specsNew.length === 0, `${show(listMounts(runRoot))} ${specsNew}`)
})

// ============================ J. runs at the same moment ===============================
// (13.7, 10 October 2026: three runs started together failed about one time in eight: two launchers took the same drive letter (DefineDosDevice does not fail for a second
// definition, so two runs shared one drive: one wrote into the other's folder) or made the container profile at the same moment and failed. The launcher now takes a named gate
// from the container to the letter. Eight rounds of five runs; the sabotage without the gate fails most rounds.)
await guard('J', async () => {
  const bad = []
  let runs = 0
  for (let round = 1; round <= 8; round++) {
    const ds = [1, 2, 3, 4, 5].map(() => scratch('together'))
    for (const x of ds) put(x, 'p.cjs', "require('fs').writeFileSync('who.txt', process.cwd()); setTimeout(() => process.exit(0), 2000)")
    const outs = await Promise.all(ds.map((x) => R(x, ['p.cjs'])))
    runs += outs.length
    const letters = ds.map((x) => (fs.existsSync(J(x, 'who.txt')) ? fs.readFileSync(J(x, 'who.txt'), 'utf8') : ''))
    const fine = outs.every((o) => o.kind === 'ran' && o.exitCode === 0) && letters.every((l) => /^[D-Z]:\\$/.test(l.trim())) && new Set(letters).size === ds.length
    if (!fine) bad.push(`round ${round}: ${show({ letters, outs: outs.map((o) => (o.kind === 'ran' ? o.exitCode : `${o.why}: ${o.message}`)) })}`)
  }
  check('J: eight rounds of five runs started together: every run finished, each with a drive letter of its own and its file in its own folder', bad.length === 0 && runs === 40, bad.slice(0, 2).join(' || '))
  check('J: and no letter is left', noMounts(), show(listMounts(runRoot)))
})

check('the guard under the real file system refused nothing during the run (the module under test touched nothing outside the folder it was given)', fsGuard.refusals.length === 0, show(fsGuard.refusals.slice(0, 3)))
const ok = check.summary()
process.exit(ok ? 0 : 1)
