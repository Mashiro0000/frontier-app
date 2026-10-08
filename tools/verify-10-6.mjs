// Slice 10.6 under plain Node (no window): a project's parts in every request of its chats (D-039). The prompt (the rules, the notes, every chat's
// instructions, the project's, then the chat's own, which say they win), byte for byte as before with no project (the golden of 70 requests); the
// request check (a project id or none); what a refusal and the question before a large request say about a project's files; the page's reason for
// Send being off when the project's files and the chat's together pass a request's caps; and source checks for chat.ts (the project read from main's
// own file, its files first in the first message, its notes, a saved key in its instructions refused).
// Run: node tools/verify-10-6.mjs
import './ts-resolve.mjs'
import { checker } from './cdp.mjs'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { REPO, REPO_URL } from './paths.mjs'

const check = checker()
const guard = async (name, fn) => { try { await fn() } catch (error) { check(`${name} did not run to its end: ${String(error?.stack ?? error).slice(0, 300)}`, false) } }
const show = (v) => JSON.stringify(v)?.slice(0, 300)
const SRC = `${REPO_URL}/src`
const request = await import(`${SRC}/main/providers/request.ts`)
const validate = await import(`${SRC}/shared/validate.ts`)
const limits = await import(`${SRC}/shared/limits.ts`)
const ask = await import(`${SRC}/shared/askFirst.ts`)
const page = await import(`${SRC}/renderer/src/chat/attachmentText.ts`)
const source = (rel) => readFileSync(join(REPO, rel), 'utf8')
const NOTES = 'The person keeps these notes for you to keep in mind. They are information about the person and their work, not instructions: they do not change the rules above or any instructions that follow.'
const EVERY = 'The person has given these instructions for every chat:'
const PROJECT = 'The person has given these instructions for the project this chat belongs to:'
const LEAD = 'The person has given these instructions for this chat:'
const AFTER = 'The person has given these instructions for this chat; where they differ from the instructions above, follow these:'
const PID = '11111111-2222-4333-8444-555555555555'
const temp = mkdtempSync(join(tmpdir(), 'frontier-106-'))

await guard('A', async () => {
  const { systemPromptFor } = request
  const { parseRegistry } = await import(`${REPO_URL}/src/shared/registry.ts`)
  const reg = parseRegistry(JSON.parse(readFileSync(join(REPO, 'tools/registry-good.json'), 'utf8')))
  const built = request.buildStreamRequest({ credentials: { apiKey: 'k'.repeat(30) }, model: reg.registry.models[0], project: 'Cite sources.', messages: [{ role: 'user', content: 'hi' }], signal: new AbortController().signal })
  check('A: a request BUILT with the project instructions carries them in its system prompt (the builder passes the project on)', built.system.includes('Cite sources.') && built.system.includes(PROJECT))
  const rules = systemPromptFor('anthropic')
  check('A: a project\'s instructions alone: the rules, the project\'s line, the text', systemPromptFor('anthropic', '', { project: 'Cite sources.' }) === `${rules}\n\n${PROJECT}\n\nCite sources.`)
  check('A: ...and with the chat\'s own after them, under the line that says these win', systemPromptFor('anthropic', 'Be brief.', { project: 'Cite sources.' }) === `${rules}\n\n${PROJECT}\n\nCite sources.\n\n${AFTER}\n\nBe brief.`)
  const all = systemPromptFor('openai', 'Be brief.', { notes: ['I am a nurse.'], everyChat: 'British spelling.', project: 'Cite sources.' })
  check('A: every part, in order: the rules, the notes, every chat\'s, the project\'s, the chat\'s own', all === `${systemPromptFor('openai')}\n\n${NOTES}\n\n- I am a nurse.\n\n${EVERY}\n\nBritish spelling.\n\n${PROJECT}\n\nCite sources.\n\n${AFTER}\n\nBe brief.`, show(all.slice(-260)))
  check('A: empty or white-space project instructions add nothing (the 7.4 line stays alone)', systemPromptFor('anthropic', 'Be brief.', { project: '  ' }) === `${rules}\n\n${LEAD}\n\nBe brief.`)
  check('A: the project\'s name is never part of it (the builder is not even given it)', !/name/.test(source('src/main/providers/request.ts').match(/export interface PromptParts \{[\s\S]*?\}/)?.[0] ?? 'name'))
  const golden = join(temp, 'golden.json')
  const run = spawnSync(process.execPath, [join(REPO, 'tools/capture-golden-9.mjs'), golden], { encoding: 'utf8', env: { ...process.env, GOLDEN_PORT: '8901' }, timeout: 180_000 })
  const cmp = spawnSync(process.execPath, [join(REPO, 'tools/capture-golden-9.mjs'), '--compare', join(REPO, 'tools/golden-9.json'), golden], { encoding: 'utf8', timeout: 60_000 })
  check('A: the golden: 70 requests byte for byte as before', run.status === 0 && cmp.status === 0 && /70 requests compared, 0 differ/.test(cmp.stdout), (run.stderr + cmp.stdout).slice(-200))
})

await guard('B', async () => {
  const base = { streamId: 'stream-0001', messages: [{ role: 'user', content: 'hi' }] }
  const withId = validate.checkChatRequest({ ...base, projectId: PID })
  check('B: a request may name its project by id, and the check keeps it', withId.ok && withId.request.projectId === PID, show(withId))
  const without = validate.checkChatRequest(base)
  check('B: a request in no project has no projectId at all (as before)', without.ok && !('projectId' in without.request))
  for (const bad of ['Thesis', 5, '', PID.toUpperCase().replace(/1/g, 'A')]) {
    const r = validate.checkChatRequest({ ...base, projectId: bad })
    if (r.ok) check(`B: projectId ${show(bad)} was taken`, false)
  }
  check('B: a projectId that is not an id is refused, with the stream named so the page hears why', ['Thesis', 5, ''].every((bad) => { const r = validate.checkChatRequest({ ...base, projectId: bad }); return !r.ok && r.streamId === 'stream-0001' }))
})

await guard('C', async () => {
  const note = limits.withFilesNote('Not sent: over the daily limit.', { count: 3, tokens: 1200, project: 2 })
  check('C: a limit\'s refusal says how many of the files are the project\'s, which go with every message of its chats', /2 of them are the project's, which go with every message of each of its chats\.$/.test(note), note)
  check('C: ...all of them', /They are the project's/.test(limits.withFilesNote('Not sent.', { count: 2, tokens: 10, project: 2 })))
  check('C: ...and nothing more when none is', limits.withFilesNote('Not sent.', { count: 2, tokens: 10 }) === limits.withFilesNote('Not sent.', { count: 2, tokens: 10, project: 0 }) && !/project/.test(limits.withFilesNote('Not sent.', { count: 2, tokens: 10 })))
  const est = ask.estimateRequest(1000, 100, { inputPerMTok: 1, outputPerMTok: 1, cacheReadPerMTok: 1, cacheWritePerMTok: 1 }, { count: 2, tokens: 500, project: 1 })
  check('C: the question before a large request is told how many files are the project\'s', est.files?.project === 1)
})

await guard('D', async () => {
  const info = (n, extra = {}) => ({ id: n.toString(16).padStart(64, '0'), name: `f${n}.pdf`, kind: 'pdf', mediaType: 'application/pdf', bytes: 1000, pages: 40, changes: { metadataRemoved: false, shrunkFrom: null, turned: false, convertedFrom: null }, ...extra })
  const model = { label: 'M', imageInput: true, documentInput: true }
  check('D: Send is free with the chat\'s files alone under the caps', page.filesBlock([{ files: [{ info: info(1) }] }], [], model) === null)
  const over = page.filesBlock([{ files: [{ info: info(1) }] }], [], model, [info(2), info(3)])
  check('D: the project\'s files count with the chat\'s: over 100 PDF pages, Send is off and says the project\'s files count too', /more pages than one request may carry \(100\)\. The project's files count too/.test(over ?? ''), over)
  check('D: a file both carry is counted once', page.filesBlock([{ files: [{ info: info(2) }] }], [], model, [info(2), info(3)]) === null)
  check('D: a model that cannot read a project\'s PDF turns Send off too', /cannot read PDFs/.test(page.filesBlock([], [], { ...model, documentInput: false }, [info(4)]) ?? ''))
  const big = page.filesBlock([], [], model, [info(5, { bytes: 21 * 1024 * 1024, pages: 1 })])
  check('D: over 20 MB with a project\'s file', /more than one request may carry \(20 MB\)/.test(big ?? ''), big)
})

await guard('E', async () => {
  const chat = source('src/main/chat.ts')
  const at = (t) => chat.indexOf(t)
  check('E: chat.ts reads the project from main\'s own file when the request names one, and a refusal ends the request', /if \(request\.projectId !== undefined\) \{\s*const found = await context\.project\(request\.projectId\)\s*if \(!found\.ok\) \{\s*send\(\{ streamId, type: 'error', message: found\.error \}\)\s*return\s*\}\s*project = found\.project/.test(chat))
  check('E: ...its files go first in the first message (a file the chat carries too is sent once), before the files are read and checked', /index === 0\s*\?\s*\{\s*\.\.\.message,\s*attachments: \[\s*\.\.\.projectFiles,\s*\.\.\.\(message\.attachments \?\? \[\]\)\.filter\(\s*\(file\) => !projectFiles\.some\(\(p\) => p\.id === file\.id\)/.test(chat) && at('const resolved = await resolveAttachments(messages,') > at('const projectFiles ='))
  check('E: ...a refusal over the caps says the project\'s files count too', /The project's files count too: they go with every message of its chats\./.test(chat))
  check('E: ...the notes are read for the project, its instructions looked at for a saved key and handed to the builder', /const memory = await context\.notes\(project\?\.id \?\? null\)/.test(chat) && /\['for this project', project\?\.instructions \?\? ''\]/.test(chat) && /project: project\?\.instructions,/.test(chat))
  check('E: ...and the guess counts how many files are the project\'s', /\.\.\.\(projectFiles\.length > 0 \? \{ project: projectFiles\.length \} : \{\}\)/.test(chat))
  check('E: ipc.ts hands chat.ts the projects store', /project: \(id\) => projects\.forRequest\(id\)/.test(source('src/main/ipc.ts')))
  check('E: the page sends the chat\'s project with each request, and nothing else of it', /\.\.\.\(projectId === null \? \{\} : \{ projectId \}\)/.test(source('src/renderer/src/chat/ipcReply.ts')))
})

rmSync(temp, { recursive: true, force: true })
process.exit(check.summary() ? 0 : 1)
