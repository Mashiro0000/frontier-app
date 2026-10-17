// usage: node tools/guarded-window-copy.mjs tools/run186.mjs [dev|preview]
// Slice 18.6 (D-050), in the real window: Settings > Updates against the stand-in for GitHub's downloads, with a release key made for this run (its public half goes to the
// app as FRONTIER_UPDATE_KEY, read only when running from source; the private half to the suite) and the system's message box stood in for (verify-18-6w.mjs).
// It must be started through tools/guarded-window-copy.mjs. For the built app: node tools/guarded-window-copy.mjs tools/with-build.mjs tools/run186.mjs preview
import { runApp, scratch } from './drive.mjs'
import { newKeyPair } from './release-lib.mjs'

const mode = process.argv[2] ?? 'dev'
const tag = mode === 'preview' ? 'p-' : 'd-'
const run = process.env.FRONTIER_GUARD_ROOT
if (!run || !/^C:\\frontier-tmp\\guarded-w-[^\\]+$/i.test(run)) {
  console.error('run186.mjs must be started as: node tools/guarded-window-copy.mjs tools/run186.mjs (the run needs its own folder in C:\\frontier-tmp)')
  process.exit(2)
}
const keys = newKeyPair()
const UPDATE_PORT = '8821'
const result = runApp({
  label: `${tag}w186`,
  mode,
  scripts: 'verify-18-6w.mjs',
  env: {
    USER_DATA_DIR: scratch('s186'),
    WIPE_USER_DATA: '1',
    INSPECT_PORT: '9239',
    MOCK_PORT: '8822',
    UPDATE_PORT,
    FRONTIER_UPDATE_URL: `http://127.0.0.1:${UPDATE_PORT}`,
    FRONTIER_UPDATE_KEY: keys.publicBase64,
    UPDATE_TEST_PRIVATE_PEM: keys.privateKey.export({ format: 'pem', type: 'pkcs8' }).toString()
  },
  timeoutMs: 600000
})
console.log(`${result.passed}/${result.total} checks passed`)
for (const f of result.fails) console.log(String(f).trim())
process.exit(result.ok ? 0 : 1)
