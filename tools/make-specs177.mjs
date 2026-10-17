// Writes the negative-control specs for slice 17.7 (kept, sealed and backed up; the shortlist; every stage's safety, D-049): one sabotage each, which verify-17-7.mjs
// under Node (specs177) or verify-17-7w.mjs in the real window (specs177w) must notice.
// usage: node tools/make-specs177.mjs
//   then: FRONTIER_MAY_REMOVE=1 FRONTIER_KEEP_TEMP=1 TEMP=C:\frontier-tmp TMP=C:\frontier-tmp node tools/nc-all.mjs specs177 <names...>
//   and:  node tools/guarded-window-copy.mjs tools/nc-all.mjs specs177w <names...>      (never while Node controls run)
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { TOOLS } from './paths.mjs'

const RK = '{{REPO}}/registry/rankings.json'
const AD = '{{REPO}}/src/main/providers/gemini.ts'
const HTML = '{{REPO}}/src/renderer/index.html'
const PKG = '{{REPO}}/package.json'
const CS = '{{REPO}}/src/main/credentialStore.ts'
const ROW = '      "modelId": "gemini-3.8-flash",'
const NOTE = '"\\"engineered for long-horizon software engineering, autonomous agents\\" (Google\'s most intelligent Flash model)"'

// name: [file, from, to]
const controls = {
  rowForArgon: [RK, ROW, '      "modelId": "gemini-4-argon",'],
  noteNotQuoted: [RK, NOTE, '"The best model for coding."'],
  keyLogged: [AD, "    const dog = watchdog(request.signal)\n    try {\n      const url", "    const dog = watchdog(request.signal)\n    console.log('key', request.credentials.apiKey)\n    try {\n      const url"],
  policyWidened: [HTML, "img-src 'self' data:\"", "img-src 'self' data: https:\""],
  packageAdded: [PKG, '"dependencies": {', '"dependencies": {\n    "@google/genai": "1.0.0",']
}
// name: [file, from, to]
const windowControls = {
  wKeyKeptPlain: [CS, "          key: box.encrypt(key).toString('base64')", "          key: box.encrypt(key).toString('base64') + (provider === 'google' ? key : '')"],
  wNoRow: [RK, ROW, '      "modelId": "gemini-9-none",']
}

const write = (dir, name, spec) => {
  mkdirSync(join(TOOLS, dir), { recursive: true })
  writeFileSync(join(TOOLS, dir, `${name}.json`), JSON.stringify(spec, null, 2) + '\n')
}
for (const [name, [file, from, to]] of Object.entries(controls)) {
  write('specs177', `n177-${name}`, { label: `n177-${name}`, edits: [{ file, from, to }], argv: ['{{TOOLS}}/guarded.mjs', '{{TOOLS}}/verify-17-7.mjs'], env: {}, timeoutMs: 300000 })
}
for (const [name, [file, from, to]] of Object.entries(windowControls)) {
  write('specs177w', `w177-${name}`, { label: `w177-${name}`, edits: [{ file, from, to }], argv: ['{{TOOLS}}/run177.mjs', 'dev'], env: { NO_RETRY: '1' }, timeoutMs: 1200000 })
}
console.log(`wrote ${Object.keys(controls).length} specs in specs177 and ${Object.keys(windowControls).length} in specs177w`)
