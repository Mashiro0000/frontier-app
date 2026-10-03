// Writes the negative-control specs for slice 8.2 (the spending limits, D-031): one sabotage each, which the suite must notice.
// usage: node tools/make-specs82.mjs
//   then: node tools/check-specs.mjs                 (dry check: every sabotage text is found exactly once)
//         node tools/nc-all.mjs specs82 <names...>   (plain-Node suite verify-8-2.mjs)
//         node tools/nc-all.mjs specs82w <names...>  (the real window: setup-key.mjs + verify-8-2w.mjs on a profile with no limits; opens a window per sabotage)
// Each spec backs up the file, applies its sabotage, runs the suite, and puts the file back (proved by hash).
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { TOOLS } from './paths.mjs'
import { scratch } from './drive.mjs'

const R = '{{REPO}}/'
const LIM = R + 'src/shared/limits.ts', LEDGER = R + 'src/main/usageLedger.ts', STORE = R + 'src/main/limits.ts', CHAT = R + 'src/main/chat.ts', IPC = R + 'src/main/ipc.ts'
const APP = R + 'src/renderer/src/App.tsx', USAGE_SECTION = R + 'src/renderer/src/settings/UsageSection.tsx', FORM = R + 'src/renderer/src/settings/LimitsForm.tsx'
const DAILY_IF = "if (daily.kind === 'usd' && spend.today + spend.request > daily.usd) {"
const MONTHLY_IF = "if (monthly.kind === 'usd' && spend.month + spend.request > monthly.usd) {"
const NONE_BOTH = "{ daily: { kind: 'none' }, monthly: { kind: 'none' } }"

// name: [[file, from, to], ...]
const node = {
  // the check: a request that lands exactly on a limit is refused; a limit is ignored; the request's own input is not added
  'n82-daily-at-limit-refused': [[LIM, DAILY_IF, "if (daily.kind === 'usd' && spend.today + spend.request >= daily.usd) {"]],
  'n82-monthly-at-limit-refused': [[LIM, MONTHLY_IF, "if (monthly.kind === 'usd' && spend.month + spend.request >= monthly.usd) {"]],
  'n82-daily-ignored': [[LIM, DAILY_IF, 'if (false) {']],
  'n82-monthly-ignored': [[LIM, MONTHLY_IF, 'if (false) {']],
  'n82-request-input-not-added': [[LIM, DAILY_IF, "if (daily.kind === 'usd' && spend.today > daily.usd) {"]],
  // not chosen: allowed, or counted as chosen when only one is
  'n82-unset-allowed': [[LIM, '  if (!limitsAreSet(limits)) return LIMITS_UNSET_MESSAGE\n', '']],
  'n82-set-needs-only-daily': [[LIM, "limits.daily.kind !== 'unset' && limits.monthly.kind !== 'unset'", "limits.daily.kind !== 'unset'"]],
  // what an amount may be
  'n82-amount-zero-allowed': [[LIM, '  value > 0 &&\n', '  value >= 0 &&\n']],
  'n82-no-maximum': [[LIM, '  value <= LIMIT_MAX_USD &&\n', '']],
  'n82-text-three-decimals': [[LIM, '(?:\\.(\\d{1,2}))?', '(?:\\.(\\d{1,3}))?']],
  // what the page may hand over
  'n82-choice-keeps-extra-fields': [[LIM, "if (kind === 'none') return { kind: 'none' } // nothing else it carries is read", "if (kind === 'none') return input as LimitChoice"]],
  'n82-choice-accepts-unset': [[LIM, "if (kind === 'none') return { kind: 'none' }", "if (kind === 'none' || kind === 'unset') return { kind: 'none' }"]],
  // the file: whatever cannot be read must not count as a limit that is not there
  'n82-file-bad-field-is-none': [[LIM, "damaged = true\n    return { kind: 'unset' }", "damaged = true\n    return { kind: 'none' }"]],
  'n82-file-not-json-is-none': [[LIM, "  } catch {\n    return { limits: unsetLimits(), damaged: true }", "  } catch {\n    return { limits: " + NONE_BOTH + ", damaged: true }"]],
  'n82-store-missing-file-is-none': [[STORE, "if ((error as NodeJS.ErrnoException).code === 'ENOENT') return unsetLimits()", "if ((error as NodeJS.ErrnoException).code === 'ENOENT') return " + NONE_BOTH]],
  'n82-store-unreadable-is-unset': [[STORE, '      throw error\n    }\n    if (text.charCodeAt(0)', '      return unsetLimits()\n    }\n    if (text.charCodeAt(0)']],
  'n82-store-bom-not-stripped': [[STORE, '    if (text.charCodeAt(0) === 0xfeff) text = text.slice(1) // a byte-order mark, which some editors add\n', '']],
  'n82-store-cache-not-updated': [[STORE, '        current = back.limits\n', '']],
  // the ledger: the check skipped, its refusal ignored, run on yesterday's clock, or given a request that costs nothing
  'n82-ledger-check-skipped': [[LEDGER, '        if (check) {\n', '        if (false) {\n']],
  'n82-ledger-refusal-ignored': [[LEDGER, 'if (refusal !== null) throw new RequestRefused(refusal)', 'void refusal']],
  'n82-ledger-today-shifted': [[LEDGER, 'summarize(records.values(), null, at, unreadable)', 'summarize(records.values(), null, at - 86_400_000, unreadable)']],
  'n82-ledger-request-cost-zero': [[LEDGER, 'request: costOf({ ...NO_TOKENS, input: input.inputTokens }, input.prices)', 'request: 0']],
  // the one place a provider is called must carry the check
  'n82-chat-no-check': [[CHAT, '(spend) => checkAgainstLimits(limits, spend)', 'undefined']]
}

const win = {
  // chat.ts: the ledger's refusal is treated as a write failure; the limits are not read (everything is allowed); no check is passed
  'w82-chat-refusal-as-write-failure': [[CHAT, 'if (error instanceof RequestRefused) {', 'if (false) {']],
  'w82-chat-limits-not-read': [[CHAT, 'limits = await limitsStore.read()', 'limits = ' + NONE_BOTH]],
  'w82-chat-no-check': [[CHAT, '(spend) => checkAgainstLimits(limits, spend)', 'undefined']],
  // ipc.ts: a choice from the page is saved without being checked; the status hides that nothing is chosen
  'w82-set-limits-unchecked': [[IPC, 'const check = checkLimitsChoice(input)\n      if (!check.ok) return check\n      try {\n        await limitsStore.save(check.limits)', 'const check = { ok: true, limits: input as never }\n      try {\n        await limitsStore.save(check.limits)']],
  'w82-status-hides-unset': [[IPC, 'limits: await limitsStore.read().catch(() => unsetLimits())', 'limits: ' + NONE_BOTH]],
  // the page: the question is never asked; the amount used is not shown; the warning for "No limit" is missing; Save is on while a limit is missing
  'w82-dialog-never-opens': [[APP, 'open={needsLimits && !limitsPutOff}', 'open={false}']],
  'w82-usage-limit-not-shown': [[USAGE_SECTION, "        {limit?.kind === 'usd' && ` of ${formatMoney(limit.usd)}`}\n", '']],
  'w82-none-warning-missing': [[FORM, '{(daily.none || monthly.none) && (', '{false && (']],
  'w82-save-on-while-missing': [[FORM, 'const canSave = !busy && choice !== null && !unchanged', 'const canSave = !busy && !unchanged']]
}

const nodeDir = join(TOOLS, 'specs82')
mkdirSync(nodeDir, { recursive: true })
for (const [name, edits] of Object.entries(node)) {
  writeFileSync(join(nodeDir, `${name}.json`), JSON.stringify({ label: name, edits: edits.map(([file, from, to]) => ({ file, from, to })), argv: ['{{TOOLS}}/verify-8-2.mjs'], env: {} }, null, 2) + '\n')
}
const winEnv = (name) => ({ USER_DATA_DIR: scratch('s82nc'), WIPE_USER_DATA: '1', MOCK_PORT: '8799', PRESEED_FILE: '', PRESEED_LIMITS: 'off', LOG_LABEL: `nc-${name}` })
const winArgv = ['{{TOOLS}}/run-with-app.mjs', 'dev', 'setup-key.mjs,verify-8-2w.mjs', '{{OUT}}/shots', '9222']
const wdir = join(TOOLS, 'specs82w')
mkdirSync(wdir, { recursive: true })
for (const [name, edits] of Object.entries(win)) {
  writeFileSync(join(wdir, `${name}.json`), JSON.stringify({ label: name, edits: edits.map(([file, from, to]) => ({ file, from, to })), argv: winArgv, env: winEnv(name) }, null, 2) + '\n')
}
console.log(`wrote ${Object.keys(node).length} specs in specs82 and ${Object.keys(win).length} in specs82w`)
