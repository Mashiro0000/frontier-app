// Writes the negative-control specs for slice 8.1 (the usage ledger, D-030): one sabotage each, which the suite must notice.
// usage: node tools/make-specs81.mjs
//   then: node tools/check-specs.mjs                 (dry check: every sabotage text is found exactly once)
//         node tools/nc-all.mjs specs81 <names...>   (plain-Node suite verify-8-1.mjs)
//         node tools/nc-all.mjs specs81w <names...>  (the real window: setup-key.mjs + verify-8-1w.mjs; opens a window per sabotage)
// Each spec backs up the file, applies its sabotage, runs the suite, and puts the file back (proved by hash).
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { TOOLS } from './paths.mjs'
import { scratch } from './drive.mjs'

const R = '{{REPO}}/'
const USAGE = R + 'src/shared/usage.ts', LEDGER = R + 'src/main/usageLedger.ts', CHAT = R + 'src/main/chat.ts', IPC = R + 'src/main/ipc.ts'
const REGISTRY_TS = R + 'src/shared/registry.ts', VALIDATE = R + 'src/shared/validate.ts', REGISTRY_JSON = R + 'registry/models.json'
const HISTORY = R + 'src/renderer/src/history/useHistory.ts', REPLY = R + 'src/renderer/src/chat/ipcReply.ts', FORMAT = R + 'src/renderer/src/settings/format.ts'

// name: [[file, from, to], ...]
const node = {
  // cost: a cache read is priced like ordinary input, a cache write too
  'n81-cache-read-at-input-price': [[USAGE, 'tokens.cacheRead * prices.cacheReadPerMTok', 'tokens.cacheRead * prices.inputPerMTok']],
  'n81-cache-write-at-input-price': [[USAGE, 'tokens.cacheWrite * prices.cacheWritePerMTok', 'tokens.cacheWrite * prices.inputPerMTok']],
  'n81-output-at-input-price': [[USAGE, 'tokens.output * prices.outputPerMTok', 'tokens.output * prices.inputPerMTok']],
  // the guess: four bytes a token (a lower guess), no framing for a message
  'n81-guess-four-bytes-a-token': [[USAGE, 'const BYTES_PER_TOKEN = 3', 'const BYTES_PER_TOKEN = 4']],
  'n81-guess-without-framing': [[USAGE, 'const TOKENS_PER_MESSAGE = 4', 'const TOKENS_PER_MESSAGE = 0']],
  // reading a line: a negative bucket passes; an unknown state passes
  'n81-reader-accepts-negative-tokens': [[USAGE, '  Number.isSafeInteger(value) &&\n  value >= 0 &&\n  value <= MAX_TOKENS_PER_BUCKET', '  Number.isSafeInteger(value) &&\n  value <= MAX_TOKENS_PER_BUCKET']],
  'n81-reader-accepts-unknown-state': [[USAGE, "if (knownState === undefined || typeof estimate !== 'boolean') return null", "if (typeof estimate !== 'boolean') return null"]],
  // sums: a refused request is counted; "today" starts the day before; the first instant of the month is left out
  'n81-sums-count-refused-requests': [[USAGE, "  if (record.state === 'rejected') return\n", '']],
  'n81-today-starts-yesterday': [[USAGE, 'return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime()', 'return new Date(date.getFullYear(), date.getMonth(), date.getDate() - 1).getTime()']],
  'n81-month-edge-excluded': [[USAGE, 'if (record.at >= monthStart) addRecord(month, record)', 'if (record.at > monthStart) addRecord(month, record)']],
  // the file: the first line of an id wins; a cut-off line is joined by the next write; the size cap is off; begin swallows a failed write; memory is not updated first
  'n81-ledger-first-line-wins': [[LEDGER, 'else records.set(record.id, record) // a later line', 'else if (!records.has(record.id)) records.set(record.id, record) // a later line']],
  'n81-ledger-no-newline-after-cut-line': [[LEDGER, 'needsNewline = last !== 0x0a', 'needsNewline = false']],
  'n81-ledger-no-size-cap': [[LEDGER, 'const start = Math.max(0, size - maxFileBytes)', 'const start = 0']],
  'n81-ledger-begin-swallows-failure': [[LEDGER, '        await append(record)\n        records.set(record.id, record)', '        await append(record).catch(() => undefined)\n        records.set(record.id, record)']],
  'n81-ledger-finish-not-in-memory-first': [[LEDGER, '        // In memory first: the sums must be right even if the disk refuses.\n        records.set(id, record)\n        try {\n          await append(record)\n          return { record, saved: true }', '        try {\n          await append(record)\n          records.set(id, record)\n          return { record, saved: true }']],
  // the registry: a cache read dearer than input is accepted; a price field is not required; a bad conversation id is accepted; the page's summary id is not checked
  'n81-registry-cache-read-dearer-allowed': [[REGISTRY_TS, 'if (cacheReadPerMTok > inputPerMTok) {', 'if (false) {']],
  'n81-registry-cache-write-not-required': [[REGISTRY_TS, "  'cacheWritePerMTok',\n", '']],
  'n81-request-bad-conversation-id-accepted': [[VALIDATE, 'if (conversationId !== undefined && !isConversationId(conversationId)) {', 'if (false) {']],
  'n81-usage-chat-id-not-checked': [[VALIDATE, 'isConversationId(input) ? input : null', 'typeof input === "string" ? input : null']],
  // a line of the ledger carries an extra field (the place where message text or a key could get in)
  'n81-ledger-line-extra-field': [[USAGE, 'JSON.stringify({ ...record, costUsd: costOfRecord(record) })', "JSON.stringify({ ...record, costUsd: costOfRecord(record), note: record.model })"]],
  // the data: a cache price in the registry file is wrong (Opus: a cache read at 0.4 instead of 0.2)
  'n81-registry-file-wrong-cache-price': [[REGISTRY_JSON, '"cacheReadPerMTok": 0.2,\n        "cacheWritePerMTok": 5,\n        "outputPerMTok": 20', '"cacheReadPerMTok": 0.4,\n        "cacheWritePerMTok": 5,\n        "outputPerMTok": 20']]
}

const win = {
  // a request the provider turned away at once is counted as a guess
  'w81-refused-counted-as-failed': [[CHAT, "REFUSED_BEFORE_WORK.has(failure.kind) && arrivedBytes === 0 ? 'rejected' : 'failed'", "'failed'"]],
  // a failure after text arrived is "nothing owed"
  'w81-failure-after-text-not-counted': [[CHAT, "REFUSED_BEFORE_WORK.has(failure.kind) && arrivedBytes === 0 ? 'rejected' : 'failed'", "'rejected'"]],
  // the provider's report is ignored (everything is a guess)
  'w81-report-ignored': [[CHAT, 'const report = real !== null && !tokensAreEmpty(tokensOf(real)) ? tokensOf(real) : null', 'const report = null']],
  // a guess is not marked as one
  // 9.6: Settings shows the sums of its last opening until main answers (the reset taken out)
  'w81-settings-shows-old-sums': [[R + 'src/renderer/src/settings/UsageSection.tsx', '    if (open) {\n      setSummary(null)\n      setError(null)\n    }\n', '']],
  'w81-guess-not-marked': [[CHAT, "estimate: state !== 'rejected' && report === null", 'estimate: false']],
  // the text that arrived is not counted in a guess; the system prompt is not counted in the input guess
  'w81-guess-output-zero': [[CHAT, 'output: estimateOutputTokens(arrived)', 'output: 0']],
  // (9.4, D-037: the guess adds the files' tokens, and the line is wrapped; the sabotage still leaves the system prompt out)
  'w81-guess-input-without-system-prompt': [[CHAT, 'estimateInputTokens(streamRequest.system, streamRequest.messages) +\n      fileTokens +', "estimateInputTokens('', streamRequest.messages) +\n      fileTokens +"]],
  // a stopped reply is not counted as stopped (the safety net in `finally` settles it as failed instead)
  'w81-stopped-not-settled': [[CHAT, "      await settle('stopped', null)\n      return", '      return']],
  // the page is not told what the reply cost
  'w81-usage-event-not-sent': [[CHAT, "send({ streamId, type: 'usage', usage: replyUsageOfAll(owed) })", 'void owed']],
  // the request goes out even when it cannot be recorded
  'w81-sent-although-not-recorded': [[CHAT, "            'Nothing was sent: what this request would use could not be recorded on this computer.'\n        })\n        return false\n      }", "            'Nothing was sent: what this request would use could not be recorded on this computer.'\n        })\n      }"]],
  // the chat is not named in the ledger: main drops it, the page does not tell it
  'w81-chat-id-dropped-by-main': [[CHAT, 'chat: request.conversationId ?? null,\n            provider: entry.provider,', 'chat: null,\n            provider: entry.provider,']],
  'w81-chat-id-not-sent-by-page': [[REPLY, '...(conversationId === null ? {} : { conversationId })', '']],
  'w81-history-does-not-tell-chat-its-id': [[HISTORY, '  useEffect(() => setConversationId(activeId), [activeId, setConversationId])\n', '']],
  // the summary hands the page's own id to the ledger
  'w81-summary-takes-page-id': [[IPC, 'ledger.summary(chatForUsage(input))', 'ledger.summary(input as string)']],
  // the ledger line carries text that was sent to the provider
  'w81-ledger-line-leaks-text': [[USAGE, 'JSON.stringify({ ...record, costUsd: costOfRecord(record) })', "JSON.stringify({ ...record, costUsd: costOfRecord(record), note: 'hello again' })"]],
  // "about" is not said
  'w81-about-not-said': [[FORMAT, "`${about ? 'about ' : ''}${formatCost(dollars)}`", '`${formatCost(dollars)}`']]
}

const nodeDir = join(TOOLS, 'specs81')
mkdirSync(nodeDir, { recursive: true })
for (const [name, edits] of Object.entries(node)) {
  writeFileSync(join(nodeDir, `${name}.json`), JSON.stringify({ label: name, edits: edits.map(([file, from, to]) => ({ file, from, to })), argv: ['{{TOOLS}}/verify-8-1.mjs'], env: {} }, null, 2) + '\n')
}
const winEnv = (name) => ({ USER_DATA_DIR: scratch('s81nc'), WIPE_USER_DATA: '1', MOCK_PORT: '8798', PRESEED_FILE: '', LOG_LABEL: `nc-${name}` })
const winArgv = ['{{TOOLS}}/run-with-app.mjs', 'dev', 'setup-key.mjs,verify-8-1w.mjs', '{{OUT}}/shots', '9222']
const wdir = join(TOOLS, 'specs81w')
mkdirSync(wdir, { recursive: true })
for (const [name, edits] of Object.entries(win)) {
  writeFileSync(join(wdir, `${name}.json`), JSON.stringify({ label: name, edits: edits.map(([file, from, to]) => ({ file, from, to })), argv: winArgv, env: winEnv(name) }, null, 2) + '\n')
}
console.log(`wrote ${Object.keys(node).length} specs in specs81 and ${Object.keys(win).length} in specs81w`)
