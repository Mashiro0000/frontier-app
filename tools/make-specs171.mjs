// Writes the negative-control specs for slice 17.1 (the Gemini stand-in and the probe, D-049): one sabotage each of the stand-in, which verify-17-1.mjs must notice.
// usage: node tools/make-specs171.mjs
//   then: FRONTIER_MAY_REMOVE=1 FRONTIER_KEEP_TEMP=1 TEMP=C:\frontier-tmp TMP=C:\frontier-tmp node tools/nc-all.mjs specs171 <names...>
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { TOOLS } from './paths.mjs'

const M = '{{TOOLS}}/mock-gemini.mjs'

// name: [ONLY, file, from, to]
const controls = {
  keyInAddress: ['D', M, "    if (url.searchParams.has('key')) problems.push('THE KEY WAS PUT IN THE ADDRESS (?key=): this app must send it only in the x-goog-api-key header')\n", ''],
  altSse: ['D', M, "    if (url.searchParams.get('alt') !== 'sse') problems.push", "    if (false) problems.push"],
  authorization: ['D', M, "    if (req.headers['authorization']) problems.push('an Authorization header was sent: this app sends the key in x-goog-api-key only')\n", ''],
  includeThoughts: ['D', M, "            if (t.includeThoughts === true) problems.push", "            if (false) problems.push"],
  minimalLevel: ['D', M, "if ('thinkingLevel' in t && spec && !spec.levels.includes(t.thinkingLevel))", "if ('thinkingLevel' in t && spec && false)"],
  gifTaken: ['D', M, "const INLINE_TYPES = ['image/png',", "const INLINE_TYPES = ['image/gif', 'image/png',"],
  additionalProperties: ['D', M, "const SCHEMA_KEYS = ['type',", "const SCHEMA_KEYS = ['additionalProperties', 'type',"],
  signature: ['D', M, "if (signed && k === 0 && p.thoughtSignature !== signed)", "if (signed && k === 0 && false)"],
  hostedTool: ['D', M, "problems.push(`tools[${i}]: a Google-hosted tool", "void (`tools[${i}]: a Google-hosted tool"],
  lfEvents: ['A', M, "res.write(`data: ${JSON.stringify(chunk)}\\r\\n\\r\\n`)", "res.write(`data: ${JSON.stringify(chunk)}\\n\\n`)"],
  keyIs401: ['C', M, "const invalidKey = err(400, 'INVALID_ARGUMENT', 'API key not valid.", "const invalidKey = err(401, 'UNAUTHENTICATED', 'API key not valid."],
  blockedHasCandidate: ['B', M, "emit({ promptFeedback: { blockReason:", "emit({ candidates: [{ content: { parts: [{ text: '' }], role: 'model' }, index: 0 }], promptFeedback: { blockReason:"],
  thoughtsInside: ['A', M, "const USAGE = (over = {}) => ({ promptTokenCount: 25, candidatesTokenCount: 12, totalTokenCount: 65,", "const USAGE = (over = {}) => ({ promptTokenCount: 25, candidatesTokenCount: 40, totalTokenCount: 65,"],
  quotaLikeRate: ['C', M, "'@type': 'type.googleapis.com/google.rpc.QuotaFailure'", "'@type': 'type.googleapis.com/google.rpc.RetryInfo'"],
  noSignature: ['B', M, "return { functionCall: { name, args, id }, ...(k === 0 ? { thoughtSignature: SIGNATURE } : {}) }", 'return { functionCall: { name, args, id } }']
}

mkdirSync(join(TOOLS, 'specs171'), { recursive: true })
for (const [name, [only, file, from, to]] of Object.entries(controls)) {
  if (typeof file !== 'string' || typeof from !== 'string' || typeof to !== 'string' || /\$[$&`'0-9<]/.test(to)) throw new Error(`the control ${name} is not well formed`)
  const spec = { label: `n171-${name}`, edits: [{ file, from, to }], argv: ['{{TOOLS}}/guarded.mjs', '{{TOOLS}}/verify-17-1.mjs'], env: { ONLY: only }, timeoutMs: 300000 }
  writeFileSync(join(TOOLS, 'specs171', `n171-${name}.json`), JSON.stringify(spec, null, 2) + '\n')
}
console.log(`wrote ${Object.keys(controls).length} specs in specs171`)
