// Writes the negative-control specs for slice 16.5 (a made picture in the chat, D-048): one sabotage each, which verify-16-5.mjs (specs165) or verify-16-5w.mjs in the
// real window (specs165w) must notice.
// usage: node tools/make-specs165.mjs
//   then: FRONTIER_MAY_REMOVE=1 FRONTIER_KEEP_TEMP=1 TEMP=C:\frontier-tmp TMP=C:\frontier-tmp node tools/nc-all.mjs specs165 <names...>
//   and:  node tools/guarded-window-copy.mjs tools/nc-all.mjs specs165w <names...>      (never while Node controls run)
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { TOOLS } from './paths.mjs'

const IM = '{{REPO}}/src/shared/images.ts'
const VA = '{{REPO}}/src/shared/validate.ts'
const CS = '{{REPO}}/src/main/conversationStore.ts'
const CV = '{{REPO}}/src/renderer/src/history/convert.ts'
const RW = '{{REPO}}/src/renderer/src/chat/rewrite.ts'
const HI = '{{REPO}}/src/renderer/src/chat/history.ts'
const MA = '{{REPO}}/src/renderer/src/chat/MessageActions.tsx'
const PM = '{{REPO}}/src/renderer/src/images/PictureMessage.tsx'

// name: [ONLY, file, from, to]
const controls = {
  nKeys: ['A', IM, "  if (!isPlain(raw) || !keysAre(raw, 'costUsd,estimate,ids,model,quality,shape')) return null", '  if (!isPlain(raw)) return null'],
  nIdsMax: ['A', IM, 'ids.length > IMAGE_LIMITS.maxCount) return null', 'ids.length > 10) return null'],
  nIdsTwice: ['A', IM, ' || new Set(ids).size !== ids.length) return null', ') return null'],
  vRole: ['A', VA, "        note === null ||\n        role !== 'user' ||\n", '        note === null ||\n'],
  vStatus: ['A', VA, "        status !== 'done' ||\n        files !== null ||", '        files !== null ||'],
  vFiles: ['A', VA, '        files !== null ||\n        !isPrompt(content)', '        !isPrompt(content)'],
  vPrompt: ['A', VA, '        files !== null ||\n        !isPrompt(content)\n', '        files !== null\n'],
  cVersion: ['B', CS, '  conversation.messages.some((message) => message.picture !== undefined)\n    ? 7', '  conversation.messages.some((message) => message.picture !== undefined)\n    ? 6'],
  cHoldsNone: ['B', CS, "  if (file.version === 7 && !messages.messages.some((message) => message.picture !== undefined)) {", '  if (false) {'],
  cOldReadsNote: ['B', CS, '    file.version === 7 // a request for pictures (D-048, 16.5) only from a version 7 file', '    true // a request for pictures (D-048, 16.5) only from a version 7 file'],
  hWire: ['D', HI, '    .filter((message) => message.picture === undefined)\n', ''],
  rEdit: ['D', RW, '    messages[at].picture !== undefined ||\n', ''],
  rLater: ['D', RW, " || messages[at].picture !== undefined) return null\n  return messages.length - 1 - at", ') return null\n  return messages.length - 1 - at'],
  cvSave: ['D', CV, "      ...(role === 'user' && picture !== undefined ? { picture } : {})", '      ...{}'],
  cvLoad: ['D', CV, '      ...(picture !== undefined ? { picture } : {})', '      ...{}'],
  maEdit: ['E', MA, "  const canEdit = message.role === 'user' && message.picture === undefined", "  const canEdit = message.role === 'user'"],
  pmAttach: ['E', PM, 'disabled={!canAttach}', 'disabled={false}']
}
const windowControls = {
  wWire: [HI, '    .filter((message) => message.picture === undefined)\n', '', 'C'],
  wNotShown: ['{{REPO}}/src/renderer/src/chat/MessageBubble.tsx', '      {message.picture !== undefined ? (', '      {false ? (', 'B'],
  wNotSaved: [CV, "      ...(role === 'user' && picture !== undefined ? { picture } : {})", '      ...{}', 'C'],
  wEdit: [MA, "  const canEdit = message.role === 'user' && message.picture === undefined", "  const canEdit = message.role === 'user'", 'B']
}

const write = (dir, name, spec) => { mkdirSync(join(TOOLS, dir), { recursive: true }); writeFileSync(join(TOOLS, dir, `${name}.json`), JSON.stringify(spec, null, 2) + '\n') }
const sane = (name, from, to) => { if (typeof from !== 'string' || typeof to !== 'string' || /\$[$&`'0-9<]/.test(to)) throw new Error(`the control ${name} is not well formed`) }
for (const [name, [only, file, from, to]] of Object.entries(controls)) {
  sane(name, from, to)
  write('specs165', `n165-${name}`, { label: `n165-${name}`, edits: [{ file, from, to }], argv: ['{{TOOLS}}/guarded.mjs', '{{TOOLS}}/verify-16-5.mjs'], env: { ONLY: only }, timeoutMs: 300000 })
}
for (const [name, [file, from, to, stopAfter]] of Object.entries(windowControls)) {
  sane(name, from, to)
  write('specs165w', `w165-${name}`, { label: `w165-${name}`, edits: [{ file, from, to }], argv: ['{{TOOLS}}/run165.mjs', 'dev'], env: { NO_RETRY: '1', STOP_AFTER: stopAfter }, timeoutMs: 1200000 })
}
console.log(`wrote ${Object.keys(controls).length} specs in specs165 and ${Object.keys(windowControls).length} in specs165w`)
