// Negative controls for the Stage 5.3 window suite (verify-5-3.mjs), outside the project on purpose: apply ONE sabotage (it may
// touch several files) to the product, run the suite in the real window, require that it FAILS, restore every file and compare hashes.
// usage: node nc-w53.mjs [name-fragment]   (all sabotages by default)
import { REPO } from './paths.mjs'
import { copyFileSync, readFileSync, writeFileSync, mkdtempSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { tmpdir } from 'node:os'

const here = dirname(fileURLToPath(import.meta.url))
import { OUT } from './paths.mjs'
const P = (f) => `${REPO}/${f}`
const sha = (p) => createHash('sha256').update(readFileSync(p)).digest('hex').slice(0, 16)
const dir = mkdtempSync(join(tmpdir(), 'nc-w53-'))

// each sabotage: [name, [[file, from, to], ...]]
const sabotages = [
  ['"Test key" never gives up (no timeout)', [['src/main/ipc.ts', 'const TEST_KEY_TIMEOUT_MS = 20_000', 'const TEST_KEY_TIMEOUT_MS = 20_000_000']]],
  ['the header never asks for a key', [['src/renderer/src/settings/format.ts', "  if (!status) return null\n  const answering = answeringProvider(status)", "  return null\n  const answering = answeringProvider(status)"]]],
  ['a saved key is left in the field', [['src/renderer/src/settings/ProviderKeySection.tsx', "        setKeyText('') // the key now lives in the main process only\n", '']]],
  ['closing the dialog keeps what was typed (the sections are not started afresh)', [['src/renderer/src/settings/SettingsDialog.tsx', 'setSession((count) => count + 1)', 'void 0']]],
  ['clearApiKey accepts any provider, at BOTH layers (the handler and the store)', [
    ['src/main/ipc.ts', "if (!check.ok) throw new Error(check.error) // refused: nothing is deleted for a provider that is not on the list\n      await clearApiKey(check.provider)", "await clearApiKey(input as never)"],
    ['src/main/credentialStore.ts', "if (!providers.some((known) => known === provider)) throw new Error('that is not a provider')", "if (false) throw new Error('that is not a provider')"]]],
  ['setApiKey is not guarded against about:blank', [['src/main/ipc.ts', "if (!isTrustedSender(event, appUrl)) {\n        throw new Error('Blocked: this call did not come from the app window.')\n      }", "if (false) {\n        throw new Error('Blocked: this call did not come from the app window.')\n      }"]]],
  ['Test key sends a message to a model instead of listing models (it would cost money)', [['src/main/ipc.ts',
    "        const models = await adapter.listModels(\n          { apiKey, baseURL: baseUrlOverride(provider) },\n          controller.signal\n        )",
    "        const models: unknown[] = []\n        const registry = getRegistry()\n        for await (const event of adapter.stream({ credentials: { apiKey, baseURL: baseUrlOverride(provider) }, model: registry.ok ? registry.registry.defaultModel : (undefined as never), system: 's', messages: [{ role: 'user', content: 'x' }], maxOutputTokens: 16, signal: controller.signal })) models.push(event)"]]],
  ['the old credentials.json is deleted by reading it', [['src/main/credentialStore.ts', "      if (legacy && typeof legacy === 'object' && legacy.version === 1)\n        return decrypt(legacy.anthropicApiKey)", "      if (legacy && typeof legacy === 'object' && legacy.version === 1) {\n        await fs.rm(legacyFile, { force: true })\n        return decrypt(legacy.anthropicApiKey)\n      }"]]]
]

const only = process.argv[2]
let caught = 0, ran = 0
for (const [name, edits] of sabotages) {
  if (only && !name.includes(only)) continue
  ran++
  const saved = edits.map(([file], i) => { const b = join(dir, `${ran}-${i}`); copyFileSync(P(file), b); return [file, b, sha(P(file))] })
  let applied = true
  for (const [file, from, to] of edits) {
    const text = readFileSync(P(file), 'utf8')
    if (text.split(from).length - 1 !== 1) { applied = false; console.log(`ABORT  ${name}: pattern not found exactly once in ${file}`); break }
    writeFileSync(P(file), text.replace(from, () => to))
  }
  let verdict = 'ABORTED'
  try {
    if (applied) {
      const run = spawnSync(process.execPath, [join(here, 'run53.mjs'), 'dev'], { env: { ...process.env, NODE_NO_WARNINGS: '1' }, encoding: 'utf8', timeout: 420000 })
      const out = readFileSync(join(OUT, 'd-w53.out.txt'), 'utf8')
      const failing = out.split('\n').filter((l) => /^FAIL/.test(l))
      verdict = run.status === 0 ? 'NOT DETECTED' : failing.length ? `detected (${failing.length}: ${failing[0].slice(5, 90)})` : 'detected (the run crashed)'
    }
  } finally {
    for (const [file, backup] of saved) copyFileSync(backup, P(file))
  }
  const restored = saved.every(([file, , before]) => sha(P(file)) === before)
  if (applied && !verdict.startsWith('NOT')) caught++
  console.log(`${verdict.startsWith('NOT') ? 'MISS ' : applied ? 'ok   ' : 'ABORT'} ${name.slice(0, 84).padEnd(84)} -> ${verdict}   [restored: ${restored ? 'identical' : '!!! DIFFERENT'}]`)
}
console.log(`\n${caught}/${ran} sabotages caught`)
