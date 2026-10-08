// Writes the negative-control specs for slice 11.6 (what a search costs, D-041): one sabotage each, which the suites must notice.
// usage: node tools/make-specs116.mjs   then: node tools/check-specs.mjs, node tools/nc-all.mjs specs116 <names...> (Node), node tools/nc-all.mjs specs116w <names...> (window)
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { TOOLS } from './paths.mjs'

const R = '{{REPO}}/src/'
const USAGE = R + 'shared/usage.ts', LEDGER = R + 'main/usageLedger.ts', CHAT = R + 'main/chat.ts', CORE = R + 'main/toolCore.ts', RT = R + 'main/replyTools.ts', REG = R + 'main/toolRegistry.ts'
const s = {
  feeNotAdded: [USAGE, '(record.search === undefined ? 0 : record.search.count * record.search.usdEach)', '0'],
  countUnbounded: [USAGE, '(search.count as number) > 20 ||', 'false ||'],
  feeUnbounded: [USAGE, '(search.usdEach as number) > 10', 'false'],
  parseDropsSearch: [USAGE, '    ...(fee === undefined ? {} : { search: fee })\n', ''],
  ledgerNoReserve: [LEDGER, ' +\n              (input.reserveUsd ?? 0)', ''],
  finishDropsSearch: [LEDGER, '          ...(outcome.search === undefined ? {} : { search: { ...outcome.search } })\n', ''],
  chatNoReserve: [CHAT, 'reserveUsd: SEARCH_FEE_USD[entry.provider]', 'reserveUsd: 0'],
  chatNoSettleFee: [CHAT, '{ count: found.searches, usdEach: SEARCH_FEE_USD[entry.provider] }', 'undefined'],
  chatNoAfford: [CHAT, '            affordable: affordableSearch,\n', ''],
  affordNoFee: [CHAT, 'costOf({ ...NO_TOKENS, input: guess }, entry.pricing) + SEARCH_FEE_USD[entry.provider]', 'costOf({ ...NO_TOKENS, input: guess }, entry.pricing)'],
  coreNoAfford: [CORE, "      if (!affordable) return refused('limit', LIMIT_TEXT, step)\n", ''],
  runtimeNoAfford: [RT, '                ...(input.affordable === undefined ? {} : { affordable: input.affordable })\n', ''],
  effectNoCost: [REG, 'Each search is billed by the provider: about one cent, on top of the usual cost of the reply.', 'Each search is billed by the provider.']
}
const node = ['feeNotAdded', 'countUnbounded', 'feeUnbounded', 'parseDropsSearch', 'ledgerNoReserve', 'finishDropsSearch', 'chatNoReserve', 'chatNoSettleFee', 'chatNoAfford', 'affordNoFee', 'coreNoAfford', 'runtimeNoAfford', 'effectNoCost']
const win = ['chatNoSettleFee', 'chatNoAfford', 'effectNoCost', 'finishDropsSearch', 'coreNoAfford']
const kebab = (n) => n.replace(/[A-Z]/g, (c) => '-' + c.toLowerCase())
const write = (dir, prefix, names, argv, env, timeoutMs) => {
  mkdirSync(join(TOOLS, dir), { recursive: true })
  for (const name of names) {
    const [file, from, to] = s[name]
    const label = `${prefix}-${kebab(name)}`
    writeFileSync(join(TOOLS, dir, `${label}.json`), JSON.stringify({ label, edits: [{ file, from, to }], argv, env, ...(timeoutMs ? { timeoutMs } : {}) }, null, 2) + '\n')
  }
}
write('specs116', 'n116', node, ['{{TOOLS}}/verify-11-6.mjs'], {})
write('specs116w', 'w116', win, ['{{TOOLS}}/run116.mjs', 'dev'], { NO_RETRY: '1' }, 600000)
console.log(`wrote ${node.length} specs in specs116 and ${win.length} in specs116w`)
