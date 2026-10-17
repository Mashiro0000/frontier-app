// Slice 17.5 under plain Node (no window): Settings and the window for the third provider (D-049), the parts that can be checked without a window. What it shows:
//   A. the question in the system's box before a Google key is saved: every line the plan asks for (what goes to Google and when, the free tier and what Google does
//      with it, that the app cannot tell and sends nothing to find out, Argon needs a billed key, the dated prices, no web search, the key kept encrypted), the two
//      buttons, the last line every such question has;
//   B. the handler in main: a Google key asks first, through the one gate, for the window that asked, and is saved only on a yes; every other answer saves nothing and
//      says why; the other two providers' keys save as before, with no question;
//   C. the page's words: the free-tier note under the Google key, the price change in Settings (the day in words, "twice today's prices"), the note under the web search;
//   D. the page asks main and nothing else; no new message on the bridge.
// Run: node tools/guarded.mjs tools/verify-17-5.mjs
import './ts-resolve.mjs'
import { checker } from './cdp.mjs'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { REPO, REPO_URL } from './paths.mjs'

const check = checker()
const show = (v) => JSON.stringify(v)?.slice(0, 500)
const source = (rel) => readFileSync(join(REPO, rel), 'utf8')
const SRC = `${REPO_URL}/src`
const K = await import(`${SRC}/main/googleKey.ts`)
const TQ = await import(`${SRC}/main/toolQuestion.ts`)
const F = await import(`${SRC}/renderer/src/settings/format.ts`)

// ============ A. the question ============
const q = K.googleKeyQuestion()
const lines = q.detail.split('\n')
check('A: a title, one question, the detail, two buttons: "Save the key" and "Don\'t save it"', q.title === 'Google API key' && q.message === 'Save this Google API key, so that the app can send your chats to Google?' && q.yes === 'Save the key' && q.no === "Don't save it" && Object.keys(q).sort().join() === 'detail,message,no,title,yes')
check('A: what goes to Google, and only when a Gemini model answers', /When a Gemini model answers, everything the request carries goes to Google with this key: the chat so far, your instructions and notes, the files on it, and what your tools brought back\./.test(q.detail) && /Nothing goes to Google while you chat with another provider's model\./.test(q.detail))
check('A: the free tier: Google uses what is sent to improve its products and people may read it; a billed key does not', /On a free \(unbilled\) key, Google uses what you send to improve its products, and people at Google may read it\. On a billed key it does not/.test(q.detail))
check('A: the app cannot tell which kind of key it is, and sends nothing to find out', /The app cannot tell which kind of key this is, and sends nothing to find out\./.test(q.detail))
check('A: Gemini 4 Argon needs a billed key', /Gemini 4 Argon needs a billed key: on a free key Google refuses it\./.test(q.detail))
check('A: the prices change on set days, and each request is counted at its day\'s prices against the limits', /Gemini 4 Argon doubles on 1 December 2026, Gemini 3\.8 Flash on 1 January 2027/.test(q.detail) && /against your spending limits/.test(q.detail))
check('A: no web search with Gemini, and why', /Searching the web is not offered with Gemini models: the search would run on Google Search, and Google keeps searched prompts for 30 days\./.test(q.detail))
check('A: the key kept encrypted, and where to remove it', /The key is kept encrypted on this computer, like your other keys\. You can remove it in Settings\./.test(q.detail))
check('A: the last line is the one every question in the box has (why it is asked here, and that only the person can answer)', lines.at(-1) === TQ.ASKED_HERE)
check('A: plain text: no line is over 400 characters, no control character but the line breaks, nothing that looks like an address the box would make a link of', lines.every((l) => l.length <= 400) && !/[\u0000-\u0009\u000b-\u001f\u007f]/.test(q.detail) && !/https?:/.test(q.detail))
check('A: a fresh question each time (no shared object the caller could change)', K.googleKeyQuestion() !== q && show(K.googleKeyQuestion()) === show(q))
check('A: the sentence for a no says nothing was saved', K.GOOGLE_KEY_NOT_SAVED === 'Not saved: you said no in the window that asked.')

// ============ B. the handler ============
const ipc = source('src/main/ipc.ts')
const handler = ipc.slice(ipc.indexOf('CHANNELS.settingsSetApiKey,'), ipc.indexOf('CHANNELS.settingsClearApiKey,'))
check('B: the handler is given the window the call came from (never one the page names)', /guardedForWindow\(async \(window, input: unknown\): Promise<SetKeyResult>/.test(handler))
check('B: a Google key asks the one gate of the app, for that window, with the Google question', /if \(check\.provider === 'google'\) \{\s*const answer = await questions\.ask\(window, googleKeyQuestion\(\)\)/.test(handler))
check('B: only a yes goes on to save: any other answer returns before saveApiKey', /if \(answer !== 'yes'\) \{\s*return \{/.test(handler) && handler.indexOf("if (answer !== 'yes')") < handler.indexOf('await saveApiKey(check.provider, check.key)'))
check('B: busy, resting and failed say the gate\'s own sentences; a no says nothing was saved', /answer === 'busy'\s*\?\s*QUESTION_BUSY/.test(handler) && /answer === 'resting'\s*\?\s*QUESTION_RESTING/.test(handler) && /answer === 'failed'\s*\?\s*QUESTION_FAILED/.test(handler) && /:\s*GOOGLE_KEY_NOT_SAVED/.test(handler))
check('B: the key is checked before the question (a malformed key or provider asks nothing)', handler.indexOf('checkKeySubmission(input)') < handler.indexOf('questions.ask'))
check('B: the other two providers\' keys save as before (the question is for google only)', (handler.match(/questions\.ask/g) ?? []).length === 1 && /check\.provider === 'google'/.test(handler))
check('B: the gate is the one the rest of the app uses (one question at a time across the app)', /const questions = createQuestionGate\(askPerson\)/.test(ipc))

// ============ C. the page's words ============
const copy = source('src/renderer/src/settings/providerCopy.ts')
check('C: the free-tier note under the Google key says the same as the box, shortly', /On a free \(unbilled\) key, Google uses what you send to improve its products, and people at Google may read it; on a billed key it does not\. The app cannot tell which kind of key you have\. Gemini 4 Argon needs a billed key\./.test(copy))
check('C: only Google has a note', (copy.match(/note:/g) ?? []).length === 1)
const section = source('src/renderer/src/settings/ProviderKeySection.tsx')
check('C: the key section shows the note, as text, when there is one', /\{help\.note !== undefined && <p className="settings-hint settings-key-note">\{help\.note\}<\/p>\}/.test(section))
check('C: the day in words: 2026-12-01 is "1 December 2026", 2027-01-01 "1 January 2027"', F.formatDay('2026-12-01') === '1 December 2026' && F.formatDay('2027-01-01') === '1 January 2027' && F.formatDay('2026-02-28') === '28 February 2026')
check('C: twice today\'s prices when both double; otherwise "more than today\'s prices"', F.priceRatio({ inputPerMTok: 2, outputPerMTok: 10 }, { inputPerMTok: 4, outputPerMTok: 20 }) === "twice today's prices" && F.priceRatio({ inputPerMTok: 0.75, outputPerMTok: 3.75 }, { inputPerMTok: 1.5, outputPerMTok: 7.5 }) === "twice today's prices" && F.priceRatio({ inputPerMTok: 2, outputPerMTok: 10 }, { inputPerMTok: 3, outputPerMTok: 20 }) === "more than today's prices")
const dialog = source('src/renderer/src/settings/SettingsDialog.tsx')
check('C: Settings shows the coming change only when there is one, with the new prices and that each request is counted at its day\'s', /\{model\.priceChange !== null && \(/.test(dialog) && /From \{formatDay\(model\.priceChange\.from\)\}/.test(dialog) && /The app counts each request at the prices of the day it is sent\./.test(dialog))
const switches = source('src/renderer/src/tools/SwitchesSection.tsx')
check('C: the Tools page says, under the web search, that it is not offered with Gemini models and why', /\{tool\.id === 'web_search' && \(/.test(switches) && /Not offered with Gemini models: the search would run on Google Search, and Google\s+keeps searched prompts for 30 days\./.test(switches))

// ============ D. the bridge ============
const preload = source('src/preload/index.ts')
check('D: the bridge for keys is what it was: setApiKey, clearApiKey, testApiKey (no message to answer a question)', /setApiKey: \(provider, key\) => ipcRenderer\.invoke\(CHANNELS\.settingsSetApiKey, \{ provider, key \}\)/.test(preload) && !/answer|confirmKey|googleKey/i.test(preload.slice(preload.indexOf('settings: {'), preload.indexOf('chat: {'))))
check('D: the new words in the page use no address, no storage, no raw HTML', ![copy, section, switches].some((s) => /dangerouslySetInnerHTML|localStorage|https?:\/\//.test(s)))

process.exit(check.summary() ? 0 : 1)
