// Writes the negative-control specs for slice 16.4 (the gallery's store, the image service and the wiring, D-048): one sabotage each, which verify-16-4.mjs (specs164) or
// verify-16-4w.mjs in the real window (specs164w) must notice.
// usage: node tools/make-specs164.mjs
//   then: FRONTIER_MAY_REMOVE=1 FRONTIER_KEEP_TEMP=1 TEMP=C:\frontier-tmp TMP=C:\frontier-tmp node tools/nc-all.mjs specs164 <names...>
//   and:  node tools/guarded-window-copy.mjs tools/nc-all.mjs specs164w <names...>      (never while Node controls run)
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { TOOLS } from './paths.mjs'

const SV = '{{REPO}}/src/main/imageService.ts'
const ST = '{{REPO}}/src/main/imageStore.ts'
const IPC = '{{REPO}}/src/main/ipc.ts'
const PRE = '{{REPO}}/src/preload/index.ts'
const DLG = '{{REPO}}/src/main/backupDialogs.ts'

// name: [ONLY, file, from, to]
const controls = {
  sNoQuestion: ['B', SV, "        if (answer !== 'yes') return { ok: false, error: NOT_ON }", '        if (false) return { ok: false, error: NOT_ON }'],
  sKeyFirst: ['B', SV, "        if ((await options.key()) === null) return { ok: false, error: IMAGE_WORDS.noKey }\n        const answer", '        const answer'],
  sOffKeepsGoing: ['D', SV, '        if (!input.on) {\n          inFlight?.abort()', '        if (!input.on) {'],
  sTwoAtOnce: ['D', SV, "      if (making) return { ok: false, kind: 'refused', error: IMAGE_WORDS.busy }", "      if (false) return { ok: false, kind: 'refused', error: IMAGE_WORDS.busy }"],
  sRoomLater: ['D', SV, "        if (full !== null) return { ok: false, kind: 'refused', error: full }", "        if (false) return { ok: false, kind: 'refused', error: full }"],
  sLimitsLater: ['D', SV, "          if (before.refusal !== null) return { ok: false, kind: 'refused', error: before.refusal }", "          if (false) return { ok: false, kind: 'refused', error: before.refusal }"],
  sAskHigher: ['D', SV, '        if (most.usd > IMAGE_LIMITS.askAboveUsd) {', '        if (most.usd > 5) {'],
  sBigNoGoesOn: ['D', SV, "          if (answer !== 'yes') return { ok: false, kind: 'refused', error: IMAGE_WORDS.notAsked }", "          if (false) return { ok: false, kind: 'refused', error: IMAGE_WORDS.notAsked }"],
  sRejectedOwes: ['D', SV, "            state: failed?.rejected ? 'rejected' : failed?.stopped ? 'stopped' : 'failed',", "            state: failed?.stopped ? 'stopped' : 'failed',"],
  sCostAlwaysTable: ['D', SV, '        const costUsd = answer.tokens !== null ? costFromTokens(ask.model, answer.tokens) : most.usd', '        const costUsd = most.usd'],
  sNeverAGuess: ['D', SV, '        const estimate = answer.tokens === null', '        const estimate = false'],
  sStopKind: ['D', SV, "          if (failed?.stopped) return { ok: false, kind: 'stopped', error: IMAGE_WORDS.stopped }", "          if (failed?.stopped) return { ok: false, kind: 'failed', error: IMAGE_WORDS.failed }"],
  sBlockedKind: ['D', SV, "            kind: failed?.kind === 'blocked' ? 'blocked' : 'failed',", "            kind: 'failed',"],
  sOldestFirst: ['E', SV, '      for (const record of [...listed.pictures].reverse()) pictures.push(await summaryOf(record))', '      for (const record of [...listed.pictures]) pictures.push(await summaryOf(record))'],
  sDeleteNoQuestion: ['E', SV, "      if (answer !== 'yes') return { ok: false, cancelled: true, error: 'The picture was kept.' }", "      if (false) return { ok: false, cancelled: true, error: 'The picture was kept.' }"],
  sSaveNoCancel: ['E', SV, "      if (path === null) return { ok: false, cancelled: true, error: 'Cancelled.' }", "      if (path === null) return { ok: false, error: 'Cancelled.' }"],
  sSaveNameFromPrompt: ['E', SV, '      const name = `picture-${day}-${read.record.id.slice(0, 8)}', '      const name = `${read.record.prompt.slice(0, 12)}-${day}-${read.record.id.slice(0, 8)}'],
  stHalfKept: ['F', ST, '          for (const record of records) await removeFile(record.id)', '          void records'],
  stSizeOnly: ['F', ST, '    if (data.length === record.bytes && sha256(data) === record.sha256) {', '    if (data.length === record.bytes) {'],
  stShortIds: ['D', ST, 'randomBytes(16).toString', 'randomBytes(8).toString'],
  stRemoveAnything: ['G', ST, '    if (!isPictureId(id)) return false\n    const file', '    const file'],
  ipcKeptDocs: ['G', IPC, '      imageSettings.file,\n      imageIndex\n', '      imageSettings.file\n'],
  ipcQuitGoesOn: ['G', IPC, '    images.stop() //', '    // images.stop() //']
}
const windowControls = {
  wPreloadPassesAll: [PRE, 'generate: ({ prompt, model, shape, quality, count, chat }) =>\n      ipcRenderer.invoke(CHANNELS.imagesGenerate, { prompt, model, shape, quality, count, chat }),', 'generate: (ask) => ipcRenderer.invoke(CHANNELS.imagesGenerate, ask),', 'F'],
  wDialogTitle: [DLG, "title: 'Save a copy of the picture',", "title: 'Save as',", 'E'],
  wNoThumbnails: [IPC, "    index: imageIndex,\n    images: electronImageTools,", '    index: imageIndex,\n    images: { thumbnail: () => null },', 'C'],
  wBigAskWords: [SV, "    yes: 'Make them',", "    yes: 'OK',", 'D']
}

const write = (dir, name, spec) => { mkdirSync(join(TOOLS, dir), { recursive: true }); writeFileSync(join(TOOLS, dir, `${name}.json`), JSON.stringify(spec, null, 2) + '\n') }
const sane = (name, from, to) => { if (typeof from !== 'string' || typeof to !== 'string' || /\$[$&`'0-9<]/.test(to)) throw new Error(`the control ${name} is not well formed`) }
for (const [name, [only, file, from, to]] of Object.entries(controls)) {
  sane(name, from, to)
  write('specs164', `n164-${name}`, { label: `n164-${name}`, edits: [{ file, from, to }], argv: ['{{TOOLS}}/guarded.mjs', '{{TOOLS}}/verify-16-4.mjs'], env: { ONLY: only }, timeoutMs: 300000 })
}
for (const [name, [file, from, to, stopAfter]] of Object.entries(windowControls)) {
  sane(name, from, to)
  write('specs164w', `w164-${name}`, { label: `w164-${name}`, edits: [{ file, from, to }], argv: ['{{TOOLS}}/run164.mjs', 'dev'], env: { NO_RETRY: '1', STOP_AFTER: stopAfter }, timeoutMs: 1200000 })
}
console.log(`wrote ${Object.keys(controls).length} specs in specs164 and ${Object.keys(windowControls).length} in specs164w`)
