// Writes the negative-control specs for slice 9.5 (backups that hold the attached files, D-037): one sabotage each, which the suites must notice.
// usage: node tools/make-specs95.mjs
//   then: node tools/check-specs.mjs                 (dry check)
//         node tools/nc-all.mjs specs95 <names...>   (verify-9-5.mjs, plain Node)
//         node tools/nc-all.mjs specs95w <names...>  (run95.mjs: the real window)
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { TOOLS } from './paths.mjs'

const R = '{{REPO}}/'
const BAK = R + 'src/main/backup.ts', STORE = R + 'src/main/attachmentStore.ts', SVC = R + 'src/main/backupService.ts', IPC = R + 'src/main/ipc.ts'
const WORDS = R + 'src/renderer/src/history/useBackup.ts', PANEL = R + 'src/renderer/src/history/RestorePreviewPanel.tsx'

const node = {
  // the file
  'n95-writer-always-v1': [[BAK, '    withFiles = source.readFile !== undefined && named.size > 0', '    withFiles = false']],
  'n95-writer-header-not-patched': [[BAK, "        await handle.write(String(BACKUP_VERSION_FILES), header.indexOf('\"version\":1') + 10)\n", '']],
  'n95-reader-no-hash': [[BAK, '  if (sha256Bytes(bytes) !== id) {', '  if (false as boolean) {']],
  'n95-reader-no-facts': [[BAK, "  if (factsOf(bytes) === null) return 'it is not a file the app keeps'\n", '']],
  'n95-reader-extra-keys': [[BAK, "  if (keys.length !== 2 || keys[0] !== 'file' || keys[1] !== 'data') return 'it is not a file line'", "  if (keys[0] !== 'file') return 'it is not a file line'"]],
  'n95-reader-trailer-files-unchecked': [[BAK, '      (result.files === undefined || result.trailer.files === result.files.seen) &&\n', '']],
  'n95-reader-v1-reads-files': [[BAK, '        if (header.version === BACKUP_VERSION_FILES) {', '        if (true as boolean) {']],
  'n95-reader-v3-read': [[BAK, '        if (header.version !== BACKUP_VERSION && header.version !== BACKUP_VERSION_FILES) {', '        if (header.version !== BACKUP_VERSION && header.version !== BACKUP_VERSION_FILES && header.version !== 3) {']],
  // the store
  'n95-adopt-no-hash': [[STORE, '          bytes.length > MAX_KEPT_BYTES ||\n          sha256(bytes) !== id ||\n', '          bytes.length > MAX_KEPT_BYTES ||\n']],
  'n95-adopt-no-facts': [[STORE, '          sha256(bytes) !== id ||\n          factsOf(bytes) === null\n        ) {', '          sha256(bytes) !== id\n        ) {']],
  'n95-adopt-no-caps': [[STORE, "        if (!room(id, bytes.length, mode.form).fits) return 'full'\n", '']],
  'n95-adopt-always-plain': [[STORE, '          await writeCopy(id, bytes, mode.form)', "          await writeCopy(id, bytes, 'plain')"]],
  'n95-adopt-ignores-refusal': [[STORE, "        if ('refused' in mode) return 'failed'\n        await ensureScanned()\n        const there = index.has(id)", "        await ensureScanned()\n        const there = index.has(id)"]],
  'n95-adopt-rewrites-whole': [[STORE, "        if (there !== null && there.ok) return 'already'", '        void there']],
  // the service
  'n95-svc-export-no-files': [[SVC, '          ...(options.files !== undefined ? { readFile: options.files.read } : {})', '          ...{}']],
  'n95-svc-look-all-missing': [[SVC, '          if (options.files === undefined || (await options.files.read(id)) === null)\n            files.missing += 1', '          files.missing += 1']],
  'n95-svc-adopts-unnamed': [[SVC, '          if (!named.has(id) || options.files === undefined) {', '          if (options.files === undefined) {']],
  'n95-svc-same-chat-files-left': [[SVC, "            same += 1\n            for (const id of filesOf(chat)) here.add(id)\n", '            same += 1\n']],
  // the words
  'n95-words-export-silent': [[WORDS, '        ? ` It holds their ${attached(count)} too${leftOut > 0 ? `; ${lost}` : \'\'}.`', "        ? ''"]],
  'n95-words-restore-added-0': [[WORDS, '  if (result.added + result.copies > 0 || result.files === undefined) {', '  if (true as boolean) {']]
}

const win = {
  'w95-ipc-no-files': [[IPC, '    files: {\n      read: async (id) => {', '    nofiles: {\n      read: async (id) => {']],
  'w95-panel-no-putback': [[PANEL, '          disabled={disabled || (fits === 0 && missing === 0)}', '          disabled={disabled || fits === 0}']],
  'w95-panel-no-facts': [[PANEL, '        {missing > 0 && (', '        {false && (']]
}

const write = (dir, specs, argv, env, timeoutMs) => {
  mkdirSync(join(TOOLS, dir), { recursive: true })
  for (const [name, edits] of Object.entries(specs)) {
    writeFileSync(join(TOOLS, dir, `${name}.json`), JSON.stringify({ label: name, edits: edits.map(([file, from, to]) => ({ file, from, to })), argv, env, ...(timeoutMs ? { timeoutMs } : {}) }, null, 2) + '\n')
  }
}
write('specs95', node, ['{{TOOLS}}/verify-9-5.mjs'], {})
write('specs95w', win, ['{{TOOLS}}/run95.mjs', 'dev'], { NO_RETRY: '1' }, 500000)
console.log(`wrote ${Object.keys(node).length} specs in specs95 and ${Object.keys(win).length} in specs95w`)
