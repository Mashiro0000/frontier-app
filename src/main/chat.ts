import { ipcMain, type WebContents } from 'electron'
import { askFirstAmount, estimateRequest, needsConfirmation } from '../shared/askFirst'
import { CHANNELS, type ChatRequest, type ChatStreamEvent } from '../shared/ipc'
import { checkAgainstLimits, withFilesNote, type Limits } from '../shared/limits'
import { PROVIDER_NAMES, type ProviderId } from '../shared/registry'
import {
  costOf,
  costOfRecord,
  estimateFileTokens,
  estimateInputTokens,
  estimateOutputTokens,
  NO_TOKENS,
  tokensAreEmpty,
  type LedgerRecord,
  type LedgerState,
  type ReplyUsage,
  type TokenCounts
} from '../shared/usage'
import { checkChatRequest } from '../shared/validate'
import type { AskFirstStore } from './askFirst'
import { resolveAttachments } from './attachmentRequest'
import type { ReadResult } from './attachmentStore'
import { baseUrlOverride } from './baseUrl'
import { createConfirmations } from './confirmation'
import { readApiKey } from './keyStore'
import { currentModel } from './models'
import type { LimitsStore } from './limits'
import { adapterFor } from './providers'
import { describeFailure, unknownError } from './providers/errors'
import { buildStreamRequest } from './providers/request'
import type { ErrorKind, ProviderAdapter, ReplyEnd, Usage } from './providers/types'
import { heldKey, keyInInstructions, type SavedKey } from './secrets'
import { isTrustedSender } from './security'
import { RequestRefused, type UsageLedger } from './usageLedger'

const noKeyMessage = (provider: ProviderId): string =>
  `No API key is saved yet. Open Settings and add your ${PROVIDER_NAMES[provider]} API key.`

/**
 * Failures that mean the provider turned the request away before doing any work, so nothing is owed for it: a key, a permission, a
 * model, a rate or a credit it would not accept, a request it could not take, a connection that never reached it, or a provider too
 * busy to start. Every other failure may have cost something (a connection dropped in the middle of a reply, a timeout, a server
 * error) and is counted as a guess (D-030), as is any failure that came after some text had arrived.
 */
const REFUSED_BEFORE_WORK: ReadonlySet<ErrorKind> = new Set([
  'auth',
  'permission',
  'not-found',
  'rate-limit',
  'quota',
  'bad-request',
  'connection',
  'overloaded'
])

const tokensOf = (usage: Usage): TokenCounts => ({
  input: usage.inputTokens,
  cacheRead: usage.cacheReadTokens,
  cacheWrite: usage.cacheWriteTokens,
  output: usage.outputTokens
})

const replyUsageOf = (record: LedgerRecord): ReplyUsage => ({
  tokens: record.tokens,
  costUsd: costOfRecord(record),
  estimate: record.estimate
})

/** Replies in progress, by "<window id>:<stream id>", so each one can be stopped on its own. */
const running = new Map<string, AbortController>()
const watched = new WeakSet<WebContents>()
/** Large requests waiting for the person's yes (D-032), under the same keys as `running`: a yes is heard only for a question that is waiting. */
const confirmations = createConfirmations()

function stopAllFor(windowId: number): void {
  for (const [key, controller] of running) {
    if (key.startsWith(`${windowId}:`)) controller.abort()
  }
}

/** A reply nobody is waiting for any more should not keep running (and costing money). */
function stopWhenPageGoes(sender: WebContents): void {
  if (watched.has(sender)) return
  watched.add(sender)
  const id = sender.id
  sender.once('destroyed', () => stopAllFor(id))
  sender.on('did-start-navigation', (details) => {
    if (details.isMainFrame && !details.isSameDocument) stopAllFor(id) // a reload, for example
  })
}

function endEvent(streamId: string, end: ReplyEnd): ChatStreamEvent {
  switch (end.kind) {
    case 'cut-off':
      return {
        streamId,
        type: 'error',
        message: 'The reply reached the length limit and was cut off.'
      }
    case 'declined':
      return {
        streamId,
        type: 'error',
        message: `The model declined to answer this${end.category ? ` (${end.category})` : ''}.`
      }
    case 'context-full':
      return {
        streamId,
        type: 'error',
        message: 'The conversation has grown too long for the model to continue.'
      }
    default:
      return { streamId, type: 'done' }
  }
}

/**
 * What a reply needs besides the request: the stores it counts and checks against, the reader of the attachments' copies (D-037), the person's
 * instructions for every chat and the saved keys (D-039).
 */
interface ReplyContext {
  ledger: UsageLedger
  limitsStore: LimitsStore
  askFirstStore: AskFirstStore
  readAttachment: (id: string) => Promise<ReadResult>
  /** The instructions for every chat, from main's own file: the text ('' for none), or the sentence that refuses the request while it cannot be read. */
  everyChat: () => Promise<{ ok: true; text: string } | { ok: false; error: string }>
  /** The API keys saved in this app: none of them goes out inside instructions. */
  savedKeys: () => Promise<SavedKey[]>
}

async function runReply(
  windowId: number,
  request: ChatRequest,
  send: (event: ChatStreamEvent) => void,
  context: ReplyContext
): Promise<void> {
  const { ledger, limitsStore, askFirstStore } = context
  const { streamId } = request
  const key = `${windowId}:${streamId}`
  if (running.has(key)) {
    send({ streamId, type: 'error', message: 'That reply is already running.' })
    return
  }
  const controller = new AbortController()
  running.set(key, controller)
  let apiKey = ''
  let modelId = ''
  let adapter: ProviderAdapter | null = null
  // The ledger's record of this request (D-030): made just before it is sent, and settled exactly once, with the provider's own report
  // when there is one, with a guess marked as one when there is not, or as "nothing owed" when the provider turned it away.
  let began: LedgerRecord | null = null
  const settledAs: { record: LedgerRecord | null } = { record: null }
  let arrivedBytes = 0

  const settle = async (state: Exclude<LedgerState, 'sent'>, real: Usage | null): Promise<void> => {
    if (began === null || settledAs.record !== null) return
    const report = real !== null && !tokensAreEmpty(tokensOf(real)) ? tokensOf(real) : null
    // With no report (a reply stopped, a connection dropped, a provider that said nothing): the input that was sent and the text that
    // arrived, as a guess. Nothing at all for a request that was turned away.
    const tokens: TokenCounts =
      state === 'rejected'
        ? { ...NO_TOKENS }
        : (report ?? {
            ...NO_TOKENS,
            input: began.tokens.input,
            output: estimateOutputTokens(arrivedBytes)
          })
    const finished = await ledger.finish(began.id, {
      state,
      tokens,
      estimate: state !== 'rejected' && report === null
    })
    if (finished) settledAs.record = finished.record
  }

  /** Tells the page what the reply cost, if anything is owed. Called just before the reply's last event. */
  const sendUsage = (): void => {
    const { record } = settledAs
    if (record !== null && record.state !== 'rejected') {
      send({ streamId, type: 'usage', usage: replyUsageOf(record) })
    }
  }

  try {
    // The model is fixed here, for this whole reply: a later change of model applies from the next one. Its provider
    // decides which adapter answers, and which key goes with the request.
    const model = await currentModel()
    if (!model.ok) {
      send({ streamId, type: 'error', message: model.error })
      return
    }
    const { entry, effort } = model // fixed with the model, for this whole reply (D-024)
    adapter = adapterFor(entry.provider)
    modelId = entry.id
    // Before anything else is looked up or sent, say who answers (D-021): the page records it on the reply, so even a reply
    // that fails at once (no key, a key that is refused) says which model was asked. Nothing secret is in it.
    send({ streamId, type: 'start', provider: entry.provider, model: entry.id })
    // Each provider has a key of its own (D-020): the one that goes with this model's provider, and no other.
    const saved = await readApiKey(entry.provider)
    if (saved === null) {
      send({ streamId, type: 'error', message: noKeyMessage(entry.provider) })
      return
    }
    apiKey = saved
    // The files of the conversation (D-037): read from main's own copies and checked, every time, before anything is counted or sent. A file that cannot be
    // read, a kind of file the model cannot read, or files over the caps of one request: nothing is sent, and the person is told why.
    const resolved = await resolveAttachments(request.messages, entry, context.readAttachment)
    if (!resolved.ok) {
      send({ streamId, type: 'error', message: resolved.error })
      return
    }
    // The person's instructions for every chat (D-039), from main's own file and never from the page, read for every request. A file that cannot be read
    // refuses the request: a chat is never sent without them in silence.
    const everyChat = await context.everyChat()
    if (!everyChat.ok) {
      send({ streamId, type: 'error', message: everyChat.error })
      return
    }
    // No API key saved in this app goes out inside instructions, whichever part holds it: the person may have pasted one before saving it in Settings.
    const keys = await context.savedKeys()
    for (const [whose, text] of [
      ['for every chat', everyChat.text],
      ['for this chat', request.instructions ?? '']
    ] as const) {
      const held = heldKey(text, keys)
      if (held !== null) {
        send({ streamId, type: 'error', message: keyInInstructions(held, whose) })
        return
      }
    }
    const streamRequest = buildStreamRequest({
      credentials: { apiKey, baseURL: baseUrlOverride(entry.provider) },
      model: entry,
      effort,
      instructions: request.instructions, // the person's own, already checked (D-027): added after the app's rules
      everyChat: everyChat.text, // before the chat's own (D-039)
      messages: resolved.messages,
      signal: controller.signal
    })
    // One guess at what this request sends, used three times and the same each time: for the question below (D-032), for the limit's check
    // (D-031) and for the ledger's first line (D-030). The files are part of it (D-037): images by their size, PDFs by their pages, text by its bytes;
    // and so are all the instructions, which are in the system prompt (D-039).
    const fileTokens = estimateFileTokens(resolved.files)
    const files =
      resolved.files.count > 0 ? { count: resolved.files.count, tokens: fileTokens } : undefined
    const inputTokens =
      estimateInputTokens(streamRequest.system, streamRequest.messages) + fileTokens
    // The spending limits (D-031), as they are now. They are asked for on EVERY request, whichever way it came (a new message, Regenerate,
    // an edited message): this is the only place a provider is called. A file that cannot be read at all refuses the request (null, after
    // the page has been told), and so does a limit that has not been chosen yet.
    const readLimits = async (): Promise<Limits | null> => {
      try {
        return await limitsStore.read()
      } catch (error) {
        // Logged here only; the message could name a file path.
        console.error('Reading the limits failed:', error instanceof Error ? error.message : error)
        send({
          streamId,
          type: 'error',
          message: 'Nothing was sent: the spending limits could not be read on this computer.'
        })
        return null
      }
    }
    // A very large request is asked about BEFORE anything is written or sent (D-032): what it could cost at the most is shown to the person,
    // and it goes only on their yes. Nothing is begun in the ledger while the question is open, so a request that is never answered never counts.
    // The answer comes from `confirmations`, which hears a yes only for a question that is waiting.
    const estimate = estimateRequest(
      inputTokens,
      streamRequest.maxOutputTokens,
      entry.pricing,
      files
    )
    const askFirst = await askFirstStore.read() // never throws: damage to the file is "nothing chosen", and the default asks
    const askAbove = askFirstAmount(askFirst)
    if (askAbove !== null && needsConfirmation(askFirst, estimate)) {
      const before = await readLimits()
      if (before === null) return
      // A request the limits will refuse anyway is not asked about: the person is told why it cannot go. This look is only so that the question is not
      // wasted; the check that counts is the one inside `begin`, below, which runs again after the yes.
      let refusal: string | null = null
      try {
        const sums = await ledger.summary(null)
        refusal = withFilesNote(
          checkAgainstLimits(before, {
            today: sums.today.costUsd,
            month: sums.month.costUsd,
            request: costOf({ ...NO_TOKENS, input: inputTokens }, entry.pricing)
          }),
          files
        )
      } catch {
        // The ledger could not be read: `begin` below fails the same way and says so. The question is asked meanwhile.
      }
      if (refusal !== null) {
        send({ streamId, type: 'error', message: refusal })
        return
      }
      const answer = await confirmations.ask(key, controller.signal, () =>
        send({ streamId, type: 'confirm', model: entry.id, estimate, askAboveUsd: askAbove })
      )
      // No yes: the person said no, or the window went away. Nothing was sent and nothing was written. (A yes and a Stop at the same moment: Stop wins.)
      if (answer !== 'send' || controller.signal.aborted) return
    }
    // Read again, after any wait: what is checked is what the limits are NOW.
    const limits = await readLimits()
    if (limits === null) return
    // Counted BEFORE it is sent (D-030): a request that cannot be written down is not made, so nothing is spent that is not on record. The
    // limit is checked in the same turn (D-031): what has been spent and the line that adds this request to it cannot be parted by another.
    try {
      began = await ledger.begin(
        {
          chat: request.conversationId ?? null,
          provider: entry.provider,
          model: entry.id,
          effort,
          prices: entry.pricing,
          inputTokens
        },
        (spend) => withFilesNote(checkAgainstLimits(limits, spend), files)
      )
    } catch (error) {
      if (error instanceof RequestRefused) {
        send({ streamId, type: 'error', message: error.message }) // a sentence for the person, naming the limit; nothing was written
        return
      }
      // Logged here only; the message could name a file path.
      console.error(
        'Writing to the usage ledger failed:',
        error instanceof Error ? error.message : error
      )
      send({
        streamId,
        type: 'error',
        message:
          'Nothing was sent: what this request would use could not be recorded on this computer.'
      })
      return
    }
    let end: ReplyEnd | null = null
    let usage: Usage | null = null
    for await (const event of adapter.stream(streamRequest)) {
      if (event.type === 'text') {
        arrivedBytes += Buffer.byteLength(event.text)
        send({ streamId, type: 'text', text: event.text })
      } else {
        end = event.end
        usage = event.usage
      }
    }
    // An adapter ends every reply that did not fail with an `end` event. Saying "done" without one would hide a bug.
    if (end === null) throw new Error('the provider ended the reply without saying how it ended')
    // The provider's report is counted even if the person pressed Stop at the last moment: the reply was made, and billed.
    await settle(controller.signal.aborted ? 'stopped' : 'done', usage)
    if (!controller.signal.aborted) {
      // What the reply used, once, for the log (D-018, D-021). It is not stored with the message and never holds a key.
      if (usage) {
        console.log(
          `Reply from ${entry.provider}/${entry.id} used ${usage.inputTokens} input, ${usage.cacheReadTokens} cache-read, ${usage.cacheWriteTokens} cache-write and ${usage.outputTokens} output tokens.`
        )
      }
      sendUsage()
      send(endEvent(streamId, end))
    }
  } catch (error) {
    // Stopped by the person (or the page went away): not a failure, and nobody is listening. What it used is still counted.
    if (controller.signal.aborted) {
      await settle('stopped', null)
      return
    }
    const failure = adapter ? adapter.normalizeError(error, { modelId }) : unknownError(error)
    await settle(
      REFUSED_BEFORE_WORK.has(failure.kind) && arrivedBytes === 0 ? 'rejected' : 'failed',
      null
    )
    sendUsage()
    send({ streamId, type: 'error', message: describeFailure(failure, apiKey) })
  } finally {
    // Whatever happened, a request that was begun is ended in the ledger: a throw while sending an event, for instance, lands here.
    await settle('failed', null)
    running.delete(key)
  }
}

/** Registers the chat messages. Called from registerIpc, after the app is ready. */
export function registerChatIpc(appUrl: string, context: ReplyContext): void {
  ipcMain.on(CHANNELS.chatStart, (event, raw: unknown) => {
    if (!isTrustedSender(event, appUrl)) return // nobody to answer: it is not our page
    const sender = event.sender
    const send = (reply: ChatStreamEvent): void => {
      if (!sender.isDestroyed()) sender.send(CHANNELS.chatEvent, reply)
    }
    const check = checkChatRequest(raw)
    if (!check.ok) {
      if (check.streamId) send({ streamId: check.streamId, type: 'error', message: check.error })
      return
    }
    stopWhenPageGoes(sender)
    void runReply(sender.id, check.request, send, context)
  })

  ipcMain.on(CHANNELS.chatCancel, (event, streamId: unknown) => {
    if (!isTrustedSender(event, appUrl) || typeof streamId !== 'string') return
    running.get(`${event.sender.id}:${streamId}`)?.abort()
  })

  // The person's yes to a large request that is waiting (D-032). Heard only from a window that is asking, for its own stream and only while the
  // question is waiting: a yes sent ahead of the question, twice, or for a stream that is not asking finds nobody and is dropped.
  ipcMain.on(CHANNELS.chatConfirm, (event, streamId: unknown) => {
    if (!isTrustedSender(event, appUrl) || typeof streamId !== 'string') return
    confirmations.send(`${event.sender.id}:${streamId}`)
  })
}
