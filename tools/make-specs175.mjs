// Writes the negative-control specs for slice 17.5 (Settings and the window for Google, D-049): one sabotage each, which verify-17-5.mjs under Node (specs175) or
// verify-17-5w.mjs in the real window (specs175w) must notice.
// usage: node tools/make-specs175.mjs
//   then: FRONTIER_MAY_REMOVE=1 FRONTIER_KEEP_TEMP=1 TEMP=C:\frontier-tmp TMP=C:\frontier-tmp node tools/nc-all.mjs specs175 <names...>
//   and:  node tools/guarded-window-copy.mjs tools/nc-all.mjs specs175w <names...>      (never while Node controls run)
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { TOOLS } from './paths.mjs'

const GK = '{{REPO}}/src/main/googleKey.ts'
const IPC = '{{REPO}}/src/main/ipc.ts'
const FMT = '{{REPO}}/src/renderer/src/settings/format.ts'
const COPY = '{{REPO}}/src/renderer/src/settings/providerCopy.ts'
const SEC = '{{REPO}}/src/renderer/src/settings/ProviderKeySection.tsx'
const DLG = '{{REPO}}/src/renderer/src/settings/SettingsDialog.tsx'
const SW = '{{REPO}}/src/renderer/src/tools/SwitchesSection.tsx'
const ASK = "      if (check.provider === 'google') {"

// name: [file, from, to]
const controls = {
  noFreeTierWords: [GK, "      'On a free (unbilled) key, Google uses what you send to improve its products, and people at Google may read it. On a billed key it does not (Google keeps it for a limited time, to look for abuse). The app cannot tell which kind of key this is, and sends nothing to find out.',\n", ''],
  noArgonWords: [GK, "      'Gemini 4 Argon needs a billed key: on a free key Google refuses it.',\n", ''],
  noAskedHere: [GK, '      ASKED_HERE\n', "      ''\n"],
  neverAsks: [IPC, ASK, "      if (check.provider === ('none' as string)) {"],
  onlyNoRefuses: [IPC, "        if (answer !== 'yes') {", "        if (answer === 'no') {"],
  monthOffByOne: [FMT, "return `${date} ${MONTHS[month - 1] ?? '?'} ${year}`", "return `${date} ${MONTHS[month] ?? '?'} ${year}`"],
  alwaysTwice: [FMT, "    ? \"twice today's prices\"\n    : \"more than today's prices\"", "    ? \"twice today's prices\"\n    : \"twice today's prices\""],
  noKeyNote: [SEC, '      {help.note !== undefined && <p className="settings-hint settings-key-note">{help.note}</p>}\n', ''],
  noSearchNote: [SW, "                {tool.id === 'web_search' && (", "                {tool.id === ('none' as string) && ("]
}
// name: [STOP, file, from, to]
const windowControls = {
  wNeverAsks: [IPC, ASK, "      if (check.provider === ('none' as string)) {"],
  wNoKeyNote: [SEC, '      {help.note !== undefined && <p className="settings-hint settings-key-note">{help.note}</p>}\n', ''],
  wNoPriceChange: [DLG, '            {model.priceChange !== null && (', '            {false && model.priceChange !== null && ('],
  wNoSearchNote: [SW, "                {tool.id === 'web_search' && (", "                {tool.id === ('none' as string) && ("],
  wNoteText: [COPY, 'Gemini 4 Argon needs a billed key.', 'Gemini 4 Argon is the best.']
}

const write = (dir, name, spec) => {
  mkdirSync(join(TOOLS, dir), { recursive: true })
  writeFileSync(join(TOOLS, dir, `${name}.json`), JSON.stringify(spec, null, 2) + '\n')
}
for (const [name, [file, from, to]] of Object.entries(controls)) {
  write('specs175', `n175-${name}`, { label: `n175-${name}`, edits: [{ file, from, to }], argv: ['{{TOOLS}}/guarded.mjs', '{{TOOLS}}/verify-17-5.mjs'], env: {}, timeoutMs: 300000 })
}
for (const [name, [file, from, to]] of Object.entries(windowControls)) {
  write('specs175w', `w175-${name}`, { label: `w175-${name}`, edits: [{ file, from, to }], argv: ['{{TOOLS}}/run175.mjs', 'dev'], env: { NO_RETRY: '1' }, timeoutMs: 1200000 })
}
console.log(`wrote ${Object.keys(controls).length} specs in specs175 and ${Object.keys(windowControls).length} in specs175w`)
