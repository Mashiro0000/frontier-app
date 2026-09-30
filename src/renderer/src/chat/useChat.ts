import { useEffect, useRef, useState } from 'react'
import { echoReply } from './echoReply'
import type { ChatMessage, ReplyFn } from './types'

export interface UseChat {
  messages: ChatMessage[]
  /** True while an assistant reply is still arriving. */
  isReplying: boolean
  send: (text: string) => void
  /** Stops the reply that is arriving. Whatever has arrived so far is kept. */
  stop: () => void
}

/**
 * Holds the conversation and runs one cycle: the user sends, a reply streams in, it finishes.
 * `reply` decides where answers come from: the fake echo today, a real model later.
 */
export function useChat(reply: ReplyFn = echoReply): UseChat {
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
      for await (const piece of reply(history, controller.signal)) {
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

  function send(text: string): void {
    if (activeReply.current) return // one reply at a time

    const userMessage: ChatMessage = {
      id: crypto.randomUUID(),
      role: 'user',
      content: text,
      status: 'done'
    }
    const replyMessage: ChatMessage = {
      id: crypto.randomUUID(),
      role: 'assistant',
      content: '',
      status: 'streaming'
    }
    const history = [...messages, userMessage]
    const controller = new AbortController()

    activeReply.current = controller
    setMessages([...history, replyMessage])
    void streamReply(history, replyMessage.id, controller)
  }

  function stop(): void {
    activeReply.current?.abort()
  }

  const isReplying = messages.at(-1)?.status === 'streaming'

  return { messages, isReplying, send, stop }
}
