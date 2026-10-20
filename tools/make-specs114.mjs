// Writes the negative-control specs for slice 11.4 (the window for tools, D-041): one sabotage each, which the suites must notice.
// usage: node tools/make-specs114.mjs
//   then: node tools/check-specs.mjs                  (dry check)
//         node tools/nc-all.mjs specs114 <names...>   (verify-11-4.mjs, plain Node)
//         node tools/nc-all.mjs specs114w <names...>  (run114.mjs: the real window)
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { TOOLS } from './paths.mjs'

const R = '{{REPO}}/src/'
const NOTES = R + 'shared/toolNotes.ts', VAL = R + 'shared/validate.ts', STORE = R + 'main/conversationStore.ts', SVC = R + 'main/toolSettingsService.ts'
const QUESTION = R + 'main/toolQuestion.ts', IPC = R + 'main/ipc.ts', CHAT = R + 'main/chat.ts', COMPOSER = R + 'renderer/src/chat/Composer.tsx', APP = R + 'renderer/src/App.tsx'
const BUBBLE = R + 'renderer/src/chat/MessageBubble.tsx', USECHAT = R + 'renderer/src/chat/useChat.ts', CONVERT = R + 'renderer/src/history/convert.ts'

const s = {
  piecesIgnoreOffset: [NOTES, 'at: Math.min(Math.max(note.offset, 0), content.length) }))', 'at: 0 }))'],
  sourcesNoDedupe: [NOTES, '      if (seen.has(source.url)) continue\n', ''],
  sourcesFromAnyCall: [NOTES, "    if (note.outcome.kind !== 'done') continue\n", "    if (note.outcome.kind === 'refused') continue\n"],
  settleKeepsOpen: [NOTES, "    note.outcome.kind === 'unanswered'\n", "    false\n"],
  titleNotChecked: [NOTES, '    if (title !== toolTitle(tool)) return null\n', ''],
  offsetNotBounded: [NOTES, '    if (!isCount(offset, 0, textLength)) return null\n', ''],
  addressHttp: [NOTES, "      parsed.protocol === 'https:' &&", '      true &&'],
  addressCredentials: [NOTES, "      parsed.username === '' &&", '      true &&'],
  addressNotCanonical: [NOTES, '      parsed.href === url\n', '      true\n'],
  titleNotTidy: [NOTES, '  text === text.trim() &&', '  true &&'],
  declineYes: [NOTES, "        raw.answer !== 'yes'", '        true'],
  sourcesUnbounded: [NOTES, 'if (!Array.isArray(raw) || raw.length > TOOL_RESULT_LIMITS.maxSources) return null', 'if (!Array.isArray(raw)) return null'],
  doneSentence: [NOTES, ": `You allowed it. ${plural(outcome.sources.length, 'source came', 'sources came')} back.`", ": 'Done.'"],
  userNotes: [VAL, "const notes = role === 'assistant' ? checkToolNotes(tools, content.length) : null", 'const notes = checkToolNotes(tools, content.length)'],
  oldFilesNotes: [VAL, "toolsAllowed: boolean = source === 'page'", 'toolsAllowed: boolean = true'],
  versionIgnoresNotes: [STORE, '  conversation.messages.some((message) => message.tools !== undefined)\n    ?', '  false\n    ?'],
  v6WithoutNotes: [STORE, "  if (file.version === 6 && !messages.messages.some((message) => message.tools !== undefined)) {", '  if (false) {'],
  v6BadProject: [STORE, "  if (file.version === 6 && file.project !== undefined && !isProjectId(file.project)) {", '  if (false) {'],
  onWithoutAsking: [SVC, '        const no = await ask(owner, toolOnQuestion(def, current.settings.caps), TOOL_NOT_ON)\n        if (no !== null) return no\n', ''],
  onWhenUnreadable: [SVC, '        if (current.problem !== null) return { ok: false, error: changeRefused(current.problem) }\n        if (toolIsOn(current.settings, tool)) return { ok: true, status: await status() }\n', '        if (toolIsOn(current.settings, tool)) return { ok: true, status: await status() }\n'],
  raiseWithoutAsking: [SVC, '        if (next.steps > from.steps || next.seconds > from.seconds) {', '        if (false) {'],
  raiseOnlySteps: [SVC, 'if (next.steps > from.steps || next.seconds > from.seconds) {', 'if (next.steps > from.steps) {'],
  capsUnbounded: [SVC, '        steps > s.max ||', '        steps > 99999 ||'],
  capsFractions: [SVC, '        !Number.isInteger(steps) ||\n', ''],
  notOneAtATime: [SVC, '    if (changing) return { ok: false, error: BUSY }', ''],
  resetWhenFine: [SVC, '        if (current.problem === null) return { ok: false, error: NOTHING_TO_RESET }', ''],
  providerNotNamed: [QUESTION, 'if (place?.provider !== undefined) lines.push(', 'if (false) lines.push('],
  ipcOwnerNull: [IPC, 'toolsService.setEnabled(window, input)', 'toolsService.setEnabled(null, input)'],
  ipcCapsOwnerNull: [IPC, 'toolsService.setCaps(window, input)', 'toolsService.setCaps(null, input)'],
  stopLabel: [COMPOSER, "{stopEverything ? 'Stop everything' : 'Stop'}", '{`Stop`}'],
  stopNotTold: [APP, 'toolsOn={anyToolOn(toolSettings.status, toolSettings.workspace, toolSettings.programs)}', 'toolsOn={false}'],
  noteNotShown: [BUBBLE, '<ToolNote key={`note-${piece.note.id}`} note={piece.note} live={live} />', 'null'],
  sourcesNotShown: [BUBBLE, '{sources.length > 0 && <Sources sources={sources} />}', '{false && <Sources sources={sources} />}'],
  offsetZero: [USECHAT, 'if (!toolOffsets.has(event.call)) toolOffsets.set(event.call, written)', 'if (!toolOffsets.has(event.call)) toolOffsets.set(event.call, 0)'],
  noSettle: [USECHAT, '        ...(m.tools !== undefined ? { tools: settleNotes(m.tools, stopped) } : {})\n', ''],
  notSaved: [CONVERT, "...(role === 'assistant' && tools !== undefined && tools.length > 0 ? { tools } : {})", '...{}'],
  notLoaded: [CONVERT, '    ...(tools !== undefined ? { tools } : {})\n', ''],
  settingsNotReloaded: [APP, '    reloadToolSettings()\n', ''], // (D-051: inside openTools, which the sidebar's Tools button calls)
  providerNotPassed: [CHAT, '            provider: PROVIDER_NAMES[entry.provider],\n', '']
}

const node = [
  'piecesIgnoreOffset', 'sourcesNoDedupe', 'sourcesFromAnyCall', 'settleKeepsOpen', 'titleNotChecked', 'offsetNotBounded', 'addressHttp', 'addressCredentials',
  'addressNotCanonical', 'titleNotTidy', 'declineYes', 'sourcesUnbounded', 'doneSentence', 'userNotes', 'oldFilesNotes', 'versionIgnoresNotes', 'v6WithoutNotes',
  'v6BadProject', 'onWithoutAsking', 'onWhenUnreadable', 'raiseWithoutAsking', 'raiseOnlySteps', 'capsUnbounded', 'capsFractions', 'notOneAtATime', 'resetWhenFine',
  'providerNotNamed', 'ipcOwnerNull', 'ipcCapsOwnerNull', 'stopLabel', 'stopNotTold'
]
const win = [
  'noteNotShown', 'sourcesNotShown', 'offsetZero', 'noSettle', 'notSaved', 'notLoaded', 'settingsNotReloaded', 'providerNotPassed', 'onWithoutAsking',
  'raiseWithoutAsking', 'stopLabel', 'stopNotTold', 'doneSentence', 'ipcOwnerNull'
]
const kebab = (n) => n.replace(/[A-Z]/g, (c) => '-' + c.toLowerCase())
const write = (dir, prefix, names, argv, env, timeoutMs) => {
  mkdirSync(join(TOOLS, dir), { recursive: true })
  for (const name of names) {
    const [file, from, to] = s[name]
    const label = `${prefix}-${kebab(name)}`
    writeFileSync(join(TOOLS, dir, `${label}.json`), JSON.stringify({ label, edits: [{ file, from, to }], argv, env, ...(timeoutMs ? { timeoutMs } : {}) }, null, 2) + '\n')
  }
}
write('specs114', 'n114', node, ['{{TOOLS}}/verify-11-4.mjs'], {})
write('specs114w', 'w114', win, ['{{TOOLS}}/run114.mjs', 'dev'], { NO_RETRY: '1' }, 600000)
console.log(`wrote ${node.length} specs in specs114 and ${win.length} in specs114w`)
