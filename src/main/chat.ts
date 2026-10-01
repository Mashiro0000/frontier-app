import { app, ipcMain, type WebContents } from 'electron'
import { CHANNELS, type ChatRequest, type ChatStreamEvent } from '../shared/ipc'
import { PROVIDER_NAMES, type ProviderId } from '../shared/registry'
import { checkChatRequest } from '../shared/validate'
import { readApiKey } from './keyStore'
import { currentModel } from './models'
import { adapterFor } from './providers'
import { describeFailure, unknownError } from './providers/errors'
import { buildStreamRequest } from './providers/request'
import type { ProviderAdapter, ReplyEnd } from './providers/types'
import { isTrustedSender } from './security'

const noKeyMessage = (provider: ProviderId): string =>
  `No API key is saved yet. Open Settings and add your ${PROVIDER_NAMES[provider]} API key.`

/** Replies in progress, by "<window id>:<stream id>", so each one can be stopped on its own. */
const running = new Map<string, AbortController>()
const watched = new WeakSet<WebContents>()

/**
 * For testing the whole path without the real service: FRONTIER_API_BASE_URL points the app at a
 * fake server on this computer. It works only when running from source, never in an installed app,
 * so nothing outside could redirect where a real key is sent.
 */
let warnedAboutOverride = false

function baseUrlOverride(provider: ProviderId): string | undefined {
  const value = process.env['FRONTIER_API_BASE_URL']
  if (!value || app.isPackaged) return undefined
  try {
    const { protocol } = new URL(value)
    if (protocol === 'http:' || protocol === 'https:') {
      // Said once, loudly: requests (and the saved key) are going somewhere other than the provider.
      if (!warnedAboutOverride) {
        warnedAboutOverride = true
        console.warn(
          `FRONTIER_API_BASE_URL is set: requests go to ${value}, NOT to ${PROVIDER_NAMES[provider]}.`
        )
      }
      return value
    }
  } catch {
    // fall through to the warning
  }
  console.warn('Ignoring FRONTIER_API_BASE_URL: it is not an http(s) address.')
  return undefined
}

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
  send: (event: ChatStreamEvent) => void
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
  try {
    // The model is fixed here, for this whole reply: a later change of model applies from the next one. Its provider
    // decides which adapter answers, and which key goes with the request.
    const model = await currentModel()
    if (!model.ok) {
      send({ streamId, type: 'error', message: model.error })
      return
    }
    const { entry } = model
    adapter = adapterFor(entry.provider)
    modelId = entry.id
    // Until each provider has a key of its own (D-020), there is the one key, and the one provider it belongs to.
    const saved = await readApiKey()
    if (saved === null) {
      send({ streamId, type: 'error', message: noKeyMessage(entry.provider) })
      return
    }
    apiKey = saved
    let end: ReplyEnd | null = null
    const stream = adapter.stream(
      buildStreamRequest({
        credentials: { apiKey, baseURL: baseUrlOverride(entry.provider) },
        model: entry,
        messages: request.messages,
        signal: controller.signal
      })
    )
    for await (const event of stream) {
      if (event.type === 'text') send({ streamId, type: 'text', text: event.text })
      else end = event.end
    }
    // An adapter ends every reply that did not fail with an `end` event. Saying "done" without one would hide a bug.
    if (end === null) throw new Error('the provider ended the reply without saying how it ended')
    if (!controller.signal.aborted) send(endEvent(streamId, end))
  } catch (error) {
    // Stopped by the person (or the page went away): not a failure, and nobody is listening.
    if (controller.signal.aborted) return
    const failure = adapter ? adapter.normalizeError(error, { modelId }) : unknownError(error)
    send({ streamId, type: 'error', message: describeFailure(failure, apiKey) })
  } finally {
    running.delete(key)
  }
}

/** Registers the chat messages. Called from registerIpc, after the app is ready. */
export function registerChatIpc(appUrl: string): void {
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
    void runReply(sender.id, check.request, send)
  })

  ipcMain.on(CHANNELS.chatCancel, (event, streamId: unknown) => {
    if (!isTrustedSender(event, appUrl) || typeof streamId !== 'string') return
    running.get(`${event.sender.id}:${streamId}`)?.abort()
  })
}
