// Writes the negative-control specs for slice 9.3 (sending and saving files, D-037): one sabotage each, which the suites must notice.
// usage: node tools/make-specs93.mjs
//   then: node tools/check-specs.mjs                 (dry check)
//         node tools/nc-all.mjs specs93 <names...>   (verify-9-3.mjs, plain Node)
//         node tools/nc-all.mjs specs93w <names...>  (run93.mjs: the real window; each spec runs only the launches it needs, RUN93_ONLY)
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { TOOLS } from './paths.mjs'

const R = '{{REPO}}/'
const VAL = R + 'src/shared/validate.ts', CONV = R + 'src/main/conversationStore.ts', REQ = R + 'src/main/attachmentRequest.ts', BAK = R + 'src/main/backup.ts'
const ANT = R + 'src/main/providers/anthropic.ts', OAI = R + 'src/main/providers/openai.ts', RQ = R + 'src/main/providers/request.ts', REG = R + 'src/shared/registry.ts'
const ENC = R + 'src/main/chatEncryptionService.ts', CHAT = R + 'src/main/chat.ts', IPC = R + 'src/main/ipc.ts'
const WIRE = R + 'src/renderer/src/chat/history.ts', CONVERT = R + 'src/renderer/src/history/convert.ts', TXT = R + 'src/renderer/src/chat/attachmentText.ts'
const STORAGE = R + 'src/renderer/src/settings/useChatStorage.ts', VIEW = R + 'src/renderer/src/chat/ChatView.tsx', COMP = R + 'src/renderer/src/chat/Composer.tsx'
const PREV = R + 'src/renderer/src/chat/previews.ts', BUBBLE = R + 'src/renderer/src/chat/MessageBubble.tsx'

const node = {
  // what the page may send and save
  'n93-val-files-on-reply': [[VAL, "      const checked = role === 'user' ? checkWireAttachments(attachments) : null", '      const checked = checkWireAttachments(attachments)']],
  'n93-val-no-chat-cap': [[VAL, '  if (files.size > ATTACHMENT_LIMITS.perChat) {', '  if (false as boolean) {']],
  'n93-val-twice-on-message': [[VAL, "    if (!isAttachmentId(id) || seen.has(id) || typeof name !== 'string' || name.length > 1000)", "    if (!isAttachmentId(id) || typeof name !== 'string' || name.length > 1000)"]],
  'n93-val-name-not-cleaned': [[VAL, "    files.push({ id, name: cleanFileName(name, 'file') })", '    files.push({ id, name })']],
  'n93-val-empty-message': [[VAL, "    if (content === '' && named.length === 0) return refuse('The request was not understood.')\n", '']],
  'n93-val-info-kind-mismatch': [[VAL, '  if (kind !== MEDIA_KIND[type] || !isCount(bytes, ATTACHMENT_LIMITS.maxPdfBytes)) return null', '  if (!isCount(bytes, ATTACHMENT_LIMITS.maxPdfBytes)) return null']],
  'n93-val-info-folder-name': [[VAL, "    cleanFileName(name, '') !== name\n", '    name.length > 100000\n']],
  'n93-val-saved-files-on-reply': [[VAL, "        role !== 'user' ||\n        !Array.isArray(attachments) ||", '        !Array.isArray(attachments) ||']],
  'n93-val-saved-old-files-read': [[VAL, '    if (attachments !== undefined && filesAllowed) {', '    if (attachments !== undefined) {']],
  'n93-val-saved-twice': [[VAL, '        if (info === null || files.some((there) => there.id === info.id)) {', '        if (info === null) {']],
  // the chat file and the backup
  'n93-conv-always-v4': [[CONV, '  conversation.messages.some((message) => message.attachments !== undefined) ? 4 : 3', '  4']],
  'n93-conv-refs-always-complete': [[CONV, '        return { ids, complete: unreadable.size === 0 }', '        return { ids, complete: true }']],
  'n93-conv-title-no-files': [[CONV, "        : (firstMessage.attachments ?? []).map((file) => file.name).join(', ')", "        : ''"]],
  'n93-backup-always-v3': [[BAK, '  JSON.stringify({ version: fileVersion(chat), ...chat })', '  JSON.stringify({ version: 3, ...chat })']],
  // the files of a request
  'n93-req-no-image-check': [[REQ, "      if (facts.kind === 'image' && !model.capabilities.imageInput) {", '      if (false as boolean) {']],
  'n93-req-no-pdf-check': [[REQ, "      if (facts.kind === 'pdf' && !model.capabilities.documentInput) {", '      if (false as boolean) {']],
  'n93-req-no-bytes-cap': [[REQ, '  if (files.bytes > L.maxRequestBytes) {', '  if (false as boolean) {']],
  'n93-req-no-pages-cap': [[REQ, '  if (files.pdfPages > L.maxRequestPages) {', '  if (false as boolean) {']],
  'n93-req-no-text-cap': [[REQ, '  if (files.textChars > L.maxRequestTextChars) {', '  if (false as boolean) {']],
  'n93-req-pdf-name-as-is': [[REQ, "        attached.push({ kind: 'pdf', name: pdfName(name), data: bytes.toString('base64') })", "        attached.push({ kind: 'pdf', name, data: bytes.toString('base64') })"]],
  // the adapters
  'n93-ant-text-first': [[ANT, "  if (message.content !== '') blocks.push({ type: 'text', text: message.content })", "  if (message.content !== '') blocks.unshift({ type: 'text', text: message.content })"]],
  'n93-ant-empty-text-block': [[ANT, "  if (message.content !== '') blocks.push({ type: 'text', text: message.content })", "  blocks.push({ type: 'text', text: message.content })"]],
  'n93-ant-pdf-untitled': [[ANT, "            source: { type: 'base64', media_type: 'application/pdf', data: file.data },\n            title: file.name\n", "            source: { type: 'base64', media_type: 'application/pdf', data: file.data }\n"]],
  'n93-ant-no-files-as-blocks': [[ANT, '  if (message.attachments === undefined) return { role: message.role, content: message.content }', "  if (message.attachments === undefined) return { role: message.role, content: [{ type: 'text', text: message.content }] }"]],
  'n93-oai-no-lead': [[OAI, "        : { type: 'input_text', text: `${textFileLead(file.name)}\\n\\n${file.text}` }", "        : { type: 'input_text', text: file.text }"]],
  'n93-oai-bad-detail': [[OAI, "          detail: 'auto'", "          detail: 'none' as 'auto'"]],
  'n93-oai-empty-text-part': [[OAI, "  if (message.content !== '') parts.push({ type: 'input_text', text: message.content })", "  parts.push({ type: 'input_text', text: message.content })"]],
  'n93-merge-drops-files': [[RQ, '      if (message.attachments !== undefined) {\n        last.attachments = [...(last.attachments ?? []), ...message.attachments]\n      }\n', '']],
  // the registry and what the page is told
  'n93-reg-option-document-always': [[REG, '    documentInput: entry.capabilities.documentInput', '    documentInput: true']],
  // encryption
  'n93-enc-files-not-reported': [[ENC, '      report: { ...done, backup, ...withFiles(filesDone), ...documentsDone }', '      report: { ...done, backup, ...documentsDone }']], // the documents (10.2, D-039) are not this control's business
  'n93-enc-files-always-said': [[ENC, '  ): { files?: { changed: number; failed: number } } => (done === null ? {} : { files: done })', '  ): { files?: { changed: number; failed: number } } => ({ files: done ?? { changed: 0, failed: 0 } })']],
  'n93-storage-plain-wording': [[STORAGE, "        `Rewrote ${attached(report.files.changed)} as ${report.files.changed === 1 ? 'a plain file' : 'plain files'} too.`", '        `Rewrote ${attached(report.files.changed)} as plain files too.`']],
  // main's wiring (source checks)
  'n93-chat-sends-anyway': [[CHAT, "      send({ streamId, type: 'error', message: resolved.error })\n      return\n", "      send({ streamId, type: 'error', message: resolved.error })\n"]],
  'n93-ipc-delete-ignores-complete': [[IPC, '          if (refs.complete) await attachments.deleteUnused(files, refs.ids)', '          await attachments.deleteUnused(files, refs.ids)']],
  'n93-ipc-hold-kept-after-save': [[IPC, '            for (const file of message.attachments ?? []) attachments.release(file.id)', '            void message']],
  // the page's side
  'n93-wire-drops-files-only': [[WIRE, "    .filter((message) => message.content !== '' || (message.files?.length ?? 0) > 0)", "    .filter((message) => message.content !== '')"]],
  'n93-save-keeps-pictures': [[CONVERT, '      ? { attachments: files.map((file) => file.info) }', '      ? { attachments: files }']],
  'n93-block-ignores-earlier': [[TXT, '  const all = chatFiles(messages, draft)', '  const all = chatFiles([], draft)']],
  'n93-block-text-as-pdf': [[TXT, "  if (!model.documentInput && all.some((file) => file.info.kind === 'pdf')) {", "  if (!model.documentInput && all.some((file) => file.info.kind !== 'image')) {"]],
  'n93-chatfiles-twice': [[TXT, '    if (!seen.has(file.info.id)) seen.set(file.info.id, file)', '    seen.set(`${file.info.id}${seen.size}`, file)']]
}

// The window (run93.mjs; RUN93_ONLY picks the launches a spec needs)
const W = { RUN93_ONLY: 'w' }, WB = { RUN93_ONLY: 'wb' }, C = { RUN93_ONLY: 'c' }
const win = {
  'w93-chips-stay': [W, [[VIEW, "      attachments.clear() // the files are the message's now; main keeps them for the chat\n", '']]],
  'w93-files-not-sent': [W, [[VIEW, '      send(text, attachments.files)', '      send(text, [])']]],
  'w93-files-only-cannot-send': [W, [[COMP, "  const canSend = (text.trim() !== '' || hasFiles) && !isReplying && blocked === null", "  const canSend = text.trim() !== '' && !isReplying && blocked === null"]]],
  'w93-no-message-files': [W, [[BUBBLE, '      {message.files !== undefined && message.files.length > 0 && (', '      {false && (']]],
  'w93-no-previews': [W, [[VIEW, '      <PreviewsContext.Provider value={previews}>', '      <PreviewsContext.Provider value={new Map()}>']]],
  'w93-previews-not-reset': [W, [[PREV, '    if (asked.current.chatId !== chatId) asked.current = { chatId, ids: new Set() }\n', '']]],
  'w93-hold-kept-after-save': [W, [[IPC, '            for (const file of message.attachments ?? []) attachments.release(file.id)', '            void message']]],
  'w93-delete-keeps-files': [W, [[IPC, '        if (removed.ok && files.length > 0) {', '        if (false as boolean) {']]],
  'w93-encryption-skips-files': [W, [[IPC, '    files: attachments,\n    documents:', '    documents:']]], // since 10.2 a line about the kept documents follows (D-039)
  'w93-backup-always-v3': [W, [[BAK, '  JSON.stringify({ version: fileVersion(chat), ...chat })', '  JSON.stringify({ version: 3, ...chat })']]],
  'w93-sweep-off': [WB, [[IPC, '    .then((refs) => (refs.complete ? attachments.sweep(refs.ids, 3_600_000) : undefined))', '    .then(() => undefined)']]],
  'w93-sweep-young': [WB, [[IPC, '    .then((refs) => (refs.complete ? attachments.sweep(refs.ids, 3_600_000) : undefined))', '    .then((refs) => (refs.complete ? attachments.sweep(refs.ids, 0) : undefined))']]],
  'w93-no-blocked-line': [C, [[COMP, '      {blocked !== null && (', '      {false && (']]],
  'w93-block-not-passed': [C, [[VIEW, '        blocked={blocked}\n', '']]]
}

const write = (dir, specs, argv, timeoutMs, envOf) => {
  mkdirSync(join(TOOLS, dir), { recursive: true })
  for (const [name, spec] of Object.entries(specs)) {
    const [env, edits] = envOf(spec)
    writeFileSync(join(TOOLS, dir, `${name}.json`), JSON.stringify({ label: name, edits: edits.map(([file, from, to]) => ({ file, from, to })), argv, env, ...(timeoutMs ? { timeoutMs } : {}) }, null, 2) + '\n')
  }
}
write('specs93', node, ['{{TOOLS}}/verify-9-3.mjs'], 0, (edits) => [{}, edits])
write('specs93w', win, ['{{TOOLS}}/run93.mjs', 'dev'], 600000, ([env, edits]) => [{ NO_RETRY: '1', ...env }, edits])
console.log(`wrote ${Object.keys(node).length} specs in specs93 and ${Object.keys(win).length} in specs93w`)
