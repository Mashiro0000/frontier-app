// Writes the negative-control specs for slice 7.3 (Copy, Regenerate, Edit and send again, D-026): one sabotage each, which the suite named
// must notice.
// usage: node tools/make-specs73.mjs
//   then: node tools/nc-all.mjs specs73 <names...>     (plain-Node suite verify-7-3.mjs)
//         node tools/nc-all.mjs specs73w <names...>    (the real window: verify-7-3w.mjs; opens a window per sabotage)
// Each spec backs up the file, applies ONE sabotage, runs the suite, and puts the file back (proved by hash).
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { TOOLS } from './paths.mjs'
import { scratch } from './drive.mjs'

const C = '{{REPO}}/src/renderer/src/chat'
const REWRITE = `${C}/rewrite.ts`, ACTIONS = `${C}/MessageActions.tsx`, EDIT = `${C}/MessageEdit.tsx`, VIEW = `${C}/ChatView.tsx`, CHAT = `${C}/useChat.ts`
const CSS = '{{REPO}}/src/renderer/src/assets/main.css'

// ---- the plain-Node suite: [file, from, to] ----
const node = {
  'regenerate-keeps-the-reply': [[REWRITE, 'const rest = messages.slice(0, -1)', 'const rest = [...messages]']],
  'regenerate-needs-no-question': [[REWRITE, "return rest.at(-1)?.role === 'user' ? [...rest] : null", 'return [...rest]']],
  'regenerate-while-arriving': [[REWRITE, " || last.status === 'streaming'", '']],
  'later-counts-the-message-itself': [[REWRITE, 'return messages.length - 1 - at', 'return messages.length - at']],
  'later-for-any-role': [[REWRITE, "if (at === -1 || messages[at].role !== 'user') return null\n  return messages.length - 1 - at", 'if (at === -1) return null\n  return messages.length - 1 - at']],
  'edit-keeps-the-later-messages': [[REWRITE, 'return [...messages.slice(0, at), { ...messages[at], content: edited }]', 'return [...messages.slice(0, at), { ...messages[at], content: edited }, ...messages.slice(at + 1)]']],
  'edit-not-trimmed': [[REWRITE, '{ ...messages[at], content: edited }', '{ ...messages[at], content: text }']],
  'edit-allows-empty': [[REWRITE, " || edited === ''", '']],
  'edit-allows-a-reply': [[REWRITE, "messages[at].role !== 'user' || edited", 'edited']],
  'edit-while-arriving': [[REWRITE, "  if (messages.at(-1)?.status === 'streaming') return null\n  return [...messages.slice(0, at)", '  return [...messages.slice(0, at)']],
  'edit-changes-the-original': [[REWRITE, '{ ...messages[at], content: edited }', 'Object.assign(messages[at], { content: edited })']],
  'edit-takes-any-text': [[REWRITE, "  if (typeof text !== 'string') return null\n", '']]
}
const dir = join(TOOLS, 'specs73')
mkdirSync(dir, { recursive: true })
for (const [name, edits] of Object.entries(node)) {
  writeFileSync(join(dir, `${name}.json`), JSON.stringify({ label: name, edits: edits.map(([file, from, to]) => ({ file, from, to })), argv: ['{{TOOLS}}/verify-7-3.mjs'], env: {} }, null, 2) + '\n')
}
console.log(`wrote ${Object.keys(node).length} specs in specs73`)

// ---- the real window ----
const winEnv = (name) => ({ USER_DATA_DIR: scratch('s73nc'), WIPE_USER_DATA: '1', MOCK_PORT: '8796', INSPECT_PORT: '9230', PRESEED_FILE: '', LOG_LABEL: `nc-${name}` })
const winArgv = ['{{TOOLS}}/run-with-app.mjs', 'dev', 'verify-7-3w.mjs', '{{OUT}}/shots', '9222']
const EDIT_BTN = "          disabled={replying}\n          title={\n            replying\n              ? WAIT\n              : 'Change this message"
const win = {
  'w73-regenerate-sends-the-reply-too': [[CHAT, 'const history = withoutLastReply(latest.current.messages)\n    if (history !== null) latest.current.begin(history)', 'const history = withoutLastReply(latest.current.messages)\n    if (history !== null) latest.current.begin(latest.current.messages)']],
  'w73-edit-keeps-the-later-messages': [[REWRITE, 'return [...messages.slice(0, at), { ...messages[at], content: edited }]', 'return [...messages.slice(0, at), { ...messages[at], content: edited }, ...messages.slice(at + 1)]']],
  'w73-edit-never-asks': [[EDIT, 'if (later > 1 && !confirming) {', 'if (false) {']],
  'w73-edit-asks-too-soon': [[EDIT, 'if (later > 1 && !confirming) {', 'if (later > 0 && !confirming) {']],
  'w73-edit-not-trimmed': [[EDIT, '    onSend(edited)', '    onSend(text)']],
  'w73-edit-enabled-while-arriving': [[ACTIONS, EDIT_BTN, EDIT_BTN.replace('disabled={replying}', 'disabled={false}')]],
  'w73-copy-the-drawn-text': [[ACTIONS, 'onClick={() => copy(message.content)}', "onClick={() => copy(message.content.replace(/\\*\\*/g, ''))}"]],
  'w73-copy-while-arriving': [[ACTIONS, "const canCopy = message.content !== '' && !arriving", "const canCopy = message.content !== ''"]],
  'w73-regenerate-on-every-reply': [[ACTIONS, "const canRegenerate = message.role === 'assistant' && isLast && !arriving", "const canRegenerate = message.role === 'assistant' && !arriving"]],
  'w73-edit-on-every-message': [[ACTIONS, "const canEdit = message.role === 'user'", 'const canEdit = true']],
  'w73-try-again-label': [[ACTIONS, "{message.status === 'error' ? 'Try again' : 'Regenerate'}", '{"Regenerate"}']],
  'w73-actions-not-shown-on-focus': [[CSS, '.message:focus-within .message-actions,\n', '']],
  'w73-focus-not-returned': [[VIEW, 'focusKey={`${conversationId}:${asked}`}', 'focusKey={conversationId}']]
}
const wdir = join(TOOLS, 'specs73w')
mkdirSync(wdir, { recursive: true })
for (const [name, edits] of Object.entries(win)) {
  writeFileSync(join(wdir, `${name}.json`), JSON.stringify({ label: name, edits: edits.map(([file, from, to]) => ({ file, from, to })), argv: winArgv, env: winEnv(name) }, null, 2) + '\n')
}
console.log(`wrote ${Object.keys(win).length} specs in specs73w`)
