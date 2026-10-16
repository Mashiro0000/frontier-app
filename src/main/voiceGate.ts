import { VOICE_LIMITS } from '../shared/voice'

// The gate for the microphone (Stage 15.2, D-047): the one place that says when the window may open it. A plain state machine with the clock and the timers handed in,
// so that every rule is checked under plain Node. The Electron side (voiceWindow.ts) asks it from the session's permission handler and shows its state in the
// window's title and the taskbar button.
//
// The rules:
//  - Closed unless main opened it. Opening ("arming") is the answer to the person's hold, and main refuses it unless the switch is on, a key is saved and the
//    limits allow a clip (voiceService.ts); the page cannot arm itself.
//  - ONE hold at a time. A second arm while one is open is refused (`busy`), never queued.
//  - It closes by itself after the longest hold plus a few seconds for the window to start the microphone, so a page that arms and never says it is done does not
//    keep the microphone open.
//  - It closes when the clip is handed in, when the hold is cancelled and when the window goes away; handing a clip in twice is one clip.
//  - A page that arms in a loop gets a rest: more than 8 holds in 30 seconds closes the gate for 30 seconds (`resting`). A person does not hold a button 9 times
//    in half a minute and a title that flashes "Recording" is a nuisance, not a service.

export interface Timers {
  set(callback: () => void, ms: number): unknown
  clear(handle: unknown): void
}

const realTimers: Timers = {
  set: (callback, ms) => setTimeout(callback, ms),
  clear: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>)
}

export type ArmResult = { ok: true; maxMs: number } | { ok: false; why: 'busy' | 'resting' }

export interface VoiceGate {
  /** Opens the gate for one hold. */
  arm(): ArmResult
  /** Closes it: the clip was handed in, the hold was cancelled, or the window went away. True if it was open. */
  close(): boolean
  isArmed(): boolean
  /** What the session's permission handler asks: may the window open the microphone right now? Only while armed. */
  mayOpenMicrophone(): boolean
  /** Told when the gate opens (true) or closes (false), for the indicator. Returns the way to stop listening. */
  onChange(listener: (armed: boolean) => void): () => void
}

export interface VoiceGateOptions {
  now?: () => number
  timers?: Timers
}

export function createVoiceGate(options: VoiceGateOptions = {}): VoiceGate {
  const now = options.now ?? Date.now
  const timers = options.timers ?? realTimers
  const listeners = new Set<(armed: boolean) => void>()
  let armed = false
  let timer: unknown = null
  let restingUntil = 0
  const holds: number[] = []

  const tell = (state: boolean): void => {
    for (const listener of [...listeners]) {
      try {
        listener(state)
      } catch (error) {
        // Logged here only; an indicator that fails must not keep the gate open.
        console.error(
          'A listener of the microphone gate failed:',
          error instanceof Error ? error.message : error
        )
      }
    }
  }

  function close(): boolean {
    if (!armed) return false
    armed = false
    if (timer !== null) timers.clear(timer)
    timer = null
    tell(false)
    return true
  }

  return {
    arm: () => {
      if (armed) return { ok: false, why: 'busy' }
      const at = now()
      if (at < restingUntil) return { ok: false, why: 'resting' }
      // the holds of the last half minute, this one included
      while (holds.length > 0 && at - holds[0] >= VOICE_LIMITS.burstMs) holds.shift()
      holds.push(at)
      if (holds.length > VOICE_LIMITS.burstHolds) {
        restingUntil = at + VOICE_LIMITS.restMs
        holds.length = 0
        return { ok: false, why: 'resting' }
      }
      const maxMs = VOICE_LIMITS.maxClipSeconds * 1000
      armed = true
      timer = timers.set(() => {
        timer = null
        close()
      }, maxMs + VOICE_LIMITS.graceMs)
      tell(true)
      return { ok: true, maxMs }
    },
    close,
    isArmed: () => armed,
    mayOpenMicrophone: () => armed,
    onChange: (listener) => {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    }
  }
}
