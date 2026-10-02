import { ipcMain, type WebContents } from 'electron'
import { CHANNELS, type ChatRequest, type ChatStreamEvent } from '../shared/ipc'
import { PROVIDER_NAMES, type ProviderId } from '../shared/registry'
import {
  costOfRecord,
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
import { baseUrlOverride } from './baseUrl'
import { readApiKey } from './keyStore'
import { currentModel } from './models'
import { adapterFor } from './providers'
import { describeFailure, unknownError } from './providers/errors'
import { buildStreamRequest } from './providers/request'
import type { ErrorKind, ProviderAdapter, ReplyEnd, Usage } from './providers/types'
import { isTrustedSender } from './security'
import type { UsageLedger } from './usageLedger'

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

async function runReply(
  windowId: number,
  request: ChatRequest,
  send: (event: ChatStreamEvent) => void,
  ledger: UsageLedger
): Promise<void> {
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
    const streamRequest = buildStreamRequest({
      credentials: { apiKey, baseURL: baseUrlOverride(entry.provider) },
      model: entry,
      effort,
      instructions: request.instructions, // the person's own, already checked (D-027): added after the app's rules
      messages: request.messages,
      signal: controller.signal
    })
    // Counted BEFORE it is sent (D-030): a request that cannot be written down is not made, so nothing is spent that is not on record.
    try {
      began = await ledger.begin({
        chat: request.conversationId ?? null,
        provider: entry.provider,
        model: entry.id,
        effort,
        prices: entry.pricing,
        inputTokens: estimateInputTokens(streamRequest.system, streamRequest.messages)
      })
    } catch (error) {
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
export function registerChatIpc(appUrl: string, ledger: UsageLedger): void {
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
    void runReply(sender.id, check.request, send, ledger)
  })

  ipcMain.on(CHANNELS.chatCancel, (event, streamId: unknown) => {
    if (!isTrustedSender(event, appUrl) || typeof streamId !== 'string') return
    running.get(`${event.sender.id}:${streamId}`)?.abort()
  })
}
