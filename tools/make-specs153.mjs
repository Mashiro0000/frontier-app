// Writes the negative-control specs for slice 15.3 (voice: the speech-to-text adapter, D-047): one sabotage each, which verify-15-3.mjs must notice.
// usage: node tools/make-specs153.mjs
//   then: FRONTIER_MAY_REMOVE=1 FRONTIER_KEEP_TEMP=1 TEMP=C:\frontier-tmp TMP=C:\frontier-tmp node tools/nc-all.mjs specs153 <names...>
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { TOOLS } from './paths.mjs'

const AUDIO = '{{REPO}}/src/main/providers/openaiAudio.ts'
const OPENAI = '{{REPO}}/src/main/providers/openai.ts'

// name: [suite, ONLY (or null), file, from, to]
const controls = {
  aRetry: ['15-3', 'C', AUDIO, 'timeout: timeoutMs, maxRetries: 0', 'timeout: timeoutMs, maxRetries: 2'],
  aClock: ['15-3', 'C', AUDIO, 'timeout: timeoutMs, maxRetries: 0', 'timeout: 600000, maxRetries: 0'],
  aExtraField: ['15-3', 'A', AUDIO, "{ file, model: TRANSCRIBE_MODEL, response_format: 'json' }", "{ file, model: TRANSCRIBE_MODEL, response_format: 'json', prompt: 'the person said' }"],
  aFileName: ['15-3', 'A', AUDIO, "toFile(clip, 'clip.webm', { type: 'audio/webm' })", "toFile(clip, 'clip.wav', { type: 'audio/webm' })"],
  aFileType: ['15-3', 'A', AUDIO, "{ type: 'audio/webm' }", "{ type: 'audio/ogg' }"],
  aModel: ['15-3', 'A', AUDIO, "model: TRANSCRIBE_MODEL, response_format: 'json' }", "model: 'whisper-1', response_format: 'json' }"],
  aStopped: ['15-3', 'C', AUDIO, '    if (signal?.aborted === true) {', '    if (false) {'],
  aRefusedAuth: ['15-3', 'C', AUDIO, "= [\n  'auth',\n  'permission',", "= [\n  'permission',"],
  aScrub: ['15-3', 'C', AUDIO, 'describeFailure(normalized, credentials.apiKey)', "describeFailure(normalized, '')"],
  bSecondsMax: ['15-3', 'B', AUDIO, 'usage.seconds <= 3600', 'usage.seconds <= 1e12'],
  bSecondsMin: ['15-3', 'B', AUDIO, '    usage.seconds >= 0 &&\n', ''],
  bNoText: ['15-3', 'B', AUDIO, "if (!isRecord(answer) || typeof answer.text !== 'string') {", 'if (false) {'],
  dOrganization: ['15-3', 'D', OPENAI, '        organization: null,', '        organization: process.env.OPENAI_ORG_ID ?? null,'],
  dCustomHeaders: ['15-3', 'D', OPENAI, "    ['OPENAI_CUSTOM_HEADERS'],", '    [],']
}

mkdirSync(join(TOOLS, 'specs153'), { recursive: true })
for (const [name, [suite, only, file, from, to]] of Object.entries(controls)) {
  if (typeof file !== 'string' || typeof from !== 'string' || typeof to !== 'string' || /\$[$&`'0-9<]/.test(to)) throw new Error(`the control ${name} is not well formed`)
  const spec = { label: `n153-${name}`, edits: [{ file, from, to }], argv: ['{{TOOLS}}/guarded.mjs', `{{TOOLS}}/verify-${suite}.mjs`], env: only === null ? {} : { ONLY: only }, timeoutMs: 400000 }
  writeFileSync(join(TOOLS, 'specs153', `n153-${name}.json`), JSON.stringify(spec, null, 2) + '\n')
}
console.log(`wrote ${Object.keys(controls).length} specs in specs153`)
