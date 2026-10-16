// Checks that run on both sides: the page uses them to give quick feedback, and the main process runs
// them again, because it must never trust what the page sends. Plain functions, no Electron.

import {
  ATTACHMENT_LIMITS,
  cleanFileName,
  isAttachmentId,
  type AttachmentInfo,
  type AttachmentMediaType
} from './attachments'
import {
  CHAT_LIMITS,
  HISTORY_LIMITS,
  type BackupRequest,
  type ChatRequest,
  type SavedMessage,
  type WireAttachment,
  type WireMessage
} from './ipc'
import { isConversationId, isModelId } from './ids'
import { checkPictureNote, isPrompt } from './images'
import { isProjectId } from './projects'
import { SUPPORTED_PROVIDERS, type Effort, type ProviderId } from './registry'
import { checkToolNotes } from './toolNotes'

export const API_KEY_MIN_LENGTH = 20
export const API_KEY_MAX_LENGTH = 300

export type KeyCheck = { ok: true; key: string } | { ok: false; error: string }

/**
 * Checks the shape of an API key: visible characters only, no spaces or line breaks, a plausible
 * length. It cannot tell whether the provider will accept the key; only a real request shows that.
 */
export function checkApiKey(input: unknown): KeyCheck {
  if (typeof input !== 'string') return { ok: false, error: 'The key must be text.' }
  const key = input.trim()
  if (key === '') return { ok: false, error: 'Paste your API key first.' }
  if (key.length < API_KEY_MIN_LENGTH || key.length > API_KEY_MAX_LENGTH) {
    return {
      ok: false,
      error: `That does not look like an API key. It should be ${API_KEY_MIN_LENGTH} to ${API_KEY_MAX_LENGTH} characters long.`
    }
  }
  if (!/^[\x21-\x7e]+$/.test(key)) {
    return {
      ok: false,
      error:
        'That does not look like an API key. It must not contain spaces, line breaks or unusual characters.'
    }
  }
  return { ok: true, key }
}

export type ProviderCheck = { ok: true; provider: ProviderId } | { ok: false; error: string }

/**
 * Checks a provider named by the page: it must be exactly one the app can call. The id handed back is the app's own
 * string, never the page's, so nothing the page invents (an object that prints as a provider, a path) is used. A provider
 * becomes part of a key file's name (D-020), which is why this is checked here and again where the file is named.
 */
export function checkProvider(input: unknown): ProviderCheck {
  const match = SUPPORTED_PROVIDERS.find((provider) => provider === input)
  return match
    ? { ok: true, provider: match }
    : { ok: false, error: 'That provider is not available.' }
}

export type KeySubmissionCheck =
  { ok: true; provider: ProviderId; key: string } | { ok: false; error: string }

/** Checks "save this key for this provider" from the page: a known provider, and a key that has the shape of one. */
export function checkKeySubmission(input: unknown): KeySubmissionCheck {
  if (typeof input !== 'object' || input === null) {
    return { ok: false, error: 'The key was not understood.' }
  }
  const { provider, key } = input as Record<string, unknown>
  const checkedProvider = checkProvider(provider)
  if (!checkedProvider.ok) return checkedProvider
  const checkedKey = checkApiKey(key)
  if (!checkedKey.ok) return checkedKey
  return { ok: true, provider: checkedProvider.provider, key: checkedKey.key }
}

export type ModelChoiceCheck = { ok: true; modelId: string } | { ok: false; error: string }

/**
 * Checks a model choice from the page: it must be exactly the id of a model on offer. The id handed
 * back is the registry's own string, never the page's, so nothing the page invents is saved or used.
 */
export function checkModelChoice(
  input: unknown,
  models: readonly { id: string }[]
): ModelChoiceCheck {
  if (typeof input !== 'string') return { ok: false, error: 'The model choice was not understood.' }
  const match = models.find((model) => model.id === input)
  if (!match) return { ok: false, error: 'That model is not available.' }
  return { ok: true, modelId: match.id }
}

export type EffortChoiceCheck =
  { ok: true; modelId: string; level: Effort } | { ok: false; error: string }

/**
 * Checks an effort choice from the page (D-024): the id of a model on offer, and a level that model's own entry lists. Both must
 * match exactly (no other letter case, no padding), and the strings handed back are the registry's, never the page's, so nothing
 * the page invents is saved or used. A level another model takes, and this one does not, is refused.
 */
export function checkEffortChoice(
  input: unknown,
  models: readonly { id: string; capabilities: { effortLevels: readonly Effort[] } }[]
): EffortChoiceCheck {
  if (typeof input !== 'object' || input === null) {
    return { ok: false, error: 'The effort choice was not understood.' }
  }
  const { modelId, level } = input as Record<string, unknown>
  if (typeof modelId !== 'string' || typeof level !== 'string') {
    return { ok: false, error: 'The effort choice was not understood.' }
  }
  const model = models.find((candidate) => candidate.id === modelId)
  if (!model) return { ok: false, error: 'That model is not available.' }
  const match = model.capabilities.effortLevels.find((candidate) => candidate === level)
  if (!match) return { ok: false, error: 'That model does not take that effort level.' }
  return { ok: true, modelId: model.id, level: match }
}

export type InstructionsCheck = { ok: true; instructions: string } | { ok: false; error: string }

/**
 * Checks the person's instructions for a chat (D-027), from the page (a request, a save) or from a file: absent means none, anything
 * else must be text. The text handed back is trimmed, and is '' when there is nothing but white space, so a blank box never becomes
 * a line in the prompt. It may hold at most CHAT_LIMITS.maxInstructionsChars characters once trimmed. One function for every way in,
 * so what is sent, what is saved and what is read back are held to the same rule.
 */
export function checkInstructions(input: unknown): InstructionsCheck {
  if (input === undefined) return { ok: true, instructions: '' }
  if (typeof input !== 'string')
    return { ok: false, error: 'The instructions were not understood.' }
  const instructions = input.trim()
  if (instructions.length > CHAT_LIMITS.maxInstructionsChars) {
    return {
      ok: false,
      error: `The instructions are too long: the most is ${CHAT_LIMITS.maxInstructionsChars.toLocaleString('en-US')} characters, because they are sent with every message.`
    }
  }
  return { ok: true, instructions }
}

/**
 * The files named on one message of a request (D-037): a list of at most `ATTACHMENT_LIMITS.perMessage` `{ id, name }`, each id the spelling of a copy's
 * name and named once. The names come back cleaned (they are labels the model reads). Null when anything is not so.
 */
export function checkWireAttachments(input: unknown): WireAttachment[] | null {
  if (!Array.isArray(input) || input.length > ATTACHMENT_LIMITS.perMessage) return null
  const seen = new Set<string>()
  const files: WireAttachment[] = []
  for (const item of input) {
    if (typeof item !== 'object' || item === null) return null
    const { id, name } = item as Record<string, unknown>
    if (!isAttachmentId(id) || seen.has(id) || typeof name !== 'string' || name.length > 1000)
      return null
    seen.add(id)
    files.push({ id, name: cleanFileName(name, 'file') })
  }
  return files
}

const MEDIA_KIND: Record<AttachmentMediaType, AttachmentInfo['kind']> = {
  'image/png': 'image',
  'image/jpeg': 'image',
  'image/gif': 'image',
  'image/webp': 'image',
  'application/pdf': 'pdf',
  'text/plain': 'text'
}
const isCount = (value: unknown, max: number): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 1 && value <= max

/**
 * What a saved message says about one of its files (D-037), from the page or from a file: every field of `AttachmentInfo` and nothing else, each of its
 * kind (the type agrees with the kind; an image has its size, a PDF its pages, a text its characters and lines; the notes about what was done). It is a
 * description for the person; the copy itself is checked again when it is read. Null when anything is not so.
 */
export function checkAttachmentInfo(input: unknown): AttachmentInfo | null {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) return null
  const x = input as Record<string, unknown>
  const { id, name, kind, mediaType, bytes, changes } = x
  if (
    !isAttachmentId(id) ||
    typeof name !== 'string' ||
    name === '' ||
    cleanFileName(name, '') !== name
  )
    return null
  if (typeof mediaType !== 'string' || !(mediaType in MEDIA_KIND)) return null
  const type = mediaType as AttachmentMediaType
  if (kind !== MEDIA_KIND[type] || !isCount(bytes, ATTACHMENT_LIMITS.maxPdfBytes)) return null
  if (typeof changes !== 'object' || changes === null || Array.isArray(changes)) return null
  const c = changes as Record<string, unknown>
  const shrunk = c.shrunkFrom
  if (
    typeof c.metadataRemoved !== 'boolean' ||
    typeof c.turned !== 'boolean' ||
    !(
      shrunk === null ||
      (typeof shrunk === 'object' &&
        isCount((shrunk as Record<string, unknown>).width, ATTACHMENT_LIMITS.maxImageSide) &&
        isCount((shrunk as Record<string, unknown>).height, ATTACHMENT_LIMITS.maxImageSide))
    ) ||
    !(
      c.convertedFrom === null ||
      (typeof c.convertedFrom === 'string' && c.convertedFrom in MEDIA_KIND)
    )
  ) {
    return null
  }
  // What a file of this kind has besides the common fields, in the order `prepare` writes them (so a description reads back exactly as it was written).
  const kindOf = MEDIA_KIND[type]
  const facts: Partial<AttachmentInfo> = {}
  if (kindOf === 'image') {
    if (
      !isCount(x.width, ATTACHMENT_LIMITS.maxImageSide) ||
      !isCount(x.height, ATTACHMENT_LIMITS.maxImageSide)
    ) {
      return null
    }
    facts.width = x.width
    facts.height = x.height
  } else if (kindOf === 'pdf') {
    if (!isCount(x.pages, ATTACHMENT_LIMITS.maxPdfPages)) return null
    facts.pages = x.pages
  } else {
    if (
      !isCount(x.chars, ATTACHMENT_LIMITS.maxTextChars) ||
      !isCount(x.lines, ATTACHMENT_LIMITS.maxTextChars)
    ) {
      return null
    }
    facts.chars = x.chars
    facts.lines = x.lines
  }
  const info: AttachmentInfo = {
    id,
    name,
    kind: kindOf,
    mediaType: type,
    bytes,
    ...facts,
    changes: {
      metadataRemoved: c.metadataRemoved,
      shrunkFrom:
        shrunk === null
          ? null
          : {
              width: (shrunk as { width: number }).width,
              height: (shrunk as { height: number }).height
            },
      turned: c.turned,
      convertedFrom: c.convertedFrom as AttachmentMediaType | null
    }
  }
  const known = [
    'id',
    'name',
    'kind',
    'mediaType',
    'bytes',
    'changes',
    'width',
    'height',
    'pages',
    'chars',
    'lines'
  ]
  if (Object.keys(x).some((key) => !known.includes(key))) return null
  return info
}

const STREAM_ID = /^[A-Za-z0-9_-]{8,64}$/

export type ChatCheck =
  | { ok: true; request: ChatRequest }
  /** `streamId` is set when the id itself was fine, so the error can still be delivered to the page. */
  | { ok: false; error: string; streamId?: string }

/**
 * Checks a reply request from the page and returns a clean copy (only the fields we know about).
 * The conversation must start and end with a message from the person: models no longer accept a
 * reply that begins by continuing the assistant's own text. The person's instructions (D-027) are kept
 * only when there is something in them.
 */
export function checkChatRequest(input: unknown): ChatCheck {
  if (typeof input !== 'object' || input === null) {
    return { ok: false, error: 'The request was not understood.' }
  }
  const { streamId, messages, instructions, conversationId, projectId } = input as Record<
    string,
    unknown
  >
  if (typeof streamId !== 'string' || !STREAM_ID.test(streamId)) {
    return { ok: false, error: 'The request was not understood.' }
  }
  const refuse = (error: string): ChatCheck => ({ ok: false, error, streamId })
  const checkedInstructions = checkInstructions(instructions)
  if (!checkedInstructions.ok) return refuse(checkedInstructions.error)
  // The conversation the cost is shown under (D-030): absent, or exactly the spelling of an id the app makes. Anything else is a page
  // that is not ours, or a bug, and is refused instead of being quietly dropped.
  // The project (D-039): absent, or the spelling of a project id; main reads the project itself.
  if (projectId !== undefined && !isProjectId(projectId)) {
    return refuse('The request was not understood.')
  }
  if (conversationId !== undefined && !isConversationId(conversationId)) {
    return refuse('The request was not understood.')
  }

  if (!Array.isArray(messages) || messages.length === 0) return refuse('There is nothing to send.')
  if (messages.length > CHAT_LIMITS.maxMessages) {
    return refuse(
      `This conversation has more than ${CHAT_LIMITS.maxMessages} messages, which is too many to send.`
    )
  }
  const clean: WireMessage[] = []
  let totalChars = 0
  // Every file the conversation names (each is sent again with every message, D-028): a chat may hold at most `perChat` of them (D-037).
  const files = new Set<string>()
  for (const item of messages) {
    if (typeof item !== 'object' || item === null) return refuse('The request was not understood.')
    const { role, content, attachments } = item as Record<string, unknown>
    if ((role !== 'user' && role !== 'assistant') || typeof content !== 'string') {
      return refuse('The request was not understood.')
    }
    // Files belong to the person's own messages only; an empty list is the same as none, and a message of the person's may have files and no text.
    let named: WireAttachment[] = []
    if (attachments !== undefined) {
      const checked = role === 'user' ? checkWireAttachments(attachments) : null
      if (checked === null) return refuse('The request was not understood.')
      named = checked
    }
    if (content === '' && named.length === 0) return refuse('The request was not understood.')
    if (content.length > CHAT_LIMITS.maxMessageChars)
      return refuse('A message is too long to send.')
    totalChars += content.length
    for (const file of named) files.add(file.id)
    clean.push(named.length === 0 ? { role, content } : { role, content, attachments: named })
  }
  if (files.size > ATTACHMENT_LIMITS.perChat) {
    return refuse(
      `This chat has more than ${ATTACHMENT_LIMITS.perChat} files, which is too many to send. Start a new chat.`
    )
  }
  if (totalChars > CHAT_LIMITS.maxTotalChars) {
    return refuse(
      'This conversation is too long to send: the whole conversation is sent again with every message. Start a new chat.'
    )
  }
  if (clean[0].role !== 'user' || clean[clean.length - 1].role !== 'user') {
    return refuse('The request was not understood.')
  }
  return {
    ok: true,
    request: {
      streamId,
      messages: clean,
      ...(checkedInstructions.instructions === ''
        ? {}
        : { instructions: checkedInstructions.instructions }),
      ...(conversationId === undefined ? {} : { conversationId }),
      ...(projectId === undefined ? {} : { projectId })
    }
  }
}

// A conversation's id (the one spelling crypto.randomUUID() makes) and a model's id are checked in ids.ts (16.5: their own file, so that no shared module needs a loop
// of imports to use them); they are exported from here as before.
export { isConversationId, isModelId }

/**
 * The chat a usage summary is asked for (D-030): a conversation id, or null for none. Anything else is read as none (the summary then has
 * no chat sum), because the day's and the month's sums do not depend on it.
 */
export const chatForUsage = (input: unknown): string | null =>
  isConversationId(input) ? input : null

export type ConversationIdCheck = { ok: true; id: string } | { ok: false; error: string }

export type BackupRequestCheck = { ok: true; request: BackupRequest } | { ok: false; error: string }

/** Checks what the page wants backed up (D-034): every chat, or one chat by id. Nothing else is read from it, and it can never carry a path. */
export function checkBackupRequest(input: unknown): BackupRequestCheck {
  const bad = { ok: false, error: 'The backup was not understood.' } as const
  if (typeof input !== 'object' || input === null) return bad
  const { scope, id } = input as Record<string, unknown>
  if (scope === 'all') return { ok: true, request: { scope: 'all' } }
  if (scope === 'one' && isConversationId(id)) return { ok: true, request: { scope: 'one', id } }
  return bad
}

export type AttachmentBytesCheck =
  { ok: true; name: string; bytes: Uint8Array } | { ok: false; error: string }

/**
 * Checks a pasted or dropped file from the page (D-037): `{ name, bytes }`, the bytes a Uint8Array of at most `maxBytes` (looked at before anything is
 * copied) and the name text of at most 1,000 characters (it is a label: main cleans it). Nothing else is read from it, so it can never carry a path that
 * main would open.
 */
export function checkAttachmentBytes(input: unknown, maxBytes: number): AttachmentBytesCheck {
  const bad = { ok: false, error: 'The file was not understood.' } as const
  if (typeof input !== 'object' || input === null) return bad
  const { name, bytes } = input as Record<string, unknown>
  if (typeof name !== 'string' || name.length > 1000 || !(bytes instanceof Uint8Array)) return bad
  if (bytes.byteLength > maxBytes) {
    return {
      ok: false,
      error: `The file was not attached: it is larger than ${Math.round(maxBytes / (1024 * 1024))} MB.`
    }
  }
  return { ok: true, name, bytes }
}

/** Checks an id from the page, for loading or deleting a saved conversation. */
export function checkConversationId(input: unknown): ConversationIdCheck {
  return isConversationId(input)
    ? { ok: true, id: input }
    : { ok: false, error: 'The conversation was not understood.' }
}

/**
 * Where a list of messages comes from, which decides how the two fields that say who wrote a reply (D-021) are read:
 *  - 'page'    : the page is saving. Strict: a provider the app does not know, or a model that is not an id, refuses the save.
 *  - 'file'    : a version 2 file. Forgiving: what cannot be used is read as null, because the conversation is still worth reading.
 *  - 'file-v1' : a version 1 file (Stages 2-4) has no such fields. Every reply in it came from Anthropic, the only provider
 *                then, and which model it was is not known and cannot be worked out: provider "anthropic", model null.
 */
export type MessageSource = 'page' | 'file' | 'file-v1'

function answererOf(
  item: Record<string, unknown>,
  source: MessageSource
): { provider: ProviderId | null; model: string | null } | null {
  if (source === 'file-v1') return { provider: 'anthropic', model: null }
  const lenient = source === 'file'
  let provider: ProviderId | null = null
  if (item.provider !== undefined && item.provider !== null) {
    const match = SUPPORTED_PROVIDERS.find((known) => known === item.provider)
    if (match === undefined) {
      if (!lenient) return null
    } else provider = match
  }
  let model: string | null = null
  if (item.model !== undefined && item.model !== null) {
    if (isModelId(item.model)) model = item.model
    else if (!lenient) return null
  }
  // A model with no provider says nothing a person could use: refused from the page, read as unknown from a file.
  if (provider === null && model !== null) {
    if (!lenient) return null
    model = null
  }
  return { provider, model }
}

export type MessagesCheck = { ok: true; messages: SavedMessage[] } | { ok: false; error: string }

/**
 * Checks the messages of a conversation to be saved, whether they come from the page or are read back from a
 * file, and returns a clean copy (only the fields we know about). A message that is still "streaming" is
 * kept as "stopped": a reply that is cut off by closing the window never finishes. The first message must
 * be the person's, as it is in every conversation the app makes. A reply says which model wrote it (`answererOf`);
 * the person's own messages never carry those fields, and whatever the page claims on one is dropped.
 */
export function checkSavedMessages(
  input: unknown,
  source: MessageSource = 'page',
  /** Files are read on the person's messages (D-037): from the page, and from a file of version 4. An older file's messages are read without them. */
  filesAllowed: boolean = source === 'page',
  /** Tool calls are read on a reply (D-041, 11.4): from the page, and from a file of version 6. An older file's messages are read without them. */
  toolsAllowed: boolean = source === 'page',
  /** A picture note is read on a message of the person's (D-048, 16.5): from the page, and from a file of version 7. An older file's messages are read without one. */
  picturesAllowed: boolean = source === 'page'
): MessagesCheck {
  const refuse = (error: string): MessagesCheck => ({ ok: false, error })
  if (!Array.isArray(input) || input.length === 0) return refuse('There is nothing to save.')
  // The count is looked at before the items, so a huge list costs nothing to refuse.
  if (input.length > HISTORY_LIMITS.maxMessages) {
    return refuse(
      `This conversation has more than ${HISTORY_LIMITS.maxMessages} messages, which is too many to save.`
    )
  }
  const messages: SavedMessage[] = []
  let totalChars = 0
  const chatFiles = new Set<string>()
  for (const item of input) {
    if (typeof item !== 'object' || item === null)
      return refuse('The conversation was not understood.')
    const { role, content, status, error, attachments, tools, picture } = item as Record<
      string,
      unknown
    >
    // The files of a message of the person's (D-037): each described in full and named once; at most `perMessage`. A message may have files and no text.
    let files: AttachmentInfo[] | null = null
    if (attachments !== undefined && filesAllowed) {
      if (
        role !== 'user' ||
        !Array.isArray(attachments) ||
        attachments.length === 0 ||
        attachments.length > ATTACHMENT_LIMITS.perMessage
      ) {
        return refuse('The conversation was not understood.')
      }
      files = []
      for (const one of attachments) {
        const info = checkAttachmentInfo(one)
        if (info === null || files.some((there) => there.id === info.id)) {
          return refuse('The conversation was not understood.')
        }
        files.push(info)
        chatFiles.add(info.id)
      }
    }
    if (
      (role !== 'user' && role !== 'assistant') ||
      typeof content !== 'string' ||
      (status !== 'done' && status !== 'stopped' && status !== 'error' && status !== 'streaming') ||
      (role === 'user' && content.trim() === '' && files === null)
    ) {
      return refuse('The conversation was not understood.')
    }
    if (content.length > HISTORY_LIMITS.maxMessageChars)
      return refuse('A message is too long to save.')
    totalChars += content.length
    if (totalChars > HISTORY_LIMITS.maxTotalChars)
      return refuse('This conversation is too long to save.')
    const message: SavedMessage = {
      role,
      content,
      status: status === 'streaming' ? 'stopped' : status
    }
    if (status === 'error' && error !== undefined) {
      if (typeof error !== 'string' || error.length > HISTORY_LIMITS.maxErrorChars) {
        return refuse('The conversation was not understood.')
      }
      message.error = error
    }
    if (role === 'assistant') {
      const answerer = answererOf(item as Record<string, unknown>, source)
      if (answerer === null) return refuse('The conversation was not understood.')
      message.provider = answerer.provider
      message.model = answerer.model
    }
    if (files !== null) message.attachments = files
    // A request for pictures (D-048, 16.5): only on a message of the person's that is done, whose text is the description as typed, and that carries no files.
    if (picture !== undefined && picturesAllowed) {
      const note = checkPictureNote(picture)
      if (
        note === null ||
        role !== 'user' ||
        status !== 'done' ||
        files !== null ||
        !isPrompt(content)
      ) {
        return refuse('The conversation was not understood.')
      }
      message.picture = note
    }
    // The tool calls of a reply (D-041, 11.4): each checked field by field, standing within the reply's own text; on a message that is not a reply they are an error.
    if (tools !== undefined && toolsAllowed) {
      const notes = role === 'assistant' ? checkToolNotes(tools, content.length) : null
      if (notes === null) return refuse('The conversation was not understood.')
      message.tools = notes
    }
    messages.push(message)
  }
  if (chatFiles.size > ATTACHMENT_LIMITS.perChat) {
    return refuse(
      `This conversation has more than ${ATTACHMENT_LIMITS.perChat} files, which is too many to save.`
    )
  }
  if (messages[0].role !== 'user') return refuse('The conversation was not understood.')
  return { ok: true, messages }
}

export type SaveCheck =
  | {
      ok: true
      conversation: { id: string; messages: SavedMessage[]; instructions: string; project?: string }
    }
  | { ok: false; error: string }

/**
 * Checks a conversation the page wants saved. Only the id, the messages and the person's instructions (D-027) are taken: the title
 * and the dates are worked out by the main process, never by the page. The instructions come back as text ('' for none).
 */
export function checkConversationSave(input: unknown): SaveCheck {
  if (typeof input !== 'object' || input === null) {
    return { ok: false, error: 'The conversation was not understood.' }
  }
  const { id, messages, instructions, project } = input as Record<string, unknown>
  if (!isConversationId(id)) return { ok: false, error: 'The conversation was not understood.' }
  // The project (D-039): absent, or the spelling of a project id; whether it exists is main's to say.
  if (project !== undefined && !isProjectId(project)) {
    return { ok: false, error: 'The conversation was not understood.' }
  }
  const checked = checkSavedMessages(messages)
  if (!checked.ok) return checked
  const checkedInstructions = checkInstructions(instructions)
  if (!checkedInstructions.ok) return checkedInstructions
  return {
    ok: true,
    conversation: {
      id,
      messages: checked.messages,
      instructions: checkedInstructions.instructions,
      ...(project !== undefined ? { project } : {})
    }
  }
}
