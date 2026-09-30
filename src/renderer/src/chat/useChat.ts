import { useState } from 'react'
import type { ChatMessage } from './types'

export interface UseChat {
  messages: ChatMessage[]
  send: (text: string) => void
}

export function useChat(): UseChat {
  const [messages, setMessages] = useState<ChatMessage[]>([])

  function send(text: string): void {
    const message: ChatMessage = {
      id: crypto.randomUUID(),
      role: 'user',
      content: text,
      status: 'done'
    }
    setMessages((previous) => [...previous, message])
  }

  return { messages, send }
}
