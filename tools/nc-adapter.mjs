// Negative controls for the adapter-level suite (provider-adapter-test-5.mjs), outside the project on purpose: apply ONE sabotage
// to the provider layer at a time, run the suite, and require that it now FAILS. Every file is restored from a backup copy after
// each run and its hash is compared with the original.
import { REPO } from './paths.mjs'
import { copyFileSync, readFileSync, writeFileSync, mkdtempSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { tmpdir } from 'node:os'

const here = dirname(fileURLToPath(import.meta.url))
const SRC = `${REPO}/src/main/providers/`
const sha = (p) => createHash('sha256').update(readFileSync(p)).digest('hex').slice(0, 16)
const backups = mkdtempSync(join(tmpdir(), 'nc-adapter-'))

const sabotages = [
  ['usage: cache reads and writes swapped', 'anthropic.ts',
    "cacheReadTokens: tokenCount(fields['cache_read_input_tokens']),\n    cacheWriteTokens: tokenCount(fields['cache_creation_input_tokens']),",
    "cacheReadTokens: tokenCount(fields['cache_creation_input_tokens']),\n    cacheWriteTokens: tokenCount(fields['cache_read_input_tokens']),"],
  ['usage: output is read from the input field', 'anthropic.ts', "outputTokens: tokenCount(fields['output_tokens'])", "outputTokens: tokenCount(fields['input_tokens'])"],
  ['stream: two end events', 'anthropic.ts',
    "yield { type: 'end', end: endOf(message), usage: usage(message.usage) }",
    "yield { type: 'end', end: endOf(message), usage: usage(message.usage) }\n  yield { type: 'end', end: endOf(message), usage: usage(message.usage) }"],
  ['stream: the abort signal is not passed on', 'anthropic.ts', '{ signal: request.signal }', '{}'],
  ['listModels: the page size is not asked for', 'anthropic.ts', '{ limit: 1000 }', '{}'],
  ['listModels: stops after the first model', 'anthropic.ts', 'if (models.length >= MAX_LISTED_MODELS) break', 'if (models.length >= 1) break'],
  ['normalizeError: the request id is dropped', 'anthropic.ts', 'requestId: api?.requestID ?? null,', 'requestId: null,'],
  ['normalizeError: a 401 is called a bad request', 'anthropic.ts',
    "if (error instanceof Anthropic.AuthenticationError) return { ...facts, kind: 'auth' }",
    "if (error instanceof Anthropic.AuthenticationError) return { ...facts, kind: 'bad-request' }"],
  ['the system prompt is empty', 'request.ts', 'system: systemPromptFor(model.provider),', "system: '',"],
  ['usage: fractions are not floored', 'usage.ts', 'Math.floor(value)', 'value'],
  ['stream: the text is not passed on', 'anthropic.ts', "yield { type: 'text', text: event.delta.text }", "yield { type: 'text', text: '' }"],
  ['a cut-off reply is reported as done', 'anthropic.ts', "case 'max_tokens':\n      return { kind: 'cut-off' }", "case 'max_tokens':\n      return { kind: 'done' }"]
]

let caught = 0
for (const [name, file, from, to] of sabotages) {
  const path = SRC + file
  const backup = join(backups, file)
  copyFileSync(path, backup)
  const before = sha(path)
  const text = readFileSync(path, 'utf8')
  if (text.split(from).length - 1 !== 1) { console.log(`ABORT  ${name}: pattern not found exactly once in ${file}`); process.exit(2) }
  writeFileSync(path, text.replace(from, () => to))
  let verdict
  try {
    const run = spawnSync(process.execPath, [join(here, 'provider-adapter-test-5.mjs')], {
      env: { ...process.env, NODE_NO_WARNINGS: '1', ADAPTER_TEST_PORT: '8898' },
      encoding: 'utf8',
      timeout: 150000
    })
    const out = (run.stdout ?? '') + (run.stderr ?? '')
    const failing = out.split('\n').filter((l) => /^FAIL/.test(l)).length
    verdict = run.status === 0 ? 'NOT DETECTED' : failing > 0 ? `detected (${failing} failing check${failing > 1 ? 's' : ''})` : 'detected (the suite crashed)'
  } finally {
    copyFileSync(backup, path)
  }
  const restored = sha(path) === before
  if (!verdict.startsWith('NOT')) caught++
  console.log(`${verdict.startsWith('NOT') ? 'MISS ' : 'ok   '} ${name.padEnd(48)} -> ${verdict.padEnd(34)} (file restored: ${restored ? 'identical' : '!!! DIFFERENT'})`)
}
console.log(`\n${caught}/${sabotages.length} sabotages caught`)
process.exit(caught === sabotages.length ? 0 : 1)
