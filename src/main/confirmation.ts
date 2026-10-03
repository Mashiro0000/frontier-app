// The waiting room for "send this very large request?" (Stage 8.3, D-032). A reply that needs the person's yes waits here, under the key of its
// window and its stream ("<window id>:<stream id>", as chat.ts keeps its running replies), until one of three things happens: the person says
// yes (`send`), the person says no or the window goes away (the reply's own abort signal fires), or nothing: it simply waits. No Electron
// imports, so every race below is checked under plain Node.
//
// What makes a yes mean something:
//  - A yes is only heard for a question that is WAITING. One that comes before the question exists (a page that sends it early, ahead of the
//    question) finds nobody waiting and is dropped, not remembered, so it cannot pre-approve a request.
//  - A yes answers one question once. After it, or after the question was declined, there is nobody waiting and a second yes is dropped.
//  - The question is shown (`show`) only after it is waiting, so an answer to it can never arrive too early to be heard.
//  - A question for a key that is already waiting is declined at once, never swapped for the first.

export type Answer = 'send' | 'decline'

export interface Confirmations {
  /**
   * Waits for the person's answer to the question that `show` puts in front of them. Resolves 'send' on their yes, and 'decline' when `signal`
   * aborts (the person said no, the window went away), when it was already aborted, when `show` throws, or when this key is already waiting.
   */
  ask(key: string, signal: AbortSignal, show: () => void): Promise<Answer>
  /** The person said yes to the question waiting under `key`. False when nothing is waiting there: the answer is early, late or repeated, and is dropped. */
  send(key: string): boolean
  /** How many questions are waiting (for the checks). */
  waiting(): number
}

export function createConfirmations(): Confirmations {
  const pending = new Map<string, (answer: Answer) => void>()

  return {
    ask: (key, signal, show) =>
      new Promise<Answer>((resolve) => {
        if (signal.aborted || pending.has(key)) {
          resolve('decline')
          return
        }
        const finish = (answer: Answer): void => {
          if (pending.get(key) !== finish) return // already answered
          pending.delete(key)
          signal.removeEventListener('abort', onAbort)
          resolve(answer)
        }
        const onAbort = (): void => finish('decline')
        pending.set(key, finish)
        signal.addEventListener('abort', onAbort, { once: true })
        try {
          show()
        } catch {
          finish('decline') // the question could not be put in front of anyone: nothing is sent
        }
      }),

    send: (key) => {
      const finish = pending.get(key)
      if (finish === undefined) return false
      finish('send')
      return true
    },

    waiting: () => pending.size
  }
}
