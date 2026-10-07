// Writes the negative-control specs for slice 10.5 (projects, D-039): one sabotage each, which the suites must notice.
// usage: node tools/make-specs105.mjs
//   then: node tools/check-specs.mjs                  (dry check)
//         node tools/nc-all.mjs specs105 <names...>   (verify-10-5.mjs, plain Node)
//         node tools/nc-all.mjs specs105w <names...>  (run105.mjs: the real window)
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { TOOLS } from './paths.mjs'

const R = '{{REPO}}/'
const P = R + 'src/main/projects.ts', CONV = R + 'src/main/conversationStore.ts', IPC = R + 'src/main/ipc.ts', MEM = R + 'src/main/memory.ts'
const DLG = R + 'src/renderer/src/projects/ProjectsDialog.tsx', HIST = R + 'src/renderer/src/history/HistoryDialog.tsx', UH = R + 'src/renderer/src/history/useHistory.ts'

const s = {
  instructionsNoQuestion: [P, '          const no = await ask(owner, projectInstructionsQuestion(project, text, secrets.warned))', '          const no = null as ProjectChangeResult | null\n          void projectInstructionsQuestion'],
  instructionsNoSecrets: [P, '          if (!secrets.ok) return secrets\n          const no = await ask(owner, projectInstructionsQuestion', '          const no = await ask(owner, projectInstructionsQuestion'],
  filesNoQuestion: [P, '        const no = await ask(owner, filesQuestion(project, fresh))', '        const no = null as ProjectChangeResult | null\n        void filesQuestion'],
  filesNoKept: [P, '          for (const info of fresh) await options.files.discard(info.id)\n', ''],
  filesDuplicates: [P, '            refused.push(`${info.name} is already in the project.`)', '            fresh.push(info)\n            continue'],
  nameTwice: [P, '      if (now0.projects.some((project) => sameName(project.name, checked.name))) {', '      if (now0.projects.some((project) => project.name === "")) {'],
  parseNameTwice: [P, '    if (projects.some((other) => other.id === project.id || sameName(other.name, project.name)))', '    if (projects.some((other) => other.id === project.id))'],
  removeKeepsNotes: [P, '      await options\n        .removeNotes(id)', '      await Promise.resolve(id)'],
  removeKeepsFiles: [P, '      await options.files.deleteUnused(project.files.map((file) => file.id))', '      void project.files'],
  removeFileKeepsCopy: [P, '      if (result.ok) await options.files.deleteUnused([fileId])', '      void result'],
  refsWhenDamaged: [P, "    if (current.state === 'unreadable') return null", "    if (current.state === 'unreadable') return new Set()"],
  v5Loose: [CONV, "  if (file.version === 5 && !isProjectId(file.project)) return 'its project is not usable'", '  void isProjectId'],
  alwaysV5: [CONV, '    ? 5\n', "    ? 3\n"],
  scopeTakesAll: [MEM, '    const kept = current.value.notes.filter((note) => note.scope !== projectId)', '    const kept = current.value.notes.filter(() => false)'],
  ipcSweepIgnoresProjects: [IPC, '    return chats.complete && inProjects !== null ? new Set([...chats.ids, ...inProjects]) : null', '    return chats.complete ? new Set([...chats.ids]) : null'],
  ipcSaveUnknownProject: [IPC, '          project !== undefined && (await projects.nameOf(project)) !== null', '          project !== undefined'],
  dlgChatProjectIgnored: [DLG, "              onChatProject(event.target.value === '' ? null : event.target.value)", '              void event'],
  dlgNewChatNoProject: [DLG, '                onClick={() => onNewChatIn(project.id)}', '                onClick={() => onNewChatIn("")}'],
  dlgDeleteNoConfirm: [DLG, "                onClick={() => setAsking('delete')}", '                onClick={() => void change(() => window.api.projects.remove(project.id), false)}'],
  histNoProjectName: [HIST, '                      {projectName(conversation.project) !== null', '                      {projectName(conversation.project) === "never"'],
  saveDropsProject: [UH, '        ...(project !== null ? { project } : {})\n', ''],
  newChatDropsProject: [UH, "    chat.load([], '', project)", "    chat.load([], '', null)"]
}

const node = {
  'n105-instructions-no-question': [s.instructionsNoQuestion],
  'n105-instructions-no-secrets': [s.instructionsNoSecrets],
  'n105-files-no-question': [s.filesNoQuestion],
  'n105-files-no-kept': [s.filesNoKept],
  'n105-files-duplicates': [s.filesDuplicates],
  'n105-name-twice': [s.nameTwice],
  'n105-parse-name-twice': [s.parseNameTwice],
  'n105-remove-keeps-notes': [s.removeKeepsNotes],
  'n105-remove-keeps-files': [s.removeKeepsFiles],
  'n105-remove-file-keeps-copy': [s.removeFileKeepsCopy],
  'n105-refs-when-damaged': [s.refsWhenDamaged],
  'n105-v5-loose': [s.v5Loose],
  'n105-always-v3': [s.alwaysV5],
  'n105-scope-takes-all': [s.scopeTakesAll],
  'n105-ipc-sweep-ignores-projects': [s.ipcSweepIgnoresProjects]
}

const win = {
  'w105-instructions-no-question': [s.instructionsNoQuestion],
  'w105-files-no-question': [s.filesNoQuestion],
  'w105-files-no-kept': [s.filesNoKept],
  'w105-remove-keeps-notes': [s.removeKeepsNotes],
  'w105-ipc-save-unknown-project': [s.ipcSaveUnknownProject],
  'w105-dlg-chat-project-ignored': [s.dlgChatProjectIgnored],
  'w105-dlg-new-chat-no-project': [s.dlgNewChatNoProject],
  'w105-dlg-delete-no-confirm': [s.dlgDeleteNoConfirm],
  'w105-hist-no-project-name': [s.histNoProjectName],
  'w105-save-drops-project': [s.saveDropsProject],
  'w105-new-chat-drops-project': [s.newChatDropsProject]
}

const write = (dir, specs, argv, env, timeoutMs) => {
  mkdirSync(join(TOOLS, dir), { recursive: true })
  for (const [name, edits] of Object.entries(specs)) {
    writeFileSync(join(TOOLS, dir, `${name}.json`), JSON.stringify({ label: name, edits: edits.map(([file, from, to]) => ({ file, from, to })), argv, env, ...(timeoutMs ? { timeoutMs } : {}) }, null, 2) + '\n')
  }
}
write('specs105', node, ['{{TOOLS}}/verify-10-5.mjs'], {})
write('specs105w', win, ['{{TOOLS}}/run105.mjs', 'dev'], { NO_RETRY: '1' }, 600000)
console.log(`wrote ${Object.keys(node).length} specs in specs105 and ${Object.keys(win).length} in specs105w`)
