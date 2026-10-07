// Runs the 9.1 checks that need Electron's real image tools (verify-9-1-images.cjs): bundles the modules under test with esbuild (the app's own build
// tool, already installed), then starts Electron with no window on a scratch profile and relays its PASS/FAIL lines. Exit code 0 only if all passed.
// usage: node tools/run91.mjs
import { build } from 'esbuild'
import { spawnSync } from 'node:child_process'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { OUT, REPO, TOOLS } from './paths.mjs'
import { scratch } from './drive.mjs'

const entry = join(OUT, 'v91-entry.ts')
const bundle = join(OUT, 'v91-bundle.cjs')
mkdirSync(OUT, { recursive: true })
writeFileSync(entry, [
  `export { electronImageTools } from '${REPO}/src/main/attachmentImages'`,
  `export { prepare, createAttachmentStore, readLocalFile } from '${REPO}/src/main/attachmentStore'`,
  `export { stripMetadata, imageHeader, orientBitmap } from '${REPO}/src/main/attachmentFormats'`
].join('\n'))
await build({ entryPoints: [entry], bundle: true, platform: 'node', format: 'cjs', external: ['electron'], outfile: bundle, logLevel: 'error' })
const profile = scratch('v91-images')
rmSync(profile, { recursive: true, force: true })
const electron = createRequire(import.meta.url)('electron')
const run = spawnSync(electron, [join(TOOLS, 'verify-9-1-images.cjs'), `--user-data-dir=${profile}`], {
  encoding: 'utf8',
  timeout: 180000,
  env: { ...process.env, V91_BUNDLE: bundle, ELECTRON_ENABLE_LOGGING: '' }
})
const out = (run.stdout ?? '') + (run.stderr ?? '')
const lines = out.split('\n').filter((l) => /^(PASS|FAIL)|checks passed/.test(l))
console.log(lines.join('\n'))
if (!lines.some((l) => /checks passed/.test(l))) console.log(`no summary line (exit ${run.status}):\n${out.slice(-2000)}`)
rmSync(profile, { recursive: true, force: true })
process.exit(run.status === 0 && lines.some((l) => /checks passed/.test(l)) ? 0 : 1)
