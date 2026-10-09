// The checks' scratch files go to the repo's own drive, not to %TEMP% on C: (the owner's C: is short of space; 2026-10-09).
// Importing this module points TEMP and TMP of this process, and of every child it starts, at <drive of the repo>\frontier-tmp,
// so os.tmpdir() (read at call time) answers there. Nothing here touches the app or its data folder.
// FRONTIER_KEEP_TEMP=1 leaves the temp folder alone (a check that needs C: itself).
import { mkdirSync } from 'node:fs'
import { join, parse } from 'node:path'
import { fileURLToPath } from 'node:url'

// the system's own temp folder, as it was before this module changed it (a suite that needs a C: volume feature uses it)
// (children inherit it in FRONTIER_SYSTEM_TEMP, since their own TEMP is already the redirected one)
export const SYSTEM_TEMP = process.env.FRONTIER_SYSTEM_TEMP ?? process.env.TEMP ?? process.env.TMP ?? ''
process.env.FRONTIER_SYSTEM_TEMP = SYSTEM_TEMP
export const TEMP_ROOT = join(parse(fileURLToPath(import.meta.url)).root, 'frontier-tmp')
if (!process.env.FRONTIER_KEEP_TEMP) {
  try {
    mkdirSync(TEMP_ROOT, { recursive: true })
    process.env.TEMP = TEMP_ROOT
    process.env.TMP = TEMP_ROOT
  } catch {
    /* no such drive or not writable: keep the system's temp folder */
  }
}
