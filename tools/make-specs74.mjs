// Writes the negative-control specs for slice 7.4 (instructions per chat, D-027): one sabotage each, which the suite named must notice.
// usage: node tools/make-specs74.mjs
//   then: node tools/nc-all.mjs specs74 <names...>     (plain-Node suite verify-7-4.mjs)
//         node tools/nc-all.mjs specs74w <names...>    (the real window: run74.mjs seeds four files and runs verify-7-4w.mjs; opens a window per sabotage)
// Each spec backs up the file, applies ONE sabotage, runs the suite, and puts the file back (proved by hash).
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { TOOLS } from './paths.mjs'

const V = '{{REPO}}/src/shared/validate.ts'
const R = '{{REPO}}/src/main/providers/request.ts'
const S = '{{REPO}}/src/main/conversationStore.ts'
const CH = '{{REPO}}/src/main/chat.ts'
const IPC = '{{REPO}}/src/main/ipc.ts'
const AN = '{{REPO}}/src/main/providers/anthropic.ts'
const OA = '{{REPO}}/src/main/providers/openai.ts'
const P = '{{REPO}}/src/renderer/src/'
const IR = P + 'chat/ipcReply.ts', UC = P + 'chat/useChat.ts', UH = P + 'history/useHistory.ts', CB = P + 'chat/ChatBar.tsx', DLG = P + 'instructions/InstructionsDialog.tsx'
const UTIMES = "await fs.utimes(join(dir, `${id}.json`), new Date(), new Date())" // makes reading write: the modification time moves
// Since 10.2 (D-039) request.ts builds the prompt from pieces (the rules, then every chat's instructions, then this chat's), so the 7.4 sabotages
// are made on those lines, with the same meaning.
const JOIN = "  return pieces.join('\\n\\n')"
const OWN_PUSH = "  if (own !== '') pieces.push(others ? CHAT_AFTER_OTHERS_LEAD : INSTRUCTIONS_LEAD, own)"
const VERSIONS = '    file.version !== 2 &&\n    file.version !== 3 &&' // the condition spans lines since 10.5

// ---- the plain-Node suite: [file, from, to] ----
const node = {
  'n74-trim-removed': [[V, 'const instructions = input.trim()\n  if (instructions.length', 'const instructions = input\n  if (instructions.length']],
  'n74-limit-off-by-one': [[V, 'if (instructions.length > CHAT_LIMITS.maxInstructionsChars) {', 'if (instructions.length >= CHAT_LIMITS.maxInstructionsChars) {']],
  'n74-limit-removed': [[V, 'if (instructions.length > CHAT_LIMITS.maxInstructionsChars) {', 'if (false) {']],
  'n74-non-text-is-none': [[V, "  if (typeof input !== 'string')\n    return { ok: false, error: 'The instructions were not understood.' }", "  if (typeof input !== 'string') return { ok: true, instructions: '' }"]],
  'n74-request-drops-instructions': [[V, "...(checkedInstructions.instructions === ''\n        ? {}\n        : { instructions: checkedInstructions.instructions })", '...{}']],
  'n74-request-keeps-blank': [[V, "...(checkedInstructions.instructions === ''\n        ? {}", '...(false\n        ? {}']],
  'n74-request-passes-system': [[V, '      streamId,\n      messages: clean,\n      ...(checkedInstructions', '      ...(input as object),\n      streamId,\n      messages: clean,\n      ...(checkedInstructions']],
  'n74-request-ignores-bad-instructions': [[V, 'if (!checkedInstructions.ok) return refuse(checkedInstructions.error)', 'void 0']],
  'n74-save-refusal-removed': [[V, 'if (!checkedInstructions.ok) return checkedInstructions\n', 'void 0\n']],
  'n74-save-drops-instructions': [[V, '      instructions: checkedInstructions.instructions,\n      ...(project', "      instructions: '',\n      ...(project"]],
  'n74-prompt-instructions-first': [[R, JOIN, "  return own === '' ? pieces.join('\\n\\n') : [...pieces.slice(1), rules].join('\\n\\n')"]],
  'n74-prompt-lead-removed': [[R, OWN_PUSH, "  if (own !== '') pieces.push(own)"]],
  'n74-prompt-replaces-rules': [[R, JOIN, "  return own === '' ? pieces.join('\\n\\n') : own"]],
  'n74-prompt-blank-counts': [[R, "  if (own !== '') pieces.push(", '  if (instructions) pieces.push(']],
  'n74-prompt-not-trimmed': [[R, "const own = instructions?.trim() ?? ''", "const own = instructions ?? ''"]],
  'n74-build-drops-instructions': [[R, 'system: systemPromptFor(model.provider, input.instructions, {', 'system: systemPromptFor(model.provider, undefined, {']], // the parts on lines of their own since 10.4
  'n74-anthropic-adapter-drops-instructions': [[AN, 'system: request.system,', "system: request.system.split('\\n\\n')[0],"]],
  'n74-openai-adapter-drops-instructions': [[OA, 'instructions: request.system,', "instructions: request.system.split('\\n\\n')[0],"]],
  // 9.3 (D-037): the version is worked out by fileVersion; the sabotage still writes version 2
  'n74-store-writes-version-2': [[S, '    const version = fileVersion(conversation)', '    const version = 2']],
  'n74-store-v3-refused': [[S, VERSIONS, '    file.version !== 2 &&']],
  'n74-store-v2-refused': [[S, VERSIONS, '    file.version !== 3 &&']],
  'n74-store-v3-instructions-optional': [[S, "    if (checked === null || !checked.ok) return 'its instructions are not usable'\n    instructions = checked.instructions", "    instructions = checked !== null && checked.ok ? checked.instructions : ''"]],
  'n74-store-old-files-instructions-read': [[S, "  let instructions = ''\n  if (file.version === 3 || file.version === 4 || file.version === 5) {", "  let instructions = typeof file.instructions === 'string' ? file.instructions : ''\n  if (file.version === 3 || file.version === 4 || file.version === 5) {"]],
  'n74-store-writes-unchecked': [[S, "        if (!checkedInstructions.ok) return { ok: false, error: checkedInstructions.error }\n", '']],
  'n74-store-writes-untrimmed': [[S, 'instructions: checkedInstructions.instructions,', "instructions: input.instructions ?? '',"]],
  'n74-store-reading-rewrites': [[S, "if ('conversation' in read) {\n              index.set(id, {", `if ('conversation' in read) {\n              ${UTIMES}\n              index.set(id, {`]]
}
const dir = join(TOOLS, 'specs74')
mkdirSync(dir, { recursive: true })
for (const [name, edits] of Object.entries(node)) {
  writeFileSync(join(dir, `${name}.json`), JSON.stringify({ label: name, edits: edits.map(([file, from, to]) => ({ file, from, to })), argv: ['{{TOOLS}}/verify-7-4.mjs'], env: {} }, null, 2) + '\n')
}
console.log(`wrote ${Object.keys(node).length} specs in specs74`)

// ---- the real window: the renderer, and the wiring that the Node suite cannot see ----
const win = {
  'w74-ipc-reply-drops-instructions': [[IR, "...(instructions === '' ? {} : { instructions })", '...{}']],
  'w74-chat-ts-drops-instructions': [[CH, 'instructions: request.instructions,', 'instructions: undefined,']],
  'w74-prompt-instructions-first': [[R, JOIN, "  return own === '' ? pieces.join('\\n\\n') : [...pieces.slice(1), rules].join('\\n\\n')"]],
  'w74-prompt-replaces-rules': [[R, JOIN, "  return own === '' ? pieces.join('\\n\\n') : own"]],
  'w74-save-without-instructions': [[UH, '        messages: toMessagesToSave(messages),\n        instructions,\n', '        messages: toMessagesToSave(messages),\n']],
  'w74-ipc-save-drops-instructions': [[IPC, 'const saved = await history.save(conversation)', 'const saved = await history.save({ id: conversation.id, messages: conversation.messages })']],
  'w74-change-not-saved': [[UH, 'a.messages === b.messages && a.instructions === b.instructions', 'a.messages === b.messages']],
  'w74-open-ignores-instructions': [[UH, 'chat.load(messages, instructions, project)', "chat.load(messages, '', project)"]],
  'w74-new-chat-keeps-instructions': [[UC, 'setInstructionsState(nextInstructions)', 'void nextInstructions']],
  'w74-button-enabled-while-replying': [[CB, 'className="chat-button chat-instructions"\n        disabled={isReplying}', 'className="chat-button chat-instructions"\n        disabled={false}']],
  'w74-no-on-mark': [[CB, "(instructions !== '' || (everyChat?.text ?? '') !== '') && (\n            <>", 'false && (\n            <>']], // since 10.2 either part puts the mark on
  'w74-save-enabled-when-too-long': [[DLG, 'const canSave = checked.ok && changed && !busy', 'const canSave = changed && !busy']],
  'w74-count-untrimmed': [[DLG, 'const text = checked.ok ? checked.instructions : draft.trim()', 'const text = draft']],
  'w74-draft-survives-close': [[DLG, '{open && (', '{(']],
  'w74-typing-applies-at-once': [[DLG, '            setDraft(event.target.value)\n            setWarnings(null)', "            setDraft(event.target.value)\n            if (editing === 'chat') onSave(event.target.value.trim())\n            setWarnings(null)"]],
  'w74-box-truncates-at-the-limit': [[DLG, 'rows={7}', 'rows={7}\n          maxLength={8000}']],
  'w74-no-password-warning': [[DLG, 'like the messages. Do not put passwords\n            or keys here. A new chat', 'like the messages. A new chat']]
}
const wdir = join(TOOLS, 'specs74w')
mkdirSync(wdir, { recursive: true })
for (const [name, edits] of Object.entries(win)) {
  writeFileSync(join(wdir, `${name}.json`), JSON.stringify({ label: name, edits: edits.map(([file, from, to]) => ({ file, from, to })), argv: ['{{TOOLS}}/run74.mjs'], env: {} }, null, 2) + '\n')
}
console.log(`wrote ${Object.keys(win).length} specs in specs74w`)
