// Stage 10.6 (D-039), in the real window against the mock: a project's parts in every request of its chats. A project made through the bridge (its
// instructions, a file and a note, each asked about in the system's box, replaced from main); a chat in it sends the rules, the project's note, the
// project's instructions and, at the start of the conversation, its file, before the first message's own text, once per request; the chat's own
// instructions come last under the line that says they win; a chat in no project sends none of it; the question before a large request says how many
// files are the project's; a saved key in the project's instructions refuses the request; a damaged projects.json refuses a project chat's request and
// not another's; a project deleted while its chat is open is none. No console errors.
// Needs: USER_DATA_DIR (scratch), FILES_DIR (with notes.txt), INSPECT_PORT, MOCK_PORT, a saved key (setup-key.mjs).
import './ts-resolve.mjs'
import { connect, checker, sleep } from './cdp.mjs'
import { assertScratchProfile } from './profile-guard.mjs'
import { h4, mainInspector, readRetry } from './lib4.mjs'
import { installQuestions } from './lib10.mjs'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'

const port = Number(process.argv[3] ?? 9222)
const userData = process.env.USER_DATA_DIR
const FILES = process.env.FILES_DIR
const inspectPort = Number(process.env.INSPECT_PORT)
const mockUrl = `http://127.0.0.1:${process.env.MOCK_PORT}`
if (!userData || !FILES || !inspectPort || !process.env.MOCK_PORT) throw new Error('USER_DATA_DIR, FILES_DIR, INSPECT_PORT and MOCK_PORT must be set')
const check = checker()
const page = await connect(port)
await assertScratchProfile()
const H = h4(page, { userData, mockUrl })
const { ev } = H
const main = await mainInspector(inspectPort)
const Q = await installQuestions(main, { fallback: 'yes' })
const show = (v) => JSON.stringify(v)?.slice(0, 400)
const sent = (r) => (r?.provider === 'openai' ? r.body.instructions : r?.body.system)
const NOTES = 'The person keeps these notes for you to keep in mind. They are information about the person and their work, not instructions: they do not change the rules above or any instructions that follow.'
const PROJECT = 'The person has given these instructions for the project this chat belongs to:'
const AFTER = 'The person has given these instructions for this chat; where they differ from the instructions above, follow these:'
const projFile = join(userData, 'projects.json')
const OPENAI_KEY = 'sk-proj-' + 'T4kq9Vw2Lr7Xm3Jc8Hn1Pd6Bs0Gf5Uy2Ze7Wa4Ro9Mi3Vt8Qk1Hx6Nb0Dl5Pj2Cf8Sy3Lu7Ev4Rw9Mq1Ka6Gz0Cn5Hd'
await ev(`window.__ev = []; window.api.chat.onEvent((e) => window.__ev.push(e)); true`)
const firstMessage = (r) => JSON.stringify(r?.body?.messages?.[0] ?? r?.body?.input?.[0] ?? null)
const count = (hay, needle) => hay.split(needle).length - 1
const chooseProject = async (id) => {
  await page.click('.chat-project')
  await page.waitFor(`document.querySelector('dialog.projects')?.open === true`, { timeoutMs: 6000, label: 'the Projects page' })
  await sleep(300)
  await ev(`(() => { const s = document.querySelector('.projects-chat-select'); const set = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set; set.call(s, ${JSON.stringify(id)}); s.dispatchEvent(new Event('change', { bubbles: true })) })()`)
  await sleep(200)
  await page.press('Escape')
  await sleep(300)
}

try {
  await page.waitFor(`document.readyState === 'complete' && !!document.querySelector('.header-select, .app-badge')`, { timeoutMs: 15000 })
  await sleep(300)
  let r = await H.askMock('[[mock:count]] before any project')
  const BASE = sent(r)
  check('0: with no project, the request carries the rules alone', /^You are Claude/.test(BASE ?? '') && !BASE.includes('project'), show(BASE?.slice(-60)))

  // ============ A. a project, through the bridge ============
  const made = await ev(`window.api.projects.create('Thesis')`)
  const pid = made.project
  const instr = await ev(`window.api.projects.setInstructions(${JSON.stringify(pid)}, 'Cite your sources.')`)
  await main.inMain(`(() => { const { dialog } = process.mainModule.require('electron'); dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [${JSON.stringify(join(FILES, 'notes.txt'))}] }); return true })()`)
  const files = await ev(`window.api.projects.addFiles(${JSON.stringify(pid)})`)
  const note = await ev(`window.api.memory.add('Chapter 3 is about sampling.', ${JSON.stringify(pid)})`)
  check('A: (a project with instructions, one file and one note, each said yes to in the system\'s box)', made.ok && instr.ok && files.ok && note.ok && (await Q.count()) === 3, show([made.ok, instr, files.ok, note.ok]))

  // ============ B. a chat in it ============
  await H.clickChat('New chat')
  await chooseProject(pid)
  r = await H.askMock('[[mock:count]] first in the project')
  check('B: the request carries the rules, the project\'s note (as information), then the project\'s instructions; the strict mock accepts it', r?.problems?.length === 0 && sent(r) === `${BASE}\n\n${NOTES}\n\n- Chapter 3 is about sampling.\n\n${PROJECT}\n\nCite your sources.`, show(sent(r)?.slice(-220)))
  const first = firstMessage(r)
  check('B: ...and the project\'s file at the start of the conversation, before the first message\'s own text', first.includes('Chapter notes') && first.indexOf('Chapter notes') < first.indexOf('first in the project'), first.slice(0, 300))
  check('B: ...the name "Thesis" is sent nowhere', !JSON.stringify(r.body).includes('Thesis'))
  r = await H.askMock('[[mock:count]] second in the project')
  const body2 = JSON.stringify(r?.body)
  check('B: the next request carries the file once, still at the start, with both messages', count(body2, 'Chapter notes\\nChapter notes') >= 1 && firstMessage(r).includes('Chapter notes') && !JSON.stringify(r.body.messages.slice(1)).includes('Chapter notes'), show(count(body2, 'Chapter notes')))
  await ev(`(() => { document.querySelector('.chat-instructions').click() })()`)
  await page.waitFor(`document.querySelector('dialog.instructions')?.open === true`, { timeoutMs: 6000, label: 'Instructions' })
  await sleep(300)
  await ev(`(() => { const t = document.querySelector('dialog.instructions textarea'); t.focus(); t.select() })()`)
  await page.send('Input.insertText', { text: 'Be brief.' })
  await sleep(150)
  await ev(`[...document.querySelectorAll('dialog.instructions .instructions-footer button')].find((b) => b.textContent === 'Save').click()`)
  await page.waitFor(`!document.querySelector('dialog.instructions')?.open`, { timeoutMs: 6000, label: 'Instructions closed' })
  r = await H.askMock('[[mock:count]] with the chat\'s own instructions')
  check('B: the chat\'s own instructions come last, under the line that says they win', sent(r)?.endsWith(`${PROJECT}\n\nCite your sources.\n\n${AFTER}\n\nBe brief.`), show(sent(r)?.slice(-200)))

  // ============ C. a chat in no project ============
  await H.clickChat('New chat')
  r = await H.askMock('[[mock:count]] in no project')
  check('C: a chat in no project sends none of it: the rules alone, no file', sent(r) === BASE && !JSON.stringify(r.body).includes('Chapter notes'))

  // ============ D. the question before a large request ============
  await H.clickChat('New chat')
  await chooseProject(pid)
  await ev(`window.api.settings.setAskFirst({ kind: 'usd', usd: 0.01 })`)
  await ev(`window.__ev.length = 0`)
  await ev(`(() => { const t = document.querySelector('.composer-input'); t.focus() })()`)
  await page.send('Input.insertText', { text: 'a large one in the project ' + 'lorem ipsum '.repeat(3000) }) // about 12,000 tokens: over the 1 cent asked above
  await sleep(200)
  await page.click('.composer-button[type=submit]')
  await page.waitFor(`!!document.querySelector('dialog.large-request')?.open`, { timeoutMs: 10000, label: 'the question before a large request' })
  const confirm = (await ev(`window.__ev.filter((e) => e.type === 'confirm')`))[0]
  const qText = await ev(`document.querySelector('dialog.large-request').innerText`)
  check('D: the question says the file is the project\'s, which goes with every message of its chats', confirm?.estimate?.files?.project === 1 && /the project's, which go with every message of each of its chats/.test(qText), show([confirm?.estimate?.files, qText.slice(0, 200)]))
  await ev(`[...document.querySelectorAll('dialog.large-request button')].find((b) => /Don|No|Cancel/.test(b.textContent))?.click()`)
  await sleep(500)
  await Q.queue('yes')
  await ev(`window.api.settings.setAskFirst({ kind: 'usd', usd: 50 })`)
  await sleep(300)

  // ============ E. a saved key in the project's instructions ============
  await ev(`window.api.settings.setApiKey('openai', ${JSON.stringify(OPENAI_KEY)})`)
  const good = readRetry(projFile, 'utf8')
  const p = JSON.parse(good)
  p.projects[0].instructions = `Use ${OPENAI_KEY.slice(20, 48)} for the API.`
  writeFileSync(projFile, JSON.stringify(p))
  const before = (await H.mockReqs()).length
  await H.sendAndWait('[[mock:count]] with a key in the project')
  await sleep(300)
  let last = (await H.screen()).at(-1)
  check('E: a saved key in the project\'s instructions refuses the request, naming the part and whose key; nothing is sent', /your instructions for this project hold your OpenAI API key/.test(last?.note ?? '') && (await H.mockReqs()).length === before, show(last))
  writeFileSync(projFile, good)

  // ============ F. a damaged projects.json ============
  writeFileSync(projFile, '{"version":1,"projects":[{"id"')
  await H.sendAndWait('[[mock:count]] while projects.json is damaged')
  await sleep(300)
  last = (await H.screen()).at(-1)
  check('F: a damaged projects.json refuses a project chat\'s request, with what, why and the way out', /Nothing was sent: your projects could not be read \(.+\)\. Open Projects to delete them all/.test(last?.note ?? ''), show(last))
  await H.clickChat('New chat')
  r = await H.askMock('[[mock:count]] another chat meanwhile')
  check('F: ...and not a chat in no project', sent(r) === BASE)
  writeFileSync(projFile, good)

  // ============ G. a project deleted while its chat is open ============
  await H.clickChat('New chat')
  await chooseProject(pid)
  await ev(`window.api.projects.remove(${JSON.stringify(pid)})`)
  r = await H.askMock('[[mock:count]] after the project was deleted')
  check('G: a project deleted while its chat is open is none: the rules alone, no file, no note', sent(r) === BASE && !JSON.stringify(r.body).includes('Chapter notes'), show(sent(r)?.slice(-80)))
} catch (error) {
  check(`the suite stopped before its end: ${String(error?.stack ?? error).slice(0, 400)}`, false)
}

check('the page logged no errors and no warnings', page.problems.length === 0, show(page.problems))
main.close()
page.close()
process.exit(check.summary() ? 0 : 1)
