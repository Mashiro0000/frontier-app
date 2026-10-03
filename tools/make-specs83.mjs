// Writes the negative-control specs for slice 8.3 (the question before a very large request, D-032): one sabotage each, which the suite must notice.
// usage: node tools/make-specs83.mjs
//   then: node tools/check-specs.mjs                 (dry check: every sabotage text is found exactly once)
//         node tools/nc-all.mjs specs83 <names...>   (plain-Node suite verify-8-3.mjs)
//         node tools/nc-all.mjs specs83w <names...>  (the real window: setup-key.mjs + verify-8-3w.mjs; opens a window per sabotage)
// Each spec backs up the file, applies its sabotage, runs the suite, and puts the file back (proved by hash).
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { TOOLS } from './paths.mjs'
import { scratch } from './drive.mjs'

const R = '{{REPO}}/'
const ASK = R + 'src/shared/askFirst.ts', STORE = R + 'src/main/askFirst.ts', ROOM = R + 'src/main/confirmation.ts', CHAT = R + 'src/main/chat.ts', IPC = R + 'src/main/ipc.ts'
const VALIDATE = R + 'src/shared/validate.ts', FORMAT = R + 'src/renderer/src/settings/format.ts', DIALOG = R + 'src/renderer/src/chat/LargeRequestDialog.tsx'
const USECHAT = R + 'src/renderer/src/chat/useChat.ts', IPCREPLY = R + 'src/renderer/src/chat/ipcReply.ts', SECTION = R + 'src/renderer/src/settings/AskFirstSection.tsx'
const NEVER_NOT_ASKED = "{ setting: { kind: 'never' }, damaged: true }"
const CATCH_BLOCK = "  } catch {\n    return nothing(true)\n  }"
const SHOW_BLOCK = "        try {\n          show()\n        } catch {\n          finish('decline') // the question could not be put in front of anyone: nothing is sent\n        }\n"

// name: [[file, from, to], ...]
const node = {
  // the estimate: the input at the dearer of two prices, the reply at the output price, both added
  'n83-input-plain-price': [[ASK, 'Math.max(prices.inputPerMTok, prices.cacheWritePerMTok)', 'prices.inputPerMTok']],
  'n83-input-write-price-only': [[ASK, 'Math.max(prices.inputPerMTok, prices.cacheWritePerMTok)', 'prices.cacheWritePerMTok']],
  'n83-output-priced-as-input': [[ASK, 'const outputUsd = (maxOutputTokens * prices.outputPerMTok) / 1_000_000', 'const outputUsd = (maxOutputTokens * prices.inputPerMTok) / 1_000_000']],
  'n83-total-without-output': [[ASK, 'totalUsd: inputUsd + outputUsd', 'totalUsd: inputUsd']],
  // when the question is asked
  'n83-at-amount-asks': [[ASK, 'micros(estimate.inputUsd) > micros(above)', 'micros(estimate.inputUsd) >= micros(above)']],
  'n83-reply-counts-in-trigger': [[ASK, 'micros(estimate.inputUsd) > micros(above)', 'micros(estimate.totalUsd) > micros(above)']],
  'n83-never-still-asks': [[ASK, 'return above !== null && micros(estimate.inputUsd) > micros(above)', 'return micros(estimate.inputUsd) > micros(above ?? 0)']],
  'n83-no-micro-rounding': [[ASK, 'micros(estimate.inputUsd) > micros(above)', 'estimate.inputUsd > above']],
  'n83-default-amount-changed': [[ASK, 'export const ASK_FIRST_DEFAULT_USD = 0.5', 'export const ASK_FIRST_DEFAULT_USD = 1']],
  'n83-default-is-never': [[ASK, "return setting.kind === 'usd' ? setting.usd : ASK_FIRST_DEFAULT_USD", "return setting.kind === 'usd' ? setting.usd : null"]],
  // what is typed
  'n83-text-three-decimals': [[ASK, '(?:\\.(\\d{1,2}))?', '(?:\\.(\\d{1,3}))?']],
  'n83-text-zero-allowed': [[ASK, "if (!(usd > 0)) return { ok: false, error: 'The amount must be more than $0.' }", "if (usd < 0) return { ok: false, error: 'The amount must be more than $0.' }"]],
  'n83-text-no-maximum': [[ASK, '  if (usd > LIMIT_MAX_USD) {', '  if (false) {']],
  // what the page may hand over
  'n83-choice-accepts-default': [[ASK, "if (kind === 'never') return { ok: true, choice: { kind: 'never' } }", "if (kind === 'never' || kind === 'default') return { ok: true, choice: { kind: 'never' } }"]],
  'n83-choice-keeps-extra-fields': [[ASK, "if (kind === 'never') return { ok: true, choice: { kind: 'never' } } // nothing else it carries is read", "if (kind === 'never') return { ok: true, choice: input as AskFirstChoice }"]],
  'n83-choice-amount-unchecked': [[ASK, "if (kind === 'usd' && isLimitAmount(usd)) return", "if (kind === 'usd' && typeof usd === 'number') return"]],
  // the file: damage must never turn the question off
  'n83-file-not-json-is-never': [[ASK, CATCH_BLOCK, `  } catch {\n    return ${NEVER_NOT_ASKED}\n  }`]],
  'n83-file-cut-reads-never': [[ASK, CATCH_BLOCK, `  } catch {\n    return /nev/.test(text) ? ${NEVER_NOT_ASKED} : nothing(true)\n  }`]],
  'n83-file-never-any-case': [[ASK, "if (above === 'never') return { setting: { kind: 'never' }, damaged: false }", "if (typeof above === 'string' && above.toLowerCase() === 'never') return { setting: { kind: 'never' }, damaged: false }"]],
  'n83-file-bad-amount-is-never': [[ASK, "damaged: false }\n  return nothing(true)\n}", `damaged: false }\n  return ${NEVER_NOT_ASKED}\n}`]],
  'n83-file-version-ignored': [[ASK, '(raw as { version?: unknown }).version !== 1', 'false']],
  // the store
  'n83-store-missing-is-never': [[STORE, '        return { setting: defaultAskFirst(), keep: true }\n', "        return { setting: { kind: 'never' }, keep: true }\n"]],
  'n83-store-unreadable-throws': [[STORE, '      return { setting: defaultAskFirst(), keep: false }', '      throw error']],
  'n83-store-unreadable-kept': [[STORE, 'keep: false', 'keep: true']],
  'n83-store-bom-not-stripped': [[STORE, '    if (text.charCodeAt(0) === 0xfeff) text = text.slice(1) // a byte-order mark, which some editors add\n', '']],
  'n83-store-cache-not-updated': [[STORE, '        current = back.setting\n', '']],
  'n83-store-save-no-readback': [[STORE, 'if (back.damaged || !sameAskFirst(back.setting, choice)) {', 'if (false) {']],
  // the waiting room
  'n83-room-early-yes-remembered': [
    [ROOM, '  const pending = new Map<string, (answer: Answer) => void>()\n', '  const pending = new Map<string, (answer: Answer) => void>()\n  const early = new Set<string>()\n'],
    [ROOM, "        if (signal.aborted || pending.has(key)) {\n          resolve('decline')\n          return\n        }\n", "        if (early.delete(key)) {\n          resolve('send')\n          return\n        }\n        if (signal.aborted || pending.has(key)) {\n          resolve('decline')\n          return\n        }\n"],
    [ROOM, "      if (finish === undefined) return false\n", '      if (finish === undefined) {\n        early.add(key)\n        return false\n      }\n']
  ],
  'n83-room-abort-not-heard': [[ROOM, "        signal.addEventListener('abort', onAbort, { once: true })\n", '']],
  'n83-room-not-removed-on-answer': [[ROOM, '          pending.delete(key)\n', '']],
  'n83-room-duplicate-key-replaces': [[ROOM, 'if (signal.aborted || pending.has(key)) {', 'if (signal.aborted) {']],
  'n83-room-aborted-still-shows': [[ROOM, 'if (signal.aborted || pending.has(key)) {', 'if (pending.has(key)) {']],
  'n83-room-shown-before-waiting': [[ROOM, `        pending.set(key, finish)\n        signal.addEventListener('abort', onAbort, { once: true })\n${SHOW_BLOCK}`, `${SHOW_BLOCK}        pending.set(key, finish)\n        signal.addEventListener('abort', onAbort, { once: true })\n`]],
  'n83-room-show-throw-propagates': [[ROOM, SHOW_BLOCK, '        show()\n']],
  // the request carries no field that approves it
  'n83-request-keeps-confirmed-field': [[VALIDATE, '    request: {\n      streamId,\n      messages: clean,', "    request: {\n      streamId,\n      ...(typeof (input as Record<string, unknown>).confirmed === 'boolean' ? { confirmed: true } : {}),\n      messages: clean,"]],
  // how the amounts are written
  'n83-figures-round-down': [[FORMAT, 'Math.max(0, Math.ceil(dollars * 100 - 1e-7))', 'Math.max(0, Math.floor(dollars * 100))']],
  'n83-figures-no-epsilon': [[FORMAT, 'Math.ceil(dollars * 100 - 1e-7)', 'Math.ceil(dollars * 100)']],
  'n83-figures-total-unrounded': [[FORMAT, 'total: centsText(input + output)', 'total: centsText(ceilCents(estimate.totalUsd))']],
  // chat.ts, seen by the source checks of the Node suite
  'n83-chat-ceiling-constant': [[CHAT, 'estimateRequest(inputTokens, streamRequest.maxOutputTokens, entry.pricing)', 'estimateRequest(inputTokens, 16000, entry.pricing)']],
  'n83-chat-guess-twice': [[CHAT, '          inputTokens\n        },\n        (spend)', '          inputTokens: estimateInputTokens(streamRequest.system, streamRequest.messages)\n        },\n        (spend)']],
  'n83-chat-yes-key-without-window': [[CHAT, 'confirmations.send(`${event.sender.id}:${streamId}`)', 'confirmations.send(streamId)']],
  'n83-chat-yes-handler-untrusted': [[CHAT, "  ipcMain.on(CHANNELS.chatConfirm, (event, streamId: unknown) => {\n    if (!isTrustedSender(event, appUrl) || typeof streamId !== 'string') return", "  ipcMain.on(CHANNELS.chatConfirm, (event, streamId: unknown) => {\n    if (typeof streamId !== 'string') return"]],
  'n83-chat-answer-ignored': [[CHAT, "if (answer !== 'send' || controller.signal.aborted) return", 'void answer']],
  'n83-chat-no-limit-recheck': [
    [CHAT, '    const estimate = estimateRequest(', '    const limitsEarly = await readLimits()\n    if (limitsEarly === null) return\n    const estimate = estimateRequest('],
    [CHAT, '    const limits = await readLimits()\n    if (limits === null) return\n', '    const limits = limitsEarly\n']
  ]
}

const win = {
  // chat.ts: the question is never asked; the answer is ignored; the ledger is begun before the question; the limits are not looked at first; the saved choice is not read
  'w83-chat-no-question': [[CHAT, 'if (askAbove !== null && needsConfirmation(askFirst, estimate)) {', 'if (false) {']],
  'w83-chat-sends-whatever-the-answer': [[CHAT, "if (answer !== 'send' || controller.signal.aborted) return", 'void answer']],
  'w83-chat-ledger-before-question': [[CHAT, '      const answer = await confirmations.ask(key, controller.signal, () =>', '      await ledger.begin({ chat: null, provider: entry.provider, model: entry.id, effort, prices: entry.pricing, inputTokens })\n      const answer = await confirmations.ask(key, controller.signal, () =>']],
  'w83-chat-no-dry-check': [[CHAT, "      if (refusal !== null) {\n        send({ streamId, type: 'error', message: refusal })\n        return\n      }\n", '']],
  'w83-chat-yes-key-without-window': [[CHAT, 'confirmations.send(`${event.sender.id}:${streamId}`)', 'confirmations.send(streamId)']],
  'w83-chat-ignores-saved-choice': [[CHAT, 'const askFirst = await askFirstStore.read()', "const askFirst = { kind: 'default' } as const; void askFirstStore"]],
  // the waiting room hears a yes ahead of the question
  'w83-room-early-yes-remembered': [
    [ROOM, '  const pending = new Map<string, (answer: Answer) => void>()\n', '  const pending = new Map<string, (answer: Answer) => void>()\n  const early = new Set<string>()\n'],
    [ROOM, "        if (signal.aborted || pending.has(key)) {\n          resolve('decline')\n          return\n        }\n", "        if (early.delete(key)) {\n          resolve('send')\n          return\n        }\n        if (signal.aborted || pending.has(key)) {\n          resolve('decline')\n          return\n        }\n"],
    [ROOM, "      if (finish === undefined) return false\n", '      if (finish === undefined) {\n        early.add(key)\n        return false\n      }\n']
  ],
  // The room not hearing a stop is NOT seen by this suite on its own (the Node suite sees it): chat.ts also refuses to send when its signal was aborted, which stands
  // behind the room, so nothing a person or a script can do shows the difference. With both gone, a yes sent after a "no" sends the request, and this suite sees that.
  'w83-room-abort-not-heard-and-no-abort-check': [
    [ROOM, "        signal.addEventListener('abort', onAbort, { once: true })\n", ''],
    [CHAT, "if (answer !== 'send' || controller.signal.aborted) return", "if (answer !== 'send') return"]
  ],
  // the request carries a field that approves it: kept by the check AND honoured by chat.ts (a kept field nobody reads changes nothing, which is why the Node
  // suite, not this one, is what sees a field merely kept)
  'w83-request-field-approves': [
    [VALIDATE, '    request: {\n      streamId,\n      messages: clean,', "    request: {\n      streamId,\n      ...(typeof (input as Record<string, unknown>).confirmed === 'boolean' ? { confirmed: true } : {}),\n      messages: clean,"],
    [CHAT, 'if (askAbove !== null && needsConfirmation(askFirst, estimate)) {', "if (askAbove !== null && needsConfirmation(askFirst, estimate) && (request as { confirmed?: boolean }).confirmed !== true) {"]
  ],
  // ipc.ts: a choice from the page is saved without being checked; the status hides the choice
  'w83-set-ask-first-unchecked': [[IPC, 'const check = checkAskFirstChoice(input)\n      if (!check.ok) return check\n      try {\n        await askFirstStore.save(check.choice)', 'const check = { ok: true, choice: input as never }\n      try {\n        await askFirstStore.save(check.choice)']],
  'w83-status-hides-choice': [[IPC, 'askFirst: await askFirstStore.read()', "askFirst: { kind: 'default' } as const"]],
  // the page: Send says no, Don't send says yes, Escape says yes, the keyboard starts on Send, a Stop is not heard, the yes is never sent, the no is not told to main
  'w83-page-no-alertdialog-role': [[DIALOG, '      role="alertdialog"\n', '']],
  'w83-page-send-answers-no': [[DIALOG, '<button type="button" className="button" onClick={() => onAnswer(true)}>', '<button type="button" className="button" onClick={() => onAnswer(false)}>']],
  'w83-page-decline-answers-yes': [[DIALOG, 'onClick={() => onAnswer(false)}', 'onClick={() => onAnswer(true)}']],
  'w83-page-escape-answers-yes': [[DIALOG, 'if (request !== null) onAnswer(false)', 'if (request !== null) onAnswer(true)']],
  'w83-page-focus-on-send': [[DIALOG, 'declineRef.current?.focus() // the safe button first', "dialog.querySelector<HTMLButtonElement>('button.button:not(.button-secondary)')?.focus()"]],
  'w83-page-stop-not-heard': [[USECHAT, "      signal.addEventListener('abort', onAbort, { once: true })\n", '']],
  'w83-page-yes-not-sent': [[IPCREPLY, '        window.api.chat.confirm(streamId)\n', '']],
  'w83-page-no-not-told-to-main': [[IPCREPLY, '          window.api.chat.cancel(streamId) // main drops the question; nothing was sent\n', '']],
  // Settings: Save on while the box is not an amount; the warning for "Never ask" missing
  'w83-form-save-on-while-invalid': [[SECTION, 'const canSave = !busy && choice !== null && !unchanged', 'const canSave = !busy && !unchanged']],
  'w83-never-warning-missing': [[SECTION, '      {field.none && (', '      {false && (']]
}

const nodeDir = join(TOOLS, 'specs83')
mkdirSync(nodeDir, { recursive: true })
for (const [name, edits] of Object.entries(node)) {
  writeFileSync(join(nodeDir, `${name}.json`), JSON.stringify({ label: name, edits: edits.map(([file, from, to]) => ({ file, from, to })), argv: ['{{TOOLS}}/verify-8-3.mjs'], env: {} }, null, 2) + '\n')
}
const winEnv = (name) => ({ USER_DATA_DIR: scratch('s83nc'), WIPE_USER_DATA: '1', MOCK_PORT: '8799', PRESEED_FILE: '', LOG_LABEL: `nc-${name}` })
const winArgv = ['{{TOOLS}}/run-with-app.mjs', 'dev', 'setup-key.mjs,verify-8-3w.mjs', '{{OUT}}/shots', '9222']
const wdir = join(TOOLS, 'specs83w')
mkdirSync(wdir, { recursive: true })
for (const [name, edits] of Object.entries(win)) {
  writeFileSync(join(wdir, `${name}.json`), JSON.stringify({ label: name, edits: edits.map(([file, from, to]) => ({ file, from, to })), argv: winArgv, env: winEnv(name) }, null, 2) + '\n')
}
console.log(`wrote ${Object.keys(node).length} specs in specs83 and ${Object.keys(win).length} in specs83w`)
