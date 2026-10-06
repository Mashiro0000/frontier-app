// Slice 9.1 under plain Node (no window): the attachment store (D-037).
//  A. what a file is, from its first bytes, and an image's header (size, animation, orientation), for real files (tools/fixtures9) and made ones.
//  B. metadata taken out by rewriting the bytes: JPEG (EXIF with a place, XMP, IPTC, comments, MPF, a JFIF thumbnail, a "motion photo" tail), PNG (text,
//     XMP, EXIF, times, private chunks), GIF (comments, application blocks), WebP (EXIF, XMP); the picture's own bytes untouched.
//  C. PDFs (pages, in plain objects and in compressed object streams; a password; cut off; a zip bomb) and text (UTF-8, control characters, a BOM).
//  D. prepare(): the whole way in, with stand-in image tools: every cap at its edge, the header looked at BEFORE anything decodes, shrinking and turning,
//     what the image tools make checked again, names, ids, and a sentence for every refusal.
//  E. readLocalFile(): only a file on a local drive; links, network and device paths, streams, folders refused; the size looked at before reading.
//  F. the folder (in a normal folder and in the EFS-encrypted %APPDATA%): copies named by their hash and read back, the same file kept once, a damaged copy
//     found and written again, a half-written copy, disk faults, the folder's caps (full = refused, nothing deleted), hold / deleteUnused / sweep.
//  G. sealed copies (D-035): written sealed when encryption is on, nothing readable in them, refused when writing is refused (and nothing written), a lost key,
//     conform both ways byte for byte, a text file that begins like a sealed copy.
//  H. what the source must keep true.
// Run: node tools/verify-9-1.mjs      (QUICK=1: the normal folder only, for the negative controls)
import { checker } from './cdp.mjs'
import { promises as fsp, existsSync, mkdirSync, readFileSync, readdirSync, statSync, utimesSync, writeFileSync, symlinkSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { deflateSync } from 'node:zlib'
import { scratch } from './drive.mjs'
import { makeBox, withFaults } from './lib8b3.mjs'
import {
  formats, storeMod, shared, LIMITS, fixture, sha256, same, latin, pngChunk, makePng, pngHeaderOnly, textChunk, itxtXmp, exifBlock, jpegSegment, jpegWith, jpegSized,
  APP, makeGif, riffChunk, webp, webpChunksOf, vp8x, makePdf, standInTools, source
} from './lib9.mjs'

const check = checker()
const guard = async (name, fn) => { try { await fn() } catch (error) { check(`${name} did not run to its end: ${String(error?.stack ?? error).slice(0, 300)}`, false) } }
const { sniff, imageHeader, stripMetadata, pdfFacts, checkText, exifOrientation, orientBitmap, MAX_INPUT_BYTES } = formats
const { prepare, readLocalFile, createAttachmentStore, SEALED_MAGIC, MAX_COPY_BYTES, factsOf } = storeMod
const { cleanFileName, isAttachmentId } = shared
const show = (v) => JSON.stringify(v)?.slice(0, 240)
const MB = 1024 * 1024
const exists = (path) => fsp.access(path).then(() => true, () => false)
const CJK = String.fromCodePoint(0x65e5, 0x672c)
const SMILE = String.fromCodePoint(0x1f600)

// ============ A. what a file is ============
await guard('A', async () => {
  const types = { 'q.jpg': 'image/jpeg', 'q.png': 'image/png', 'alpha.png': 'image/png', 'lossy.webp': 'image/webp', 'lossless.webp': 'image/webp', 'alpha.webp': 'image/webp', 'three-pages.pdf': 'application/pdf' }
  check('A: the real fixtures are each told by their first bytes', Object.entries(types).every(([name, type]) => sniff(fixture(name)) === type), show(Object.keys(types).map((n) => sniff(fixture(n)))))
  check('A: a GIF (87a and 89a) is a GIF', sniff(makeGif()) === 'image/gif' && sniff(Buffer.concat([latin('GIF87a'), makeGif().subarray(6)])) === 'image/gif')
  const notTypes = [latin('hello'), Buffer.alloc(0), latin('\x89PNG\r\n'), latin('GIF88a....'), latin('RIFF\0\0\0\0WAVEfmt '), latin('%PDF'), latin(' %PDF-1.7'), Buffer.from([0xff, 0xd8]), latin('MZ\x90\0'), latin('PK\x03\x04')]
  check('A: nothing else is taken for an image or a PDF (text, nothing, a cut PNG signature, GIF88a, a WAV, "%PDF" alone, a PDF that does not start at byte 0, two JPEG bytes, an .exe, a .zip)', notTypes.every((b) => sniff(b) === null), show(notTypes.map((b) => sniff(b))))
  const sizes = [['q.jpg', 64, 32], ['q.png', 64, 32], ['lossy.webp', 48, 24], ['lossless.webp', 48, 24], ['alpha.webp', 48, 24], ['alpha.png', 48, 24]]
  check('A: the real fixtures\' headers give their sizes, not animated, orientation 1', sizes.every(([n, w, h]) => same(imageHeader(fixture(n), sniff(fixture(n))), { ok: true, width: w, height: h, animated: false, orientation: 1 })))
  const vp8 = webpChunksOf(fixture('lossy.webp')).find((c) => c.fourcc === 'VP8 ')
  const vp8l = webpChunksOf(fixture('lossless.webp')).find((c) => c.fourcc === 'VP8L')
  check('A: a simple WebP (VP8 alone, lossy) and a simple lossless one (VP8L alone) give their sizes', same(imageHeader(webp([riffChunk('VP8 ', vp8.data)]), 'image/webp'), { ok: true, width: 48, height: 24, animated: false, orientation: 1 }) && same(imageHeader(webp([riffChunk('VP8L', vp8l.data)]), 'image/webp'), { ok: true, width: 48, height: 24, animated: false, orientation: 1 }))
  check('A: a GIF of two pictures is animated; one picture is not', imageHeader(makeGif({ frames: 2 }), 'image/gif').animated === true && imageHeader(makeGif({ frames: 1, loop: true }), 'image/gif').animated === false)
  check('A: an animated PNG (acTL) is animated', imageHeader(makePng(4, 4, { before: [pngChunk('acTL', Buffer.alloc(8))] }), 'image/png').animated === true)
  const anim = webp([vp8x({ width: 10, height: 10, flags: 0x02 }), riffChunk('ANIM', Buffer.alloc(6)), riffChunk('ANMF', Buffer.alloc(24))])
  check('A: an animated WebP (the VP8X flag, ANIM and ANMF) is animated', imageHeader(anim, 'image/webp').animated === true)
  const vp8Data = webpChunksOf(fixture('lossy.webp')).find((c) => c.fourcc === 'VP8 ').data
  const flagOnly = webp([vp8x({ width: 48, height: 24, flags: 0x02 }), riffChunk('VP8 ', vp8Data)])
  const framesOnly = webp([vp8x({ width: 48, height: 24, flags: 0 }), riffChunk('VP8 ', vp8Data), riffChunk('ANMF', Buffer.alloc(24))])
  check('A: a WebP is animated by its VP8X flag alone, and by an ANMF frame alone (either is enough)', imageHeader(flagOnly, 'image/webp').animated === true && imageHeader(framesOnly, 'image/webp').animated === true && imageHeader(webp([vp8x({ width: 48, height: 24, flags: 0 }), riffChunk('VP8 ', vp8Data)]), 'image/webp').animated === false)
  const big = pngHeaderOnly(9000, 9000)
  check('A: a header of any size is read without decoding anything (a 9000 x 9000 PNG with a few bytes of picture)', same(imageHeader(big, 'image/png'), { ok: true, width: 9000, height: 9000, animated: false, orientation: 1 }))
  const cut = (b) => b.subarray(0, Math.floor(b.length * 0.6))
  const cuts = [['png', fixture('q.png'), 'image/png'], ['jpeg', fixture('q.jpg'), 'image/jpeg'], ['gif', makeGif(), 'image/gif'], ['webp', fixture('lossy.webp'), 'image/webp']]
  check('A: a file cut off is refused as "not a whole ... image" for each kind', cuts.every(([, b, t]) => { const r = imageHeader(cut(b), t); return !r.ok && /not a whole/.test(r.why) }), show(cuts.map(([, b, t]) => imageHeader(cut(b), t))))
  // a cut at EVERY length is a refusal, never an exception, for the four kinds
  let threw = 0
  let passed = 0
  for (const [, bytes, type] of cuts) {
    for (let n = 0; n < bytes.length; n++) {
      try { if (imageHeader(bytes.subarray(0, n), type).ok) passed += 1 } catch { threw += 1 }
    }
  }
  check('A: every shorter length of each image is read without an exception, and none of them passes as whole', threw === 0 && passed === 0, `threw ${threw}, passed ${passed}`)
  // one byte changed at every place: never an exception
  threw = 0
  for (const [, bytes, type] of cuts) {
    for (let i = 0; i < bytes.length; i++) {
      const b = Buffer.from(bytes)
      b[i] ^= 0xff
      try { imageHeader(b, type); stripMetadata(b, type) } catch { threw += 1 }
    }
  }
  check('A: a byte changed at every place of each image: the header reader and the stripper never throw', threw === 0, `threw ${threw}`)
  const zero = pngHeaderOnly(0, 10)
  check('A: an image whose header gives it no size is refused', !imageHeader(zero, 'image/png').ok && /no size/.test(imageHeader(zero, 'image/png').why))
  const noIdat = Buffer.concat([fixture('q.png').subarray(0, 33), pngChunk('IEND')])
  check('A: a PNG with no picture data (no IDAT) is not a whole PNG', !imageHeader(noIdat, 'image/png').ok)
  const sosFirst = (() => { const j = fixture('q.jpg'); const sos = j.indexOf(Buffer.from([0xff, 0xda])); const sof = j.indexOf(Buffer.from([0xff, 0xc0])); return { j, sos, sof } })()
  check('A: (the JPEG fixture has its frame header before its scan)', sosFirst.sof > 0 && sosFirst.sos > sosFirst.sof)
  // EXIF orientation, little and big endian, with and without the Exif prefix
  check('A: exifOrientation reads 1 to 8 in both byte orders, with or without the "Exif" prefix; anything else is 1', [1, 2, 3, 4, 5, 6, 7, 8].every((o) => exifOrientation(exifBlock(o)) === o && exifOrientation(exifBlock(o, { big: true })) === o && exifOrientation(exifBlock(o, { prefix: false })) === o) && exifOrientation(exifBlock(9)) === 1 && exifOrientation(exifBlock(0)) === 1 && exifOrientation(latin('Exif\0\0II*\0')) === 1 && exifOrientation(Buffer.alloc(0)) === 1)
  let exifThrew = 0
  const ex = exifBlock(6)
  for (let n = 0; n < ex.length; n++) { try { exifOrientation(ex.subarray(0, n)) } catch { exifThrew += 1 } }
  for (let i = 0; i < ex.length; i++) { const b = Buffer.from(ex); b[i] ^= 0xff; try { exifOrientation(b) } catch { exifThrew += 1 } }
  check('A: an EXIF block cut at every length, or with a byte changed at every place, never throws', exifThrew === 0, `threw ${exifThrew}`)
  check('A: only the Orientation tag is the orientation: another SHORT tag before it (ResolutionUnit = 3) is not read as one', [1, 6].every((o) => exifOrientation(exifBlock(o, { unitFirst: true })) === o && exifOrientation(exifBlock(o, { unitFirst: true, big: true })) === o))
  check('A: the orientation of a JPEG (APP1 Exif), a PNG (eXIf) and a WebP (EXIF chunk) is read', imageHeader(jpegWith([APP.exif(6)]), 'image/jpeg').orientation === 6 && imageHeader(makePng(4, 4, { before: [pngChunk('eXIf', exifBlock(8, { prefix: false }))] }), 'image/png').orientation === 8 && imageHeader(webp([vp8x({ width: 48, height: 24, flags: 0x08 }), riffChunk('VP8 ', vp8.data), riffChunk('EXIF', exifBlock(3, { prefix: false }))]), 'image/webp').orientation === 3)
})

// ============ B. metadata taken out ============
await guard('B', async () => {
  const base = fixture('q.jpg')
  const scanOf = (b) => b.subarray(b.indexOf(Buffer.from([0xff, 0xda])))
  const dirty = jpegWith([APP.jfifThumb(), APP.exif(1, { secret: 'GPS-SECRET-PLACE' }), APP.xmp('XMP-SECRET'), APP.iptc('IPTC-SECRET'), APP.comment('COMMENT-SECRET'), APP.mpf('MPF-SECRET'), APP.icc(), APP.adobe()], latin('MOTION-PHOTO-SECRET-VIDEO'))
  const s = stripMetadata(dirty, 'image/jpeg')
  const secrets = ['GPS-SECRET', 'XMP-SECRET', 'IPTC-SECRET', 'COMMENT-SECRET', 'MPF-SECRET', 'MOTION-PHOTO', 'Exif']
  check('B: a JPEG loses EXIF (with its place), XMP, IPTC, comments, MPF and what follows the picture\'s end', s.removed && secrets.every((x) => !s.bytes.includes(latin(x))), secrets.filter((x) => s.bytes.includes(latin(x))).join(','))
  check('B: ...and keeps its colour profile (ICC) and Adobe\'s colour transform, which decoders need', s.bytes.includes(latin('ICC_PROFILE')) && s.bytes.includes(latin('Adobe')))
  check('B: ...and a JFIF header keeps no thumbnail (its thumbnail size is 0 x 0, its length 16)', (() => { const at = s.bytes.indexOf(latin('JFIF\0')); return at > 0 && s.bytes[at + 12] === 0 && s.bytes[at + 13] === 0 && s.bytes.readUInt16BE(at - 2) === 16 })())
  check('B: ...the picture itself (from the scan to the end) is byte for byte the original\'s, and the header still reads the same', scanOf(s.bytes).equals(scanOf(base)) && same(imageHeader(s.bytes, 'image/jpeg'), imageHeader(base, 'image/jpeg')))
  check('B: ...and the result ends exactly at the picture\'s end (FF D9)', s.bytes[s.bytes.length - 2] === 0xff && s.bytes[s.bytes.length - 1] === 0xd9)
  const clean = stripMetadata(base, 'image/jpeg')
  check('B: a JPEG with nothing to take out is kept byte for byte, and "removed" is false', !clean.removed && clean.bytes.equals(base))
  const tailOnly = stripMetadata(Buffer.concat([base, latin('trailing')]), 'image/jpeg')
  check('B: bytes after the end alone count as removed (a motion photo\'s video lives there)', tailOnly.removed && tailOnly.bytes.equals(base))
  // a progressive-like layout: a second scan after a table between scans
  const sos = base.indexOf(Buffer.from([0xff, 0xda]))
  const eoi = base.length - 2
  const twoScans = Buffer.concat([base.subarray(0, eoi), base.subarray(base.indexOf(Buffer.from([0xff, 0xc4])), base.indexOf(Buffer.from([0xff, 0xc4])) + 4 + base.readUInt16BE(base.indexOf(Buffer.from([0xff, 0xc4])) + 2) - 2), base.subarray(sos, eoi), APP.comment('BETWEEN-SCANS'), base.subarray(eoi)])
  const st2 = stripMetadata(twoScans, 'image/jpeg')
  check('B: a JPEG with two scans (as a progressive one has) keeps both scans and loses a comment between them', st2.removed && !st2.bytes.includes(latin('BETWEEN-SCANS')) && st2.bytes.length === twoScans.length - APP.comment('BETWEEN-SCANS').length, `${st2.bytes.length} vs ${twoScans.length}`)
  // restart markers and stuffed bytes inside the scan are not segment boundaries
  const scanData = Buffer.from([0x12, 0xff, 0x00, 0x34, 0xff, 0xd0, 0x56, 0xff, 0xff, 0xd1, 0x78])
  const withRst = Buffer.concat([base.subarray(0, eoi), scanData, base.subarray(eoi)])
  const sr = stripMetadata(withRst, 'image/jpeg')
  check('B: stuffed zeros, restart markers and fill bytes inside a scan are kept as part of it', sr.bytes.equals(withRst) && !sr.removed && imageHeader(withRst, 'image/jpeg').ok)

  const png = makePng(8, 8, { before: [textChunk('Author', 'PNG-AUTHOR-SECRET'), itxtXmp('PNG-XMP-SECRET'), pngChunk('eXIf', exifBlock(1, { prefix: false, secret: 'PNG-EXIF-SECRET' })), pngChunk('tIME', Buffer.from([7, 234, 10, 6, 12, 0, 0])), pngChunk('zTXt', latin('Comment\0\0' + deflateSync(latin('PNG-ZTXT-SECRET')).toString('latin1'))), pngChunk('prVt', latin('PRIVATE-CHUNK-SECRET')), pngChunk('gAMA', Buffer.from([0, 0, 0xb1, 0x8f])), pngChunk('pHYs', Buffer.from([0, 0, 0x0b, 0x13, 0, 0, 0x0b, 0x13, 1]))], after: [textChunk('Comment', 'AFTER-IDAT-SECRET')] })
  const ps = stripMetadata(png, 'image/png')
  const pngSecrets = ['PNG-AUTHOR', 'PNG-XMP', 'PNG-EXIF', 'PRIVATE-CHUNK', 'AFTER-IDAT', 'tEXt', 'iTXt', 'eXIf', 'tIME', 'zTXt', 'prVt']
  check('B: a PNG loses its text chunks (tEXt, zTXt, iTXt with XMP), EXIF, time, and private chunks, before and after the picture', ps.removed && pngSecrets.every((x) => !ps.bytes.includes(latin(x))), pngSecrets.filter((x) => ps.bytes.includes(latin(x))).join(','))
  const idat = (b) => { const at = b.indexOf(latin('IDAT')) - 4; return b.subarray(at, at + 12 + b.readUInt32BE(at)) }
  check('B: ...and keeps IHDR, the picture data (IDAT, byte for byte), gAMA and pHYs; its header reads the same', idat(ps.bytes).equals(idat(png)) && ps.bytes.includes(latin('gAMA')) && ps.bytes.includes(latin('pHYs')) && same(imageHeader(ps.bytes, 'image/png'), imageHeader(png, 'image/png')))
  check('B: a PNG with nothing to take out is kept byte for byte', (() => { const r = stripMetadata(fixture('q.png'), 'image/png'); return !r.removed && r.bytes.equals(fixture('q.png')) })())
  check('B: bytes after a PNG\'s end are dropped (and count as removed)', (() => { const r = stripMetadata(Buffer.concat([fixture('q.png'), latin('TAIL-SECRET')]), 'image/png'); return r.removed === false ? r.bytes.equals(fixture('q.png')) : !r.bytes.includes(latin('TAIL')) })())

  const gif = makeGif({ comment: 'GIF-COMMENT-SECRET', loop: true, xmp: 'GIF-XMP-SECRET' })
  const gs = stripMetadata(gif, 'image/gif')
  check('B: a GIF loses its comment, its XMP and its NETSCAPE loop block, and keeps the picture and its graphic control', gs.removed && !gs.bytes.includes(latin('SECRET')) && !gs.bytes.includes(latin('NETSCAPE')) && gs.bytes.includes(Buffer.from([0x21, 0xf9])) && same(imageHeader(gs.bytes, 'image/gif'), imageHeader(gif, 'image/gif')) && gs.bytes.equals(makeGif()), `${gs.bytes.length} vs ${makeGif().length}`)
  check('B: a GIF with nothing to take out is kept byte for byte', (() => { const r = stripMetadata(makeGif(), 'image/gif'); return !r.removed && r.bytes.equals(makeGif()) })())

  const chunks = webpChunksOf(fixture('alpha.webp'))
  const flags = chunks[0].data[0]
  const dirtyWebp = webp([vp8x({ width: 48, height: 24, flags: flags | 0x08 | 0x04 }), ...chunks.slice(1).map((c) => riffChunk(c.fourcc, c.data)), riffChunk('EXIF', exifBlock(1, { prefix: false, secret: 'WEBP-EXIF-SECRET' })), riffChunk('XMP ', latin('WEBP-XMP-SECRET')), riffChunk('ZZZZ', latin('UNKNOWN-CHUNK-SECRET'))])
  const ws = stripMetadata(dirtyWebp, 'image/webp')
  const wsChunks = webpChunksOf(ws.bytes)
  check('B: a WebP loses EXIF, XMP and unknown chunks, its header no longer says it has EXIF or XMP, and its RIFF size is right', ws.removed && !ws.bytes.includes(latin('SECRET')) && (wsChunks[0].data[0] & 0x0c) === 0 && ws.bytes.readUInt32LE(4) === ws.bytes.length - 8, show(wsChunks.map((c) => c.fourcc)))
  check('B: ...and keeps VP8X (its other flags), ICCP, ALPH and VP8 byte for byte', same(wsChunks.map((c) => c.fourcc), chunks.map((c) => c.fourcc)) && wsChunks.slice(1).every((c, i) => c.data.equals(chunks[i + 1].data)) && (wsChunks[0].data[0] & ~0x0c) === (flags & ~0x0c) && same(imageHeader(ws.bytes, 'image/webp'), imageHeader(fixture('alpha.webp'), 'image/webp')))
  check('B: a WebP with nothing to take out is kept byte for byte', (() => { const r = stripMetadata(fixture('lossy.webp'), 'image/webp'); return !r.removed && r.bytes.equals(fixture('lossy.webp')) })())
})

// ============ C. PDFs and text ============
await guard('C', async () => {
  check('C: Chromium\'s own PDFs: 3 pages and 101 pages (a page tree with inner nodes)', same(pdfFacts(fixture('three-pages.pdf')), { ok: true, pages: 3 }) && same(pdfFacts(fixture('101-pages.pdf')), { ok: true, pages: 101 }))
  check('C: a plain PDF of 7 pages, and one whose page tree is in a compressed object stream', same(pdfFacts(makePdf(7)), { ok: true, pages: 7 }) && same(pdfFacts(makePdf(7, { objstm: true })), { ok: true, pages: 7 }))
  check('C: with no /Count, the /Type /Page objects are counted', same(pdfFacts(makePdf(5, { countless: true })), { ok: true, pages: 5 }))
  const enc = pdfFacts(makePdf(2, { encrypt: true }))
  check('C: a PDF with a password (/Encrypt) is refused, with a reason', !enc.ok && /password/.test(enc.why), show(enc))
  const cutPdf = pdfFacts(makePdf(2, { eof: false }))
  check('C: a PDF that is cut off (no %%EOF at its end) is refused', !cutPdf.ok && /cut off/.test(cutPdf.why), show(cutPdf))
  const nopages = pdfFacts(latin('%PDF-1.7\n1 0 obj\n<< >>\nendobj\n%%EOF\n'))
  check('C: a PDF whose pages cannot be counted is refused', !nopages.ok && /counted/.test(nopages.why), show(nopages))
  // a zip bomb inside an object stream: the unpacking stops at its total
  const bomb = deflateSync(Buffer.alloc(200 * MB, 0x20))
  const bombPdf = Buffer.concat([latin('%PDF-1.7\n1 0 obj\n<< /Type /Pages /Count 2 >>\nendobj\n9 0 obj\n<< /Type /ObjStm /Filter /FlateDecode >>\nstream\n'), bomb, latin('\nendstream\nendobj\n%%EOF\n')])
  const before = process.memoryUsage().rss
  const t0 = Date.now()
  const bombFacts = pdfFacts(bombPdf)
  const grew = process.memoryUsage().rss - before
  check('C: an object stream that unpacks to 200 MB is cut at the total (64 MB): the memory grows by less than 150 MB and the count still comes out', bombFacts.ok && bombFacts.pages === 2 && grew < 150 * MB, `${show(bombFacts)} grew ${Math.round(grew / MB)} MB in ${Date.now() - t0} ms`)
  let pdfThrew = 0
  const small = makePdf(2, { objstm: true })
  for (let i = 0; i < small.length; i++) { const b = Buffer.from(small); b[i] ^= 0xff; try { pdfFacts(b) } catch { pdfThrew += 1 } }
  check('C: a byte changed at every place of a PDF: never an exception', pdfThrew === 0, `threw ${pdfThrew}`)

  const t = checkText(Buffer.from(`one\ttwo\r\nthree\n${CJK} ${SMILE}\n`, 'utf8'))
  check('C: text with tabs, CR LF, LF, CJK and an emoji is text: its characters and lines are counted', t.ok && t.chars === `one\ttwo\r\nthree\n${CJK} ${SMILE}\n`.length && t.lines === 4, show(t.ok && { chars: t.chars, lines: t.lines }))
  const bom = checkText(Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), latin('hello')]))
  check('C: a byte-order mark is dropped from what is kept and counted', bom.ok && bom.text === 'hello' && bom.bytes.equals(latin('hello')) && bom.chars === 5)
  const bad = [[Buffer.from([0x68, 0xc3]), 'UTF-8'], [Buffer.from([0x68, 0xff, 0x69]), 'UTF-8'], [Buffer.from([0xed, 0xa0, 0x80]), 'UTF-8'], [latin('a\0b'), 'characters'], [latin('bell\x07'), 'characters'], [latin('form\x0cfeed'), 'characters'], [latin('esc\x1b[31m'), 'characters'], [Buffer.from('del\x7f', 'latin1'), 'characters'], [Buffer.from(`c1${String.fromCharCode(0x85)}`, 'utf8'), 'characters'], [latin(''), 'empty'], [latin(' \n\t '), 'empty'], [Buffer.from([0xff, 0xfe, 0x68, 0x00]), 'UTF-8']]
  const results = bad.map(([b, why]) => { const r = checkText(b); return !r.ok && r.why.includes(why) })
  check('C: not text: a cut character, a byte that is never UTF-8, a surrogate, NUL, bell, form feed, escape, DEL, a C1 control, empty, white space only, UTF-16', results.every(Boolean), show(results))
})

// ============ D. prepare: the whole way in ============
await guard('D', async () => {
  const tools = standInTools()
  const ok = (r) => r.ok
  const refusal = (r) => (r.ok ? '(accepted)' : r.why)
  // JPEG, clean and small: kept as it is, no re-encoding
  let r = prepare({ bytes: fixture('q.jpg'), name: 'C:\\Users\\me\\Pictures\\holiday.jpg' }, tools)
  check('D: a small clean JPEG is kept byte for byte: its id is its SHA-256, its name the last part of the path, nothing changed', ok(r) && r.bytes.equals(fixture('q.jpg')) && r.file.info.id === sha256(fixture('q.jpg')) && r.file.info.name === 'holiday.jpg' && same(r.file.info.changes, { metadataRemoved: false, shrunkFrom: null, turned: false, convertedFrom: null }) && r.file.info.kind === 'image' && r.file.info.mediaType === 'image/jpeg' && r.file.info.width === 64 && r.file.info.height === 32 && r.file.info.bytes === fixture('q.jpg').length, show(r.ok ? r.file.info : r))
  check('D: ...it was decoded once to check it, not re-encoded, and given a thumbnail', tools.calls.decodedSize === 1 && tools.calls.reencode === 0 && tools.calls.thumbnail === 1 && /^data:image\/png;base64,/.test(r.file.thumbnail) && r.file.firstLines === null)
  r = prepare({ bytes: jpegWith([APP.exif(1, { secret: 'GPS-HOME' }), APP.comment('who took it')]), name: 'p.jpg' }, tools)
  check('D: a JPEG with EXIF and a comment: kept without them, "metadata removed", the id is the hash of what is kept', ok(r) && !r.bytes.includes(latin('GPS-HOME')) && r.file.info.changes.metadataRemoved && r.file.info.id === sha256(r.bytes) && r.bytes.equals(fixture('q.jpg')))
  tools.calls.reencode = 0
  r = prepare({ bytes: jpegWith([APP.exif(6, { secret: 'GPS-SIDEWAYS' })]), name: 'side.jpg' }, tools)
  check('D: a photo recorded as held sideways (orientation 6) is re-encoded turned: 32 x 64, "turned", not "made smaller", no EXIF left', ok(r) && tools.calls.reencode === 1 && tools.lastReencode.orientation === 6 && r.file.info.width === 32 && r.file.info.height === 64 && r.file.info.changes.turned && r.file.info.changes.shrunkFrom === null && r.file.info.changes.metadataRemoved && !r.bytes.includes(latin('GPS')) && !r.bytes.includes(latin('Exif')), show(r.ok ? r.file.info : r))
  r = prepare({ bytes: jpegSized(4000, 3000), name: 'big.jpg' }, tools)
  check('D: a 4000 x 3000 JPEG is made smaller to 2000 x 1500, and says from what', ok(r) && r.file.info.width === 2000 && r.file.info.height === 1500 && same(r.file.info.changes.shrunkFrom, { width: 4000, height: 3000 }) && tools.lastReencode.maxEdge === LIMITS.sendLongEdge && tools.lastReencode.maxBytes === LIMITS.maxImageBytes, show(r.ok ? r.file.info : r))
  r = prepare({ bytes: jpegWith([APP.exif(8)], null, jpegSized(3000, 1000)), name: 'both.jpg' }, tools)
  check('D: a 3000 x 1000 photo with orientation 8 comes out 667 x 2000: turned AND made smaller', ok(r) && r.file.info.width === 667 && r.file.info.height === 2000 && r.file.info.changes.turned && same(r.file.info.changes.shrunkFrom, { width: 3000, height: 1000 }), show(r.ok ? r.file.info : r))
  r = prepare({ bytes: jpegSized(2000, 2000), name: 'edge.jpg' }, tools)
  const atEdgeCalls = tools.calls.reencode
  check('D: 2000 x 2000 exactly is not made smaller', ok(r) && r.file.info.width === 2000 && r.file.info.changes.shrunkFrom === null)
  r = prepare({ bytes: jpegSized(2001, 10), name: 'edge.jpg' }, tools)
  check('D: 2001 x 10 is made smaller', ok(r) && r.file.info.width === 2000 && tools.calls.reencode === atEdgeCalls + 1)
  // the header is looked at BEFORE anything decodes
  const callsBefore = { ...tools.calls }
  const refusedBig = [[pngHeaderOnly(8001, 10), '8,001 x 10'], [pngHeaderOnly(10, 8001), '10 x 8,001'], [pngHeaderOnly(7000, 6000), '7,000 x 6,000'], [jpegSized(8001, 8001), '8,001 x 8,001']]
  const bigResults = refusedBig.map(([b]) => prepare({ bytes: b, name: 'x' }, tools))
  check('D: an image over 8,000 a side, or over 40 million pixels (7000 x 6000), is refused by its header, with its size and the caps in the sentence', bigResults.every((x, i) => !x.ok && x.why.includes(refusedBig[i][1]) && /8,000 a side and 40 million pixels/.test(x.why)), show(bigResults.map(refusal)))
  check('D: ...and NOTHING was decoded, re-encoded or thumbnailed for them (the header came first)', same(tools.calls, callsBefore), show(tools.calls))
  check('D: 8000 x 5000 (exactly 40 million) passes the header check', ok(prepare({ bytes: jpegSized(8000, 5000), name: 'x' }, tools)))
  const notDecoded = prepare({ bytes: jpegWith([jpegSegment(0xe2, latin('ICC_PROFILE BROKEN'))]), name: 'x.jpg' }, tools)
  check('D: a JPEG whose header is fine but which does not decode is refused ("could not be read as an image")', !notDecoded.ok && /could not be read as an image/.test(notDecoded.why), refusal(notDecoded))
  const badBody = makePng(10, 10, { idat: deflateSync(Buffer.alloc(30)) })
  const bodyR = prepare({ bytes: badBody, name: 'x.png' }, tools)
  check('D: a PNG whose picture is not the size its header says does not decode, and is refused', !bodyR.ok && /could not be read as an image/.test(bodyR.why), refusal(bodyR))
  const lyingTools = { ...standInTools(), decodedSize: () => ({ width: 10, height: 10 }) }
  const lie = prepare({ bytes: fixture('q.jpg'), name: 'x.jpg' }, lyingTools)
  check('D: a picture that decodes to another size than its header says is refused', !lie.ok && /not the size its header says/.test(lie.why), refusal(lie))
  // animated
  const animated = [makeGif({ frames: 2 }), makePng(4, 4, { before: [pngChunk('acTL', Buffer.alloc(8))] }), webp([vp8x({ width: 10, height: 10, flags: 0x02 }), riffChunk('ANIM', Buffer.alloc(6)), riffChunk('ANMF', Buffer.alloc(24))])]
  check('D: an animated GIF, PNG or WebP is refused: "only still images can be sent"', animated.every((b) => { const x = prepare({ bytes: b, name: 'a' }, tools); return !x.ok && /animated, and only still images can be sent/.test(x.why) }))
  // GIF and WebP go as they are
  r = prepare({ bytes: makeGif({ comment: 'GIF-SECRET' }), name: 'g.gif' }, tools)
  check('D: a GIF goes as it is, without its comment; its thumbnail is the file itself as a data URL; nothing decoded', ok(r) && !r.bytes.includes(latin('GIF-SECRET')) && r.file.info.changes.metadataRemoved && r.file.thumbnail === `data:image/gif;base64,${r.bytes.toString('base64')}` && r.file.info.mediaType === 'image/gif')
  const wideGif = makeGif({ width: 2001, height: 5 })
  const wg = prepare({ bytes: wideGif, name: 'w.gif' }, tools)
  check('D: a GIF over 2,000 pixels a side is refused (it is sent as it is), with a way out (PNG or JPEG)', !wg.ok && /2,000 pixels a side/.test(wg.why) && /PNG or JPEG/.test(wg.why), refusal(wg))
  check('D: a GIF of exactly 2,000 a side is taken', ok(prepare({ bytes: makeGif({ width: 2000, height: 5 }), name: 'w.gif' }, tools)))
  const bigGif = Buffer.concat([makeGif().subarray(0, -1), Buffer.from([0x21, 0xfe]), ...Array.from({ length: Math.ceil((LIMITS.maxImageBytes + 10) / 256) }, () => Buffer.concat([Buffer.from([255]), Buffer.alloc(255, 0x41)])), Buffer.from([0, 0x3b])])
  const bg = prepare({ bytes: bigGif, name: 'big.gif' }, tools)
  check('D: a GIF over 5 MB is refused before it is read further ("sent as it is")', bigGif.length > LIMITS.maxImageBytes && !bg.ok && /at most 5 MB/.test(bg.why), refusal(bg))
  const vp8 = webpChunksOf(fixture('lossy.webp')).find((c) => c.fourcc === 'VP8 ')
  const turnedWebp = webp([vp8x({ width: 48, height: 24, flags: 0x08 }), riffChunk('VP8 ', vp8.data), riffChunk('EXIF', exifBlock(6, { prefix: false }))])
  const tw = prepare({ bytes: turnedWebp, name: 't.webp' }, tools)
  check('D: a WebP meant to be shown turned is refused (the app cannot turn one), with a way out', !tw.ok && /meant to be shown turned/.test(tw.why) && /PNG or JPEG/.test(tw.why), refusal(tw))
  r = prepare({ bytes: fixture('alpha.webp'), name: 'a.webp' }, tools)
  check('D: a real WebP is taken as it is (kept byte for byte)', ok(r) && r.bytes.equals(fixture('alpha.webp')) && r.file.info.width === 48 && !r.file.info.changes.metadataRemoved)
  // what the image tools make is checked again
  const misbehaviours = ['null', 'too-big-edge', 'wrong-type', 'still-turned', 'over-bytes', 'not-turned', 'bigger']
  const mis = misbehaviours.map((m) => { const t = standInTools(); t.misbehave = m; return prepare({ bytes: jpegWith([APP.exif(6)], null, jpegSized(m === 'bigger' ? 1000 : 4000, m === 'bigger' ? 2400 : 3000)), name: 'm.jpg' }, t) })
  check('D: what the image tools make is checked like a new file and against what was asked: nothing, too big a side, the wrong type, still marked "turn me", over 5 MB, not turned (the wrong shape), larger than the original: each refused', mis.every((x) => !x.ok && /could not be made smaller|too large, even when made smaller/.test(x.why)), show(mis.map(refusal)))
  const leaky = standInTools()
  leaky.misbehave = 'with-metadata'
  const lk = prepare({ bytes: jpegSized(4000, 3000), name: 'm.jpg' }, leaky)
  check('D: metadata that the image tools put back in is taken out again (what is kept has none)', ok(lk) && !lk.bytes.includes(latin('LEAKED-BY-ENCODER')) && !lk.bytes.includes(latin('Exif')), show(lk.ok ? lk.file.info : refusal(lk)))
  // PNG too big in bytes but small in pixels is re-encoded
  const heavy = makePng(500, 500, { before: [pngChunk('prVt', Buffer.alloc(LIMITS.maxImageBytes + 1))] })
  const tools2 = standInTools()
  r = prepare({ bytes: heavy, name: 'h.png' }, tools2)
  check('D: a PNG of 500 x 500 that weighs over 5 MB (a private chunk) is stripped first, and then not re-encoded: it is small without it', ok(r) && tools2.calls.reencode === 0 && r.bytes.length < LIMITS.maxImageBytes && r.file.info.changes.metadataRemoved, show(r.ok ? r.file.info : r))
  const noisy = makePng(1400, 1400, { pixel: () => [Math.random() * 256, Math.random() * 256, Math.random() * 256], alpha: false })
  const tools3 = standInTools()
  r = prepare({ bytes: noisy, name: 'noise.png' }, tools3)
  check(`D: a PNG of 1400 x 1400 that weighs over 5 MB (noise: ${(noisy.length / MB).toFixed(1)} MB) is re-encoded`, noisy.length > LIMITS.maxImageBytes && ok(r) && tools3.calls.reencode === 1, show(r.ok ? r.file.info : refusal(r)))
  // size caps of the way in
  const huge = Buffer.concat([fixture('q.jpg').subarray(0, 2), Buffer.alloc(MAX_INPUT_BYTES)])
  const hr = prepare({ bytes: huge, name: 'huge.jpg' }, tools)
  check('D: anything over 20 MB is refused before its type is looked at', MAX_INPUT_BYTES === 20 * MB && !hr.ok && /larger than 20 MB/.test(hr.why), refusal(hr))
  // PDFs
  r = prepare({ bytes: fixture('three-pages.pdf'), name: 'report.pdf' }, tools)
  check('D: a PDF is kept byte for byte (its metadata too, D-037), with its pages; no thumbnail; nothing changed', ok(r) && r.bytes.equals(fixture('three-pages.pdf')) && r.file.info.kind === 'pdf' && r.file.info.pages === 3 && r.file.thumbnail === null && !r.file.info.changes.metadataRemoved)
  const p101 = prepare({ bytes: fixture('101-pages.pdf'), name: 'long.pdf' }, tools)
  check('D: a PDF of 101 pages is refused: "it has 101 pages, and a PDF may have at most 100"', !p101.ok && p101.why === 'it has 101 pages, and a PDF may have at most 100', refusal(p101))
  check('D: a PDF of exactly 100 pages is taken', ok(prepare({ bytes: makePdf(100), name: 'x.pdf' }, tools)))
  const bigPdf = Buffer.concat([makePdf(1).subarray(0, -6), Buffer.alloc(LIMITS.maxPdfBytes), latin('%%EOF\n')])
  const bp = prepare({ bytes: bigPdf, name: 'big.pdf' }, tools)
  check('D: a PDF over 10 MB is refused', !bp.ok && /a PDF may be at most 10 MB/.test(bp.why), refusal(bp))
  const ep = prepare({ bytes: makePdf(2, { encrypt: true }), name: 'locked.pdf' }, tools)
  check('D: a PDF with a password is refused, saying so', !ep.ok && /password/.test(ep.why), refusal(ep))
  // text
  r = prepare({ bytes: Buffer.from('const a = 1\nconst b = 2\nline 3\nline 4\nline 5\nline 6 is not shown\n', 'utf8'), name: 'main.ts' }, tools)
  check('D: a text file: its characters and lines, its first five lines for the chip, kind text', ok(r) && r.file.info.kind === 'text' && r.file.info.mediaType === 'text/plain' && r.file.info.lines === 7 && r.file.firstLines === 'const a = 1\nconst b = 2\nline 3\nline 4\nline 5' && r.file.thumbnail === null, show(r.ok ? r.file : r))
  const longLine = prepare({ bytes: Buffer.from('x'.repeat(500), 'utf8'), name: 'l.txt' }, tools)
  check('D: a long first line is cut on the chip (120 characters and "...")', ok(longLine) && longLine.file.firstLines === 'x'.repeat(120) + '...')
  const atCap = prepare({ bytes: Buffer.from('a'.repeat(LIMITS.maxTextChars), 'utf8'), name: 'cap.txt' }, tools)
  const overCap = prepare({ bytes: Buffer.from('a'.repeat(LIMITS.maxTextChars + 1), 'utf8'), name: 'cap.txt' }, tools)
  check('D: a text of exactly 200,000 characters is taken; 200,001 is refused, with both numbers', ok(atCap) && !overCap.ok && overCap.why === 'it has 200,001 characters, and a text file may have at most 200,000', refusal(overCap))
  const overBytes = prepare({ bytes: Buffer.alloc(LIMITS.maxTextBytes + 1, 0x61), name: 'b.txt' }, tools)
  check('D: a file that is not an image or a PDF and is over 1 MB is refused without being decoded as text', !overBytes.ok && /a text file may be at most 1 MB/.test(overBytes.why), refusal(overBytes))
  const binary = prepare({ bytes: latin('MZ\x90\0\x03\0\0\0'), name: 'setup.exe' }, tools)
  check('D: a program (or any file that is none of the kinds) is refused with the list of what can be attached', !binary.ok && binary.why === 'it is not a PNG, JPEG, GIF or WebP image, a PDF, or a text file (UTF-8)', refusal(binary))
  const empty = prepare({ bytes: Buffer.alloc(0), name: 'e.txt' }, tools)
  check('D: an empty file is refused as empty', !empty.ok && empty.why === 'it is empty')
  // a file named for one kind and made of another
  r = prepare({ bytes: fixture('q.png'), name: 'invoice.pdf' }, tools)
  check('D: what a file is comes from its bytes, never its name: a PNG named "invoice.pdf" is an image', ok(r) && r.file.info.kind === 'image' && r.file.info.mediaType === 'image/png' && r.file.info.name === 'invoice.pdf')
  r = prepare({ bytes: latin('%PDF-1.7 not really'), name: 'notes.txt' }, tools)
  check('D: text that begins "%PDF-" is taken for a PDF and must then be one (refused, it is not)', !r.ok)
  // names
  const RLO = String.fromCharCode(0x202e)
  const names = [
    ['C:\\Users\\me\\Desktop\\a.png', 'a.png'], ['/home/me/a.png', 'a.png'], ['..\\..\\secret.png', 'secret.png'], [`invoice${RLO}gnp.exe`, 'invoicegnp.exe'], ['tab\tand\nline.png', 'tab and line.png'],
    ['   ', 'image.png'], ['', 'image.png'], [null, 'image.png'], [42, 'image.png'], ['..', 'image.png'], ['folder\\', 'image.png'], [`${CJK}${SMILE}.png`, `${CJK}${SMILE}.png`],
    ['n'.repeat(300) + '.png', 'n'.repeat(200)], [SMILE.repeat(250), SMILE.repeat(200)], [`a${String.fromCharCode(0)}b.png`, 'ab.png'], [`zero${String.fromCharCode(0x200f)}width.png`, 'zerowidth.png']
  ]
  const named = names.map(([n]) => cleanFileName(n, 'image.png'))
  check('D: names: the last part only, no control or direction characters, white space as one space, 200 characters at most (an emoji not cut in half), else the fallback', named.every((n, i) => n === names[i][1]), show(named.map((n, i) => n === names[i][1] ? 'ok' : n)))
  r = prepare({ bytes: fixture('q.png'), name: undefined }, tools)
  check('D: a pasted image with no name is named by its type ("image.png")', ok(r) && r.file.info.name === 'image.png')
  check('D: isAttachmentId: 64 lower-case hex only', isAttachmentId('a'.repeat(64)) && !isAttachmentId('A'.repeat(64)) && !isAttachmentId('a'.repeat(63)) && !isAttachmentId('a'.repeat(65)) && !isAttachmentId(`${'a'.repeat(62)}..`) && !isAttachmentId(null) && !isAttachmentId(`../${'a'.repeat(61)}`))
  // factsOf: what a kept copy is
  check('D: factsOf a kept copy: an image\'s size, a PDF\'s pages, a text\'s characters; nothing for garbage', same(factsOf(fixture('q.png')), { kind: 'image', mediaType: 'image/png', width: 64, height: 32 }) && factsOf(fixture('three-pages.pdf')).pages === 3 && factsOf(latin('hi there')).chars === 8 && factsOf(latin('\0\0')) === null && factsOf(Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), latin('x')])) === null)
  // orientBitmap: the eight orientations on a 3 x 2 picture whose pixels are numbered
  const W = 3, H = 2
  const bm = Buffer.alloc(W * H * 4)
  for (let i = 0; i < W * H; i++) bm[i * 4] = i
  const grid = (o) => { const t = orientBitmap(bm, W, H, o); const rows = []; for (let y = 0; y < t.height; y++) { const row = []; for (let x = 0; x < t.width; x++) row.push(t.data[(y * t.width + x) * 4]); rows.push(row.join('')) } return rows.join('/') }
  const expected = { 1: '012/345', 2: '210/543', 3: '543/210', 4: '345/012', 5: '03/14/25', 6: '30/41/52', 7: '52/41/30', 8: '25/14/03' }
  const got = Object.fromEntries(Object.keys(expected).map((o) => [o, grid(Number(o))]))
  check('D: orientBitmap turns a picture the way each of the eight EXIF orientations says (6 = a quarter turn clockwise)', same(got, expected), show(got))
})

// ============ E. reading a file the person chose ============
await guard('E', async () => {
  const dir = join(tmpdir(), `frontier-v91-local-${randomUUID()}`)
  mkdirSync(dir, { recursive: true })
  const file = join(dir, 'photo.png')
  writeFileSync(file, fixture('q.png'))
  const r = await readLocalFile(file, MB, 'win32')
  check('E: a file on a local drive is read whole, with its name', r.ok && r.bytes.equals(fixture('q.png')) && r.name === 'photo.png', show(r))
  const refused = [
    ['\\\\server\\share\\photo.png', 'drive'], ['\\\\?\\C:\\x\\photo.png', 'drive'], ['\\\\.\\C:\\x\\photo.png', 'drive'], ['\\\\localhost\\c$\\x.png', 'drive'], ['photo.png', 'drive'], ['C:photo.png', 'drive'], ['C:/x/photo.png', 'drive'],
    [`${file}:secret`, 'drive'], ['', 'not a file'], [null, 'not a file'], [42, 'not a file'], ['C:\\' + 'x'.repeat(5000), 'not a file']
  ]
  const results = await Promise.all(refused.map(([p]) => readLocalFile(p, MB, 'win32')))
  check('E: refused without being opened: a network share, the two device forms, an admin share, a relative path, a drive-relative path, forward slashes, an alternate data stream, nothing, junk, a path over 4,096 characters', results.every((x, i) => !x.ok && x.why.includes(refused[i][1])), show(results.map((x) => x.why)))
  const folder = await readLocalFile(dir, MB, 'win32')
  check('E: a folder is refused ("not a file")', !folder.ok && /not a file/.test(folder.why))
  const missing = await readLocalFile(join(dir, 'gone.png'), MB, 'win32')
  check('E: a file that is not there is refused, plainly', !missing.ok && /not there any more/.test(missing.why))
  const empty = join(dir, 'empty.txt')
  writeFileSync(empty, '')
  check('E: an empty file is refused', !(await readLocalFile(empty, MB, 'win32')).ok)
  // a link: a junction (no special rights needed) and, if this account may make one, a symbolic link to a file
  const target = join(dir, 'real')
  mkdirSync(target)
  writeFileSync(join(target, 'inside.png'), fixture('q.png'))
  const junction = join(dir, 'junction')
  symlinkSync(target, junction, 'junction')
  const viaJunction = await readLocalFile(junction, MB, 'win32')
  check('E: a junction itself is refused as a link (not followed)', !viaJunction.ok && /link/.test(viaJunction.why), show(viaJunction))
  let fileLink = null
  try { symlinkSync(file, join(dir, 'link.png'), 'file'); fileLink = await readLocalFile(join(dir, 'link.png'), MB, 'win32') } catch { /* this account may not make symbolic links */ }
  check(`E: a symbolic link to a file is refused as a link${fileLink === null ? ' (not made: this account has no right to; the junction above is the check)' : ''}`, fileLink === null || (!fileLink.ok && /link/.test(fileLink.why)), show(fileLink))
  // the size is looked at before reading: a file over the cap is never read
  const bigFile = join(dir, 'big.bin')
  writeFileSync(bigFile, Buffer.alloc(2 * MB, 1))
  let reads = 0
  const originalOpen = fsp.open
  fsp.open = async (...args) => { const h = await originalOpen(...args); const read = h.read.bind(h); h.read = (...a) => { reads += 1; return read(...a) }; return h }
  let over
  try { over = await readLocalFile(bigFile, MB, 'win32') } finally { fsp.open = originalOpen }
  check('E: a file over the cap is refused by its size, and not one byte of it is read', !over.ok && /larger than 1 MB/.test(over.why) && reads === 0, `${show(over)} reads ${reads}`)
  const posix = await readLocalFile('/etc/passwd', MB, 'linux')
  const posixRel = await readLocalFile('etc/passwd', MB, 'linux')
  check('E: on another system a path must be absolute', !posixRel.ok && (posix.ok || /not there|could not be read|not a file/.test(posix.why)))
  await fsp.rm(dir, { recursive: true, force: true })
})

// ============ F, G: the folder, in a normal folder and in the EFS-encrypted one ============
for (const [where, base] of [['tmp', join(tmpdir(), `frontier-v91-${randomUUID()}`)], ['EFS', join(scratch('v91'), randomUUID())]].slice(0, process.env.QUICK === '1' ? 1 : 2)) {
  const T = (name) => `[${where}] ${name}`
  await guard(`F ${where}`, async () => {
    const dir = join(base, 'f', 'attachments')
    const tools = standInTools()
    const store = createAttachmentStore(dir, { images: tools })
    const a = await store.add({ bytes: jpegWith([APP.exif(1, { secret: 'HOME-GPS' })]), name: 'a.jpg' })
    const id = a.ok && a.file.info.id
    check(T('F: add keeps a copy named by its hash, with no extension, holding exactly what was kept (no metadata)'), a.ok && !a.already && readdirSync(dir).join() === id && readFileSync(join(dir, id)).equals(fixture('q.jpg')) && sha256(readFileSync(join(dir, id))) === id, show(a))
    const again = await store.add({ bytes: jpegWith([APP.comment('another comment')]), name: 'b.jpg' })
    check(T('F: the same picture with other metadata is the same copy: kept once, "already"'), again.ok && again.already && again.file.info.id === id && readdirSync(dir).length === 1)
    const read = await store.read(id)
    check(T('F: read gives the bytes back, checked against the name, and what they are'), read.ok && read.bytes.equals(fixture('q.jpg')) && read.form === 'plain' && same(read.facts, { kind: 'image', mediaType: 'image/jpeg', width: 64, height: 32 }))
    const pdf = await store.add({ bytes: fixture('three-pages.pdf'), name: 'r.pdf' })
    const txt = await store.add({ bytes: Buffer.from(`hello ${SMILE}\n`, 'utf8'), name: 'n.txt' })
    const rp = await store.read(pdf.file.info.id)
    const rt = await store.read(txt.file.info.id)
    check(T('F: a PDF and a text are kept and read back with their facts'), rp.ok && rp.facts.pages === 3 && rt.ok && rt.facts.kind === 'text' && rt.facts.text === `hello ${SMILE}\n`)
    const refusedAdd = await store.add({ bytes: makeGif({ frames: 2 }), name: 'anim.gif' })
    check(T('F: a refused file gets one sentence naming it ("anim.gif was not attached: it is animated, ..."), and nothing is written'), !refusedAdd.ok && refusedAdd.error === 'anim.gif was not attached: it is animated, and only still images can be sent.' && readdirSync(dir).length === 3, show(refusedAdd))
    check(T('F: read refuses an id that is not one (it becomes a file name)'), await (async () => { try { await store.read('../x'); return false } catch { return true } })() && await (async () => { try { await store.read('A'.repeat(64)); return false } catch { return true } })())
    const missing = await store.read('0'.repeat(64))
    check(T('F: a copy that is not there: "missing"'), !missing.ok && missing.why === 'missing' && /missing/.test(missing.error))
    // damage: one byte changed
    const copyPath = join(dir, id)
    const good = readFileSync(copyPath)
    const bad = Buffer.from(good)
    bad[100] ^= 0x01
    writeFileSync(copyPath, bad)
    const damaged = await store.read(id)
    check(T('F: a copy with one byte changed is "damaged" (its hash is not its name), never handed out'), !damaged.ok && damaged.why === 'damaged')
    const rewritten = await store.add({ bytes: fixture('q.jpg'), name: 'a.jpg' })
    check(T('F: adding the same file again writes the damaged copy anew (not "already")'), rewritten.ok && !rewritten.already && readFileSync(copyPath).equals(good) && (await store.read(id)).ok)
    // a half-written copy: the real file damaged, a whole .tmp beside it
    writeFileSync(copyPath, bad)
    writeFileSync(`${copyPath}.tmp`, good)
    const fromTmp = await store.read(id)
    check(T('F: a damaged copy with a whole ".tmp" beside it is read from the ".tmp" (written first, the same bytes)'), fromTmp.ok && fromTmp.bytes.equals(good))
    writeFileSync(`${copyPath}.tmp`, good.subarray(0, 50))
    check(T('F: ...and a cut-off ".tmp" does not make a damaged copy readable'), !(await store.read(id)).ok)
    writeFileSync(copyPath, good)
    await fsp.rm(`${copyPath}.tmp`, { force: true })
    // a file bigger than any copy may be is not read
    const hugeId = 'f'.repeat(64)
    await fsp.writeFile(join(dir, hugeId), Buffer.alloc(0))
    await fsp.truncate(join(dir, hugeId), MAX_COPY_BYTES + 1)
    let readHuge = 0
    const savedRead = fsp.readFile
    fsp.readFile = async (p, ...rest) => { if (String(p).endsWith(hugeId)) readHuge += 1; return savedRead(p, ...rest) }
    let hugeR
    try { hugeR = await store.read(hugeId) } finally { fsp.readFile = savedRead }
    check(T('F: a file in the folder bigger than any copy may be is "damaged" without being read'), !hugeR.ok && hugeR.why === 'damaged' && readHuge === 0)
    await fsp.rm(join(dir, hugeId))
    // counts
    const counts = await store.counts()
    check(T('F: counts: three copies, all plain, with their sizes'), counts.files === 3 && counts.plain === 3 && counts.encrypted === 0 && counts.bytes === good.length + fixture('three-pages.pdf').length + Buffer.byteLength(`hello ${SMILE}\n`), show(counts))

    // disk faults while a copy is written: nothing claims to be kept that is not
    const faults = [
      ['the write fails', (s) => ({ writeFile: async (p, ...r) => { if (String(p).endsWith('.tmp')) throw Object.assign(new Error('ENOSPC: no space'), { code: 'ENOSPC' }); return s.writeFile(p, ...r) } })],
      ['a byte changes silently in the write', (s) => ({ writeFile: async (p, data, ...r) => s.writeFile(p, String(p).endsWith('.tmp') ? Buffer.concat([data.subarray(0, -1), Buffer.from([data[data.length - 1] ^ 1])]) : data, ...r) })],
      ['the copy fails', (s) => ({ copyFile: async () => { throw Object.assign(new Error('EIO'), { code: 'EIO' }) } })],
      ['the copy is short', (s) => ({ copyFile: async (from, to) => s.writeFile(to, (await s.readFile(from)).subarray(0, 10)) })]
    ]
    for (const [name, patch] of faults) {
      const fdir = join(base, `fault-${name.replace(/\W+/g, '-')}`, 'attachments')
      const fstore = createAttachmentStore(fdir, { images: standInTools() })
      const result = await withFaults(patch, () => fstore.add({ bytes: fixture('q.png'), name: 'p.png' }))
      const pid = sha256(fixture('q.png'))
      const after = await fstore.read(pid)
      const left = existsSync(fdir) ? readdirSync(fdir) : []
      const tmpWhole = left.includes(`${pid}.tmp`) && readFileSync(join(fdir, `${pid}.tmp`)).equals(fixture('q.png'))
      // Either nothing was left, or the ".tmp" is whole (D-016: once the copy has begun it is kept, and reading uses it): then a read gives the right bytes.
      check(T(`F: disk fault (${name}): the add answers "could not be copied", and what is left is nothing, or a whole ".tmp" that a read uses`), !result.ok && /could not be copied into the app's data folder/.test(result.error) && (left.length === 0 || (tmpWhole && after.ok && after.bytes.equals(fixture('q.png')))), `${show(result)} left ${show(left)}`)
    }

    // the folder's caps
    const cdir = join(base, 'caps', 'attachments')
    const capped = createAttachmentStore(cdir, { images: standInTools(), folderCaps: { files: 2, bytes: 1000 } })
    const c1 = await capped.add({ bytes: fixture('q.jpg'), name: '1.jpg' })
    const c2 = await capped.add({ bytes: fixture('q.png'), name: '2.png' })
    const c3 = await capped.add({ bytes: makeGif(), name: '3.gif' })
    const c1again = await capped.add({ bytes: fixture('q.jpg'), name: '1.jpg' })
    check(T('F: the folder holds at most its number of files: the third is refused with a sentence that says nothing was deleted; the same file again is fine'), c1.ok && c2.ok && !c3.ok && /the attachments folder is full \(2 files, 0 MB\)/.test(c3.error) && /nothing is deleted for you/.test(c3.error) && c1again.ok && readdirSync(cdir).length === 2, show(c3))
    const bdir = join(base, 'caps-bytes', 'attachments')
    const cappedBytes = createAttachmentStore(bdir, { images: standInTools(), folderCaps: { files: 100, bytes: fixture('q.jpg').length + fixture('q.png').length } })
    const b1 = await cappedBytes.add({ bytes: fixture('q.jpg'), name: '1.jpg' })
    const b2 = await cappedBytes.add({ bytes: fixture('q.png'), name: '2.png' })
    const b3 = await cappedBytes.add({ bytes: makeGif(), name: '3.gif' })
    check(T('F: ...and at most its number of bytes: exactly full is fine, one file more is refused'), b1.ok && b2.ok && !b3.ok && /is full/.test(b3.error), show(b3))
    check(T('F: the real caps are 5,000 files and 2 GB'), LIMITS.folderMaxFiles === 5000 && LIMITS.folderMaxBytes === 2 * 1024 * MB)

    // hold, deleteUnused, sweep
    const hdir = join(base, 'h', 'attachments')
    let clock = Date.now()
    const hstore = createAttachmentStore(hdir, { images: standInTools(), now: () => clock })
    const x = (await hstore.add({ bytes: fixture('q.jpg'), name: 'x.jpg' })).file.info.id
    const y = (await hstore.add({ bytes: fixture('q.png'), name: 'y.png' })).file.info.id
    const z = (await hstore.add({ bytes: makeGif(), name: 'z.gif' })).file.info.id
    let del = await hstore.deleteUnused([x, y, z], new Set())
    check(T('F: deleteUnused deletes nothing that was added in this run and not released (a file on a message not sent yet)'), del.deleted === 0 && readdirSync(hdir).length === 3)
    hstore.release(x)
    hstore.release(y)
    del = await hstore.deleteUnused([x, y, z, '../evil', 'nonsense'], new Set([y]))
    check(T('F: released, x is deleted; y is used by a saved chat and kept; z is still held; ids that are not ids are ignored'), del.deleted === 1 && del.failed === 0 && !existsSync(join(hdir, x)) && existsSync(join(hdir, y)) && existsSync(join(hdir, z)))
    // a fresh store (the next start): sweep
    const leftoverTmp = join(hdir, `${'e'.repeat(64)}.tmp`)
    writeFileSync(leftoverTmp, 'half')
    writeFileSync(join(hdir, 'notes.txt'), 'not ours')
    const old = (Date.now() - 2 * 3600_000) / 1000
    for (const n of readdirSync(hdir)) utimesSync(join(hdir, n), old, old)
    const fresh = createAttachmentStore(hdir, { images: standInTools(), now: () => clock })
    const recentId = (await fresh.add({ bytes: Buffer.from('recent text', 'utf8'), name: 'r.txt' })).file.info.id
    fresh.release(recentId)
    let sw = await fresh.sweep(new Set([y]), 3600_000)
    check(T('F: sweep at start deletes what no chat uses and is older than an hour (z, a half-written ".tmp"), keeps what a chat uses (y), a file added minutes ago, and every file that is not a copy'), sw.deleted === 2 && existsSync(join(hdir, y)) && !existsSync(join(hdir, z)) && !existsSync(leftoverTmp) && existsSync(join(hdir, recentId)) && existsSync(join(hdir, 'notes.txt')), `${show(sw)} ${show(readdirSync(hdir))}`)
    clock += 2 * 3600_000
    sw = await fresh.sweep(new Set([y]), 3600_000)
    check(T('F: ...and the recent file later, once it is old enough'), sw.deleted === 1 && !existsSync(join(hdir, recentId)))
    const held = createAttachmentStore(hdir, { images: standInTools(), now: () => clock + 10 * 3600_000 })
    held.hold(y)
    sw = await held.sweep(new Set(), 3600_000)
    check(T('F: a held copy is never swept, even with no chat using it'), sw.deleted === 0 && existsSync(join(hdir, y)))
  })

  // ============ G. sealed copies ============
  await guard(`G ${where}`, async () => {
    const dir = join(base, 'g', 'attachments')
    const box = makeBox()
    let mode = { form: 'plain' }
    let writes = 0
    const store = createAttachmentStore(dir, { images: standInTools(), box, writeMode: async () => mode })
    const plainSecret = Buffer.from('My bank PIN is 4321 and this is a secret note.\n', 'utf8')
    const p = await store.add({ bytes: plainSecret, name: 'note.txt' })
    const pid = p.file.info.id
    mode = { form: 'encrypted' }
    const img = await store.add({ bytes: fixture('q.png'), name: 'q.png' })
    const iid = img.file.info.id
    const sealedBytes = readFileSync(join(dir, iid))
    check(T('G: with encryption on, a copy is written sealed: it begins with the mark, and the picture\'s bytes are not in it'), sealedBytes.subarray(0, SEALED_MAGIC.length).equals(SEALED_MAGIC) && !sealedBytes.includes(fixture('q.png').subarray(16, 40)) && sha256(sealedBytes) !== iid)
    const ri = await store.read(iid)
    check(T('G: ...and it reads back to exactly the picture, "encrypted"'), ri.ok && ri.form === 'encrypted' && ri.bytes.equals(fixture('q.png')))
    const counts = await store.counts()
    check(T('G: counts: one plain, one encrypted'), counts.plain === 1 && counts.encrypted === 1, show(counts))
    const conformed = await store.conform()
    const sealedNote = readFileSync(join(dir, pid))
    check(T('G: conform seals the plain copy: none of its words are readable on disk, and it reads back byte for byte'), conformed.changed === 1 && conformed.already === 1 && conformed.failed === 0 && !sealedNote.includes(latin('PIN')) && (await store.read(pid)).bytes.equals(plainSecret), show(conformed))
    mode = { form: 'plain' }
    const back = await store.conform()
    check(T('G: conform back to plain: every copy is byte for byte what was kept, with no ".tmp" left'), back.changed === 2 && readFileSync(join(dir, pid)).equals(plainSecret) && readFileSync(join(dir, iid)).equals(fixture('q.png')) && readdirSync(dir).length === 2, show(back))
    mode = { form: 'encrypted' }
    await store.conform()
    // refused: nothing written, nothing encrypted
    mode = { refused: 'Chats are not being saved: the key ... cannot be read.' }
    const enc0 = box.calls.encrypt
    const files0 = readdirSync(dir).map((n) => n + statSync(join(dir, n)).mtimeMs).join()
    const refused = await store.add({ bytes: makeGif(), name: 'g.gif' })
    const conf = await store.conform()
    check(T('G: while writing is refused (a lost key): an add is refused with the reason and writes nothing; conform writes nothing; the secure storage is never asked to encrypt'), !refused.ok && /nothing can be saved right now\. Chats are not being saved/.test(refused.error) && conf.changed === 0 && conf.failed === 2 && box.calls.encrypt === enc0 && readdirSync(dir).map((n) => n + statSync(join(dir, n)).mtimeMs).join() === files0, show(refused))
    // the key lost: the sealed copies are "unopened", left as they are
    const key = box.exportKey()
    box.lose()
    const lost = await store.read(iid)
    check(T('G: with the key lost, a sealed copy is "unopened" (not "damaged"), and left exactly as it was'), !lost.ok && lost.why === 'unopened' && /could not be opened with the key/.test(lost.error) && readFileSync(join(dir, iid)).subarray(0, SEALED_MAGIC.length).equals(SEALED_MAGIC))
    box.available = false
    check(T('G: with no secure storage at all, the same'), (await store.read(iid)).why === 'unopened')
    box.available = true
    box.importKey(key)
    check(T('G: the key back: it opens again'), (await store.read(iid)).ok)
    // a sealed copy changed: damaged
    const sealed = readFileSync(join(dir, iid))
    const flipped = Buffer.from(sealed)
    flipped[flipped.length - 5] ^= 1
    writeFileSync(join(dir, iid), flipped)
    const fl = await store.read(iid)
    check(T('G: a changed byte inside a sealed copy: it does not open (the secure storage says so); it is never handed out'), !fl.ok)
    writeFileSync(join(dir, iid), sealed)
    // a lying secure storage: what it hands back must hash to the name
    box.lie = true
    const liar = await store.read(iid)
    box.lie = false
    // ...and one that hands back well-formed base64 of OTHER bytes: only the hash after opening can tell.
    const realDecrypt = box.decrypt
    box.decrypt = () => fixture('q.jpg').toString('base64')
    const liar2 = await store.read(iid)
    box.decrypt = realDecrypt
    check(T('G: a secure storage that hands back something else (not base64, or the base64 of other bytes): "damaged" (checked against the name), never handed out'), !liar.ok && liar.why === 'damaged' && !liar2.ok && liar2.why === 'damaged', show(liar2))
    // a plain text that begins like a sealed copy is still read right
    mode = { form: 'plain' }
    const tricky = Buffer.concat([SEALED_MAGIC, latin('but this is plain text\n')])
    const tr = await store.add({ bytes: tricky, name: 'tricky.txt' })
    const trr = await store.read(tr.file.info.id)
    check(T('G: a plain text file that begins with the sealed mark is still read as the plain file it is (its hash is its name)'), tr.ok && trr.ok && trr.form === 'plain' && trr.bytes.equals(tricky))
    // a store with no secure storage cannot be told to seal
    const nobox = createAttachmentStore(join(base, 'g-nobox', 'attachments'), { images: standInTools(), writeMode: async () => ({ form: 'encrypted' }) })
    const nb = await nobox.add({ bytes: fixture('q.jpg'), name: 'x.jpg' })
    check(T('G: a store with no secure storage refuses to write a sealed copy (it is not written plain instead)'), !nb.ok && !existsSync(join(base, 'g-nobox', 'attachments', sha256(fixture('q.jpg')))))
    // a leftover plain .tmp beside a sealed copy is removed by conform
    mode = { form: 'encrypted' }
    await store.conform()
    writeFileSync(join(dir, `${pid}.tmp`), plainSecret)
    const lingering = await store.conform()
    check(T('G: a plain ".tmp" left beside a sealed copy is rewritten away by conform (no plain text lingers)'), !existsSync(join(dir, `${pid}.tmp`)) && lingering.changed >= 1 && !readFileSync(join(dir, pid)).includes(latin('PIN')))
  })
}

// ============ H. what the source must keep true ============
await guard('H', async () => {
  const store = source('main/attachmentStore.ts')
  const fmt = source('main/attachmentFormats.ts')
  const sh = source('shared/attachments.ts')
  check('H: the store and the format readers import nothing from Electron (checked under plain Node), and nothing renames a file (EXDEV in EFS, D-010)', !/from 'electron'/.test(store) && !/from 'electron'/.test(fmt) && !/\.rename\(/.test(store))
  check('H: the shared file imports nothing (it is bundled into the sandboxed preload)', !/^import /m.test(sh))
  check('H: the PDF reader unpacks with a cap (maxOutputLength)', /maxOutputLength/.test(fmt))
  check('H: the image tools are given only PNG and JPEG (the store never hands them a GIF or a WebP)', /const reencodable = imageType === 'image\/png' \|\| imageType === 'image\/jpeg'/.test(store) && /if \(!reencodable\) \{/.test(store))
  check('H: the Electron image tools exist and use nativeImage, and apply the orientation themselves (nativeImage does not)', /nativeImage/.test(source('main/attachmentImages.ts')) && /orientBitmap/.test(source('main/attachmentImages.ts')))
})

process.exit(check.summary() ? 0 : 1)
