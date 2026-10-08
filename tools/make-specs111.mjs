// Writes the negative-control specs for slice 11.1 (the tool registry and the permission core, D-041): one sabotage each, which a suite must notice.
// usage: node tools/make-specs111.mjs
//   then: node tools/check-specs.mjs                   (dry check)
//         node tools/nc-all.mjs specs111 <names...>    (verify-11-1.mjs, plain Node: registry, the question's words, the budget, the core)
//         node tools/nc-all.mjs specs111f <names...>   (verify-11-1-folder.mjs, plain Node: NO TOOL CAN READ, WRITE OR LIST THE DATA FOLDER)
//         node tools/nc-all.mjs specs111w <names...>   (run111.mjs: the real window)
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { TOOLS } from './paths.mjs'

const R = '{{REPO}}/'
const REG = R + 'src/main/toolRegistry.ts', QST = R + 'src/main/toolQuestion.ts', BUD = R + 'src/main/replyBudget.ts', COR = R + 'src/main/toolCore.ts'
const GRD = R + 'src/main/dataFolderGuard.ts', SHT = R + 'src/shared/tools.ts', PRE = R + 'src/preload/index.ts', CH = R + 'src/shared/ipc.ts'
const IPC = R + 'src/main/ipc.ts', ANT = R + 'src/main/providers/anthropic.ts', OAI = R + 'src/main/providers/openai.ts', CB = R + 'src/renderer/src/chat/ChatBar.tsx'
const PKG = R + 'package.json'
const ELLIPSIS = String.fromCodePoint(0x2026)

const s = {
  // ----- the registry and the arguments -----
  rProtoId: [REG, 'def.id in Object.prototype\n    ) {', 'false\n    ) {'],
  rDuplicate: [REG, 'if (byId.has(def.id)) throw', 'if (false) throw'],
  rFit: [REG, 'if (worstCase(def) > SHOWN_LIMIT) {', 'if (false) {'],
  rArgProto: [REG, "|| name in Object.prototype) {", '|| false) {'],
  rArgWhy: [REG, "|| name === 'why' ||", '|| false ||'],
  rCopyExtra: [REG, '  return deepFreeze({\n    id,', '  return deepFreeze({\n    ...def,\n    id,'],
  rNoFreeze: [REG, '  return Object.freeze(value)', '  return value'],
  rArgsExtra: [REG, 'if (given.length > allowed.size || given.some((name) => !allowed.has(name))) {', 'if (false) {'],
  rArgsProto: [REG, 'if (proto !== Object.prototype && proto !== null)', 'if (false)'],
  rUnshowable: [REG, "if (UNSHOWABLE.test(value)) return 'holds characters that cannot be shown'", "if (false) return 'holds characters that cannot be shown'"],
  rLength: [REG, 'if (value.length < spec.min || value.length > spec.max || value.trim().length === 0) {', 'if (value.length < spec.min || value.trim().length === 0) {'],
  rWhyCut: [REG, 'return chars.length > WHY.max ? `${chars.slice(0, WHY.max - 1).join(\'\')}' + ELLIPSIS + '` : text', 'return text'],
  rSchemaExtra: [REG, "      required: [...Object.keys(def.args), 'why'],\n      additionalProperties: false", "      required: [...Object.keys(def.args), 'why'],\n      additionalProperties: true"],
  rSchemaWhy: [REG, "required: [...Object.keys(def.args), 'why'],", 'required: [...Object.keys(def.args)],'],
  rBuiltinPath: [REG, "      kind: 'text',\n      label: 'Search for',", "      kind: 'path',\n      op: 'read',\n      label: 'Search for',"],
  // ----- the words of the question -----
  qQuote: [QST, 'if (char === \'"\' ||', 'if (false ||'],
  qBackslash: [QST, "|| char === '\\\\')", '|| false)'],
  qInvisible: [QST, 'else if (INVISIBLE.test(char))', 'else if (false)'],
  qAskedHere: [QST, '  lines.push(ASKED_HERE)\n', "  lines.push('')\n"],
  qReason: [QST, "  lines.push(`The model's reason: ${shown(why)}`, '', def.effect, '')", "  lines.push('', def.effect, '')"],
  qNoLabel: [QST, 'no: "Don\'t allow"', "no: 'Allow every time'"],
  qLimit: [QST, 'export const SHOWN_LIMIT = 2000', 'export const SHOWN_LIMIT = 20000'],
  // ----- the reply's budget -----
  bStep: [BUD, "if (steps >= caps.steps) return 'step-cap'", 'void 0'],
  bTime: [BUD, "if (workingMs() >= limitMs) return 'time-cap'", 'void 0'],
  bPauseCount: [BUD, '      pauses--\n      if (pauses === 0) pausedFor += now() - pausedAt', '      pauses = 0\n      pausedFor += now() - pausedAt'],
  bPauseOff: [BUD, '      if (pauses === 0) pausedAt = now()\n      pauses++', ''],
  bCapsSteps: [BUD, 'steps: inRange(caps.steps, steps.min, steps.max) ? caps.steps : TOOL_CAPS_DEFAULT.steps,', 'steps: caps.steps as number,'],
  bCapsSeconds: [BUD, '    seconds: inRange(caps.seconds, seconds.min, seconds.max)\n      ? caps.seconds\n      : TOOL_CAPS_DEFAULT.seconds', '    seconds: caps.seconds as number'],
  // ----- the settings -----
  sOnTruthy: [SHT, 'Object.prototype.hasOwnProperty.call(settings.enabled, id) && settings.enabled[id] === true', 'Boolean(settings.enabled[id])'],
  sOnInherited: [SHT, 'Object.prototype.hasOwnProperty.call(settings.enabled, id) && ', ''],
  // ----- the core -----
  cAbortFirst: [COR, "    if (signal.aborted) return refused('stopped', STOPPED, budget.used().steps)\n", ''],
  cTake: [COR, '    const taken = budget.take()', "    const taken = 'ok' as const"],
  cUnknown: [COR, "    if (def === undefined) return refused('unknown-tool', UNKNOWN_TOOL, step)\n", ''],
  cOff: [COR, "    if (!toolIsOn(settings(), def.id)) return refused('tool-off', TOOL_OFF, step)\n", ''],
  cNoRunner: [COR, "    if (executor === undefined) return refused('no-runner', NO_RUNNER, step)\n", ''],
  cExecutorsCopy: [COR, '  const executors = new Map<string, Executor>(Object.entries(options.executors))', '  const executors = { get: (id: string) => options.executors[id], has: (id: string) => id in options.executors } as unknown as Map<string, Executor>'],
  cArgs: [COR, '    if (!checked.ok) {', '    if (false) {'],
  cSecret: [COR, "      if (held) return refused('secret', SECRET_TEXT, step)", ''],
  cSecretFailOpen: [COR, '      } catch {\n        held = true\n      }', '      } catch {\n        held = false\n      }'],
  cSecretWhy: [COR, '    const texts = [\n      checked.why,\n', '    const texts = [\n'],
  cFit: [COR, "    if (question.detail.length > SHOWN_LIMIT) return refused('bad-arguments', TOO_LONG_TEXT, step)\n", ''],
  cRecordAsked: [COR, "    if (\n      !(await keep({\n        type: 'asked',", "    if (\n      !((await keep({\n        type: 'asked',"],
  cRecordAskedEnd: [COR, "        why: checked.why\n      }))\n    ) {", "        why: checked.why\n      })) || true)\n    ) {"],
  cPause: [COR, '    budget.pause()\n', ''],
  cResume: [COR, '      budget.resume()\n', ''],
  cNoBox: [COR, '      answer = await askOrStop(owner, question, signal)', "      answer = 'yes'"],
  cYesOnly: [COR, "    if (answer !== 'yes') {", "    if (answer === 'busy') {"],
  cStopAfterYes: [COR, "    if (answer === 'yes' && signal.aborted) answer = 'stopped' // Stop came first: the yes is not one\n", ''],
  cAskStop: [COR, "      signal.addEventListener('abort', onAbort, { once: true })\n      gate.ask", '      gate.ask'],
  cRecordYes: [COR, "    if (!recorded) return refused('not-recorded', NOT_RECORDED, step)\n", ''],
  cRecordRan: [COR, "    if (!(await keep({ type: 'ran', at: now(), call, tool, step }))) {", '    if (false) {'],
  cTimer: [COR, "    const timer = setTimeout(endBecause('time'), Math.max(0, budget.remainingMs()))", '    const timer = setTimeout(() => undefined, 1)'],
  cStopRun: [COR, "    signal.addEventListener('abort', onStop, { once: true })\n    const timer", '    const timer'],
  cRace: [COR, '      const done = await Promise.race([running, aborted])', '      const done = await running'],
  cShapeSize: [COR, '    text: text.length > MAX_RESULT_CHARS ? text.slice(0, MAX_RESULT_CHARS) + RESULT_CUT : text,', '    text,'],
  cShapeHttps: [COR, 'url.length > TOOL_RESULT_LIMITS.maxUrlChars || !isSafeExternalUrl(url)) return null', 'url.length > TOOL_RESULT_LIMITS.maxUrlChars) return null'],
  cShapeMax: [COR, 'sources.slice(0, MAX_SOURCES)', 'sources'],
  cShapeNull: [COR, "  if (typeof text !== 'string') return null\n", ''],
  cInternal: [COR, "        console.error('Deciding on a tool call failed:', reason(error))", '        throw error'],
  cName: [COR, "typeof name === 'string' && /^[a-z][a-z0-9_]{1,31}$/.test(name) ? name : '(unknown)'", 'String(name)'],
  cEnds: [COR, "new Set(['step-cap', 'time-cap', 'stopped'])", 'new Set([])'],
  cSettingsThrow: [COR, '      return DEFAULT_TOOL_SETTINGS\n    }\n  }', "      throw new Error('settings')\n    }\n  }"],
  cPathReal: [COR, '      args[argName] = verdict.real', '      args[argName] = checked.args[argName]'],
  cGuardSkip: [COR, "      if (spec.kind !== 'path') continue", '      continue'],
  cGuardIgnore: [COR, '      if (!verdict.ok) {', '      if (false) {'],
  cCheckAgain: [COR, 'executor(args, { signal: controller.signal, check: checkAgain })', 'executor(args, { signal: controller.signal } as never)'],
  cCheckOpen: [COR, '      return await guard.check({ path, base: null, op, recursive })', '      return { ok: true, real: path }'],
  // ----- what must not be reachable -----
  xImport: [COR, "import { isSafeExternalUrl } from './security'", "import { isSafeExternalUrl } from './security'\nimport { createMemory } from './memory'"],
  xDisk: [COR, "import { isSafeExternalUrl } from './security'", "import { isSafeExternalUrl } from './security'\nimport { readFileSync } from 'fs'"],
  xNetwork: [QST, 'export const SHOWN_LIMIT = 2000', "export const SHOWN_LIMIT = 2000\nvoid fetch('https://example.com')"],
  xReach: [IPC, "import { createQuestionGate } from './systemQuestion'", "import { createQuestionGate } from './systemQuestion'\nimport { createToolCore } from './toolCore'"],
  xBridge: [PRE, '  usage: {\n    summary:', '  tools: { run: () => 1 },\n  usage: {\n    summary:'],
  xChannel: [CH, "  usageSummary: 'usage:summary',", "  usageSummary: 'usage:summary',\n  toolAnswer: 'tools:answer',"],
  xPackage: [PKG, '"openai": "^7.25.0"', '"openai": "^7.25.0",\n    "left-pad": "1.3.0"'],
  // ----- the data-folder guard -----
  gAllowAll: [GRD, '      const lexicalRefusal = against(lexical.abs)', '      return { ok: true, real: lexical.abs }\n      const lexicalRefusal = against(lexical.abs)'],
  gNoPhysical: [GRD, '      const physicalRefusal = against(resolved.real)', '      const physicalRefusal = null as PathRefusal | null'],
  gNoLexical: [GRD, '      const lexicalRefusal = against(lexical.abs)', '      const lexicalRefusal = null as PathRefusal | null'],
  gNoInside: [GRD, "          if (isInside(here, root, platform)) return 'data-folder'\n", ''],
  gCase: [GRD, "  platform === 'win32' || platform === 'darwin'", '  false'],
  gFoldUpper: [GRD, ' || a.toUpperCase() === b.toUpperCase()', ''],
  gFoldLower: [GRD, 'a.toLowerCase() === b.toLowerCase() || ', ''],
  gPrefix: [GRD, '  return root.every((name, index) => sameName(child[index], name, blind))', '  return root.every((name, index) => child[index]?.startsWith(name))'],
  gDotdot: [GRD, '      if (out.length > 1) out.pop() // never above the root', '      void 0'],
  gTrailing: [GRD, "      name = name.replace(/[. ]+$/, '') // Windows ignores trailing dots and spaces", ''],
  gNlink: [GRD, 'if (found.isFile() && found.nlink > 1) {', 'if (false) {'],
  gDangling: [GRD, "    return no('a link that leads nowhere, or a part that could not be resolved')", '    real = existing'],
  gNoAncestor: [GRD, "          if (tree && isInside(root, here, platform)) return 'data-folder'\n", ''],
  gDeleteNotTree: [GRD, "request.recursive === true || request.op === 'delete'", 'request.recursive === true'],
  gNoRealRoot: [GRD, '          roots.push(partsOf(plain(await fs.realpath(folder)), platform)) // the data folder may itself be reached through a link', ''],
  gEmptyRoots: [GRD, "      if (folders.length === 0)\n        return { ok: false, code: 'data-folder', why: 'no data folder is known' }", ''],
  gBadRoot: [GRD, '        if (!named.ok)\n          return {', '        if (false)\n          return {'],
  gDevice: [GRD, "      if (DEVICE_NAME.test(name)) return no('a name Windows treats as a device')", ''],
  gVariable: [GRD, "    if (text.includes('%')) return no('a variable that another program would expand')", ''],
  gDriveRel: [GRD, String.raw`    if (drive !== null && !/^[\\/]/.test(rest)) return no('a path relative to a drive')`, ''],
  gRooted: [GRD, String.raw`    if (drive === null && /^[\\/]/.test(rest)) return no('a path relative to the current drive')`, ''],
  gDots: [GRD, "      if (/^[. ]+$/.test(name)) return no('a name made of dots or spaces')", ''],
  gControl: [GRD, "  if (UNREADABLE_CHARS.test(raw)) return no('control, invisible or unassigned characters')", ''],
  gStream: [GRD, '/[<>:"|?*]/.test(rest)', '/[<>"|?*]/.test(rest)'],
  gIllegal: [GRD, "    if (/[<>:\"|?*]/.test(rest)) return no('characters that are not allowed in a name, or a stream')\n", ''],
  gUncAndRooted: [GRD, String.raw`    } else if (/^[\\/]{2}/.test(text)) {
      return no('a network path')
    }`, '    }']
}

const node = {
  'n111-registry-proto-id': [s.rProtoId], 'n111-registry-duplicate': [s.rDuplicate], 'n111-registry-fit': [s.rFit], 'n111-registry-arg-proto': [s.rArgProto], 'n111-registry-arg-why': [s.rArgWhy],
  'n111-registry-copy-extra': [s.rCopyExtra], 'n111-registry-no-freeze': [s.rNoFreeze], 'n111-args-extra': [s.rArgsExtra], 'n111-args-proto': [s.rArgsProto], 'n111-args-unshowable': [s.rUnshowable],
  'n111-args-length': [s.rLength], 'n111-why-cut': [s.rWhyCut], 'n111-schema-extra': [s.rSchemaExtra], 'n111-schema-why': [s.rSchemaWhy], 'n111-builtin-path': [s.rBuiltinPath],
  'n111-question-quote': [s.qQuote], 'n111-question-backslash': [s.qBackslash], 'n111-question-invisible': [s.qInvisible], 'n111-question-asked-here': [s.qAskedHere], 'n111-question-reason': [s.qReason],
  'n111-question-no-label': [s.qNoLabel], 'n111-question-limit': [s.qLimit],
  'n111-budget-step': [s.bStep], 'n111-budget-time': [s.bTime], 'n111-budget-pause-count': [s.bPauseCount], 'n111-budget-pause-off': [s.bPauseOff], 'n111-budget-caps-steps': [s.bCapsSteps], 'n111-budget-caps-seconds': [s.bCapsSeconds],
  'n111-on-truthy': [s.sOnTruthy], 'n111-on-inherited': [s.sOnInherited],
  'n111-core-abort-first': [s.cAbortFirst], 'n111-core-take': [s.cTake], 'n111-core-unknown': [s.cUnknown], 'n111-core-off': [s.cOff], 'n111-core-no-runner': [s.cNoRunner], 'n111-core-executors-copy': [s.cExecutorsCopy],
  'n111-core-args': [s.cArgs], 'n111-core-secret': [s.cSecret], 'n111-core-secret-fail-open': [s.cSecretFailOpen], 'n111-core-secret-why': [s.cSecretWhy], 'n111-core-fit': [s.cFit],
  'n111-core-record-asked': [s.cRecordAsked, s.cRecordAskedEnd], 'n111-core-pause': [s.cPause], 'n111-core-resume': [s.cResume], 'n111-core-no-box': [s.cNoBox], 'n111-core-yes-only': [s.cYesOnly],
  'n111-core-stop-after-yes': [s.cStopAfterYes], 'n111-core-ask-stop': [s.cAskStop], 'n111-core-record-yes': [s.cRecordYes], 'n111-core-record-ran': [s.cRecordRan], 'n111-core-timer': [s.cTimer],
  'n111-core-stop-run': [s.cStopRun], 'n111-core-race': [s.cRace], 'n111-core-shape-size': [s.cShapeSize], 'n111-core-shape-https': [s.cShapeHttps], 'n111-core-shape-max': [s.cShapeMax],
  'n111-core-shape-null': [s.cShapeNull], 'n111-core-internal': [s.cInternal], 'n111-core-name': [s.cName], 'n111-core-ends': [s.cEnds], 'n111-core-settings-throw': [s.cSettingsThrow],
  'n111-core-path-real': [s.cPathReal], 'n111-core-guard-skip': [s.cGuardSkip], 'n111-core-guard-ignore': [s.cGuardIgnore],
  'n111-reach-import': [s.xImport], 'n111-reach-disk': [s.xDisk], 'n111-reach-network': [s.xNetwork], 'n111-reach-ipc': [s.xReach], 'n111-reach-bridge': [s.xBridge], 'n111-reach-channel': [s.xChannel], 'n111-reach-package': [s.xPackage]
}

// The owner's addition: each takes the block out, or weakens it one way, and verify-11-1-folder.mjs must say so by name.
const folder = {
  'f111-block-removed': [s.gAllowAll],
  'f111-core-skips-guard': [s.cGuardSkip],
  'f111-core-ignores-verdict': [s.cGuardIgnore],
  'f111-core-raw-paths': [s.cPathReal],
  'f111-no-physical': [s.gNoPhysical],
  'f111-no-lexical-layer': [s.gNoLexical],
  'f111-no-inside': [s.gNoInside],
  'f111-case-sensitive': [s.gCase],
  'f111-fold-upper': [s.gFoldUpper],
  'f111-fold-lower': [s.gFoldLower],
  'f111-prefix-compare': [s.gPrefix],
  'f111-no-dotdot': [s.gDotdot],
  'f111-no-trailing': [s.gTrailing],
  'f111-no-hardlink-rule': [s.gNlink],
  'f111-dangling-ok': [s.gDangling],
  'f111-no-ancestor-rule': [s.gNoAncestor],
  'f111-delete-not-tree': [s.gDeleteNotTree],
  'f111-no-real-root': [s.gNoRealRoot],
  'f111-empty-roots-ok': [s.gEmptyRoots],
  'f111-bad-root-ok': [s.gBadRoot],
  'f111-device-names': [s.gDevice],
  'f111-variables': [s.gVariable],
  'f111-drive-relative': [s.gDriveRel],
  'f111-rooted': [s.gRooted],
  'f111-dots-name': [s.gDots],
  'f111-control-chars': [s.gControl],
  'f111-streams': [s.gStream],
  'f111-illegal-chars': [s.gIllegal],
  'f111-unc-and-rooted': [s.gUncAndRooted, s.gRooted],
  'f111-check-again-dropped': [s.cCheckAgain],
  'f111-check-again-open': [s.cCheckOpen]
}

const win = {
  'w111-bridge-tools': [s.xBridge],
  'w111-handler': [[IPC, '  ipcMain.handle(CHANNELS.settingsStatus, guarded(currentStatus))', "  ipcMain.handle(CHANNELS.settingsStatus, guarded(currentStatus))\n  ipcMain.handle('tools:answer', guarded(async () => true))"]],
  'w111-request-tools': [[ANT, '      ...(effort ? { output_config: { effort } } : {}),', '      tools: [],\n      ...(effort ? { output_config: { effort } } : {}),']],
  'w111-openai-tool-choice': [[OAI, '      store: false,\n', "      store: false,\n      tool_choice: 'none',\n"]],
  'w111-tool-call-shown': [[ANT, "    if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {", "    if (event.type === 'content_block_start' && event.content_block.type === 'tool_use') {\n      yield { type: 'text', text: `[tool_use ${event.content_block.name}]` }\n    }\n    if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {"]],
  'w111-page-says-tools': [[CB, 'Attach...', 'Attach tools...']],
  'w111-bundle-holds-registry': [[IPC, "import { createQuestionGate } from './systemQuestion'", "import { createQuestionGate } from './systemQuestion'\nimport { WEB_SEARCH } from './toolRegistry'"], [IPC, '  ipcMain.handle(CHANNELS.settingsStatus, guarded(currentStatus))', '  ipcMain.handle(CHANNELS.settingsStatus, guarded(currentStatus))\n  console.log(WEB_SEARCH.title)']]
}

const write = (dir, specs, argv, env, timeoutMs) => {
  mkdirSync(join(TOOLS, dir), { recursive: true })
  for (const [name, edits] of Object.entries(specs)) {
    writeFileSync(join(TOOLS, dir, `${name}.json`), JSON.stringify({ label: name, edits: edits.map(([file, from, to]) => ({ file, from, to })), argv, env, ...(timeoutMs ? { timeoutMs } : {}) }, null, 2) + '\n')
  }
}
write('specs111', node, ['{{TOOLS}}/verify-11-1.mjs'], {})
write('specs111f', folder, ['{{TOOLS}}/verify-11-1-folder.mjs'], {}, 280000)
write('specs111w', win, ['{{TOOLS}}/run111.mjs', 'dev'], { NO_RETRY: '1' }, 600000)
console.log(`wrote ${Object.keys(node).length} specs in specs111, ${Object.keys(folder).length} in specs111f and ${Object.keys(win).length} in specs111w`)
