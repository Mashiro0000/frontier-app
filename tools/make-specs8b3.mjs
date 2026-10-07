// Writes the negative-control specs for Stages 8b.3 and 8b.4 (encrypting the saved chats; the key that cannot be read, D-035): one sabotage each, which the suites must notice.
// usage: node tools/make-specs8b3.mjs
//   then: node tools/check-specs.mjs                  (dry check: every sabotage text is found exactly once)
//         node tools/nc-all.mjs specs8b3 <names...>   (plain-Node suite verify-8b-3.mjs, run with QUICK=1: the normal folder only)
//         node tools/nc-all.mjs specs8b3w <names...>  (the real window: run8b3.mjs seeds the profile and runs the launches the control needs; opens a window per launch)
// Each spec backs up the files, applies its sabotage, runs the suite, and puts the files back (proved by hash). A spec may carry "timeoutMs" for the longer window runs.
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { TOOLS } from './paths.mjs'

const R = '{{REPO}}/'
const CF = R + 'src/main/chatFile.ts', CP = R + 'src/main/chatProtection.ts', ST = R + 'src/main/conversationStore.ts', ES = R + 'src/main/chatEncryptionService.ts'
const SV = R + 'src/main/backupService.ts', DLG = R + 'src/main/backupDialogs.ts', IPC = R + 'src/main/ipc.ts', PRE = R + 'src/preload/index.ts', SHARED = R + 'src/shared/ipc.ts'
const SECTION = R + 'src/renderer/src/settings/ChatStorageSection.tsx', HOOK = R + 'src/renderer/src/settings/useChatStorage.ts', HIST = R + 'src/renderer/src/history/HistoryDialog.tsx', APP = R + 'src/renderer/src/App.tsx', CSS = R + 'src/renderer/src/assets/main.css'
const FILE3 = 'verify-8b-3.mjs'

// name: [suite, [[file, from, to], ...]]
const node = {
  // ---- the envelope
  'n3-env-version-unchecked': [FILE3, [[CF, '    v !== ENVELOPE_VERSION ||\n', '']]],
  'n3-env-base64-unchecked': [FILE3, [[CF, '    data.length > MAX_DATA_CHARS ||\n    !BASE64.test(data) // which also refuses an empty string: the pattern needs at least one character\n', '    data.length > MAX_DATA_CHARS\n']]],
  'n3-env-length-unchecked': [FILE3, [[CF, '    data.length > MAX_DATA_CHARS ||\n', '']]],
  // (there is no control for an empty `data`: the base64 pattern already refuses it, so a separate check for it was dead code and was removed)
  'n3-env-availability-ignored': [FILE3, [[CF, 'if (box === undefined || !box.isAvailable()) {', 'if (box === undefined) {']]],
  'n3-env-isenvelope-loose': [FILE3, [[CF, '    (value as Record<string, unknown>).format === ENVELOPE_FORMAT\n', '    true\n']]],
  'n3-env-opensto-true': [FILE3, [[CF, '  return opened.ok && opened.text === plain', '  return true']]],
  'n3-env-cap-small': [FILE3, [[CF, 'export const MAX_ENCRYPTED_FILE_BYTES = MAX_DATA_CHARS + 128', 'export const MAX_ENCRYPTED_FILE_BYTES = HISTORY_LIMITS.maxFileBytes']]],
  'n3-env-prefix-any-json': [FILE3, [[CF, 'export const SEALED_PREFIX = `{"format":"${ENVELOPE_FORMAT}"`', "export const SEALED_PREFIX = '{'"]]],
  // ---- the choice and its rule
  'n3-prot-damage-is-off': [FILE3, [[CP, "    raw = JSON.parse(text)\n  } catch {\n    return { choice: 'unreadable' }\n  }", "    raw = JSON.parse(text)\n  } catch {\n    return { choice: 'off' }\n  }"]]],
  'n3-prot-shape-damage-is-off': [FILE3, [[CP, "  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return { choice: 'unreadable' }", "  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return { choice: 'off' }"]]],
  'n3-prot-version-unchecked': [FILE3, [[CP, "  if (file.version !== FILE_VERSION) return { choice: 'unreadable' }\n", '']]],
  'n3-prot-check-lax': [FILE3, [[CP, '    file.check.length <= MAX_CHECK_CHARS &&\n    BASE64.test(file.check)\n', '    file.check.length <= MAX_CHECK_CHARS\n']]],
  'n3-prot-size-unchecked': [FILE3, [[CP, 'if ((await fs.stat(pathOf())).size > MAX_FILE_BYTES) {', 'if (false as boolean) {']]],
  'n3-prot-transient-kept': [FILE3, [[CP, "      return { setting: { choice: 'unreadable' }, keep: false }", "      return { setting: { choice: 'unreadable' }, keep: true }"]]],
  'n3-prot-check-always-opens': [FILE3, [[CP, "      return box.decrypt(Buffer.from(check, 'base64')) === CHECK_TEXT", '      return true']]],
  'n3-prot-nostorage-unseen': [FILE3, [[CP, '    if (!canEncrypt) {\n      return { choice: \'on\'', '    if (false as boolean) {\n      return { choice: \'on\'']]],
  'n3-prot-blocked-is-plain': [FILE3, [[CP, '        if (now.blocked !== null) return { refused: now.blocked }', "        if (now.blocked !== null) return { form: 'plain' }"]]],
  'n3-prot-blocked-is-encrypted': [FILE3, [[CP, '        if (now.blocked !== null) return { refused: now.blocked }', "        if (now.blocked !== null) return { form: 'encrypted' }"]]],
  'n3-prot-turnon-no-availability': [FILE3, [[CP, "        if (!box.isAvailable()) throw new Error('this computer has no secure storage')\n", '']]],
  'n3-prot-turnon-no-selftest': [FILE3, [[CP, "        if (!opens(check.toString('base64'))) {", 'if (false as boolean) {']]],
  'n3-prot-no-readback': [FILE3, [[CP, '      if (JSON.stringify(back) !== JSON.stringify(setting)) {', '      if (false as boolean) {']]],
  'n3-prot-failed-save-stale': [FILE3, [[CP, '      current = null // what is on disk now is the truth: the next read looks at it\n', '']]],
  // ---- the store
  'n3-store-write-always-plain': [FILE3, [[ST, "    const text = form === 'encrypted' && box !== undefined ? sealChat(plain, box) : plain", '    const text = plain']]],
  'n3-store-save-no-gate': [FILE3, [[ST, "        if ('refused' in mode) return { ok: false, error: mode.refused }\n", '']]],
  'n3-store-add-no-gate': [FILE3, [[ST, "        if ('refused' in mode) return { ok: false, why: 'blocked', error: mode.refused }\n", '']]],
  'n3-store-conform-no-gate': [FILE3, [[ST, "      if ('refused' in mode) return 'failed'\n", '']]],
  'n3-store-blocked-always-null': [FILE3, [[ST, "      return 'refused' in mode ? mode.refused : null", '      return null']]],
  'n3-store-no-open-proof': [FILE3, [[ST, " || (form === 'encrypted' && !opensTo(back, plain, box))", '']]],
  'n3-store-plain-hides-behind-tmp': [FILE3, [[ST, "    const plain = copy.form === 'plain' || (real.kind === 'ok' && real.form === 'plain')", "    const plain = copy.form === 'plain'"]]],
  'n3-store-tmp-leftover-kept': [FILE3, [[ST, "      if (read.form === mode.form && !read.tmp) return 'already'", "      if (read.form === mode.form) return 'already'"]]],
  'n3-store-conform-one-turn': [FILE3, [[ST, "      for (const id of ids) {\n        const outcome = await inOrder(() => conformOne(id))\n        if (outcome !== null) result[outcome] += 1\n      }", "      await inOrder(async () => {\n        for (const id of ids) {\n          const outcome = await conformOne(id)\n          if (outcome !== null) result[outcome] += 1\n        }\n      })"]]],
  'n3-store-unopened-not-counted': [FILE3, [[ST, '    if (wasEncrypted) unopened.add(id)\n    else unopened.delete(id)\n', '    unopened.delete(id)\n']]],
  'n3-store-sealed-cap-is-plain-cap': [FILE3, [[ST, "  if (size > MAX_ENCRYPTED_FILE_BYTES) return { kind: 'bad', why: 'the file is too large' }", "  if (size > HISTORY_LIMITS.maxFileBytes) return { kind: 'bad', why: 'the file is too large' }"]]],
  'n3-store-sniff-removed': [FILE3, [[ST, '  if (size > HISTORY_LIMITS.maxFileBytes && !(await beginsSealed(path))) {', '  if (false as boolean) {']]],
  'n3-store-envelope-id-unchecked': [FILE3, [[ST, '    const checked = parseSavedFile(inner, id)', '    const checked = parseSavedFile(inner, (inner as { id?: string })?.id ?? id)']]],
  // ---- the flow
  'n3-svc-no-backup': [FILE3, [[ES, '    if (counts.plain + counts.encrypted > 0) {', '    if (false as boolean) {']]],
  'n3-svc-backup-failure-ignored': [FILE3, [[ES, '      if (!made.ok) {', '      if (false as boolean) {']]],
  'n3-svc-confirm-always-yes': [FILE3, [[ES, '    if (!yes) return { ok: false, cancelled: true, error: \'Cancelled.\' }', '    void yes']]],
  'n3-svc-asks-when-nothing-to-weaken': [FILE3, [[ES, "  if (before.choice === 'off' && counts.encrypted === 0 && sealedFiles === 0) {", '  if (false as boolean) {']]],
  'n3-svc-key-lost-encrypts': [FILE3, [[ES, "    if (before.choice === 'on' && before.keyUsable !== true) {", '    if (false as boolean) {']]],
  'n3-svc-noop-asks-backup': [FILE3, [[ES, "    if (before.choice === 'on' && counts.plain === 0 && plainFiles === 0) {", '    if (false as boolean) {']]],
  'n3-svc-no-lock': [FILE3, [[ES, '      backups.exclusive<ChatStorageResult>({ ok: false, error: BUSY }, () => encrypt(owner)),', '      encrypt(owner),']]],
  // ---- the backup service
  'n3-backup-no-title': [FILE3, [[SV, '      beforeEncrypting ? BEFORE_ENCRYPTING_TITLE : undefined\n    )', '      undefined\n    )']]],
  'n3-backup-name-same': [FILE3, [[SV, '      name = beforeEncrypting\n        ? `frontier-chats-before-encrypting-${day}.jsonl`\n        : `frontier-chats-${day}.jsonl`', '      name = `frontier-chats-${day}.jsonl`']]],
  'n3-backup-restore-no-block': [FILE3, [[SV, '    if (refusal !== null) return { ok: false, error: `Nothing was added. ${refusal}` }\n', '']]],
  // ---- the dialogs, the handlers, the bridge, the shared type
  'n3-dialogs-default-yes': [FILE3, [[DLG, 'defaultId: 1, // the safe answer has the focus, and Escape is the same answer', 'defaultId: 0, // the safe answer has the focus, and Escape is the same answer']]],
  'n3-dialogs-cancel-yes': [FILE3, [[DLG, '      cancelId: 1,', '      cancelId: 0,']]],
  'n3-dialogs-always-yes': [FILE3, [[DLG, '    return result.response === 0', '    return true']]],
  'n3-ipc-storage-unguarded': [FILE3, [[IPC, '    CHANNELS.historyStorage,\n    guarded(async (): Promise<ChatStorageStatus> => {', '    CHANNELS.historyStorage,\n    (async (): Promise<ChatStorageStatus> => {']]],
  'n3-ipc-encrypt-unguarded': [FILE3, [[IPC, '    CHANNELS.historyEncrypt,\n    guardedForWindow(async (window): Promise<ChatStorageResult> => {', '    CHANNELS.historyEncrypt,\n    (async (): Promise<ChatStorageResult> => {\n      const window = null']]],
  'n3-ipc-decrypt-unguarded': [FILE3, [[IPC, '    CHANNELS.historyDecrypt,\n    guardedForWindow(async (window): Promise<ChatStorageResult> => {', '    CHANNELS.historyDecrypt,\n    (async (): Promise<ChatStorageResult> => {\n      const window = null']]],
  'n3-preload-decrypt-takes-answer': [FILE3, [[PRE, '    decryptChats: () => ipcRenderer.invoke(CHANNELS.historyDecrypt)', '    decryptChats: (answer?: boolean) => ipcRenderer.invoke(CHANNELS.historyDecrypt, answer)']]],
  'n3-preload-encrypt-takes-path': [FILE3, [[PRE, '    encryptChats: () => ipcRenderer.invoke(CHANNELS.historyEncrypt)', '    encryptChats: (path?: string) => ipcRenderer.invoke(CHANNELS.historyEncrypt, path)']]],
  'n3-shared-status-leaks-check': [FILE3, [[SHARED, '  blocked: string | null\n}\n\n/** What turning encryption on or off did', '  blocked: string | null\n  check: string\n}\n\n/** What turning encryption on or off did']]]
}

// name: [launches, [[file, from, to], ...]]   (launches: 1 = the first launch only; 3 = through the lost key)
const win = {
  // launch 1: the page, the wiring, the dialogs, the flow
  'w8b3-page-not-locked': [1, [[SECTION, 'disabled={storage.working || !status.canEncrypt}', 'disabled={!status.canEncrypt}']]],
  'w8b3-page-history-not-reloaded': [1, [[APP, 'onChatStorageChanged={history.reload}', 'onChatStorageChanged={() => undefined}']]],
  'w8b3-page-history-says-plain': [1, [[HIST, "{history.storage?.choice === 'on'", "{history.storage?.choice === 'never'"]]],
  'w8b3-page-no-backup-sentence': [1, [[HOOK, '  if (report.backup !== null) {', '  if (false as boolean) {']]],
  'w8b3-page-no-backup-reminder': [1, [[SECTION, "          {status.choice === 'on' && status.keyUsable === true && (\n            <p className=\"settings-hint\">\n              A backup holds", "          {false && (\n            <p className=\"settings-hint\">\n              A backup holds"]]],
  'w8b3-css-button-fixed-height': [1, [[CSS, '.storage-button {\n  height: auto;', '.storage-button {\n  height: 36px;']]],
  'w8b3-css-path-no-wrap': [1, [[CSS, '.storage-section p {\n  overflow-wrap: anywhere;\n}', '.storage-section p {\n  overflow-wrap: normal;\n}']]],
  // (9.2, D-037: the attachment store is made with the same two options, so the anchor names the chat store)
  'w8b3-ipc-store-no-writemode': [1, [[IPC, '  const history = createConversationStore(folder, {\n    box: secureStorage,\n    writeMode: protection.writeMode\n', '  const history = createConversationStore(folder, {\n    box: secureStorage\n']]],
  'w8b3-ipc-store-no-box': [1, [[IPC, '  const history = createConversationStore(folder, {\n    box: secureStorage,\n    writeMode: protection.writeMode\n', '  const history = createConversationStore(folder, {\n    writeMode: protection.writeMode\n']]],
  'w8b3-ipc-list-no-storage': [1, [[IPC, 'return { ...(await history.list()), folder, storage: await encryption.status() }', "return { ...(await history.list()), folder, storage: { choice: 'off', canEncrypt: true, keyUsable: null, plain: 0, encrypted: 0, unreadable: 0, unopened: 0, blocked: null } }"]]],
  'w8b3-dialogs-no-title': [1, [[DLG, '      title,\n      defaultPath', "      title: 'Back up chats',\n      defaultPath"]]],
  'w8b3-dialogs-default-yes': [1, [[DLG, 'defaultId: 1, // the safe answer has the focus, and Escape is the same answer', 'defaultId: 0, // the safe answer has the focus, and Escape is the same answer']]],
  'w8b3-dialogs-always-yes': [1, [[DLG, '    return result.response === 0', '    return true']]],
  'w8b3-service-no-backup': [1, [[ES, '    if (counts.plain + counts.encrypted > 0) {', '    if (false as boolean) {']]],
  'w8b3-service-no-confirm': [1, [[ES, '    if (!yes) return { ok: false, cancelled: true, error: \'Cancelled.\' }', '    void yes']]],
  // launch 3: the key that cannot be read
  'w8b3-page-no-blocked-alert': [3, [[SECTION, '{status.blocked !== null && (', '{false && (']]],
  'w8b3-page-no-blocked-history': [3, [[HIST, '{history.storage?.blocked && (', '{false && (']]],
  'w8b3-page-encrypt-when-lost': [3, [[SECTION, "if (status.keyUsable !== true) return { encrypt: null, plain: 'Turn encryption off...' }", "if (status.keyUsable !== true) return { encrypt: 'Encrypt my saved chats...', plain: 'Turn encryption off...' }"]]],
  'w8b3-service-encrypt-when-lost': [3, [[ES, "    if (before.choice === 'on' && before.keyUsable !== true) {", '    if (false as boolean) {']]],
  'w8b3-protection-lost-is-plain': [3, [[CP, '        if (now.blocked !== null) return { refused: now.blocked }', "        if (now.blocked !== null) return { form: 'plain' }"]]],
  'w8b3-protection-check-always-opens': [3, [[CP, "      return box.decrypt(Buffer.from(check, 'base64')) === CHECK_TEXT", '      return true']]],
  'w8b3-backup-restore-no-block': [3, [[SV, '    if (refusal !== null) return { ok: false, error: `Nothing was added. ${refusal}` }\n', '']]]
}

const nodeDir = join(TOOLS, 'specs8b3')
mkdirSync(nodeDir, { recursive: true })
for (const [name, [suite, edits]] of Object.entries(node)) {
  writeFileSync(join(nodeDir, `${name}.json`), JSON.stringify({ label: name, edits: edits.map(([file, from, to]) => ({ file, from, to })), argv: [`{{TOOLS}}/${suite}`], env: { QUICK: '1' } }, null, 2) + '\n')
}
const wdir = join(TOOLS, 'specs8b3w')
mkdirSync(wdir, { recursive: true })
for (const [name, [launches, edits]] of Object.entries(win)) {
  writeFileSync(join(wdir, `${name}.json`), JSON.stringify({ label: name, edits: edits.map(([file, from, to]) => ({ file, from, to })), argv: ['{{TOOLS}}/run8b3.mjs', 'dev', String(launches)], env: { LOG_LABEL: `nc-${name}`, NO_RETRY: '1' }, timeoutMs: launches === 1 ? 300000 : 700000 }, null, 2) + '\n')
}
console.log(`wrote ${Object.keys(node).length} specs in specs8b3 and ${Object.keys(win).length} in specs8b3w`)
