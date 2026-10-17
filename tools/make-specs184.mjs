// Writes the negative-control specs for slices 18.4 and 18.5 (the update check, the download and the service, D-050): one sabotage each, which verify-18-4.mjs must notice.
// usage: node tools/make-specs184.mjs   then: node tools/nc-all.mjs specs184 <names...>
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { TOOLS } from './paths.mjs'

const SV = '{{REPO}}/src/main/updateService.ts'
const FE = '{{REPO}}/src/main/updateFetch.ts'

// name: [file, from, to]
const controls = {
  onWithoutQuestion: [SV, 'const answer = await gate.ask(owner, updatesOnQuestion(options.repo))', "const answer = 'yes' as string"],
  checksWhileOff: [SV, 'if (before.problem !== null || !before.settings.on || !hasKey) return', 'if (before.problem !== null || !hasKey) return'],
  moreThanDaily: [SV, 'now() - last < UPDATE_LIMITS.intervalMs', 'now() - last < 0'],
  notNowForgotten: [SV, 'latest.settings.declined !== available.version', 'true'],
  noTakenAsYes: [SV, "    if (answer !== 'yes') {\n      if (answer === 'no') {", "    if (answer !== 'yes' && answer !== 'no') {\n      if (answer === 'no') {"],
  runsFromSource: [SV, '    if (!options.installed) return { ok: false, error: UPDATE_WORDS.notInstalled }', '    if (false) return { ok: false, error: UPDATE_WORDS.notInstalled }'],
  noKeyAsks: [SV, "        if (!hasKey) return { ok: false, error: UPDATE_WORDS.noKey }\n        const answer", '        const answer'],
  checkNowWhileOff: [SV, '      if (!chosen.on) return { ok: false, error: UPDATE_WORDS.off }\n      if (busy !== null)', '      if (busy !== null)'],
  redirectsUnchecked: [FE, '    if (!rules.allowed(url))', '    if (hop === 0 && !rules.allowed(url))'],
  redirectsFollowedByFetch: [FE, "redirect: 'manual',", "redirect: 'follow',"],
  aHeaderAdded: [FE, "credentials: 'omit'", "credentials: 'omit',\n        headers: { 'x-frontier-app': 'frontier-app' }"],
  smallUncapped: [FE, '      if (total > maxBytes) {', '      if (total > maxBytes * 1000) {'],
  installerUncapped: [FE, '      if (total > expected.size) {', '      if (total > expected.size * 10) {'],
  checksumIgnored: [FE, "    if (hash.digest('hex') !== expected.sha256)", '    if (false)'],
  noClock: [FE, '  const timer = setTimeout(() => controller.abort(), rules.timeoutMs)', '  const timer = setTimeout(() => undefined, rules.timeoutMs)'],
  declaredLengthIgnored: [FE, '    if (Number.isFinite(declared) && declared !== expected.size) {', '    if (false) {']
}

mkdirSync(join(TOOLS, 'specs184'), { recursive: true })
for (const [name, [file, from, to]] of Object.entries(controls)) {
  const spec = { label: `n184-${name}`, edits: [{ file, from, to }], argv: ['{{TOOLS}}/guarded.mjs', '{{TOOLS}}/verify-18-4.mjs'], env: {}, timeoutMs: 240000 }
  writeFileSync(join(TOOLS, 'specs184', `n184-${name}.json`), JSON.stringify(spec, null, 2) + '\n')
}
console.log(`wrote ${Object.keys(controls).length} specs in specs184`)
