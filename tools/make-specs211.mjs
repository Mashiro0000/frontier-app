// Writes the negative-control specs for Stage 21.1 (D-053, the model chooser): one sabotage each, which verify-21-1w.mjs (window) or verify-21-1.mjs (Node)
// must notice.
// usage: node tools/make-specs211.mjs
//   then: node tools/guarded-window-copy.mjs tools/nc-all.mjs specs211w <names...>     (the real window: one window per sabotage)
//         node tools/nc-all.mjs specs211 <names...>                                     (plain Node)
// Each spec backs up the file, applies its sabotage, runs the suite, and puts the file back (proved by hash).
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { TOOLS } from './paths.mjs'
import { scratch } from './drive.mjs'

const P = '{{REPO}}/src/renderer/src/'
const PICKER = P + 'settings/ModelPicker.tsx', CHOOSER = P + 'settings/ModelChooser.tsx'
const TIER = '{{REPO}}/src/shared/costTier.ts'

const win = {
  // a click opens the plain list again, not the chooser
  'w211-click-opens-list': [[PICKER, '          event.preventDefault()\n          if (!disabled) setChooserOpen(true)', '          void event']],
  // the badge reads the input price, not the output price
  'w211-badge-from-input': [[TIER, '  const out = pricing.outputPerMTok', '  const out = pricing.inputPerMTok']],
  // the maker filter is ignored
  'w211-maker-filter-ignored': [[CHOOSER, '(maker === null || model.provider === maker) &&', 'true &&']],
  // every card says "No key"
  'w211-no-key-everywhere': [[CHOOSER, '{!hasKey && <span', '{true && <span']],
  // choosing a card only closes the dialog
  'w211-choose-does-nothing': [[PICKER, '          if (modelId !== shown) void choose(modelId)', '']],
  // the search looks only in the name
  'w211-search-name-only': [[CHOOSER, '  `${model.label} ${providerName(status, model.provider)} ${model.id} ${model.description}`.toLowerCase()', '  `${model.label}`.toLowerCase()']],
  // the list keeps two columns in a narrow window, and scrolls sideways
  'w211-narrow-two-columns': [[P + 'assets/main.css', '  grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));', '  grid-template-columns: repeat(2, 320px);']]
}
const node = {
  // a price that cannot be read is shown as the cheapest
  'n211-nan-is-cheap': [[TIER, '  if (!Number.isFinite(out) || out < 0) return 4', '  if (!Number.isFinite(out) || out < 0) return 1']],
  // the $5 ceiling is moved
  'n211-ceiling-moved': [[TIER, 'export const COST_TIER_CEILINGS: readonly [number, number, number] = [1, 5, 15]', 'export const COST_TIER_CEILINGS: readonly [number, number, number] = [1, 4, 15]']]
}

const winEnv = (name) => ({ USER_DATA_DIR: scratch('s211nc'), WIPE_USER_DATA: '1', MOCK_PORT: '8851', PRESEED_FILE: '', LOG_LABEL: `nc-${name}` })
const winArgv = ['{{TOOLS}}/run-with-app.mjs', 'dev', 'setup-key.mjs,verify-21-1w.mjs', '{{OUT}}/shots', '9222']
const wdir = join(TOOLS, 'specs211w')
mkdirSync(wdir, { recursive: true })
for (const [name, edits] of Object.entries(win)) {
  writeFileSync(join(wdir, `${name}.json`), JSON.stringify({ label: name, edits: edits.map(([file, from, to]) => ({ file, from, to })), argv: winArgv, env: winEnv(name) }, null, 2) + '\n')
}
const ndir = join(TOOLS, 'specs211')
mkdirSync(ndir, { recursive: true })
for (const [name, edits] of Object.entries(node)) {
  writeFileSync(join(ndir, `${name}.json`), JSON.stringify({ label: name, edits: edits.map(([file, from, to]) => ({ file, from, to })), argv: ['{{TOOLS}}/verify-21-1.mjs'], env: {} }, null, 2) + '\n')
}
console.log(`wrote ${Object.keys(win).length} specs in specs211w and ${Object.keys(node).length} in specs211`)
