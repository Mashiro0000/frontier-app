// Stage 13 helpers for the probe: run one program through the prototype launcher (probe13-launcher.ps1) and read its result.
import { spawn, spawnSync } from 'node:child_process'
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { TOOLS, OUT } from './paths.mjs'

export const LAUNCHER = join(TOOLS, 'probe13-launcher.ps1')
export const NODE_EXE = 'C:\\Program Files\\nodejs\\node.exe'
export const MINIMAL_ENV = (home) => ({
  SystemRoot: 'C:\\Windows',
  PATH: 'C:\\Windows\\System32;C:\\Windows',
  TEMP: home,
  TMP: home,
  USERPROFILE: home,
  HOME: home
})

let counter = 0
function prepare(spec) {
  const dir = join(OUT, 'probe13-specs')
  mkdirSync(dir, { recursive: true })
  const id = `${process.pid}-${++counter}`
  const specPath = join(dir, `spec-${id}.json`)
  const resultPath = join(dir, `result-${id}.json`)
  const full = {
    mode: 'container',
    container: 'FrontierRun.Probe13',
    grantDirs: [],
    readDirs: [],
    env: {},
    timeoutMs: 20000,
    memoryBytes: 1024 * 1024 * 1024,
    maxProcesses: 64,
    capBytes: 65536,
    ...spec,
    result: resultPath
  }
  writeFileSync(specPath, JSON.stringify(full))
  return { specPath, resultPath }
}

function collect(specPath, resultPath, stderr, stdout, wall) {
  let result = null
  try {
    let text = readFileSync(resultPath, 'utf8')
    if (text.charCodeAt(0) === 0xfeff) text = text.slice(1)
    result = JSON.parse(text)
  } catch {
    result = { started: false, error: 'no result file: ' + (stderr || stdout || '').slice(0, 600) }
  }
  try {
    rmSync(specPath)
    rmSync(resultPath)
  } catch {
    /* kept for reading */
  }
  return { ...result, wallMs: wall }
}

const PS_ARGS = (specPath) => ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', LAUNCHER, '-SpecPath', specPath]

// spec: { mode, container, program, args, cwd, env, grantDirs, readDirs, timeoutMs, memoryBytes, maxProcesses, capBytes }
export function runBox(spec) {
  const { specPath, resultPath } = prepare(spec)
  const t0 = Date.now()
  const p = spawnSync('powershell.exe', PS_ARGS(specPath), { encoding: 'utf8', timeout: 180000, windowsHide: true })
  return collect(specPath, resultPath, p.stderr, p.stdout, Date.now() - t0)
}

// the same, without blocking this process (so a server in this process can answer while the box runs)
export function runBoxAsync(spec) {
  const { specPath, resultPath } = prepare(spec)
  const t0 = Date.now()
  return new Promise((resolve) => {
    const p = spawn('powershell.exe', PS_ARGS(specPath), { windowsHide: true })
    let out = ''
    let err = ''
    p.stdout.on('data', (d) => (out += d))
    p.stderr.on('data', (d) => (err += d))
    p.on('close', () => resolve(collect(specPath, resultPath, err, out, Date.now() - t0)))
  })
}
