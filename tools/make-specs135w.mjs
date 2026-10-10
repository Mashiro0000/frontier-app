// Writes the window negative-control specs for slice 13.5 (the Tools page row, the switch, the wiring; D-043): one sabotage each, which tools/verify-13-5w.mjs must notice in the real
// window (a real app, a real box). Each runs only the parts of the window suite that can notice it (STOP_AFTER, SKIP), so that three real self-tests are not made for each.
// usage: node tools/make-specs135w.mjs
//   then: node tools/guarded-window-copy.mjs tools/nc-all.mjs specs135w <names...>
//         (guarded-window-copy.mjs gives the run its own folder with a copy of the tree in it, the confined removals and the TEMP the launcher needs: nc-all, nc and run135.mjs all run inside it, and the sabotages are made in the copy)
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { TOOLS } from './paths.mjs'

const P = '{{REPO}}/src/renderer/src/'
const SECTION = P + 'tools/RunProgramsSection.tsx'
const DIALOG = P + 'tools/ToolsDialog.tsx'
const APP = P + 'App.tsx'
const IPC = '{{REPO}}/src/main/ipc.ts'
const PRELOAD = '{{REPO}}/src/preload/index.ts'

// name: [file, from, to, { STOP_AFTER, SKIP }]
const controls = {
  wToggleNoFolder: [SECTION, 'disabled={busy || testGoingOn || (!status.on && !ready)}', 'disabled={busy || testGoingOn}', { STOP_AFTER: 'A' }],
  wOrder: [DIALOG, '      <RunProgramsSection settings={settings} busy={busy} working={working} />\n      <ChangesSection settings={settings} busy={busy} working={working} />', '      <ChangesSection settings={settings} busy={busy} working={working} />\n      <RunProgramsSection settings={settings} busy={busy} working={working} />', { STOP_AFTER: 'A' }],
  wPreloadStop: [PRELOAD, '    stopTest: () => ipcRenderer.invoke(CHANNELS.programsStopTest)\n', '', { STOP_AFTER: 'A' }],
  wStopButton: [SECTION, '          {testGoingOn && (\n            <div className="programs-stop">', '          {false && (\n            <div className="programs-stop">', { STOP_AFTER: 'C1' }],
  wReport: [SECTION, '          {report !== null && <Report report={report} />}', '          {false && <Report report={report} />}', { STOP_AFTER: 'C2', SKIP: 'C1' }],
  wForWindow: [IPC, '    guardedForWindow(async (window, input: unknown): Promise<ProgramsChangeResult> => {\n      try {\n        return await programService.setOn(window, input)', '    guarded(async (input: unknown): Promise<ProgramsChangeResult> => {\n      try {\n        return await programService.setOn(null, input)', { STOP_AFTER: 'C2', SKIP: 'C1' }],
  wNoRegistry: [IPC, '    ...WORKSPACE_PROPOSE_TOOLS,\n    RUN_PROGRAM\n  ])', '    ...WORKSPACE_PROPOSE_TOOLS\n  ])', { STOP_AFTER: 'D', SKIP: 'C1,C2' }],
  wAnyToolOn: [APP, 'toolsOn={anyToolOn(toolSettings.status, toolSettings.workspace, toolSettings.programs)}', 'toolsOn={anyToolOn(toolSettings.status, toolSettings.workspace)}', { STOP_AFTER: 'D', SKIP: 'C1,C2' }]
}

mkdirSync(join(TOOLS, 'specs135w'), { recursive: true })
for (const [name, [file, from, to, env]] of Object.entries(controls)) {
  if (typeof file !== 'string' || typeof from !== 'string' || typeof to !== 'string') throw new Error(`the control ${name} is not well formed`)
  const spec = { label: `w135-${name}`, edits: [{ file, from, to }], argv: ['{{TOOLS}}/run135.mjs', 'dev'], env, timeoutMs: 1500000 }
  writeFileSync(join(TOOLS, 'specs135w', `w135-${name}.json`), JSON.stringify(spec, null, 2) + '\n')
}
console.log(`wrote ${Object.keys(controls).length} specs in specs135w`)
