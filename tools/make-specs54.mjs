// Writes the negative-control specs for slice 5.4: one sabotage each, which the suites must notice.
//   specs54/   for verify-5-4-store.mjs (plain Node)       node tools/nc-all.mjs specs54 <name>...
//   specs54w/  for run54.mjs / verify-5-4.mjs (real window) node tools/nc-all.mjs specs54w <name>...
// usage: node tools/make-specs54.mjs
import { mkdirSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { TOOLS } from './paths.mjs'

const V = '{{REPO}}/src/shared/validate.ts'
const S = '{{REPO}}/src/main/conversationStore.ts'
const C = '{{REPO}}/src/main/chat.ts'
const R = '{{REPO}}/src/renderer/src/'
const CONVERT = R + 'history/convert.ts'
const UTIMES = "await fs.utimes(join(dir, `${id}.json`), new Date(), new Date())" // makes reading write: the modification time moves

const store = {
  'model-length-unchecked': [V, '/^[a-z0-9][a-z0-9._-]{0,63}$/', '/^[a-z0-9][a-z0-9._-]*$/'],
  'page-is-lenient': [V, "const lenient = source === 'file'", 'const lenient = true'],
  'v1-reads-its-fields': [V, "if (source === 'file-v1') return { provider: 'anthropic', model: null }", 'if (false) return null'],
  'model-without-provider-kept': [V, "if (provider === null && model !== null) {\n    if (!lenient) return null\n    model = null\n  }", 'if (false) model = null'],
  'user-messages-get-fields': [V, "if (role === 'assistant') {\n      const answerer", 'if (true) {\n      const answerer'],
  'file-lenient-is-strict': [V, "const lenient = source === 'file'", "const lenient = source === 'file' && false"],
  'writes-version-1': [S, 'JSON.stringify({ version: 3, ...conversation })', 'JSON.stringify({ version: 1, ...conversation })'],
  'v1-not-upgraded': [S, "file.version === 1 ? 'file-v1' : 'file'", "'file'"],
  'v2-refused': [S, 'file.version !== 1 && file.version !== 2', 'file.version !== 1'],
  'any-version-accepted': [S, 'file.version !== 1 && file.version !== 2', 'false'],
  'reading-rewrites': [S, "if ('conversation' in read) {\n              index.set(id, {", `if ('conversation' in read) {\n              ${UTIMES}\n              index.set(id, {`]
}

const windowSuite = {
  'w-no-start-event': [C, "send({ streamId, type: 'start', provider: entry.provider, model: entry.id })", 'void 0'],
  'w-answerer-not-recorded': [R + 'chat/ipcReply.ts', "if (event.type === 'start') onAnswerer({ provider: event.provider, model: event.model })", "if (event.type === 'start') void 0"],
  'w-caption-always': [R + 'chat/MessageList.tsx', 'message.model !== previous ? modelName(message.model) : null', 'modelName(message.model)'],
  'w-caption-forgets-the-model': [R + 'chat/MessageList.tsx', 'previous = message.model\n', 'previous = null\n'],
  'w-model-not-read-back': [CONVERT, "...(error !== undefined ? { error } : {}),\n    ...(role === 'assistant' ? { provider: provider ?? null, model: model ?? null } : {})", '...(error !== undefined ? { error } : {})'],
  'w-model-not-sent-for-save': [CONVERT, "...(status === 'error' && error !== undefined ? { error } : {}),\n    ...(role === 'assistant' ? { provider: provider ?? null, model: model ?? null } : {})", "...(status === 'error' && error !== undefined ? { error } : {})"],
  'w-usage-not-logged': [C, 'if (usage) {', 'if (false) {'],
  'w-page-is-lenient': [V, "const lenient = source === 'file'", 'const lenient = true'],
  'w-reading-rewrites': [S, "if ('conversation' in read) {\n              index.set(id, {", `if ('conversation' in read) {\n              ${UTIMES}\n              index.set(id, {`],
  'w-v1-not-upgraded': [S, "file.version === 1 ? 'file-v1' : 'file'", "'file'"]
}

function write(folder, argv, specs) {
  const dir = join(TOOLS, folder)
  mkdirSync(dir, { recursive: true })
  for (const [name, [file, from, to]] of Object.entries(specs)) {
    writeFileSync(join(dir, `${name}.json`), JSON.stringify({ label: name, edits: [{ file, from, to }], argv, env: {} }, null, 2) + '\n')
  }
  console.log(`wrote ${readdirSync(dir).length} specs in ${folder}`)
}
write('specs54', ['{{TOOLS}}/verify-5-4-store.mjs'], store)
write('specs54w', ['{{TOOLS}}/run54.mjs'], windowSuite)
