// Runs some of the window launchers again, on the dev app or on the BUILT app, as the regression does (a launcher is one of the run*.mjs of tools/): for the few runs of a regression that
// were not clean, once the suite was put right. Start it through the wrapper so that it works in a copy of the tree with its own folder:
//   node tools/guarded-window-copy.mjs tools/regress-some.mjs dev run74.mjs run82.mjs
//   node tools/guarded-window-copy.mjs tools/regress-some.mjs preview run82.mjs      (the built app: `npx electron-vite build` is run first, in the copy)
import { spawnSync } from 'node:child_process'
import { join } from 'node:path'
import { REPO_WIN } from './paths.mjs'
import { here } from './drive.mjs'

const [mode, ...launchers] = process.argv.slice(2)
if (!['dev', 'preview'].includes(mode) || launchers.length === 0 || launchers.some((l) => !/^run[0-9a-z]+\.mjs$/.test(l))) {
  console.error('usage: node tools/guarded-window-copy.mjs tools/regress-some.mjs <dev|preview> run74.mjs [run82.mjs ...]')
  process.exit(2)
}
let all = true
if (mode === 'preview') {
  const build = spawnSync('cmd.exe', ['/c', 'npx electron-vite build'], { cwd: REPO_WIN, encoding: 'utf8', timeout: 600000 })
  const ok = build.status === 0
  all &&= ok
  console.log(`${ok ? 'OK  ' : 'BAD '} electron-vite build (exit ${build.status})`)
}
for (const launcher of launchers) {
  const r = spawnSync(process.execPath, [join(here, launcher), mode], { encoding: 'utf8', timeout: 900000, env: { ...process.env, NODE_NO_WARNINGS: '1' } })
  const out = (r.stdout ?? '') + (r.stderr ?? '')
  const total = out.match(/(\d+\/\d+ checks passed|CRASHED[^\n]*)/g)?.at(-1) ?? 'no summary'
  all &&= r.status === 0
  console.log(`${r.status === 0 ? 'OK  ' : 'BAD '} ${mode} ${launcher.padEnd(14)} ${total}`)
  if (r.status !== 0) for (const l of out.split('\n').filter((x) => /^(FAIL|ABORT|!!|BAD)/.test(x)).slice(0, 6)) console.log('       ' + l.slice(0, 220))
}
process.exit(all ? 0 : 1)
