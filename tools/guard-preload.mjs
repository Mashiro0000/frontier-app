// Loaded first (node --import) into a check that tools/guarded.mjs starts: confines the process to the one folder guarded.mjs made for the run (D-043, tools/fsguard.mjs).
import { installFsGuard } from './fsguard.mjs'

const root = process.env.FRONTIER_GUARD_ROOT
if (root === undefined || root === '') {
  console.error('guard-preload.mjs: FRONTIER_GUARD_ROOT is not set; this file is only loaded by tools/guarded.mjs.')
  process.exit(4)
}
installFsGuard({ write: [root], remove: [root] })
