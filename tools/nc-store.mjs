// Negative controls for the credential store suite (verify-5-3-store.mjs), outside the project on purpose: apply ONE sabotage to
// src/main/credentialStore.ts at a time, run the suite, require that it now FAILS, restore the file and compare hashes.
import { REPO } from './paths.mjs'
import { copyFileSync, readFileSync, writeFileSync, mkdtempSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { tmpdir } from 'node:os'

const here = dirname(fileURLToPath(import.meta.url))
const FILE = `${REPO}/src/main/credentialStore.ts`
const sha = (p) => createHash('sha256').update(readFileSync(p)).digest('hex').slice(0, 16)
const backup = join(mkdtempSync(join(tmpdir(), 'nc-store-')), 'credentialStore.ts')

const sabotages = [
  ['a file for another provider is accepted (no tie to the provider)', "      stored.version === 2 &&\n      stored.provider === provider\n", "      stored.version === 2\n"],
  ['the old file is not deleted after a save', "        if (provider === 'anthropic')\n          await fs.rm(legacyFile, { force: true }).catch(() => undefined)", "        if (false)\n          await fs.rm(legacyFile, { force: true }).catch(() => undefined)"],
  ['Remove leaves the old file behind', "const files = provider === 'anthropic' ? [fileOf(provider), legacyFile] : [fileOf(provider)]", "const files = [fileOf(provider)]"],
  ['"Saved" is said without reading the key back', "if ((await readNow(provider)) !== key)\n          throw new Error('the saved key could not be read back')", "if (false)\n          throw new Error('the saved key could not be read back')"],
  ['a provider that is not on the list is accepted by read', "  async function readNow(provider: ProviderId): Promise<string | null> {\n    assertProvider(provider)", "  async function readNow(provider: ProviderId): Promise<string | null> {"],
  ['a file of any size is read', "if ((await fs.stat(path)).size > MAX_FILE_BYTES) return null", "if (false) return null"],
  ['operations are not put in order', "    const run = queue.then(task)", "    const run = task()"],
  ['Remove does not check that the files are gone', "if (still) throw new Error('the key file could not be deleted')", "if (false) throw new Error('the key file could not be deleted')"],
  ['the old file is read for every provider, not just Anthropic', "    if (provider === 'anthropic') {\n      const legacy", "    if (true) {\n      const legacy"],
  ['a key that cannot be decrypted throws instead of reading as nothing', "      return box.decrypt(Buffer.from(encoded, 'base64'))\n    } catch {\n      return null // saved under another account", "      return box.decrypt(Buffer.from(encoded, 'base64'))\n    } catch (error) {\n      throw error // saved under another account"],
  ['no secure storage: a key is saved anyway', "        if (!box.isAvailable()) throw new Error('this computer has no secure storage for the key')", "        if (false) throw new Error('this computer has no secure storage for the key')"],
  ['the key is written to a temp file and renamed over the real one (D-010: fails in the EFS folder)', "await fs.writeFile(fileOf(provider), JSON.stringify(contents), { mode: 0o600 })", "await fs.writeFile(fileOf(provider) + '.tmp', JSON.stringify(contents), { mode: 0o600 })\n        await fs.rename(fileOf(provider) + '.tmp', fileOf(provider))"]
]

copyFileSync(FILE, backup)
const before = sha(FILE)
let caught = 0
for (const [name, from, to] of sabotages) {
  const text = readFileSync(FILE, 'utf8')
  if (text.split(from).length - 1 !== 1) { copyFileSync(backup, FILE); console.log(`ABORT  ${name}: pattern not found exactly once`); process.exit(2) }
  writeFileSync(FILE, text.replace(from, () => to))
  let verdict
  try {
    const run = spawnSync(process.execPath, [join(here, 'verify-5-3-store.mjs')], { env: { ...process.env, NODE_NO_WARNINGS: '1' }, encoding: 'utf8', timeout: 150000 })
    const out = (run.stdout ?? '') + (run.stderr ?? '')
    const failing = out.split('\n').filter((l) => /^FAIL/.test(l))
    const onlyEfs = failing.length > 0 && failing.every((l) => /\[EFS\]/.test(l))
    verdict = run.status === 0 ? 'NOT DETECTED' : failing.length > 0 ? `detected (${failing.length} failing${onlyEfs ? ', only in the EFS folder' : ''})` : 'detected (crashed)'
  } finally {
    copyFileSync(backup, FILE)
  }
  if (!verdict.startsWith('NOT')) caught++
  console.log(`${verdict.startsWith('NOT') ? 'MISS ' : 'ok   '} ${name.padEnd(94)} -> ${verdict}`)
}
console.log(`\n${caught}/${sabotages.length} sabotages caught; credentialStore.ts restored: ${sha(FILE) === before ? 'identical to before' : '!!! DIFFERENT'}`)
process.exit(caught === sabotages.length && sha(FILE) === before ? 0 : 1)
