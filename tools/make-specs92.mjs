// Writes the negative-control specs for slice 9.2 (getting files in, D-037): one sabotage each, which the suites must notice.
// usage: node tools/make-specs92.mjs
//   then: node tools/check-specs.mjs                 (dry check)
//         node tools/nc-all.mjs specs92 <names...>   (verify-9-2.mjs, plain Node)
//         node tools/nc-all.mjs specs92w <names...>  (run92.mjs: the real window, one launch each)
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { TOOLS } from './paths.mjs'

const R = '{{REPO}}/'
const SVC = R + 'src/main/attachmentService.ts', VAL = R + 'src/shared/validate.ts', TXT = R + 'src/renderer/src/chat/attachmentText.ts', IPC = R + 'src/main/ipc.ts'
const PRE = R + 'src/preload/index.ts', DLG = R + 'src/main/backupDialogs.ts', HOOK = R + 'src/renderer/src/chat/useAttachments.ts', CHIPS = R + 'src/renderer/src/chat/AttachmentChips.tsx'
const VIEW = R + 'src/renderer/src/chat/ChatView.tsx', COMP = R + 'src/renderer/src/chat/Composer.tsx', APP = R + 'src/renderer/src/App.tsx', CSS = R + 'src/renderer/src/assets/main.css'

const node = {
  'n92-svc-no-lock': [[SVC, "      if (picking) return { ok: false, error: 'The window for choosing files is already open.' }\n", '']],
  'n92-svc-no-cap': [[SVC, '        for (const path of paths.slice(0, max)) {', '        for (const path of paths) {']],
  'n92-svc-path-in-refusal': [[SVC, "            refused.push(`${cleanFileName(path, 'A file')} was not attached: ${read.why}.`)", '            refused.push(`${path} was not attached: ${read.why}.`)']],
  'n92-svc-no-cap-note': [[SVC, '        if (paths.length > max) {', '        if (false as boolean) {']],
  'n92-svc-whole-buffer': [[SVC, '      const bytes = Buffer.from(check.bytes.buffer, check.bytes.byteOffset, check.bytes.byteLength)', '      const bytes = Buffer.from(check.bytes.buffer)']],
  'n92-svc-discard-ignores-refs': [[SVC, '      if (used !== null) await store.deleteUnused([id], used)', '      await store.deleteUnused([id], new Set())']],
  'n92-svc-discard-null-deletes': [[SVC, '      if (used !== null) await store.deleteUnused([id], used)', '      await store.deleteUnused([id], used ?? new Set())']],
  'n92-svc-no-local-rules': [[SVC, '          const read = await readLocalFile(path, MAX_INPUT_BYTES)', "          const read = await readLocalFile(path, MAX_INPUT_BYTES, 'linux')"]],
  'n92-val-any-bytes': [[VAL, "  if (typeof name !== 'string' || name.length > 1000 || !(bytes instanceof Uint8Array)) return bad", "  if (typeof name !== 'string' || name.length > 1000 || bytes === undefined) return bad"]],
  'n92-val-no-size': [[VAL, '  if (bytes.byteLength > maxBytes) {', '  if (false as boolean) {']],
  'n92-val-long-name': [[VAL, "  if (typeof name !== 'string' || name.length > 1000 || !(bytes instanceof Uint8Array)) return bad", "  if (typeof name !== 'string' || !(bytes instanceof Uint8Array)) return bad"]],
  'n92-text-no-metadata-note': [[TXT, "  if (changes.metadataRemoved) notes.push('metadata removed')", '']],
  'n92-text-pages-plural': [[TXT, "    parts.push(`${count(info.pages)} ${info.pages === 1 ? 'page' : 'pages'}`)", "    parts.push(`${count(info.pages)} pages`)"]],
  'n92-text-pdf-note-gone': [[TXT, "  if (info.kind === 'pdf') notes.push('sent as it is, with any metadata it holds')", '']],
  'n92-ipc-pick-no-window': [[IPC, '    CHANNELS.attachmentsPick,\n    guardedForWindow(async (window): Promise<AttachPickResult> => {', '    CHANNELS.attachmentsPick,\n    guarded(async (): Promise<AttachPickResult> => {\n      const window = null']],
  'n92-ipc-bytes-unguarded': [[IPC, '    CHANNELS.attachmentsAddBytes,\n    guarded(async (input: unknown): Promise<AttachBytesResult> => {', '    CHANNELS.attachmentsAddBytes,\n    (async (_event: unknown, input: unknown): Promise<AttachBytesResult> => {']],
  'n92-ipc-discard-unguarded': [[IPC, '    if (!isTrustedSender(event, appUrl)) return\n    attaching.discard(id)', '    void event\n    attaching.discard(id)']],
  'n92-preload-pick-path': [[PRE, '    pick: () => ipcRenderer.invoke(CHANNELS.attachmentsPick),', '    pick: (...args: unknown[]) => ipcRenderer.invoke(CHANNELS.attachmentsPick, ...args),']],
  'n92-dialog-two-filters': [[DLG, '    filters: [ANY_FILTER],', "    filters: [ANY_FILTER, { name: 'Images', extensions: ['png', 'jpg'] }],"]],
  'n92-dialog-elsewhere': [[DLG, "    properties: ['openFile' as const, 'multiSelections' as const]", "    properties: ['openFile' as const]"]]
}

// The window (run92.mjs: one launch each)
const win = {
  'w92-page-cap-off': [[HOOK, '        if (next.length >= ATTACHMENT_LIMITS.perMessage) {', '        if (false as boolean) {']],
  'w92-paste-with-text-attaches': [[COMP, "              event.clipboardData.getData('text/plain') === '' &&\n", '']],
  'w92-drop-not-taken': [[VIEW, "          event.preventDefault()\n          event.dataTransfer.dropEffect = 'copy'", "          event.dataTransfer.dropEffect = 'copy'"]],
  // since 9.3 Send is on with files (it was off in 9.2): the sabotage keeps it off
  'w92-files-keep-send-off': [[COMP, "  const canSend = (text.trim() !== '' || hasFiles) && !isReplying && blocked === null", "  const canSend = text.trim() !== '' && !isReplying && !hasFiles && blocked === null"]],
  'w92-attach-not-off-when-full': [[APP, '        attachDisabled={attachments.busy || attachFull}', '        attachDisabled={attachments.busy}']],
  'w92-no-destination': [[CHIPS, '          <p className="attachment-destination">', '          <p className="attachment-destination" hidden>']],
  'w92-no-notes': [[CHIPS, '                    {notes.length > 0 && (', '                    {false && (']],
  'w92-no-thumbnail': [[CHIPS, '                  {thumbnail !== null ? (', '                  {false ? (']],
  'w92-remove-unnamed': [[CHIPS, '                    aria-label={`Remove ${info.name}`}', '                    aria-label="Remove"']],
  'w92-dialog-not-modal': [[DLG, "    properties: ['openFile' as const, 'multiSelections' as const]\n  }\n  const window = windowOf(owner)", "    properties: ['openFile' as const, 'multiSelections' as const]\n  }\n  const window = windowOf(null)"]],
  'w92-discard-not-sent': [[IPC, '    attaching.discard(id).catch((error: unknown) => {', '    Promise.resolve(id).catch((error: unknown) => {']],
  'w92-dialog-two-filters': [[DLG, '    filters: [ANY_FILTER],', "    filters: [ANY_FILTER, { name: 'Images', extensions: ['png', 'jpg'] }],"]],
  'w92-chips-no-wrap': [[CSS, '.attachment-list {\n  display: flex;\n  flex-wrap: wrap;', '.attachment-list {\n  display: flex;\n  flex-wrap: nowrap;']]
}

const write = (dir, specs, argv, env, timeoutMs) => {
  mkdirSync(join(TOOLS, dir), { recursive: true })
  for (const [name, edits] of Object.entries(specs)) {
    writeFileSync(join(TOOLS, dir, `${name}.json`), JSON.stringify({ label: name, edits: edits.map(([file, from, to]) => ({ file, from, to })), argv, env, ...(timeoutMs ? { timeoutMs } : {}) }, null, 2) + '\n')
  }
}
write('specs92', node, ['{{TOOLS}}/verify-9-2.mjs'], {})
write('specs92w', win, ['{{TOOLS}}/run92.mjs', 'dev'], { NO_RETRY: '1' }, 420000)
console.log(`wrote ${Object.keys(node).length} specs in specs92 and ${Object.keys(win).length} in specs92w`)
