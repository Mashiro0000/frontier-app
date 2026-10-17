// Writes the negative-control specs for slice 17.3 (the Gemini adapter, D-049): one sabotage each, which verify-17-3.mjs under Node (specs173) or verify-17-3w.mjs in the
// real window (specs173w) must notice.
// usage: node tools/make-specs173.mjs
//   then: FRONTIER_MAY_REMOVE=1 FRONTIER_KEEP_TEMP=1 TEMP=C:\frontier-tmp TMP=C:\frontier-tmp node tools/nc-all.mjs specs173 <names...>
//   and:  node tools/guarded-window-copy.mjs tools/nc-all.mjs specs173w <names...>      (never while Node controls run)
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { TOOLS } from './paths.mjs'

const AD = '{{REPO}}/src/main/providers/gemini.ts'
const ERR = '{{REPO}}/src/main/providers/errors.ts'
const URL_LINE = '/models/${encodeURIComponent(request.model.id)}:streamGenerateContent?alt=sse`'

// name: [ONLY, file, from, to, timeoutMs?]
const controls = {
  keyInAddress: ['A', AD, URL_LINE, '/models/${encodeURIComponent(request.model.id)}:streamGenerateContent?alt=sse&key=${request.credentials.apiKey}`'],
  thoughtsAsked: ['A', AD, 'thinkingConfig: { thinkingLevel: request.effort, includeThoughts: false }', 'thinkingConfig: { thinkingLevel: request.effort, includeThoughts: true }'],
  redirectFollowed: ['A', AD, "redirect: 'error'", "redirect: 'follow'"],
  emptyModelTurnSent: ['A', AD, "      if (message.content !== '')\n        contents.push({ role: 'model', parts: [{ text: message.content }] })", "      contents.push({ role: 'model', parts: [{ text: message.content }] })"],
  thoughtsShown: ['B', AD, "if (part['thought'] !== true && typeof part['text'] === 'string' && part['text'] !== '') {", "if (typeof part['text'] === 'string' && part['text'] !== '') {"],
  thinkingNotCounted: ['B', AD, '    outputTokens: candidates + thoughts', '    outputTokens: candidates'],
  cachedCountedTwice: ['B', AD, '    inputTokens: prompt - cacheRead + toolUse,', '    inputTokens: prompt + toolUse,'],
  usageBelieved: ['F', AD, '    value <= MAX_TOKEN_COUNT\n    ? value', '    true\n    ? value'],
  crlfOnly: ['B', AD, 'const end = /\\r?\\n\\r?\\n/.exec(buffer)', 'const end = /\\r\\n\\r\\n/.exec(buffer)'],
  charCut: ['B', AD, 'buffer += decoder.decode(chunk.value, { stream: true })', 'buffer += new TextDecoder().decode(chunk.value)'],
  blockedIgnored: ['C', AD, 'if (blocked !== null && finish === null) {', 'if (false) {'],
  noFinishIsDone: ['D', AD, 'if (finish === null) throw new ReplyEndedEarly()', "if (finish === null) finish = 'STOP'"],
  midstreamIgnored: ['D', AD, "        if ('error' in fields) {", '        if (false) {'],
  badEventSkipped: ['D', AD, "      throw new ReplyFailed('Google sent a part of the answer that could not be read')", '      return undefined'],
  keyRefusalNotAuth: ['D', AD, "      api.reason === 'API_KEY_INVALID' ||\n      /API key not valid/i.test(api.message)", '      false'],
  quotaLikeRate: ['D', AD, "    details.some((d) => String(d['@type']).endsWith('google.rpc.QuotaFailure')) ||", '    false &&'],
  noIdleClock: ['D', AD, "      dog.arm(idleMs, 'for too long in the middle of the reply')", '      void idleMs'],
  noStartClock: ['D', AD, "  dog.arm(startMs, 'within the time allowed for an answer to begin')", '  void startMs', 150000],
  authSays401: ['D', ERR, 'return `The API key was not accepted (${status ?? 401}). Check it in Settings.`', "return 'The API key was not accepted (401). Check it in Settings.'"],
  manyPages: ['E', AD, 'const MAX_LIST_PAGES = 20', 'const MAX_LIST_PAGES = 200'],
  longList: ['E', AD, 'const MAX_LISTED_MODELS = 1000', 'const MAX_LISTED_MODELS = 100000']
}

// name: [file, from, to]
const windowControls = {
  wThoughtsShown: [AD, "if (part['thought'] !== true && typeof part['text'] === 'string' && part['text'] !== '') {", "if (typeof part['text'] === 'string' && part['text'] !== '') {"],
  wKeyInAddress: [AD, URL_LINE, '/models/${encodeURIComponent(request.model.id)}:streamGenerateContent?alt=sse&key=${request.credentials.apiKey}`'],
  wNamedOpenAI: [AD, '    providerName: PROVIDER_NAMES.google,', '    providerName: PROVIDER_NAMES.openai,'],
  wThinkingNotCounted: [AD, '    outputTokens: candidates + thoughts', '    outputTokens: candidates']
}

const write = (dir, name, spec) => {
  mkdirSync(join(TOOLS, dir), { recursive: true })
  writeFileSync(join(TOOLS, dir, `${name}.json`), JSON.stringify(spec, null, 2) + '\n')
}
for (const [name, [only, file, from, to, timeoutMs]] of Object.entries(controls)) {
  write('specs173', `n173-${name}`, { label: `n173-${name}`, edits: [{ file, from, to }], argv: ['{{TOOLS}}/guarded.mjs', '{{TOOLS}}/verify-17-3.mjs'], env: { ONLY: only }, timeoutMs: timeoutMs ?? 300000 })
}
for (const [name, [file, from, to]] of Object.entries(windowControls)) {
  write('specs173w', `w173-${name}`, { label: `w173-${name}`, edits: [{ file, from, to }], argv: ['{{TOOLS}}/run173.mjs', 'dev'], env: { NO_RETRY: '1' }, timeoutMs: 1200000 })
}
console.log(`wrote ${Object.keys(controls).length} specs in specs173 and ${Object.keys(windowControls).length} in specs173w`)
