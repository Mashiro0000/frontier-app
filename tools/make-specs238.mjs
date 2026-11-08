// Writes the negative-control specs for Stage 23.8 (D-055, reordering): one sabotage each, which verify-23-8 (Node) or verify-23-8w (window) must notice.
// usage: node tools/make-specs238.mjs
//   then: NC_GUARDED=1 node tools/nc-all.mjs specs238 <names...>
//         node tools/guarded-window-copy.mjs tools/nc-all.mjs specs238w <names...>
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { TOOLS } from './paths.mjs'
import { scratch } from './drive.mjs'

const S = '{{REPO}}/src/'
const ORDER = S + 'shared/order.ts', ROW = S + 'renderer/src/reorder.ts', SIDEBAR = S + 'renderer/src/sidebar/Sidebar.tsx'

const nodeSpecs = {
  'n238-past-the-end': [[ORDER, 'to < 0 || to >= list.length)', 'to < 0 || to > list.length)']],
  'n238-fractions': [[ORDER, "typeof to !== 'number' || !Number.isInteger(to) ||", "typeof to !== 'number' ||"]],
  'n238-repeats-kept': [[ORDER, ' && saved.indexOf(id) === i', '']],
  'n238-swaps-not-moves': [[ORDER, '  next.splice(to, 0, item)', '  next.splice(to, 0, item)\n  if (Math.abs(to - from) > 1) next.reverse()']]
}
const windowSpecs = {
  'w238-no-keys': [[ROW, "      if (!event.altKey || (event.key !== 'ArrowUp' && event.key !== 'ArrowDown')) return", '      return']],
  'w238-drop-ignored': [[ROW, '      onMove(moved, index)', '      void moved']],
  'w238-focus-lost': [[ROW, "        ;(row?.matches('button') ? row : row?.querySelector<HTMLElement>('button'))?.focus()", '        void row']],
  'w238-order-not-kept': [[SIDEBAR, '    savePageOrder(next)', '    void savePageOrder']]
}

const write = (dir, specs, make) => {
  const full = join(TOOLS, dir)
  mkdirSync(full, { recursive: true })
  for (const [name, edits] of Object.entries(specs)) {
    writeFileSync(join(full, `${name}.json`), JSON.stringify({ label: name, edits: edits.map(([file, from, to]) => ({ file, from, to })), ...make(name) }, null, 2) + '\n')
  }
  console.log(`wrote ${Object.keys(specs).length} specs in ${dir}`)
}
write('specs238', nodeSpecs, () => ({ argv: ['{{TOOLS}}/verify-23-8.mjs'], env: {} }))
const RETIRED_W = { 'w238-focus-lost': 'the code it took out is gone: it was not needed (23.8 found the keyboard stays on the moved row by itself, React moves the node)' }
write('specs238w', windowSpecs, (name) => ({
  ...(RETIRED_W[name] ? { retired: RETIRED_W[name] } : {}),
  argv: ['{{TOOLS}}/run-with-app.mjs', 'dev', 'setup-key.mjs,verify-23-8w.mjs', '{{OUT}}/shots', '9222'],
  env: { USER_DATA_DIR: scratch('specs238wnc'), WIPE_USER_DATA: '1', MOCK_PORT: '8869', PRESEED_FILE: '', LOG_LABEL: `nc-${name}` }
}))
