import type { ChatStreamEvent } from '../../../shared/ipc'
import { toWireMessages } from './history'
import type { ChatMessage } from './types'

/**
 * The reply function (see `ReplyFn`) that asks the main process for a real answer. The page cannot
 * reach the network or the API key: it sends the conversation over the bridge, and the reply comes
 * back as events, which this turns into a stream of text pieces for `useChat`.
 */
export async function* ipcReply(
  history: ChatMessage[],
  signal: AbortSignal
): AsyncGenerator<string> {
  if (!window.api) {
    throw new Error('The window could not connect to the app (the preload did not load).')
  }
  const streamId = crypto.randomUUID()
  const arrived: ChatStreamEvent[] = []
  let wake: (() => void) | null = null
  const wakeUp = (): void => {
    wake?.()
    wake = null
  }

  const stopListening = window.api.chat.onEvent((event) => {
    if (event.streamId !== streamId) return // someone else's reply
    arrived.push(event)
    wakeUp()
  })
  const onAbort = (): void => {
    window.api.chat.cancel(streamId) // tell main to drop the network request, which also stops the cost
    wakeUp()
  }
  signal.addEventListener('abort', onAbort)

  try {
    window.api.chat.start({ streamId, messages: toWireMessages(history) })
    while (!signal.aborted) {
      const event = arrived.shift()
      if (!event) {
        await new Promise<void>((resolve) => {
          wake = resolve
        })
        continue
      }
      if (event.type === 'text') yield event.text
      else if (event.type === 'done') return
      else throw new Error(event.message)
    }
  } finally {
    signal.removeEventListener('abort', onAbort)
    stopListening()
  }
}
