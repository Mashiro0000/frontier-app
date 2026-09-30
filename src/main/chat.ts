import { app, ipcMain, type WebContents } from 'electron'
import { CHANNELS, type ChatRequest, type ChatStreamEvent } from '../shared/ipc'
import { checkChatRequest } from '../shared/validate'
import { readApiKey } from './keyStore'
import { describeError, streamReply, type ReplyEnd } from './provider'
import { isTrustedSender } from './security'

const NO_KEY_MESSAGE = 'No API key is saved yet. Open Settings and add your Anthropic API key.'

/** Replies in progress, by "<window id>:<stream id>", so each one can be stopped on its own. */
const running = new Map<string, AbortController>()
const watched = new WeakSet<WebContents>()

/**
 * For testing the whole path without the real service: FRONTIER_API_BASE_URL points the app at a
 * fake server on this computer. It works only when running from source, never in an installed app,
 * so nothing outside could redirect where a real key is sent.
 */
function baseUrlOverride(): string | undefined {
  const value = process.env['FRONTIER_API_BASE_URL']
  if (!value || app.isPackaged) return undefined
  try {
    const { protocol } = new URL(value)
    if (protocol === 'http:' || protocol === 'https:') return value
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
  try {
    const saved = await readApiKey()
    if (saved === null) {
      send({ streamId, type: 'error', message: NO_KEY_MESSAGE })
      return
    }
    apiKey = saved
    const end = await streamReply({
      apiKey,
      messages: request.messages,
      signal: controller.signal,
      baseURL: baseUrlOverride(),
      onText: (text) => send({ streamId, type: 'text', text })
    })
    if (!controller.signal.aborted) send(endEvent(streamId, end))
  } catch (error) {
    // Stopped by the person (or the page went away): not a failure, and nobody is listening.
    if (controller.signal.aborted) return
    send({ streamId, type: 'error', message: describeError(error, apiKey) })
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
