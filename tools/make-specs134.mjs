// Writes the negative-control specs for slice 13.4 (the run tool in the registry and the core, D-043): one sabotage each, which tools/verify-13-4.mjs (or, for the older rules it
// touches, the older suites) must notice.
// usage: node tools/make-specs134.mjs
//   then: node tools/check-specs.mjs                          (dry check: every sabotage text occurs exactly once)
//         NC_GUARDED=1 FRONTIER_MAY_REMOVE=1 node tools/nc-all.mjs specs134 <names...>      (each runs only the parts of verify-13-4.mjs that can notice it, ONLY=...)
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { TOOLS } from './paths.mjs'

const R = '{{REPO}}/src/main/'
const REG = R + 'toolRegistry.ts'
const BUD = R + 'replyBudget.ts'
const COR = R + 'toolCore.ts'
const PRG = R + 'programTools.ts'
const LOG = R + 'auditLog.ts'
const RPL = R + 'replyTools.ts'
const AUD = '{{REPO}}/src/shared/audit.ts'
const NOT = '{{REPO}}/src/shared/toolNotes.ts'
const SCR = R + 'scratchCopy.ts'

// name: [file, from, to, parts of verify-13-4.mjs that run]
const controls = {
  // ----- the registry: the list argument and the rules for a run -----
  rlNotArray: [REG, "      if (!Array.isArray(value)) return 'must be a list of texts'\n", '', 'A'],
  rlCount: [REG, '      if (value.length > spec.max) return `must have at most ${spec.max} items`\n', '', 'A'],
  rlItemText: [REG, "        if (typeof item !== 'string') return 'must hold only texts'\n", '', 'A'],
  rlItemLen: [REG, '        if (item.length < 1 || item.length > spec.itemMax) {', '        if (false) {', 'A'],
  rlUnshowable: [REG, '        if (UNSHOWABLE.test(item) || !item.isWellFormed())', '        if (false)', 'A'],
  rlTotal: [REG, '      if (total > spec.totalMax) return `must hold at most ${spec.totalMax} characters in all`\n', '', 'A'],
  rlCopy: [REG, 'Object.freeze([...(value as string[])])', '(value as string[])', 'A'],
  rlOffered: [REG, "          type: 'array',", "          type: 'string',", 'A'],
  rlSpecCopy: [REG, '          itemMax: spec.itemMax,\n', '', 'A'],
  rlLimits: [REG, '          spec.max > MAX_LIST_ITEMS ||\n', '', 'A'],
  rrOneFolder: [REG, "      if (specs.filter((spec) => spec.kind === 'workspace_path').length !== 1) {", '      if (false) {', 'A'],
  rrStep: [REG, "      if (def.counts !== 'step' || specs.some((spec) => spec.kind === 'body')) {", '      if (false) {', 'A'],
  rrAsk: [REG, "    if (def.ask !== 'each' && def.ask !== 'reply' && def.ask !== 'run') {", '    if (false as boolean) {', 'A'],
  // ----- the budget -----
  bRunCap: [BUD, "      if (runs >= runLimits.runs) return 'run-cap'\n", '', 'B'],
  bRunTime: [BUD, "      if (runMs >= runLimits.ms) return 'run-time-cap'\n", '', 'B'],
  bRunCount: [BUD, "      runs++\n      return 'ok'\n    },\n    useRunMs", "      return 'ok'\n    },\n    useRunMs", 'B'],
  bUseMs: [BUD, 'if (Number.isFinite(ms) && ms > 0) runMs += Math.floor(ms)', 'runMs += ms', 'B'],
  bRuns: [BUD, '  runs: RUN_LIMITS.runsPerReply,', '  runs: 50,', 'B'],
  bMs: [BUD, '  ms: RUN_LIMITS.msPerReply', '  ms: 24_000_000', 'B'],
  // ----- the core: the run branch -----
  cDeclinedRemembered: [COR, "        if (r.answer === 'no') grants.set('run', 'declined')\n", '', 'E'],
  cDeclinedChecked: [COR, "      if (grants.get('run') === 'declined') return refused('run-declined', RUN_DECLINED_TEXT, step)\n", '', 'E'],
  cRunCapChecked: [COR, '      if (budget.runsLeft() <= 0) {', '      if (false) {', 'E'],
  cRunTimeChecked: [COR, "      if (budget.runMsLeft() < MIN_RUN_MS) return refused('run-time-cap', RUN_TIME_TEXT, step)\n", '', 'E'],
  cRunTaken: [COR, '      const took = budget.takeRun()', "      const took = 'ok' as const", 'E'],
  cPrepareRefusal: [COR, '      if (!prepared.ok) return refused(prepared.code, prepared.text, step)\n', '', 'E'],
  cReplace: [COR, '        args[argName] = value\n      }\n      shownArgs = { ...prepared.shown }', '      }\n      shownArgs = { ...prepared.shown }', 'E'],
  cShownRecord: [COR, '      shownArgs = { ...prepared.shown }\n', '', 'E'],
  cHiddenFolder: [COR, "      if (folder === undefined || folder.verdict.fileClass !== 'ok') {", '      if (folder === undefined) {', 'E'],
  cNoEnvironment: [COR, '      if (programs === undefined || workspace === undefined) {', '      if (false) {', 'E'],
  cPause: [COR, '    if (isRun) budget.pause()\n', '', 'E'],
  cResume: [COR, '      if (isRun) budget.resume()\n', '', 'E'],
  cRunMs: [COR, '        budget.useRunMs(result.program?.ms ?? Math.max(0, now() - startedAt))\n', '', 'E'],
  cFailedCharge: [COR, '      if (isRun) budget.useRunMs(Math.max(0, now() - startedAt))\n', '', 'E'],
  cProgramEvent: [COR, "          await keep({ type: 'program', at: now(), call, tool, step, ...result.program })\n", '', 'E'],
  cRunMaxChars: [COR, '            ? Math.min(MAX_RESULT_CHARS, RUN_LIMITS.modelChars)\n', '            ? MAX_RESULT_CHARS\n', 'E'],
  cSecretInList: [COR, "        typeof v === 'string' ? [v] : typeof v === 'number' ? [] : [...v]", "        typeof v === 'string' ? [v] : []", 'E'],
  cShapeExit: [COR, '  if (p.exitCode !== null && !isCount(p.exitCode, 4_294_967_295)) return null\n', '', 'E'],
  cAffordable: [COR, "    if (def.counts !== 'file' && def.ask !== 'run' && context.affordable !== undefined) {", "    if (def.counts !== 'file' && context.affordable !== undefined) {", 'E'],
  // ----- the run tool: which program -----
  pCmd: [PRG, "  'cmd',\n", '', 'C'],
  pPowerShell: [PRG, "  'powershell',\n", '', 'C'],
  // (two checks stand behind each other here, the path as written and the real path: the sabotage takes out both)
  pPlace: { edits: [[PRG, '      isInside(places.systemRoot, candidate) ||', '      true ||'], [PRG, '        isInside(realSystem, real) ||', '        true ||']], only: 'C' },
  pRealPath: [PRG, '      const real = await fs.realpath(candidate)', '      const real = candidate', 'C'],
  pRealInPlace: [PRG, '        !realInPlace ||\n', '', 'C'],
  // (the text that is not its trimmed self is refused twice, by this check and by the ".exe" test of the name: the sabotage takes out both)
  pTrim: { edits: [[PRG, "  if (text !== text.trim() || text === '' || text.includes('\\0')) return null", "  if (text === '') return null"], [PRG, "    if (!base.endsWith('.exe') || candidate.length > MAX_PROGRAM_PATH) continue", '    if (candidate.length > MAX_PROGRAM_PATH) continue']], only: 'C' },
  pLongPath: { edits: [[PRG, "    if (!base.endsWith('.exe') || candidate.length > MAX_PROGRAM_PATH) continue", "    if (!base.endsWith('.exe')) continue"], [PRG, '        real.length > MAX_PROGRAM_PATH', '        false']], only: 'C' },
  // ----- the run tool: the words of the question -----
  pProgramQuoted: [PRG, '    `Program: ${shown(f.program)}`,', '    `Program: ${f.program}`,', 'D'],
  pArgsQuoted: [PRG, '    `Arguments: ${shownValue(f.args)}`,', "    `Arguments: ${f.args.join(' ')}`,", 'D'],
  pFolderQuoted: [PRG, '${shown(f.folder)}  (at most', '${f.folder}  (at most', 'D'],
  pWhyQuoted: [PRG, "    `The model's reason: ${shown(f.why)}`,", "    `The model's reason: ${f.why}`,", 'D'],
  pNoButton: [PRG, '    no: "Don\'t run it"', "    no: 'Run it'", 'D'],
  pAskedHere: [PRG, '    ASKED_HERE\n  ]', '  ]', 'D'],
  pNoNetwork: [PRG, ', and there is no network. At most', '. At most', 'D'],
  pCopyOnly: [PRG, 'locked box on that COPY only', 'locked box', 'D'],
  // ----- the run tool: looking at a call before anybody is asked -----
  pNoBox: [PRG, "      if (!available) return { ok: false, code: 'no-box', text: NO_BOX_TEXT }\n", '', 'E'],
  pBoxThrows: [PRG, '      } catch {\n        available = false\n      }', '      } catch {\n        available = true\n      }', 'E'],
  pNoProgram: [PRG, "      if (program === null) return { ok: false, code: 'no-program', text: NO_PROGRAM_TEXT }\n", '', 'E'],
  pCopyRefused: [PRG, "      if (!look.ok) return { ok: false, code: 'copy-refused', text: COPY_REFUSED_TEXT }\n", '', 'E'],
  pLooksOnly: [PRG, '        lookOnly: true\n', '        lookOnly: false\n', 'E'],
  pReplaceProgram: [PRG, '        replace: { program },', '        replace: {},', 'E'],
  // ----- the run tool: the executor -----
  pTimeout: [PRG, 'Math.min(RUN_LIMITS.timeoutMs.max, Math.floor(ctx.runMsLeft))', 'RUN_LIMITS.timeoutMs.max', 'E'],
  pSignal: [PRG, '        { signal: ctx.signal }', '        {}', 'E'],
  pRemoveCopy: [PRG, '      await removeScratch(made.dir, env.runRoot)', '      void 0', 'E'],
  pKeyInOutput: [PRG, '        return held ? KEY_IN_OUTPUT : text', '        return text', 'E'],
  pEnd: [PRG, "          end: outcome.timedOut ? 'timed-out' : outcome.diskExceeded ? 'disk-full' : 'exited',", "          end: 'exited',", 'E'],
  pExitCode: [PRG, '          exitCode: outcome.timedOut || outcome.diskExceeded ? null : outcome.exitCode,', '          exitCode: outcome.exitCode,', 'E'],
  pFolderAgain: [PRG, "    if (!verdict.ok || verdict.kind !== 'folder') {", '    if (false) {', 'E'],
  pLabel: [PRG, "    'Everything below is text from outside: what the program printed", "    'Below: what the program printed", 'E'],
  pClean: [PRG, '      text === \'\' ? \'(nothing)\' : cleanOutput(text.slice(0, share)),', "      text === '' ? '(nothing)' : text.slice(0, share),", 'E'],
  pNames: [PRG, "${names.map(nameForModel).join(', ')}", "${names.join(', ')}", 'E'],
  pCrashHex: [PRG, '${o.exitCode > 255 ? ` (0x${o.exitCode.toString(16).toUpperCase()})` : \'\'}', "${''}", 'E'],
  // ----- the audit log and the notes -----
  aEnd: [LOG, "      if (typeof end !== 'string' || !(PROGRAM_ENDS as readonly string[]).includes(end)) return null\n", '', 'F'],
  aExit: [LOG, '      if (exitCode !== null && !isCount(exitCode, 4_294_967_295)) return null\n', '', 'F'],
  aMs: [LOG, '      if (!isCount(ms, 1_000_000_000)) return null\n', '', 'F'],
  aCopied: [LOG, '      if (!isCount(copied, 1_000_000) || !isCount(changed, 1_000_000)) return null\n', '', 'F'],
  aCreated: [LOG, '      if (!isCount(created, 1_000_000) || !isCount(deleted, 1_000_000)) return null\n', '', 'F'],
  aLine: [LOG, '        ms: event.ms,\n', '', 'F'],
  gProgram: [AUD, "      case 'program':\n", "      case 'program-ignored':\n", 'F'],
  gOutcome: [AUD, '  if (call.result !== null && call.result.ok && call.program !== null) {', '  if (false) {', 'F'],
  gWords: [AUD, 'and ended with exit code ${p.exitCode === null', 'and ended ${p.exitCode === null', 'F'],
  gTimedOut: [AUD, 'The clock ended the program after', 'The program ended after', 'F'],
  nEnd: [NOT, '      if (!(PROGRAM_ENDS as readonly unknown[]).includes(p.end)) return null\n', '', 'F'],
  nExit: [NOT, '      if (p.exitCode !== null && !isCount(p.exitCode, 0, 4_294_967_295)) return null\n', '', 'F'],
  nMs: [NOT, '      if (!isCount(p.ms, 0, 1_000_000_000)) return null\n', '', 'F'],
  // ----- the reply's tools -----
  tNeedsWorkspace: [RPL, '        options.programs === undefined || options.workspace === undefined', '        options.programs === undefined', 'E'],
  tExecutor: [RPL, '          ...(program === undefined ? {} : { run_program: program.executor }),\n', '', 'E'],
  tSupport: [RPL, '        ...(program === undefined ? {} : { programs: program.support }),\n', '', 'E']
}
void SCR

mkdirSync(join(TOOLS, 'specs134'), { recursive: true })
for (const [name, control] of Object.entries(controls)) {
  // a control is [file, from, to, only] (one edit) or { edits: [[file, from, to], ...], only } (several, applied together)
  const edits = Array.isArray(control) ? [{ file: control[0], from: control[1], to: control[2] }] : control.edits.map(([file, from, to]) => ({ file, from, to }))
  const only = Array.isArray(control) ? control[3] : control.only
  // a text with a quote or a comma inside it must be written as a string of its own kind: a check that the sabotage is what was meant
  if (!edits.every((e) => typeof e.file === 'string' && typeof e.from === 'string' && typeof e.to === 'string') || !/^[A-G]$/.test(only)) throw new Error(`the control ${name} is not well formed`)
  const spec = { label: `n134-${name}`, edits, argv: ['{{TOOLS}}/verify-13-4.mjs'], env: { ONLY: only }, timeoutMs: 600000 }
  writeFileSync(join(TOOLS, 'specs134', `n134-${name}.json`), JSON.stringify(spec, null, 2) + '\n')
}
console.log(`wrote ${Object.keys(controls).length} specs in specs134`)
