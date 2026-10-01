// One launch of one suite on its own scratch profile: for re-running a single failed launch of a regression.
// usage: node tools/run-one.mjs <label> <dev|preview> <script[,script...]> [KEY=VALUE ...]
// The KEY=VALUE pairs are the environment of the launch (USER_DATA_DIR=<scratch name> is taken as a name: it becomes the
// scratch profile folder, wiped first unless WIPE_USER_DATA=0). Typical: MOCK_PORT=8790 INSPECT_PORT=9230.
import { runApp, scratch } from './drive.mjs'

const [label, mode, scripts, ...pairs] = process.argv.slice(2)
if (!label || !['dev', 'preview'].includes(mode) || !scripts) {
  console.error('usage: node tools/run-one.mjs <label> <dev|preview> <script[,script...]> [KEY=VALUE ...]')
  process.exit(2)
}
const env = { WIPE_USER_DATA: '1' }
for (const pair of pairs) {
  const at = pair.indexOf('=')
  env[pair.slice(0, at)] = pair.slice(at + 1)
}
env.USER_DATA_DIR = scratch(env.USER_DATA_DIR ?? `one-${label}`)
const r = runApp({ label, mode, scripts, env })
process.exit(r.ok ? 0 : 1)
