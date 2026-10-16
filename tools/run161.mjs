// usage: node tools/guarded-window-copy.mjs tools/run161.mjs [mode=dev]
// Slice 16.1 (D-048), the window half of the probe (probe-16-1.mjs): pictures as data: in the real window, what the page's policy refuses, the baseline of the bridge.
import { runApp, scratch } from './drive.mjs'

const mode = process.argv[2] ?? 'dev'
const tag = mode === 'preview' ? 'p-' : 'd-'
const run = process.env.FRONTIER_GUARD_ROOT
if (!run || !/^C:\\frontier-tmp\\guarded-w-[^\\]+$/i.test(run)) {
  console.error('run161.mjs must be started as: node tools/guarded-window-copy.mjs tools/run161.mjs')
  process.exit(2)
}
const result = runApp({
  label: `${tag}w161`,
  mode,
  scripts: 'probe-16-1.mjs',
  env: { USER_DATA_DIR: scratch('s161'), WIPE_USER_DATA: '1' },
  timeoutMs: 300000
})
console.log(`${result.passed}/${result.total} checks passed`)
for (const f of result.fails) console.log(String(f).trim())
process.exit(result.ok ? 0 : 1)
