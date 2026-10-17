// Writes the negative-control specs for slice 18.3 (the update manifest and its signature, D-050): one sabotage each of src/main/updateManifest.ts, which
// verify-18-3.mjs must notice.
// usage: node tools/make-specs183.mjs   then: node tools/nc-all.mjs specs183
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { TOOLS } from './paths.mjs'

const UM = '{{REPO}}/src/main/updateManifest.ts'

// name: [from, to]
const controls = {
  signatureIgnored: ['  if (!signed) return no(', '  if (false) return no('],
  keyAnyLength: ['raw.length !== 32 ||', 'raw.length < 1 ||'],
  signatureAnyLength: ['signatureBytes.length !== 64', 'signatureBytes.length < 1'],
  envelopeLoose: ["!keysAre(envelope, 'format,payload,signature')", "!('payload' in envelope)"],
  manifestLoose: ["!keysAre(raw, 'app,date,installer,notes,version')", 'false'],
  addressAny: ['if (url !== installerUrl(rules.repo, version, name))', "if (typeof url !== 'string')"],
  nameAny: ['if (name !== `${APP}-${version}-setup.exe`)', "if (typeof name !== 'string')"],
  downgradeTaken: ['if (order < 0)', 'if (order < -1)'],
  sameTaken: ['if (order === 0)', 'if (order === 2)'],
  bomTaken: ['ignoreBOM: true }).decode(bytes)', 'ignoreBOM: false }).decode(bytes)'],
  sizeUncapped: ['size > MAX_INSTALLER_BYTES', 'size > Number.MAX_VALUE'],
  checksumAny: ['!SHA256.test(sha256)', 'sha256.length === 0'],
  envelopeUncapped: ['if (bytes.length > MAX_ENVELOPE_BYTES)', 'if (bytes.length > 1e9)'],
  versionLoose: ['const VERSION = /^(0|[1-9]\\d{0,5})\\.(0|[1-9]\\d{0,5})\\.(0|[1-9]\\d{0,5})$/', 'const VERSION = /^(\\d+)\\.(\\d+)\\.(\\d+)/'],
  notesUncapped: ['notes.length > MAX_NOTES_CHARS', 'notes.length > 1e9']
}

mkdirSync(join(TOOLS, 'specs183'), { recursive: true })
for (const [name, [from, to]] of Object.entries(controls)) {
  const spec = { label: `n183-${name}`, edits: [{ file: UM, from, to }], argv: ['{{TOOLS}}/guarded.mjs', '{{TOOLS}}/verify-18-3.mjs'], env: {}, timeoutMs: 120000 }
  writeFileSync(join(TOOLS, 'specs183', `n183-${name}.json`), JSON.stringify(spec, null, 2) + '\n')
}
console.log(`wrote ${Object.keys(controls).length} specs in specs183`)
