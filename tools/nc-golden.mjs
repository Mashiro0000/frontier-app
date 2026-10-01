// Negative controls for the golden capture (outside the project on purpose): apply ONE sabotage to the new provider
// layer at a time, run the capture through it, and require that the capture now DIFFERS from the golden record of the
// untouched code. Every file is restored from a backup copy after each run and its hash is compared with the original.
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
const backups = mkdtempSync(join(tmpdir(), 'nc-golden-'))

const sabotages = [
  ['the system prompt loses a letter', 'request.ts', "Claude'", "Claud'"],
  ['the body key order changes (cache_control before system)', 'anthropic.ts', "      system: request.system,\n", "      cache_control: { type: 'ephemeral' },\n      system: request.system,\n"],
  ['the 401 sentence gains a full stop', 'errors.ts', "Check it in Settings.'", "Check it in Settings..'"],
  ['overloaded is decided by 500 instead of 529', 'anthropic.ts', 'error.status === 529', 'error.status === 500'],
  ['thinking events are passed on as text', 'anthropic.ts', "event.type === 'content_block_delta' && event.delta.type === 'text_delta'", "event.type === 'content_block_delta'"],
  ['a cut-off reply is reported as done', 'anthropic.ts', "case 'max_tokens':\n      return { kind: 'cut-off' }", "case 'max_tokens':\n      return { kind: 'done' }"],
  ['the request id is no longer appended', 'errors.ts', 'if (error.requestId) text +=', 'if (false) text +='],
  ['the key is no longer scrubbed', 'errors.ts', 'apiKey.length >= 8 ?', 'false ?'],
  ['effort is sent to every model', 'anthropic.ts', '...(model.effort ?', '...(true ?'],
  ['adjacent messages are not merged', 'request.ts', 'messages: mergeAdjacent(messages),', 'messages: [...messages],']
]

const golden = readFileSync(join(here, 'golden-5-old.json'), 'utf8')
let caught = 0
for (const [name, file, from, to] of sabotages) {
  const path = SRC + file
  const backup = join(backups, file)
  copyFileSync(path, backup)
  const before = sha(path)
  const text = readFileSync(path, 'utf8')
  if (!text.includes(from)) { console.log(`ABORT  ${name}: pattern not found in ${file}`); process.exit(2) }
  writeFileSync(path, text.replace(from, to))
  let verdict
  try {
    const run = spawnSync(process.execPath, [join(here, 'capture-golden-5.mjs')], { env: { ...process.env, IMPL: 'new', NODE_NO_WARNINGS: '1' }, encoding: 'utf8', timeout: 120000 })
    if (run.status !== 0) verdict = `the capture CRASHED (also a detection): ${(run.stderr || '').split('\n').find((l) => /Error/.test(l))?.slice(0, 120)}`
    else {
      const got = readFileSync(join(here, 'golden-5-new.json'), 'utf8').replace('"impl": "new"', '"impl": "old"')
      verdict = got === golden ? 'NOT DETECTED' : 'detected'
    }
  } finally {
    copyFileSync(backup, path)
  }
  const restored = sha(path) === before
  if (verdict !== 'NOT DETECTED') caught++
  console.log(`${verdict === 'NOT DETECTED' ? 'MISS ' : 'ok   '} ${name.padEnd(62)} -> ${verdict}   (file restored: ${restored ? 'identical' : '!!! DIFFERENT'})`)
}
console.log(`\n${caught}/${sabotages.length} sabotages caught`)
process.exit(caught === sabotages.length ? 0 : 1)
