// Loaded first (NODE_OPTIONS=--import=<this file>, set by tools/guarded-window.mjs) into every Node process of a WINDOW run (the regression driver, the launchers, the checks, the
// build tools), so that the owner's two permissions of 2026-10-09 hold in code (D-044). A process of the run may REMOVE only:
//   (1) what lies inside the run's own folder, C:\frontier-tmp\guarded-w-<random>, which guarded-window.mjs made (every temp folder of the run is in it: TEMP points there);
//   (2) throwaway profile folders named frontier-app-test-scratch-<name> directly inside the Roaming folder (%APPDATA%): never the real profile `frontier-app`, never any other folder
//       there (the old ones stay unless a check reuses a name);
//   (3) the generated build folder `out` of the repo this file lies in (electron-vite empties and rewrites it).
// Anything else a process of the run tries to remove is refused with error.code EFSGUARD, and every refusal is named on stderr when the process ends. WRITING is not restricted here (the
// app and the tools write their logs, profiles and build output): only removing is. Electron's own processes ignore NODE_OPTIONS' --import, so the app's own removals inside its throwaway
// profile are not watched by this: they lie in a folder permission (2) covers.
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { installFsGuard } from './fsguard.mjs'

const repo = dirname(dirname(fileURLToPath(import.meta.url)))
const appData = process.env.APPDATA
const run = process.env.FRONTIER_GUARD_ROOT
if (appData === undefined || appData === '' || run === undefined || run === '') {
  console.error('harness-guard-preload.mjs: %APPDATA% or FRONTIER_GUARD_ROOT is not set; this file is only loaded by tools/guarded-window.mjs.')
  process.exit(4)
}
const guard = installFsGuard({
  writeAnywhere: true,
  remove: [run, join(repo, 'out')],
  removePatterns: [{ base: appData, name: /^frontier-app-test-scratch-[A-Za-z0-9._-]+$/i }]
})
process.on('exit', () => {
  if (guard.refusals.length === 0) return
  const seen = [...new Set(guard.refusals.map((r) => `${r.name}: ${r.reason}`))].slice(0, 12)
  console.error(`[harness-guard] refused ${guard.refusals.length} call(s) that would remove something outside the permission:\n  ${seen.join('\n  ')}`)
})
