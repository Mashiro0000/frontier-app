// Writes the negative-control specs for slice 7.1 (the Effort control, D-024): one sabotage each, which the suite named must notice.
// usage: node tools/make-specs71.mjs
//   then: node tools/nc-all.mjs specs71 <names...>     (plain-Node suite verify-7-1.mjs)
//         node tools/nc-all.mjs specs71w <names...>    (the real window: verify-7-1w.mjs, and verify-7-1c.mjs on one seed)
// Each spec backs up the file, applies ONE sabotage, runs the suite, and puts the file back (proved by hash).
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { OUT, TOOLS } from './paths.mjs'
import { scratch } from './drive.mjs'

const S = '{{REPO}}/src'
const V = `${S}/shared/validate.ts`, E = `${S}/shared/effort.ts`, REQ = `${S}/main/providers/request.ts`, A = `${S}/main/providers/anthropic.ts`, O = `${S}/main/providers/openai.ts`
const MODELS = `${S}/main/models.ts`, IPC = `${S}/main/ipc.ts`, CHAT = `${S}/main/chat.ts`, PRELOAD = `${S}/preload/index.ts`
const PICKER = `${S}/renderer/src/settings/EffortPicker.tsx`, FORMAT = `${S}/renderer/src/settings/format.ts`

// ---- the plain-Node suite: [file, from, to] (a list of edits where one sabotage needs several) ----
const node = {
  'effort-level-unchecked': [[V, "  if (!match) return { ok: false, error: 'That model does not take that effort level.' }", "  if (false) return { ok: false, error: 'That model does not take that effort level.' }"]],
  'effort-level-from-any-model': [[V, 'const match = model.capabilities.effortLevels.find((candidate) => candidate === level)', 'const match = models.flatMap((m) => m.capabilities.effortLevels).find((candidate) => candidate === level)']],
  'effort-model-case-insensitive': [[V, 'const model = models.find((candidate) => candidate.id === modelId)', 'const model = models.find((candidate) => candidate.id.toLowerCase() === modelId.toLowerCase())']],
  'effort-types-unchecked': [[V, "if (typeof modelId !== 'string' || typeof level !== 'string') {", 'if (false) {']],
  'saved-level-not-checked-against-list': [[E, '  if (entry.capabilities.effortLevels.includes(chosen)) return { effort: chosen, unusable: null }', '  if (true) return { effort: chosen, unusable: null }']],
  'parse-accepts-any-level': [[E, 'if (MODEL_ID.test(modelId) && isEffort(level)) saved.set(modelId, level)', 'if (MODEL_ID.test(modelId)) saved.set(modelId, level as Effort)']],
  'parse-accepts-any-key': [[E, 'if (MODEL_ID.test(modelId) && isEffort(level)) saved.set(modelId, level)', 'if (isEffort(level)) saved.set(modelId, level)']],
  'parse-no-cap': [[E, 'if (saved.size >= MAX_SAVED_EFFORTS) break', '']],
  'parse-array-is-a-map': [[E, "if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return saved", "if (typeof raw !== 'object' || raw === null) return saved"]],
  'levels-not-sorted': [[E, 'return EFFORT_LEVELS.filter((level) => levels.includes(level))', 'return [...levels]']],
  'status-for-a-model-with-no-effort': [[E, 'entry.capabilities.effortLevels.length === 0 || entry.effort === null || effort === null', 'false']],
  'status-selected-is-the-default': [[E, '    selected: effort,', '    selected: entry.effort,']],
  'request-ignores-the-given-effort': [[REQ, 'effort: input.effort === undefined ? model.effort : input.effort,', 'effort: model.effort,']],
  'request-null-becomes-the-default': [[REQ, 'effort: input.effort === undefined ? model.effort : input.effort,', 'effort: input.effort ?? model.effort,']],
  'anthropic-sends-the-registry-effort': [[A, '  const { model } = request\n  const effort = effortOf(request.effort)', '  const { model } = request\n  const effort = effortOf(model.effort)']],
  'anthropic-sends-none': [[A, "  if (effort === 'none') throw new Error('Anthropic has no effort level \"none\"')", '']],
  'openai-sends-the-registry-effort': [[O, "(D-024).\n      ...(request.effort ? { reasoning: { effort: request.effort } } : {}),", "(D-024).\n      ...(model.effort ? { reasoning: { effort: model.effort } } : {}),"]]
}
const dir = join(TOOLS, 'specs71')
mkdirSync(dir, { recursive: true })
for (const [name, edits] of Object.entries(node)) {
  writeFileSync(join(dir, `${name}.json`), JSON.stringify({ label: name, edits: edits.map(([file, from, to]) => ({ file, from, to })), argv: ['{{TOOLS}}/verify-7-1.mjs'], env: {} }, null, 2) + '\n')
}
console.log(`wrote ${Object.keys(node).length} specs in specs71`)

// ---- the real window ----
const winEnv = (name) => ({ USER_DATA_DIR: scratch('s71nc'), WIPE_USER_DATA: '1', MOCK_PORT: '8796', PRESEED_FILE: '', LOG_LABEL: `nc-${name}` })
const winArgv = (script) => ['{{TOOLS}}/run-with-app.mjs', 'dev', script, '{{OUT}}/shots', '9222']
const HANDLER_CHECK = [IPC, 'const check = checkEffortChoice(input, registry.ok ? registry.registry.models : [])', 'const check = { ok: true, ...(input as object) } as never as ReturnType<typeof checkEffortChoice> & { ok: true }']
const SAVE_CHECKS = [
  [MODELS, "  if (!entry) throw new Error('that model is not on offer')", ''],
  [MODELS, '  if (!entry.capabilities.effortLevels.includes(level)) {', '  if (false) {']
]
const win = {
  'w71-handler-check-off-alone': { script: 'verify-7-1w.mjs', edits: [HANDLER_CHECK] },
  'w71-save-checks-off-alone': { script: 'verify-7-1w.mjs', edits: SAVE_CHECKS },
  'w71-every-check-off': { script: 'verify-7-1w.mjs', edits: [HANDLER_CHECK, ...SAVE_CHECKS] },
  'w71-guard-off': { script: 'verify-7-1w.mjs', edits: [[IPC, 'if (!isTrustedSender(event, appUrl)) {', 'if (false && !isTrustedSender(event, appUrl)) {']] },
  'w71-choosing-a-model-drops-the-efforts': { script: 'verify-7-1w.mjs', edits: [[MODELS, '  await writePreferences(modelId, savedEfforts)', '  await writePreferences(modelId, new Map())']] },
  'w71-choosing-an-effort-drops-the-model': { script: 'verify-7-1w.mjs', edits: [[MODELS, '  await writePreferences(savedModelId, next)', '  await writePreferences(null, next)']] },
  'w71-saved-effort-ignored': { script: 'verify-7-1w.mjs', edits: [[MODELS, 'const { effort, unusable } = resolveEffort(entry, savedEfforts)', 'const { effort, unusable } = resolveEffort(entry, new Map())']] },
  'w71-chat-ignores-the-effort': { script: 'verify-7-1w.mjs', edits: [[CHAT, '    const { entry, effort } = model // fixed with the model, for this whole reply (D-024)', '    const { entry } = model\n    const effort = undefined']] },
  'w71-status-says-the-default': { script: 'verify-7-1w.mjs', edits: [[IPC, 'effort: choice.ok ? effortStatusOf(choice.entry, choice.effort) : null', 'effort: choice.ok ? effortStatusOf(choice.entry, choice.entry.effort) : null']] },
  'w71-menu-not-disabled-while-replying': { script: 'verify-7-1w.mjs', edits: [[PICKER, '        disabled={disabled}', '        disabled={false}']] },
  'w71-menu-shown-for-a-model-with-none': { script: 'verify-7-1w.mjs', edits: [[E, 'entry.capabilities.effortLevels.length === 0 || entry.effort === null || effort === null', 'false']] },
  'w71-picker-names-the-wrong-model': { script: 'verify-7-1w.mjs', edits: [[PICKER, 'window.api.settings.setEffort(modelId, level)', "window.api.settings.setEffort('claude-opus-5-5', level)"]] },
  'w71-preload-swaps-the-arguments': { script: 'verify-7-1w.mjs', edits: [[PRELOAD, '      ipcRenderer.invoke(CHANNELS.settingsSetEffort, { modelId, level })', '      ipcRenderer.invoke(CHANNELS.settingsSetEffort, { modelId: level, level: modelId })']] },
  'w71-default-not-marked': { script: 'verify-7-1w.mjs', edits: [[FORMAT, "  if (level === effort.default) notes.push('default')", '']] },
  'w71-no-queue': { script: 'verify-7-1w.mjs', edits: [[MODELS, '  const run = queue.then(task)', '  const run = task()']] }
}
// the seeded launches: the same suite as run71.mjs, on one seed file each
// The seeds are always rewritten first: a manifest left over from an older make-seeds-71.mjs carried no `keysAfter`, which made every
// seeded sabotage "fail" the check that compares against it (a wrong detection, found 2026-10-02).
const manifestFile = join(OUT, 'seeds71', 'manifest.json')
const made = spawnSync(process.execPath, [join(TOOLS, 'make-seeds-71.mjs')], { encoding: 'utf8' })
if (made.status !== 0 || !existsSync(manifestFile)) throw new Error('make-seeds-71.mjs failed: ' + (made.stderr || made.stdout))
const seeds = Object.fromEntries(JSON.parse(readFileSync(manifestFile, 'utf8')).map((m) => [m.name, m]))
if (Object.values(seeds).some((m) => !('keysAfter' in m))) throw new Error('the seed manifest has no keysAfter: make-seeds-71.mjs is out of date')
const seedEnv = (m) => ({ USER_DATA_DIR: scratch('s71seednc'), WIPE_USER_DATA: '1', MOCK_PORT: '8796', PRESEED_FILE: m.file, SEED_NAME: m.name, SEED_SHA: m.sha, EXPECT_MODEL: m.expectModel, EXPECT_EFFORT: String(m.expectEffort), WARN_LEVEL: m.warn ?? '', SAVED_MODEL: m.savedModel ?? '', KEYS_AFTER: JSON.stringify(m.keysAfter), LOG_LABEL: `nc-${m.name}` })
const seedSpecs = {
  'w71c-warns-every-time': { seed: 'eff-level-not-offered', edits: [[MODELS, 'if (unusable !== null && !warnedEfforts.has(`${entry.id}/${unusable}`)) {', 'if (unusable !== null) {']] },
  'w71c-array-is-a-map': { seed: 'eff-not-a-map', edits: [[E, "if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return saved", "if (typeof raw !== 'object' || raw === null) return saved"]] },
  'w71c-no-cap': { seed: 'eff-thousands-of-entries', edits: [[E, 'if (saved.size >= MAX_SAVED_EFFORTS) break', '']] },
  'w71c-any-key': { seed: 'eff-proto-keys', edits: [[E, 'if (MODEL_ID.test(modelId) && isEffort(level)) saved.set(modelId, level)', 'if (isEffort(level)) saved.set(modelId, level)']] },
  'w71c-any-level': { seed: 'eff-bad-values-keep-model', edits: [[E, 'if (MODEL_ID.test(modelId) && isEffort(level)) saved.set(modelId, level)', 'if (MODEL_ID.test(modelId)) saved.set(modelId, level as Effort)']] },
  'w71c-stale-level-used': { seed: 'eff-level-not-offered', edits: [[E, '  if (entry.capabilities.effortLevels.includes(chosen)) return { effort: chosen, unusable: null }', '  if (true) return { effort: chosen, unusable: null }']] }
}
const wdir = join(TOOLS, 'specs71w')
mkdirSync(wdir, { recursive: true })
for (const [name, { script, edits }] of Object.entries(win)) {
  writeFileSync(join(wdir, `${name}.json`), JSON.stringify({ label: name, edits: edits.map(([file, from, to]) => ({ file, from, to })), argv: winArgv(script), env: winEnv(name) }, null, 2) + '\n')
}
for (const [name, { seed, edits }] of Object.entries(seedSpecs)) {
  writeFileSync(join(wdir, `${name}.json`), JSON.stringify({ label: name, edits: edits.map(([file, from, to]) => ({ file, from, to })), argv: winArgv('verify-7-1c.mjs'), env: seedEnv(seeds[seed]) }, null, 2) + '\n')
}
console.log(`wrote ${Object.keys(win).length + Object.keys(seedSpecs).length} specs in specs71w`)
