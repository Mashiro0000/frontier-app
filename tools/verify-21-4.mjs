// Stage 21.4 (D-053), Enhance under plain Node: what an Enhance request may carry (shared/validate.ts), the rewrite made fit for the box (cleanRewrite), the model
// it uses (the cheapest with a key, worked out here from the prices), and source checks that main gives it no notes, instructions or tools.
// usage: node tools/verify-21-4.mjs
import './ts-resolve.mjs'
import { readFileSync } from 'node:fs'
import { checker } from './cdp.mjs'
import { REPO, REPO_URL } from './paths.mjs'

const check = checker()
const { checkChatRequest } = await import(`${REPO_URL}/src/shared/validate.ts`)
// enhance.ts imports the bridge, which needs a window: its two pure functions are read from the source and checked on their own.
const src = readFileSync(`${REPO}/src/renderer/src/chat/enhance.ts`, 'utf8')
const { cleanRewrite } = await import('data:text/javascript,' + encodeURIComponent('export ' + /function cleanRewrite[\s\S]*?\n}\n/.exec(src)[0].replace('(text: string): string', '(text)')))

const base = { streamId: 'stream-enhance-1', messages: [{ role: 'user', content: 'make it better' }] }
const ok = (extra) => checkChatRequest({ ...base, ...extra })
check('A: an Enhance request (a named model, one message of the person\'s) is read, purpose kept', ok({ modelId: 'gpt-6-luna', purpose: 'enhance' }).ok && ok({ modelId: 'gpt-6-luna', purpose: 'enhance' }).request.purpose === 'enhance')
const refused = [
  ['no model', { purpose: 'enhance' }],
  ['another purpose', { modelId: 'gpt-6-luna', purpose: 'summarise' }],
  ['a project', { modelId: 'gpt-6-luna', purpose: 'enhance', projectId: '2c5ea4c0-4067-41d2-8fa0-1b2c3d4e5f60' }],
  ['a chat', { modelId: 'gpt-6-luna', purpose: 'enhance', conversationId: '1b4e28ba-2fa1-41d2-883f-0016d3cca427' }],
  ['instructions', { modelId: 'gpt-6-luna', purpose: 'enhance', instructions: 'be brief' }],
  ['two messages', { modelId: 'gpt-6-luna', purpose: 'enhance', messages: [{ role: 'user', content: 'a' }, { role: 'assistant', content: 'b' }, { role: 'user', content: 'c' }] }],
  ['a file', { modelId: 'gpt-6-luna', purpose: 'enhance', messages: [{ role: 'user', content: 'a', attachments: [{ id: 'a'.repeat(64), name: 'x.png' }] }] }]
]
for (const [what, extra] of refused) check(`A: an Enhance request is refused with ${what}`, ok(extra).ok === false)
check('A: a request without a purpose is what it always was', ok({}).ok && ok({}).request.purpose === undefined)

const cases = [['  Hello there \n', 'Hello there'], ['"Quoted all round"', 'Quoted all round'], ['“Curly”', 'Curly'], ['Not "quoted" all round', 'Not "quoted" all round'], ['', '']]
for (const [given, want] of cases) check(`B: ${JSON.stringify(given)} goes in the box as ${JSON.stringify(want)}`, cleanRewrite(given) === want, JSON.stringify(cleanRewrite(given)))

check('C: Enhance asks the cheapest model with a key (the rule for a quick answer) and nothing more', /task: 'quick'/.test(src) && /suggestions: \[\]/.test(src) && /purpose: 'enhance'/.test(src))
check('C: ...and only ever returns the text: nothing in it sends to the chat', !/onSend|chat\.send|send\(/.test(src.replace(/\/\/.*$/gm, '')))
const chat = readFileSync(`${REPO}/src/main/chat.ts`, 'utf8')
check('D: main gives an Enhance request no instructions for every chat, no notes and no tools', /const enhancing = request\.purpose === 'enhance'/.test(chat) && /enhancing \? \{ ok: true as const, text: '' \} : await context\.everyChat\(\)/.test(chat) && /enhancing\s*\?\s*\{ ok: true as const, notes: \[\] as Note\[\] \}/.test(chat) && /toolsContext === undefined \|\| enhancing/.test(chat))
check('D: ...but counts it like any request (the ledger and the limits are not skipped)', !/enhancing[^\n]*ledger|enhancing[^\n]*readLimits|enhancing[^\n]*askFirst/.test(chat))

const view = readFileSync(`${REPO}/src/renderer/src/chat/ChatView.tsx`, 'utf8')
check("E: Enhance hands the chat's own question before a large request to its request (the same dialog as a reply's)", view.includes('enhance(text, status, signal, (request) => askLarge(request, signal))') && /onLargeRequest,\s*null,/.test(src))
check('E: ...and main asks it for an Enhance request as for any (the check before sending is not skipped for it)', chat.includes('if (needsConfirmation(askFirst, estimate) && !(await askLarge(estimate, false))) return'))

process.exit(check.summary() ? 0 : 1)
