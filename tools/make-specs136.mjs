// Writes the negative-control specs for slice 13.6 (cost, encryption and backups of running programs, D-043): one sabotage each, which tools/verify-13-6.mjs must notice. Slice 13.6
// changes no product code (what a run costs, what is sealed and what a backup carries are the existing rules of 12.7 and 10.7 applied to the new events and notes), so the controls take
// out the existing rules that the new checks lean on.
// usage: node tools/make-specs136.mjs
//   then: node tools/check-specs.mjs
//         node tools/nc-all.mjs specs136 <names...>        (plain Node; each sets ONLY=... no: the suite is small and runs whole; it makes only its own folders in the temp folder)
//   The suite removes nothing, so these run as they are, but through the wrapper: NC_GUARDED=1 node tools/nc-all.mjs specs136 <names...>
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { TOOLS } from './paths.mjs'

const USAGE = '{{REPO}}/src/shared/usage.ts'
const NOT = '{{REPO}}/src/shared/toolNotes.ts'
const LOG = '{{REPO}}/src/main/auditLog.ts'
const IPC = '{{REPO}}/src/main/ipc.ts'
const CHAT = '{{REPO}}/src/main/chat.ts'

// name: [file, from, to]
const controls = {
  // the estimate counts the call (the record of the turn) and, as the next message, the result
  cRecord: [USAGE, "      bytes += utf8Length(JSON.stringify(message.toolTurn.record) ?? '')\n", '      bytes += 0\n'],
  cResultMessage: [CHAT, "          content: turn.results.map((result) => result.text).join('\\n\\n'),\n", "          content: '',\n"],
  // the strict reader of a run note (a saved chat and a backup)
  nTitle: [NOT, '    if (title !== toolTitle(tool)) return null\n', ''],
  nEnd: [NOT, '      if (!(PROGRAM_ENDS as readonly unknown[]).includes(p.end)) return null\n', ''],
  nExit: [NOT, '      if (p.exitCode !== null && !isCount(p.exitCode, 0, 4_294_967_295)) return null\n', ''],
  nMs: [NOT, '      if (!isCount(p.ms, 0, 1_000_000_000)) return null\n', ''],
  nCounts: [NOT, '        if (!isCount(field, 0, 1_000_000)) return null\n', ''],
  nKeys: [NOT, "        !hasKeys(p, ['end', 'exitCode', 'ms', 'copied', 'changed', 'created', 'deleted'])\n", '        false\n'],
  // the audit log's strict reader of the program event
  aEnd: [LOG, "      if (typeof end !== 'string' || !(PROGRAM_ENDS as readonly string[]).includes(end)) return null\n", ''],
  aMs: [LOG, '      if (!isCount(ms, 1_000_000_000)) return null\n', ''],
  // what is sealed with the chats
  wToolsKept: [IPC, '      toolSettings.file,\n', ''],
  wLogKept: [IPC, '      auditLog.document,\n', '']
}

mkdirSync(join(TOOLS, 'specs136'), { recursive: true })
for (const [name, [file, from, to]] of Object.entries(controls)) {
  if (typeof file !== 'string' || typeof from !== 'string' || typeof to !== 'string') throw new Error(`the control ${name} is not well formed`)
  const spec = { label: `n136-${name}`, edits: [{ file, from, to }], argv: ['{{TOOLS}}/verify-13-6.mjs'], env: {}, timeoutMs: 300000 }
  writeFileSync(join(TOOLS, 'specs136', `n136-${name}.json`), JSON.stringify(spec, null, 2) + '\n')
}
console.log(`wrote ${Object.keys(controls).length} specs in specs136`)
