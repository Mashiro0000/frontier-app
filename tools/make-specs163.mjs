// Writes the negative-control specs for slice 16.3 (the picture adapter, D-048): one sabotage each, which verify-16-3.mjs must notice.
// usage: node tools/make-specs163.mjs
//   then: FRONTIER_MAY_REMOVE=1 FRONTIER_KEEP_TEMP=1 TEMP=C:\frontier-tmp TMP=C:\frontier-tmp node tools/nc-all.mjs specs163 <names...>
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { TOOLS } from './paths.mjs'

const AD = '{{REPO}}/src/main/providers/openaiImages.ts'
const OPENAI = '{{REPO}}/src/main/providers/openai.ts'
const REQ = "{ model, prompt, n: count, size, quality, output_format: 'png' }"

// name: [ONLY, file, from, to]
const controls = {
  aRetry: ['C', AD, 'timeout: timeoutMs, maxRetries: 0', 'timeout: timeoutMs, maxRetries: 2'],
  aClock: ['C', AD, 'timeout: timeoutMs, maxRetries: 0', 'timeout: timeoutMs * 5, maxRetries: 0'],
  aModeration: ['A', AD, REQ, "{ model, prompt, n: count, size, quality, output_format: 'png', moderation: 'low' }"],
  aBackground: ['A', AD, REQ, "{ model, prompt, n: count, size, quality, output_format: 'png', background: 'auto' }"],
  aFormat: ['A', AD, REQ, "{ model, prompt, n: count, size, quality, output_format: 'webp' }"],
  aPromptTrim: ['A', AD, REQ, "{ model, prompt: prompt.trim(), n: count, size, quality, output_format: 'png' }"],
  aCount: ['A', AD, REQ, "{ model, prompt, n: 1, size, quality, output_format: 'png' }"],
  aStopped: ['C', AD, '    if (signal?.aborted === true) {', '    if (false) {'],
  aBlockedOwes: ['C', AD, "        'blocked',\n        true", "        'blocked',\n        false"],
  aBlockedRetry: ['C', AD, "    if (error instanceof OpenAI.APIError && error.code === 'moderation_blocked') {\n", "    if (error instanceof OpenAI.APIError && error.code === 'moderation_blocked') {\n      await newClient(credentials).images.generate({ model, prompt, n: count, size, quality, output_format: 'png', moderation: 'low' }, { signal, timeout: timeoutMs, maxRetries: 0 }).catch(() => undefined)\n"],
  aVerify: ['C', AD, '/must be verified/i.test(error.message)', '/never said by anyone/i.test(error.message)'],
  aRefusedAuth: ['C', AD, "= [\n  'auth',\n  'permission',", "= [\n  'permission',"],
  aScrub: ['C', AD, 'describeFailure(normalized, credentials.apiKey)', "describeFailure(normalized, '')"],
  aNotFoundWords: ['C', AD, "normalized.kind === 'not-found'", "normalized.kind === ('none' as string)"],
  bTokensBound: ['B', AD, '!isTokens(output, MAX_OUTPUT_TOKENS_EACH * count)', '!isTokens(output, Number.MAX_SAFE_INTEGER)'],
  bTokensZero: ['B', AD, '  if (output === 0) return null\n', ''],
  bCountFromAnswer: ['B', AD, 'const checked = checkAnswerPictures(answer.data, count)', 'const checked = checkAnswerPictures(answer.data, Array.isArray(answer.data) ? answer.data.length : count)'],
  bSyntax: ['B', AD, '    if (error instanceof SyntaxError) {', '    if (false) {'],
  dOrganization: ['D', OPENAI, '        organization: null,', '        organization: process.env.OPENAI_ORG_ID ?? null,']
}

mkdirSync(join(TOOLS, 'specs163'), { recursive: true })
for (const [name, [only, file, from, to]] of Object.entries(controls)) {
  if (typeof file !== 'string' || typeof from !== 'string' || typeof to !== 'string' || /\$[$&`'0-9<]/.test(to)) throw new Error(`the control ${name} is not well formed`)
  const spec = { label: `n163-${name}`, edits: [{ file, from, to }], argv: ['{{TOOLS}}/guarded.mjs', '{{TOOLS}}/verify-16-3.mjs'], env: { ONLY: only }, timeoutMs: 300000 }
  writeFileSync(join(TOOLS, 'specs163', `n163-${name}.json`), JSON.stringify(spec, null, 2) + '\n')
}
console.log(`wrote ${Object.keys(controls).length} specs in specs163`)
