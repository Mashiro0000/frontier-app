// Writes the negative-control specs for slice 15.4 (voice: the gate for the microphone, D-047): one sabotage each, which verify-15-4.mjs must notice.
// usage: node tools/make-specs154.mjs
//   then: FRONTIER_MAY_REMOVE=1 FRONTIER_KEEP_TEMP=1 TEMP=C:\frontier-tmp TMP=C:\frontier-tmp node tools/nc-all.mjs specs154 <names...>
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { TOOLS } from './paths.mjs'

const PERM = '{{REPO}}/src/main/voicePermissions.ts'
const WIN = '{{REPO}}/src/main/voiceWindow.ts'
const INDEX = '{{REPO}}/src/main/index.ts'

// name: [suite, ONLY (or null), file, from, to]
const controls = {
  pWindow: ['15-4', 'A', PERM, '  if (!ask.fromMainWindow || !ask.isMainFrame) return false', '  if (false) return false'],
  pUrl: ['15-4', 'A', PERM, "  if (typeof ask.requestingUrl !== 'string' || !ctx.isApp(ask.requestingUrl)) return false", ''],
  pGateClosed: ['15-4', 'A', PERM, '      if (!ctx.mayRecord) return false', ''],
  pCheck: ['15-4', 'A', PERM, "      if (ask.kind === 'check') return ask.mediaType === 'audio'", "      if (ask.kind === 'check') return true"],
  pVideo: ['15-4', 'A', PERM, '        ask.mediaTypes.length === 1 &&\n', ''],
  pAudioName: ['15-4', 'A', PERM, "        ask.mediaTypes[0] === 'audio'", '        ask.mediaTypes.includes(ask.mediaTypes[0])'],
  pDefault: ['15-4', 'A', PERM, '    default:\n      return false', '    default:\n      return true'],
  pCopy: ['15-4', 'A', PERM, "    case 'clipboard-sanitized-write':\n      return true", "    case 'clipboard-sanitized-write':\n      return false"],
  pDevices: ['15-4', 'B', PERM, '  ses.setDevicePermissionHandler(() => false)', '  ses.setDevicePermissionHandler(() => true)'],
  pRequestYes: ['15-4', 'B', PERM, '    callback(permissionAllowed(ask, context()))', '    callback(true)'],
  pWhichWindow: ['15-4', 'B', PERM, '      fromMainWindow: contents === chatContents()', '      fromMainWindow: true'],
  pWhichWindowCheck: ['15-4', 'B', PERM, '      fromMainWindow: contents !== null && contents === chatContents()', '      fromMainWindow: true'],
  tTitle: ['15-4', 'C', PERM, "export const RECORDING_TITLE = 'Frontier App - RECORDING (the microphone is on)'", "export const RECORDING_TITLE = 'Frontier App'"],
  tDot: ['15-4', 'C', PERM, '        buffer.set([0x1c, 0x1c, 0xd8, 0xff], at) // red (B, G, R, A)', '        buffer.set([0, 0, 0, 0], at)'],
  wTitleLock: ['15-4', 'D', WIN, "  window.on('page-title-updated', (event) => event.preventDefault())\n", ''],
  wTitleWrongEvent: ['15-4', 'D', WIN, "  window.on('page-title-updated', (event) => event.preventDefault())", "  window.webContents.on('page-title-updated', (event) => event.preventDefault())"],
  wDot: ['15-4', 'D', WIN, '      window.setOverlayIcon(recording ? dot : null,', '      window.setOverlayIcon(null,'],
  wClose: ['15-4', 'D', WIN, '    stop()\n    microphoneGate.close()', '    stop()'],
  iDefault: ['15-4', 'D', INDEX, '    session.defaultSession,', "    session.fromPartition('somewhere-else'),"],
  iTitle: ['15-4', 'D', INDEX, "    title: 'Frontier App',\n", ''],
  iOrder: ['15-4', 'D', INDEX, '  savesDone = registerIpc(appUrl)\n  createWindow()\n', '  createWindow()\n  savesDone = registerIpc(appUrl)\n']
}

mkdirSync(join(TOOLS, 'specs154'), { recursive: true })
for (const [name, [suite, only, file, from, to]] of Object.entries(controls)) {
  if (typeof file !== 'string' || typeof from !== 'string' || typeof to !== 'string' || /\$[$&`'0-9<]/.test(to)) throw new Error(`the control ${name} is not well formed`)
  const spec = { label: `n154-${name}`, edits: [{ file, from, to }], argv: ['{{TOOLS}}/guarded.mjs', `{{TOOLS}}/verify-${suite}.mjs`], env: only === null ? {} : { ONLY: only }, timeoutMs: 400000 }
  writeFileSync(join(TOOLS, 'specs154', `n154-${name}.json`), JSON.stringify(spec, null, 2) + '\n')
}
console.log(`wrote ${Object.keys(controls).length} specs in specs154`)
