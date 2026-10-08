// Writes the negative-control specs for slice 10.4 (memory in the window, the notes in a request, D-039): one sabotage each, which the suites must notice.
// usage: node tools/make-specs104.mjs
//   then: node tools/check-specs.mjs                  (dry check)
//         node tools/nc-all.mjs specs104 <names...>   (verify-10-4.mjs, plain Node)
//         node tools/nc-all.mjs specs104w <names...>  (run104.mjs: the real window)
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { TOOLS } from './paths.mjs'

const R = '{{REPO}}/'
const REQ = R + 'src/main/providers/request.ts', CHAT = R + 'src/main/chat.ts', IPC = R + 'src/main/ipc.ts', SEC = R + 'src/main/secrets.ts'
const DLGS = R + 'src/main/backupDialogs.ts', MEM = R + 'src/main/memory.ts', BAR = R + 'src/renderer/src/chat/ChatBar.tsx'
const ACT = R + 'src/renderer/src/chat/MessageActions.tsx', PAGE = R + 'src/renderer/src/memory/MemoryDialog.tsx'

const s = {
  notesDropped: [REQ, '  if (notes.length > 0) pieces.push(NOTES_LEAD, noteList(notes))\n', ''],
  notesAfterInstructions: [REQ, "  if (notes.length > 0) pieces.push(NOTES_LEAD, noteList(notes))\n  if (every !== '') pieces.push(EVERY_CHAT_LEAD, every)", "  if (every !== '') pieces.push(EVERY_CHAT_LEAD, every)\n  if (notes.length > 0) pieces.push(NOTES_LEAD, noteList(notes))"],
  notesNoLead: [REQ, '  if (notes.length > 0) pieces.push(NOTES_LEAD, noteList(notes))', '  if (notes.length > 0) pieces.push(noteList(notes))'],
  noteBreaksFree: [REQ, "  notes.map((note) => `- ${note.replace(/\\r?\\n/g, '\\n  ')}`).join('\\n')", "  notes.map((note) => `- ${note}`).join('\\n')"],
  notesNotTrimmed: [REQ, "  const notes = (parts.notes ?? []).map((note) => note.trim()).filter((note) => note !== '')", '  const notes = [...(parts.notes ?? [])]'],
  buildDropsNotes: [REQ, '      notes: input.notes,\n      everyChat: input.everyChat', '      everyChat: input.everyChat'],
  chatNoNotes: [CHAT, '      notes: memory.notes.map((note) => note.text), // first after the rules, as information (10.4)\n', ''],
  chatNoKeyCheck: [CHAT, '      const held = heldKey(note.text, keys)\n      if (held !== null) {', '      const held = heldKey(note.text, keys)\n      if (held === "never") {'],
  damagedSends: [MEM, "      if (current.state === 'unreadable') return { ok: false, error: memoryUnreadable(current.why) }", "      if (current.state === 'unreadable') return { ok: true, notes: [] }"],
  ipcAddNoWindow: [IPC, '      memory.add(window, input)', '      memory.add(null, input)'],
  ipcRemoveUnguarded: [IPC, '    guarded((input: unknown): Promise<MemoryChangeResult> => memory.remove(input))', '    (_event: unknown, input: unknown): Promise<MemoryChangeResult> => memory.remove(input)'],
  docsWithoutMemory: [IPC, '    documents: keptDocuments([everyChat.file, memory.file, projects.file, auditLog.document]) // rewritten with the chats (D-039, D-041)', '    documents: keptDocuments([everyChat.file, projects.file, auditLog.document]) // rewritten with the chats (D-039, D-041)'],
  exportOverwrites: [DLGS, "    title: 'Export your notes',\n    defaultPath: join(app.getPath('documents'), suggestedName),\n    filters: [NOTES_FILTER],\n    properties: ['showOverwriteConfirmation' as const]", "    title: 'Export your notes',\n    defaultPath: join(app.getPath('documents'), suggestedName),\n    filters: [NOTES_FILTER],\n    properties: []"],
  keyInNotesVague: [SEC, '  `Nothing was sent: one of your notes holds your ${PROVIDER_NAMES[provider]} API key, which is saved in this app. Open Memory and take it out.`', "  `Nothing was sent: a note holds a key. ${provider === 'openai' ? '' : ''}`"],
  noIgnored: [MEM, '    return { ok: false, cancelled: true, error: notSaved }', '    return null'],
  onNoQuestion: [MEM, '      if (notes.length > 0) {\n        const no = await ask(owner, memoryOnQuestion(notes), MEMORY_STILL_OFF)', '      if (notes.length < 0) {\n        const no = await ask(owner, memoryOnQuestion(notes), MEMORY_STILL_OFF)'],
  exportInside: [MEM, '    if (await isInside(options.dataDir, dest)) {', '    if (dest === 42) {'],
  barNoCount: [BAR, '          notesSent(memory).length > 0 && (', '          false && ('],
  barNoProblemMark: [BAR, '        {memory?.problem != null ? (', '        {memory?.problem === 12345 ? ('],
  rememberWholeOnly: [ACT, '          onClick={(event) => onRemember(selectedIn(event.currentTarget) ?? message.content)}', '          onClick={() => onRemember(message.content)}'],
  pageEscapeWhileBusy: [PAGE, '        if (busyRef.current) event.preventDefault()', '        void busyRef.current'],
  pageDeleteNoConfirm: [PAGE, '                            onClick={() => setAsking(note.id)}', '                            onClick={() => void change(() => window.api.memory.remove(note.id), false)}'],
  pageSavesTooLong: [PAGE, '  const canSave = checked.ok && !unchanged && !busy', '  const canSave = !unchanged && !busy']
}

const node = {
  'n104-notes-dropped': [s.notesDropped],
  'n104-notes-after-instructions': [s.notesAfterInstructions],
  'n104-notes-no-lead': [s.notesNoLead],
  'n104-note-breaks-free': [s.noteBreaksFree],
  'n104-notes-not-trimmed': [s.notesNotTrimmed],
  'n104-build-drops-notes': [s.buildDropsNotes],
  'n104-chat-no-notes': [s.chatNoNotes],
  'n104-chat-no-key-check': [s.chatNoKeyCheck],
  'n104-ipc-add-no-window': [s.ipcAddNoWindow],
  'n104-ipc-remove-unguarded': [s.ipcRemoveUnguarded],
  'n104-docs-without-memory': [s.docsWithoutMemory],
  'n104-export-overwrites': [s.exportOverwrites],
  'n104-key-in-notes-vague': [s.keyInNotesVague]
}

const win = {
  'w104-chat-no-notes': [s.chatNoNotes],
  'w104-notes-after-instructions': [s.notesAfterInstructions],
  'w104-chat-no-key-check': [s.chatNoKeyCheck],
  'w104-damaged-sends': [s.damagedSends],
  'w104-ipc-add-no-window': [s.ipcAddNoWindow],
  'w104-docs-without-memory': [s.docsWithoutMemory],
  'w104-no-ignored': [s.noIgnored],
  'w104-on-no-question': [s.onNoQuestion],
  'w104-export-inside': [s.exportInside],
  'w104-bar-no-count': [s.barNoCount],
  'w104-bar-no-problem-mark': [s.barNoProblemMark],
  'w104-remember-whole-only': [s.rememberWholeOnly],
  'w104-page-escape-while-busy': [s.pageEscapeWhileBusy],
  'w104-page-delete-no-confirm': [s.pageDeleteNoConfirm],
  'w104-page-saves-too-long': [s.pageSavesTooLong]
}

const write = (dir, specs, argv, env, timeoutMs) => {
  mkdirSync(join(TOOLS, dir), { recursive: true })
  for (const [name, edits] of Object.entries(specs)) {
    writeFileSync(join(TOOLS, dir, `${name}.json`), JSON.stringify({ label: name, edits: edits.map(([file, from, to]) => ({ file, from, to })), argv, env, ...(timeoutMs ? { timeoutMs } : {}) }, null, 2) + '\n')
  }
}
write('specs104', node, ['{{TOOLS}}/verify-10-4.mjs'], {})
write('specs104w', win, ['{{TOOLS}}/run104.mjs', 'dev'], { NO_RETRY: '1' }, 600000)
console.log(`wrote ${Object.keys(node).length} specs in specs104 and ${Object.keys(win).length} in specs104w`)
