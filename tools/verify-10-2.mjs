// Slice 10.2 under plain Node (no window): the person's instructions for EVERY chat (D-039). The look for secrets (secrets.ts: a saved key refused, text
// that looks like a key or a password warned about, masked, ordinary instructions left alone); the kept file (keptFile.ts: the D-016 write, a .tmp that
// wins after a crash, a damaged file never written over unless the person starts again, which keeps a copy first; sealed like the chats and converted with
// them); the service (everyChat.ts: the system's question for new text and only then, its words, the gate's answers, turning off without a question, a
// damaged file that refuses every request); the order of the prompt (request.ts: nothing set and the chat's own alone are byte for byte what they were,
// the golden of 70 requests; every chat then this chat, each after its own line); the encryption flow converting the file; and source checks for what
// only the window would show (chat.ts reads main's own file and refuses a saved key in any instructions; the handlers; the bridge).
// Run: node tools/verify-10-2.mjs
import './ts-resolve.mjs'
import { checker } from './cdp.mjs'
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { REPO, REPO_URL } from './paths.mjs'
import { makeBox, flipInData } from './lib8b3.mjs'
import { startMock } from './mock-providers.mjs'

const check = checker()
const guard = async (name, fn) => { try { await fn() } catch (error) { check(`${name} did not run to its end: ${String(error?.stack ?? error).slice(0, 300)}`, false) } }
const show = (v) => JSON.stringify(v)?.slice(0, 300)
const SRC = `${REPO_URL}/src`
const secrets = await import(`${SRC}/main/secrets.ts`)
const kept = await import(`${SRC}/main/keptFile.ts`)
const every = await import(`${SRC}/main/everyChat.ts`)
const gateMod = await import(`${SRC}/main/systemQuestion.ts`)
const request = await import(`${SRC}/main/providers/request.ts`)
const encMod = await import(`${SRC}/main/chatEncryptionService.ts`)
const validate = await import(`${SRC}/shared/validate.ts`)
const { CHAT_LIMITS } = await import(`${SRC}/shared/ipc.ts`)
const source = (rel) => readFileSync(join(REPO, rel), 'utf8')
const within = (promise, ms, what) => Promise.race([promise, new Promise((_, reject) => setTimeout(() => reject(new Error(`no answer within ${ms} ms: ${what}`)), ms))])
const temps = []
const tempDir = () => { const dir = mkdtempSync(join(tmpdir(), 'frontier-102-')); temps.push(dir); return dir }

// Keys shaped like the real ones, made here: nothing in this file is a real key.
const ANTHROPIC_KEY = 'sk-ant-api03-' + 'Zq3vR8tLm2Xw9Kc4Jh7Pd1Ns6Bf0Gy5Ue2Ta8Wo3Ri7Ml4Vx9Qk1Hs6Nc0Dj5Pg2Bf8Ty3Lw7Ex4Rv9Mz1Qa6Ku0Cn5Hj-AbCdEfAA'
const OPENAI_KEY = 'sk-proj-' + 'T4kq9Vw2Lr7Xm3Jc8Hn1Pd6Bs0Gf5Uy2Ze7Wa4Ro9Mi3Vt8Qk1Hx6Nb0Dl5Pj2Cf8Sy3Lu7Ev4Rw9Mq1Ka6Gz0Cn5Hd'
const KEYS = [{ provider: 'anthropic', key: ANTHROPIC_KEY }, { provider: 'openai', key: OPENAI_KEY }]
// No 8 characters of a key in a row may appear in a sentence or a mask shown to the person.
const leaks = (text, secret) => { for (let i = 0; i + 8 <= secret.length; i++) if (text.includes(secret.slice(i, i + 8))) return true; return false }

// ============ A. the look for secrets ============
await guard('A', async () => {
  const { mask, heldKey, findLookalikes, checkForSecrets, keyInInstructions, KEY_PIECE } = secrets
  check('A: a long part is masked to its first four and last two characters and its length', mask('sk-ant-api03-abcdefghijklmnop') === 'sk-a…op (29 characters)', mask('sk-ant-api03-abcdefghijklmnop'))
  check('A: a short part (8 characters or fewer) shows only its first character', mask('hunter2') === 'h••••••' && mask('12345678') === '1•••••••' && mask('') === '', show([mask('hunter2'), mask('12345678')]))
  check('A: a piece of a saved key is 24 characters', KEY_PIECE === 24)
  check('A: the whole Anthropic key is found and named', heldKey(`My key is ${ANTHROPIC_KEY} thanks`, KEYS) === 'anthropic')
  check('A: ...the OpenAI one too, by its own provider', heldKey(`key=${OPENAI_KEY}`, KEYS) === 'openai')
  check('A: 24 characters from the middle of a key are enough', heldKey(`partly ${ANTHROPIC_KEY.slice(30, 54)} only`, KEYS) === 'anthropic')
  check('A: ...23 are not (no text holds 24 characters of a random key by chance)', heldKey(`partly ${ANTHROPIC_KEY.slice(30, 53)} only`, KEYS) === null)
  const broken = ANTHROPIC_KEY.match(/.{1,20}/g).join('\n ') // no 24 characters of it in a row
  check('A: a key broken over lines and spaces (every 20 characters) is still found', heldKey(broken, KEYS) === 'anthropic')
  check('A: no saved key, no finding; an empty key is skipped', heldKey(ANTHROPIC_KEY, []) === null && heldKey('anything', [{ provider: 'anthropic', key: '' }]) === null)
  const sentence = keyInInstructions('anthropic', 'for every chat')
  check('A: the refusal of a request names whose key and where, and holds none of it', /instructions for every chat hold your Anthropic API key/.test(sentence) && !leaks(sentence, ANTHROPIC_KEY), sentence)

  const shaped = [
    ['an Anthropic API key', `Use ${ANTHROPIC_KEY.replace('Zq3', 'Yq3')} for tests`],
    ['an OpenAI API key', 'my key: sk-proj-' + 'aB3dE5gH7jK9mN1pQ3sT5vW7yZ9bC1eF3hJ5'],
    ['an OpenAI API key', 'old style sk-' + 'Ab12Cd34Ef56Gh78Ij90Kl12Mn34Op56'],
    ['an AWS access key', 'AWS id AKIAIOSFODNN7EXAMPLE ok'],
    ['a GitHub token', 'token ghp_' + 'A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r8'],
    ['a Slack token', 'xoxb-' + '1234567890-abcdefghij'],
    ['a Google API key', 'AIza' + 'SyA1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q'],
    ['a Stripe key', 'sk_live_' + 'A1b2C3d4E5f6G7h8I9j0'],
    ['a web token (JWT)', 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U'],
    ['a private key', '-----BEGIN RSA PRIVATE KEY-----\nMIIEow...'],
    ['a password', 'My password: hunter22 please remember'],
    ['a api_key', 'api_key = "abc123def456"'],
    ['a long random-looking string, which could be a key or a token', 'session Qk7vX2mR9tL4wZ8cJ3hN6pD1sB5fG0yU2eT7aW4o here']
  ]
  for (const [what, text] of shaped) {
    const found = findLookalikes(text)
    check(`A: "${what}" is found and masked`, found.length >= 1 && found[0].what === what && /…|•/.test(found[0].shown), show(found))
  }
  const pw = findLookalikes('password: hunter22')[0]
  check('A: a labelled password shows its label and its value masked, never the value', pw?.shown === 'password: h•••••••' && !pw.shown.includes('hunter22'), show(pw))
  const many = findLookalikes(['AKIAIOSFODNN7EXAMPLE', 'password: aaaa1111', 'pin: 9999', 'token=zzz111', 'secret: s3cr3t', 'pwd=hello12', 'passcode: 4321'].join(' and '))
  check('A: at most five findings are listed', many.length === 5, show(many.length))
  const ordinary = [
    'Answer in short, plain sentences. If my question is unclear, ask me what I mean before you answer.',
    'I am a nurse in Leeds. Use British spelling, and metric units. I work night shifts.',
    'We are building a task-management-system-design-document for the team this quarter.',
    'In Python, sk-learn-is-a-python-library-for-machine-learning (scikit-learn).',
    'Links like https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects are fine.',
    'Use at most 300 tokens per answer; max_tokens=500 in my scripts. Token: words count.',
    'C:\\Users\\someone\\Documents\\projects\\frontier\\notes\\2026\\october\\meeting-notes.md',
    'Write code in TypeScript with strict mode, no any, and prefer const over let.',
    'Antidisestablishmentarianism-and-supercalifragilisticexpialidocious-together'
  ]
  const falsePositives = ordinary.map((t) => [t, findLookalikes(t)]).filter(([, f]) => f.some((x) => !/^a (token|pin|secret)$/.test(x.what)))
  check('A: ordinary instructions (prose, hyphenated phrases, sk-learn, links, paths, code advice) raise nothing that looks like a key', falsePositives.length === 0, show(falsePositives.map(([t, f]) => [t.slice(0, 40), f])))
  const labelled = findLookalikes('Token: words count.')
  check('A: a word after "Token:" is warned about as a token (a warning only: "Save anyway" lets it through)', labelled.length === 1 && labelled[0].what === 'a token', show(labelled))
  for (const [, text] of shaped) {
    for (const finding of findLookalikes(text)) {
      const raw = text.match(/[A-Za-z0-9_\-.]{12,}/g) ?? []
      if (raw.some((part) => finding.shown.includes(part))) check(`A: a mask shows a whole part of "${text.slice(0, 30)}"`, false, finding.shown)
    }
  }
  check('A: no mask holds 12 characters of what it hides in a row', true)

  const held = checkForSecrets(`x ${ANTHROPIC_KEY} y`, KEYS, true, 'Instructions')
  check('A: a saved key is refused even with "Save anyway", names Anthropic, and the sentence holds none of the key', !held.ok && /Anthropic API key/.test(held.error) && !held.warnings && !leaks(held.error, ANTHROPIC_KEY), show(held))
  const warned = checkForSecrets('password: hunter22', KEYS, false, 'Instructions')
  check('A: a lookalike is refused with warnings and the sentence that says "Save anyway"', !warned.ok && warned.warnings?.length === 1 && /Save anyway/.test(warned.error), show(warned))
  check('A: ...and passes with "Save anyway", marked as warned', show(checkForSecrets('password: hunter22', KEYS, true, 'Instructions')) === show({ ok: true, warned: true }))
  check('A: clean text passes, not warned', show(checkForSecrets('Answer in French.', KEYS, false, 'Instructions')) === show({ ok: true, warned: false }))
})

// A gate with a played answer and a clock of its own (no real waiting for the 3 s of quiet after a no).
function played(answers) {
  const asked = []
  const clock = { now: 1_000_000 }
  const askPerson = async (owner, question) => {
    asked.push({ owner, question })
    const answer = answers.shift()
    if (answer === 'throw') throw new Error('the box could not be shown')
    if (typeof answer === 'function') return answer()
    return answer
  }
  return { asked, clock, gate: gateMod.createQuestionGate(askPerson, () => clock.now) }
}

// ============ B. the kept file ============
const parseText = (text) => { try { const v = JSON.parse(text); return typeof v?.t === 'string' ? v.t : null } catch { return null } }
const textOf = (value) => JSON.stringify({ t: value })
function keptAt(dir, extra = {}) {
  return kept.createKeptFile({ pathOf: () => join(dir, 'doc.json'), name: 'the test document', parse: parseText, text: textOf, maxBytes: 4096, writeMode: async () => ({ form: 'plain' }), now: () => 1234, ...extra })
}
await guard('B', async () => {
  const dir = tempDir()
  const file = join(dir, 'doc.json')
  let doc = keptAt(dir)
  check('B: no file: "none"', show(await doc.read()) === show({ state: 'none' }))
  await doc.write('hello')
  check('B: a write leaves exactly the text on disk, and no .tmp', readFileSync(file, 'utf8') === '{"t":"hello"}' && !existsSync(file + '.tmp'))
  check('B: a fresh reader reads it back, plain', show(await keptAt(dir).read()) === show({ state: 'ok', value: 'hello', form: 'plain' }))
  writeFileSync(file + '.tmp', '{"t":"newer"}')
  check('B: a whole .tmp left by a crash wins (it holds the newer text)', show(await keptAt(dir).read()) === show({ state: 'ok', value: 'newer', form: 'plain' }))
  writeFileSync(file + '.tmp', '{"t":"cut of')
  check('B: a cut-off .tmp is ignored: the real file is read', (await keptAt(dir).read()).value === 'hello')
  rmSync(file + '.tmp')
  writeFileSync(file, '\uFEFF{"t":"with a mark"}')
  check('B: a byte-order mark (some editors add one) is allowed', (await keptAt(dir).read()).value === 'with a mark')
  writeFileSync(file, 'this is not json')
  doc = keptAt(dir)
  const bad = await doc.read()
  check('B: a damaged file is "unreadable", with a reason', bad.state === 'unreadable' && /not a file this app wrote/.test(bad.why), show(bad))
  let refused = null
  try { await doc.write('replacement') } catch (error) { refused = error }
  check('B: ...it is NEVER written over by itself: the write is refused with a sentence, and the file is byte for byte as it was', refused instanceof kept.KeptRefused && /could not be read/.test(refused.message) && readFileSync(file, 'utf8') === 'this is not json', show(refused?.message))
  try { await doc.remove() } catch (error) { refused = error }
  check('B: ...nor deleted', existsSync(file) && readFileSync(file, 'utf8') === 'this is not json')
  await doc.write('replacement', { replace: true })
  const aside = join(dir, 'doc.json.damaged-1234')
  check('B: when the person starts again (replace), a copy of the damaged file is kept first, byte for byte, then the new text is written', existsSync(aside) && readFileSync(aside, 'utf8') === 'this is not json' && readFileSync(file, 'utf8') === '{"t":"replacement"}', show(readdirSync(dir)))
  writeFileSync(file, 'x'.repeat(30_000))
  check('B: a file far larger than the app ever writes is not read', (await keptAt(dir).read()).state === 'unreadable')
  writeFileSync(file, '{"t":"remove me"}')
  doc = keptAt(dir)
  await doc.remove()
  check('B: remove deletes the file (and reads "none" after)', !existsSync(file) && (await doc.read()).state === 'none')

  // Sealed like the chats.
  const box = makeBox()
  let mode = { form: 'encrypted' }
  const sdir = tempDir()
  const sfile = join(sdir, 'doc.json')
  const sealed = keptAt(sdir, { box, writeMode: async () => mode })
  await sealed.write('a secret plan')
  const onDisk = readFileSync(sfile, 'utf8')
  check('B: with encryption on, the file is the chats\' envelope and the text is nowhere in it', onDisk.startsWith('{"format":"frontier-chat-encrypted"') && !onDisk.includes('secret plan'), onDisk.slice(0, 60))
  check('B: ...and reads back, as encrypted', show(await keptAt(sdir, { box }).read()) === show({ state: 'ok', value: 'a secret plan', form: 'encrypted' }))
  const key = box.exportKey()
  box.lose()
  const lost = keptAt(sdir, { box })
  const lostRead = await lost.read()
  check('B: with a key that cannot be used, it is "unreadable" and says why', lostRead.state === 'unreadable' && /could not be opened/.test(lostRead.why), show(lostRead))
  box.importKey(key)
  check('B: ...what could not be read is not remembered: when the key comes back, the same reader reads it', (await lost.read()).value === 'a secret plan')
  writeFileSync(sfile, flipInData(onDisk))
  check('B: an envelope damaged inside is "unreadable"', (await keptAt(sdir, { box }).read()).state === 'unreadable')
  mode = { refused: 'Chats are not being saved: the key cannot be read.' }
  const blocked = keptAt(tempDir(), { box, writeMode: async () => mode })
  let refusal = null
  try { await blocked.write('x') } catch (error) { refusal = error }
  check('B: when the rule refuses every write (the key cannot be used), the write is refused with the rule\'s own sentence and nothing is written', refusal instanceof kept.KeptRefused && refusal.message === mode.refused, show(refusal?.message))

  // Converted with the chats.
  const cdir = tempDir()
  const cfile = join(cdir, 'doc.json')
  let form = 'plain'
  const conv = keptAt(cdir, { box, writeMode: async () => ({ form }) })
  check('B: conform with no file: "none"', (await conv.conform()) === 'none')
  await conv.write('convert me')
  check('B: conform in the same form: "already"', (await conv.conform()) === 'already')
  form = 'encrypted'
  check('B: conform after encryption was turned on: "changed", and the file is sealed', (await conv.conform()) === 'changed' && readFileSync(cfile, 'utf8').startsWith('{"format":"frontier-chat-encrypted"') && (await keptAt(cdir, { box }).read()).value === 'convert me')
  const docs = kept.keptDocuments([conv])
  check('B: keptDocuments counts it as encrypted', show(await docs.counts()) === show({ plain: 0, encrypted: 1 }))
  form = 'plain'
  check('B: keptDocuments converts it back to a plain file', show(await docs.conform()) === show({ changed: 1, failed: 0 }) && readFileSync(cfile, 'utf8') === '{"t":"convert me"}')
  writeFileSync(cfile, 'damaged')
  check('B: a damaged file is left exactly as it is by conform, and counted as neither', (await conv.conform()) === 'unreadable' && readFileSync(cfile, 'utf8') === 'damaged' && show(await docs.counts()) === show({ plain: 0, encrypted: 0 }))
})

// ============ C. the instructions for every chat ============
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
function service(dir, answers, extra = {}) {
  const g = played(answers)
  const svc = every.createEveryChat({ pathOf: () => join(dir, 'instructions.json'), writeMode: async () => ({ form: 'plain' }), gate: g.gate, savedKeys: async () => KEYS, ...extra })
  return { ...g, svc, file: join(dir, 'instructions.json') }
}
await guard('C', async () => {
  const { parseEveryChatFile, everyChatFileText, EVERY_CHAT_NOT_SAVED } = every
  check('C: the file is {"version":1,"text":...}', everyChatFileText('Hi') === '{"version":1,"text":"Hi"}')
  const bad = ['{"version":1,"text":"Hi","x":1}', '{"version":2,"text":"Hi"}', '{"version":1,"text":" Hi"}', '{"version":1,"text":""}', '{"version":1,"text":5}', '[1]', 'null', `{"version":1,"text":"${'z'.repeat(8001)}"}`]
  check('C: anything but exactly that shape (an extra field, another version, untrimmed, empty, not text, too long) is not read', bad.every((t) => parseEveryChatFile(t) === null) && parseEveryChatFile(`{"version":1,"text":"${'z'.repeat(8000)}"}`)?.length === 8000)

  let dir = tempDir()
  let s = service(dir, [true])
  check('C: nothing saved: no text, no problem', show(await s.svc.status()) === show({ text: '', problem: null }))
  const owner = { window: 7 }
  let r = await s.svc.save(owner, { text: '  Answer in French.  ' })
  check('C: new text is saved only after the question, which is asked once, for the window that asked', r.ok && s.asked.length === 1 && s.asked[0].owner === owner, show(r))
  const q = s.asked[0].question
  check('C: the question: its title, "Save these instructions for every chat?", the text (trimmed) and its length, where it goes, and that the page cannot answer it', q.title === 'Instructions for every chat' && q.message === 'Save these instructions for every chat?' && q.detail.startsWith('"Answer in French."') && q.detail.includes('17 characters. They go to the company that runs the model with every message of every chat') && /cannot answer/.test(q.detail) && q.yes === 'Save the instructions' && q.no === 'Cancel', show(q))
  check('C: the file holds the trimmed text', readFileSync(s.file, 'utf8') === '{"version":1,"text":"Answer in French."}')
  check('C: ...and the status says so', show(r.status) === show({ text: 'Answer in French.', problem: null }))
  r = await s.svc.save(owner, { text: 'Answer in French.' })
  check('C: saving the same text again asks nothing', r.ok && s.asked.length === 1)
  s = service(dir, [false])
  r = await s.svc.save(owner, { text: 'Answer in German.' })
  check('C: a no: nothing saved, the sentence says so, and it is marked "cancelled" (not a failure)', !r.ok && r.cancelled === true && r.error === EVERY_CHAT_NOT_SAVED && readFileSync(s.file, 'utf8').includes('French'), show(r))
  s.clock.now += 1000
  r = await s.svc.save(owner, { text: 'Answer in Dutch.' })
  check('C: a second try within 3 s of a no is not asked (the gate rests): nothing saved', !r.ok && /Wait a few seconds/.test(r.error) && s.asked.length === 1, show(r))
  s = service(dir, [])
  r = await s.svc.save(owner, { text: '' })
  check('C: emptying the box (turning them off) asks nothing and deletes the file', r.ok && s.asked.length === 0 && !existsSync(s.file) && show(r.status) === show({ text: '', problem: null }), show(r))
  r = await s.svc.save(owner, { text: '   \n ' })
  check('C: white space alone is the same as nothing', r.ok && s.asked.length === 0)

  s = service(dir, [true])
  r = await s.svc.save(owner, { text: `Always use ${ANTHROPIC_KEY} when asked.` })
  check('C: text that holds a saved API key is refused at once: no question, nothing saved, the sentence names Anthropic and holds none of the key', !r.ok && s.asked.length === 0 && !existsSync(s.file) && /Anthropic API key/.test(r.error) && !leaks(r.error, ANTHROPIC_KEY), show(r))
  r = await s.svc.save(owner, { text: `Always use ${ANTHROPIC_KEY} when asked.`, saveAnyway: true })
  check('C: ..."Save anyway" does not get a saved key through', !r.ok && s.asked.length === 0 && !existsSync(s.file))
  r = await s.svc.save(owner, { text: 'My password: hunter22' })
  check('C: text that looks like a password: warnings (masked), no question, nothing saved', !r.ok && r.warnings?.length === 1 && r.warnings[0].shown === 'password: h•••••••' && s.asked.length === 0 && !existsSync(s.file), show(r))
  r = await s.svc.save(owner, { text: 'My password: hunter22', saveAnyway: 'true' })
  check('C: ..."Save anyway" must be exactly true (the string "true" is not)', !r.ok && r.warnings?.length === 1 && s.asked.length === 0)
  r = await s.svc.save(owner, { text: 'My password: hunter22', saveAnyway: true })
  check('C: ...with "Save anyway" the question is asked, and says the person chose to save it anyway', r.ok && s.asked.length === 1 && /looks like a key or a password; you chose to save it anyway/.test(s.asked[0].question.detail) && readFileSync(s.file, 'utf8').includes('hunter22'), show(s.asked[0]?.question.detail))

  const long = 'a'.repeat(390) + 'BCDEFGHIJKLMNOPQRSTU' + 'z'.repeat(7590)
  s = service(dir, [true])
  r = await s.svc.save(owner, { text: long })
  const detail = s.asked[0]?.question.detail ?? ''
  check('C: a long text: the question shows its first 400 characters, then "...", and its whole length (8,000)', r.ok && detail.startsWith(`"${'a'.repeat(390)}BCDEFGHIJK..."`) && !detail.includes('LMNOP') && detail.includes('8,000 characters'), detail.slice(380, 460))
  s = service(dir, [true])
  r = await s.svc.save(owner, { text: 'x'.repeat(8001) })
  check('C: 8,001 characters are refused with the limit, before any question', !r.ok && /8,000 characters/.test(r.error) && s.asked.length === 0)
  for (const input of [null, 5, 'text', {}, { text: 7 }, { text: null }, []]) {
    r = await s.svc.save(owner, input)
    if (r.ok || s.asked.length !== 0 || !existsSync(s.file)) check(`C: ${show(input)} was taken as a change`, false, show(r))
  }
  check('C: input that is not { text } (null, a number, a string, {}, text that is not text) is not understood: nothing asked, and the instructions are NOT turned off', (await s.svc.status()).text === long)

  // The gate's answers.
  dir = tempDir()
  let release
  const hold = new Promise((resolve) => { release = resolve })
  s = service(dir, [() => hold.then(() => true)])
  const first = s.svc.save(owner, { text: 'First' })
  await wait(20)
  const second = await within(s.svc.save(owner, { text: 'Second' }), 2000, 'a second save while the first waits')
  check('C: a second save while the first is waiting for its answer is refused at once', !second.ok && /still being saved/.test(second.error) && s.asked.length === 1, show(second))
  const otherGate = played([() => new Promise(() => {})])
  void otherGate.gate.ask(null, { title: 't', message: 'm', detail: 'd', yes: 'y', no: 'n' })
  const busy = every.createEveryChat({ pathOf: () => join(tempDir(), 'instructions.json'), writeMode: async () => ({ form: 'plain' }), gate: otherGate.gate, savedKeys: async () => [] })
  r = await within(busy.save(owner, { text: 'While another question is open' }), 2000, 'a save while the gate is busy')
  check('C: while another question of the app is open (a limit, say), the save is refused with the gate\'s sentence', !r.ok && /already asking you something|another question|is open/i.test(r.error), show(r))
  release()
  check('C: ...and the first save, once answered, is saved', (await within(first, 2000, 'the first save')).ok && readFileSync(s.file, 'utf8').includes('First'))
  s = service(dir, ['throw'])
  r = await s.svc.save(owner, { text: 'Box fails' })
  check('C: a question that cannot be shown saves nothing and says so', !r.ok && r.error === gateMod.QUESTION_FAILED && readFileSync(s.file, 'utf8').includes('First'), show(r))

  // A damaged file refuses every request, and is replaced only by the person.
  dir = tempDir()
  writeFileSync(join(dir, 'instructions.json'), '{"version":1,"text":"cut off')
  s = service(dir, [true])
  const st = await s.svc.status()
  check('C: a damaged file: no text, and the problem in words', st.text === '' && /not a file this app wrote/.test(st.problem), show(st))
  const fr = await s.svc.forRequest()
  check('C: ...EVERY request is refused while it cannot be read, with what, why and the way out', !fr.ok && /^Nothing was sent: your instructions for every chat could not be read \(.+\)\. Open Instructions to replace them or turn them off\.$/.test(fr.error), show(fr))
  r = await s.svc.save(owner, { text: 'A fresh start.' })
  const asideNames = readdirSync(dir).filter((n) => n.startsWith('instructions.json.damaged-'))
  check('C: saving new text asks, says the old file could not be read and is kept, and then keeps a copy of the damaged file before writing', r.ok && /could not be read: the app keeps a copy/.test(s.asked[0].question.detail) && asideNames.length === 1 && readFileSync(join(dir, asideNames[0]), 'utf8') === '{"version":1,"text":"cut off' && readFileSync(s.file, 'utf8') === '{"version":1,"text":"A fresh start."}', show([r, asideNames]))
  check('C: ...and requests go again, with the new text', show(await s.svc.forRequest()) === show({ ok: true, text: 'A fresh start.' }))
  dir = tempDir()
  writeFileSync(join(dir, 'instructions.json'), 'garbage')
  s = service(dir, [])
  r = await s.svc.save(owner, { text: '' })
  check('C: turning off a damaged file asks nothing, keeps a copy of it, and requests go again with none', r.ok && s.asked.length === 0 && !existsSync(s.file) && readdirSync(dir).some((n) => n.startsWith('instructions.json.damaged-')) && show(await s.svc.forRequest()) === show({ ok: true, text: '' }), show(r))
  check('C: none saved: requests go with none', show(await service(tempDir(), []).svc.forRequest()) === show({ ok: true, text: '' }))

  // Sealed, and a key that cannot be used.
  const box = makeBox()
  dir = tempDir()
  s = service(dir, [true], { box, writeMode: async () => ({ form: 'encrypted' }) })
  r = await s.svc.save(owner, { text: 'Sealed text' })
  check('C: with encryption on, the saved file is sealed and the text is nowhere in it', r.ok && !readFileSync(s.file, 'utf8').includes('Sealed') && (await s.svc.forRequest()).text === 'Sealed text')
  box.lose()
  const after = service(dir, [true], { box, writeMode: async () => ({ refused: 'Chats are not being saved: the key cannot be read.' }) })
  check('C: a key that cannot be used: the status says why and every request is refused', /could not be opened/.test((await after.svc.status()).problem ?? '') && !(await after.svc.forRequest()).ok)
  r = await after.svc.save(owner, { text: 'Try to replace' })
  check('C: ...and new text cannot be saved over it while the rule refuses writes (the rule\'s own sentence, after the question)', !r.ok && /key cannot be read/.test(r.error) && readFileSync(after.file, 'utf8').startsWith('{"format":"frontier-chat-encrypted"'), show(r))

  // The same look for a chat's own instructions.
  s = service(tempDir(), [])
  check('C: checkForChat: clean text and nothing pass', show(await s.svc.checkForChat({ text: 'Be brief.' })) === show({ ok: true }) && show(await s.svc.checkForChat({ text: '' })) === show({ ok: true }))
  r = await s.svc.checkForChat({ text: `use ${OPENAI_KEY}`, saveAnyway: true })
  check('C: checkForChat: a saved key is refused, naming OpenAI, never showing it', !r.ok && /OpenAI API key/.test(r.error) && !leaks(r.error, OPENAI_KEY), show(r))
  r = await s.svc.checkForChat({ text: 'pin: 4321' })
  check('C: checkForChat: a lookalike gives warnings, and passes with "Save anyway"', !r.ok && r.warnings?.length === 1 && (await s.svc.checkForChat({ text: 'pin: 4321', saveAnyway: true })).ok)
  check('C: checkForChat: text that is not text is not understood; nothing is asked or written', !(await s.svc.checkForChat({ text: 1 })).ok && s.asked.length === 0 && !existsSync(s.file))
})

// ============ D. the order of the prompt ============
await guard('D', async () => {
  const { systemPromptFor, buildStreamRequest } = request
  const rules = systemPromptFor('anthropic')
  const LEAD = 'The person has given these instructions for this chat:'
  const EVERY = 'The person has given these instructions for every chat:'
  const AFTER = 'The person has given these instructions for this chat; where they differ from the instructions above, follow these:'
  check('D: nothing set: the app\'s rules alone (as before)', systemPromptFor('anthropic', undefined, {}) === rules && systemPromptFor('anthropic', '  ', { everyChat: ' \n ' }) === rules)
  check('D: only the chat\'s own: exactly the Stage 7.4 prompt', systemPromptFor('anthropic', ' Be brief. ') === `${rules}\n\n${LEAD}\n\nBe brief.` && systemPromptFor('anthropic', 'Be brief.', { everyChat: '' }) === `${rules}\n\n${LEAD}\n\nBe brief.`)
  check('D: only every chat\'s: the rules, its own line, the text', systemPromptFor('anthropic', '', { everyChat: 'I am a nurse.' }) === `${rules}\n\n${EVERY}\n\nI am a nurse.`)
  const both = systemPromptFor('openai', 'Be brief.', { everyChat: 'I am a nurse.' })
  check('D: both: the rules, then every chat\'s, then this chat\'s after a line that says these win where they differ (the most particular last)', both === `${systemPromptFor('openai')}\n\n${EVERY}\n\nI am a nurse.\n\n${AFTER}\n\nBe brief.`, both.slice(-200))
  const built = buildStreamRequest({ credentials: { apiKey: 'k', baseURL: undefined }, model: JSON.parse(readFileSync(join(REPO, 'tools/registry-good.json'), 'utf8')).models.find((m) => m.provider === 'anthropic'), instructions: 'Own.', everyChat: 'Every.', messages: [{ role: 'user', content: 'hi' }], signal: new AbortController().signal })
  check('D: buildStreamRequest puts both in the system prompt, in that order', built.system.endsWith(`${EVERY}\n\nEvery.\n\n${AFTER}\n\nOwn.`))
  const golden = join(tempDir(), 'golden.json')
  const run = spawnSync(process.execPath, [join(REPO, 'tools/capture-golden-9.mjs'), golden], { encoding: 'utf8', env: { ...process.env, GOLDEN_PORT: '8897' }, timeout: 120_000 })
  const cmp = spawnSync(process.execPath, [join(REPO, 'tools/capture-golden-9.mjs'), '--compare', join(REPO, 'tools/golden-9.json'), golden], { encoding: 'utf8', timeout: 60_000 })
  check('D: the golden: 70 requests (both providers, every model, with and without a chat\'s instructions) byte for byte what they were before 10.2', run.status === 0 && cmp.status === 0 && /70 requests compared, 0 differ/.test(cmp.stdout), (run.stderr + cmp.stdout).slice(-200))

  // Through both adapters to the mock: where the text lands.
  const { adapterFor } = await import(`${SRC}/main/providers/index.ts`)
  const models = JSON.parse(readFileSync(join(REPO, 'tools/registry-good.json'), 'utf8')).models
  const mock = await startMock(8898)
  const origin = 'http://127.0.0.1:8898'
  for (const provider of ['anthropic', 'openai']) {
    await fetch(`${origin}/__reset`, { method: 'POST' })
    const model = models.find((m) => m.provider === provider)
    const req = buildStreamRequest({ credentials: { apiKey: 'test-key-0123456789abcdef0123', baseURL: origin }, model, instructions: 'Own.', everyChat: 'Every.', messages: [{ role: 'user', content: 'hi' }], signal: new AbortController().signal })
    try { for await (const e of adapterFor(provider).stream(req)) void e } catch { /* the request is what counts */ }
    const got = (await (await fetch(`${origin}/__requests`)).json()).filter((x) => !x.listing)
    const field = provider === 'openai' ? got[0]?.body?.instructions : got[0]?.body?.system
    const text = Array.isArray(field) ? field.map((b) => b.text).join('') : field
    check(`D: ${provider}: the mock received both parts in the system prompt, every chat's first, and the (strict) mock accepted the request`, got.length === 1 && got[0].problems.length === 0 && typeof text === 'string' && text.indexOf('Every.') > 0 && text.indexOf('Every.') < text.indexOf('Own.'), show(got[0]?.problems))
  }
  await mock.close?.()
})

// ============ E. the encryption flow converts the file ============
await guard('E', async () => {
  const box = makeBox()
  let choice = 'off'
  const dir = tempDir()
  const doc = every.createEveryChat({ pathOf: () => join(dir, 'instructions.json'), box, writeMode: async () => ({ form: choice === 'on' ? 'encrypted' : 'plain' }), gate: played([true]).gate, savedKeys: async () => [] })
  await doc.save(null, { text: 'Convert me with the chats' })
  const store = { counts: async () => ({ plain: 0, encrypted: 0, unreadable: 0, unopened: 0 }), conform: async () => ({ changed: 0, already: 0, failed: 0 }) }
  const protection = { state: async () => ({ choice, canEncrypt: true, keyUsable: choice === 'on' ? true : null, blocked: null }), turnOn: async () => { choice = 'on' }, turnOff: async () => { choice = 'off' } }
  const backups = { backUpAllBeforeEncrypting: async () => ({ ok: true, count: 0, leftOut: 0, where: 'x' }), exclusive: (_busy, fn) => fn() }
  const enc = encMod.createChatEncryptionService({ store, protection, backups, asks: { confirmPlain: async () => true }, documents: kept.keptDocuments([doc.file]) })
  let r = await enc.encrypt(null)
  const file = join(dir, 'instructions.json')
  check('E: turning encryption on (no chats at all) seals the instructions too, and the report says so', r.ok && show(r.report.documents) === show({ changed: 1, failed: 0 }) && readFileSync(file, 'utf8').startsWith('{"format":"frontier-chat-encrypted"'), show(r))
  r = await enc.encrypt(null)
  check('E: ...again: nothing left to do, nothing asked', r.ok && r.report.documents === undefined && r.report.changed === 0, show(r))
  r = await enc.decrypt(null)
  check('E: turning it off makes the file plain again, and the report says so', r.ok && show(r.report.documents) === show({ changed: 1, failed: 0 }) && readFileSync(file, 'utf8') === '{"version":1,"text":"Convert me with the chats"}', show(r))
  choice = 'on'
  const plainLeft = await enc.encrypt(null)
  check('E: with the choice already on but the file still plain (a conversion that failed before), "Encrypt" still converts it', plainLeft.ok && plainLeft.report.documents?.changed === 1, show(plainLeft))
  const none = encMod.createChatEncryptionService({ store, protection, backups, asks: { confirmPlain: async () => true }, documents: kept.keptDocuments([every.createEveryChat({ pathOf: () => join(tempDir(), 'instructions.json'), box, writeMode: async () => ({ form: 'plain' }), gate: played([]).gate, savedKeys: async () => [] }).file]) })
  r = await none.decrypt(null)
  check('E: without instructions the report says nothing about them', r.ok && r.report.documents === undefined, show(r))
})

// ============ F. what only the window would show, by its source ============
await guard('F', async () => {
  const chat = source('src/main/chat.ts')
  const at = (s, text) => s.indexOf(text)
  const read = at(chat, 'const everyChat = await context.everyChat()')
  const build = at(chat, 'const buildFor = (): ReturnType<typeof buildStreamRequest> =>') // a function since 11.3: it builds the request again after a tool
  check('F: chat.ts reads the instructions for every chat from main\'s own file for every request, before the request is built', read > 0 && build > read && /if \(!everyChat\.ok\) \{\s*send\(\{ streamId, type: 'error', message: everyChat\.error \}\)\s*return/.test(chat))
  check('F: ...and refuses a request whose instructions (either part) hold a saved key, before it is built', at(chat, 'const held = heldKey(text, keys)') > read && at(chat, 'const held = heldKey(text, keys)') < build && /\['for every chat', everyChat\.text\],\s*(\['for this project', project\?\.instructions \?\? ''\],\s*)?\['for this chat', request\.instructions \?\? ''\]/.test(chat))
  check('F: ...a key found ends the request at once, with the sentence that names whose key and where (nothing is built or sent after it)', /const held = heldKey\(text, keys\)\s*if \(held !== null\) \{\s*send\(\{ streamId, type: 'error', message: keyInInstructions\(held, whose\) \}\)\s*return\s*\}/.test(chat))
  check('F: ...and hands the text to the builder, never one from the page', /everyChat: everyChat\.text,/.test(chat) && !/request\.everyChat/.test(chat))
  const ipcMain = source('src/main/ipc.ts')
  check('F: ipc.ts: saving goes through the service, for the window that asked (guardedForWindow)', /CHANNELS\.instructionsSetEveryChat,\s*guardedForWindow\(\(window, input: unknown\): Promise<SaveEveryChatResult> =>\s*everyChat\.save\(window, input\)/.test(ipcMain))
  check('F: ...reading and the check for a chat are guarded', /CHANNELS\.instructionsGetEveryChat,\s*guarded\(/.test(ipcMain) && /CHANNELS\.instructionsCheckForChat,\s*guarded\(/.test(ipcMain))
  check('F: ...the service uses the app\'s one question gate, the chats\' write rule and the secure storage', /createEveryChat\(\{\s*pathOf: \(\) => join\(app\.getPath\('userData'\), 'instructions\.json'\),\s*box: secureStorage,\s*writeMode: protection\.writeMode,\s*gate: questions,\s*savedKeys\s*\}\)/.test(ipcMain))
  check('F: ...the encryption flow converts it, requests read it, quitting waits for it', /documents: keptDocuments\(\[\s*everyChat\.file,\s*memory\.file,\s*projects\.file,\s*auditLog\.document,\s*toolSettings\.file\s*\]\)/.test(ipcMain) && /everyChat: \(\) => everyChat\.forRequest\(\),\s*savedKeys/.test(ipcMain) && /everyChat\.file\.whenIdle\(\)/.test(ipcMain))
  const preload = source('src/preload/index.ts')
  check('F: the bridge has exactly getEveryChat, setEveryChat and checkForChat, which send { text, saveAnyway } and nothing else', /instructions: \{\s*getEveryChat: \(\) => ipcRenderer\.invoke\(CHANNELS\.instructionsGetEveryChat\),\s*setEveryChat: \(text, saveAnyway\) =>\s*ipcRenderer\.invoke\(CHANNELS\.instructionsSetEveryChat, \{ text, saveAnyway \}\),\s*checkForChat: \(text, saveAnyway\) =>\s*ipcRenderer\.invoke\(CHANNELS\.instructionsCheckForChat, \{ text, saveAnyway \}\)\s*\}/.test(preload))
  const checked = validate.checkChatRequest({ streamId: 'hostile-0001', messages: [{ role: 'user', content: 'hi' }], everyChat: 'EVIL', system: 'EVIL' })
  check('F: a chat request from the page that names its own "everyChat" or "system" loses them: only main\'s file is used', checked.ok && !JSON.stringify(checked.request).includes('EVIL'), show(checked))
  const askerSrc = source('src/main/everyChat.ts')
  check('F: everyChat.ts asks only for text that is not empty (turning off asks nothing), and only after the look for secrets', /if \(next !== ''\) \{\s*const secrets = checkForSecrets\(/.test(askerSrc) && askerSrc.indexOf('checkForSecrets(') < askerSrc.indexOf('options.gate.ask('))
  check('F: the limit is the chats\' own (8,000 characters)', CHAT_LIMITS.maxInstructionsChars === 8000)
})

for (const dir of temps) rmSync(dir, { recursive: true, force: true })
process.exit(check.summary() ? 0 : 1)
