// Slice 5.3: the credential store (src/main/credentialStore.ts) under plain Node: no window, no Electron. The operating system's
// secure storage is replaced by a fake that behaves like the real one where it matters (a blob made by another box cannot be
// decrypted; the plain key never appears in what is written). Runs the same cases in a normal temp folder and in a scratch
// folder INSIDE this PC's EFS-encrypted %APPDATA%, where rename() fails with EXDEV (D-010), after proving that it does.
import { REPO_URL } from './paths.mjs'
import './ts-resolve.mjs'
import { checker } from './cdp.mjs'
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync, existsSync, copyFileSync, renameSync } from 'node:fs'
import { promises as fsp } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

const check = checker()
const S = await import(`${REPO_URL}/src/main/credentialStore.ts`)
const { createCredentialStore, credentialFileName, LEGACY_FILE_NAME } = S
const PROVIDERS = ['anthropic', 'openai'] // two, so that independence and the tie to a provider can be tested

// ---- a fake secure storage ----------------------------------------------------------------------------------------------
function makeBox(available = true) {
  const secret = randomBytes(32)
  return {
    isAvailable: () => available,
    encrypt(plain) {
      const iv = randomBytes(12)
      const c = createCipheriv('aes-256-gcm', secret, iv)
      const body = Buffer.concat([c.update(plain, 'utf8'), c.final()])
      return Buffer.concat([iv, c.getAuthTag(), body])
    },
    decrypt(blob) {
      const d = createDecipheriv('aes-256-gcm', secret, blob.subarray(0, 12))
      d.setAuthTag(blob.subarray(12, 28))
      return Buffer.concat([d.update(blob.subarray(28)), d.final()]).toString('utf8')
    }
  }
}

const APPDATA = process.env.APPDATA
const folders = [
  ['a normal temp folder', () => mkdtempSync(join(tmpdir(), 'frontier-5-3-'))],
  ['an EFS-encrypted folder in %APPDATA%', () => { const d = join(APPDATA, `frontier-app-test-scratch-s53store-${randomBytes(4).toString('hex')}`); mkdirSync(d, { recursive: true }); return d }]
]
const key = () => 'test-' + randomBytes(24).toString('hex')
const files = (dir) => readdirSync(dir).sort()
const read = (dir, name) => readFileSync(join(dir, name), 'utf8')

for (const [folderName, makeDir] of folders) {
  const dir0 = makeDir()
  const label = (s) => `[${folderName.split(' ')[1] === 'normal' ? 'temp' : 'EFS'}] ${s}`
  // a probe: in the EFS folder rename must fail, otherwise this run does not test what it claims to
  let renameFails = false
  try { writeFileSync(join(dir0, 'probe'), 'x'); renameSync(join(dir0, 'probe'), join(dir0, 'probe2')) } catch (e) { renameFails = e.code === 'EXDEV' }
  rmSync(join(dir0, 'probe'), { force: true }); rmSync(join(dir0, 'probe2'), { force: true })
  if (folderName.startsWith('an EFS')) check(label('precondition: rename() really fails with EXDEV here, so the hostile case is being tested'), renameFails)
  else check(label('precondition: rename() works here (the easy case)'), !renameFails)

  const fresh = (box = makeBox(), providers = PROVIDERS) => { const dir = join(dir0, randomBytes(4).toString('hex')); mkdirSync(dir, { recursive: true }); return { dir, box, store: createCredentialStore(dir, box, providers) } }

  // ---- basics ----
  {
    const { dir, store } = fresh()
    check(label('nothing is saved at first: read gives null for every provider, and no file is created'), (await store.read('anthropic')) === null && (await store.read('openai')) === null && files(dir).length === 0)
    const k1 = key(), k2 = key()
    await store.save('anthropic', k1)
    check(label('save, then read: the same key'), (await store.read('anthropic')) === k1)
    check(label('the other provider has none (keys are per provider)'), (await store.read('openai')) === null)
    check(label('one file for that provider, named credentials.anthropic.json, nothing else (no temp file)'), JSON.stringify(files(dir)) === JSON.stringify(['credentials.anthropic.json']), JSON.stringify(files(dir)))
    await store.save('openai', k2)
    check(label('a second provider gets a second file; both keys read back, each its own'), (await store.read('openai')) === k2 && (await store.read('anthropic')) === k1 && files(dir).length === 2)
    const k3 = key()
    const before = read(dir, 'credentials.openai.json')
    await store.save('anthropic', k3)
    check(label('replacing one key does not touch the other provider\'s file (byte for byte)'), (await store.read('anthropic')) === k3 && read(dir, 'credentials.openai.json') === before)
    await store.clear('anthropic')
    check(label('clear removes that provider\'s file only; the other key stays'), (await store.read('anthropic')) === null && (await store.read('openai')) === k2 && JSON.stringify(files(dir)) === JSON.stringify(['credentials.openai.json']))
    await store.clear('anthropic')
    check(label('clearing what is not there is fine'), true)
    const parsed = JSON.parse(read(dir, 'credentials.openai.json'))
    check(label('the file is { version: 2, provider, key } with a base64 key'), JSON.stringify(Object.keys(parsed).sort()) === '["key","provider","version"]' && parsed.version === 2 && parsed.provider === 'openai' && /^[A-Za-z0-9+/=]+$/.test(parsed.key))
    const text = read(dir, 'credentials.openai.json')
    check(label('the plain key is nowhere in the file, nor its base64'), !text.includes(k2) && !text.includes(Buffer.from(k2).toString('base64')))
    check(label('the stored bytes are longer than the key (nonce, tag)'), Buffer.from(parsed.key, 'base64').length > k2.length)
    check(label('canStore reflects the secure storage'), store.canStore() === true)
  }

  // ---- the old file ----
  {
    const { dir, box, store } = fresh()
    const old = key()
    const legacy = JSON.stringify({ version: 1, anthropicApiKey: box.encrypt(old).toString('base64') })
    writeFileSync(join(dir, LEGACY_FILE_NAME), legacy)
    check(label('legacy credentials.json is read as Anthropic\'s key'), (await store.read('anthropic')) === old)
    check(label('...and is nobody else\'s'), (await store.read('openai')) === null)
    check(label('reading wrote nothing and did not move the file'), JSON.stringify(files(dir)) === JSON.stringify([LEGACY_FILE_NAME]) && read(dir, LEGACY_FILE_NAME) === legacy)
    const next = key()
    await store.save('anthropic', next)
    check(label('saving a new Anthropic key writes the new kind of file and DELETES the old one (it must not bring a removed key back)'), (await store.read('anthropic')) === next && JSON.stringify(files(dir)) === JSON.stringify(['credentials.anthropic.json']), JSON.stringify(files(dir)))
    await store.clear('anthropic')
    check(label('after Remove nothing is left, and the old key does not reappear'), (await store.read('anthropic')) === null && files(dir).length === 0)
  }
  {
    const { dir, box, store } = fresh()
    const old = key(), mine = key()
    writeFileSync(join(dir, LEGACY_FILE_NAME), JSON.stringify({ version: 1, anthropicApiKey: box.encrypt(old).toString('base64') }))
    writeFileSync(join(dir, 'credentials.anthropic.json'), JSON.stringify({ version: 2, provider: 'anthropic', key: box.encrypt(mine).toString('base64') }))
    check(label('both kinds present: the new one wins'), (await store.read('anthropic')) === mine)
    await store.clear('anthropic')
    check(label('Remove deletes BOTH files'), files(dir).length === 0 && (await store.read('anthropic')) === null)
  }
  {
    const { dir, box, store } = fresh()
    writeFileSync(join(dir, LEGACY_FILE_NAME), JSON.stringify({ version: 1, anthropicApiKey: box.encrypt(key()).toString('base64') }))
    await store.save('openai', key())
    check(label('saving another provider\'s key leaves the old Anthropic file alone'), existsSync(join(dir, LEGACY_FILE_NAME)))
    await store.clear('openai')
    check(label('...and removing it does too'), existsSync(join(dir, LEGACY_FILE_NAME)))
  }
  for (const [name, content] of [['version 2 where 1 is expected', { version: 2, anthropicApiKey: 'AAAA' }], ['no key', { version: 1 }], ['a key that is not text', { version: 1, anthropicApiKey: 42 }], ['an array', []], ['null', null], ['a string', 'hello']]) {
    const { dir, store } = fresh()
    writeFileSync(join(dir, LEGACY_FILE_NAME), JSON.stringify(content))
    check(label(`legacy file with ${name}: read gives null, no throw`), (await store.read('anthropic')) === null)
  }

  // ---- a file is tied to its provider ----
  {
    const { dir, store } = fresh()
    const k = key()
    await store.save('openai', k)
    copyFileSync(join(dir, 'credentials.openai.json'), join(dir, 'credentials.anthropic.json')) // copied to the wrong name
    check(label('an OpenAI file renamed to Anthropic\'s name does NOT give Anthropic OpenAI\'s key'), (await store.read('anthropic')) === null)
    check(label('...and OpenAI\'s own file still works'), (await store.read('openai')) === k)
    const swapped = JSON.parse(read(dir, 'credentials.openai.json')); swapped.provider = 'anthropic'
    writeFileSync(join(dir, 'credentials.openai.json'), JSON.stringify(swapped))
    check(label('a file whose own provider field disagrees with its name is refused, in both directions'), (await store.read('openai')) === null)
    await store.save('anthropic', k)
    check(label('saving over such a file repairs it'), (await store.read('anthropic')) === k && JSON.parse(read(dir, 'credentials.anthropic.json')).provider === 'anthropic')
  }

  // ---- files that are not usable: null, no throw, nothing written ----
  const bads = [
    ['torn in the middle', '{"version":2,"provider":"anthropic","ke'],
    ['empty', ''],
    ['not JSON at all', 'hello'],
    ['a JSON array', '[]'],
    ['JSON null', 'null'],
    ['another version', JSON.stringify({ version: 3, provider: 'anthropic', key: 'AAAA' })],
    ['no provider field', JSON.stringify({ version: 2, key: 'AAAA' })],
    ['a key that is not text', JSON.stringify({ version: 2, provider: 'anthropic', key: 7 })],
    ['a key that is not base64 of something this box made', JSON.stringify({ version: 2, provider: 'anthropic', key: 'AAAA' })],
    ['a provider this app does not know', JSON.stringify({ version: 2, provider: 'nope', key: 'AAAA' })],
    ['a byte-order mark before good JSON', '\ufeff{"version":2}']
  ]
  for (const [name, content] of bads) {
    const { dir, store } = fresh()
    writeFileSync(join(dir, 'credentials.anthropic.json'), content)
    const before = read(dir, 'credentials.anthropic.json')
    let got, threw = false
    try { got = await store.read('anthropic') } catch { threw = true }
    check(label(`unusable file (${name}): read gives null, does not throw, and changes nothing`), !threw && got === null && read(dir, 'credentials.anthropic.json') === before)
    const k = key()
    await store.save('anthropic', k)
    check(label(`...and saving a key over it works`), (await store.read('anthropic')) === k)
  }
  {
    const { dir, box, store } = fresh()
    writeFileSync(join(dir, 'credentials.anthropic.json'), randomBytes(5 * 1024 * 1024))
    const reads = []
    const realRead = fsp.readFile
    fsp.readFile = async (p, ...rest) => { reads.push(String(p)); return realRead(p, ...rest) }
    const t0 = Date.now()
    const big = await store.read('anthropic')
    fsp.readFile = realRead
    check(label('5 MB of random bytes in the file: null, quickly'), big === null && Date.now() - t0 < 1000)
    check(label('...and the file was never even opened for reading (its size is looked at first)'), !reads.some((p) => p.endsWith('credentials.anthropic.json')), JSON.stringify(reads))
    // a file that WOULD be accepted if it were read: a good key file padded past the limit. Only the size limit refuses it.
    const k = key()
    const padded = { version: 2, provider: 'anthropic', key: box.encrypt(k).toString('base64'), padding: 'x'.repeat(20 * 1024) }
    writeFileSync(join(dir, 'credentials.anthropic.json'), JSON.stringify(padded))
    check(label('a good key file padded beyond 16 KB is not a key file: null (the limit is a real limit, not an accident of parsing)'), (await store.read('anthropic')) === null)
    padded.padding = 'x'.repeat(1024)
    writeFileSync(join(dir, 'credentials.anthropic.json'), JSON.stringify(padded))
    check(label('...while the same file padded by 1 KB is still read (the key comes back)'), (await store.read('anthropic')) === k)
    mkdirSync(join(dir, 'credentials.openai.json'))
    check(label('a DIRECTORY with the file\'s name: null, no throw'), (await store.read('openai')) === null)
  }
  {
    // a key saved under another box (another Windows account, a reset keyring) cannot be decrypted
    const a = fresh(), other = makeBox()
    const k = key()
    writeFileSync(join(a.dir, 'credentials.anthropic.json'), JSON.stringify({ version: 2, provider: 'anthropic', key: other.encrypt(k).toString('base64') }))
    check(label('a key encrypted by another secure storage cannot be decrypted: null, no throw'), (await a.store.read('anthropic')) === null)
  }

  // ---- no secure storage on this computer ----
  {
    const { dir, store } = fresh(makeBox(false))
    let threw = ''
    try { await store.save('anthropic', key()) } catch (e) { threw = e.message }
    check(label('without secure storage: save refuses, writes nothing, and says why'), /no secure storage/.test(threw) && files(dir).length === 0, threw)
    check(label('...canStore is false and read gives null'), store.canStore() === false && (await store.read('anthropic')) === null)
  }

  // ---- hostile providers ----
  {
    const { dir, store } = fresh()
    for (const bad of ['../evil', '..\\evil', 'anthropic.json', 'Anthropic', 'ANTHROPIC', '__proto__', 'constructor', 'toString', '', ' anthropic', 'anthropic\n', null, undefined, 7, {}, ['anthropic']]) {
      let r = 'no throw'
      try { await store.save(bad, key()) } catch (e) { r = e.message }
      let r2 = 'no throw'
      try { await store.read(bad) } catch (e) { r2 = e.message }
      let r3 = 'no throw'
      try { await store.clear(bad) } catch (e) { r3 = e.message }
      check(label(`provider ${JSON.stringify(bad)?.slice(0, 20) ?? 'undefined'}: save, read and clear all refuse, and nothing is written`), /not a provider/.test(r) && /not a provider/.test(r2) && /not a provider/.test(r3) && files(dir).length === 0, `${r} | ${r2} | ${r3}`)
    }
  }

  // ---- one thing at a time ----
  {
    const { dir, store } = fresh()
    const keys = Array.from({ length: 25 }, key)
    await Promise.all(keys.map((k) => store.save('anthropic', k)))
    check(label('25 saves fired at once: the LAST one asked for is what is kept, whole'), (await store.read('anthropic')) === keys.at(-1) && JSON.stringify(files(dir)) === JSON.stringify(['credentials.anthropic.json']))
    const ops = []
    const ka = key(), kb = key()
    ops.push(store.save('openai', ka), store.clear('openai'), store.save('openai', kb))
    const seen = []
    ops.push(store.read('openai').then((r) => seen.push(r)))
    await Promise.all(ops)
    check(label('save, clear, save, read in one breath run in order: the read sees the last save'), seen[0] === kb && (await store.read('openai')) === kb)
    // a read while a slow save is in progress never sees half a file
    const big = key()
    const reads = []
    const saving = store.save('anthropic', big)
    for (let i = 0; i < 20; i++) reads.push(store.read('anthropic'))
    await saving
    const results = await Promise.all(reads)
    check(label('reads asked for during a save see the old key or the new one, never a half-written file (null)'), results.every((r) => r === keys.at(-1) || r === big), JSON.stringify(results.map((r) => (r === null ? 'null' : r === big ? 'new' : r === keys.at(-1) ? 'old' : '?'))))
  }

  // ---- faults ----
  {
    const { dir, store } = fresh()
    const k = key()
    await store.save('anthropic', k)
    const realWrite = fsp.writeFile
    fsp.writeFile = async (path, ...rest) => { if (String(path).includes('credentials.')) throw Object.assign(new Error('disk full'), { code: 'ENOSPC' }); return realWrite(path, ...rest) }
    let err = ''
    try { await store.save('anthropic', key()) } catch (e) { err = e.message }
    fsp.writeFile = realWrite
    check(label('a disk that refuses the write: save throws (the person is not told "Saved")'), /disk full/.test(err), err)
    check(label('...and the earlier key is still there'), (await store.read('anthropic')) === k)
  }
  {
    const { dir, store } = fresh()
    const realWrite = fsp.writeFile
    fsp.writeFile = async (path, data, ...rest) => { if (String(path).includes('credentials.')) return realWrite(path, String(data).slice(0, 20), ...rest); return realWrite(path, data, ...rest) } // a write cut off halfway
    let err = ''
    try { await store.save('anthropic', key()) } catch (e) { err = e.message }
    fsp.writeFile = realWrite
    check(label('a write cut off halfway: the read-back fails and save THROWS ("could not be read back")'), /could not be read back/.test(err), err)
    check(label('...and the torn file reads as nothing, not as a wrong key'), (await store.read('anthropic')) === null)
  }
  {
    const { dir, box, store } = fresh()
    const old = key()
    writeFileSync(join(dir, LEGACY_FILE_NAME), JSON.stringify({ version: 1, anthropicApiKey: box.encrypt(old).toString('base64') }))
    const realRm = fsp.rm
    fsp.rm = async (path, ...rest) => { if (String(path).endsWith(LEGACY_FILE_NAME)) throw Object.assign(new Error('locked'), { code: 'EBUSY' }); return realRm(path, ...rest) }
    const k = key()
    let err = ''
    try { await store.save('anthropic', k) } catch (e) { err = e.message }
    fsp.rm = realRm
    check(label('if the old file cannot be deleted, saving still succeeds (the new file wins) and the new key is what is read'), err === '' && (await store.read('anthropic')) === k)
  }
  {
    const { dir, store } = fresh()
    await store.save('anthropic', key())
    const realRm = fsp.rm
    fsp.rm = async (path, ...rest) => { if (String(path).includes('credentials.anthropic')) return undefined; return realRm(path, ...rest) } // claims to delete, does not
    let err = ''
    try { await store.clear('anthropic') } catch (e) { err = e.message }
    fsp.rm = realRm
    check(label('a delete that did not happen: clear THROWS rather than say "removed"'), /could not be deleted/.test(err), err)
  }

  rmSync(dir0, { recursive: true, force: true })
}

const ok = check.summary()
process.exit(ok ? 0 : 1)
