'use strict'
// Stage 13.1 probe: the program that runs INSIDE the box (or, for the negative control, as a plain child process).
// Usage: node probe13-inner.cjs <case> <params.json>. Prints one line "RESULT {json}" when it has something to say.
const fs = require('fs')
const net = require('net')
const dgram = require('dgram')
const dns = require('dns')
const cp = require('child_process')
const os = require('os')

const which = process.argv[2]
const P = JSON.parse(fs.readFileSync(process.argv[3], 'utf8'))
const out = (o) => fs.writeSync(1, 'RESULT ' + JSON.stringify(o) + '\n')
const code = (e) => (e && (e.code || e.message)) || 'unknown'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const alive = (pid) => {
  try {
    process.kill(pid, 0)
    return true
  } catch (e) {
    return e.code === 'EPERM' ? 'EPERM' : false
  }
}

function connect(host, port, token) {
  return new Promise((resolve) => {
    const s = net.connect({ host, port })
    const t = setTimeout(() => {
      s.destroy()
      resolve('timeout')
    }, P.netTimeoutMs)
    s.on('connect', () => {
      clearTimeout(t)
      s.write(token + '\n', () => {
        s.destroy()
        resolve('connected')
      })
    })
    s.on('error', (e) => {
      clearTimeout(t)
      resolve(code(e))
    })
  })
}

async function main() {
  if (which === 'read') {
    const files = {}
    for (const [name, f] of Object.entries(P.readFiles)) {
      try {
        files[name] = { ok: true, text: fs.readFileSync(f, 'utf8').slice(0, 80) }
      } catch (e) {
        files[name] = { ok: false, code: code(e) }
      }
    }
    const dirs = {}
    for (const [name, d] of Object.entries(P.listDirs)) {
      try {
        dirs[name] = { ok: true, n: fs.readdirSync(d).length }
      } catch (e) {
        dirs[name] = { ok: false, code: code(e) }
      }
    }
    out({ files, dirs })
  } else if (which === 'write') {
    const writes = {}
    for (const [name, f] of Object.entries(P.writeFiles)) {
      try {
        fs.writeFileSync(f, P.marker)
        writes[name] = { ok: true }
      } catch (e) {
        writes[name] = { ok: false, code: code(e) }
      }
    }
    const mkdirs = {}
    for (const [name, d] of Object.entries(P.mkdirs)) {
      try {
        fs.mkdirSync(d)
        mkdirs[name] = { ok: true }
      } catch (e) {
        mkdirs[name] = { ok: false, code: code(e) }
      }
    }
    const ops = {}
    const c = P.victim
    const attempt = (name, fn) => {
      try {
        fn()
        ops[name] = { ok: true }
      } catch (e) {
        ops[name] = { ok: false, code: code(e) }
      }
    }
    attempt('overwrite', () => fs.writeFileSync(c, P.marker))
    attempt('append', () => fs.appendFileSync(c, P.marker))
    attempt('rename', () => fs.renameSync(c, c + '.renamed'))
    attempt('delete', () => fs.unlinkSync(c))
    out({ writes, mkdirs, ops })
  } else if (which === 'scratch') {
    // what the box CAN do in its own folder (the positive control for the denials)
    const r = {}
    const attempt = (name, fn) => {
      try {
        r[name] = { ok: true, v: fn() }
      } catch (e) {
        r[name] = { ok: false, code: code(e) }
      }
    }
    const d = P.scratchDir
    attempt('write', () => fs.writeFileSync(d + '\\a.txt', 'hello'))
    attempt('read', () => fs.readFileSync(d + '\\a.txt', 'utf8'))
    attempt('mkdir', () => fs.mkdirSync(d + '\\sub\\deep', { recursive: true }))
    attempt('write-nested', () => fs.writeFileSync(d + '\\sub\\deep\\b.txt', 'nested'))
    attempt('list', () => fs.readdirSync(d).length)
    attempt('rename', () => fs.renameSync(d + '\\a.txt', d + '\\c.txt'))
    attempt('delete', () => fs.unlinkSync(d + '\\c.txt'))
    attempt('big-write', () => fs.writeFileSync(d + '\\big.bin', Buffer.alloc(5 * 1024 * 1024, 7)))
    attempt('own-script', () => fs.readFileSync(process.argv[1], 'utf8').length)
    attempt('read-sibling', () => fs.readFileSync(P.sibling, 'utf8').slice(0, 20))
    out(r)
  } else if (which === 'net') {
    const r = {}
    r.loopback = await connect('127.0.0.1', P.tcpPort, 'lo')
    if (P.lanIp) r.lan = await connect(P.lanIp, P.tcpPort, 'lan')
    r.internetIp = await connect('1.1.1.1', 443, 'inet')
    r.internetIp2 = await connect('8.8.8.8', 53, 'inet2')
    r.dns = await new Promise((resolve) => {
      const t = setTimeout(() => resolve('timeout'), P.netTimeoutMs)
      dns.lookup('example.com', (e, a) => {
        clearTimeout(t)
        resolve(e ? code(e) : 'resolved ' + a)
      })
    })
    r.listen = await new Promise((resolve) => {
      const s = net.createServer()
      s.on('error', (e) => resolve(code(e)))
      s.listen(0, '127.0.0.1', () => {
        s.close()
        resolve('listening')
      })
    })
    r.udp = await new Promise((resolve) => {
      const s = dgram.createSocket('udp4')
      s.on('error', (e) => resolve(code(e)))
      s.send(Buffer.from('udp'), P.udpPort, '127.0.0.1', (e) => {
        s.close()
        resolve(e ? code(e) : 'sent')
      })
    })
    out(r)
  } else if (which === 'children') {
    const c = cp.spawn(process.execPath, ['-e', 'setTimeout(function(){},120000)'], { detached: true, stdio: 'ignore', windowsHide: true })
    c.unref()
    await sleep(900)
    out({ pid: c.pid, aliveAtExit: alive(c.pid) })
    process.exit(0)
  } else if (which === 'fork') {
    const started = []
    const failed = []
    for (let i = 0; i < P.forkN; i++) {
      try {
        const c = cp.spawn(P.sleeper.program, P.sleeper.args, { stdio: 'ignore', windowsHide: true })
        c.on('error', (e) => failed.push(code(e)))
        if (c.pid) started.push(c.pid)
        else failed.push('nopid')
      } catch (e) {
        failed.push(code(e))
      }
    }
    await sleep(1500)
    out({ asked: P.forkN, started: started.length, aliveNow: started.filter((p) => alive(p) === true).length, failed: failed.length, failCodes: [...new Set(failed)] })
    process.exit(0)
  } else if (which === 'time') {
    out({ begin: true })
    for (;;);
  } else if (which === 'memory') {
    const keep = []
    let mb = 0
    for (;;) {
      const b = Buffer.alloc(16 * 1024 * 1024, 1)
      keep.push(b)
      mb += 16
      fs.writeSync(1, 'MB ' + mb + '\n')
      if (mb >= P.memoryTryMb) break
    }
    out({ reachedMb: mb })
  } else if (which === 'output') {
    const chunk = 'x'.repeat(65536)
    for (;;) fs.writeSync(1, chunk)
  } else if (which === 'programs') {
    const r = {}
    for (const [name, spec] of Object.entries(P.programs)) {
      // no pipes: a child with piped output hangs inside the box (libuv makes a named pipe there and is refused, forever)
      const p = cp.spawnSync(spec.program, spec.args, { timeout: 8000, windowsHide: true, stdio: ['ignore', 'ignore', 'ignore'] })
      r[name] = p.error ? { ran: false, code: code(p.error) } : { ran: true, status: p.status, signal: p.signal }
    }
    out(r)
  } else if (which === 'listen') {
    // can the box open a port, and can anything outside connect to it? The driver connects while this waits.
    const s = net.createServer((c) => {
      fs.writeFileSync(P.listenSeenFile, 'someone connected')
      c.destroy()
    })
    s.on('error', (e) => {
      fs.writeFileSync(P.listenPortFile, 'error ' + code(e))
    })
    s.listen(0, '127.0.0.1', () => {
      fs.writeFileSync(P.listenPortFile, String(s.address().port))
    })
    await sleep(P.listenWaitMs)
    out({ done: true })
    process.exit(0)
  } else if (which === 'scan') {
    // what can the box read that is not its own? names only
    const roots = {}
    for (const [name, d] of Object.entries(P.scanRoots)) {
      try {
        const l = fs.readdirSync(d, { withFileTypes: true })
        roots[name] = { ok: true, n: l.length }
      } catch (e) {
        roots[name] = { ok: false, code: code(e) }
      }
    }
    const readable = {}
    for (const [name, d] of Object.entries(P.scanShared)) {
      let subs = []
      try {
        subs = fs.readdirSync(d, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name)
      } catch {
        /* not listable */
      }
      const canList = (n) => {
        try {
          fs.readdirSync(d + '\\' + n)
          return true
        } catch {
          return false
        }
      }
      readable[name] = { folders: subs.length, listable: subs.filter(canList) }
    }
    out({ roots, readable })
  } else if (which === 'env') {
    out({ env: process.env, home: os.homedir(), tmp: os.tmpdir(), cwd: process.cwd() })
  } else if (which === 'misc') {
    const r = {}
    r.seeOtherProcess = alive(P.otherPid)
    try {
      r.user = os.userInfo().username
    } catch (e) {
      r.user = 'error ' + code(e)
    }
    out(r)
  } else {
    out({ error: 'unknown case ' + which })
  }
}
main().catch((e) => {
  out({ crashed: String(e && e.stack ? e.stack : e) })
  process.exit(3)
})
