// Writes the seed files for verify-7-1c (a preferences.json whose `efforts` is stale, damaged or hostile) and a manifest saying what
// the app must do with each. Binary-safe: the manifest holds the SHA-256 of the exact bytes. Generated, not committed.
import { mkdirSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { OUT } from './paths.mjs'

const dir = pathToFileURL(join(OUT, 'seeds71') + '/')
mkdirSync(dir, { recursive: true })
const OPUS = 'claude-opus-5-5'
const HAIKU = 'claude-haiku-4-5-20251001' // no longer in the registry (removed on 2026-10-06, D-036)
const SONNET = 'claude-sonnet-5-5'
const junk = Object.fromEntries(Array.from({ length: 5000 }, (_, i) => [`m${i}`, 'low']))

// [name, bytes, model the app must show, the effort it must show (null: no Effort menu), the saved level it must warn about (or null),
//  the model the seed saved that must still be saved after a choice (or null), the model ids that must be in `efforts` once a choice
//  has replaced the file (null: no choice is made: the menu is hidden)]
const variants = [
  ['eff-good', JSON.stringify({ version: 1, modelId: OPUS, efforts: { [OPUS]: 'max', [SONNET]: 'low' } }), OPUS, 'max', null, OPUS, [OPUS, SONNET]],
  ['eff-only-efforts', JSON.stringify({ version: 1, efforts: { [OPUS]: 'high' } }), OPUS, 'high', null, null, [OPUS]],
  ['eff-level-not-offered', JSON.stringify({ version: 1, modelId: OPUS, efforts: { [OPUS]: 'none' } }), OPUS, 'medium', 'none', OPUS, [OPUS]],
  // x: 'low' is shaped like a model id and holds a real level, so it is kept (a model the registry does not list is kept, as a saved model is, D-015)
  ['eff-bad-values-keep-model', JSON.stringify({ version: 1, modelId: SONNET, efforts: { [SONNET]: 5, x: 'low', [OPUS]: 'HIGH' } }), SONNET, 'medium', null, SONNET, ['x', SONNET]],
  ['eff-not-a-map', JSON.stringify({ version: 1, modelId: SONNET, efforts: ['high'] }), SONNET, 'medium', null, SONNET, [SONNET]],
  // A saved choice of a model the registry no longer lists, with a level for it (until D-036 this seed was "Haiku, which takes no effort, has a
  // level"): the default (Opus) is shown at its own pick; a choice then saves Opus's level and keeps the saved model and its level, as D-015 keeps them.
  ['eff-retired-model-has-a-level', JSON.stringify({ version: 1, modelId: HAIKU, efforts: { [HAIKU]: 'high' } }), OPUS, 'medium', null, HAIKU, [HAIKU, OPUS]],
  // "constructor" is shaped like a model id and holds a real level: kept like any other key. "__proto__" is not shaped like one: dropped.
  ['eff-proto-keys', `{"version":1,"modelId":"${OPUS}","efforts":{"__proto__":"max","constructor":"max"}}`, OPUS, 'medium', null, OPUS, ['constructor', OPUS]],
  ['eff-thousands-of-entries', JSON.stringify({ version: 1, modelId: OPUS, efforts: { [OPUS]: 'max', ...junk } }), OPUS, 'max', null, OPUS, [OPUS, ...Array.from({ length: 199 }, (_, i) => `m${i}`)]],
  ['eff-wrong-version', JSON.stringify({ version: 2, modelId: SONNET, efforts: { [OPUS]: 'max' } }), OPUS, 'medium', null, null, [OPUS]],
  ['eff-truncated', `{"version":1,"modelId":"${SONNET}","efforts":{"${SONNET}":"hi`, OPUS, 'medium', null, null, [OPUS]]
]

const manifest = []
for (const [name, bytes, expectModel, expectEffort, warn, savedModel, keysAfter] of variants) {
  const buf = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes, 'utf8')
  writeFileSync(new URL(`${name}.json`, dir), buf)
  manifest.push({ name, file: new URL(`${name}.json`, dir).pathname.replace(/^\//, '').replaceAll('/', '\\'), expectModel, expectEffort, warn, savedModel, keysAfter, sha: createHash('sha256').update(buf).digest('hex').slice(0, 16), bytes: buf.length })
}
writeFileSync(new URL('manifest.json', dir), JSON.stringify(manifest, null, 2))
console.log(`wrote ${manifest.length} effort seed files`)
for (const m of manifest) console.log(`  ${m.name.padEnd(30)} ${String(m.bytes).padStart(8)} bytes -> expect ${m.expectModel}, effort ${m.expectEffort}${m.warn ? `  (+ warning about ${JSON.stringify(m.warn)})` : ''}`)
