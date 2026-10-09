// Writes the negative-control specs for slice 12.2 (the core learns the workspace, D-042): one sabotage each, which a suite must notice.
// usage: node tools/make-specs122.mjs
//   then: node tools/check-specs.mjs                   (dry check)
//         node tools/nc-all.mjs specs122 <names...>    (verify-12-2.mjs, plain Node)
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { TOOLS } from './paths.mjs'

const R = '{{REPO}}/'
const COR = R + 'src/main/toolCore.ts', REG = R + 'src/main/toolRegistry.ts', BUD = R + 'src/main/replyBudget.ts', AUD = R + 'src/shared/audit.ts', SHT = R + 'src/shared/tools.ts'
const NOT = R + 'src/shared/toolNotes.ts', RTL = R + 'src/main/replyTools.ts', CHT = R + 'src/main/chat.ts', IPC = R + 'src/main/ipc.ts'

const s = {
  // ----- the core: the reply's grant -----
  cGrantAlways: [COR, "      if (grants.get('workspace') === undefined) {", '      if (true as boolean) {'],
  cGrantNever: [COR, "      if (grants.get('workspace') === undefined) {", '      if (false as boolean) {'],
  cGrantNotKept: [COR, "        grants.set('workspace', 'granted')\n", ''],
  cGrantDeclinedNotKept: [COR, "          if (r.answer === 'no') grants.set('workspace', 'declined')\n", ''],
  cGrantDeclinedNotUsed: [COR, "      if (grants.get('workspace') === 'declined') {", "      if (false as boolean) {"],
  cGrantAnyAnswer: [COR, "          if (r.answer === 'no') grants.set('workspace', 'declined')", "          grants.set('workspace', 'declined')"],
  cGrantBeforeRecord: [COR, "        if (!r.recorded) return refused('not-recorded', NOT_RECORDED, step)\n        grants.set('workspace', 'granted')", "        grants.set('workspace', 'granted')"],
  cGrantAnswerNotChecked: [COR, "        if (r.answer !== 'yes') {\n          if (r.answer === 'no')", "        if (false as boolean) {\n          if (r.answer === 'no')"],
  cOneByOneSkipped: [COR, "      if (paths.some((p) => p.verdict.fileClass === 'one-by-one')) {", '      if (false as boolean) {'],
  cOneByOneAlways: [COR, "      if (paths.some((p) => p.verdict.fileClass === 'one-by-one')) {", '      if (true as boolean) {'],
  cOneByOneNoYes: [COR, "        if (!r.recorded) return refused('not-recorded', NOT_RECORDED, step)\n        yes = true\n      }\n      if (!yes) {", "        if (!r.recorded) return refused('not-recorded', NOT_RECORDED, step)\n      }\n      if (!yes) {"],
  cOneByOneNoDecline: [COR, "        const r = await put(workspace.questions.oneByOne(asked))\n        if (isOutcome(r)) return r\n        if (r.answer !== 'yes') return declined(r.answer)", "        const r = await put(workspace.questions.oneByOne(asked))\n        if (isOutcome(r)) return r"],
  cCoveredAsYes: [COR, "            answer: 'covered'", "            answer: 'yes'"],
  cCoveredNotRequired: [COR, "        if (!covered) return refused('not-recorded', NOT_RECORDED, step)\n", ''],
  cNoCoveredBranch: [COR, '      if (!yes) {', '      if (false as boolean) {'],
  cReplyModeOff: [COR, "    if (def.ask === 'reply') {", '    if (false as boolean) {'],
  cStopWins: [COR, "      if (answer === 'yes' && signal.aborted) answer = 'stopped' // Stop came first: the yes is not one\n", ''],
  cTooLong: [COR, "      if (question.detail.length > SHOWN_LIMIT) return refused('bad-arguments', TOO_LONG_TEXT, step)\n", ''],
  // ----- the core: the paths -----
  cWsNoGuard: [COR, '        if (workspace === undefined) return refused(\'no-workspace\', NO_WORKSPACE_TEXT, step)\n        const found', '        const found'],
  cWsRealPath: [COR, '        args[argName] = found.real', '        args[argName] = checked.args[argName]'],
  cWsVerdictIgnored: [COR, '        if (!found.ok) {', '        if (false as boolean) {'],
  cWsCodeOutside: [COR, "  outside: { code: 'outside', text: DATA_FOLDER_TEXT },", "  outside: { code: 'bad-path', text: DATA_FOLDER_TEXT },"],
  cWsCodeLink: [COR, "  link: { code: 'link', text: DATA_FOLDER_TEXT },", "  link: { code: 'outside', text: DATA_FOLDER_TEXT },"],
  cWsCodeNever: [COR, "  never: { code: 'never', text: DATA_FOLDER_TEXT },", "  never: { code: 'outside', text: DATA_FOLDER_TEXT },"],
  cWsCodeWrong: [COR, "  'not-found': { code: 'wrong-path', text: WRONG_PATH_TEXT },", "  'not-found': { code: 'bad-path', text: WRONG_PATH_TEXT },"],
  cWsTextWithPath: [COR, "  'not-found': { code: 'wrong-path', text: WRONG_PATH_TEXT },", "  'not-found': { code: 'wrong-path', text: 'not found: ' + WRONG_PATH_TEXT + ' nothing-here' },"],
  cWsAgain: [COR, 'executor(args, { signal: controller.signal, check: checkAgain, maxChars, again, why })', "executor(args, { signal: controller.signal, check: checkAgain, maxChars, again: async () => ({ ok: true, real: '', rel: [], kind: 'file', size: 0, fileClass: 'ok', note: '' }), why })"],
  cBodyInRecord: [COR, "        def.args[argName]?.kind === 'body' ? `(${String(value).length} characters)` : value", '        value'],
  // ----- the core: the counts -----
  cCountFileAsStep: [COR, '    const taken = isFile ? budget.takeFile() : budget.take()', '    const taken = budget.take()'],
  cCountStepAsFile: [COR, '    const taken = isFile ? budget.takeFile() : budget.take()', '    const taken = budget.takeFile()'],
  cFileCapRefusal: [COR, "    if (taken === 'file-cap') return refused('file-cap', fileCapText(budget.fileCaps.calls), step)\n", ''],
  cStepNumber: [COR, '    const step = budget.used().calls', '    const step = budget.used().steps'],
  cEndsFile: [COR, "  'file-cap',\n  'chars-cap'\n])", "  'chars-cap'\n])"],
  cEndsChars: [COR, "  'file-cap',\n  'chars-cap'\n])", "  'file-cap'\n])"],
  cCharsRefusal: [COR, "      return refused('chars-cap', CHARS_CAP_TEXT, step)", '      void 0'],
  cCharsEveryOp: [COR, "        return op === 'list' || op === 'read'", '        return true'],
  cCharsUsed: [COR, "      if (def.counts === 'file') budget.useChars(result.text.length)\n", ''],
  cMaxChars: [COR, "        def.counts === 'file' ? Math.min(MAX_RESULT_CHARS, budget.charsLeft()) : MAX_RESULT_CHARS", '        MAX_RESULT_CHARS'],
  cAffordableForFiles: [COR, "    if (def.counts !== 'file' && context.affordable !== undefined) {", '    if (context.affordable !== undefined) {'],
  // ----- the registry -----
  rAskCheck: [REG, "    if (def.ask !== 'each' && def.ask !== 'reply') {", '    if (false as boolean) {'],
  rCountsCheck: [REG, "    if (def.counts !== 'step' && def.counts !== 'file') {", '    if (false as boolean) {'],
  rReplyNeedsPath: [REG, "    if ((def.ask === 'reply' || def.counts === 'file') && !inWorkspace) {", '    if (false as boolean) {'],
  rBodyNeedsReply: [REG, "    if (specs.some((spec) => spec.kind === 'body') && def.ask !== 'reply') {", '    if (false as boolean) {'],
  rWorstCaseAll: [REG, "    if (def.ask === 'each' && worstCase(def) > SHOWN_LIMIT) {", '    if (worstCase(def) > SHOWN_LIMIT) {'],
  rBodyWellFormed: [REG, "      if (!value.isWellFormed()) return 'holds text that is not valid'\n", ''],
  rBodyControl: [REG, "      if (hasControlCharacter(value)) return 'holds control characters'\n", ''],
  rBodyMax: [REG, '      if (value.length === 0 || value.length > spec.max) {', '      if (value.length === 0) {'],
  rBodyLimit: [REG, '        if (!Number.isSafeInteger(spec.max) || spec.max < 1 || spec.max > MAX_BODY_ARG) {', '        if (!Number.isSafeInteger(spec.max) || spec.max < 1) {'],
  rBodyEmpty: [REG, '      if (value.length === 0 || value.length > spec.max) {', '      if (value.length > spec.max) {'],
  rWsOp: [REG, '        if (!(WORKSPACE_OPS as readonly string[]).includes(spec.op)) {', '        if (false as boolean) {'],
  rControlDelete: [REG, 'code === 127) return true', 'false) return true'],
  rControlTab: [REG, 'code < 32 && code !== 9 &&', 'code < 32 &&'],
  rControlLine: [REG, 'code !== 10 && code !== 13)', 'code !== 13)'],
  rControlCr: [REG, 'code !== 10 && code !== 13)', 'code !== 10)'],
  rCopyAsk: [REG, "    ask: def.ask === undefined ? 'each' : def.ask,", "    ask: 'each',"],
  rCopyCounts: [REG, "    counts: def.counts === undefined ? 'step' : def.counts", "    counts: 'step'"],
  rSchemaBodyMax: [REG, '          minLength: 1,\n          maxLength: spec.max', '          minLength: 1'],
  rSchemaPath: [REG, "      case 'path':\n      case 'workspace_path':\n        properties[name] = { type: 'string', description: spec.describe, maxLength: MAX_PATH_ARG }", "      case 'path':\n      case 'workspace_path':\n        properties[name] = { type: 'string', description: spec.describe }"],
  rPathLength: [REG, "    case 'path':\n    case 'workspace_path':\n      if (typeof value !== 'string') return 'must be text'\n      return value.length === 0 || value.length > MAX_PATH_ARG", "    case 'path':\n    case 'workspace_path':\n      if (typeof value !== 'string') return 'must be text'\n      return value.length === 0"],
  // ----- the budget -----
  bFileCap: [BUD, "      if (fileCalls >= files.calls) return 'file-cap'\n", ''],
  bFileTime: [BUD, "      if (fileCalls >= files.calls) return 'file-cap'\n      if (workingMs() >= limitMs) return 'time-cap'", "      if (fileCalls >= files.calls) return 'file-cap'"],
  bFileCount: [BUD, '      fileCalls++\n', ''],
  bCharsFloor: [BUD, 'charsLeft: () => Math.max(0, files.chars - chars),', 'charsLeft: () => files.chars - chars,'],
  bCharsGuard: [BUD, 'if (Number.isFinite(count) && count > 0) chars += Math.floor(count)', 'chars += Math.floor(count)'],
  bCharsFloorInt: [BUD, 'chars += Math.floor(count)', 'chars += count'],
  bCalls: [BUD, '      calls: steps + fileCalls,', '      calls: steps,'],
  bFrozen: [BUD, 'const files = Object.freeze({ calls: fileCaps.calls, chars: fileCaps.chars })', 'const files = { calls: fileCaps.calls, chars: fileCaps.chars }'],
  // ----- the record, the log's view and the chat's notes -----
  aCoveredIsDeclined: [AUD, "  if (call.answer !== null && call.answer !== 'yes' && call.answer !== 'covered') {", "  if (call.answer !== null && call.answer !== 'yes') {"],
  aCoveredFlagDone: [AUD, "          sources: call.result.sources.map(({ title, url }) => ({ title, url })),\n          ...covered", "          sources: call.result.sources.map(({ title, url }) => ({ title, url }))"],
  aCoveredFlagFailed: [AUD, "      : { kind: 'failed', ...covered }", "      : { kind: 'failed' }"],
  aCoveredRunning: [AUD, "  if (call.ran || call.answer === 'yes' || call.answer === 'covered') {", "  if (call.ran || call.answer === 'yes') {"],
  aCoveredText: [AUD, 'return `Allowed by your yes for this reply. It ran:', 'return `You said yes. It ran:'],
  aRefusedText: [AUD, "  'file-cap': 'Refused: the reply had used all its file calls.',", "  'file-cap': 'x',"],
  tNoCode: [SHT, "  'chars-cap', //      the reply has read all the file text it may (12.2)\n", ''],
  tNoCovered: [SHT, "  /** The person's yes for this reply's file access (12.2) covered the call: nobody was asked about this call itself. It runs like a yes. */\n  'covered'", "  'stopped'"],
  nDoneCovered: [NOT, "      const covered = Object.prototype.hasOwnProperty.call(raw, 'covered')\n      if (covered && raw.covered !== true) return null\n      if (\n", "      const covered = Object.prototype.hasOwnProperty.call(raw, 'covered')\n      if (\n"],
  nFailedCovered: [NOT, "      if (covered && raw.covered !== true) return null\n      return hasKeys(raw, covered ? ['kind', 'covered'] : ['kind'])", "      return hasKeys(raw, covered ? ['kind', 'covered'] : ['kind'])"],
  nDeclinedCovered: [NOT, "        raw.answer !== 'yes' &&\n        raw.answer !== 'covered'", "        raw.answer !== 'yes'"],
  nSettleCovered: [NOT, "              ...(note.outcome.covered === true ? { covered: true as const } : {})\n", ''],
  nNoteText: [NOT, "        return `Allowed for this reply. ${plural(outcome.size, 'character came', 'characters came')} back.`", "        return `You allowed it. ${plural(outcome.size, 'character came', 'characters came')} back.`"],
  // ----- the loop of the reply -----
  lEndFile: [RTL, "      outcome.code === 'file-cap' ||\n", ''],
  lEndChars: [RTL, "      outcome.code === 'chars-cap'\n      ? outcome.code", "      false\n      ? outcome.code"],
  lMessage: [CHT, "    case 'file-cap':\n      return `Stopped: this reply used all ${fileCaps.calls} of its file calls.`", "    case 'file-cap':\n      return `Stopped.`"],
  // ----- wired in before its time -----
  xWired: [IPC, "import { createQuestionGate } from './systemQuestion'", "import { createQuestionGate } from './systemQuestion'\nimport { createWorkspaceGuard } from './workspaceGuard'\nvoid createWorkspaceGuard"]
}

mkdirSync(join(TOOLS, 'specs122'), { recursive: true })
for (const [name, edit] of Object.entries(s)) {
  const [file, from, to] = edit
  writeFileSync(join(TOOLS, 'specs122', `n122-${name}.json`), JSON.stringify({ label: `n122-${name}`, edits: [{ file, from, to }], argv: ['{{TOOLS}}/verify-12-2.mjs'], env: {}, timeoutMs: 280000 }, null, 2) + '\n')
}
console.log(`wrote ${Object.keys(s).length} specs in specs122`)
