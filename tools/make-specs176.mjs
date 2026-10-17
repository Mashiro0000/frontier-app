// Writes the negative-control specs for slice 17.6 (files, instructions and notes in a Gemini request; the golden test, D-049): one sabotage each, which verify-17-6.mjs
// under Node (specs176) or verify-17-6w.mjs in the real window (specs176w) must notice. Two of them change what the OTHER providers send: the golden test must catch them.
// usage: node tools/make-specs176.mjs
//   then: FRONTIER_MAY_REMOVE=1 FRONTIER_KEEP_TEMP=1 TEMP=C:\frontier-tmp TMP=C:\frontier-tmp node tools/nc-all.mjs specs176 <names...>
//   and:  node tools/guarded-window-copy.mjs tools/nc-all.mjs specs176w <names...>      (never while Node controls run)
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { TOOLS } from './paths.mjs'

const AR = '{{REPO}}/src/main/attachmentRequest.ts'
const AD = '{{REPO}}/src/main/providers/gemini.ts'
const OA = '{{REPO}}/src/main/providers/openai.ts'
const AN = '{{REPO}}/src/main/providers/anthropic.ts'
const GIF = "        facts.mediaType === 'image/gif' &&\n        model.provider === 'google'"

// name: [ONLY, file, from, to]
const controls = {
  goldenOpenAIImageDetail: ['A', OA, "          detail: 'auto'", "          detail: 'high'"],
  goldenAnthropicCache: ['A', AN, "        ? { cache_control: { type: 'ephemeral' as const } }", "        ? { cache_control: { type: 'ephemeral' as const, ttl: '1h' } }"],
  gifSent: ['C', AR, GIF, "        facts.mediaType === 'image/gif' &&\n        model.provider === ('none' as string)"],
  capOff: ['C', AR, "  if (model.provider === 'google' && files.bytes > GEMINI_MAX_FILE_BYTES) {", "  if (false && files.bytes > GEMINI_MAX_FILE_BYTES) {"],
  capTwenty: ['C', AR, 'export const GEMINI_MAX_FILE_BYTES = 14 * MB', 'export const GEMINI_MAX_FILE_BYTES = 20 * MB'],
  pdfTyped: ['B', AD, "          ? { inlineData: { mimeType: 'application/pdf', data: file.data } }", "          ? { inlineData: { mimeType: 'application/octet-stream', data: file.data } }"],
  textUnnamed: ['B', AD, "          : { text: `${textFileLead(file.name)}\\n\\n${file.text}` }", '          : { text: file.text }'],
  systemInContents: ['D', AD, '    systemInstruction: { parts: [{ text: request.system }] },', "    systemInstruction: { parts: [{ text: 'You are an AI assistant.' }] },"]
}
// name: [file, from, to]
const windowControls = {
  wGifSent: [AR, GIF, "        facts.mediaType === 'image/gif' &&\n        model.provider === ('none' as string)"],
  wPdfTyped: [AD, "          ? { inlineData: { mimeType: 'application/pdf', data: file.data } }", "          ? { inlineData: { mimeType: 'application/octet-stream', data: file.data } }"],
  wSystemLost: [AD, '    systemInstruction: { parts: [{ text: request.system }] },', "    systemInstruction: { parts: [{ text: 'You are an AI assistant.' }] },"]
}

const write = (dir, name, spec) => {
  mkdirSync(join(TOOLS, dir), { recursive: true })
  writeFileSync(join(TOOLS, dir, `${name}.json`), JSON.stringify(spec, null, 2) + '\n')
}
for (const [name, [only, file, from, to]] of Object.entries(controls)) {
  write('specs176', `n176-${name}`, { label: `n176-${name}`, edits: [{ file, from, to }], argv: ['{{TOOLS}}/guarded.mjs', '{{TOOLS}}/verify-17-6.mjs'], env: { ONLY: only }, timeoutMs: 600000 })
}
for (const [name, [file, from, to]] of Object.entries(windowControls)) {
  write('specs176w', `w176-${name}`, { label: `w176-${name}`, edits: [{ file, from, to }], argv: ['{{TOOLS}}/run176.mjs', 'dev'], env: { NO_RETRY: '1' }, timeoutMs: 1200000 })
}
console.log(`wrote ${Object.keys(controls).length} specs in specs176 and ${Object.keys(windowControls).length} in specs176w`)
