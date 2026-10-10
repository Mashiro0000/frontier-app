// Writes the negative-control specs for slice 13.5 (the switch, the self-test and what a run brings back, D-043): one sabotage each, which tools/verify-13-5.mjs (or, for the older
// rules it touches, the older suites) must notice. Window-only rules (the page, the wiring) have their own specs, made by make-specs135w.mjs.
// usage: node tools/make-specs135.mjs
//   then: node tools/check-specs.mjs                          (dry check: every sabotage text occurs exactly once)
//         FRONTIER_MAY_REMOVE=1 TEMP=C:\frontier-tmp node tools/nc-all.mjs specs135 <names...>   (each runs only the parts of verify-13-5.mjs that can notice it, ONLY=...; NOT through
//         NC_GUARDED: the 13.x suites install their own guard and need TEMP to be C:\frontier-tmp itself)
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { TOOLS } from './paths.mjs'

const R = '{{REPO}}/src/main/'
const PRP = R + 'proposals.ts'
const RPR = R + 'runProposals.ts'
const PRG = R + 'programTools.ts'
const RTL = R + 'replyTools.ts'
const TSS = R + 'toolSettingsService.ts'
const SVC = R + 'programService.ts'
const SLF = R + 'selfTest.ts'
const BOX = R + 'programBox.ts'
const NOT = '{{REPO}}/src/shared/toolNotes.ts'
const IPC = R + 'ipc.ts'

const WRITE_DATA = "      'write-data',\n      ran && refused(said?.writeData) && !e.wroteSomething && e.canariesIntact,\n"
const MEM_GOOD = "const memGood = e.memory.kind === 'ran' && !e.memory.timedOut && e.memory.exitCode !== 0"
const CLEAN = '    e.leftovers.processes === 0 && e.leftovers.mounts === 0 && e.leftovers.live === 0\n'
const BRING_STORE_GUARD = 'options.programs.bringBack !== undefined || store === undefined'
const NAME_SPLIT = String.raw`  const name = program.split(/[\\/]/).pop() ?? program` + '\n'

// name: [file, from, to, parts of verify-13-5.mjs that run]
const controls = {
  // ----- proposals.ts: makeReplace (A) -----
  rpNothing: [PRP, '  if (after === decoded.text && input.bom === decoded.bom) {\n', '  if (false as boolean) {\n', 'A'],
  rpBomOnly: [PRP, '  if (after === decoded.text && input.bom === decoded.bom) {\n', '  if (after === decoded.text) {\n', 'A'],
  rpHidden: [PRP, '  const hidden = firstAddedHiddenCharacter(decoded.text, after)\n  if (hidden !== null) {\n', '  const hidden = firstAddedHiddenCharacter(decoded.text, after)\n  if (false as boolean) {\n', 'A'],
  rpHiddenAll: [PRP, 'firstAddedHiddenCharacter(decoded.text, after)', 'firstHiddenCharacter(after)', 'A'],
  rpHiddenMore: [PRP, '    if (count > (had.get(code) ?? 0)) return codeName(code)\n', '    if (!had.has(code)) return codeName(code)\n', 'A'],
  rpBase: [PRP, '    baseHash: sha256(input.bytes),\n    before: decoded.text,\n    after,\n    bom: input.bom,\n', '    baseHash: null,\n    before: decoded.text,\n    after,\n    bom: input.bom,\n', 'A'],
  rpBom: [PRP, '    after,\n    bom: input.bom,\n', '    after,\n    bom: decoded.bom,\n', 'A'],
  rpEol: [PRP, '    eol: lineEndings(after),\n', '    eol: decoded.eol,\n', 'A'],
  rpSecret: [PRP, '    why: input.why,\n    secret: input.secret,\n    now: input.now\n  })\n}\n\nexport interface CreateInput {', '    why: input.why,\n    secret: false,\n    now: input.now\n  })\n}\n\nexport interface CreateInput {', 'A'],
  // ----- runProposals.ts: what a run brings back (B) -----
  brCap: [RPR, '      if (options.counter.made >= PROPOSAL_LIMITS.perReply) {\n', '      if (false as boolean) {\n', 'B'],
  brCount: [RPR, '      options.counter.made++\n', '', 'B'],
  brStale: [RPR, '        if (sha256(bytes) !== candidate.baseSha256) {\n', '        if (false as boolean) {\n', 'B'],
  brBig: [RPR, '        if (verdict.size > WORKSPACE_LIMITS.maxFileBytes) {\n', '        if (false as boolean) {\n', 'B'],
  brText: [RPR, '        if (!decoded.ok) {\n', '        if (false as boolean) {\n', 'B'],
  brSecret: [RPR, "      const secret = verdict.fileClass === 'one-by-one'\n", '      const secret = false\n', 'B'],
  brKind: [RPR, "        if (verdict.kind !== 'file') {\n", '        if (false as boolean) {\n', 'B'],
  brStore: [RPR, '      if (!kept.ok) {\n', '      if (false as boolean) {\n', 'B'],
  brWhy: [RPR, 'const reasonFor = (why: string): string => `Made by a program that was run: ${why}`.slice(0, 300)\n', 'const reasonFor = (why: string): string => why\n', 'B'],
  brReal: [RPR, '          rel: verdict.rel,\n          real: verdict.real,\n          after: candidate.text,\n', '          rel: verdict.rel,\n          real: candidate.path,\n          after: candidate.text,\n', 'B'],
  brExists: [RPR, "        skip(verdict.code === 'exists' ? WHY_EXISTS : WHY_NOT_THERE)\n", '        skip(WHY_NOT_THERE)\n', 'B'],
  brOp: [RPR, "        op: changed ? 'edit' : 'create'\n", "        op: 'edit'\n", 'B'],
  // ----- programTools.ts: the words of a result (C) and the box -----
  ptNoChanges: [PRG, "  if (candidates === 0) {\n    return ['No text file was changed or made, so there is nothing to review.']\n  }\n", '', 'C'],
  ptNotMade: [PRG, '  for (const [why, paths] of byReason) {\n', '  for (const [why, paths] of new Map<string, string[]>()) {\n', 'C'],
  ptNames: [PRG, "paths.slice(0, NOT_MADE_NAMES).map(nameForModel).join(', ')", "paths.slice(0, NOT_MADE_NAMES).join(', ')", 'C'],
  ptNoBrought: [PRG, "    return ['They stay in the copy, which is removed now: nothing was brought back.']\n", '    return []\n', 'C'],
  ptMadeWords: [PRG, 'for the person to review; nothing is changed until they apply it.`\n', 'for the person to review.`\n', 'C'],
  ptNoneMade: [PRG, "      ? 'No text file could be brought back as a proposal.'\n", "      ? 'No text file was made.'\n", 'C'],
  ptBoxCatch: [PRG, "  try {\n    return await env.box()\n  } catch {\n    return { ok: false, why: 'the box could not be made' }\n  }\n", '  return await env.box()\n', 'C'],
  ptBoxNone: [PRG, "      if (!box.ok) return { ok: false, code: 'no-box', text: NO_BOX_TEXT }\n", '', 'C'],
  // ----- replyTools.ts: the one count of the reply's proposals, and the default way back (C) -----
  rtCounterProposals: [RTL, '                : createProposalExecutors({ store, now: options.now, counter: proposed }))\n', '                : createProposalExecutors({ store, now: options.now }))\n', 'C'],
  rtCounterBring: [RTL, '                      store,\n                      counter: proposed,\n', '                      store,\n', 'C'],
  rtNoBring: [RTL, BRING_STORE_GUARD, 'true', 'C'],
  rtNoStore: [RTL, BRING_STORE_GUARD, 'options.programs.bringBack !== undefined', 'C'],
  // ----- toolSettingsService.ts: the generic switch must not handle the run tool (G) -----
  tsList: [TSS, "def === undefined || def.counts === 'file' || PROGRAM_TOOL_IDS.includes(id)", "def === undefined || def.counts === 'file'", 'G'],
  tsSet: [TSS, '      if (PROGRAM_TOOL_IDS.includes(tool)) {\n', '      if (false as boolean) {\n', 'G'],
  // ----- toolNotes.ts: how the chat shows a run (G) -----
  nnRun: [NOT, "  if (note.tool === 'run_program') return runAbout(note.args)\n", '', 'G'],
  nnName: [NOT, NAME_SPLIT, '  const name = program\n', 'G'],
  nnQuote: [NOT, String.raw`/\s/.test(item)`, 'false', 'G'],
  nnFolder: [NOT, "  const folder = typeof args.folder === 'string' ? args.folder : '.'\n", "  const folder = '.'\n", 'G'],
  nnJson: [NOT, '    list = [] // not a list: shown without arguments, never as it was written\n', '    list = [String(args.arguments)]\n', 'G'],
  nnReview: [NOT, '        program.changed + program.created > 0\n', '        false\n', 'G'],
  // ----- programService.ts: the switch (F) -----
  svBool: [SVC, "      if (typeof on !== 'boolean') return { ok: false, error: NOT_UNDERSTOOD }\n", '', 'F'],
  svBusy: [SVC, '      if (changing || testing) return { ok: false, error: BUSY }\n', '', 'F'],
  svOffAgain: [SVC, '          if (tools.settings.enabled[TOOL_ID] !== true) return { ok: true, status: await status() }\n', '', 'F'],
  svOffReplace: [SVC, '          if (tools.problem !== null) return await write(false, true)\n', '          if (tools.problem !== null) return await write(false, false)\n', 'F'],
  svUnreadable: [SVC, '        if (tools.problem !== null) {\n          return {\n            ok: false,\n            error: `Nothing was changed: your tool settings could not be read (${tools.problem}). Every tool is off.', '        if (false as boolean) {\n          return {\n            ok: false,\n            error: `Nothing was changed: your tool settings could not be read (${tools.problem}). Every tool is off.', 'F'],
  svAlreadyOn: [SVC, '        if (tools.settings.enabled[TOOL_ID] === true) return { ok: true, status: await status() }\n', '', 'F'],
  svFolder: [SVC, '        if (workspace.folder === null || workspace.unusable !== null) {\n          return { ok: false, error: NO_FOLDER }', '        if (false as boolean) {\n          return { ok: false, error: NO_FOLDER }', 'F'],
  svNoNode: [SVC, '    if (node === null) return { ok: false, error: NO_NODE }\n', '', 'F'],
  svNoBox: [SVC, '    if (!box.ok) return { ok: false, error: `${NO_BOX} (${box.why})` }\n', '', 'F'],
  svTestFailed: [SVC, '        if (!tested.ok) {\n          return {\n            ok: false,\n            error: tested.error,', '        if (false as boolean) {\n          return {\n            ok: false,\n            error: tested.error,', 'F'],
  svAsk: [SVC, "        if (answer !== 'yes') {\n", '        if (false as boolean) {\n', 'F'],
  svCancelled: [SVC, "            ...(answer === 'no' || answer === 'stopped' ? { cancelled: true as const } : {})\n", '', 'F'],
  svFresh: [SVC, '        if (fresh.problem !== null) {\n          return {\n            ok: false,\n            error: `Nothing was changed: your tool settings could not be read (${fresh.problem}).`', '        if (false as boolean) {\n          return {\n            ok: false,\n            error: `Nothing was changed: your tool settings could not be read (${fresh.problem}).`', 'F'],
  svWrite: [SVC, '        const written = await write(true, false)\n', '        const written = await write(false, false)\n', 'F'],
  svCaps: [SVC, '{ enabled: { ...settings.enabled, [TOOL_ID]: on }, caps: { ...settings.caps } },', '{ enabled: { ...settings.enabled, [TOOL_ID]: on }, caps: {} },', 'F'],
  svAvail: [SVC, '      return !testing && lastTest !== null && lastTest.ok\n', '      return !testing\n', 'F'],
  svAvailOn: [SVC, '      if (tools.problem !== null || tools.settings.enabled[TOOL_ID] !== true) return false\n      // A switch that is on in the file', '      // A switch that is on in the file', 'F'],
  svLazy: [SVC, '      if (lastTest === null && !testing && !changing && background === null) void startUp()\n', '', 'F'],
  svDedupe: [SVC, '    if (background === null) {\n      background = testInBackground()', '    if (true as boolean) {\n      background = testInBackground()', 'F'],
  svStartOff: [SVC, '      problem = `Running programs was switched off at start-up: ${result.error}`\n      await write(false, false)\n', '      problem = `Running programs was switched off at start-up: ${result.error}`\n', 'F'],
  svStartProblem: [SVC, '      problem = `Running programs was switched off at start-up: ${result.error}`\n', '      problem = null\n', 'F'],
  svBgFolder: [SVC, '      if (workspace.folder === null || workspace.unusable !== null) return\n', '', 'F'],
  svThrowOff: [SVC, '      await write(false, false).catch(() => undefined)\n', '', 'F'],
  svStopFlag: [SVC, '      stoppedByPerson = true\n      control.abort()\n', '      control.abort()\n', 'F'],
  svSignal: [SVC, '        signal: controller.signal,\n', '', 'F'],
  svTestingEarly: [SVC, '    testing = true\n    stoppedByPerson = false\n    const controller = new AbortController()\n', '    stoppedByPerson = false\n    const controller = new AbortController()\n', 'F'],
  svStoppedEarly: [SVC, '      if (controller.signal.aborted) return { ok: false, error: STOPPED_EARLY }\n', '', 'F'],
  svWithAvail: [SVC, '  if (available) return settings\n', '', 'F'],
  svWithDelete: [SVC, '  for (const id of PROGRAM_TOOL_IDS) delete enabled[id]\n', '', 'F'],
  svWithCopy: [SVC, '  const enabled = { ...settings.enabled }\n  for (const id of PROGRAM_TOOL_IDS) delete enabled[id]\n', '  const enabled = settings.enabled\n  for (const id of PROGRAM_TOOL_IDS) delete enabled[id]\n', 'F'],
  svQCount: [SVC, 'passed all ${report.lines.length} checks', 'passed all 12 checks', 'F'],
  svQFolder: [SVC, "${folderName === null ? '' : ` (${folderName})`}", '', 'F'],
  // ----- selfTest.ts: the judge (D) -----
  jExit: [SLF, "  const ran = e.first.kind === 'ran' && e.first.exitCode === 0 && said !== null\n", "  const ran = e.first.kind === 'ran' && said !== null\n", 'D'],
  jRanHello: [SLF, "      'ran',\n      ran && said?.hello === 'in the box',\n", "      'ran',\n      ran,\n", 'D'],
  jOwn: [SLF, "      'own',\n      ran && said?.own === 'DONE:own',\n", "      'own',\n      ran,\n", 'D'],
  jRefused: [SLF, "typeof v === 'string' && v.startsWith('ERR:')", "typeof v === 'string'", 'D'],
  jLeak: [SLF, "  const leaked = e.secrets.some((s) => s !== '' && text.includes(s))\n", '  const leaked = false\n', 'D'],
  jLeakData: [SLF, "      'read-data',\n      refusedRead('readData') && !leaked,\n", "      'read-data',\n      refusedRead('readData'),\n", 'D'],
  jLeakTemp: [SLF, "      'read-temp',\n      refusedRead('readTemp') && !leaked,\n", "      'read-temp',\n      refusedRead('readTemp'),\n", 'D'],
  jListHome: [SLF, "      'list-home',\n      refusedRead('listHome'),\n", "      'list-home',\n      true,\n", 'D'],
  jWroteData: [SLF, WRITE_DATA, "      'write-data',\n      ran && refused(said?.writeData) && e.canariesIntact,\n", 'D'],
  jCanaryData: [SLF, WRITE_DATA, "      'write-data',\n      ran && refused(said?.writeData) && !e.wroteSomething,\n", 'D'],
  jRefusedData: [SLF, WRITE_DATA, "      'write-data',\n      ran && !e.wroteSomething && e.canariesIntact,\n", 'D'],
  jNodeSame: [SLF, '    nodeSame &&\n    !e.wroteSomething\n', '    !e.wroteSomething\n', 'D'],
  jNodeNull: [SLF, 'const nodeSame = sizes.before !== null && sizes.before === sizes.after', 'const nodeSame = sizes.before === sizes.after', 'D'],
  jTools: [SLF, '    refused(said?.writeTools) &&\n', '', 'D'],
  jAppend: [SLF, '    refused(said?.appendNode) &&\n', '', 'D'],
  jLauncherWrote: [SLF, '    nodeSame &&\n    !e.wroteSomething\n', '    nodeSame\n', 'D'],
  jListener: [SLF, 'const noNet = ran && e.listenerHits === 0 && (', 'const noNet = ran && (', 'D'],
  jTimeout: [SLF, "(refused(said.net) || said.net === 'TIMEOUT')", 'refused(said.net)', 'D'],
  jEnv: [SLF, 'const envGood = ran && JSON.stringify(names) === JSON.stringify(ENVIRONMENT)', 'const envGood = ran', 'D'],
  jEnvCase: [SLF, '.map((n) => String(n).toLowerCase())', '.map((n) => String(n))', 'D'],
  jTimedOut: [SLF, '    e.time.timedOut &&\n', '', 'D'],
  jTimeSlack: [SLF, '    e.time.elapsedMs <= e.timing.timeMs + e.timing.timeSlackMs\n', '    true\n', 'D'],
  jMemTimed: [SLF, MEM_GOOD, "const memGood = e.memory.kind === 'ran' && e.memory.exitCode !== 0", 'D'],
  jMemExit: [SLF, MEM_GOOD, "const memGood = e.memory.kind === 'ran' && !e.memory.timedOut", 'D'],
  jCleanProc: [SLF, CLEAN, '    e.leftovers.mounts === 0 && e.leftovers.live === 0\n', 'D'],
  jCleanMounts: [SLF, CLEAN, '    e.leftovers.processes === 0 && e.leftovers.live === 0\n', 'D'],
  jCleanLive: [SLF, CLEAN, '    e.leftovers.processes === 0 && e.leftovers.mounts === 0\n', 'D'],
  jLabel: [SLF, '  label: SELFTEST_PROBES.find((p) => p.id === id)?.label ?? id,\n', '  label: id,\n', 'D'],
  // ----- selfTest.ts: the test itself (E, the real box) and its sweep (G) -----
  rsOkAll: [SLF, '      ok: !aborted && lines.length === SELFTEST_PROBES.length && lines.every((l) => l.good),\n', '      ok: !aborted,\n', 'E'],
  rsNode: [SLF, '  if (options.nodePath === null) {\n    return failed(\n', '  if (false as boolean) {\n    return failed(\n', 'E'],
  rsTimeClock: [SLF, '    const time = await run(FOR_EVER, { timeoutMs: timing.timeMs })\n', '    const time = await run(FOR_EVER, { timeoutMs: 30_000 })\n', 'E'],
  rsCanaryRm: [SLF, '    for (const file of made) await fs.rm(file, { force: true }).catch(() => undefined)\n', '', 'E'],
  rsWritesRm: [SLF, '    for (const file of [writeData, writeLauncher, writeTools]) {\n      await fs.rm(file, { force: true }).catch(() => undefined)\n    }\n', '', 'E'],
  rsScratchRm: [SLF, '    await removeScratch(scratch, options.runRoot).catch(() => false)\n', '', 'E'],
  swPattern: [SLF, '  /^selftest-canary-[0-9a-f]{10}\\.txt$/,\n', '  /selftest-canary-[0-9a-f]{10}\\.txt/,\n', 'G'],
  swNames: [SLF, '      if (!OWN_FILES.some((pattern) => pattern.test(name))) continue\n', '', 'G'],
  swCount: [SLF, '        removed++\n', '', 'G'],
  // ----- programBox.ts (G) -----
  pbCache: [BOX, '      let runner = runners.get(chosen.root.toLowerCase())\n', '      let runner: CommandRunner | undefined\n', 'G'],
  pbStop: [BOX, '          runner.stopAll()\n', '', 'G'],
  pbStopCatch: [BOX, '        try {\n          runner.stopAll()\n        } catch {\n          /* ending the rest matters more */\n        }\n', '        runner.stopAll()\n', 'G'],
  pbMakeCatch: [BOX, "        try {\n          runner = make({ runRoot: chosen.root })\n        } catch (error) {\n          return {\n            ok: false,\n            why: error instanceof Error ? error.message : 'the runner could not be made'\n          }\n        }\n", '        runner = make({ runRoot: chosen.root })\n', 'G'],
  pbSweepExists: [BOX, '        try {\n          await fs.access(root)\n        } catch {\n          continue // no folder of runs there: nothing was left behind\n        }\n', '', 'G'],
  pbName: [BOX, "'FrontierRun'", "'frontier-run-x'", 'G'],
  pbFixed: [BOX, '    const fixed = usableFixed(options.fixedRunRoot?.())\n    if (fixed !== null) return [fixed]\n', '', 'G'],
  pbFixedRoot: [BOX, '  return win32.dirname(resolved) === resolved ? null : resolved\n', '  return resolved\n', 'G'],
  pbFixedAbsolute: [BOX, String.raw`  if (!win32.isAbsolute(value) || /^[\\/]{2}/.test(value) || !/^[A-Za-z]:/.test(value)) return null` + '\n', '', 'G'],
  // ----- the wiring (G: what the source must keep true) -----
  ipcStrip: [IPC, '        return withPrograms(withFiles, folder !== null && (await programService.available()))\n', '        return withFiles\n', 'G'],
  ipcFixedInstalled: [IPC, '      return value && !app.isPackaged ? value : null\n', '      return value ? value : null\n', 'G']
}

mkdirSync(join(TOOLS, 'specs135'), { recursive: true })
for (const [name, control] of Object.entries(controls)) {
  const [file, from, to, only] = control
  // a text with a quote or a comma inside it must be written as a string of its own kind: a check that the sabotage is what was meant
  if (typeof file !== 'string' || typeof from !== 'string' || typeof to !== 'string' || !/^[A-G]$/.test(only)) throw new Error(`the control ${name} is not well formed`)
  const spec = { label: `n135-${name}`, edits: [{ file, from, to }], argv: ['{{TOOLS}}/verify-13-5.mjs'], env: { ONLY: only }, timeoutMs: 600000 }
  writeFileSync(join(TOOLS, 'specs135', `n135-${name}.json`), JSON.stringify(spec, null, 2) + '\n')
}
console.log(`wrote ${Object.keys(controls).length} specs in specs135`)
