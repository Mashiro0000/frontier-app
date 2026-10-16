// Writes the negative-control specs for slice 16.7 (what is kept, sealed and backed up of the pictures, and the most a request can cost, D-048): one sabotage each, which
// verify-16-7.mjs, verify-16-2.mjs or verify-16-4.mjs (specs167) or verify-16-7w.mjs in the real window (specs167w) must notice.
// usage: node tools/make-specs167.mjs
//   then: FRONTIER_MAY_REMOVE=1 FRONTIER_KEEP_TEMP=1 TEMP=C:\frontier-tmp TMP=C:\frontier-tmp node tools/nc-all.mjs specs167 <names...>
//   and:  node tools/guarded-window-copy.mjs tools/nc-all.mjs specs167w <names...>      (never while Node controls run)
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { TOOLS } from './paths.mjs'

const EN = '{{REPO}}/src/main/chatEncryptionService.ts'
const UC = '{{REPO}}/src/renderer/src/settings/useChatStorage.ts'
const IP = '{{REPO}}/src/main/ipc.ts'
const IM = '{{REPO}}/src/shared/images.ts'
const SV = '{{REPO}}/src/main/imageService.ts'
const MD = '{{REPO}}/src/renderer/src/images/MakeImageDialog.tsx'
const US = '{{REPO}}/src/shared/usage.ts'
const WIRE = '    pictures: imageStore, // the gallery\'s pictures (D-048), sealed with the chats; images.json is among the documents below\n'
const OFF_CONFORM = "    const picturesDone = await conformPictures()\n    return {\n      ok: true,\n      status: await status(),\n      report: {\n        ...done,\n        backup: null,"

// name: [suite, ONLY, file, from, to]
const controls = {
  eOnSkipped: ['16-7', 'A', EN, '      report: { ...done, backup, ...withFiles(filesDone), ...documentsDone, ...picturesDone }', '      report: { ...done, backup, ...withFiles(filesDone), ...documentsDone }'],
  eOffSkipped: ['16-7', 'A', EN, OFF_CONFORM, "    const picturesDone = {}\n    return {\n      ok: true,\n      status: await status(),\n      report: {\n        ...done,\n        backup: null,"],
  eShortcutOn: ['16-7', 'A', EN, '      plainDocuments === 0 &&\n      plainPictures === 0\n', '      plainDocuments === 0\n'],
  eShortcutOff: ['16-7', 'A', EN, '      sealedDocuments === 0 &&\n      sealedPictures === 0\n', '      sealedDocuments === 0\n'],
  eNoneCounted: ['16-7', 'A', EN, '    if (before.plain + before.encrypted === 0) return {}\n    const done = await pictures.conform()', '    const done = await pictures.conform()'],
  uOne: ['16-7', 'B', UC, "  `${count} ${count === 1 ? 'picture' : 'pictures'} in the gallery`", '  `${count} pictures in the gallery`'],
  uOnSaid: ['16-7', 'B', UC, '      parts.push(`Encrypted ${gallery(report.pictures.changed)} too.`)', '      parts.push(`Encrypted ${gallery(report.pictures.changed)}.`)'],
  uPlainGone: ['16-7', 'B', UC, "        `Rewrote ${gallery(report.pictures.changed)} as ${report.pictures.changed === 1 ? 'a plain file' : 'plain files'} too.`", "        ''"],
  uStill: ['16-7', 'B', UC, "${report.pictures.failed === 1 ? 'is' : 'are'} still encrypted.`", "${report.pictures.failed === 1 ? 'is' : 'are'} as before.`"],
  ipWire: ['16-7', 'F', IP, WIRE, ''],
  mdBytes: ['16-7', 'F', MD, 'promptBytes: bytes })', 'promptBytes: 0 })'],
  mRounding: ['16-2', 'C', IM, '      (model.perPicture[shape][quality] + IMAGE_LIMITS.tableRoundingUsd) * count +', '      model.perPicture[shape][quality] * count +'],
  mWords: ['16-2', 'C', IM, '      (descriptionBytes * model.prices.textInPerMTok) / 1_000_000,', '      0,'],
  mBytes: ['16-2', 'C', IM, 'new TextEncoder().encode(prompt).length', 'prompt.length'],
  sGenBytes: ['16-4', 'D', SV, '          promptBytes(ask.prompt)\n', '          0\n'],
  sEstCap: ['16-4', 'C', SV, '        (input.promptBytes as number) > IMAGE_LIMITS.maxPromptBytes\n', '        false\n'],
  sEstIgnored: ['16-4', 'C', SV, '        input.promptBytes as number\n      )', '        0\n      )']
}
// name: [file, from, to, STOP_AFTER]
const windowControls = {
  wWire: [IP, WIRE, '', 'D'],
  wOffSkipped: [EN, OFF_CONFORM, "    const picturesDone = {}\n    return {\n      ok: true,\n      status: await status(),\n      report: {\n        ...done,\n        backup: null,", 'E'],
  wNotInSums: [US, '  (record.image === undefined ? 0 : record.image.usd)', '  0', 'B']
}

const write = (dir, name, spec) => { mkdirSync(join(TOOLS, dir), { recursive: true }); writeFileSync(join(TOOLS, dir, `${name}.json`), JSON.stringify(spec, null, 2) + '\n') }
const sane = (name, from, to) => { if (typeof from !== 'string' || typeof to !== 'string' || /\$[$&`'0-9<]/.test(to)) throw new Error(`the control ${name} is not well formed`) }
for (const [name, [suite, only, file, from, to]] of Object.entries(controls)) {
  sane(name, from, to)
  write('specs167', `n167-${name}`, { label: `n167-${name}`, edits: [{ file, from, to }], argv: ['{{TOOLS}}/guarded.mjs', `{{TOOLS}}/verify-${suite}.mjs`], env: { ONLY: only }, timeoutMs: 300000 })
}
for (const [name, [file, from, to, stopAfter]] of Object.entries(windowControls)) {
  sane(name, from, to)
  write('specs167w', `w167-${name}`, { label: `w167-${name}`, edits: [{ file, from, to }], argv: ['{{TOOLS}}/run167.mjs', 'dev'], env: { NO_RETRY: '1', STOP_AFTER: stopAfter }, timeoutMs: 1200000 })
}
console.log(`wrote ${Object.keys(controls).length} specs in specs167 and ${Object.keys(windowControls).length} in specs167w`)
