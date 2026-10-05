// usage: node tools/run8b.mjs [mode=dev]
// Stage 8b (D-034): backing up chats to a file and restoring from one, in the real window (verify-8b-w.mjs). Before the app starts it puts FIVE chats into a
// fresh scratch profile and makes the backup files the suite will point the (replaced) system dialogs at, in a folder OUTSIDE the profile: a whole backup of the
// five, one cut off at 60%, one with a changed chat, and a letter that is not a backup. The suite proves the dialogs, the notices, the preview, what is added and
// what is never replaced, and what the page cannot do. Needs INSPECT_PORT: the dialogs are replaced from the main process's inspector.
// Do not edit src/ while this runs: the launch builds from the tree.
import './ts-resolve.mjs'
import { mkdirSync, rmSync, writeFileSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { runApp, scratch } from './drive.mjs'
import { backup, makeChat, fileText, seedFile, sourceOf, createConversationStore, NOW } from './lib8b.mjs'

const mode = process.argv[2] ?? 'dev'
const P = scratch('s8b')
const FILES = scratch('s8b-files')
rmSync(P, { recursive: true, force: true })
rmSync(FILES, { recursive: true, force: true })
const conversations = join(P, 'conversations')
mkdirSync(join(FILES, 'out'), { recursive: true })

const chats = Array.from({ length: 5 }, (_, i) => makeChat(i))
for (const chat of chats) await seedFile(conversations, chat, fileText(chat))
const store = createConversationStore(conversations)
const list = (await store.list()).conversations
const all = join(FILES, 'all.jsonl')
const made = await backup.writeBackup(all, sourceOf(store, list.map((c) => c.id)), NOW)
if (!made.ok) throw new Error('could not make the whole backup: ' + JSON.stringify(made))
const whole = readFileSync(all)
writeFileSync(join(FILES, 'cut.jsonl'), whole.subarray(0, Math.floor(whole.length * 0.6)))
const lines = whole.toString('utf8').split('\n')
lines[3] = lines[3].replace(/Question [0-9]+/, 'Question X') // line 4 of the file: a changed chat, its checksum no longer fits
writeFileSync(join(FILES, 'tampered.jsonl'), lines.join('\n'))
writeFileSync(join(FILES, 'notbackup.txt'), 'Dear Sam, this is a letter and not a backup. SECRET-LETTER-TEXT\n')
console.log(`seeded five chats in ${conversations}; backup files in ${FILES}`)

const r = runApp({
  label: (mode === 'preview' ? 'p-' : 'd-') + 'w8b',
  mode,
  scripts: 'verify-8b-w.mjs',
  env: { USER_DATA_DIR: P, FILES_DIR: FILES, INSPECT_PORT: '9230', MOCK_PORT: '8795', MOCK_SCRIPT: 'mock-providers.mjs' },
  timeoutMs: 600000
})
console.log(`${r.passed}/${r.total} checks passed`)
for (const f of r.fails) console.log(String(f).trim())
process.exit(r.ok ? 0 : 1)
