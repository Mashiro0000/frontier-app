// Writes the negative-control specs for slice 17.4 (the app's tools with a Gemini model, D-049): one sabotage each, which verify-17-4.mjs under Node (specs174) or
// verify-17-4w.mjs in the real window (specs174w) must notice.
// usage: node tools/make-specs174.mjs
//   then: FRONTIER_MAY_REMOVE=1 FRONTIER_KEEP_TEMP=1 TEMP=C:\frontier-tmp TMP=C:\frontier-tmp node tools/nc-all.mjs specs174 <names...>
//   and:  node tools/guarded-window-copy.mjs tools/nc-all.mjs specs174w <names...>      (never while Node controls run)
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { TOOLS } from './paths.mjs'

const AD = '{{REPO}}/src/main/providers/gemini.ts'
const RT = '{{REPO}}/src/main/replyTools.ts'
const CHAT = '{{REPO}}/src/main/chat.ts'
const IDX = '{{REPO}}/src/main/providers/index.ts'
const OFF = '          ? { ...settings, enabled: { ...settings.enabled, web_search: false } }'
const HAND = '            ...(OFFERS_SEARCH[entry.provider]\n              ? { affordable: affordableSearch, search: countedSearch }\n              : {}),'

// name: [ONLY, file, from, to]
const controls = {
  searchStillOn: ['D', RT, OFF, '          ? settings'],
  chatAlwaysSearches: ['E', CHAT, HAND, '            ...{ affordable: affordableSearch, search: countedSearch },'],
  googleOffersSearch: ['E', IDX, '  google: false\n})', '  google: true\n})'],
  openApiParameters: ['A', AD, 'parametersJsonSchema: tool.parameters', 'parameters: tool.parameters'],
  modeAny: ['A', AD, "toolConfig: { functionCallingConfig: { mode: 'AUTO' } }", "toolConfig: { functionCallingConfig: { mode: 'ANY' } }"],
  responseWithoutId: ['C', AD, '              ...(call?.googleId === true ? { id: call.id } : {}),', ''],
  errorAsOutput: ['C', AD, 'response: result.isError ? { error: result.text } : { output: result.text }', 'response: { output: result.text }'],
  signatureDropped: ['C', AD, '      },\n      ...signature\n    }', '      }\n    }'],
  googleIdAlways: ['C', AD, "const googleId = typeof part.functionCall.id === 'string'", 'const googleId = true'],
  responseNamedById: ['C', AD, 'name: call?.name ?? result.callId,', 'name: result.callId,'],
  thoughtKept: ['C', AD, "  if (part['thought'] === true) return null\n", '']
}

// name: [file, from, to]
const windowControls = {
  wSearchStillOn: [RT, OFF, '          ? settings'],
  wGoogleOffersSearch: [IDX, '  google: false\n})', '  google: true\n})'],
  wResponseWithoutId: [AD, '              ...(call?.googleId === true ? { id: call.id } : {}),', '']
}

const write = (dir, name, spec) => {
  mkdirSync(join(TOOLS, dir), { recursive: true })
  writeFileSync(join(TOOLS, dir, `${name}.json`), JSON.stringify(spec, null, 2) + '\n')
}
for (const [name, [only, file, from, to]] of Object.entries(controls)) {
  write('specs174', `n174-${name}`, { label: `n174-${name}`, edits: [{ file, from, to }], argv: ['{{TOOLS}}/guarded.mjs', '{{TOOLS}}/verify-17-4.mjs'], env: { ONLY: only }, timeoutMs: 300000 })
}
for (const [name, [file, from, to]] of Object.entries(windowControls)) {
  write('specs174w', `w174-${name}`, { label: `w174-${name}`, edits: [{ file, from, to }], argv: ['{{TOOLS}}/run174.mjs', 'dev'], env: { NO_RETRY: '1' }, timeoutMs: 1200000 })
}
console.log(`wrote ${Object.keys(controls).length} specs in specs174 and ${Object.keys(windowControls).length} in specs174w`)
