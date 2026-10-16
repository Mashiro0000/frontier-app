import { useCallback, useEffect, useRef, useState } from 'react'
import { notesOf, settleNotes } from '../../../shared/toolNotes'
import type { ToolEvent } from '../../../shared/tools'
import { withEditedMessage, withoutLastReply } from './rewrite'
import type { AttachedFile } from '../../../shared/attachments'
import type { PictureNote } from '../../../shared/images'
import type { ChatMessage, LargeRequest, ReplyFn } from './types'

export interface UseChat {
  messages: ChatMessage[]
  /** True while an assistant reply is still arriving. */
  isReplying: boolean
  /** A large request that is waiting for the person's yes (D-032), or null. Nothing has been sent while this is set. */
  largeRequest: LargeRequest | null
  /** The person's answer to `largeRequest`: true to send it, false not to. Does nothing when no question is open. */
  answerLargeRequest: (yes: boolean) => void
  /** Sends a message of the person's: its text and the files on it (D-037; either may be empty, not both). */
  send: (text: string, files?: AttachedFile[]) => void
  /** Stops the reply that is arriving. Whatever has arrived so far is kept. */
  stop: () => void
  /** The person's instructions for this chat (D-027): '' for none. They go with every request, and are saved with the chat. */
  instructions: string
  /** Sets the instructions (the dialog has trimmed and checked them; main checks again). Does nothing while a reply is arriving. */
  setInstructions: (text: string) => void
  /** The project the chat belongs to (D-039, 10.5): its id, or null for none. Saved with the chat. */
  project: string | null
  /** Moves the chat into a project, or out of every project. Does nothing while a reply is arriving. */
  setProject: (id: string | null) => void
  /**
   * Replaces the conversation with another one: a saved one (with its instructions and project), or an empty list for a new chat, which
   * starts with none (or in the project it was started in).
   */
  load: (messages: ChatMessage[], instructions?: string, project?: string | null) => void
  /**
   * Says which saved conversation is on screen (D-030), so that what a reply costs can be shown under it. Called by the history, which
   * owns the id; it changes nothing on screen, and is the same function from one render to the next.
   */
  setConversationId: (id: string) => void
  /** Asks again for the last reply: it is replaced by a new one (D-026). Does nothing while a reply is arriving. */
  regenerate: () => void
  /**
   * Replaces one of the person's own messages with new text, drops everything after it, and asks again (D-026). Does nothing while a
   * reply is arriving, for a message that is not theirs, or for empty text. The functions are stable, so the messages that are not
   * changing do not draw again while a reply streams in.
   */
  resend: (id: string, text: string) => void
  /**
   * (16.5, D-048) Puts a request for pictures into the chat: the description as the person typed it and the gallery's ids. It asks the model nothing and is never
   * sent to it. Does nothing while a reply is arriving.
   */
  addPicture: (description: string, note: PictureNote) => void
}

/**
 * Holds the conversation and runs one cycle: the user sends, a reply streams in, it finishes.
 * `reply` decides where answers come from: the main process, which asks the model (see ipcReply).
 */
export function useChat(reply: ReplyFn): UseChat {
  const [messages, setMessages] = useState<ChatMessage[]>([])
  // The person's own instructions for this chat (D-027). They belong to the conversation, like its messages, and are read when a request
  // is made: a reply that is asked for again (Regenerate, an edited message) uses the instructions the chat has THEN.
  const [instructions, setInstructionsState] = useState('')
  // The chat's project (D-039): it belongs to the conversation too, and is saved with it.
  const [project, setProjectState] = useState<string | null>(null)
  // The id the conversation on screen is saved under. A ref, not state: nothing is drawn from it, and a request reads it when it is made.
  const conversationId = useRef<string | null>(null)
  const setConversationId = useCallback((id: string): void => {
    conversationId.current = id
  }, [])
  // Set while a reply is streaming. Used to stop it, and to refuse a second send meanwhile.
  const activeReply = useRef<AbortController | null>(null)
  // A large request waiting for the person's yes (D-032): what to show, and how its answer reaches the reply that is waiting for it.
  const [largeRequest, setLargeRequest] = useState<LargeRequest | null>(null)
  const answerRef = useRef<((yes: boolean) => void) | null>(null)

  // If the chat goes away mid-reply (window closing, hot reload), stop the reply too.
  useEffect(() => () => activeReply.current?.abort(), [])

  /** Puts a large request in front of the person and waits for the answer. A reply that is stopped meanwhile answers no, and the question goes. */
  function askAboutLargeRequest(request: LargeRequest, signal: AbortSignal): Promise<boolean> {
    return new Promise<boolean>((resolve) => {
      if (signal.aborted) {
        resolve(false)
        return
      }
      const finish = (yes: boolean): void => {
        signal.removeEventListener('abort', onAbort)
        answerRef.current = null
        setLargeRequest(null)
        resolve(yes)
      }
      const onAbort = (): void => finish(false)
      signal.addEventListener('abort', onAbort, { once: true })
      answerRef.current = finish
      setLargeRequest(request)
    })
  }

  const answerLargeRequest = useCallback((yes: boolean): void => {
    answerRef.current?.(yes)
  }, [])

  function updateMessage(id: string, update: (message: ChatMessage) => ChatMessage): void {
    setMessages((previous) => previous.map((m) => (m.id === id ? update(m) : m)))
  }

  async function streamReply(
    history: ChatMessage[],
    replyId: string,
    controller: AbortController
  ): Promise<void> {
    // The tool calls of this reply (D-041, 11.4): the events as main reports them, and the length of the reply's text when each call began, so that a note
    // stands where the model stopped to ask. The events and the pieces of text arrive in one order, so a count of the text so far is exact.
    const toolEvents: ToolEvent[] = []
    const toolOffsets = new Map<string, number>()
    let written = 0
    try {
      // The model that answers is known before any text, and is kept on the reply (D-021), whether it ends well or not.
      const answered = reply(
        history,
        controller.signal,
        (answerer) =>
          updateMessage(replyId, (m) => ({
            ...m,
            provider: answerer.provider,
            model: answerer.model
          })),
        instructions,
        conversationId.current,
        (usage) => updateMessage(replyId, (m) => ({ ...m, usage })),
        (request) => askAboutLargeRequest(request, controller.signal),
        project,
        (event) => {
          toolEvents.push(event)
          if (!toolOffsets.has(event.call)) toolOffsets.set(event.call, written)
          const tools = notesOf(toolEvents, toolOffsets)
          updateMessage(replyId, (m) => ({ ...m, tools }))
        }
      )
      for await (const piece of answered) {
        if (controller.signal.aborted) break // ignore a piece that was already on its way
        written += piece.length
        updateMessage(replyId, (m) => ({ ...m, content: m.content + piece }))
      }
      const status = controller.signal.aborted ? 'stopped' : 'done'
      const stopped = controller.signal.aborted
      updateMessage(replyId, (m) => ({
        ...m,
        status,
        ...(m.tools !== undefined ? { tools: settleNotes(m.tools, stopped) } : {})
      }))
    } catch (error) {
      // A real provider may throw when it is aborted. That is a Stop, not a failure.
      const stopped = controller.signal.aborted
      if (stopped) {
        updateMessage(replyId, (m) => ({
          ...m,
          status: 'stopped',
          ...(m.tools !== undefined ? { tools: settleNotes(m.tools, true) } : {})
        }))
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

  function send(text: string, files: AttachedFile[] = []): void {
    if (activeReply.current) return // one reply at a time
    if (text === '' && files.length === 0) return

    const userMessage: ChatMessage = {
      id: crypto.randomUUID(),
      role: 'user',
      content: text,
      status: 'done',
      ...(files.length > 0 ? { files } : {})
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

  const addPicture = useCallback((description: string, note: PictureNote): void => {
    if (activeReply.current) return
    setMessages((previous) => [
      ...previous,
      { id: crypto.randomUUID(), role: 'user', content: description, status: 'done', picture: note }
    ])
  }, [])

  // Fixed while a reply is arriving, like the model and the effort (D-015, D-024): the buttons that call this are off then; belt and braces.
  const setInstructions = useCallback((text: string): void => {
    if (activeReply.current) return
    setInstructionsState(text)
  }, [])

  const setProject = useCallback((id: string | null): void => {
    if (activeReply.current) return
    setProjectState(id)
  }, [])

  function load(
    next: ChatMessage[],
    nextInstructions = '',
    nextProject: string | null = null
  ): void {
    activeReply.current?.abort() // the buttons that call this are off while a reply arrives; belt and braces
    setMessages(next)
    setInstructionsState(nextInstructions)
    setProjectState(nextProject)
  }

  const isReplying = messages.at(-1)?.status === 'streaming'

  return {
    messages,
    isReplying,
    largeRequest,
    answerLargeRequest,
    send,
    stop,
    instructions,
    setInstructions,
    project,
    setProject,
    load,
    setConversationId,
    regenerate,
    resend,
    addPicture
  }
}
