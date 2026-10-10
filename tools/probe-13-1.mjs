// Stage 13.1: THE PROBE (the gate of Stage 13). Does an AppContainer + job object really box a program on this PC?
//   node tools/probe-13-1.mjs [runs=1]
// It makes canaries in the places the box must not reach (user folder, the encrypted Roaming folder, Local, another drive,
// the repo, a sibling folder), a scratch folder that the box may use, and local servers (TCP and UDP) that see every
// connection attempt. Then it runs a battery of programs INSIDE the box (probe13-launcher.ps1: AppContainer + job object)
// and the same battery as a plain child process (the negative control: every door must be open there, or the check could
// not have failed). What matters is read from the disk and the servers, not from what the box says about itself.
// Everything it makes is removed at the end. Result: tools/.out/probe13-<n>.json and a verdict (exit code 0 = the gate holds).
import { createHash, randomBytes } from 'node:crypto'
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { connect as netConnect, createServer } from 'node:net'
import { createSocket } from 'node:dgram'
import { networkInterfaces, tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { TOOLS, OUT, REPO_URL } from './paths.mjs'
import { runBox, runBoxAsync, MINIMAL_ENV, NODE_EXE } from './lib13.mjs'

const RUNS = Number(process.argv[2] || 1)
const LOCAL = process.env.LOCALAPPDATA
const ROAMING = process.env.APPDATA
const PROFILE = process.env.USERPROFILE
const sha = (f) => createHash('sha256').update(readFileSync(f)).digest('hex')
const alive = (pid) => {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// The box sees its scratch folder as the ROOT of a drive letter (subst): Node's real-path code asks for C:\ itself, which a
// container may not touch (found by this probe: "EPERM lstat C:\"), and a drive whose root is the folder has no ancestors.
const usedLetters = new Set()
function freeLetter() {
  for (const l of 'ZYXWVUTSRQPONMLK') {
    if (!usedLetters.has(l) && !existsSync(l + ':\\')) return l
  }
  throw new Error('no free drive letter')
}
function mount(dir) {
  const l = freeLetter()
  const r = spawnSync('subst.exe', [l + ':', dir], { encoding: 'utf8' })
  if (r.status !== 0) throw new Error('subst failed: ' + r.stdout + r.stderr)
  usedLetters.add(l)
  return {
    letter: l,
    root: l + ':\\',
    unmount: () => {
      spawnSync('subst.exe', [l + ':', '/d'])
      usedLetters.delete(l)
    }
  }
}

function tryConnect(host, port) {
  return new Promise((resolve) => {
    const s = netConnect({ host, port })
    const t = setTimeout(() => {
      s.destroy()
      resolve('timeout')
    }, 3000)
    s.on('connect', () => {
      clearTimeout(t)
      s.destroy()
      resolve('connected')
    })
    s.on('error', (e) => {
      clearTimeout(t)
      resolve(e.code || 'error')
    })
  })
}

function parseResult(stdout) {
  const line = (stdout || '').split('\n').reverse().find((l) => l.startsWith('RESULT '))
  if (!line) return null
  try {
    return JSON.parse(line.slice(7))
  } catch {
    return null
  }
}

async function oneRun(runNo) {
  const id = randomBytes(4).toString('hex')
  const tag = `frontier-probe13-${id}`
  const secret = `SECRET-${randomBytes(8).toString('hex')}`
  const marker = `WROTE-${randomBytes(6).toString('hex')}`
  const P = {
    base: join(tmpdir(), tag), // drive A: (tools/temp-on-a.mjs); FRONTIER_KEEP_TEMP=1 puts it on C: for a comparison run
    userFile: join(PROFILE, `${tag}-canary.txt`),
    roamDir: join(ROAMING, tag),
    localDir: join(LOCAL, tag),
    otherDir: `A:\\${tag}`,
    winTemp: `C:\\Windows\\Temp\\${tag}-w.txt`
  }
  P.scratch = join(P.base, 'scratch')
  P.outside = join(P.base, 'outside')
  const cleanupList = [P.base, P.userFile, join(PROFILE, `${tag}-w.txt`), join(PROFILE, `${tag}-dir`), P.roamDir, P.localDir, P.otherDir, P.winTemp]
  const cleanup = () => {
    for (const f of cleanupList) {
      try {
        rmSync(f, { recursive: true, force: true })
      } catch {
        /* reported at the end */
      }
    }
  }
  const observed = { container: {}, plain: {} }
  const unmounts = []
  // PROBE_SABOTAGE makes the "container" side weaker on purpose, to show that the checks CAN fail:
  //   plain    = no container at all   nolimits = no memory / process / time / output limits   nokill = the job does not kill what is left
  const SAB = process.env.PROBE_SABOTAGE || ''
  const boxMode = (mode) => (mode === 'container' && SAB === 'plain' ? 'plain' : mode)
  // PROBE_LAUNCHER=product runs the CONTAINER side through the app's own runner (src/main/commandRunner.ts and its launcher) instead of the
  // prototype; the plain-process control stays on the prototype. The same 50 checks then judge the launcher that ships (13.2).
  const PRODUCT = process.env.PROBE_LAUNCHER === 'product'
  const checks = []
  const add = (name, pass, detail, control) => checks.push({ name, pass: !!pass, detail: detail ?? '', control: control ?? null })
  const info = (name, detail) => checks.push({ name, pass: true, info: true, detail: detail ?? '', control: null })

  // ---------- servers that see every connection attempt ----------
  const tcpSeen = new Set()
  const udpSeen = new Set()
  const tcp = createServer((s) => {
    s.on('data', (d) => d.toString().split('\n').filter(Boolean).forEach((t) => tcpSeen.add(t)))
    s.on('error', () => {})
  })
  await new Promise((r) => tcp.listen(0, '0.0.0.0', r))
  const udp = createSocket('udp4')
  udp.on('message', (m) => udpSeen.add(m.toString()))
  await new Promise((r) => udp.bind(0, '0.0.0.0', r))
  const tcpPort = tcp.address().port
  const udpPort = udp.address().port
  const lanIp = Object.values(networkInterfaces())
    .flat()
    .find((i) => i && i.family === 'IPv4' && !i.internal)?.address

  try {
    // ---------- the places ----------
    mkdirSync(P.scratch, { recursive: true })
    mkdirSync(P.outside, { recursive: true })
    mkdirSync(P.roamDir, { recursive: true })
    mkdirSync(P.localDir, { recursive: true })
    try {
      mkdirSync(P.otherDir, { recursive: true })
    } catch {
      /* no A: on this PC */
    }
    writeFileSync(P.userFile, secret + ' user\n')
    writeFileSync(join(P.roamDir, 'canary.txt'), secret + ' roaming\n')
    writeFileSync(join(P.localDir, 'canary.txt'), secret + ' local\n')
    writeFileSync(join(P.outside, 'canary.txt'), secret + ' outside\n')
    writeFileSync(join(P.outside, 'victim.txt'), 'victim\n')
    if (existsSync(P.otherDir)) writeFileSync(join(P.otherDir, 'canary.txt'), secret + ' other drive\n')
    const localEncrypted = spawnSync('powershell.exe', ['-NoProfile', '-Command', `((Get-Item -LiteralPath '${LOCAL}').Attributes -band [IO.FileAttributes]::Encrypted) -ne 0`], { encoding: 'utf8' }).stdout.trim()
    const roamEncrypted = spawnSync('powershell.exe', ['-NoProfile', '-Command', `((Get-Item -LiteralPath '${P.roamDir}').Attributes -band [IO.FileAttributes]::Encrypted) -ne 0`], { encoding: 'utf8' }).stdout.trim()
    const victimSha = sha(join(P.outside, 'victim.txt'))
    const canarySha = sha(join(P.outside, 'canary.txt'))
    const realAppData = join(ROAMING, 'frontier-app')

    cpSync(join(TOOLS, 'probe13-inner.cjs'), join(P.scratch, 'inner.cjs'))
    // a private copy of node.exe: the box cannot read the one in Program Files (that folder has no "all application packages" entry
    // on this PC), so it could not start node itself, and no copy of it may be written by the box (read-only grant)
    P.tools = join(P.base, 'ptools')
    mkdirSync(P.tools, { recursive: true })
    const NODE_COPY = join(P.tools, 'node.exe')
    cpSync(NODE_EXE, NODE_COPY)

    const baseParams = {
      marker,
      netTimeoutMs: 5000,
      tcpPort,
      udpPort,
      lanIp: lanIp ?? null,
      scratchDir: P.scratch,
      sibling: join(P.outside, 'canary.txt'),
      readFiles: {
        user: P.userFile,
        roaming: join(P.roamDir, 'canary.txt'),
        local: join(P.localDir, 'canary.txt'),
        otherDrive: join(P.otherDir, 'canary.txt'),
        repo: 'A:\\frontier-app\\package.json',
        outside: join(P.outside, 'canary.txt')
      },
      listDirs: { userFolder: PROFILE, realAppData, repoFolder: 'A:\\frontier-app', roamingFolder: ROAMING },
      writeFiles: {
        user: join(PROFILE, `${tag}-w.txt`),
        roaming: join(P.roamDir, 'w.txt'),
        local: join(P.localDir, 'w.txt'),
        otherDrive: join(P.otherDir, 'w.txt'),
        outsideSibling: join(P.outside, 'w.txt'),
        winTemp: P.winTemp
      },
      mkdirs: { userFolder: join(PROFILE, `${tag}-dir`), outside: join(P.outside, 'newdir') },
      victim: join(P.outside, 'victim.txt'),
      programs: {
        node: { program: process.env.PROBE_LAUNCHER === 'product' ? join(P.base, 'tools', 'node.exe') : NODE_COPY, args: ['-v'] },
        nodeInstalled: { program: NODE_EXE, args: ['-v'] },
        cmd: { program: 'C:\\Windows\\System32\\cmd.exe', args: ['/c', 'ver'] },
        powershell: { program: 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe', args: ['-NoProfile', '-Command', '1+1'] },
        git: { program: join(LOCAL, 'Programs', 'PortableGit', 'mingw64', 'bin', 'git.exe'), args: ['--version'] },
        python: { program: join(LOCAL, 'Microsoft', 'WindowsApps', 'python.exe'), args: ['--version'] },
        whoami: { program: 'C:\\Windows\\System32\\whoami.exe', args: [] }
      },
      scanRoots: {
        'C:\\': 'C:\\',
        'C:\\Users': 'C:\\Users',
        'C:\\Users\\Public': 'C:\\Users\\Public',
        'C:\\ProgramData': 'C:\\ProgramData',
        'C:\\Windows': 'C:\\Windows',
        'C:\\Windows\\Temp': 'C:\\Windows\\Temp',
        'C:\\Program Files': 'C:\\Program Files',
        'C:\\Program Files (x86)': 'C:\\Program Files (x86)',
        'A:\\': 'A:\\',
        'E:\\': 'E:\\',
        'the user folder': PROFILE,
        'user Local': LOCAL,
        'user Temp': join(LOCAL, 'Temp')
      },
      scanShared: { 'C:\\ProgramData': 'C:\\ProgramData', 'C:\\Users\\Public': 'C:\\Users\\Public', 'C:\\Program Files': 'C:\\Program Files', 'C:\\Program Files (x86)': 'C:\\Program Files (x86)', 'C:\\Windows\\Temp': 'C:\\Windows\\Temp' },
      otherPid: process.pid
    }
    // the box's scratch folder is the root of a drive letter (see mount)
    const M = mount(P.scratch)
    unmounts.push(M.unmount)
    baseParams.scratchDir = '.' // relative: the product launcher mounts its own letter, the prototype's cwd is the probe's
    const env = (home) => ({ ...MINIMAL_ENV(home), LOCALAPPDATA: home })

    // a light program that stays alive for a few seconds in the box (waitfor, ping, choice, timeout and find all end at once there):
    // a counting loop of cmd.exe, for the process-count test; the run kills what is left
    const sleeper = { program: 'C:\\Windows\\System32\\cmd.exe', args: ['/c', 'for /l %i in (1,1,30000000) do @rem'] }
    const forkLimit = 64
    const forkN = 100
    observed.sleeper = 'cmd.exe counting loop'

    const sabotage = (mode, which, extra) => {
      if (mode !== 'container') return extra
      if (SAB === 'nolimits') {
        const o = { ...extra, memoryBytes: 8 * 1024 ** 3, maxProcesses: 1000 }
        if (which === 'time') o.timeoutMs = 12000
        if (which === 'output') o.capBytes = 64 * 1024 * 1024
        return o
      }
      // only the one case that cannot run away: a sleeping child (the endless loop would never stop)
      if (SAB === 'nokill' && which === 'children') return { ...extra, env: { ...env(M.root), __nokill__: '1' } }
      return extra
    }
    // the app's own runner, with its run root = this world's base folder (scratch/ is inside it; so is "outside/", which is NOT granted)
    let productRunner = null
    if (PRODUCT) {
      await import('./ts-resolve.mjs')
      const { createCommandRunner } = await import(`${REPO_URL}/src/main/commandRunner.ts`)
      productRunner = createCommandRunner({ runRoot: P.base })
    }
    const toBox = (o) =>
      o.kind === 'ran'
        ? { started: true, error: null, exitCode: o.exitCode, timedOut: o.timedOut, elapsedMs: o.elapsedMs, peakJobMemory: o.peakMemoryBytes, activeBeforeKill: o.leftoverKilled, activeAfterKill: o.leftoverAfter, stdout: o.stdout, stderr: o.stderr, stdoutTotal: o.stdoutBytes, stderrTotal: o.stderrBytes }
        : { started: false, error: `${o.why}: ${o.message}`, exitCode: 0, timedOut: false, elapsedMs: 0, peakJobMemory: 0, activeBeforeKill: 0, activeAfterKill: 0, stdout: '', stderr: '', stdoutTotal: 0, stderrTotal: 0 }
    const productRequest = (which, extra, args) => ({
      program: NODE_EXE,
      args,
      scratchDir: P.scratch,
      timeoutMs: extra.timeoutMs ?? 20000,
      memoryBytes: Math.min(extra.memoryBytes ?? 1024 ** 3, 1024 ** 3),
      maxProcesses: extra.maxProcesses ?? 64,
      outputBytes: extra.capBytes ?? 65536
    })
    const run = async (mode, which, extra = {}, params = {}) => {
      writeFileSync(join(P.scratch, `params-${which}.json`), JSON.stringify({ ...baseParams, ...params }))
      let box
      if (PRODUCT && mode === 'container') {
        box = toBox(await productRunner.run(productRequest(which, extra, ['inner.cjs', which, `params-${which}.json`])))
      } else {
        box = runBox({
          mode: boxMode(mode),
          program: NODE_COPY,
          readDirs: [P.tools],
          args: [M.root + 'inner.cjs', which, M.root + `params-${which}.json`],
          cwd: M.root,
          env: env(M.root),
          grantDirs: [P.scratch],
          timeoutMs: 20000,
          ...sabotage(mode, which, extra)
        })
      }
      return { box, res: parseResult(box.stdout) }
    }

    for (const mode of ['container', 'plain']) {
      const O = observed[mode]
      // ---- reads
      O.read = await run(mode, 'read')
      // ---- writes
      for (const f of Object.values(baseParams.writeFiles)) {
        try {
          rmSync(f, { force: true })
        } catch {
          /* ok */
        }
      }
      writeFileSync(join(P.outside, 'victim.txt'), 'victim\n')
      O.write = await run(mode, 'write')
      O.writeAfter = {
        files: Object.fromEntries(Object.entries(baseParams.writeFiles).map(([k, f]) => [k, existsSync(f) ? readFileSync(f, 'utf8') === marker : false])),
        victimIntact: existsSync(join(P.outside, 'victim.txt')) && sha(join(P.outside, 'victim.txt')) === victimSha,
        victimRenamedExists: existsSync(join(P.outside, 'victim.txt.renamed')),
        dirs: [existsSync(baseParams.mkdirs.userFolder), existsSync(baseParams.mkdirs.outside)]
      }
      O.canaryIntact = sha(join(P.outside, 'canary.txt')) === canarySha
      // ---- in its own folder
      O.scratch = await run(mode, 'scratch')
      // ---- network
      tcpSeen.clear()
      udpSeen.clear()
      O.net = await run(mode, 'net', { timeoutMs: 40000 })
      await sleep(300)
      O.netSeenTcp = [...tcpSeen]
      O.netSeenUdp = [...udpSeen]
      // ---- children that outlive their parent
      O.children = await run(mode, 'children')
      await sleep(800)
      O.childAliveAfter = O.children.res?.pid ? alive(O.children.res.pid) : null
      if (O.childAliveAfter) {
        // only a sabotaged run can leave it: do not leave it running
        spawnSync('taskkill.exe', ['/PID', String(O.children.res.pid), '/T', '/F'])
      }
      // ---- how many processes
      O.fork = await run(mode, 'fork', { maxProcesses: mode === 'container' ? forkLimit : 1000, memoryBytes: 4 * 1024 ** 3, timeoutMs: 40000 }, { forkN: mode === 'container' ? forkN : 70, sleeper })
      // ---- time
      O.time = await run(mode, 'time', { timeoutMs: 4000 })
      // ---- memory (256 MB in the box; the control has 8 GB and goes to 512 MB)
      O.memory = await run(mode, 'memory', { memoryBytes: (mode === 'container' ? 256 : 8192) * 1024 * 1024, timeoutMs: 30000 }, { memoryTryMb: 512 })
      // ---- endless output
      O.output = await run(mode, 'output', { timeoutMs: 3000, capBytes: 65536 })
      // ---- which programs the box can start
      O.programs = await run(mode, 'programs', { timeoutMs: 60000 })
      // ---- what it sees
      O.env = await run(mode, 'env')
      O.misc = await run(mode, 'misc')
      if (mode === 'container') O.scan = await run(mode, 'scan')
      // ---- can anything outside connect INTO a port the box opened?
      {
        const portFile = join(P.scratch, 'listen.port')
        const seenFile = join(P.scratch, 'listen.seen')
        for (const f of [portFile, seenFile]) rmSync(f, { force: true })
        writeFileSync(join(P.scratch, 'params-listen.json'), JSON.stringify({ ...baseParams, listenPortFile: 'listen.port', listenSeenFile: 'listen.seen', listenWaitMs: 7000 }))
        const pending =
          PRODUCT && mode === 'container'
            ? productRunner.run(productRequest('listen', { timeoutMs: 20000 }, ['inner.cjs', 'listen', 'params-listen.json'])).then(toBox)
            : runBoxAsync({ mode: boxMode(mode), program: NODE_COPY, readDirs: [P.tools], args: [M.root + 'inner.cjs', 'listen', M.root + 'params-listen.json'], cwd: M.root, env: env(M.root), grantDirs: [P.scratch], timeoutMs: 20000 })
        let portText = null
        for (let i = 0; i < 100 && !portText; i++) {
          await sleep(150)
          if (existsSync(portFile)) portText = readFileSync(portFile, 'utf8')
        }
        const outside = {}
        if (Number(portText)) {
          outside.loopback = await tryConnect('127.0.0.1', Number(portText))
          await sleep(300)
        }
        await pending
        O.listen = { portText, outside, seen: existsSync(seenFile) }
      }
    }

    // ---- where may the scratch folder live? (container only)
    observed.scratchPlaces = {}
    const places = { LocalTemp: join(LOCAL, 'Temp', `${tag}-s1`), LocalAppData: join(P.localDir, 'scratch2'), Roaming: join(P.roamDir, 'scratch3'), OtherDrive: join(P.otherDir, 'scratch4') }
    for (const [name, dir] of Object.entries(places)) {
      cleanupList.push(dir)
      let drive = null
      try {
        mkdirSync(dir, { recursive: true })
        cpSync(join(TOOLS, 'probe13-inner.cjs'), join(dir, 'inner.cjs'))
        writeFileSync(join(dir, 'p.json'), JSON.stringify({ ...baseParams, scratchDir: 'X:' }))
        drive = mount(dir)
        writeFileSync(join(dir, 'p.json'), JSON.stringify({ ...baseParams, scratchDir: drive.root.slice(0, 2) }))
        const box = runBox({ mode: 'container', program: NODE_COPY, readDirs: [P.tools], args: [drive.root + 'inner.cjs', 'scratch', drive.root + 'p.json'], cwd: drive.root, env: env(drive.root), grantDirs: [dir], timeoutMs: 20000 })
        observed.scratchPlaces[name] = { started: box.started, error: box.error, res: parseResult(box.stdout), stderr: (box.stderr || '').slice(0, 200) }
      } catch (e) {
        observed.scratchPlaces[name] = { error: String(e.message || e) }
      } finally {
        if (drive) drive.unmount()
      }
    }

    // =========================== judge ===========================
    const C = observed.container
    const L = observed.plain
    const rd = (o) => o.read.res
    const wr = (o) => o.write.res
    const reads = ['user', 'roaming', 'local', 'otherDrive', 'repo', 'outside']
    for (const k of reads) {
      const inBox = rd(C)?.files?.[k]
      const inPlain = rd(L)?.files?.[k]
      const leaked = (C.read.box.stdout + C.read.box.stderr).includes(secret)
      add(`read ${k}`, inBox && inBox.ok === false && !leaked, inBox ? (inBox.ok ? 'READ IT' : inBox.code) : 'no answer', inPlain ? (inPlain.ok ? 'plain reads it' : 'plain could not: ' + inPlain.code) : 'no answer')
    }
    for (const k of ['userFolder', 'realAppData', 'repoFolder', 'roamingFolder']) {
      const inBox = rd(C)?.dirs?.[k]
      const inPlain = rd(L)?.dirs?.[k]
      if (inPlain && !inPlain.ok && inPlain.code === 'ENOENT') continue
      add(`list ${k}`, inBox && inBox.ok === false, inBox ? (inBox.ok ? 'LISTED IT' : inBox.code) : 'no answer', inPlain ? (inPlain.ok ? 'plain lists it' : 'plain could not: ' + inPlain.code) : 'no answer')
    }
    for (const k of Object.keys(baseParams.writeFiles)) {
      if (k === 'otherDrive' && !existsSync(P.otherDir)) continue
      add(`write ${k}`, C.writeAfter.files[k] === false && wr(C)?.writes?.[k]?.ok === false, wr(C)?.writes?.[k]?.ok ? 'WROTE IT' : wr(C)?.writes?.[k]?.code, L.writeAfter.files[k] ? 'plain writes it' : 'plain could not: ' + wr(L)?.writes?.[k]?.code)
    }
    add('write: nothing was made or changed beside the scratch folder', C.writeAfter.victimIntact && !C.writeAfter.victimRenamedExists && C.canaryIntact && !C.writeAfter.dirs[0] && !C.writeAfter.dirs[1], `victim intact ${C.writeAfter.victimIntact}, renamed ${C.writeAfter.victimRenamedExists}, canary intact ${C.canaryIntact}, dirs ${C.writeAfter.dirs}`, !L.writeAfter.victimIntact ? 'plain changed it' : 'plain left it (control blind)')
    const sc = C.scratch.res
    const scOk = sc && ['write', 'read', 'mkdir', 'write-nested', 'list', 'rename', 'delete', 'big-write', 'own-script'].every((k) => sc[k]?.ok)
    add('inside its scratch folder it can read, write, list, nest, rename, delete, write 5 MB', !!scOk, scOk ? '' : JSON.stringify(sc))
    add('...and it cannot read a sibling folder of the scratch folder', sc?.['read-sibling']?.ok === false, sc?.['read-sibling']?.ok ? 'READ IT' : sc?.['read-sibling']?.code)

    const n = C.net.res
    const nl = L.net.res
    add('net: no TCP connection reached the loopback server', !C.netSeenTcp.includes('lo') && n?.loopback !== 'connected', `box says ${n?.loopback}`, L.netSeenTcp.includes('lo') ? 'plain reaches it' : 'plain did NOT reach it')
    if (lanIp) add('net: no TCP connection reached this PC on its LAN address', !C.netSeenTcp.includes('lan') && n?.lan !== 'connected', `box says ${n?.lan}`, L.netSeenTcp.includes('lan') ? 'plain reaches it' : 'plain did NOT reach it')
    const internetPlain = nl?.internetIp === 'connected' || nl?.internetIp2 === 'connected'
    add('net: no connection to a public address (1.1.1.1:443, 8.8.8.8:53)', n?.internetIp !== 'connected' && n?.internetIp2 !== 'connected', `box says ${n?.internetIp} / ${n?.internetIp2}`, internetPlain ? 'plain reaches the internet' : 'UNPROVEN: plain cannot reach the internet either (' + nl?.internetIp + ')')
    add('net: no name lookup', !String(n?.dns).startsWith('resolved'), String(n?.dns), String(nl?.dns).startsWith('resolved') ? 'plain resolves' : 'UNPROVEN: plain cannot resolve (' + nl?.dns + ')')
    add('net: nothing outside can connect to a port the box opened', !Number(C.listen.portText) || (!C.listen.seen && C.listen.outside.loopback !== 'connected'), Number(C.listen.portText) ? `box listens on ${C.listen.portText}; from outside: ${C.listen.outside.loopback}` : `the box could not listen: ${C.listen.portText}`, L.listen.seen ? 'plain: the connection arrived' : 'plain: nothing arrived (control blind)')
    add('net: no UDP datagram reached the server', !C.netSeenUdp.includes('udp'), `box says ${n?.udp}`, L.netSeenUdp.includes('udp') ? 'plain reaches it' : 'plain did NOT reach it')

    add('children: a child left running is dead when the run is over (killed by the job)', C.children.res?.aliveAtExit === true && C.childAliveAfter === false, `alive at exit ${C.children.res?.aliveAtExit}, alive after ${C.childAliveAfter}`)
    const f = C.fork.res
    add(`processes: asked for ${forkN}, the limit of ${forkLimit} stopped some`, !!f && f.started < f.asked && f.failed > 0 && C.fork.box.activeBeforeKill <= forkLimit, `started ${f?.started}, failed ${f?.failed} ${JSON.stringify(f?.failCodes)}, active at the end ${C.fork.box.activeBeforeKill}`, L.fork.res && L.fork.res.started === L.fork.res.asked ? `plain started all ${L.fork.res.started}` : 'plain did not start them all: ' + JSON.stringify(L.fork.res))
    add('processes: none left after the run', C.fork.box.activeAfterKill === 0 && C.children.box.activeAfterKill === 0, `${C.fork.box.activeAfterKill} / ${C.children.box.activeAfterKill}`)
    const t = C.time.box
    add('time: an endless loop was stopped at the limit (4 s) and nothing is left', t.timedOut === true && t.elapsedMs >= 3800 && t.elapsedMs < 9000 && t.activeAfterKill === 0, `timedOut ${t.timedOut}, ${t.elapsedMs} ms, left ${t.activeAfterKill}`)
    const m = C.memory
    const reachedBox = m.res?.reachedMb
    const peakMbBox = Math.round(m.box.peakJobMemory / 1048576)
    add('memory: 256 MB limit: the program could not get to 512 MB', reachedBox === undefined && peakMbBox <= 300, `exit ${m.box.exitCode}, peak ${peakMbBox} MB, last "MB" line ${(m.box.stdout.match(/MB (\d+)/g) || []).pop()}`, L.memory.res?.reachedMb >= 512 ? 'with 8 GB it reached 512 MB' : 'control did NOT reach 512 MB: ' + JSON.stringify(L.memory.res))
    const o = C.output.box
    add('output: an endless stream is cut at the cap (64 KB) and the run still ends', o.stdout.length <= 65536 && o.stdoutTotal > 65536 && o.activeAfterKill === 0, `kept ${o.stdout.length} of ${o.stdoutTotal} bytes, timedOut ${o.timedOut}`)
    const pr = C.programs.res || {}
    const pl = L.programs.res || {}
    add('programs: node runs in the box', pr.node?.ran && pr.node.status === 0, JSON.stringify(pr.node))
    add('programs: cmd.exe runs in the box', pr.cmd?.ran && pr.cmd.status === 0, JSON.stringify(pr.cmd))
    add('programs: git (in the user folder) does not run in the box', pr.git && (!pr.git.ran || pr.git.status !== 0), JSON.stringify(pr.git), pl.git?.ran && pl.git.status === 0 ? 'plain runs it' : 'plain could not either: ' + JSON.stringify(pl.git))
    add('programs: the Store python alias does not run in the box', pr.python && (!pr.python.ran || pr.python.status !== 0), JSON.stringify(pr.python), pl.python?.ran && pl.python.status === 0 ? 'plain runs it' : 'plain: ' + JSON.stringify(pl.python))
    info('programs: powershell.exe started by the box', JSON.stringify(pr.powershell))
    info('programs: node.exe of Program Files started by the box (its folder has no "all application packages" entry)', JSON.stringify(pr.nodeInstalled))
    const ce = C.env.res
    const envKeys = Object.keys(ce?.env ?? {})
    add('env: nothing of the app reaches it (no APPDATA, no variable of this process with its value)', !!ce && !('APPDATA' in ce.env) && !Object.entries(process.env).some(([k, v]) => v.length > 12 && !['PATH', 'Path'].includes(k) && Object.entries(ce.env).some(([k2, v2]) => k2.toLowerCase() === k.toLowerCase() && v2 === v && !['SystemRoot', 'LOCALAPPDATA'].includes(k2) && v2 !== P.scratch)), `keys: ${envKeys.join(',')}`)
    add('misc: cannot reach another process of the user', C.misc.res?.seeOtherProcess !== true, `answer ${C.misc.res?.seeOtherProcess}`, L.misc.res?.seeOtherProcess === true ? 'plain sees it' : 'plain did not either')

    const sp = observed.scratchPlaces
    const spOk = (x) => x?.res && ['write', 'read', 'mkdir', 'write-nested', 'delete', 'big-write'].every((k) => x.res[k]?.ok)
    const placeText = Object.fromEntries(Object.entries(sp).map(([k, v]) => [k, spOk(v) ? 'works' : v.error ? 'start failed: ' + v.error : v.res ? 'fails: ' + Object.entries(v.res).filter(([, r]) => !r.ok).map(([a, r]) => a + ' ' + r.code).join(', ') : 'no answer']))
    add('scratch folder: works under the local temp folder', spOk(sp.LocalTemp), placeText.LocalTemp)
    info(`scratch folder under the local app data folder (encrypted: ${localEncrypted})`, placeText.LocalAppData)
    add('scratch folder: does NOT work in the encrypted Roaming folder (so it must not live there)', roamEncrypted === 'True' && !spOk(sp.Roaming), `Roaming probe folder encrypted: ${roamEncrypted}; ${placeText.Roaming}`)
    info('scratch folder on the other drive', placeText.OtherDrive)
    const sc2 = C.scan?.res
    if (sc2) {
      info('exposure: places the box can list', Object.entries(sc2.roots).filter(([, v]) => v.ok).map(([k, v]) => `${k} (${v.n})`).join(', ') || 'none')
      info('exposure: places it cannot list', Object.entries(sc2.roots).filter(([, v]) => !v.ok).map(([k, v]) => `${k} ${v.code}`).join(', ') || 'none')
      for (const [k, v] of Object.entries(sc2.readable)) info(`exposure: folders of ${k} it can list`, `${v.listable.length} of ${v.folders}: ${v.listable.slice(0, 60).join(', ')}`)
    }
    observed.placeText = placeText

    return { id, runNo, roamEncrypted, lanIp: lanIp ?? null, sleeper: observed.sleeper, forkLimit, forkN, checks, observed }
  } finally {
    tcp.close()
    udp.close()
    for (const u of unmounts) u()
    cleanup()
    const left = cleanupList.filter((f) => existsSync(f))
    if (left.length) console.log('!! could not remove:', left.join(', '))
  }
}

mkdirSync(OUT, { recursive: true })
let bad = 0
const summaries = []
const allFailed = []
for (let i = 1; i <= RUNS; i++) {
  const r = await oneRun(i)
  writeFileSync(join(OUT, `probe13-${i}.json`), JSON.stringify(r, null, 2))
  console.log(`\n=== run ${i} (id ${r.id}; Roaming probe folder encrypted: ${r.roamEncrypted}; LAN ${r.lanIp}; sleeper ${r.sleeper}; process limit ${r.forkLimit}) ===`)
  for (const c of r.checks) {
    const mark = c.info ? 'info' : c.pass ? 'ok  ' : 'FAIL'
    if (!c.pass) {
      bad++
      allFailed.push(c.name)
    }
    console.log(`${mark} ${c.name}${c.detail ? '  [' + c.detail + ']' : ''}${c.control ? '  {control: ' + c.control + '}' : ''}`)
  }
  summaries.push(r.checks.map((c) => c.pass))
}
// delete the container profile the probe made
const del = runBox({ mode: 'delete-profile', container: 'FrontierRun.Probe13' })
console.log(`
profile removed: ${JSON.stringify(del.deleteProfileHresult ?? del.error)}`)
const same = summaries.every((s) => JSON.stringify(s) === JSON.stringify(summaries[0]))
const SABOTAGE = process.env.PROBE_SABOTAGE || ''
if (SABOTAGE) {
  // the sabotaged box must be CAUGHT: each of these checks must have failed (a check that cannot fail proves nothing)
  const EXPECT = {
    plain: [/^read /, /^list /, /^write /, /^write: nothing/, /sibling folder/, /loopback server/, /LAN address/, /^net: nothing outside/, /UDP/, /^programs: git/, /^misc:/],
    nolimits: [/^processes: asked/, /^time:/, /^memory:/, /^output:/],
    nokill: [/^children:/]
  }[SABOTAGE]
  const failed = allFailed
  const missed = EXPECT.filter((re) => !failed.some((n) => re.test(n)))
  console.log(`
SABOTAGE ${SABOTAGE}: ${failed.length} checks failed; ${missed.length ? 'NOT CAUGHT: ' + missed.join(' ') : 'every expected check noticed it'}`)
  process.exit(missed.length === 0 ? 0 : 1)
}
console.log(`
${bad === 0 ? 'THE GATE HOLDS' : 'THE GATE DOES NOT HOLD'}: ${summaries.flat().length - bad} of ${summaries.flat().length} checks ok in ${RUNS} run(s)${RUNS > 1 ? '; the runs agree: ' + same : ''}`)
process.exit(bad === 0 ? 0 : 1)
