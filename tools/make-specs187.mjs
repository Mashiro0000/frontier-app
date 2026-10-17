// Writes the negative-control specs for slice 18.7 (the release tool, D-050): one sabotage each of tools/release.mjs, which verify-18-7.mjs must notice.
// usage: node tools/make-specs187.mjs   then: node tools/nc-all.mjs specs187 <names...>
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { TOOLS } from './paths.mjs'

const RM = '{{TOOLS}}/release.mjs'
// name: [from, to]
const controls = {
  keyOverwritten: ["  if (existsSync(KEY_FILE)) fail(`a release key is already at", "  if (false) fail(`a release key is already at"],
  configKeyReplaced: ["  if (current !== '') fail(", "  if (false) fail("],
  mismatchSigned: ["  if (rawPublic(createPublicKey(privateKey)) !== publicKey) fail(", "  if (false) fail("],
  notesUncapped: ['  if (notes.length > M.MAX_NOTES_CHARS) fail(', '  if (false) fail('],
  versionUnchecked: ['  if (!M.isVersion(version)) fail(', '  if (false) fail(']
}
mkdirSync(join(TOOLS, 'specs187'), { recursive: true })
for (const [name, [from, to]] of Object.entries(controls)) {
  const spec = { label: `n187-${name}`, edits: [{ file: RM, from, to }], argv: ['{{TOOLS}}/verify-18-7.mjs'], env: {}, timeoutMs: 180000 }
  writeFileSync(join(TOOLS, 'specs187', `n187-${name}.json`), JSON.stringify(spec, null, 2) + '\n')
}
console.log(`wrote ${Object.keys(controls).length} specs in specs187`)
