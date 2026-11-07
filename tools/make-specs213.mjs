// Writes the negative-control specs for Stage 21.3 (D-053, Auto): one sabotage each, which verify-21-3w.mjs (window) or verify-21-3.mjs (Node) must notice.
// usage: node tools/make-specs213.mjs
//   then: node tools/guarded-window-copy.mjs tools/nc-all.mjs specs213w <names...>     (the real window: one window per sabotage)
//         node tools/nc-all.mjs specs213 <names...>                                     (plain Node)
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { TOOLS } from './paths.mjs'
import { scratch } from './drive.mjs'

const P = '{{REPO}}/src/renderer/src/'
const AUTO = '{{REPO}}/src/shared/autoPick.ts'

const win = {
  // the chat view never hands the chat a picker: Auto picks nothing
  'w213-picker-never-set': [[P + 'chat/ChatView.tsx', '    if (!auto || status === null) {', '    if (true) {']],
  // the bridge drops the model Auto picked: the chosen model answers instead
  'w213-bridge-drops-model': [[P + 'chat/ipcReply.ts', '      ...(options.modelId === undefined ? {} : { modelId: options.modelId })', '      ...{}']],
  // main ignores a named model
  'w213-main-ignores-model': [['{{REPO}}/src/main/chat.ts', '      request.modelId !== undefined ? await modelById(request.modelId) : await currentModel()', '      request.modelId !== undefined ? await currentModel() : await currentModel()']],
  // the reason is not shown above the reply
  'w213-no-reason': [[P + 'chat/MessageBubble.tsx', '          <span className="message-auto">Auto: {message.autoReason}</span>', '          <span className="message-auto" />']],
  // choosing a model leaves Auto on
  'w213-choose-keeps-auto': [[P + 'settings/ModelPicker.tsx', '          if (auto) onAuto?.(false)\n', '']],
  // Auto ignores which makers have a key
  'w213-ignores-keys': [[AUTO, '    .filter((m) => keyed.has(m.provider))\n', '']]
}
const node = {
  // a quick answer goes to the dearest model
  'n213-quick-dearest': [[AUTO, '      modelId: able[0].id,\n      reason: \'the cheapest model you have a key for, for a quick answer\'', '      modelId: able[able.length - 1].id,\n      reason: \'the cheapest model you have a key for, for a quick answer\'']],
  // Auto ignores which makers have a key
  'n213-ignores-keys': [[AUTO, '    .filter((m) => keyed.has(m.provider))\n', '']],
  // pictures are not looked at
  'n213-ignores-pictures': [[AUTO, '(!input.pictures || m.imageInput)', 'true']]
}

const winEnv = (name) => ({ USER_DATA_DIR: scratch('s213nc'), WIPE_USER_DATA: '1', MOCK_PORT: '8854', PRESEED_FILE: '', LOG_LABEL: `nc-${name}` })
const winArgv = ['{{TOOLS}}/run-with-app.mjs', 'dev', 'setup-key.mjs,verify-21-3w.mjs', '{{OUT}}/shots', '9222']
const wdir = join(TOOLS, 'specs213w')
mkdirSync(wdir, { recursive: true })
for (const [name, edits] of Object.entries(win)) {
  writeFileSync(join(wdir, `${name}.json`), JSON.stringify({ label: name, edits: edits.map(([file, from, to]) => ({ file, from, to })), argv: winArgv, env: winEnv(name) }, null, 2) + '\n')
}
const ndir = join(TOOLS, 'specs213')
mkdirSync(ndir, { recursive: true })
for (const [name, edits] of Object.entries(node)) {
  writeFileSync(join(ndir, `${name}.json`), JSON.stringify({ label: name, edits: edits.map(([file, from, to]) => ({ file, from, to })), argv: ['{{TOOLS}}/verify-21-3.mjs'], env: {} }, null, 2) + '\n')
}
console.log(`wrote ${Object.keys(win).length} specs in specs213w and ${Object.keys(node).length} in specs213`)
