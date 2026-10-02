import { useCallback, useEffect, useRef, useState } from 'react'
import { withEditedMessage, withoutLastReply } from './rewrite'
import type { ChatMessage, ReplyFn } from './types'

export interface UseChat {
  messages: ChatMessage[]
  /** True while an assistant reply is still arriving. */
  isReplying: boolean
  send: (text: string) => void
  /** Stops the reply that is arriving. Whatever has arrived so far is kept. */
  stop: () => void
  /** Replaces the conversation with another one: a saved one, or an empty list for a new chat. */
  load: (messages: ChatMessage[]) => void
  /** Asks again for the last reply: it is replaced by a new one (D-026). Does nothing while a reply is arriving. */
  regenerate: () => void
  /**
   * Replaces one of the person's own messages with new text, drops everything after it, and asks again (D-026). Does nothing while a
   * reply is arriving, for a message that is not theirs, or for empty text. The functions are stable, so the messages that are not
   * changing do not draw again while a reply streams in.
   */
  resend: (id: string, text: string) => void
}

/**
 * Holds the conversation and runs one cycle: the user sends, a reply streams in, it finishes.
 * `reply` decides where answers come from: the main process, which asks the model (see ipcReply).
 */
export function useChat(reply: ReplyFn): UseChat {
  const [messages, setMessages] = useState<ChatMessage[]>([])
  // Set while a reply is streaming. Used to stop it, and to refuse a second send meanwhile.
  const activeReply = useRef<AbortController | null>(null)

  // If the chat goes away mid-reply (window closing, hot reload), stop the reply too.
  useEffect(() => () => activeReply.current?.abort(), [])

  function updateMessage(id: string, update: (message: ChatMessage) => ChatMessage): void {
    setMessages((previous) => previous.map((m) => (m.id === id ? update(m) : m)))
  }

  async function streamReply(
    history: ChatMessage[],
    replyId: string,
    controller: AbortController
  ): Promise<void> {
    try {
      // The model that answers is known before any text, and is kept on the reply (D-021), whether it ends well or not.
      const answered = reply(history, controller.signal, (answerer) =>
        updateMessage(replyId, (m) => ({
          ...m,
          provider: answerer.provider,
          model: answerer.model
        }))
      )
      for await (const piece of answered) {
        if (controller.signal.aborted) break // ignore a piece that was already on its way
        updateMessage(replyId, (m) => ({ ...m, content: m.content + piece }))
      }
      const status = controller.signal.aborted ? 'stopped' : 'done'
      updateMessage(replyId, (m) => ({ ...m, status }))
    } catch (error) {
      // A real provider may throw when it is aborted. That is a Stop, not a failure.
      if (controller.signal.aborted) {
        updateMessage(replyId, (m) => ({ ...m, status: 'stopped' }))
      } else {
        const message = error instanceof Error ? error.message : String(error)
        updateMessage(replyId, (m) => ({ ...m, status: 'error', error: message }))
      }
    } finally {
      activeReply.current = null
    }
  }

  /** Asks for a reply to `history` (which ends with the person's message) and puts an empty one after it, replacing whatever came after. */
  function begin(history: ChatMessage[]): void {
    const replyMessage: ChatMessage = {
      id: crypto.randomUUID(),
      role: 'assistant',
      content: '',
      status: 'streaming',
      provider: null,
      model: null
    }
    const controller = new AbortController()

    activeReply.current = controller
    setMessages([...history, replyMessage])
    void streamReply(history, replyMessage.id, controller)
  }

  function send(text: string): void {
    if (activeReply.current) return // one reply at a time

    const userMessage: ChatMessage = {
      id: crypto.randomUUID(),
      role: 'user',
      content: text,
      status: 'done'
    }
    begin([...messages, userMessage])
  }

  // The two ways of asking again read the conversation as it is when they are called, and are the same function from one render to the
  // next, so that a message that has not changed does not draw again (MessageBubble is memoised) while a reply streams in.
  const latest = useRef({ messages, begin })
  useEffect(() => {
    latest.current = { messages, begin }
  })

  const regenerate = useCallback((): void => {
    if (activeReply.current) return // one reply at a time (a second click, before the first has drawn)
    const history = withoutLastReply(latest.current.messages)
    if (history !== null) latest.current.begin(history)
  }, [])

  const resend = useCallback((id: string, text: string): void => {
    if (activeReply.current) return
    const history = withEditedMessage(latest.current.messages, id, text)
    if (history !== null) latest.current.begin(history)
  }, [])

  function stop(): void {
    activeReply.current?.abort()
  }

  function load(next: ChatMessage[]): void {
    activeReply.current?.abort() // the buttons that call this are off while a reply arrives; belt and braces
    setMessages(next)
  }

  const isReplying = messages.at(-1)?.status === 'streaming'

  return { messages, isReplying, send, stop, load, regenerate, resend }
}
