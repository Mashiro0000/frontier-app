// Writes the negative-control specs for slice 9.4 (what attached files are guessed to cost, D-037): one sabotage each, which the suites must notice.
// usage: node tools/make-specs94.mjs
//   then: node tools/check-specs.mjs                 (dry check)
//         node tools/nc-all.mjs specs94 <names...>   (verify-9-4.mjs, plain Node)
//         node tools/nc-all.mjs specs94w <names...>  (run94.mjs: the real window)
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { TOOLS } from './paths.mjs'

const R = '{{REPO}}/'
const USAGE = R + 'src/shared/usage.ts', ASK = R + 'src/shared/askFirst.ts', LIM = R + 'src/shared/limits.ts', REQ = R + 'src/main/attachmentRequest.ts'
const CHAT = R + 'src/main/chat.ts', DIALOG = R + 'src/renderer/src/chat/LargeRequestDialog.tsx'

const node = {
  'n94-image-no-margin': [[USAGE, 'const IMAGE_MARGIN = 1.25', 'const IMAGE_MARGIN = 1']],
  'n94-image-bigger-squares': [[USAGE, 'const IMAGE_SQUARE_PX = 28', 'const IMAGE_SQUARE_PX = 32']],
  'n94-pdf-page-low': [[USAGE, 'export const PDF_PAGE_TOKENS = 4_800', 'export const PDF_PAGE_TOKENS = 1_500']],
  'n94-files-not-framed': [[USAGE, '    TOKENS_PER_FILE * files.count', '    0 * files.count']],
  'n94-images-not-counted': [[USAGE, '  for (const image of files.images) tokens += imageTokens(image.width, image.height)\n', '']],
  'n94-text-not-counted': [[USAGE, '    tokensForBytes(files.textBytes) +', '    0 +']],
  'n94-req-not-counted': [[REQ, '      files.count += 1\n', '']],
  'n94-req-text-chars': [[REQ, '        files.textBytes += Buffer.byteLength(facts.text)', '        files.textBytes += facts.chars']],
  'n94-estimate-files-always': [[ASK, '    ...(files !== undefined && files.count > 0 ? { files: { ...files } } : {})', '    files: files ?? { count: 0, tokens: 0 }']],
  'n94-chat-text-only': [[CHAT, '      estimateInputTokens(streamRequest.system, streamRequest.messages) + fileTokens', '      estimateInputTokens(streamRequest.system, streamRequest.messages)']],
  'n94-chat-question-no-files': [[CHAT, '      entry.pricing,\n      files\n    )', '      entry.pricing\n    )']],
  'n94-chat-ledger-no-note': [[CHAT, '        (spend) => withFilesNote(checkAgainstLimits(limits, spend), files)', '        (spend) => checkAgainstLimits(limits, spend)']],
  'n94-limits-note-when-unset': [[LIM, '    refusal === LIMITS_UNSET_MESSAGE ||\n', '']],
  'n94-limits-note-plural': [[LIM, "      ? 'The file in this chat is'", "      ? `The 1 files in this chat are`"]]
}

const win = {
  'w94-text-only': [[CHAT, '      estimateInputTokens(streamRequest.system, streamRequest.messages) + fileTokens', '      estimateInputTokens(streamRequest.system, streamRequest.messages)']],
  'w94-dialog-no-sentence': [[DIALOG, '          {request.estimate.files !== undefined && (', '          {false && (']],
  'w94-question-no-files': [[CHAT, '      entry.pricing,\n      files\n    )', '      entry.pricing\n    )']],
  'w94-limit-no-note': [[CHAT, '        (spend) => withFilesNote(checkAgainstLimits(limits, spend), files)', '        (spend) => checkAgainstLimits(limits, spend)']]
}

const write = (dir, specs, argv, env, timeoutMs) => {
  mkdirSync(join(TOOLS, dir), { recursive: true })
  for (const [name, edits] of Object.entries(specs)) {
    writeFileSync(join(TOOLS, dir, `${name}.json`), JSON.stringify({ label: name, edits: edits.map(([file, from, to]) => ({ file, from, to })), argv, env, ...(timeoutMs ? { timeoutMs } : {}) }, null, 2) + '\n')
  }
}
write('specs94', node, ['{{TOOLS}}/verify-9-4.mjs'], {})
write('specs94w', win, ['{{TOOLS}}/run94.mjs', 'dev'], { NO_RETRY: '1' }, 400000)
console.log(`wrote ${Object.keys(node).length} specs in specs94 and ${Object.keys(win).length} in specs94w`)
