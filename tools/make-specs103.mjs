// Writes the negative-control specs for slice 10.3 (the memory store in main, D-039): one sabotage each, which verify-10-3.mjs must notice.
// usage: node tools/make-specs103.mjs
//   then: node tools/check-specs.mjs                  (dry check)
//         node tools/nc-all.mjs specs103 <names...>   (verify-10-3.mjs, plain Node)
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { TOOLS } from './paths.mjs'

const R = '{{REPO}}/'
const SH = R + 'src/shared/memory.ts', M = R + 'src/main/memory.ts', KEPT = R + 'src/main/keptFile.ts', SEC = R + 'src/main/secrets.ts'

const node = {
  'n103-note-not-trimmed': [[SH, '  const text = input.trim()', '  const text = input']],
  'n103-note-limit-off': [[SH, '  if (text.length > MEMORY_LIMITS.maxNoteChars) {', '  if (text.length > MEMORY_LIMITS.maxNoteChars + 1) {']],
  'n103-scope-loose': [[SH, "  value === ALL_CHATS || (typeof value === 'string' && UUID.test(value))", "  typeof value === 'string'"]],
  'n103-parse-extra-field': [[M, '  if (fields.version !== MEMORY_FILE_VERSION || Object.keys(fields).length !== 3) return null', '  if (fields.version !== MEMORY_FILE_VERSION) return null']],
  'n103-parse-dup-ids': [[M, '    if (note === null || ids.has(note.id)) return null', '    if (note === null) return null']],
  'n103-parse-no-caps': [[M, '    if (use.notes > MEMORY_LIMITS.maxScopeNotes || use.chars > MEMORY_LIMITS.maxScopeChars)\n      return null', '    void use']],
  'n103-parse-loose-note': [[SH, '  if (!checked.ok || checked.text !== text) return null', // parseNote is in the shared file since 10.7
    '  if (!checked.ok) return null']],
  'n103-ask-skipped': [[M, "    const answer = await options.gate.ask(owner, question)\n    if (answer === 'yes') return null", "    void owner\n    void question\n    const answer = 'yes' as string\n    if (answer === 'yes') return null"]],
  'n103-no-ignored': [[M, '    return { ok: false, cancelled: true, error: notSaved }', '    return null']],
  'n103-add-dup-allowed': [[M, '      if (memory.notes.some((note) => note.scope === scope && note.text === checked.text)) {', '      if (memory.notes.some((note) => note.scope === 42)) {']],
  'n103-add-no-room-check': [[M, '      const full = roomFor(memory.notes, scope, checked.text, null)\n      if (full !== null) return { ok: false, error: full }\n', '']],
  'n103-room-count-off': [[M, '    const count = use.notes + (replacing === null ? 1 : 0)', '    const count = use.notes']],
  'n103-room-chars-ignores-replaced': [[M, '    const chars = use.chars - (replacing?.text.length ?? 0) + text.length', '    const chars = use.chars + text.length']],
  'n103-add-secrets-skipped': [[M, "        saveAnyway === true,\n        'Notes'\n      )\n      if (!secrets.ok) return secrets\n      const after = scopeUse(memory.notes, scope)", "        saveAnyway === true,\n        'Notes'\n      )\n      const after = scopeUse(memory.notes, scope)"]],
  'n103-unknown-project-allowed': [[M, '      if (scope !== ALL_CHATS && projectName === null) return { ok: false, error: NO_PROJECT }\n', '']],
  'n103-edit-same-asks': [[M, '      if (old.text === checked.text) return { ok: true, status: await status() }\n', '']],
  'n103-edit-new-id': [[M, '            ? { ...note, text: checked.text, updatedAt: Math.max(now(), note.createdAt) }', '            ? { ...note, id: newId(), text: checked.text, updatedAt: Math.max(now(), note.createdAt) }']],
  'n103-remove-takes-all': [[M, '      return write({ on: memory.on, notes: memory.notes.filter((note) => note.id !== id) })', '      return write({ on: memory.on, notes: [] })']],
  'n103-off-not-written': [[M, '      if (!on) {', '      if (!on && on) {']],
  'n103-on-no-question': [[M, '      if (notes.length > 0) {\n        const no = await ask(owner, memoryOnQuestion(notes), MEMORY_STILL_OFF)', '      if (notes.length < 0) {\n        const no = await ask(owner, memoryOnQuestion(notes), MEMORY_STILL_OFF)']],
  'n103-request-ignores-off': [[M, "      if (current.state === 'none' || !current.value.on) return { ok: true, notes: [] }", "      if (current.state === 'none') return { ok: true, notes: [] }"]],
  'n103-request-all-projects': [[M, '          ...(projectId === null ? [] : notes.filter((note) => note.scope === projectId))', '          ...notes.filter((note) => note.scope !== ALL_CHATS)']],
  'n103-request-damaged-sends': [[M, "      if (current.state === 'unreadable') return { ok: false, error: memoryUnreadable(current.why) }", "      if (current.state === 'unreadable') return { ok: true, notes: [] }"]],
  'n103-damaged-changes-allowed': [[M, "    if (current.state === 'unreadable') return { ok: false, error: changeRefused(current.why) }\n    return { ok: true, memory:", "    if (current.state === 'unreadable') return { ok: true, memory: { on: true, notes: [] } }\n    return { ok: true, memory:"]],
  'n103-export-inside-allowed': [[M, '    if (await isInside(options.dataDir, dest)) {', '    if (dest === 42) {']],
  'n103-export-misses-project': [[M, '    const scopes = [...new Set(memory.notes.map((note) => note.scope))].sort((a, b) =>', '    const scopes = [ALL_CHATS].sort((a, b) =>']],
  'n103-question-no-text': [[M, '  const lines = [`"${input.text}"`]', "  const lines = ['(your note)']"]],
  'n103-question-wrong-place': [[M, '  const place = placeOf(input.scope, input.projectName)', '  const place = placeOf(ALL_CHATS, null)']],
  'n103-on-question-count': [[M, '      `Your ${notesWord(notes.length)} (${fmt(chars)} characters)', '      `Your ${notesWord(0)} (${fmt(chars)} characters)']],
  'n103-not-one-at-a-time': [[M, '    if (changing) return { ok: false, error: BUSY }\n', '']],
  // Found on the way (10.3): what is written must read back; an id is never used twice; a short secret shows little.
  'n103-kept-writes-unreadable': [[KEPT, '        if (parse(plain) === null)\n          throw new Error(`${name} would not read back, so nothing was written`)\n', '']],
  'n103-id-reused': [[M, '      if (isNoteId(id) && !notes.some((note) => note.id === id)) return id', '      if (isNoteId(id)) return id']],
  'n103-mask-shows-more': [[SEC, '  if (chars.length < 24) return `${chars[0]}… (${chars.length} characters)`\n', '']]
}

const dir = join(TOOLS, 'specs103')
mkdirSync(dir, { recursive: true })
for (const [name, edits] of Object.entries(node)) {
  writeFileSync(join(dir, `${name}.json`), JSON.stringify({ label: name, edits: edits.map(([file, from, to]) => ({ file, from, to })), argv: ['{{TOOLS}}/verify-10-3.mjs'], env: {} }, null, 2) + '\n')
}
console.log(`wrote ${Object.keys(node).length} specs in specs103`)
