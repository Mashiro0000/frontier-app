// Slice 9.1 with Electron's REAL image tools (nativeImage), which plain Node does not have (D-037). An Electron main script with no window; run it with
// run91.mjs, which bundles src/main/attachmentImages.ts and attachmentStore.ts (esbuild) and starts Electron on a scratch profile.
//  - what nativeImage decodes (PNG and JPEG; not GIF or WebP, which the store never gives it), and that it does NOT apply a photo's orientation;
//  - a photo in each of the eight EXIF orientations comes out upright (the colours of its four quadrants where a person would see them);
//  - made smaller (3000 x 2000 -> 2000 x 1333, 6000 x 4000 in a few seconds); a heavy opaque PNG becomes a JPEG; a heavy PNG with transparency stays a PNG;
//  - metadata removed by rewriting the bytes: the picture decodes to exactly the same pixels as before;
//  - the thumbnail; a picture that does not decode is refused.
const { app, nativeImage } = require('electron')
const { readFileSync } = require('fs')
const { join } = require('path')

const bundle = require(process.env.V91_BUNDLE)
const { prepare, createAttachmentStore, electronImageTools: tools, stripMetadata, imageHeader } = bundle
const FIX = join(__dirname, 'fixtures9')
const fixture = (name) => readFileSync(join(FIX, name))
const results = []
const check = (name, ok, detail = '') => {
  results.push(!!ok)
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  -> ' + detail : ''}`)
}
const show = (v) => JSON.stringify(v)?.slice(0, 240)

/** BGRA bitmap of four solid quadrants: TL red, TR green, BL blue, BR white. */
function quadrants(width, height, alpha = 255) {
  const b = Buffer.alloc(width * height * 4)
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const right = x >= width / 2
      const bottom = y >= height / 2
      const [r, g, bl] = !bottom ? (right ? [0, 255, 0] : [255, 0, 0]) : right ? [255, 255, 255] : [0, 0, 255]
      const i = (y * width + x) * 4
      b[i] = bl
      b[i + 1] = g
      b[i + 2] = r
      b[i + 3] = alpha
    }
  return b
}

/** The colour (R, G, B, W, or ?) at a point of a decoded picture. */
function colourAt(image, fx, fy) {
  const { width, height } = image.getSize()
  const bm = image.toBitmap()
  const x = Math.floor(width * fx)
  const y = Math.floor(height * fy)
  const i = (y * width + x) * 4
  const [b, g, r] = [bm[i], bm[i + 1], bm[i + 2]]
  const hi = (v) => v > 180
  const lo = (v) => v < 80
  if (hi(r) && lo(g) && lo(b)) return 'R'
  if (lo(r) && hi(g) && lo(b)) return 'G'
  if (lo(r) && lo(g) && hi(b)) return 'B'
  if (hi(r) && hi(g) && hi(b)) return 'W'
  return `?${r},${g},${b}`
}
const corners = (image) => [colourAt(image, 0.25, 0.25), colourAt(image, 0.75, 0.25), colourAt(image, 0.25, 0.75), colourAt(image, 0.75, 0.75)].join('')

function exifSegment(orientation) {
  const tiff = Buffer.alloc(26)
  tiff.write('II', 0, 'latin1')
  tiff.writeUInt16LE(42, 2)
  tiff.writeUInt32LE(8, 4)
  tiff.writeUInt16LE(1, 8)
  tiff.writeUInt16LE(0x0112, 10)
  tiff.writeUInt16LE(3, 12)
  tiff.writeUInt32LE(1, 14)
  tiff.writeUInt16LE(orientation, 18)
  const payload = Buffer.concat([Buffer.from('Exif\0\0', 'latin1'), tiff])
  const head = Buffer.from([0xff, 0xe1, 0, 0])
  head.writeUInt16BE(payload.length + 2, 2)
  return Buffer.concat([head, payload])
}
const withSegments = (jpeg, segments) => Buffer.concat([jpeg.subarray(0, 2), ...segments, jpeg.subarray(2)])

app.whenReady().then(async () => {
  try {
    // ---- what nativeImage decodes
    check('nativeImage decodes the PNG and JPEG fixtures to their sizes', ['q.jpg', 'q.png', 'alpha.png'].every((n) => { const s = tools.decodedSize(fixture(n)); const h = imageHeader(fixture(n), n.endsWith('jpg') ? 'image/jpeg' : 'image/png'); return s && s.width === h.width && s.height === h.height }))
    check('nativeImage does NOT decode GIF or WebP (so they are never given to it: they go as they are)', tools.decodedSize(fixture('lossy.webp')) === null && tools.decodedSize(Buffer.from('R0lGODlhAQABAIAAAP///wAAACH5BAEAAAAALAAAAAABAAEAAAICRAEAOw==', 'base64')) === null)
    const sideways = withSegments(fixture('q.jpg'), [exifSegment(6)])
    const raw = nativeImage.createFromBuffer(sideways)
    check('nativeImage does NOT apply a photo\'s orientation itself (a JPEG marked "turn" decodes as stored: 64 x 32, red at the top left), which is why the app turns it', raw.getSize().width === 64 && corners(raw) === 'RGBW', `${show(raw.getSize())} ${corners(raw)}`)

    // ---- the eight orientations come out upright
    const expected = { 1: 'RGBW', 2: 'GRWB', 3: 'WBGR', 4: 'BWRG', 5: 'RBGW', 6: 'BRWG', 7: 'WGBR', 8: 'GWRB' }
    const got = {}
    for (const o of [1, 2, 3, 4, 5, 6, 7, 8]) {
      const r = prepare({ bytes: withSegments(fixture('q.jpg'), [exifSegment(o)]), name: `o${o}.jpg` }, tools)
      if (!r.ok) { got[o] = r.why; continue }
      const image = nativeImage.createFromBuffer(r.bytes)
      const size = image.getSize()
      const header = imageHeader(r.bytes, r.file.info.mediaType)
      got[o] = `${size.width}x${size.height} ${corners(image)} turned=${r.file.info.changes.turned} exif=${r.bytes.includes(Buffer.from('Exif'))} orient=${header.orientation}`
    }
    const want = Object.fromEntries(Object.entries(expected).map(([o, c]) => [o, `${Number(o) >= 5 ? '32x64' : '64x32'} ${c} turned=${o !== '1'} exif=false orient=1`]))
    check('each of the eight EXIF orientations comes out upright: the quadrants where a person sees them, the sides swapped for 5 to 8, no EXIF left, "turned" except for 1', JSON.stringify(got) === JSON.stringify(want), show(got))

    // ---- made smaller
    const big = nativeImage.createFromBitmap(quadrants(3000, 2000), { width: 3000, height: 2000 }).toJPEG(90)
    let r = prepare({ bytes: withSegments(big, [exifSegment(1)]), name: 'big.jpg' }, tools)
    let image = r.ok && nativeImage.createFromBuffer(r.bytes)
    check('a 3000 x 2000 JPEG is made smaller to 2000 x 1333, the same picture (its quadrants), a JPEG, "made smaller from 3000 x 2000"', r.ok && image.getSize().width === 2000 && image.getSize().height === 1333 && corners(image) === 'RGBW' && r.file.info.mediaType === 'image/jpeg' && JSON.stringify(r.file.info.changes.shrunkFrom) === '{"width":3000,"height":2000}' && r.file.info.width === 2000, show(r.ok ? r.file.info : r))
    const huge = nativeImage.createFromBitmap(quadrants(6000, 4000), { width: 6000, height: 4000 }).toJPEG(85)
    const t0 = Date.now()
    r = prepare({ bytes: withSegments(huge, [exifSegment(6)]), name: 'huge.jpg' }, tools)
    const ms = Date.now() - t0
    image = r.ok && nativeImage.createFromBuffer(r.bytes)
    check(`a 6000 x 4000 photo held sideways becomes 1333 x 2000, upright, in a few seconds (${ms} ms)`, r.ok && image.getSize().width === 1333 && image.getSize().height === 2000 && corners(image) === 'BRWG' && ms < 8000, show(r.ok ? r.file.info : r))
    // a heavy opaque PNG: JPEG
    const noise = (w, h, withAlpha) => { const b = Buffer.alloc(w * h * 4); for (let i = 0; i < b.length; i++) b[i] = Math.random() * 256; if (!withAlpha) for (let i = 3; i < b.length; i += 4) b[i] = 255; return nativeImage.createFromBitmap(b, { width: w, height: h }).toPNG() }
    const heavy = noise(1800, 1800, false)
    r = prepare({ bytes: heavy, name: 'noise.png' }, tools)
    check(`a PNG of noise with no transparency, ${(heavy.length / 1048576).toFixed(1)} MB, is kept as a JPEG of at most 5 MB and 2000 px, "converted from PNG" (its name stays as given)`, heavy.length > 5 * 1048576 && r.ok && r.file.info.mediaType === 'image/jpeg' && r.file.info.changes.convertedFrom === 'image/png' && r.bytes.length <= 5 * 1048576 && r.file.info.name === 'noise.png', show(r.ok ? r.file.info : r))
    const heavyAlpha = noise(1500, 1500, true)
    r = prepare({ bytes: heavyAlpha, name: 'alpha-noise.png' }, tools)
    image = r.ok && nativeImage.createFromBuffer(r.bytes)
    const keepsAlpha = r.ok && (() => { const bm = image.toBitmap(); for (let i = 3; i < bm.length; i += 4) if (bm[i] !== 255) return true; return false })()
    check(`a PNG of noise WITH transparency, ${(heavyAlpha.length / 1048576).toFixed(1)} MB, stays a PNG (its transparency kept), made smaller until it is at most 5 MB`, heavyAlpha.length > 5 * 1048576 && r.ok && r.file.info.mediaType === 'image/png' && r.file.info.changes.convertedFrom === null && keepsAlpha && r.bytes.length <= 5 * 1048576 && r.file.info.changes.shrunkFrom !== null, show(r.ok ? r.file.info : r))

    // ---- metadata removed: the same pixels
    const xmp = Buffer.concat([Buffer.from([0xff, 0xe1, 0, 0]), Buffer.from('http://ns.adobe.com/xap/1.0/\0<x>secret</x>', 'latin1')])
    xmp.writeUInt16BE(xmp.length - 2, 2)
    const com = Buffer.concat([Buffer.from([0xff, 0xfe, 0, 9]), Buffer.from('comment', 'latin1')])
    const dirty = Buffer.concat([withSegments(fixture('q.jpg'), [exifSegment(1), xmp, com]), Buffer.from('trailing-video-bytes')])
    const stripped = stripMetadata(dirty, 'image/jpeg')
    check('a JPEG without its metadata decodes to exactly the same pixels as with it', stripped.removed && nativeImage.createFromBuffer(stripped.bytes).toBitmap().equals(nativeImage.createFromBuffer(dirty).toBitmap()))
    const pngText = (() => { const p = fixture('q.png'); const t = Buffer.from('tEXtAuthor\0Somebody', 'latin1'); const len = Buffer.alloc(4); len.writeUInt32BE(t.length - 4); return Buffer.concat([p.subarray(0, 33), len, t, Buffer.alloc(4), p.subarray(33)]) })()
    const strippedPng = stripMetadata(pngText, 'image/png')
    check('a PNG without its text chunks decodes to exactly the same pixels', strippedPng.removed && nativeImage.createFromBuffer(strippedPng.bytes).toBitmap().equals(nativeImage.createFromBuffer(fixture('q.png')).toBitmap()))

    // ---- the thumbnail, and pictures that do not decode
    r = prepare({ bytes: big, name: 't.jpg' }, tools)
    const thumb = r.ok && nativeImage.createFromDataURL(r.file.thumbnail)
    check('the thumbnail is a PNG data URL of at most 160 px a side, the same shape and picture', r.ok && r.file.thumbnail.startsWith('data:image/png;base64,') && thumb.getSize().width === 160 && thumb.getSize().height === 107 && corners(thumb) === 'RGBW', show(r.ok && thumb.getSize()))
    const badPng = (() => { const p = Buffer.from(fixture('q.png')); const at = p.indexOf(Buffer.from('IDAT')) + 6; for (let i = at; i < at + 20 && i < p.length - 16; i++) p[i] ^= 0x5a; return p })()
    const bad = prepare({ bytes: badPng, name: 'bad.png' }, tools)
    check('a PNG whose picture data is damaged does not decode, and is refused ("could not be read as an image")', !bad.ok && /could not be read as an image/.test(bad.why), show(bad))
    const shortJpeg = (() => { const j = fixture('q.jpg'); const sos = j.indexOf(Buffer.from([0xff, 0xda])); return Buffer.concat([j.subarray(0, sos + 14), Buffer.from([0xff, 0xd9])]) })()
    const sj = prepare({ bytes: shortJpeg, name: 'short.jpg' }, tools)
    check('a JPEG with its scan cut short is either refused or decodes to its header\'s size (never another size)', !sj.ok || (sj.file.info.width === 64 && sj.file.info.height === 32), show(sj.ok ? sj.file.info : sj))

    // ---- the store with the real tools
    const dir = join(app.getPath('userData'), 'attachments-test')
    const store = createAttachmentStore(dir, { images: tools })
    const added = await store.add({ bytes: withSegments(fixture('q.jpg'), [exifSegment(6)]), name: 'side.jpg' })
    const read = added.ok && (await store.read(added.file.info.id))
    const kept = read && read.ok && nativeImage.createFromBuffer(read.bytes)
    check('the store with the real tools keeps a sideways photo upright: read back, it is 32 x 64 with the quadrants where a person sees them', kept && kept.getSize().width === 32 && corners(kept) === 'BRWG', show(added.ok ? added.file.info : added))
  } catch (error) {
    check(`the suite stopped before its end: ${String(error && error.stack).slice(0, 300)}`, false)
  }
  const passed = results.filter(Boolean).length
  console.log(`\n${passed}/${results.length} checks passed`)
  app.exit(passed === results.length ? 0 : 1)
})
