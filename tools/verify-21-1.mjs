// Stage 21.1 (D-053), the model chooser's cost badge, under plain Node: the four steps and their edges, a price that cannot be read, the words, how a price
// per million tokens is written, and the step of every model the registry offers today (so a price change that moves a model is seen here first).
// usage: node tools/verify-21-1.mjs
import './ts-resolve.mjs'
import { readFileSync } from 'node:fs'
import { checker } from './cdp.mjs'
import { REPO, REPO_URL } from './paths.mjs'

const { costTier, costTierBadge, costTierWords, perMillion, COST_TIER_CEILINGS } = await import(`${REPO_URL}/src/shared/costTier.ts`)
const check = checker()
const p = (out) => ({ inputPerMTok: 1, cacheReadPerMTok: 0.1, cacheWritePerMTok: 1.25, outputPerMTok: out })

check('A: the ceilings are $1, $5 and $15 a million output tokens', JSON.stringify(COST_TIER_CEILINGS) === '[1,5,15]')
const edges = [[0, 1], [0.5, 1], [1, 1], [1.01, 2], [5, 2], [5.01, 3], [15, 3], [15.01, 4], [50, 4], [1e6, 4]]
for (const [out, want] of edges) check(`A: $${out} a million output tokens is step ${want}`, costTier(p(out)) === want, String(costTier(p(out))))
for (const bad of [NaN, Infinity, -1, -0.01]) check(`A: a price that cannot be read (${bad}) is shown as the dearest, never as cheap`, costTier(p(bad)) === 4)
check('A: only the output price decides (a dear input with a cheap output is still step 1)', costTier({ ...p(0.5), inputPerMTok: 100 }) === 1)

check('B: the badges are $ to $$$$', [1, 2, 3, 4].map(costTierBadge).join(' ') === '$ $$ $$$ $$$$')
check('B: the words', [1, 2, 3, 4].map(costTierWords).join('|') === 'Cheapest|Low cost|Mid cost|High cost')

const written = [[0.1, '$0.10'], [0.125, '$0.13'], [2, '$2'], [12.5, '$12.50'], [0, '$0'], [3.75, '$3.75'], [NaN, '?'], [-1, '?']]
for (const [usd, want] of written) check(`C: ${usd} per million is written "${want}"`, perMillion(usd) === want, perMillion(usd))

// The registry as it is today: every model has a step, and the cheapest and the dearest are where the prices put them.
const registry = JSON.parse(readFileSync(`${REPO}/registry/models.json`, 'utf8'))
const steps = Object.fromEntries(registry.models.map((m) => [m.id, costTier(m.pricing)]))
console.log('steps today:', JSON.stringify(steps))
check('D: every model of the registry has a step from 1 to 4', registry.models.length > 0 && registry.models.every((m) => [1, 2, 3, 4].includes(steps[m.id])))
const cheapest = registry.models.reduce((a, b) => (a.pricing.outputPerMTok <= b.pricing.outputPerMTok ? a : b))
const dearest = registry.models.reduce((a, b) => (a.pricing.outputPerMTok >= b.pricing.outputPerMTok ? a : b))
check('D: no model is in a lower step than a cheaper one (the steps follow the prices)', registry.models.every((a) => registry.models.every((b) => a.pricing.outputPerMTok <= b.pricing.outputPerMTok ? steps[a.id] <= steps[b.id] : true)))
check(`D: the cheapest model (${cheapest.id}) is in the lowest step used, the dearest (${dearest.id}) in the highest`, steps[cheapest.id] === Math.min(...Object.values(steps)) && steps[dearest.id] === Math.max(...Object.values(steps)))

// Source checks: the chooser reads the step from the shared module, and the menu opens it on a mouse press, not on the keyboard.
const chooser = readFileSync(`${REPO}/src/renderer/src/settings/ModelChooser.tsx`, 'utf8')
const picker = readFileSync(`${REPO}/src/renderer/src/settings/ModelPicker.tsx`, 'utf8')
check('E: the chooser takes the step from shared/costTier (one rule for the badge and the filter)', /from '\.\.\/\.\.\/\.\.\/shared\/costTier'/.test(chooser) && (chooser.match(/costTier\(model\.pricing\)/g) ?? []).length === 2)
check('E: the menu opens the chooser on a left mouse press only, and not while a reply arrives', /onMouseDown=/.test(picker) && /event\.button !== 0/.test(picker) && /if \(!disabled\) setChooserOpen\(true\)/.test(picker) && /open=\{chooserOpen && !disabled\}/.test(picker))
check('E: the menu stays a <select> with its change handler (the keyboard and the checks of earlier stages use it)', /<select\s+(?:hidden=\{auto\}\s+)?className="header-select"/.test(picker) && /onChange=\{\(event\) => void choose\(event\.target\.value\)\}/.test(picker))

process.exit(check.summary() ? 0 : 1)
