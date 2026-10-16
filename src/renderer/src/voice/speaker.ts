import { VOICE_LIMITS } from '../../../shared/voice'
import { readingOf, speechOf } from './speechText'

// Reading a reply aloud (Stage 15.6, D-047) with the voices of this PC: the window's own `speechSynthesis`. Nothing leaves the computer, nothing is billed and no key is
// needed. One reading at a time across the whole page; a click starts it, a click stops it, and a reply is never read without a click. The reply is made into sentences for
// the ear (speechText.ts), cut into pieces of at most 600 characters, and the pieces are said one after another, each started when the one before it has ended, so that
// Stop is heard at once and a long reply does not sit in the voice's queue.

export interface SpeakerState {
  /** The key of what is being read (the message's id), or null. */
  speaking: string | null
  /** A sentence about the last reading that did not go well or was cut, or null. */
  notice: string | null
}

export interface SpeakOptions {
  /** The name of the voice as `speechSynthesis` lists them, or null for the system's own choice. */
  voice: string | null
  /** Percent, 50 to 200. */
  rate: number
}

type Listener = (state: SpeakerState) => void

/** The pieces of the window's speech that the speaker needs, so that the checks can play a stand-in for them. */
export interface SpeechApi {
  speak(utterance: SpeechSynthesisUtterance): void
  cancel(): void
  getVoices(): SpeechSynthesisVoice[]
}

export interface Speaker {
  state(): SpeakerState
  subscribe(listener: Listener): () => void
  /** Starts reading `markdown` (a reply as it was written). Stops whatever was being read. */
  speak(key: string, markdown: string, options: SpeakOptions): void
  /** Stops the reading, if any. */
  stop(): void
  /** The voices of this PC, by name, once the window has them (it may take a moment after start). */
  voices(): Promise<string[]>
}

const NO_VOICE =
  'This computer has no voice to read with. Windows can add one in Settings, under Time & language, Speech.'
const FAILED = 'The reading stopped: the voice of this computer reported a problem.'

export function createSpeaker(api: () => SpeechApi | null): Speaker {
  const listeners = new Set<Listener>()
  let current: SpeakerState = { speaking: null, notice: null }
  // Each reading has its own token: a piece that ends after Stop (or after another reading began) must not start the next piece of an old reading.
  let token = 0

  const set = (next: SpeakerState): void => {
    current = next
    for (const listener of [...listeners]) listener(current)
  }

  function stop(): void {
    token++
    api()?.cancel()
    if (current.speaking !== null) set({ speaking: null, notice: current.notice })
  }

  function voiceNamed(speech: SpeechApi, name: string | null): SpeechSynthesisVoice | null {
    if (name === null) return null
    return speech.getVoices().find((voice) => voice.name === name) ?? null
  }

  return {
    state: () => current,
    subscribe: (listener) => {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    stop,
    speak: (key, markdown, options) => {
      const speech = api()
      stop()
      if (speech === null) {
        set({ speaking: null, notice: NO_VOICE })
        return
      }
      const reading = readingOf(speechOf(markdown))
      if (reading.pieces.length === 0) {
        set({ speaking: null, notice: 'There is nothing in this reply to read aloud.' })
        return
      }
      if (speech.getVoices().length === 0) {
        set({ speaking: null, notice: NO_VOICE })
        return
      }
      const mine = ++token
      const voice = voiceNamed(speech, options.voice)
      const rate = Math.min(2, Math.max(0.5, options.rate / 100))
      set({
        speaking: key,
        notice: reading.truncated
          ? `Only the first ${VOICE_LIMITS.readMaxChars.toLocaleString('en-US')} characters of this reply are read aloud.`
          : null
      })
      const next = (index: number): void => {
        if (token !== mine) return
        if (index >= reading.pieces.length) {
          set({ speaking: null, notice: current.notice })
          return
        }
        const utterance = new SpeechSynthesisUtterance(reading.pieces[index])
        if (voice !== null) {
          utterance.voice = voice
          utterance.lang = voice.lang
        }
        utterance.rate = rate
        utterance.onend = () => next(index + 1)
        utterance.onerror = (event) => {
          if (token !== mine) return
          // `interrupted` and `canceled` are what Stop causes: not a problem
          if (event.error === 'interrupted' || event.error === 'canceled') return
          token++
          set({ speaking: null, notice: FAILED })
        }
        speech.speak(utterance)
      }
      next(0)
    },
    voices: async () => {
      const speech = api()
      if (speech === null) return []
      const read = (): string[] => speech.getVoices().map((voice) => voice.name)
      let names = read()
      // the window may not have the list yet when it has just started
      for (let waited = 0; names.length === 0 && waited < 3000; waited += 100) {
        await new Promise((resolve) => setTimeout(resolve, 100))
        names = read()
      }
      return names
    }
  }
}

/** The window's own speech, or null where there is none. */
const windowSpeech = (): SpeechApi | null =>
  typeof window !== 'undefined' && 'speechSynthesis' in window
    ? {
        speak: (utterance) => window.speechSynthesis.speak(utterance),
        cancel: () => window.speechSynthesis.cancel(),
        getVoices: () => window.speechSynthesis.getVoices()
      }
    : null

/** The one speaker of the page. */
export const speaker: Speaker = createSpeaker(windowSpeech)
