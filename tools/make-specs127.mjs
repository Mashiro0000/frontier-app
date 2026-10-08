// Writes the negative-control specs for slice 12.7 (cost, encryption and backups of the code workspace, D-042): one sabotage each, which a suite must notice.
// usage: node tools/make-specs127.mjs
//   then: node tools/check-specs.mjs                   (dry check)
//         node tools/nc-all.mjs specs127 <names...>    (verify-12-7.mjs, plain Node)
//         node tools/nc-all.mjs specs127w <names...>   (run127.mjs: the real window)
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { TOOLS } from './paths.mjs'

const R = '{{REPO}}/'
const CH = R + 'src/main/chat.ts', AF = R + 'src/shared/askFirst.ts', US = R + 'src/shared/usage.ts', DLG = R + 'src/renderer/src/chat/LargeRequestDialog.tsx', IPR = R + 'src/renderer/src/chat/ipcReply.ts'
const TN = R + 'src/shared/toolNotes.ts', BK = R + 'src/main/backup.ts', IPC = R + 'src/main/ipc.ts'

const node = {
  // ----- the estimate -----
  eTurnRecord: [US, "    if (message.toolTurn !== undefined)\n      bytes += utf8Length(JSON.stringify(message.toolTurn.record) ?? '')\n", ''],
  eContent: [US, '    bytes += utf8Length(message.content)\n', ''],
  eRound: [US, 'return tokensForBytes(bytes) + TOKENS_PER_MESSAGE * messages.length', 'return Math.floor(bytes / 3) + TOKENS_PER_MESSAGE * messages.length'],
  // ----- asking again -----
  gApproved: [AF, 'micros(estimate.inputUsd) - micros(approvedInputUsd) > micros(above)', 'micros(estimate.inputUsd) > micros(above)'],
  gGrowthEq: [AF, 'micros(estimate.inputUsd) - micros(approvedInputUsd) > micros(above)', 'micros(estimate.inputUsd) - micros(approvedInputUsd) >= micros(above)'],
  gNever: [AF, 'return above !== null && micros(estimate.inputUsd) - micros(approvedInputUsd)', 'return micros(estimate.inputUsd) - micros(approvedInputUsd)'],
  gMicros: [AF, 'micros(estimate.inputUsd) - micros(approvedInputUsd) > micros(above)', 'estimate.inputUsd - approvedInputUsd > above'],
  // ----- where it is asked -----
  cLoop: [CH, '      if (pass > 0) {\n', '      if (pass > 99) {\n'],
  cApproved: [CH, '          approvedInputUsd = next.inputUsd\n', ''],
  cReturn: [CH, '          if (!(await askLarge(next, true))) return\n', '          await askLarge(next, true)\n'],
  cFirstReturn: [CH, '    if (needsConfirmation(askFirst, estimate) && !(await askLarge(estimate, false))) return', '    if (needsConfirmation(askFirst, estimate)) await askLarge(estimate, false)'],
  cLaterFlag: [CH, '          ...(later ? { later: true } : {})\n', ''],
  cAnswer: [CH, "      return answer === 'send' && !controller.signal.aborted", "      return answer === 'send'"],
  cApprovedFirst: [CH, '    let approvedInputUsd = estimate.inputUsd', '    let approvedInputUsd = 0'],
  cEstimate: [CH, '          inputTokens,\n          streamRequest.maxOutputTokens,\n          entry.pricing,\n          files\n        )\n        if (needsConfirmationAgain', '          0,\n          streamRequest.maxOutputTokens,\n          entry.pricing,\n          files\n        )\n        if (needsConfirmationAgain'],
  // ----- encryption and backups -----
  kWorkspace: [IPC, 'workspaceStore.file,\n      undoJournal.document', 'undoJournal.document'],
  kTitle: [TN, '    if (title !== toolTitle(tool)) return null\n', ''],
  bNames: [BK, 'export const BACKUP_FORMAT', "const WORKSPACE_FILE_FOR_BACKUP = 'workspace.json'\nexport const BACKUP_FORMAT"]
}

const win = {
  wLoop: node.cLoop,
  wApproved: node.cApproved,
  wApprovedFirst: node.cApprovedFirst,
  wGapproved: node.gApproved,
  wReturn: node.cReturn,
  wLaterFlag: node.cLaterFlag,
  wEstimate: node.cEstimate,
  wTurnRecord: node.eTurnRecord,
  wOrder: [CH, '      if (pass > 0) {\n', '      if (pass > 0 && (await beginRequest())) {\n'],
  wIntro: [DLG, "{request.later === true\n              ? 'The reply is not finished.", "{request.later === false\n              ? 'The reply is not finished."],
  wMsg: [IPR, 'throw new Error(event.later === true ? NOT_SENT_LATER_MESSAGE : NOT_SENT_MESSAGE)', 'throw new Error(NOT_SENT_MESSAGE)'],
  wPass: [IPR, '          ...(event.later === true ? { later: true } : {})\n', '']
}

const write = (dir, specs, argv, env, timeoutMs, prefix) => {
  mkdirSync(join(TOOLS, dir), { recursive: true })
  for (const [name, edit] of Object.entries(specs)) {
    const [file, from, to] = edit
    writeFileSync(join(TOOLS, dir, `${prefix}${name}.json`), JSON.stringify({ label: `${prefix}${name}`, edits: [{ file, from, to }], argv, env, ...(timeoutMs ? { timeoutMs } : {}) }, null, 2) + '\n')
  }
}
write('specs127', node, ['{{TOOLS}}/verify-12-7.mjs'], {}, 280000, 'n127-')
write('specs127w', win, ['{{TOOLS}}/run127.mjs', 'dev'], { NO_RETRY: '1' }, 600000, 'w127-')
console.log(`wrote ${Object.keys(node).length} specs in specs127 and ${Object.keys(win).length} in specs127w`)
