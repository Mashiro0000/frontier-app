// usage: node tools/guarded-window-copy.mjs tools/with-build.mjs tools/run156.mjs preview
// Builds the app INSIDE the run's copy of the tree (the copy has no `out` folder), then runs one launcher on the built app. regress.mjs does the same for its whole built-app part;
// this is for one suite. It must be started through tools/guarded-window-copy.mjs, which sets the copy as the working folder.
import { spawnSync } from 'node:child_process'
import { REPO_WIN } from './paths.mjs'

const [script, ...args] = process.argv.slice(2)
if (!script) {
  console.error('usage: node tools/guarded-window-copy.mjs tools/with-build.mjs tools/runNNN.mjs preview')
  process.exit(2)
}
const build = spawnSync('cmd.exe', ['/c', 'npx electron-vite build'], { cwd: REPO_WIN, encoding: 'utf8', timeout: 600000 })
console.log(`electron-vite build (exit ${build.status})`)
if (build.status !== 0) {
  console.error(String(build.stdout) + String(build.stderr))
  process.exit(1)
}
const run = spawnSync(process.execPath, [script, ...args], { cwd: REPO_WIN, stdio: 'inherit', env: process.env })
process.exit(run.status ?? 1)
