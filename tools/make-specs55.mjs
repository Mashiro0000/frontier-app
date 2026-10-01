// Writes the negative-control specs for the OpenAI adapter (slice 5.5): one sabotage each, which provider-openai-test-5.mjs must notice.
// usage: node tools/make-specs55.mjs   then   node tools/nc-all.mjs specs55 $(ls tools/specs55 | sed s/.json//)
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { TOOLS } from './paths.mjs'

const O = '{{REPO}}/src/main/providers/openai.ts'
const REQ = '{{REPO}}/src/main/providers/request.ts'
const specs = {
  'store-kept': [O, '      store: false', '      store: true'],
  'effort-never-sent': [O, '...(model.effort ? { reasoning: { effort: model.effort } } : {}),', '...{},'],
  'cache-not-subtracted': [O, 'inputTokens: input - cacheRead - cacheWrite,', 'inputTokens: input,'],
  'refusal-is-an-answer': [O, '      refused = true', '      refused = false'],
  'content-filter-is-cut-off': [O, "response.incomplete_details?.reason === 'content_filter'", 'false'],
  'quota-is-rate-limit': [O, "QUOTA_CODES.has(String(api?.code)) || api?.type === 'insufficient_quota'", 'false'],
  'custom-headers-env-kept': [O, "    ['OPENAI_CUSTOM_HEADERS'],", '    [],'],
  'org-from-env': [O, '        organization: null,\n', ''],
  'failed-reply-is-done': [O, "if (response.status === 'failed') {", 'if (false) {'],
  'early-close-is-done': [O, "if (response.status !== 'completed' && response.status !== 'incomplete')", 'if (false)'],
  'listing-not-capped': [O, 'if (models.length >= MAX_LISTED_MODELS) break', ''],
  'reply-ceiling-ignored': [REQ, 'Math.min(MAX_REPLY_TOKENS, model.maxOutputTokens)', 'model.maxOutputTokens'],
  'openai-told-it-is-claude': [REQ, "openai: 'an AI assistant'", "openai: 'Claude'"]
}
const dir = join(TOOLS, 'specs55')
mkdirSync(dir, { recursive: true })
for (const [name, [file, from, to]] of Object.entries(specs)) {
  writeFileSync(join(dir, `${name}.json`), JSON.stringify({ label: name, edits: [{ file, from, to }], argv: ['{{TOOLS}}/provider-openai-test-5.mjs'], env: {} }, null, 2) + '\n')
}
console.log(`wrote ${Object.keys(specs).length} specs in specs55`)

// ---- the same for the two-provider window suite (run55.mjs, the real window): sabotages of the app, which verify-5-5.mjs must notice
const wdir = join(TOOLS, 'specs55w')
mkdirSync(wdir, { recursive: true })
const CHAT = '{{REPO}}/src/main/chat.ts'
const IPC = '{{REPO}}/src/main/ipc.ts'
const FORMAT = '{{REPO}}/src/renderer/src/settings/format.ts'
const CRED = '{{REPO}}/src/main/credentialStore.ts'
const wspecs = {
  'w55-wrong-providers-key-sent': [CHAT, 'const saved = await readApiKey(entry.provider)', "const saved = await readApiKey('anthropic')"],
  'w55-test-key-asks-anthropic': [IPC, 'const adapter = adapterFor(provider)', "const adapter = adapterFor('anthropic')"],
  'w55-missing-key-names-anthropic': [CHAT, '${PROVIDER_NAMES[provider]} API key.`', '${PROVIDER_NAMES.anthropic} API key.`'],
  'w55-badge-ignores-the-model': [FORMAT, 'const answering = answeringProvider(status)\n  if (answering) return answering.hasKey ? null : answering', 'const answering = null as ReturnType<typeof answeringProvider>\n  if (answering) return null'],
  'w55-keys-share-a-file': [CRED, 'const fileOf = (provider: ProviderId): string => join(dir, credentialFileName(provider))', "const fileOf = (provider: ProviderId): string => join(dir, credentialFileName('anthropic' as ProviderId))"],
  'w55-store-kept': [O, '      store: false', '      store: true'],
  'w55-openai-told-it-is-claude': [REQ, "openai: 'an AI assistant'", "openai: 'Claude'"],
  'w55-quota-is-rate-limit': [O, "QUOTA_CODES.has(String(api?.code)) || api?.type === 'insufficient_quota'", 'false']
}
for (const [name, [file, from, to]] of Object.entries(wspecs)) {
  writeFileSync(join(wdir, `${name}.json`), JSON.stringify({ label: name, edits: [{ file, from, to }], argv: ['{{TOOLS}}/run55.mjs'], env: {} }, null, 2) + '\n')
}
console.log(`wrote ${Object.keys(wspecs).length} specs in specs55w`)
