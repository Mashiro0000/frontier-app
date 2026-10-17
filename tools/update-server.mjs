// A stand-in for GitHub's release downloads (Stage 18, D-050), for the update checks. It never touches the internet. It serves, under the same paths GitHub uses:
//   /<repo>/releases/latest/download/latest.json          -> a redirect to /cdn/latest.json (as GitHub sends release files on to its file servers)
//   /<repo>/releases/download/v<version>/<installer name> -> a redirect to /cdn/<installer name>
//   /cdn/latest.json, /cdn/<name>                         -> the bytes set with setEnvelope / setInstaller
// and a mode for every way a server can misbehave (`server.mode = ...`). Every request is recorded (method, path, headers, body length).
import { createServer } from 'node:http'

export async function startUpdateServer(port = 0) {
  let envelope = Buffer.alloc(0)
  const installers = new Map()
  const requests = []
  const server = createServer((req, res) => {
    const chunks = []
    req.on('data', (c) => chunks.push(c))
    req.on('end', () => {
      const path = decodeURIComponent(new URL(req.url, 'http://x').pathname)
      requests.push({ method: req.method, path, url: req.url, headers: { ...req.headers }, bodyBytes: Buffer.concat(chunks).length })
      const mode = api.mode
      const send = (status, body = Buffer.alloc(0), headers = {}) => { res.writeHead(status, { 'content-length': body.length, ...headers }); res.end(body) }
      const redirect = (to, status = 302) => { res.writeHead(status, { location: to, 'content-length': 0 }); res.end() }
      if (mode === 'hang') return // never answers
      if (mode === '500') return send(500, Buffer.from('server error'))
      if (mode === '404') return send(404, Buffer.from('Not Found'))
      if (/\/releases\/latest\/download\/latest\.json$/.test(path)) {
        if (mode === 'redirect-evil') return redirect('http://127.0.0.2:9/latest.json')
        if (mode === 'redirect-https-evil') return redirect('https://127.0.0.2:9/latest.json')
        if (mode === 'redirect-loop') return redirect(req.url)
        if (mode === 'redirect-no-location') { res.writeHead(302, { 'content-length': 0 }); return res.end() }
        if (mode === 'redirect-six') return redirect('/hop/1')
        return redirect('/cdn/latest.json')
      }
      const hop = /^\/hop\/(\d+)$/.exec(path)
      if (hop) return Number(hop[1]) < 6 ? redirect(`/hop/${Number(hop[1]) + 1}`) : redirect('/cdn/latest.json')
      const dl = /\/releases\/download\/v[^/]+\/([^/]+)$/.exec(path)
      if (dl) return redirect(`/cdn/${dl[1]}`)
      if (path === '/cdn/latest.json') {
        if (mode === 'big-declared') { res.writeHead(200, { 'content-length': 10_000_000 }); return res.end(envelope) }
        if (mode === 'big-stream') { res.writeHead(200, { 'transfer-encoding': 'chunked' }); const blob = Buffer.alloc(16 * 1024, 32); let n = 0; const pump = () => { while (n < 10) { n++; if (!res.write(blob)) return res.once('drain', pump) } res.end() }; return pump() }
        return send(200, envelope, { 'content-type': 'application/octet-stream' })
      }
      const file = /^\/cdn\/([^/]+)$/.exec(path)
      if (file && installers.has(file[1])) {
        const body = installers.get(file[1])
        if (mode === 'installer-wrong-length') { res.writeHead(200, { 'content-length': body.length + 1 }); return res.end(Buffer.concat([body, Buffer.from('x')])) }
        if (mode === 'installer-longer') { res.writeHead(200, { 'transfer-encoding': 'chunked' }); res.write(body); return res.end(Buffer.from('extra bytes')) }
        if (mode === 'installer-shorter') { res.writeHead(200, { 'transfer-encoding': 'chunked' }); return res.end(body.subarray(0, body.length - 10)) }
        if (mode === 'installer-changed') { const c = Buffer.from(body); c[c.length >> 1] ^= 1; return send(200, c) }
        if (mode === 'installer-stall') { res.writeHead(200, { 'content-length': body.length }); return res.write(body.subarray(0, 100)) }
        return send(200, body, { 'content-type': 'application/octet-stream' })
      }
      send(404, Buffer.from('Not Found'))
    })
  })
  await new Promise((resolve) => server.listen(port, '127.0.0.1', resolve))
  const api = {
    mode: 'ok',
    origin: `http://127.0.0.1:${server.address().port}`,
    requests,
    setEnvelope: (bytes) => { envelope = Buffer.from(bytes) },
    setInstaller: (name, bytes) => installers.set(name, Buffer.from(bytes)),
    clear: () => { requests.length = 0 },
    close: () => new Promise((resolve) => { server.closeAllConnections?.(); server.close(() => resolve()) })
  }
  return api
}
