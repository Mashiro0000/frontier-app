// Writes the negative-control specs for slice 16.1 (the probe, D-048): one sabotage each, which verify-16-1.mjs (specs161) or probe-16-1.mjs (specs161w) must notice.
// usage: node tools/make-specs161.mjs
//   then: FRONTIER_MAY_REMOVE=1 FRONTIER_KEEP_TEMP=1 TEMP=C:\frontier-tmp TMP=C:\frontier-tmp node tools/nc-all.mjs specs161 <names...>
//   and:  node tools/guarded-window-copy.mjs tools/nc-all.mjs specs161w <names...>      (never while Node controls run: they change the files on disk)
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { TOOLS } from './paths.mjs'

const MOCK = '{{TOOLS}}/mock-images.mjs'
const HTML = '{{REPO}}/src/renderer/index.html'

// name: [suite, ONLY (or null), file, from, to]
const controls = {
  mSize16: ['16-1', 'D', MOCK, 'if (w % 16 !== 0 || h % 16 !== 0)', 'if (false)'],
  mRatio: ['16-1', 'D', MOCK, 'if (Math.max(w, h) / Math.min(w, h) > 3)', 'if (false)'],
  mXhigh: ['16-1', 'D', MOCK, "? ['low', 'medium', 'high', 'xhigh', 'max', 'auto'] : ['low', 'medium', 'high', 'auto']", "? ['low', 'medium', 'high', 'xhigh', 'max', 'auto'] : ['low', 'medium', 'high', 'xhigh', 'auto']"],
  mResponseFormat: ['16-1', 'D', MOCK, "    if (b.response_format !== undefined) problems.push", "    if (false) problems.push"],
  mNoModel: ['16-1', 'D', MOCK, "if (model === null) problems.push('no model was named", "if (false) problems.push('no model was named"],
  mUnknownField: ['16-1', 'D', MOCK, 'if (!FIELDS.has(key)) problems.push', 'if (false) problems.push'],
  mUsageAlways: ['16-1', 'B', MOCK, "const usage = control.usage ?? 'tokens'", "const usage = 'tokens'"],
  mCount: ['16-1', 'B', MOCK, "const count = mode === 'fewer' ? n - 1", "const count = mode === 'fewer' ? n"],
  mBlockedCode: ['16-1', 'C', MOCK, "'image_generation_user_error', 'moderation_blocked')", "'image_generation_user_error', null)"],
  mFieldsLogged: ['16-1', 'A', MOCK, 'fields: Object.keys(b).sort(),', "fields: Object.keys(b).sort().concat(['extra']),"]
}
const windowControls = {
  wPolicyBlob: [HTML, "img-src 'self' data:\"", "img-src 'self' data: blob:\""],
  wPolicyHttp: [HTML, "img-src 'self' data:\"", "img-src 'self' data: http://127.0.0.1:*\""]
}

const write = (dir, name, spec) => { mkdirSync(join(TOOLS, dir), { recursive: true }); writeFileSync(join(TOOLS, dir, `${name}.json`), JSON.stringify(spec, null, 2) + '\n') }
const sane = (name, from, to) => { if (typeof from !== 'string' || typeof to !== 'string' || /\$[$&`'0-9<]/.test(to)) throw new Error(`the control ${name} is not well formed`) }
for (const [name, [suite, only, file, from, to]] of Object.entries(controls)) {
  sane(name, from, to)
  write('specs161', `n161-${name}`, { label: `n161-${name}`, edits: [{ file, from, to }], argv: ['{{TOOLS}}/guarded.mjs', `{{TOOLS}}/verify-${suite}.mjs`], env: only === null ? {} : { ONLY: only }, timeoutMs: 300000 })
}
for (const [name, [file, from, to]] of Object.entries(windowControls)) {
  sane(name, from, to)
  write('specs161w', `w161-${name}`, { label: `w161-${name}`, edits: [{ file, from, to }], argv: ['{{TOOLS}}/run161.mjs', 'dev'], env: { NO_RETRY: '1' }, timeoutMs: 600000 })
}
console.log(`wrote ${Object.keys(controls).length} specs in specs161 and ${Object.keys(windowControls).length} in specs161w`)
