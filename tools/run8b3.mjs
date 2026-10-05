// usage: node tools/run8b3.mjs [mode=dev] [launches=5]
// Stages 8b.3 and 8b.4 (D-035) in the real window, on the REAL secure storage of this PC (Electron's safeStorage), in a scratch profile that is seeded with five plain chats.
// Launch 1 (verify-8b3-w.mjs): turning encryption on (the backup first), what is on disk, History, the bridge, going back, on again, narrow windows. It ends with encryption ON.
// Launch 2 (verify-8b3-b.mjs): a RESTART: the sealed chats open again and nothing is rewritten at start.
// Launch 3 (verify-8b3-c.mjs): a LOST KEY, made for real: the profile's "Local State" file (where Chromium keeps the key that the secure storage uses) is deleted while the app is
//   not running, so the app starts with a key that cannot open the sealed chats. The app must say so, save nothing, write nothing, and leave every file as it is; the way out is the backup.
// Launch 4 (verify-8b3-d.mjs): the key COMES BACK (the original "Local State" is put back): nothing was lost, and the chats can be turned back into plain files.
// Launch 5 (verify-8b3-e.mjs): the choice's OWN file is damaged (not JSON): damage means "ask", so nothing is saved and nothing changes until the person chooses again.
// The system's dialogs are replaced from the main process's inspector (INSPECT_PORT). Do not edit src/ while this runs: the launches build from the tree.
import './ts-resolve.mjs'
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { runApp, scratch } from './drive.mjs'
import { makeChat, fileText, seedFile } from './lib8b.mjs'

const mode = process.argv[2] ?? 'dev'
const launches = Number(process.argv[3] ?? 5)
const tag = mode === 'preview' ? 'p-' : 'd-'
const P = scratch('s8b3')
const FILES = scratch('s8b3-files')
const MOCK = '8796'
if (!P.includes('frontier-app-test-scratch')) throw new Error('refusing to touch a profile that is not a scratch one: ' + P)
rmSync(P, { recursive: true, force: true })
rmSync(FILES, { recursive: true, force: true })
mkdirSync(join(FILES, 'out'), { recursive: true })
const chats = Array.from({ length: 5 }, (_, i) => makeChat(i))
for (const chat of chats) await seedFile(join(P, 'conversations'), chat, fileText(chat))
console.log(`seeded five plain chats in ${join(P, 'conversations')}; files for the suite in ${FILES}`)

const env = (extra = {}) => ({ USER_DATA_DIR: P, FILES_DIR: FILES, INSPECT_PORT: '9230', MOCK_PORT: MOCK, MOCK_SCRIPT: 'mock-providers.mjs', ...extra })
const results = []
const run = (name, scripts, extra = {}) => results.push(runApp({ label: `${tag}w8b3${name}`, mode, scripts, env: env(extra), timeoutMs: 600000 }))
const localState = join(P, 'Local State')
const keep = join(FILES, 'Local State.original')

run('', 'setup-key.mjs,verify-8b3-w.mjs', { WIPE_USER_DATA: '0' })
if (launches >= 2) {
  if (existsSync(localState)) { copyFileSync(localState, keep); console.log(`kept the profile's Local State (${readFileSync(keep).length} bytes), where the key lives`) }
  else console.log('!! the profile has no "Local State" after launch 1: the real secure storage keeps its key somewhere else here, or it was never used')
  run('b', 'setup-key.mjs,verify-8b3-b.mjs', { WIPE_USER_DATA: '0' })
}
if (launches >= 3) {
  // the real thing: no other program touched the chat files; only the file that holds the key is gone, as in a reset profile
  if (existsSync(localState)) rmSync(localState)
  console.log(`deleted the profile's Local State (it ${existsSync(localState) ? 'is still there' : 'is gone'})`)
  run('c', 'setup-key.mjs,verify-8b3-c.mjs', { WIPE_USER_DATA: '0', LOCAL_STATE_BACK: existsSync(keep) ? '1' : '0' })
}
if (launches >= 4) {
  if (existsSync(keep)) copyFileSync(keep, localState)
  console.log(`put the original Local State back (${existsSync(localState) ? 'done' : 'it was not kept'})`)
  run('d', 'verify-8b3-d.mjs', { WIPE_USER_DATA: '0' })
}
if (launches >= 5) {
  // the choice's own file is damaged: nothing may be saved, nothing may change, and the person chooses again
  writeFileSync(join(P, 'chat-encryption.json'), 'this is not json {{{')
  run('e', 'setup-key.mjs,verify-8b3-e.mjs', { WIPE_USER_DATA: '0' })
}

const passed = results.reduce((n, r) => n + r.passed, 0)
const total = results.reduce((n, r) => n + r.total, 0)
if (total > 0) console.log(`${passed}/${total} checks passed`)
for (const r of results) for (const f of r.fails) console.log(String(f).trim())
process.exit(results.every((r) => r.ok) ? 0 : 1)
