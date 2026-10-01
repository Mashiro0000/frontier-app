// Negative controls for the registry suite (verify-5-2.mjs), outside the project on purpose: apply ONE sabotage to
// src/shared/registry.ts at a time, run the suite, require that it now FAILS, restore the file from a backup and compare hashes.
import { REPO } from './paths.mjs'
import { copyFileSync, readFileSync, writeFileSync, mkdtempSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { tmpdir } from 'node:os'

const here = dirname(fileURLToPath(import.meta.url))
const FILE = `${REPO}/src/shared/registry.ts`
const sha = (p) => createHash('sha256').update(readFileSync(p)).digest('hex').slice(0, 16)
const backup = join(mkdtempSync(join(tmpdir(), 'nc-registry-')), 'registry.ts')

const sabotages = [
  ['effort null is accepted although levels are listed', "if (effort === null && effortLevels.length > 0) {", "if (false) {"],
  ['effort is accepted although the model lists no levels', "if (effort !== null && effortLevels.length === 0) {", "if (false) {"],
  ['effort need not be one of the model\'s levels', "if (effort !== null && !effortLevels.includes(effort)) {", "if (false) {"],
  ['a model that lists levels need not think', "if (effortLevels.length > 0 && !parsed.capabilities.reasoning) {", "if (false) {"],
  ['a level the provider does not know is accepted', "if (!isEffort(level) || !known.includes(level)) {", "if (!isEffort(level)) {"],
  ['a level may be named twice', "if (levels.includes(level))\n      return bad(", "if (false)\n      return bad("],
  ['a flag may be any value', "if (typeof value[flag] !== 'boolean') return bad(", "if (false) return bad("],
  ['capabilities may have extra or missing fields', "if (fieldProblem(value, CAPABILITY_FIELDS) !== null) {", "if (false) {"],
  ['capabilities is not a required field of an entry', "  'capabilities',\n  'effort'\n] as const", "  'effort'\n] as const"],
  ['the result shares the input\'s effortLevels (no clean copy)', "effortLevels: levels\n    }", "effortLevels: effortLevels as Effort[]\n    }"],
  ['a duplicate id across entries is accepted', "} else if (entries.some((entry) => entry.id === result.entry.id)) {", "} else if (false) {"],
  ['schema version is not checked', "if (input.schemaVersion !== REGISTRY_SCHEMA_VERSION) {", "if (false) {"],
  ['the effort word is not checked at all', "if (effort !== null && !isEffort(effort)) {", "if (false) {"]
]

copyFileSync(FILE, backup)
const before = sha(FILE)
let caught = 0
for (const [name, from, to] of sabotages) {
  const text = readFileSync(FILE, 'utf8')
  if (text.split(from).length - 1 !== 1) { copyFileSync(backup, FILE); console.log(`ABORT  ${name}: pattern not found exactly once`); process.exit(2) }
  writeFileSync(FILE, text.replace(from, () => to))
  let verdict
  try {
    const run = spawnSync(process.execPath, [join(here, 'verify-5-2.mjs')], { env: { ...process.env, NODE_NO_WARNINGS: '1' }, encoding: 'utf8', timeout: 120000 })
    const out = (run.stdout ?? '') + (run.stderr ?? '')
    const failing = out.split('\n').filter((l) => /^FAIL/.test(l)).length
    verdict = run.status === 0 ? 'NOT DETECTED' : failing > 0 ? `detected (${failing} failing)` : 'detected (crashed)'
  } finally {
    copyFileSync(backup, FILE)
  }
  if (!verdict.startsWith('NOT')) caught++
  console.log(`${verdict.startsWith('NOT') ? 'MISS ' : 'ok   '} ${name.padEnd(58)} -> ${verdict}`)
}
console.log(`\n${caught}/${sabotages.length} sabotages caught; registry.ts restored: ${sha(FILE) === before ? 'identical to before' : '!!! DIFFERENT'}`)
process.exit(caught === sabotages.length && sha(FILE) === before ? 0 : 1)
