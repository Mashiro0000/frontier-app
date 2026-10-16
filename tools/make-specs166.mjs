// Writes the negative-control specs for slice 16.6 (the page of image generation, D-048): one sabotage each, which verify-16-6.mjs (specs166, and verify-16-4.mjs for the
// status order) or verify-16-6w.mjs in the real window (specs166w) must notice.
// usage: node tools/make-specs166.mjs
//   then: FRONTIER_MAY_REMOVE=1 FRONTIER_KEEP_TEMP=1 TEMP=C:\frontier-tmp TMP=C:\frontier-tmp node tools/nc-all.mjs specs166 <names...>
//   and:  node tools/guarded-window-copy.mjs tools/nc-all.mjs specs166w <names...>      (never while Node controls run)
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { TOOLS } from './paths.mjs'

const ST = '{{REPO}}/src/renderer/src/images/imageStatus.ts'
const MD = '{{REPO}}/src/renderer/src/images/MakeImageDialog.tsx'
const GD = '{{REPO}}/src/renderer/src/images/GalleryDialog.tsx'
const IS = '{{REPO}}/src/renderer/src/settings/ImagesSection.tsx'
const CB = '{{REPO}}/src/renderer/src/chat/ChatBar.tsx'
const AP = '{{REPO}}/src/renderer/src/App.tsx'
const SD = '{{REPO}}/src/renderer/src/settings/SettingsDialog.tsx'
const SV = '{{REPO}}/src/main/imageService.ts'
const ORDER_FROM = '          : key === null\n            ? IMAGE_WORDS.noKey // first: without a key it cannot be switched on either\n            : !chosen.on\n              ? IMAGE_WORDS.off\n'
const ORDER_TO = '          : !chosen.on\n            ? IMAGE_WORDS.off\n            : key === null\n              ? IMAGE_WORDS.noKey\n'

// name: [suite, ONLY, file, from, to]
const controls = {
  stFail: ['16-6', 'A', ST, '    () => undefined\n  )', '    () => publish(null)\n  )'],
  gdFetch: ['16-6', 'A', GD, "const NO_ANSWER = 'the app did not answer'", "const NO_ANSWER = 'the app did not answer'\nvoid fetch('x')"],
  mdStale: ['16-6', 'B', MD, 'answered !== null && answered.key === choiceKey ? answered.estimate : null', 'answered !== null ? answered.estimate : null'],
  mdLive: ['16-6', 'B', MD, '        if (live) setAnswered({ key', '        setAnswered({ key'],
  mdRefused: ['16-6', 'B', MD, '    estimate !== null &&\n    !refused\n', '    estimate !== null\n'],
  mdTooLong: ['16-6', 'B', MD, '    !tooLong &&\n', ''],
  mdRecheck: ['16-6', 'B', MD, '    if (!canMake || chosenModel', '    if (chosenModel'],
  mdEsc: ['16-6', 'B', MD, 'if (busy.current) event.preventDefault()', 'if (false) event.preventDefault()'],
  mdRetired: ['16-6', 'B', MD, "disabled={m.state === 'retired'}", 'disabled={false}'],
  mdOpenOnly: ['16-6', 'B', MD, '      {open && (\n        <MakeImageForm', '      {(\n        <MakeImageForm'],
  mdError: ['16-6', 'B', MD, '      setError(result.error)\n      return\n', '      setError(result.error)\n'],
  gdAttach: ['16-6', 'C', GD, 'disabled={busy || large.src === null || !canAttach}', 'disabled={busy || large.src === null}'],
  gdReload: ['16-6', 'C', GD, 'reloadImageStatus()\n                    load()', 'load()'],
  gdEscBusy: ['16-6', 'C', GD, '        if (busyRef.current) {\n          event.preventDefault()\n          return\n        }\n', ''],
  apVisit: ['16-6', 'C', AP, '        key={galleryVisit}\n', ''],
  apAttach: ['16-6', 'C', AP, 'canAttach={chosenModel?.imageInput === true}', 'canAttach={true}'],
  isNoKey: ['16-6', 'D', IS, 'disabled={busy || cannotTurnOn}', 'disabled={busy}'],
  cbAlways: ['16-6', 'D', CB, '{imagesOn && (', '{true && ('],
  cbReplying: ['16-6', 'D', CB, 'className="chat-button chat-make-image"\n          disabled={isReplying}', 'className="chat-button chat-make-image"\n          disabled={false}'],
  sdGone: ['16-6', 'D', SD, '      <ImagesSection key={`images:${session}`} open={open} />\n', ''],
  svOrder: ['16-4', 'A', SV, ORDER_FROM, ORDER_TO]
}
// name: [file, from, to, STOP_AFTER]
const windowControls = {
  wAlways: [CB, '{imagesOn && (', '{true && (', 'A'],
  wNoKey: [IS, 'disabled={busy || cannotTurnOn}', 'disabled={busy}', 'A'],
  wOrder: [SV, ORDER_FROM, ORDER_TO, 'A'],
  wNotInChat: [AP, 'onMade={chat.addPicture}', 'onMade={() => undefined}', 'C'],
  wRefused: [MD, '    estimate !== null &&\n    !refused\n', '    estimate !== null\n', 'E'],
  wEscBusy: [MD, 'if (busy.current) event.preventDefault()', 'if (false) event.preventDefault()', 'E'],
  // (16.8) the price table wider than Settings at 280 px: the element-by-element measure must catch it (the section's own scroll width did not)
  wTableWide: ['{{REPO}}/src/renderer/src/assets/main.css', '  table-layout: fixed;\n', '  min-width: 300px;\n', 'G'],
  wGalleryEsc: [GD, '          event.preventDefault() // Escape goes back to the grid first\n          setLarge(null)\n', '', 'F']
}

const write = (dir, name, spec) => { mkdirSync(join(TOOLS, dir), { recursive: true }); writeFileSync(join(TOOLS, dir, `${name}.json`), JSON.stringify(spec, null, 2) + '\n') }
const sane = (name, from, to) => { if (typeof from !== 'string' || typeof to !== 'string' || /\$[$&`'0-9<]/.test(to)) throw new Error(`the control ${name} is not well formed`) }
for (const [name, [suite, only, file, from, to]] of Object.entries(controls)) {
  sane(name, from, to)
  write('specs166', `n166-${name}`, { label: `n166-${name}`, edits: [{ file, from, to }], argv: ['{{TOOLS}}/guarded.mjs', `{{TOOLS}}/verify-${suite}.mjs`], env: { ONLY: only }, timeoutMs: 300000 })
}
for (const [name, [file, from, to, stopAfter]] of Object.entries(windowControls)) {
  sane(name, from, to)
  write('specs166w', `w166-${name}`, { label: `w166-${name}`, edits: [{ file, from, to }], argv: ['{{TOOLS}}/run166.mjs', 'dev'], env: { NO_RETRY: '1', STOP_AFTER: stopAfter }, timeoutMs: 1200000 })
}
console.log(`wrote ${Object.keys(controls).length} specs in specs166 and ${Object.keys(windowControls).length} in specs166w`)
