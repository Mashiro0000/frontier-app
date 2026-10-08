// Writes the negative-control specs for Stage 8b (backing up and restoring chats, D-034): one sabotage each, which the suites must notice.
// usage: node tools/make-specs8b.mjs
//   then: node tools/check-specs.mjs                 (dry check: every sabotage text is found exactly once)
//         node tools/nc-all.mjs specs8b <names...>   (plain-Node suites verify-8b-1.mjs / verify-8b-2.mjs; the second runs with QUICK=1)
//         node tools/nc-all.mjs specs8bw <names...>  (the real window: run8b.mjs seeds the profile and runs verify-8b-w.mjs; opens a window per sabotage)
// Each spec backs up the file, applies its sabotage, runs the suite, and puts the file back (proved by hash).
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { TOOLS } from './paths.mjs'

const R = '{{REPO}}/'
const BK = R + 'src/main/backup.ts', SV = R + 'src/main/backupService.ts', ST = R + 'src/main/conversationStore.ts', VAL = R + 'src/shared/validate.ts'
const IPC = R + 'src/main/ipc.ts', PRE = R + 'src/preload/index.ts', DLG = R + 'src/main/backupDialogs.ts'
const HOOK = R + 'src/renderer/src/history/useBackup.ts', PANEL = R + 'src/renderer/src/history/RestorePreviewPanel.tsx', DIALOG = R + 'src/renderer/src/history/HistoryDialog.tsx', CSS = R + 'src/renderer/src/assets/main.css'
const FILE1 = 'verify-8b-1.mjs', FILE2 = 'verify-8b-2.mjs'

// name: [suite, [[file, from, to], ...]]
const node = {
  // ---- reading a backup
  'n8b-reader-no-checksum': [FILE1, [[BK, "if (typeof claimed !== 'string' || !HASH.test(claimed) || claimed !== hash) {", "if (typeof claimed !== 'string') {"]]],
  'n8b-reader-no-strict-check': [FILE1, [[BK, 'const checked = parseSavedFile(chat, id)', 'const checked = chat as unknown as SavedConversation']]],
  'n8b-reader-complete-always': [FILE1, [[BK, '      !afterTheEnd\n    return result', '      !afterTheEnd\n    result.complete = true\n    return result']]],
  'n8b-reader-ignores-count': [FILE1, [[BK, '      result.trailer.count === result.seen &&\n', '']]],
  'n8b-reader-ignores-numbering': [FILE1, [[BK, '      numbering &&\n', '']]],
  'n8b-reader-reads-after-end': [FILE1, [[BK, "      if (ended) {\n        afterTheEnd = true\n        refuse(lineNumber, 'it comes after the end of the backup')\n        continue\n      }\n", '']]],
  'n8b-reader-no-line-cap': [FILE1, [[BK, 'if (have + (end - start) > maxLine) {', 'if (false) {']]],
  'n8b-reader-no-size-cap': [FILE1, [[BK, 'if (info.size > BACKUP_LIMITS.maxFileBytes)', 'if (false)']]],
  'n8b-reader-no-chat-cap': [FILE1, [[BK, 'if (result.seen >= BACKUP_LIMITS.maxChats) {', 'if (false) {']]],
  // (9.5, D-037: version 2 is read too; the sabotage still reads any version)
  'n8b-reader-any-version': [FILE1, [[BK, 'if (\n          header.version !== BACKUP_VERSION &&\n          header.version !== BACKUP_VERSION_FILES &&\n          header.version !== BACKUP_VERSION_KEPT\n        ) {', 'if (false) {']]], // three versions since 10.7
  'n8b-reader-lenient-utf8': [FILE1, [[BK, "new TextDecoder('utf-8', { fatal: true })", "new TextDecoder('utf-8')"]]],
  'n8b-reader-id-unchecked': [FILE1, [[BK, 'if (!isConversationId(id)) {', 'if (false) {']]],
  'n8b-reader-format-unchecked': [FILE1, [[BK, 'header === null || header.format !== BACKUP_FORMAT) {', 'header === null) {']]],
  'n8b-reader-unreadable-line-vanishes': [FILE1, [[BK, '      result.seen += 1\n      // A line that cannot be used still holds its place', '      // A line that cannot be used still holds its place']]],
  // ---- writing a backup
  'n8b-writer-no-verify-part': [FILE1, [[BK, 'if (!(await proves(part))) {', 'if (false) {']]],
  'n8b-writer-no-verify-dest': [FILE1, [[BK, 'if (!(await proves(dest))) {', 'if (false) {']]],
  'n8b-writer-in-place': [FILE1, [[BK, 'const part = `${dest}.part`', 'const part = dest']]],
  'n8b-writer-leaves-part-on-fault': [FILE1, [[BK, '    await discard() // a disk that failed halfway: nothing of the half-written file is left lying about\n', '']]],
  // (9.5: the answer is written over lines and may say what became of the files; the sabotage still forgets the chats that went)
  'n8b-writer-leftout-lost': [FILE1, [[BK, '    leftOut: source.leftOut + gone,\n    bytes,', '    leftOut: source.leftOut,\n    bytes,']]],
  'n8b-writer-no-sync': [FILE1, [[BK, '    if (!tooLarge) await handle.sync()\n', '']]],
  'n8b-writer-no-size-cap': [FILE1, [[BK, 'if (bytes > BACKUP_LIMITS.maxFileBytes) {', 'if (false) {']]],
  'n8b-writer-copy-error-hides-part': [FILE1, [[BK, 'could not be copied to where you chose. A whole copy is at ${part}.', 'could not be copied to where you chose.']]],
  'n8b-writer-wrong-checksum': [FILE1, [[BK, 'const hash = sha256(text)', "const hash = sha256(text + ' ')"]]],
  // ---- the store
  'n8b-store-add-no-disk-check': [FILE2, [[ST, "          if (there) return occupied('a file that was not in the list')", '          void there']]],
  'n8b-store-add-overwrites': [FILE2, [
    [ST, "        if (index.has(conversation.id)) return occupied('listed')\n", ''],
    [ST, "        if (unreadable.has(conversation.id)) return occupied('a file that cannot be read')\n", ''],
    [ST, "          if (there) return occupied('a file that was not in the list')", '          void there']
  ]],
  'n8b-store-add-title-trusted': [FILE2, [[ST, "title: titleFor(conversation.messages) // worked out here, as for every save: a file's own title is not trusted", 'title: conversation.title']]],
  'n8b-store-add-full-ignored': [FILE2, [[ST, "        if (index.size >= HISTORY_LIMITS.maxConversations) {\n          return {\n            ok: false,\n            why: 'full',", "        if (false) {\n          return {\n            ok: false,\n            why: 'full',"]]],
  'n8b-store-inspect-damaged-is-free': [FILE2, [[ST, "if (unreadable.has(id)) return { kind: 'damaged' }", "if (unreadable.has(id)) return { kind: 'free' }"]]],
  'n8b-store-add-dates-now': [FILE2, [[ST, '          {\n            ...conversation,\n', '          {\n            ...conversation,\n            updatedAt: Date.now(),\n']]],
  // ---- the flow around the dialogs
  'n8b-service-no-inside-check': [FILE2, [[SV, 'if (await isInside(dataDir, dest)) {', 'if (false) {']]],
  'n8b-service-links-not-followed': [FILE2, [[SV, 'return join(await fs.realpath(current), ...[...missing].reverse())', 'return join(resolve(current), ...[...missing].reverse())']]],
  'n8b-service-token-reusable': [FILE2, [[SV, '    pending = null // good for one use, whatever happens next\n', '']]],
  'n8b-service-token-unchecked': [FILE2, [[SV, "if (plan === null || typeof token !== 'string' || token !== plan.token) {", 'if (plan === null) {']]],
  'n8b-service-no-expiry': [FILE2, [[SV, '    if (now() - plan.at > lifetime) return { ok: false, error: NOTHING_WAITING }\n', '']]],
  'n8b-service-file-change-unseen': [FILE2, [[SV, 'if (info === null || info.size !== plan.size || info.mtimeMs !== plan.mtimeMs) {', 'if (info === null) {']]],
  'n8b-service-same-is-copy': [FILE2, [[SV, "return found.kind === 'here' && contentKey(found.conversation) === key ? 'same' : 'copy'", "return 'copy'"]]],
  'n8b-service-no-earlier-memory': [FILE2, [[SV, "      if (before !== undefined) return before === key ? 'same' : 'copy'\n", '']]],
  'n8b-service-not-exclusive': [FILE2, [[SV, '    if (running !== null) return busy\n', '']]],
  'n8b-service-look-keeps-old': [FILE2, [[SV, '    pending = null // a new look replaces the last one\n', '']]],
  'n8b-service-cancel-any-token': [FILE2, [[SV, '      if (pending !== null && token === pending.token) pending = null', '      pending = null']]],
  'n8b-service-copy-keeps-id': [FILE2, [
    [SV, 'let outcome = await store.add(asCopy ? { ...chat, id: randomUUID() } : chat)', 'let outcome = await store.add(chat)'],
    [SV, "if (!outcome.ok && outcome.why === 'occupied') {", 'if (false) {']
  ]],
  'n8b-service-page-picks-path': [FILE2, [[SV, '    const dest = await pickers.savePath(\n      owner,\n      name,\n      beforeEncrypting ? BEFORE_ENCRYPTING_TITLE : undefined\n    )', '    const dest =\n      (request as { path?: string }).path ??\n      (await pickers.savePath(owner, name, beforeEncrypting ? BEFORE_ENCRYPTING_TITLE : undefined))']]],
  'n8b-service-leftout-zero': [FILE2, [[SV, '      leftOut = unreadable\n', '      leftOut = 0\n']]],
  'n8b-service-room-ignored': [FILE2, [[SV, 'room: Math.max(0, HISTORY_LIMITS.maxConversations - conversations.length),', 'room: HISTORY_LIMITS.maxConversations,']]],
  // ---- what the page may ask, and the wiring in main
  'n8b-validate-scope-loose': [FILE2, [[VAL, "if (scope === 'all') return { ok: true, request: { scope: 'all' } }", "if (typeof scope === 'string' && scope.toLowerCase() === 'all') return { ok: true, request: { scope: 'all' } }"]]],
  'n8b-ipc-window-calls-unguarded': [FILE2, [[IPC, '      guarded((...rest: A) => handler(BrowserWindow.fromWebContents(event.sender), ...rest))(\n        event,\n        ...args\n      )', '      handler(BrowserWindow.fromWebContents(event.sender), ...args)']]],
  'n8b-ipc-look-no-window': [FILE2, [[IPC, 'guardedForWindow((window): Promise<HistoryRestoreLookResult> => backups.restoreLook(window))', 'guardedForWindow((): Promise<HistoryRestoreLookResult> => backups.restoreLook(null))']]],
  // (9.2, D-037: the list of what quitting waits for gained the attachments and is written one per line)
  'n8b-ipc-quit-not-waiting': [FILE2, [[IPC, '      ledger.whenIdle(),\n      backups.whenIdle(),\n', '      ledger.whenIdle(),\n']]],
  'n8b-ipc-cancel-untrusted': [FILE2, [[IPC, 'if (isTrustedSender(event, appUrl)) backups.restoreCancel(token)', 'backups.restoreCancel(token)']]],
  'n8b-preload-path-param': [FILE2, [[PRE, 'exportChats: (request) => ipcRenderer.invoke(CHANNELS.historyExport, request),', 'exportChats: (request, path?: string) => ipcRenderer.invoke(CHANNELS.historyExport, { ...request, path }),']]]
}

const win = {
  // the page
  'w8b-page-focus-on-add': [[PANEL, 'useEffect(() => dismissRef.current?.focus(), [])', "useEffect(() => document.querySelector<HTMLButtonElement>('.backup-preview .button:not(.button-secondary)')?.focus(), [])"]],
  'w8b-page-dismiss-adds': [[PANEL, 'onClick={onDismiss}', 'onClick={onAdd}']],
  'w8b-page-no-cancel-on-drop': [[HOOK, '    if (latestToken.current !== null && window.api)\n      window.api.history.restoreCancel(latestToken.current)\n', '']],
  'w8b-page-export-one-is-all': [[HOOK, "exportOne: (id) => exportWith({ scope: 'one', id }),", "exportOne: () => exportWith({ scope: 'all' }),"]],
  'w8b-page-not-locked': [[DIALOG, 'const locked = busy || backup.working', 'const locked = busy']],
  'w8b-page-error-as-status': [[DIALOG, "role={backup.notice.kind === 'error' ? 'alert' : 'status'}", 'role="status"']],
  'w8b-page-no-whole-warning': [[PANEL, '{!preview.complete && (', '{false && (']],
  'w8b-page-no-instructions-note': [[PANEL, '{preview.withInstructions > 0 && (', '{false && (']],
  'w8b-page-no-trust-note': [[PANEL, '      {toAdd > 0 && (\n        <p className="history-hint">\n          Add only a backup', '      {false && (\n        <p className="history-hint">\n          Add only a backup']],
  'w8b-page-list-not-reloaded': [[HOOK, '        reload() // the list shows what was added, or what is there after a failure\n', '']],
  'w8b-page-notice-not-cleared': [[DIALOG, '    clearNotice()\n    onClose()', '    onClose()']],
  // two layers wrap the footer (the footer itself, and the group of two buttons inside it): one alone changes nothing a person can see, so the control removes both
  'w8b-css-footer-nowrap': [[CSS, '.history-footer {\n  flex-wrap: wrap;\n  align-items: center;', '.history-footer {\n  flex-wrap: nowrap;\n  align-items: center;'], [CSS, '.history-backup-buttons {\n  display: flex;\n  flex-wrap: wrap;', '.history-backup-buttons {\n  display: flex;\n  flex-wrap: nowrap;']],
  'w8b-css-preview-scrolls': [[CSS, '.backup-preview {\n  flex: none;\n}', '.backup-preview {\n  overflow-y: auto;\n  min-height: 0;\n}']],
  // main, seen from the window
  'w8b-service-no-inside-check': [[SV, 'if (await isInside(dataDir, dest)) {', 'if (false) {']],
  'w8b-ipc-look-no-window': [[IPC, 'guardedForWindow((window): Promise<HistoryRestoreLookResult> => backups.restoreLook(window))', 'guardedForWindow((): Promise<HistoryRestoreLookResult> => backups.restoreLook(null))']],
  // since 10.4 the notes' export dialog asks before overwriting too: the backup's own is named by its filter
  'w8b-dialogs-no-overwrite-confirm': [[DLG, "filters: [BACKUP_FILTER],\n      properties: ['showOverwriteConfirmation' as const]", 'filters: [BACKUP_FILTER],\n      properties: []']],
  'w8b-service-page-picks-path': [[SV, '    const dest = await pickers.savePath(\n      owner,\n      name,\n      beforeEncrypting ? BEFORE_ENCRYPTING_TITLE : undefined\n    )', '    const dest =\n      (request as { path?: string }).path ??\n      (await pickers.savePath(owner, name, beforeEncrypting ? BEFORE_ENCRYPTING_TITLE : undefined))']],
  'w8b-service-token-reusable': [[SV, '    pending = null // good for one use, whatever happens next\n', '']]
}

const nodeDir = join(TOOLS, 'specs8b')
mkdirSync(nodeDir, { recursive: true })
for (const [name, [suite, edits]] of Object.entries(node)) {
  writeFileSync(join(nodeDir, `${name}.json`), JSON.stringify({ label: name, edits: edits.map(([file, from, to]) => ({ file, from, to })), argv: [`{{TOOLS}}/${suite}`], env: suite === FILE2 ? { QUICK: '1' } : {} }, null, 2) + '\n')
}
const wdir = join(TOOLS, 'specs8bw')
mkdirSync(wdir, { recursive: true })
for (const [name, edits] of Object.entries(win)) {
  writeFileSync(join(wdir, `${name}.json`), JSON.stringify({ label: name, edits: edits.map(([file, from, to]) => ({ file, from, to })), argv: ['{{TOOLS}}/run8b.mjs', 'dev'], env: { LOG_LABEL: `nc-${name}` } }, null, 2) + '\n')
}
console.log(`wrote ${Object.keys(node).length} specs in specs8b and ${Object.keys(win).length} in specs8bw`)
