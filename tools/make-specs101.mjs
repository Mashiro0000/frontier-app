// Writes the negative-control specs for slice 10.1 (the system's question before a change that lets the app spend more, D-039): one sabotage each, which
// the suites must notice.
// usage: node tools/make-specs101.mjs
//   then: node tools/check-specs.mjs                  (dry check)
//         node tools/nc-all.mjs specs101 <names...>   (verify-10-1.mjs, plain Node)
//         node tools/nc-all.mjs specs101w <names...>  (run101.mjs: the real window)
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { TOOLS } from './paths.mjs'

const R = '{{REPO}}/'
const LIM = R + 'src/shared/limits.ts', ASK = R + 'src/shared/askFirst.ts', GATE = R + 'src/main/systemQuestion.ts', FLOW = R + 'src/main/limitChanges.ts'
const BOX = R + 'src/main/backupDialogs.ts', IPC = R + 'src/main/ipc.ts', FORM = R + 'src/renderer/src/settings/LimitsForm.tsx'
const ASKFORM = R + 'src/renderer/src/settings/AskFirstSection.tsx', CSS = R + 'src/renderer/src/assets/main.css'

const s = {
  unsetSame: [LIM, "  if (current.kind === 'unset') return 'up'", "  if (current.kind === 'unset') return 'same'"],
  noneDown: [LIM, "  if (next.kind === 'none') return 'up'", "  if (next.kind === 'none') return 'down'"],
  higherSame: [LIM, "  return after > now ? 'up' : after < now ? 'down' : 'same'", "  return after > now ? 'same' : after < now ? 'down' : 'same'"],
  dailyOnly: [LIM, "  limitChange(current.daily, next.daily) === 'up' ||\n  limitChange(current.monthly, next.monthly) === 'up'", "  limitChange(current.daily, next.daily) === 'up'"],
  floats: [LIM, '  const now = Math.round(current.usd * 100)\n  const after = Math.round(next.usd * 100)', '  const now = current.usd\n  const after = next.usd'],
  neverNotLoose: [ASK, "  if (next.kind === 'never') return true", "  if (next.kind === 'never') return false"],
  higherNotLoose: [ASK, '  return Math.round(next.usd * 100) > Math.round(now * 100)', '  return false'],
  fromNeverLoose: [ASK, '  if (now === null) return false // "Never ask" already', '  if (now === null) return true // "Never ask" already'],
  gateNotOne: [GATE, "      if (asking) return 'busy'\n", ''],
  gateTruthy: [GATE, "        if ((await askPerson(owner, question)) === true) return 'yes'", "        if (await askPerson(owner, question)) return 'yes'"],
  gateThrowYes: [GATE, "        return 'failed'", "        return 'yes'"],
  gateNoRest: [GATE, '        quietUntil = now() + QUIET_AFTER_NO_MS\n', ''],
  gateRestIgnored: [GATE, "      if (now() < quietUntil) return 'resting'\n", ''],
  flowNoQuestion: [FLOW, '        if (limitsRaise(current, next)) {', '        if (false) {'],
  flowIgnoresNo: [FLOW, '    return { ok: false, cancelled: true, error: notSaved }', '    return null'],
  flowNotOneAtATime: [FLOW, '    if (gate.open()) return { ok: false, error: QUESTION_BUSY }\n    if (changing) return { ok: false, error: CHANGE_BUSY }\n', ''],
  flowSavesFirst: [FLOW, '        if (limitsRaise(current, next)) {', '        await limitsStore.save(next)\n        if (limitsRaise(current, next)) {'],
  flowAskFirstNoQuestion: [FLOW, '        if (askFirstLoosens(current, next)) {', '        if (false) {'],
  wordingShowsCurrent: [FLOW, '  const after = settingText(next)', '  const after = settingText(current)'],
  boxDefaultYes: [BOX, '    defaultId: 1,\n    cancelId: 1,', '    defaultId: 0,\n    cancelId: 1,'],
  boxCancelYes: [BOX, '    defaultId: 1,\n    cancelId: 1,', '    defaultId: 1,\n    cancelId: 0,'],
  boxAnyYes: [BOX, '  return result.response === 0\n}', '  return result.response !== undefined\n}'],
  boxNoWindow: [BOX, '\n    ? await dialog.showMessageBox(window, options)\n    : await dialog.showMessageBox(options)\n  return result.response === 0\n}', '\n    ? await dialog.showMessageBox(options)\n    : await dialog.showMessageBox(options)\n  return result.response === 0\n}'],
  ipcLimitsDirect: [IPC, '      const done = await limitChanges.setLimits(window, input)', '      const done = await (async () => {\n        await limitsStore.save(input as never)\n        return { ok: true as const }\n      })()'],
  ipcAskFirstDirect: [IPC, '      const done = await limitChanges.setAskFirst(window, input)', '      const done = await (async () => {\n        await askFirstStore.save(input as never)\n        return { ok: true as const }\n      })()'],
  ipcNoWindow: [IPC, '      const done = await limitChanges.setLimits(window, input)', '      const done = await limitChanges.setLimits(null, input)'],
  formNoHint: [FORM, '  const asksAgain = canSave && choice !== null && limitsRaise(limits, choice)', '  const asksAgain = false && limitsRaise(limits, limits)'],
  askFormNoHint: [ASKFORM, '  const asksAgain = canSave && choice !== null && askFirstLoosens(setting, choice)', '  const asksAgain = false && askFirstLoosens(setting, setting)'],
  formCancelIsError: [FORM, "        setNotice({ kind: result.cancelled ? 'ok' : 'error', text: result.error })", "        setNotice({ kind: 'error', text: result.error })"],
  usageNoWrap: [CSS, '@media (max-width: 340px) {\n  .settings-usage .settings-usage-cost {\n    white-space: normal;\n  }\n}\n', '']
}

const node = {
  'n101-unset-same': [s.unsetSame],
  'n101-none-down': [s.noneDown],
  'n101-higher-same': [s.higherSame],
  'n101-daily-only': [s.dailyOnly],
  'n101-floats': [s.floats],
  'n101-never-not-loose': [s.neverNotLoose],
  'n101-higher-not-loose': [s.higherNotLoose],
  'n101-from-never-loose': [s.fromNeverLoose],
  'n101-gate-not-one': [s.gateNotOne],
  'n101-gate-truthy': [s.gateTruthy],
  'n101-gate-throw-yes': [s.gateThrowYes],
  'n101-gate-no-rest': [s.gateNoRest],
  'n101-gate-rest-ignored': [s.gateRestIgnored],
  'n101-flow-no-question': [s.flowNoQuestion],
  'n101-flow-ignores-no': [s.flowIgnoresNo],
  'n101-flow-not-one-at-a-time': [s.flowNotOneAtATime],
  'n101-flow-saves-first': [s.flowSavesFirst],
  'n101-flow-askfirst-no-question': [s.flowAskFirstNoQuestion],
  'n101-wording-shows-current': [s.wordingShowsCurrent],
  'n101-box-default-yes': [s.boxDefaultYes],
  'n101-box-any-yes': [s.boxAnyYes],
  'n101-ipc-limits-direct': [s.ipcLimitsDirect],
  'n101-ipc-askfirst-direct': [s.ipcAskFirstDirect]
}

const win = {
  'w101-unset-same': [s.unsetSame],
  'w101-none-down': [s.noneDown],
  'w101-never-not-loose': [s.neverNotLoose],
  'w101-flow-no-question': [s.flowNoQuestion],
  'w101-flow-ignores-no': [s.flowIgnoresNo],
  'w101-flow-not-one-at-a-time': [s.flowNotOneAtATime],
  'w101-gate-no-rest': [s.gateNoRest],
  'w101-box-default-yes': [s.boxDefaultYes],
  'w101-box-cancel-yes': [s.boxCancelYes],
  'w101-box-no-window': [s.boxNoWindow],
  'w101-ipc-limits-direct': [s.ipcLimitsDirect],
  'w101-ipc-askfirst-direct': [s.ipcAskFirstDirect],
  'w101-ipc-no-window': [s.ipcNoWindow],
  'w101-form-no-hint': [s.formNoHint],
  'w101-askform-no-hint': [s.askFormNoHint],
  'w101-form-cancel-is-error': [s.formCancelIsError],
  'w101-usage-no-wrap': [s.usageNoWrap]
}

const write = (dir, specs, argv, env, timeoutMs) => {
  mkdirSync(join(TOOLS, dir), { recursive: true })
  for (const [name, edits] of Object.entries(specs)) {
    writeFileSync(join(TOOLS, dir, `${name}.json`), JSON.stringify({ label: name, edits: edits.map(([file, from, to]) => ({ file, from, to })), argv, env, ...(timeoutMs ? { timeoutMs } : {}) }, null, 2) + '\n')
  }
}
write('specs101', node, ['{{TOOLS}}/verify-10-1.mjs'], {})
write('specs101w', win, ['{{TOOLS}}/run101.mjs', 'dev'], { NO_RETRY: '1' }, 400000)
console.log(`wrote ${Object.keys(node).length} specs in specs101 and ${Object.keys(win).length} in specs101w`)
