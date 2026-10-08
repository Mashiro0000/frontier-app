// Writes the negative-control specs for slice 11.7 (backups and encryption, D-041): one sabotage each, which the suite must notice.
// usage: node tools/make-specs117.mjs   then: node tools/check-specs.mjs, node tools/nc-all.mjs specs117 <names...>
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { TOOLS } from './paths.mjs'

const R = '{{REPO}}/src/'
const BACKUP = R + 'main/backup.ts', SERVICE = R + 'main/backupService.ts', IPC = R + 'main/ipc.ts', STORAGE = R + 'renderer/src/settings/useChatStorage.ts'
const s = {
  backupVersionFixed: [BACKUP, 'JSON.stringify({ version: fileVersion(chat), ...chat })', 'JSON.stringify({ version: 3, ...chat })'],
  backupImportsSettings: [SERVICE, "import { randomUUID } from 'crypto'\n", "import { randomUUID } from 'crypto'\nimport './toolSettings'\n"],
  notSealedAudit: [IPC, '      auditLog.document,\n      toolSettings.file', '      toolSettings.file'],
  notSealedSettings: [IPC, '      auditLog.document,\n      toolSettings.file', '      auditLog.document'],
  reportOmitsSettings: [STORAGE, 'your projects, your tool settings and the audit log of tool calls are encrypted too.', 'your projects and the audit log of tool calls are encrypted too.'],
  waitsNotForSettings: [IPC, '      toolSettings.file.whenIdle()', '      Promise.resolve()']
}
const names = Object.keys(s)
const kebab = (n) => n.replace(/[A-Z]/g, (c) => '-' + c.toLowerCase())
mkdirSync(join(TOOLS, 'specs117'), { recursive: true })
for (const name of names) {
  const [file, from, to] = s[name]
  const label = `n117-${kebab(name)}`
  writeFileSync(join(TOOLS, 'specs117', `${label}.json`), JSON.stringify({ label, edits: [{ file, from, to }], argv: ['{{TOOLS}}/verify-11-7.mjs'], env: {} }, null, 2) + '\n')
}
console.log(`wrote ${names.length} specs in specs117`)
