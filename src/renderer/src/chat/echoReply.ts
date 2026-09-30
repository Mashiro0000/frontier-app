import type { ChatMessage } from './types'

// A stand-in for a model: wait a moment, then stream the answer in small pieces, the way real
// providers do. The numbers make the typing indicator visible and keep long messages under ~3 s.
const FIRST_PIECE_DELAY_MS = 400
const PIECE_DELAY_MS = 30
const MAX_PIECES = 80

/** Resolves after `ms`, or straight away if `signal` is aborted. */
function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) {
      resolve()
      return
    }
    const timer = setTimeout(done, ms)
    function done(): void {
      clearTimeout(timer)
      signal.removeEventListener('abort', done)
      resolve()
    }
    signal.addEventListener('abort', done)
  })
}

/** Replies with the user's last message, prefixed with "Echo: ". */
export async function* echoReply(
  history: ChatMessage[],
  signal: AbortSignal
): AsyncGenerator<string> {
  const lastUserMessage = history.findLast((message) => message.role === 'user')
  const reply = `Echo: ${lastUserMessage?.content ?? ''}`

  // Each word keeps the spaces and line breaks after it, so the pieces join back into the exact text.
  const words = reply.match(/\S+\s*/g) ?? []
  const wordsPerPiece = Math.max(1, Math.ceil(words.length / MAX_PIECES))

  await sleep(FIRST_PIECE_DELAY_MS, signal)
  for (let i = 0; i < words.length && !signal.aborted; i += wordsPerPiece) {
    yield words.slice(i, i + wordsPerPiece).join('')
    await sleep(PIECE_DELAY_MS, signal)
  }
}
