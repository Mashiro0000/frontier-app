// Writes the negative-control specs for slice 17.2 (the rules of the third provider, D-049): one sabotage each, which verify-17-2.mjs under Node (specs172) or verify-17-2w.mjs in the
// real window (specs172w) must notice.
// usage: node tools/make-specs172.mjs
//   then: FRONTIER_MAY_REMOVE=1 FRONTIER_KEEP_TEMP=1 TEMP=C:\frontier-tmp TMP=C:\frontier-tmp node tools/nc-all.mjs specs172 <names...>
//   and:  node tools/guarded-window-copy.mjs tools/nc-all.mjs specs172w <names...>      (never while Node controls run)
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { TOOLS } from './paths.mjs'

const REG = '{{REPO}}/src/shared/registry.ts'
const MODELS = '{{REPO}}/registry/models.json'
const CHAT = '{{REPO}}/src/main/chat.ts'
const IPC = '{{REPO}}/src/main/ipc.ts'
const USAGE = '{{REPO}}/src/shared/usage.ts'
const REQ = '{{REPO}}/src/main/providers/request.ts'
const COPY = '{{REPO}}/src/renderer/src/settings/providerCopy.ts'

// name: [ONLY, file, from, to]
const controls = {
  dayEdgeStrict: ['C', REG, 'for (const change of entry.priceChanges) if (change.from <= day) prices = change.pricing', 'for (const change of entry.priceChanges) if (change.from < day) prices = change.pricing'],
  changesIgnored: ['C', REG, 'for (const change of entry.priceChanges) if (change.from <= day) prices = change.pricing', 'void day'],
  utcDay: ['C', REG, '  const date = new Date(at)\n  const pad', '  const date = new Date(new Date(at).toISOString().slice(0, 19))\n  const pad'],
  nextInclusive: ['C', REG, 'const next = entry.priceChanges.find((change) => change.from > day)', 'const next = entry.priceChanges.find((change) => change.from >= day)'],
  orderUnchecked: ['B', REG, 'if (last !== undefined && from <= last.from) {', 'if (last !== undefined && from < last.from) {'],
  dateUnchecked: ['B', REG, "    if (!isCalendarDate(item['from']))\n", "    if (typeof item['from'] !== 'string')\n"],
  manyChanges: ['B', REG, 'const MAX_PRICE_CHANGES = 10', 'const MAX_PRICE_CHANGES = 100'],
  changeExtraField: ['B', REG, "const PRICE_CHANGE_FIELDS = ['from', 'pricing'] as const", "const PRICE_CHANGE_FIELDS = ['from', 'pricing', 'note'] as const"],
  cachedAboveInput: ['B', REG, '  if (cacheReadPerMTok > inputPerMTok) {\n    return bad(`${where}.cacheReadPerMTok', '  if (false) {\n    return bad(`${where}.cacheReadPerMTok'],
  noPriceChangeTold: ['D', REG, '    priceChange: nextPriceChange(entry, at),', '    priceChange: null,'],
  schemaStill05: ['A', REG, "export const REGISTRY_SCHEMA_VERSION = '0.6'", "export const REGISTRY_SCHEMA_VERSION = '0.5'"],
  googleXhigh: ['A', REG, "  google: ['low', 'medium', 'high']\n}", "  google: ['low', 'medium', 'high', 'xhigh']\n}"],
  argonDateWrong: ['A', MODELS, '"from": "2026-12-01"', '"from": "2026-11-30"'],
  flashCachedCheaper: ['A', MODELS, '"inputPerMTok": 0.75,\n        "cacheReadPerMTok": 0.75,', '"inputPerMTok": 0.75,\n        "cacheReadPerMTok": 0.075,'],
  chatUnpriced: ['H', CHAT, 'const entry = pricedOn(model.entry, Date.now())', 'const entry = model.entry'],
  listIndexAsMoment: ['H', IPC, 'registry.registry.models.map((entry) => toModelOption(entry, now))', 'registry.registry.models.map((entry) => toModelOption(entry))'],
  searchFeeFree: ['G', USAGE, '  google: 0.014\n', '  google: 0\n'],
  promptSaysClaude: ['G', REQ, "  google: 'an AI assistant'", "  google: 'Claude'"]
}

// name: [STOP_AFTER, file, from, to]
const windowControls = {
  wNoGoogle: ['A', REG, "export const SUPPORTED_PROVIDERS = ['anthropic', 'openai', 'google'] as const", "export const SUPPORTED_PROVIDERS = ['anthropic', 'openai'] as const"],
  wNoChangeTold: ['A', REG, '    priceChange: nextPriceChange(entry, at),', '    priceChange: null,'],
  wWhereToCreate: ['B', COPY, "whereToCreate: 'Google AI Studio'", "whereToCreate: 'your Google account'"],
  wNoKeyNamesAnthropic: ['D', CHAT, '`No API key is saved yet. Open Settings and add your ${PROVIDER_NAMES[provider]} API key.`', '`No API key is saved yet. Open Settings and add your ${PROVIDER_NAMES.anthropic} API key.`']
}

const write = (dir, name, spec) => {
  mkdirSync(join(TOOLS, dir), { recursive: true })
  writeFileSync(join(TOOLS, dir, `${name}.json`), JSON.stringify(spec, null, 2) + '\n')
}
for (const [name, [only, file, from, to]] of Object.entries(controls)) {
  if (/\$[$&`'0-9<]/.test(to)) throw new Error(`the control ${name} is not well formed`)
  write('specs172', `n172-${name}`, { label: `n172-${name}`, edits: [{ file, from, to }], argv: ['{{TOOLS}}/guarded.mjs', '{{TOOLS}}/verify-17-2.mjs'], env: { ONLY: only }, timeoutMs: 300000 })
}
for (const [name, [stopAfter, file, from, to]] of Object.entries(windowControls)) {
  if (/\$[$&`'0-9<]/.test(to)) throw new Error(`the control ${name} is not well formed`)
  write('specs172w', `w172-${name}`, { label: `w172-${name}`, edits: [{ file, from, to }], argv: ['{{TOOLS}}/run172.mjs', 'dev'], env: { NO_RETRY: '1', STOP_AFTER: stopAfter }, timeoutMs: 900000 })
}
console.log(`wrote ${Object.keys(controls).length} specs in specs172 and ${Object.keys(windowControls).length} in specs172w`)
