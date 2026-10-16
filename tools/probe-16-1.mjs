// Stage 16.1 (D-048), the window half of the probe: can the window show a picture made in main the way the plan says (a `data:` picture, the page's policy unchanged), and what
// does it refuse? Run in the real window (tools/run161.mjs). It also takes the baseline: the bridge has no images part yet.
// Needs: USER_DATA_DIR (scratch).
import './temp-on-a.mjs'
import './ts-resolve.mjs'
import { connect, checker } from './cdp.mjs'
import { assertScratchProfile } from './profile-guard.mjs'
import { createServer } from 'node:http'
import { solidPng } from './mock-images.mjs'

const port = Number(process.argv[3] ?? 9222)
const check = checker()
const page = await connect(port)
await assertScratchProfile()
const ev = (expression) => page.evaluate(expression)
const show = (v) => JSON.stringify(v)?.slice(0, 500)

// a picture served over http on this computer: the policy must refuse it
const server = createServer((req, res) => { res.setHeader('content-type', 'image/png'); res.end(solidPng(16, 16)) })
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
const httpUrl = `http://127.0.0.1:${server.address().port}/p.png`

/** Puts an <img> with `src` in the page and answers whether it loaded and its natural size, and how long it took. */
const load = (src) => ev(`new Promise((resolve) => {
  const img = document.createElement('img')
  const t0 = performance.now()
  img.onload = () => { resolve({ ok: true, w: img.naturalWidth, h: img.naturalHeight, ms: Math.round(performance.now() - t0) }); img.remove() }
  img.onerror = () => { resolve({ ok: false }); img.remove() }
  img.style.position = 'fixed'; img.style.left = '-99999px'
  img.src = ${JSON.stringify(src)}
  document.body.appendChild(img)
  setTimeout(() => resolve({ ok: false, timeout: true }), 15000)
})`)

try {
  const groups = await ev(`Object.keys(window.api).sort().join()`)
  check('baseline: the bridge has no images part yet', !/(^|,)images(,|$)/.test(groups), groups)
  const policy = await ev(`document.querySelector('meta[http-equiv="Content-Security-Policy"]').content`)
  check("baseline: the page's policy is the one in index.html (img-src 'self' data:)", /img-src 'self' data:$/.test(policy), policy)

  const square = solidPng(1024, 1024)
  const a = await load(`data:image/png;base64,${square.toString('base64')}`)
  check('a data: PNG of 1024x1024 shows at its own size', a.ok && a.w === 1024 && a.h === 1024, show(a))
  const big = solidPng(3840, 2160)
  const b = await load(`data:image/png;base64,${big.toString('base64')}`)
  check('a data: PNG of 3840x2160 (the largest the API makes) shows', b.ok && b.w === 3840 && b.h === 2160, show(b))
  const heavy = solidPng(64, 64, [1, 2, 3], 9 * 1024 * 1024)
  const c = await ev(`(async () => { const t0 = performance.now(); const s = ${JSON.stringify('data:image/png;base64,')} + 'A'.repeat(${Math.ceil((heavy.length * 4) / 3)}); return { len: s.length, ms: Math.round(performance.now() - t0) } })()`)
  check('a data: address of about 12 MB of text can be made in the page (the size of the largest picture the plan keeps)', c.len > 12_000_000, show(c))
  const blob = await ev(`URL.createObjectURL(new Blob([new Uint8Array(${show([...solidPng(8, 8)])})], { type: 'image/png' }))`)
  const d = await load(blob)
  check('a blob: picture is refused by the policy (so the plan does not use one)', d.ok === false, show(d))
  const e = await load(httpUrl)
  check('a picture from an address (even on this computer) is refused', e.ok === false, show(e))
  const f = await load(`data:image/svg+xml;base64,${Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect width="10" height="10"/></svg>').toString('base64')}`)
  console.log(`   (a data: SVG ${f.ok ? 'shows' : 'does not show'}: the store never keeps one, the checker takes PNG, JPEG and WebP only)`)
  const g = await load(`data:image/png;base64,${square.subarray(0, 40).toString('base64')}`)
  check('a cut PNG does not show (the window does not invent a picture)', g.ok === false, show(g))
} finally {
  server.close()
}
const ok = check.summary()
process.exit(ok ? 0 : 1)
