import {
  CHAT_LIMITS,
  type CheckChatInstructionsResult,
  type EveryChatStatus,
  type SaveEveryChatResult
} from '../shared/ipc'
import { checkInstructions } from '../shared/validate'
import type { WriteMode } from './chatFile'
import type { SecretBox } from './credentialStore'
import { createKeptFile, KeptRefused, type KeptFile } from './keptFile'
import { checkForSecrets, type SavedKey } from './secrets'
import {
  QUESTION_BUSY,
  QUESTION_FAILED,
  QUESTION_RESTING,
  type QuestionGate,
  type SystemQuestion
} from './systemQuestion'

// The person's instructions for EVERY chat (Stage 10.2, D-039): what the Claude and ChatGPT apps call custom instructions. One text of at most
// CHAT_LIMITS.maxInstructionsChars, kept by main in instructions.json in the data folder (keptFile.ts: written like a chat, sealed like the chats when
// encryption is on), and added by main to the system prompt of every request, after the app's rules and before the chat's own instructions (request.ts).
// The page shows it and asks to change it; it cannot put text in the prompt by itself:
//  - a change that adds or changes text is saved only after the person's yes in the system's own message box (systemQuestion.ts), which shows the text;
//  - one of the API keys saved in this app is refused outright, and text that looks like a key or a password is saved only on "Save anyway" (secrets.ts);
//  - emptying it (turning it off) sends less, so it asks nothing.
// When the file cannot be read, NO request is sent (`forRequest` says why): a chat is never sent without the person's instructions in silence. The way
// out is to save new instructions or turn them off, which first keeps a copy of the damaged file.
//
// A chat's OWN instructions (D-027) stay the page's, saved in the chat's file: the page writes the chat's messages anyway, so a question it could go
// around would be for show. They get the same look for secrets (`checkForChat`), and chat.ts refuses a request whose instructions hold a saved key.

export const EVERY_CHAT_FILE_VERSION = 1

/** The file holds at most 8,000 characters of text, each at most 6 bytes once escaped in JSON, and a few bytes around them. */
const MAX_FILE_BYTES = 64 * 1024

/** The file's own text: `{"version":1,"text":"..."}`. */
export const everyChatFileText = (text: string): string =>
  JSON.stringify({ version: EVERY_CHAT_FILE_VERSION, text })

/** What the file holds, or null when it is not exactly that shape (a text this app would accept: trimmed, not empty, within the limit). */
export function parseEveryChatFile(content: string): string | null {
  let raw: unknown
  try {
    raw = JSON.parse(content)
  } catch {
    return null
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null
  const fields = raw as Record<string, unknown>
  if (fields.version !== EVERY_CHAT_FILE_VERSION || Object.keys(fields).length !== 2) return null
  const { text } = fields
  if (typeof text !== 'string' || text === '' || text !== text.trim()) return null
  if (text.length > CHAT_LIMITS.maxInstructionsChars) return null
  return text
}

/** How much of the text the system's question shows: the start, then its length. */
export const QUESTION_TEXT_CHARS = 400

export function everyChatQuestion(
  text: string,
  facts: { warned: boolean; replacing: boolean }
): SystemQuestion {
  const chars = [...text]
  const start =
    chars.length > QUESTION_TEXT_CHARS ? `${chars.slice(0, QUESTION_TEXT_CHARS).join('')}...` : text
  const lines = [
    `"${start}"`,
    '',
    `${text.length.toLocaleString('en-US')} characters. They go to the company that runs the model with every message of every chat, and are kept in this app's data folder.`
  ]
  if (facts.warned)
    lines.push('Part of it looks like a key or a password; you chose to save it anyway.')
  if (facts.replacing) {
    lines.push(
      'Your old instructions for every chat could not be read: the app keeps a copy of that file beside it and does not use it.'
    )
  }
  lines.push(
    '',
    "Frontier App asks this in a window of its own, which the app's page cannot answer: text that goes out with every message needs your yes here."
  )
  return {
    title: 'Instructions for every chat',
    message: 'Save these instructions for every chat?',
    detail: lines.join('\n'),
    yes: 'Save the instructions',
    no: 'Cancel'
  }
}

export const EVERY_CHAT_NOT_SAVED = 'Not saved: your instructions for every chat are as they were.'
const EVERY_CHAT_BUSY = 'Your instructions for every chat are still being saved.'
const NOT_UNDERSTOOD = 'The instructions were not understood.'

/** The refusal of a request while the file cannot be read. */
export const everyChatUnreadable = (why: string): string =>
  `Nothing was sent: your instructions for every chat could not be read (${why}). Open Instructions to replace them or turn them off.`

export interface EveryChatService {
  status(): Promise<EveryChatStatus>
  /** Checks, looks for secrets, asks the person (for a new or changed text), and saves. */
  save(owner: unknown, input: unknown): Promise<SaveEveryChatResult>
  /** What goes into the next request: the text ('' for none), or the sentence that refuses the request. Never throws. */
  forRequest(): Promise<{ ok: true; text: string } | { ok: false; error: string }>
  /** The same look for secrets, for a chat's own instructions before the page keeps them. Saves nothing, asks nothing. */
  checkForChat(input: unknown): Promise<CheckChatInstructionsResult>
  /** The file, for encryption (conform) and the counts. */
  file: KeptFile<string>
}

export interface EveryChatOptions {
  pathOf: () => string
  box?: SecretBox
  writeMode: () => Promise<WriteMode>
  gate: QuestionGate
  /** The API keys saved in this app, by provider: a text that holds one is refused. */
  savedKeys: () => Promise<SavedKey[]>
}

const reason = (error: unknown): unknown => (error instanceof Error ? error.message : error)

/** The page's `{ text, saveAnyway }`, checked: the text must be text (main's own rule, trimmed, within the limit); only `true` is "Save anyway". */
function readInput(
  input: unknown
): { ok: true; text: string; saveAnyway: boolean } | { ok: false; error: string } {
  if (typeof input !== 'object' || input === null) return { ok: false, error: NOT_UNDERSTOOD }
  const { text, saveAnyway } = input as Record<string, unknown>
  if (typeof text !== 'string') return { ok: false, error: NOT_UNDERSTOOD }
  const checked = checkInstructions(text)
  if (!checked.ok) return checked
  return { ok: true, text: checked.instructions, saveAnyway: saveAnyway === true }
}

export function createEveryChat(options: EveryChatOptions): EveryChatService {
  const file = createKeptFile<string>({
    pathOf: options.pathOf,
    name: 'your instructions for every chat',
    parse: parseEveryChatFile,
    text: everyChatFileText,
    maxBytes: MAX_FILE_BYTES,
    box: options.box,
    writeMode: options.writeMode
  })
  let saving = false

  async function status(): Promise<EveryChatStatus> {
    const now = await file.read()
    if (now.state === 'unreadable') return { text: '', problem: now.why }
    return { text: now.state === 'ok' ? now.value : '', problem: null }
  }

  async function save(owner: unknown, input: unknown): Promise<SaveEveryChatResult> {
    const checked = readInput(input)
    if (!checked.ok) return checked
    const next = checked.text
    if (saving) return { ok: false, error: EVERY_CHAT_BUSY }
    saving = true
    try {
      const before = await file.read()
      const damaged = before.state === 'unreadable'
      if (!damaged && next === (before.state === 'ok' ? before.value : '')) {
        return { ok: true, status: await status() }
      }
      if (next !== '') {
        const secrets = checkForSecrets(
          next,
          await options.savedKeys(),
          checked.saveAnyway,
          'Instructions'
        )
        if (!secrets.ok) return secrets
        const answer = await options.gate.ask(
          owner,
          everyChatQuestion(next, { warned: secrets.warned, replacing: damaged })
        )
        if (answer === 'busy') return { ok: false, error: QUESTION_BUSY }
        if (answer === 'resting') return { ok: false, error: QUESTION_RESTING }
        if (answer === 'failed') return { ok: false, error: QUESTION_FAILED }
        if (answer === 'no') return { ok: false, cancelled: true, error: EVERY_CHAT_NOT_SAVED }
      }
      try {
        if (next === '') await file.remove({ replace: damaged })
        else await file.write(next, { replace: damaged })
      } catch (error) {
        if (error instanceof KeptRefused) return { ok: false, error: error.message }
        console.error('Saving the instructions for every chat failed:', reason(error))
        return {
          ok: false,
          error: 'Your instructions for every chat could not be saved on this computer.'
        }
      }
      return { ok: true, status: await status() }
    } finally {
      saving = false
    }
  }

  async function forRequest(): Promise<{ ok: true; text: string } | { ok: false; error: string }> {
    try {
      const now = await file.read()
      if (now.state === 'unreadable') return { ok: false, error: everyChatUnreadable(now.why) }
      return { ok: true, text: now.state === 'ok' ? now.value : '' }
    } catch (error) {
      console.error('Reading the instructions for every chat failed:', reason(error))
      return { ok: false, error: everyChatUnreadable('it could not be read from the disk') }
    }
  }

  async function checkForChat(input: unknown): Promise<CheckChatInstructionsResult> {
    const checked = readInput(input)
    if (!checked.ok) return checked
    if (checked.text === '') return { ok: true }
    const secrets = checkForSecrets(
      checked.text,
      await options.savedKeys(),
      checked.saveAnyway,
      'Instructions'
    )
    return secrets.ok ? { ok: true } : secrets
  }

  return { status, save, forRequest, checkForChat, file }
}
