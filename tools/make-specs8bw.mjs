// Writes the negative-control specs for the count wording after Stage 8b (verify-8b-wording.mjs): one sabotage each, which the suite must notice.
// usage: node tools/make-specs8bw.mjs
//   then: node tools/check-specs.mjs                 (dry check: every sabotage text is found exactly once)
//         node tools/nc-all.mjs specs8bw <names...>  (plain Node, no window; a few seconds each)
// Each spec backs up the file, applies its sabotage, runs the suite, and puts the file back (proved by hash).
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { TOOLS } from './paths.mjs'

const R = '{{REPO}}/'
const QS = R + 'src/main/chatEncryptionService.ts', PL = R + 'src/renderer/src/settings/useChatStorage.ts'
const BK = R + 'src/renderer/src/history/useBackup.ts', PN = R + 'src/renderer/src/history/RestorePreviewPanel.tsx'

// name: [[file, from, to], ...]
const specs = {
  // ---- the system's question (plainQuestion)
  'nw-question-message': [[QS, "will be rewritten as ${one ? 'a plain file' : 'plain files'}.", 'will be rewritten as plain files.']],
  'nw-question-detail': [[QS, "able to read ${one ? 'it' : 'them'},", 'able to read them,']],
  'nw-question-plural': [[QS, "${one ? 'a plain file' : 'plain files'}", "${one ? 'a plain file' : 'a plain file'}"]],
  'nw-question-one-inverted': [[QS, 'const one = facts.encrypted === 1', 'const one = facts.encrypted !== 1']],
  // ---- the page's notices
  'nw-plain-notice': [[PL, "as ${report.changed === 1 ? 'a plain file' : 'plain files'}.", 'as plain files.']],
  'nw-restore-notice': [[BK, "left as ${result.same === 1 ? 'it is' : 'they are'}.", 'left as they are.']],
  // ---- the restore preview panel
  'nw-panel-fresh': [[PN, "{preview.fresh === 1 ? 'it is' : 'they are'}", "{'they are'}"]],
  'nw-panel-same': [[PN, "{preview.same === 1 ? 'it is' : 'they are'}", "{'they are'}"]],
  'nw-panel-same-plural': [[PN, "{preview.same === 1 ? 'it is' : 'they are'}", "{'it is'}"]],
  'nw-panel-copies-verb': [[PN, "{preview.copies === 1 ? 'shares' : 'share'}", "{'share'}"]],
  'nw-panel-copies-noun': [[PN, "{preview.copies === 1 ? 'a copy' : 'copies'}", "{'copies'}"]],
  'nw-panel-instructions': [[PN, "{preview.withInstructions === 1 ? 'its' : 'their'}", "{'its'}"]],
  'nw-panel-space': [[PN, "new, to be added as{' '}", 'new, to be added as']]
}

const dir = join(TOOLS, 'specs8bw')
mkdirSync(dir, { recursive: true })
for (const [name, edits] of Object.entries(specs)) {
  writeFileSync(join(dir, `${name}.json`), JSON.stringify({ label: name, edits: edits.map(([file, from, to]) => ({ file, from, to })), argv: ['{{TOOLS}}/verify-8b-wording.mjs'], env: {} }, null, 2) + '\n')
}
console.log(`wrote ${Object.keys(specs).length} specs in specs8bw`)
