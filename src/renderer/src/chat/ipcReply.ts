import type { ChatStreamEvent } from '../../../shared/ipc'
import type { ToolEvent } from '../../../shared/tools'
import type { ReplyUsage } from '../../../shared/usage'
import { toWireMessages } from './history'
import type { Answerer, ChatMessage, LargeRequest } from './types'

/** What a reply says when the person answered "Don't send" to a large request (D-032). It is shown like any other reason a reply did not come, with "Try again". */
export const NOT_SENT_MESSAGE = 'Not sent: you chose not to send this request.'
export const NOT_SENT_LATER_MESSAGE =
  'The reply stopped here: you chose not to send what it has read so far with the next request.'

/**
 * The reply function (see `ReplyFn`) that asks the main process for a real answer. The page cannot
 * reach the network or the API key: it sends the conversation over the bridge, and the reply comes
 * back as events, which this turns into a stream of text pieces for `useChat`. The first event says which
 * model is answering; that goes to `onAnswerer`, not into the text. The person's instructions (D-027) go
 * along only when there are some, so a chat without them sends exactly what it always sent. The id of the chat goes along so that
 * the cost can be shown under it (D-030), and the cost of the reply comes back as one event, just before the end.
 * A large request (D-032) comes back first as a question: the main process sends nothing until this says yes, and says no (and the reply
 * ends as "Not sent") when the person does.
 */
export async function* ipcReply(
  history: ChatMessage[],
  signal: AbortSignal,
  onAnswerer: (answerer: Answerer) => void,
  instructions: string,
  conversationId: string | null,
  onUsage: (usage: ReplyUsage) => void,
  onLargeRequest: (request: LargeRequest) => Promise<boolean>,
  projectId: string | null = null,
  onTool: (event: ToolEvent) => void = () => {}
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
    window.api.chat.start({
      streamId,
      messages: toWireMessages(history),
      ...(instructions === '' ? {} : { instructions }),
      ...(conversationId === null ? {} : { conversationId }),
      ...(projectId === null ? {} : { projectId })
    })
    while (!signal.aborted) {
      const event = arrived.shift()
      if (!event) {
        await new Promise<void>((resolve) => {
          wake = resolve
        })
        continue
      }
      if (event.type === 'start') onAnswerer({ provider: event.provider, model: event.model })
      else if (event.type === 'text') yield event.text
      else if (event.type === 'usage') onUsage(event.usage)
      else if (event.type === 'tool')
        onTool(event.event) // (11.4) tool activity: the chat shows it as it happens
      else if (event.type === 'confirm') {
        const yes = await onLargeRequest({
          model: event.model,
          estimate: event.estimate,
          askAboveUsd: event.askAboveUsd,
          ...(event.later === true ? { later: true } : {})
        })
        if (signal.aborted) return // stopped while the question was open: `onAbort` has told main
        if (!yes) {
          window.api.chat.cancel(streamId) // main drops the question; nothing was sent
          throw new Error(event.later === true ? NOT_SENT_LATER_MESSAGE : NOT_SENT_MESSAGE)
        }
        window.api.chat.confirm(streamId)
      } else if (event.type === 'done') return
      else throw new Error(event.message)
    }
  } finally {
    signal.removeEventListener('abort', onAbort)
    stopListening()
  }
}
