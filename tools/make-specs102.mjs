// Writes the negative-control specs for slice 10.2 (the instructions for every chat, D-039): one sabotage each, which the suites must notice.
// usage: node tools/make-specs102.mjs
//   then: node tools/check-specs.mjs                  (dry check)
//         node tools/nc-all.mjs specs102 <names...>   (verify-10-2.mjs, plain Node)
//         node tools/nc-all.mjs specs102w <names...>  (run102.mjs: the real window)
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { TOOLS } from './paths.mjs'

const R = '{{REPO}}/'
const SEC = R + 'src/main/secrets.ts', KEPT = R + 'src/main/keptFile.ts', EVERY = R + 'src/main/everyChat.ts', REQ = R + 'src/main/providers/request.ts'
const ENC = R + 'src/main/chatEncryptionService.ts', CHAT = R + 'src/main/chat.ts', IPC = R + 'src/main/ipc.ts'
const DLG = R + 'src/renderer/src/instructions/InstructionsDialog.tsx', BAR = R + 'src/renderer/src/chat/ChatBar.tsx', APP = R + 'src/renderer/src/App.tsx'

const s = {
  noPiece: [SEC, '      if (text.includes(piece) || squeezed.includes(piece)) return provider', '      void piece'],
  noSqueeze: [SEC, "  const squeezed = text.replace(/\\s+/g, '')", '  const squeezed = text'],
  maskLeaks: [SEC, "  return `${chars.slice(0, 4).join('')}…${chars.slice(-2).join('')} (${chars.length} characters)`", '  return `${part} (${chars.length} characters)`'],
  noDigitRule: [SEC, '  return /[a-z]/.test(run) && /[A-Z]/.test(run) && digits >= 2 && bitsPerChar(run) >= 4', '  return digits >= 0 && bitsPerChar(run) >= 4'],
  anywayPassesKey: [SEC, '  if (held !== null) return { ok: false, error: heldKeySentence(held, kept) }', '  if (held !== null && !saveAnyway) return { ok: false, error: heldKeySentence(held, kept) }'],
  warnIgnored: [SEC, '  if (lookalikes.length > 0 && !saveAnyway) {', '  if (lookalikes.length < 0 && !saveAnyway) {'],
  keptOverwrites: [KEPT, '    if (!replace) {\n      throw new KeptRefused', '    if (replace === 42) {\n      throw new KeptRefused'],
  keptNoAside: [KEPT, '    await setAside(pathOf())\n', ''],
  keptTmpIgnored: [KEPT, "      if (value !== null) return { state: 'ok', value, form: tmp.form }", '      void value'],
  keptPlainWhenSealed: [KEPT, "    const data = form === 'encrypted' && box !== undefined ? sealChat(plain, box) : plain", '    const data = plain'],
  keptConformSkips: [KEPT, "        if (current.form === mode.form) return 'already'", "        return 'already'"],
  everyIgnoresNo: [EVERY, "        if (answer === 'no') return { ok: false, cancelled: true, error: EVERY_CHAT_NOT_SAVED }\n", ''],
  everyNoQuestion: [EVERY, '        const answer = await options.gate.ask(\n          owner,\n          everyChatQuestion(next, { warned: secrets.warned, replacing: damaged })\n        )', "        const answer = await Promise.resolve('yes' as string)\n        void everyChatQuestion(next, { warned: secrets.warned, replacing: damaged })"],
  everyEmptyAsks: [EVERY, "      if (next !== '') {\n        const secrets = checkForSecrets(", "      if (next !== '' || damaged === damaged) {\n        const secrets = checkForSecrets("],
  everySameAsks: [EVERY, "      if (!damaged && next === (before.state === 'ok' ? before.value : '')) {", '      if (!damaged && next === undefined) {'],
  everyEmptyObjectClears: [EVERY, "  if (typeof text !== 'string') return { ok: false, error: NOT_UNDERSTOOD }\n", ''],
  everyAnywayLoose: [EVERY, '  return { ok: true, text: checked.instructions, saveAnyway: saveAnyway === true }', '  return { ok: true, text: checked.instructions, saveAnyway: !!saveAnyway }'],
  everyDamagedSends: [EVERY, "      if (now.state === 'unreadable') return { ok: false, error: everyChatUnreadable(now.why) }\n", ''],
  everyDamagedNoReplace: [EVERY, '        else await file.write(next, { replace: damaged })', '        else await file.write(next)'],
  everyParseLoose: [EVERY, '  if (fields.version !== EVERY_CHAT_FILE_VERSION || Object.keys(fields).length !== 2) return null', '  if (fields.version !== EVERY_CHAT_FILE_VERSION) return null'],
  everyQuestionNoText: [EVERY, '    `"${start}"`,', "    '(your text)',"],
  everyCheckOpen: [EVERY, '    return secrets.ok ? { ok: true } : secrets', '    return { ok: true }'],
  promptEveryDropped: [REQ, "  if (every !== '') pieces.push(EVERY_CHAT_LEAD, every)\n", ''],
  promptOrder: [REQ, "  if (every !== '') pieces.push(EVERY_CHAT_LEAD, every)\n  if (own !== '') pieces.push(every === '' ? INSTRUCTIONS_LEAD : CHAT_AFTER_OTHERS_LEAD, own)", "  if (own !== '') pieces.push(every === '' ? INSTRUCTIONS_LEAD : CHAT_AFTER_OTHERS_LEAD, own)\n  if (every !== '') pieces.push(EVERY_CHAT_LEAD, every)"],
  promptSameLead: [REQ, "  if (own !== '') pieces.push(every === '' ? INSTRUCTIONS_LEAD : CHAT_AFTER_OTHERS_LEAD, own)", "  if (own !== '') pieces.push(CHAT_AFTER_OTHERS_LEAD, own)"],
  buildDropsEvery: [REQ, '    system: systemPromptFor(model.provider, input.instructions, { everyChat: input.everyChat }),', '    system: systemPromptFor(model.provider, input.instructions),'],
  encNoDocuments: [ENC, '    return { documents: await documents.conform() }', '    return {}'],
  encShortCircuit: [ENC, "    if (before.choice === 'on' && counts.plain === 0 && plainFiles === 0 && plainDocuments === 0) {", "    if (before.choice === 'on' && counts.plain === 0 && plainFiles === 0 && plainDocuments >= 0) {"],
  chatNoEvery: [CHAT, "    if (!everyChat.ok) {\n      send({ streamId, type: 'error', message: everyChat.error })\n      return\n    }\n", ''],
  chatSkipsEvery: [CHAT, "      everyChat: everyChat.text, // before the chat's own (D-039)", "      everyChat: '', // sabotaged"],
  chatNoKeyCheck: [CHAT, '      if (held !== null) {', '      if (held === "never") {'],
  ipcNoWindow: [IPC, '      everyChat.save(window, input)', '      everyChat.save(null, input)'],
  dlgEscapeWhileBusy: [DLG, '        if (busy.current) event.preventDefault()', '        void busy.current'],
  dlgChangeWhileUnsaved: [DLG, "                  disabled={busy || unsaved || (part === 'every' && everyChat === null)}", "                  disabled={busy || (part === 'every' && everyChat === null)}"],
  dlgAnywaySticks: [DLG, '            setDraft(event.target.value)\n            setWarnings(null)', '            setDraft(event.target.value)'],
  dlgSavedNotTold: [DLG, '    if (result.ok) onEveryChatSaved(result.status) // the chat bar learns of it even if the dialog has gone\n', ''],
  dlgNoReplace: [DLG, '  const changed = text !== saved || replacing', '  const changed = text !== saved'],
  barNoEveryMark: [BAR, "          (instructions !== '' || (everyChat?.text ?? '') !== '') && (", "          instructions !== '' && ("],
  barNoProblemMark: [BAR, '        {everyChat?.problem != null ? (', '        {everyChat?.problem === 12345 ? ('],
  appNoReload: [APP, '          everyChat.reload()\n', '']
}

const node = {
  'n102-no-piece': [s.noPiece],
  'n102-no-squeeze': [s.noSqueeze],
  'n102-mask-leaks': [s.maskLeaks],
  'n102-no-digit-rule': [s.noDigitRule],
  'n102-anyway-passes-key': [s.anywayPassesKey],
  'n102-warn-ignored': [s.warnIgnored],
  'n102-kept-overwrites': [s.keptOverwrites],
  'n102-kept-no-aside': [s.keptNoAside],
  'n102-kept-tmp-ignored': [s.keptTmpIgnored],
  'n102-kept-plain-when-sealed': [s.keptPlainWhenSealed],
  'n102-kept-conform-skips': [s.keptConformSkips],
  'n102-every-ignores-no': [s.everyIgnoresNo],
  'n102-every-no-question': [s.everyNoQuestion],
  'n102-every-empty-asks': [s.everyEmptyAsks],
  'n102-every-same-asks': [s.everySameAsks],
  'n102-every-empty-object-clears': [s.everyEmptyObjectClears],
  'n102-every-anyway-loose': [s.everyAnywayLoose],
  'n102-every-damaged-sends': [s.everyDamagedSends],
  'n102-every-damaged-no-replace': [s.everyDamagedNoReplace],
  'n102-every-parse-loose': [s.everyParseLoose],
  'n102-every-question-no-text': [s.everyQuestionNoText],
  'n102-every-check-open': [s.everyCheckOpen],
  'n102-prompt-every-dropped': [s.promptEveryDropped],
  'n102-prompt-order': [s.promptOrder],
  'n102-prompt-same-lead': [s.promptSameLead],
  'n102-build-drops-every': [s.buildDropsEvery],
  'n102-enc-no-documents': [s.encNoDocuments],
  'n102-enc-short-circuit': [s.encShortCircuit],
  'n102-chat-no-every': [s.chatNoEvery],
  'n102-chat-no-key-check': [s.chatNoKeyCheck],
  'n102-ipc-no-window': [s.ipcNoWindow]
}

const win = {
  'w102-every-no-question': [s.everyNoQuestion],
  'w102-every-ignores-no': [s.everyIgnoresNo],
  'w102-chat-skips-every': [s.chatSkipsEvery],
  'w102-every-damaged-sends': [s.everyDamagedSends],
  'w102-chat-no-key-check': [s.chatNoKeyCheck],
  'w102-every-check-open': [s.everyCheckOpen],
  'w102-dlg-escape-while-busy': [s.dlgEscapeWhileBusy],
  'w102-dlg-change-while-unsaved': [s.dlgChangeWhileUnsaved],
  'w102-dlg-anyway-sticks': [s.dlgAnywaySticks],
  'w102-dlg-saved-not-told': [s.dlgSavedNotTold],
  'w102-dlg-no-replace': [s.dlgNoReplace],
  'w102-bar-no-every-mark': [s.barNoEveryMark],
  'w102-bar-no-problem-mark': [s.barNoProblemMark],
  'w102-app-no-reload': [s.appNoReload],
  'w102-enc-no-documents': [s.encNoDocuments],
  'w102-ipc-no-window': [s.ipcNoWindow],
  'w102-prompt-order': [s.promptOrder]
}

const write = (dir, specs, argv, env, timeoutMs) => {
  mkdirSync(join(TOOLS, dir), { recursive: true })
  for (const [name, edits] of Object.entries(specs)) {
    writeFileSync(join(TOOLS, dir, `${name}.json`), JSON.stringify({ label: name, edits: edits.map(([file, from, to]) => ({ file, from, to })), argv, env, ...(timeoutMs ? { timeoutMs } : {}) }, null, 2) + '\n')
  }
}
write('specs102', node, ['{{TOOLS}}/verify-10-2.mjs'], {})
write('specs102w', win, ['{{TOOLS}}/run102.mjs', 'dev'], { NO_RETRY: '1' }, 500000)
console.log(`wrote ${Object.keys(node).length} specs in specs102 and ${Object.keys(win).length} in specs102w`)
