// Test harness only (Stage 13.2): a stand-in for the launcher that the runner starts (as `node standin-launcher.cjs <specPath>`) instead of PowerShell, to show what
// the runner does with a launcher that dies, hangs, lies or says the box could not be made. (A compiled stand-in was tried first: this PC's security product removed it
// from the disk between compiling and running.) Behaviour comes from STANDIN_MODE; STANDIN_PIDFILE gets the process id, so that a check can see that it was ended.
'use strict'
const fs = require('fs')

const mode = process.env.STANDIN_MODE || 'exit1'
if (process.env.STANDIN_PIDFILE) fs.writeFileSync(process.env.STANDIN_PIDFILE, String(process.pid))
const specPath = process.argv[2]
let result = null
try {
  result = JSON.parse(fs.readFileSync(specPath, 'utf8')).result
} catch {
  result = null
}
const base = {
  ok: true, exitCode: 0, timedOut: false, parentGone: false, elapsedMs: 12, peakJobMemory: 1048576, activeBeforeKill: 0, activeAfterKill: 0,
  stdout: 'from the stand-in', stderr: '', stdoutBytes: 16, stderrBytes: 0
}
if (process.env.STANDIN_SPECCOPY) fs.copyFileSync(specPath, process.env.STANDIN_SPECCOPY)
const write = (text) => fs.writeFileSync(result, typeof text === 'string' ? text : JSON.stringify(text))

switch (mode) {
  case 'exit1':
    console.error('stand-in: dying at once')
    process.exit(1)
    break
  case 'hang':
    setTimeout(() => {}, 10 * 60 * 1000)
    break
  case 'garbage':
    write('this is not json')
    break
  case 'array':
    write([1, 2, 3])
    break
  case 'badtypes':
    write({ ...base, exitCode: 'zero' })
    break
  case 'nostdout': {
    const { stdout, ...rest } = base
    void stdout
    write(rest)
    break
  }
  case 'container':
    write({ ok: false, stage: 'container', error: 'AppContainer profile: error 5 (Access is denied)\r\nsecond line' })
    break
  case 'checkspec':
    write({ ok: false, stage: 'check-spec', error: 'timeoutMs is out of range' })
    break
  case 'parentgone':
    write({ ...base, exitCode: 1, parentGone: true, stdout: '', stdoutBytes: 0 })
    break
  case 'fine':
    write(base)
    break
  default:
    process.exit(9)
}
