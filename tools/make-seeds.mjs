// Writes the seed files for verify-3-5 (a preferences.json that is stale, corrupt or hostile) and a manifest saying what
// the app must do with each. Binary-safe: the manifest holds the SHA-256 of the exact bytes.
import { mkdirSync, writeFileSync } from 'node:fs'
import { createHash, randomBytes } from 'node:crypto'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { OUT } from './paths.mjs'

const dir = pathToFileURL(join(OUT, 'seeds') + '/')
mkdirSync(dir, { recursive: true })
const OPUS = 'claude-opus-5-5'
const FABLE = 'claude-fable-5-1'
const SONNET = 'claude-sonnet-5-5'
const HAIKU = 'claude-haiku-4-5-20251001' // removed from the registry on 2026-10-06 (D-036): a saved choice of it is now an unknown id

// [name, bytes, model the app must end up showing, id the app must warn about (or null)]
// (Until D-036 the valid choice and the ids inside the damaged files were Haiku's; they are a model the registry still lists, so each seed tests what it did.)
const variants = [
  ['valid-fable', JSON.stringify({ version: 1, modelId: FABLE }), FABLE, null],
  ['valid-extra-fields', JSON.stringify({ version: 1, modelId: SONNET, theme: 'dark', extra: [1, 2, 3] }), SONNET, null],
  ['unknown-id', JSON.stringify({ version: 1, modelId: 'claude-retired-9' }), OPUS, 'claude-retired-9'],
  ['retired-haiku', JSON.stringify({ version: 1, modelId: HAIKU }), OPUS, HAIKU],
  ['mixed-case-id', JSON.stringify({ version: 1, modelId: SONNET.toUpperCase() }), OPUS, SONNET.toUpperCase()],
  ['proto-id', JSON.stringify({ version: 1, modelId: '__proto__' }), OPUS, '__proto__'],
  ['traversal-id', JSON.stringify({ version: 1, modelId: '../../x' }), OPUS, '../../x'],
  ['corrupt-json', '{"version":1,"modelId":', OPUS, null],
  ['wrong-version', JSON.stringify({ version: 2, modelId: SONNET }), OPUS, null],
  ['no-model', JSON.stringify({ version: 1 }), OPUS, null],
  ['model-not-a-string', JSON.stringify({ version: 1, modelId: 5 }), OPUS, null],
  ['model-is-an-object', JSON.stringify({ version: 1, modelId: { id: SONNET } }), OPUS, null],
  ['empty-file', '', OPUS, null],
  ['json-array', '[1,2,3]', OPUS, null],
  ['json-null', 'null', OPUS, null],
  ['utf8-bom', Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(JSON.stringify({ version: 1, modelId: SONNET }))]), OPUS, null],
  ['five-megabytes-of-random-bytes', randomBytes(5 * 1024 * 1024), OPUS, null]
]

const manifest = []
for (const [name, bytes, expectModel, warnAbout] of variants) {
  const buf = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes, 'utf8')
  writeFileSync(new URL(`${name}.json`, dir), buf)
  manifest.push({ name, file: new URL(`${name}.json`, dir).pathname.replace(/^\//, '').replaceAll('/', '\\'), expectModel, warnAbout, sha: createHash('sha256').update(buf).digest('hex').slice(0, 16), bytes: buf.length })
}
writeFileSync(new URL('manifest.json', dir), JSON.stringify(manifest, null, 2))
console.log(`wrote ${manifest.length} seed files`)
for (const m of manifest) console.log(`  ${m.name.padEnd(32)} ${String(m.bytes).padStart(8)} bytes -> expect ${m.expectModel}${m.warnAbout ? `  (+ warning about ${JSON.stringify(m.warnAbout)})` : ''}`)
