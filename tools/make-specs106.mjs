// Writes the negative-control specs for slice 10.6 (a project's parts in every request, D-039): one sabotage each, which the suites must notice.
// usage: node tools/make-specs106.mjs
//   then: node tools/check-specs.mjs                  (dry check)
//         node tools/nc-all.mjs specs106 <names...>   (verify-10-6.mjs, plain Node)
//         node tools/nc-all.mjs specs106w <names...>  (run106.mjs: the real window)
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { TOOLS } from './paths.mjs'

const R = '{{REPO}}/'
const REQ = R + 'src/main/providers/request.ts', V = R + 'src/shared/validate.ts', LIM = R + 'src/shared/limits.ts', CHAT = R + 'src/main/chat.ts'
const TXT = R + 'src/renderer/src/chat/attachmentText.ts', IR = R + 'src/renderer/src/chat/ipcReply.ts', UC = R + 'src/renderer/src/chat/useChat.ts'
const LRD = R + 'src/renderer/src/chat/LargeRequestDialog.tsx'

const s = {
  promptDropsProject: [REQ, "  if (project !== '') pieces.push(PROJECT_LEAD, project)\n", ''],
  projectNotOthers: [REQ, "  const others = every !== '' || project !== ''", "  const others = every !== ''"],
  buildDropsProject: [REQ, '      everyChat: input.everyChat,\n      project: input.project', '      everyChat: input.everyChat'],
  checkLoose: [V, '  if (projectId !== undefined && !isProjectId(projectId)) {', '  if (projectId === 42) {'],
  checkDrops: [V, '      ...(projectId === undefined ? {} : { projectId })', '      ...{}'],
  noteSilent: [LIM, '  return project === 0\n    ? base', '  return project >= 0\n    ? base'],
  blockIgnoresProject: [TXT, '    ...projectFiles,\n', ''],
  chatIgnoresProject: [CHAT, '      project = found.project', '      void found.project'],
  chatNoFiles: [CHAT, '                    ...projectFiles,\n', ''],
  chatNoProjectNotes: [CHAT, '    const memory = await context.notes(project?.id ?? null)', '    const memory = await context.notes(null)'],
  chatNoKeyCheck: [CHAT, "      ['for this project', project?.instructions ?? ''],\n", ''],
  chatNoInstructions: [CHAT, "      project: project?.instructions, // after every chat's, before the chat's own (10.6)\n", ''],
  chatNoProjectCount: [CHAT, '            ...(projectFiles.length > 0 ? { project: projectFiles.length } : {})', '            ...{}'],
  pageDropsProject: [IR, '      ...(projectId === null ? {} : { projectId })', '      ...{}'],
  chatHookDropsProject: [UC, '        (request) => askAboutLargeRequest(request, controller.signal),\n        project', '        (request) => askAboutLargeRequest(request, controller.signal),\n        null'],
  dialogSilent: [LRD, '              {(request.estimate.files.project ?? 0) > 0 &&', '              {(request.estimate.files.project ?? 0) < 0 &&']
}

const node = {
  'n106-prompt-drops-project': [s.promptDropsProject],
  'n106-project-not-others': [s.projectNotOthers],
  'n106-build-drops-project': [s.buildDropsProject],
  'n106-check-loose': [s.checkLoose],
  'n106-check-drops': [s.checkDrops],
  'n106-note-silent': [s.noteSilent],
  'n106-block-ignores-project': [s.blockIgnoresProject],
  'n106-chat-no-files': [s.chatNoFiles],
  'n106-chat-no-project-notes': [s.chatNoProjectNotes],
  'n106-chat-no-key-check': [s.chatNoKeyCheck],
  'n106-chat-no-project-count': [s.chatNoProjectCount],
  'n106-page-drops-project': [s.pageDropsProject]
}

const win = {
  'w106-chat-ignores-project': [s.chatIgnoresProject],
  'w106-chat-no-files': [s.chatNoFiles],
  'w106-chat-no-project-notes': [s.chatNoProjectNotes],
  'w106-chat-no-key-check': [s.chatNoKeyCheck],
  'w106-chat-no-instructions': [s.chatNoInstructions],
  'w106-page-drops-project': [s.pageDropsProject],
  'w106-chat-hook-drops-project': [s.chatHookDropsProject],
  'w106-dialog-silent': [s.dialogSilent],
  'w106-project-not-others': [s.projectNotOthers]
}

const write = (dir, specs, argv, env, timeoutMs) => {
  mkdirSync(join(TOOLS, dir), { recursive: true })
  for (const [name, edits] of Object.entries(specs)) {
    writeFileSync(join(TOOLS, dir, `${name}.json`), JSON.stringify({ label: name, edits: edits.map(([file, from, to]) => ({ file, from, to })), argv, env, ...(timeoutMs ? { timeoutMs } : {}) }, null, 2) + '\n')
  }
}
write('specs106', node, ['{{TOOLS}}/verify-10-6.mjs'], {})
write('specs106w', win, ['{{TOOLS}}/run106.mjs', 'dev'], { NO_RETRY: '1' }, 600000)
console.log(`wrote ${Object.keys(node).length} specs in specs106 and ${Object.keys(win).length} in specs106w`)
