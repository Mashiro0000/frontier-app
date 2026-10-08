// Writes the negative-control specs for slice 10.7 (backups with the projects and the notes, D-039): one sabotage each, which the suites must notice.
// usage: node tools/make-specs107.mjs
//   then: node tools/check-specs.mjs                  (dry check)
//         node tools/nc-all.mjs specs107 <names...>   (verify-10-7.mjs, plain Node)
//         node tools/nc-all.mjs specs107w <names...>  (run107.mjs: the real window)
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { TOOLS } from './paths.mjs'

const R = '{{REPO}}/'
const B = R + 'src/main/backup.ts', K = R + 'src/main/restoreKept.ts', S = R + 'src/main/backupService.ts'
const PJ = R + 'src/main/projects.ts', M = R + 'src/main/memory.ts', IPC = R + 'src/main/ipc.ts'
const UB = R + 'src/renderer/src/history/useBackup.ts', RP = R + 'src/renderer/src/history/RestorePreviewPanel.tsx'

const s = {
  // the file
  headerAlways1: [B, '      version: withKept ? BACKUP_VERSION_KEPT : BACKUP_VERSION,', '      version: BACKUP_VERSION,'],
  noProjectLines: [B, '        await put(`{"project":${text},"sha256":"${sha256(text)}"}\\n`)\n', ''],
  projectFilesUnnamed: [B, '        for (const file of project.files) named.add(file.id)\n', ''],
  trailerNoCounts: [B, '          ...(withKept\n            ? { projects: keptWritten.projects.length, notes: keptWritten.notes.length }\n            : {})\n        })}', '        })}'],
  readerNoChecksum: [B, '    claimed !== sha256(JSON.stringify(value))', '    false'],
  readerNoParse: [B, "  const checked = kind === 'project' ? parseProject(value) : parseNote(value)", '  const checked = value as Project | Note'],
  readerAfterChats: [B, '          result.seen > 0 || (result.files?.seen ?? 0) > 0', '          false'],
  readerV3Refused: [B, '          header.version !== BACKUP_VERSION_FILES &&\n          header.version !== BACKUP_VERSION_KEPT', '          header.version !== BACKUP_VERSION_FILES'],
  completeIgnoresKept: [B, '      (result.kept === undefined ||\n        (result.trailer.projects === result.kept.projects.seen &&\n          result.trailer.notes === result.kept.notes.seen)) &&\n', ''],
  // the plan
  planNoSame: [K, '    if (sameId !== undefined && sameProject(sameId, project)) {', '    if (sameId === null && sameProject(project, project)) {'],
  planReplaces: [K, '      sameId === undefined\n        ? project.id\n        : freshId', '      sameId !== null\n        ? project.id\n        : freshId'],
  planNoFreeName: [K, '    const name = freeName(\n      project.name,\n      all().map((other) => other.name)\n    )', '    const name = project.name'],
  planNoKeyCheck: [K, '    if (heldKey(project.instructions, keys) !== null) {', '    if (keys === null) {'],
  noteNoRemap: [K, '          ? (map.get(note.scope) ?? null)', '          ? note.scope'],
  noteNoDedupe: [K, '    if (allNotes().some((other) => other.scope === scope && other.text === note.text)) {', '    if (allNotes().some((other) => other.scope === scope && other.text === note.text + 1)) {'],
  noteNoCharCap: [K, '      use.chars + note.text.length > MEMORY_LIMITS.maxScopeChars', '      use.chars < 0'],
  noKeepsAdded: [K, 'map.set(from, to === null || added.has(to) ? null : to)', 'map.set(from, to)'],
  // the service
  exportNoKept: [S, "          ...(options.files !== undefined ? { readFile: options.files.read } : {}),\n          ...(kept !== undefined ? { kept } : {})", "          ...(options.files !== undefined ? { readFile: options.files.read } : {})"],
  exportNeedsChats: [S, '      if (ids.length === 0 && !anyKept)', '      if (ids.length === 0)'],
  lookNoKept: [S, '          ...(read.files !== undefined ? { files } : {}),\n          ...(kept !== undefined ? { kept } : {}),\n          refusedCount', '          ...(read.files !== undefined ? { files } : {}),\n          refusedCount'],
  neverAsks: [S, '            chosen.projects.add.length + chosen.notes.add.length > 0 &&\n            options.kept !== undefined', '            chosen.projects.add.length < 0 &&\n            options.kept !== undefined'],
  noIgnored: [S, "            if (answer !== 'yes') {", "            if (answer === 'busy') {"],
  chatsDoNotFollow: [S, '          const chat = follow(read)', '          const chat = read'],
  projectFilesNotPutBack: [S, '            for (const file of project.files) here.add(file.id)\n', ''],
  projectsNoClash: [PJ, '      if (clash || all.length > PROJECT_LIMITS.maxProjects) {', '      if (all.length > PROJECT_LIMITS.maxProjects + 1000) {'],
  notesNoClash: [M, '      if (ids.size !== notes.length || full) {', '      if (ids.size < 0) {'],
  notesTurnOn: [M, '      return write({ on: now0.memory.on, notes })', '      return write({ on: true, notes })'],
  ipcNoWindow: [IPC, '      backups.restoreApply(token, window)', '      backups.restoreApply(token, null)'],
  // the window
  exportSilent: [UB, '      ? ` It holds your ${keptWords(result.kept.projects, result.kept.notes)} too.`', "      ? ''"],
  declinedSilent: [UB, "    if (k.declined) parts.push('No project or note was added: you did not say yes in the question.')", '    if (k.declined) void k'],
  factHidden: [RP, '        {kept !== undefined && keptAdd > 0 && (\n          <li>', '        {kept !== undefined && keptAdd < 0 && (\n          <li>'],
  askNoteHidden: [RP, '      {kept !== undefined && keptAdd > 0 && (\n        <p className="history-notice" role="status">', '      {kept !== undefined && keptAdd < 0 && (\n        <p className="history-notice" role="status">'],
  problemHidden: [RP, '      {kept !== undefined && kept.problem !== null && (', '      {kept !== undefined && kept.problem === "" && (']
}

const node = {
  'n107-header-always-1': [s.headerAlways1],
  'n107-no-project-lines': [s.noProjectLines],
  'n107-project-files-unnamed': [s.projectFilesUnnamed],
  'n107-trailer-no-counts': [s.trailerNoCounts],
  'n107-reader-no-checksum': [s.readerNoChecksum],
  'n107-reader-no-parse': [s.readerNoParse],
  'n107-reader-after-chats': [s.readerAfterChats],
  'n107-reader-v3-refused': [s.readerV3Refused],
  'n107-complete-ignores-kept': [s.completeIgnoresKept],
  'n107-plan-no-same': [s.planNoSame],
  'n107-plan-replaces': [s.planReplaces],
  'n107-plan-no-free-name': [s.planNoFreeName],
  'n107-plan-no-key-check': [s.planNoKeyCheck],
  'n107-note-no-remap': [s.noteNoRemap],
  'n107-note-no-dedupe': [s.noteNoDedupe],
  'n107-note-no-char-cap': [s.noteNoCharCap],
  'n107-no-keeps-added': [s.noKeepsAdded],
  'n107-export-no-kept': [s.exportNoKept],
  'n107-export-needs-chats': [s.exportNeedsChats],
  'n107-look-no-kept': [s.lookNoKept],
  'n107-never-asks': [s.neverAsks],
  'n107-no-ignored': [s.noIgnored],
  'n107-chats-do-not-follow': [s.chatsDoNotFollow],
  'n107-project-files-not-put-back': [s.projectFilesNotPutBack],
  'n107-projects-no-clash': [s.projectsNoClash],
  'n107-notes-no-clash': [s.notesNoClash],
  'n107-notes-turn-on': [s.notesTurnOn],
  'n107-ipc-no-window': [s.ipcNoWindow]
}

const win = {
  'w107-export-silent': [s.exportSilent],
  'w107-declined-silent': [s.declinedSilent],
  'w107-fact-hidden': [s.factHidden],
  'w107-ask-note-hidden': [s.askNoteHidden],
  'w107-problem-hidden': [s.problemHidden],
  'w107-ipc-no-window': [s.ipcNoWindow],
  'w107-never-asks': [s.neverAsks],
  'w107-no-ignored': [s.noIgnored],
  'w107-chats-do-not-follow': [s.chatsDoNotFollow],
  'w107-header-always-1': [s.headerAlways1]
}

const write = (dir, specs, argv, env, timeoutMs) => {
  mkdirSync(join(TOOLS, dir), { recursive: true })
  for (const [name, edits] of Object.entries(specs)) {
    writeFileSync(join(TOOLS, dir, `${name}.json`), JSON.stringify({ label: name, edits: edits.map(([file, from, to]) => ({ file, from, to })), argv, env, ...(timeoutMs ? { timeoutMs } : {}) }, null, 2) + '\n')
  }
}
write('specs107', node, ['{{TOOLS}}/verify-10-7.mjs'], {})
write('specs107w', win, ['{{TOOLS}}/run107.mjs', 'dev'], { NO_RETRY: '1' }, 600000)
console.log(`wrote ${Object.keys(node).length} specs in specs107 and ${Object.keys(win).length} in specs107w`)
