// Writes the negative-control specs for slice 9.1 (the attachment store, D-037): one sabotage each, which the suites must notice.
// usage: node tools/make-specs91.mjs
//   then: node tools/check-specs.mjs                 (dry check: every sabotage text is found exactly once)
//         node tools/nc-all.mjs specs91 <names...>   (verify-9-1.mjs, run with QUICK=1: the normal folder only)
//         node tools/nc-all.mjs specs91e <names...>  (run91.mjs: Electron's real image tools, no window)
// Each spec backs up the files, applies its sabotage, runs the suite, and puts the files back (proved by hash).
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { TOOLS } from './paths.mjs'

const R = '{{REPO}}/'
const F = R + 'src/main/attachmentFormats.ts', S = R + 'src/main/attachmentStore.ts', SH = R + 'src/shared/attachments.ts', IM = R + 'src/main/attachmentImages.ts'

// name: [[file, from, to], ...]   (all run verify-9-1.mjs with QUICK=1)
const node = {
  // ---- what a file is
  'n91-sniff-pdf-anywhere': [[F, "  if (head.startsWith('%PDF-')) return 'application/pdf'", "  if (head.includes('%PDF')) return 'application/pdf'"]],
  'n91-png-no-iend-ok': [[F, '  return null // no IEND: cut off', '  return chunks']],
  'n91-png-apng-still': [[F, "    animated: chunks.some((chunk) => chunk.type === 'acTL'),", '    animated: false,']],
  'n91-gif-animated-never': [[F, '    animated: images > 1,', '    animated: false,']],
  'n91-webp-anim-flag-ignored': [[F, '    const animated = (first.data[0] & 0x02) !== 0 || animatedChunks', '    const animated = animatedChunks']],
  'n91-exif-any-tag': [[F, '    if (u16(entry) === 0x0112 && u16(entry + 2) === 3 && u32(entry + 4) === 1) {', '    if (u16(entry + 2) === 3 && u32(entry + 4) === 1) {']],
  'n91-exif-no-range': [[F, '      return value >= 1 && value <= 8 ? value : 1', '      return value']],
  'n91-jpeg-stuffing-ends-scan': [[F, '          if (next === 0x00 || (next >= 0xd0 && next <= 0xd7)) {', '          if (next === 0x00) {']],
  // ---- metadata
  'n91-jpeg-keeps-comments': [[F, "  if (marker === 0xfe) return 'drop'", "  if (marker === 0xfe) return 'keep'"]],
  'n91-jpeg-keeps-all-app': [[F, "  if (marker === 0xee && tag.startsWith('Adobe')) return 'keep'\n  return 'drop'", "  if (marker === 0xee && tag.startsWith('Adobe')) return 'keep'\n  return 'keep'"]],
  'n91-jpeg-drops-icc': [[F, "  if (marker === 0xe2 && tag.startsWith('ICC_PROFILE\\0')) return 'keep'", "  if (marker === 0xe2 && tag.startsWith('ICC_PROFILE\\0')) return 'drop'"]],
  'n91-jpeg-keeps-tail': [[F, '    bytes: removed ? Buffer.concat(parts) : bytes.subarray(0, segments.at(-1)!.end),', '    bytes: removed ? Buffer.concat([...parts, bytes.subarray(segments.at(-1)!.end)]) : bytes,']],
  'n91-jpeg-jfif-thumb-kept': [[F, "      : 'jfif-no-thumbnail'", "      : 'keep'"]],
  'n91-png-keeps-text': [[F, "  'pHYs',\n  'cICP'", "  'pHYs',\n  'cICP',\n  'tEXt',\n  'iTXt',\n  'zTXt'"]],
  'n91-png-keeps-exif': [[F, "  'pHYs',\n  'cICP'", "  'pHYs',\n  'cICP',\n  'eXIf'"]],
  'n91-gif-keeps-comments': [[F, "  const kept = parsed.blocks.filter((block) => block.kind === 'image' || block.label === 0xf9)", "  const kept = parsed.blocks.filter((block) => block.kind === 'image' || block.label !== 0xff)"]],
  'n91-webp-flags-unfixed': [[F, "    if (chunk.fourcc === 'VP8X') copy[8] &= ~(0x08 | 0x04) // no EXIF, no XMP", '    void copy[8]']],
  'n91-webp-keeps-xmp': [[F, "  const keep = new Set(['VP8X', 'VP8 ', 'VP8L', 'ALPH', 'ICCP'])", "  const keep = new Set(['VP8X', 'VP8 ', 'VP8L', 'ALPH', 'ICCP', 'XMP '])"]],
  // ---- PDFs and text
  'n91-pdf-no-eof-check': [[F, "  if (!raw.slice(-1024).includes('%%EOF'))", '  if (false as boolean)']],
  'n91-pdf-encrypt-ignored': [[F, '  if (/\\/Encrypt[\\s/<[0-9]/.test(raw))', '  if (false as boolean)']],
  'n91-pdf-no-inflate-cap': [[F, '        maxOutputLength: MAX_INFLATED_BYTES - inflated', '        maxOutputLength: 2 ** 31 - 1']],
  'n91-pdf-objects-only': [[F, '  const pages = count > 0 ? count : objects', '  const pages = objects']],
  'n91-text-controls-ok': [[F, '  if (/[\\x00-\\x08\\x0b\\x0c\\x0e-\\x1f\\x7f-\\x9f]/.test(text))', '  if (/[\\x00]/.test(text))']],
  'n91-text-empty-ok': [[F, "  if (text.trim() === '') return { ok: false, why: 'it is empty' }", '']],
  'n91-text-bom-kept': [[F, '      ? bytes.subarray(3)\n      : bytes', '      ? bytes\n      : bytes']],
  'n91-orient-6-is-8': [[F, '        case 6:\n          sx = y\n          sy = height - 1 - x', '        case 6:\n          sx = width - 1 - y\n          sy = x']],
  // ---- prepare
  'n91-prep-side-cap-off': [[S, '  if (width > L.maxImageSide || height > L.maxImageSide || width * height > L.maxImagePixels) {', '  if (width * height > L.maxImagePixels) {']],
  'n91-prep-pixel-cap-off': [[S, '  if (width > L.maxImageSide || height > L.maxImageSide || width * height > L.maxImagePixels) {', '  if (width > L.maxImageSide || height > L.maxImageSide) {']],
  'n91-prep-decode-first': [[S, '  const header = imageHeader(bytes, imageType)\n  if (!header.ok) return refuse(header.why)', '  if (imageType === \'image/png\' || imageType === \'image/jpeg\') images.decodedSize(bytes)\n  const header = imageHeader(bytes, imageType)\n  if (!header.ok) return refuse(header.why)']],
  'n91-prep-animated-ok': [[S, "  if (header.animated) return refuse('it is animated, and only still images can be sent')", '']],
  'n91-prep-no-strip': [[S, '  const stripped = stripMetadata(bytes, imageType)', '  const stripped = { bytes, removed: false }']],
  'n91-prep-gif-edge-off': [[S, '    if (Math.max(width, height) > L.sendLongEdge) {\n      return refuse(\n        `a GIF', '    if (false as boolean) {\n      return refuse(\n        `a GIF']],
  'n91-prep-gif-size-off': [[S, '  if (!reencodable && bytes.length > L.maxImageBytes) {', '  if (false as boolean) {']],
  'n91-prep-webp-turn-ok': [[S, '    if (orientation !== 1) {\n      return refuse(', '    if (false as boolean) {\n      return refuse(']],
  'n91-prep-no-decode-check': [[S, "  if (decoded === null) return refuse('it could not be read as an image')", '']],
  'n91-prep-decode-size-ignored': [[S, '  if (decoded.width !== width || decoded.height !== height) {', '  if (decoded === null) {']],
  'n91-prep-never-turn': [[S, '    Math.max(width, height) > L.sendLongEdge ||\n    orientation !== 1 ||', '    Math.max(width, height) > L.sendLongEdge ||']],
  'n91-prep-never-shrink': [[S, '  const needs =\n    Math.max(width, height) > L.sendLongEdge ||', '  const needs =\n    false ||']],
  'n91-prep-trust-tools': [[S, '      made.orientation !== 1 ||\n      Math.max(made.width, made.height) > L.sendLongEdge ||', '      false ||']],
  'n91-prep-shape-unchecked': [[S, '      Math.abs(shapeOf(made.width, made.height) - shapeOf(upright.width, upright.height)) >', '      -1 >']],
  'n91-prep-tool-meta-kept': [[S, '    kept = clean.bytes\n', '    kept = redone.bytes\n']],
  'n91-prep-pdf-pages-off': [[S, '    if (pdf.pages > L.maxPdfPages) {', '    if (false as boolean) {']],
  'n91-prep-pdf-size-off': [[S, '    if (bytes.length > L.maxPdfBytes) return refuse(`a PDF may be at most ${mb(L.maxPdfBytes)}`)', '']],
  'n91-prep-text-chars-off': [[S, '    if (text.chars > L.maxTextChars) {', '    if (false as boolean) {']],
  'n91-prep-text-bytes-off': [[S, '    if (bytes.length > L.maxTextBytes) {', '    if (false as boolean) {']],
  'n91-prep-input-cap-off': [[S, '  if (bytes.length > MAX_INPUT_BYTES) return refuse(`it is larger than ${mb(MAX_INPUT_BYTES)}`)', '']],
  'n91-prep-id-of-input': [[S, '      id: sha256(kept),', '      id: sha256(bytes),']],
  'n91-name-no-clean': [[SH, "  const clean = last.replace(/\\s+/g, ' ').replace(UNSAFE_IN_NAME, '').replace(/ +/g, ' ').trim()", '  const clean = last']],
  'n91-name-whole-path': [[SH, '  const last = input.split(/[/\\\\]/).pop() ?? \'\'', '  const last = input']],
  'n91-name-no-cap': [[SH, '    letters.length > ATTACHMENT_LIMITS.maxNameChars\n', '    letters.length > 100000\n']],
  'n91-id-uppercase-ok': [[SH, 'const ATTACHMENT_ID = /^[0-9a-f]{64}$/', 'const ATTACHMENT_ID = /^[0-9a-fA-F]{64}$/']],
  // ---- readLocalFile
  'n91-local-unc-ok': [[S, '    if (!/^[A-Za-z]:\\\\/.test(path) || path.indexOf(\':\', 2) !== -1) {', '    if (path.indexOf(\':\', 2) !== -1) {']],
  'n91-local-ads-ok': [[S, '    if (!/^[A-Za-z]:\\\\/.test(path) || path.indexOf(\':\', 2) !== -1) {', '    if (!/^[A-Za-z]:\\\\/.test(path)) {']],
  'n91-local-links-followed': [[S, "    if (link.isSymbolicLink()) return refuse('it is a link to another file')", '']],
  'n91-local-read-first': [[S, '    if (size > maxBytes) return refuse(`it is larger than ${mb(maxBytes)}`)\n', "    await handle.read(Buffer.alloc(16), 0, 16, 0)\n    if (size > maxBytes) return refuse(`it is larger than ${mb(maxBytes)}`)\n"]],
  // ---- the folder
  'n91-store-no-hash-check': [[S, "  if (sha256(data) === id) return { ok: true, bytes: data, form: 'plain' }\n  if (", "  if (!data.subarray(0, SEALED_MAGIC.length).equals(SEALED_MAGIC)) return { ok: true, bytes: data, form: 'plain' }\n  if ("]],
  'n91-store-no-readback': [[S, '    if (!proved(back)) {', '    if (false as boolean) {']],
  'n91-store-no-second-readback': [[S, "    if (!proved(await fs.readFile(file))) throw new Error('the copy could not be read back')", '']],
  'n91-store-size-unchecked': [[S, "    if (size > MAX_COPY_BYTES) return { ok: false, why: 'damaged' } // looked at before it is read: no file can fill the memory", '']],
  'n91-store-no-tmp-recovery': [[S, '    const copy = await readAt(`${file}.tmp`, id)\n    if (copy !== null && copy.ok) return copy', '    const copy = null as Opened | null']],
  'n91-store-caps-off': [[S, '        if (files + 1 > caps.files || total + sealedSize > caps.bytes) {', '        if (false as boolean) {']],
  'n91-store-damaged-already': [[S, '          there !== null &&\n          there.ok &&\n          there.form === mode.form &&\n          there.bytes.equals(prepared.bytes)\n', '          there !== null\n']],
  'n91-store-no-hold': [[S, '        held.add(info.id)\n        return { ok: true, file: prepared.file, already: false }', '        return { ok: true, file: prepared.file, already: false }']],
  'n91-store-delete-referenced': [[S, '          if (!isAttachmentId(id) || referenced.has(id) || held.has(id)) continue', '          if (!isAttachmentId(id) || held.has(id)) continue']],
  'n91-store-sweep-no-age': [[S, '          if (stat !== null && stat.isFile() && stat.mtimeMs < cutoff) ids.add(id)', '          if (stat !== null && stat.isFile()) ids.add(id)']],
  'n91-store-sweep-held': [[S, '          if (referenced.has(id) || held.has(id)) continue\n          const stat', '          if (referenced.has(id)) continue\n          const stat']],
  // ---- sealed
  'n91-seal-refusal-ignored': [[S, "        if ('refused' in mode)\n          return {", "        if (false as boolean)\n          return {"]],
  'n91-seal-always-plain': [[S, "    const data = form === 'encrypted' && box !== undefined ? seal(bytes, box) : bytes", '    const data = bytes']],
  'n91-seal-lost-is-damaged': [[S, "    return { ok: false, why: 'unopened' }\n  }\n  if (!/^[A-Za-z0-9+/]*={0,2}$/", "    return { ok: false, why: 'damaged' }\n  }\n  if (!/^[A-Za-z0-9+/]*={0,2}$/"]],
  'n91-seal-no-hash-after-open': [[S, "  return sha256(bytes) === id\n    ? { ok: true, bytes, form: 'encrypted' }", "  return true\n    ? { ok: true, bytes, form: 'encrypted' }"]],
  'n91-seal-conform-refused-writes': [[S, "            const mode = await writeMode()\n            if ('refused' in mode) return 'failed'", "            const mode0 = await writeMode()\n            const mode = 'refused' in mode0 ? { form: 'plain' as const } : mode0"]],
  'n91-seal-tmp-lingers': [[S, "            if (real !== null && real.ok && real.form === mode.form && !tmpThere) return 'already'", "            if (real !== null && real.ok && real.form === mode.form) return 'already'"]],
  // Two layers stop a plain copy written for "encrypted" with no secure storage: the explicit refusal, and the proof after the write (it must open in the
  // form asked for). Removing one alone changes nothing (by design); the control removes both.
  'n91-seal-nobox-plain': [[S, "    if (form === 'encrypted' && box === undefined) {\n      throw new Error('this store has no secure storage to encrypt with')\n    }", ''], [S, '      return opened.ok && opened.form === form && opened.bytes.equals(bytes)', '      return opened.ok && opened.bytes.equals(bytes)']]
}

// The Electron image tools (run91.mjs)
const electron = {
  'e91-no-turn': [[IM, '      if (orientation !== 1) {\n        const turned', '      if (false as boolean) {\n        const turned']],
  'e91-png-to-jpeg-always': [[IM, '              ...(opaque(bitmap)', '              ...(true']],
  'e91-no-jpeg-fallback': [[IM, '              ...(opaque(bitmap)', '              ...(false']],
  'e91-no-shrink': [[IM, '      let picture = scale < 1 ? image.resize({ width: w, height: h, quality: \'best\' }) : image', '      let picture = image']],
  'e91-thumb-full-size': [[IM, '      scale < 1\n        ? image.resize({', '      false\n        ? image.resize({']],
  'e91-decode-garbage-ok': [[IM, '  return image.isEmpty() ? null : image', '  return image']]
}

const write = (dir, specs, argv, env, timeoutMs) => {
  mkdirSync(join(TOOLS, dir), { recursive: true })
  for (const [name, edits] of Object.entries(specs)) {
    writeFileSync(join(TOOLS, dir, `${name}.json`), JSON.stringify({ label: name, edits: edits.map(([file, from, to]) => ({ file, from, to })), argv, env, ...(timeoutMs ? { timeoutMs } : {}) }, null, 2) + '\n')
  }
}
write('specs91', node, ['{{TOOLS}}/verify-9-1.mjs'], { QUICK: '1' })
write('specs91e', electron, ['{{TOOLS}}/run91.mjs'], {}, 240000)
console.log(`wrote ${Object.keys(node).length} specs in specs91 and ${Object.keys(electron).length} in specs91e`)
