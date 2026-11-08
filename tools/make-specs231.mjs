// Writes the negative-control specs for Stage 23.1 (D-055, names, pins and days): one sabotage each, which verify-23-1 (Node) or verify-23-1w (window)
// must notice.
// usage: node tools/make-specs231.mjs
//   then: NC_GUARDED=1 node tools/nc-all.mjs specs231 <names...>
//         node tools/guarded-window-copy.mjs tools/nc-all.mjs specs231w <names...>
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { TOOLS } from './paths.mjs'
import { scratch } from './drive.mjs'

const S = '{{REPO}}/src/'
const SHARED = S + 'shared/chatNames.ts', NAMES = S + 'main/chatNames.ts', STORE = S + 'main/conversationStore.ts', GROUPS = S + 'renderer/src/sidebar/groups.ts'
const BACKUP = S + 'main/backup.ts', SERVICE = S + 'main/backupService.ts', IPC = S + 'main/ipc.ts', ROW = S + 'renderer/src/sidebar/ChatRow.tsx', CSS = S + 'renderer/src/assets/main.css'

const node = {
  'n231-no-trim': [[SHARED, String.raw`  const oneLine = input.replace(/\s+/g, ' ').trim()`, '  const oneLine = input']],
  'n231-bidi-allowed': [[SHARED, String.raw`\u007f\u202a-\u202e\u2066-\u2069]`, String.raw`\u007f]`]],
  'n231-pin-false-ok': [[SHARED, '      if (fields.pinned !== true) return null', "      if (fields.pinned === 'x') return null"]],
  'n231-title-not-plain': [[STORE, '  const plain = plainTitle(oneLine)', "  const plain = oneLine || 'New chat'"]],
  'n231-no-pinned-group': [[GROUPS, "  for (const chat of chats) if (chat.pinned === true) add('Pinned', chat)", "  for (const chat of chats) if (false) add('Pinned', chat)"], [GROUPS, '    if (chat.pinned === true) continue\n', '']],
  'n231-yesterday-wrong': [[GROUPS, '        : days === 1', '        : days === 2']],
  'n231-no-queue': [[NAMES, '    const run = queue.then(task)', '    const run = task()']],
  'n231-forget-writes': [[NAMES, '(id in now ? withMark(now, id, {}) : null)', '(id in now ? withMark(now, id, {}) : now)']],
  'n231-overwrites-unreadable': [[NAMES, "      if (read.state === 'unreadable') {", '      if (false) {']],
  'n231-restore-replaces-mark': [[NAMES, '        for (const [id, mark] of Object.entries(marks)) if (!(id in next)) next[id] = mark', '        for (const [id, mark] of Object.entries(marks)) next[id] = mark']],
  'n231-marks-of-all-chats': [[BACKUP, '  const marks = Object.entries(source.marks ?? {}).filter(([id]) => source.ids.includes(id))', '  const marks = Object.entries(source.marks ?? {})']],
  'n231-mark-after-chats': [[BACKUP, '          result.seen > 0 || (result.files?.seen ?? 0) > 0', '          false']],
  'n231-mark-unchecked': [[BACKUP, "    const checked = typeof id === 'string' ? checkChatMarks({ [id]: mark }) : null", "    const checked = typeof id === 'string' ? ({ [id]: mark } as ChatMarks) : null"]],
  'n231-restore-drops-marks': [[SERVICE, '              if (mark !== undefined) marksAdded[addedAs] = mark', '              void mark']],
  'n231-not-sealed': [[IPC, '      myExperts.file,\n      chatNames.file\n', '      myExperts.file\n']],
  'n231-any-id': [[IPC, "      if (!(await isSaved(fields.id))) return NOT_SAVED\n      return chatNames.rename(fields.id, fields.title)", '      return chatNames.rename(fields.id, fields.title)']]
}

const port = '8863'
const windowSpecs = {
  'w231-more-always-shown': [[CSS, '  opacity: 0;\n  transform: translateY(-50%);', '  opacity: 1;\n  transform: translateY(-50%);']],
  'w231-menu-not-focused': [[ROW, `    menuRef.current?.querySelector<HTMLButtonElement>('[role="menuitem"]')?.focus()\n`, '']],
  'w231-escape-keeps-menu': [[ROW, "              closeMenu(event.key === 'Escape')", '              void 0']],
  'w231-escape-saves-name': [[ROW, "              cancelled.current = true\n              setMode('row')\n              setTimeout", "              setMode('row')\n              setTimeout"]],
  'w231-delete-without-asking': [[ROW, "              closeMenu(false)\n              setMode('delete')", '              closeMenu(false)\n              void act(onDelete)']],
  'w231-names-not-shown': [[IPC, '    marks[chat.id]?.title ?? plainTitle(chat.title)', '    plainTitle(chat.title)']],
  'w231-pins-not-shown': [[IPC, '          ...(marks[c.id]?.pinned === true ? { pinned: true as const } : {})', '          ...{}']]
}

const write = (dir, specs, make) => {
  const full = join(TOOLS, dir)
  mkdirSync(full, { recursive: true })
  for (const [name, edits] of Object.entries(specs)) {
    writeFileSync(join(full, `${name}.json`), JSON.stringify({ label: name, edits: edits.map(([file, from, to]) => ({ file, from, to })), ...make(name) }, null, 2) + '\n')
  }
  console.log(`wrote ${Object.keys(specs).length} specs in ${dir}`)
}
// The kept file (keptFile.ts) refuses to write over an unreadable file too, so taking this service's own refusal out cannot be seen.
const RETIRED = { 'n231-overwrites-unreadable': 'cannot be seen: the kept file under it (keptFile.ts, D-039) also refuses to write over a file it cannot read, with the same words; two locks, this one only says why sooner' }
write('specs231', node, (name) => ({ ...(RETIRED[name] ? { retired: RETIRED[name] } : {}), argv: ['{{TOOLS}}/verify-23-1.mjs'], env: {} }))
const RETIRED_W = { 'w231-escape-saves-name': 'cannot be seen: Chromium fires no blur when the rename box is taken away, so nothing saves after Escape even without this guard; kept in case a later Chromium does' }
write('specs231w', windowSpecs, (name) => ({
  ...(RETIRED_W[name] ? { retired: RETIRED_W[name] } : {}),
  argv: ['{{TOOLS}}/run-with-app.mjs', 'dev', 'setup-key.mjs,verify-23-1w.mjs', '{{OUT}}/shots', '9222'],
  env: { USER_DATA_DIR: scratch('specs231wnc'), WIPE_USER_DATA: '1', MOCK_PORT: port, PRESEED_FILE: '', LOG_LABEL: `nc-${name}` }
}))
