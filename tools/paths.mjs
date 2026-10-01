// Where things are, derived from this file's own location, so the check scripts work wherever the repo is cloned.
//   REPO      A:/frontier-app            (forward slashes: fine for Node and for file paths on Windows)
//   REPO_URL  file:///A:/frontier-app    (for import())
//   REPO_WIN  A:\frontier-app            (backslashes: for cmd.exe and for the registry scenarios)
//   TOOLS     this folder (scripts and fixtures that are committed)
//   OUT       tools/.out: everything a run produces (app logs, outputs, screenshots, generated seed files). Not committed.
import { mkdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

export const TOOLS = dirname(fileURLToPath(import.meta.url))
export const REPO_WIN = resolve(TOOLS, '..')
export const REPO = REPO_WIN.replaceAll('\\', '/')
export const REPO_URL = pathToFileURL(REPO_WIN).href
export const OUT = join(TOOLS, '.out')
export const SHOTS = join(OUT, 'shots')
mkdirSync(SHOTS, { recursive: true })
