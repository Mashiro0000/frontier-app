import { useCallback, useEffect, useRef, useState } from 'react'
import { VOICE_LIMITS, VOICE_WORDS } from '../../../shared/voice'
import { reloadVoiceStatus } from './voiceStatus'

// "Speak to type" in the page (Stage 15.6, D-047): HOLD the button, say it, let go, and the words come back as text for the message box. The microphone is opened only
// between `voice.begin` and `voice.end`, and only because main allowed it (main's permission rules answer the request for the microphone: the page cannot open it by itself);
// the recorder writes a small WebM file in memory; nothing is saved by the page. Letting go sends the clip (main counts it, sends it to OpenAI and answers with the words);
// Escape, leaving the window, a lost pointer or closing the page cancels and sends nothing. The words are handed to `onText`; they are never sent as a message from here.

export type ListenPhase = 'idle' | 'starting' | 'recording' | 'sending'

export interface Listening {
  phase: ListenPhase
  /** Whole seconds of the hold so far (for the page's own indicator; main's is the window's title and the taskbar). */
  seconds: number
  /** A sentence about how the last try went, or null. */
  notice: string | null
  /** The button went down. */
  press: () => void
  /** The button came up. */
  release: () => void
  /** Give up: nothing is sent. */
  cancel: () => void
}

const MIME = 'audio/webm;codecs=opus'
/** Speech needs far less than the recorder's default (128 kbit/s): 32 kbit/s keeps a minute under 250 KB. */
const BITS_PER_SECOND = 32_000

const BLOCKED =
  'The microphone could not be used. If Windows is blocking it for apps like this one, turn on "Let desktop apps access your microphone" in Windows Settings, under Privacy & security, Microphone.'

/** The sentence for a microphone that would not open. */
function microphoneProblem(error: unknown): string {
  const name = error instanceof DOMException ? error.name : ''
  if (name === 'NotFoundError' || name === 'OverconstrainedError') {
    return 'No microphone was found on this computer.'
  }
  if (name === 'NotReadableError' || name === 'AbortError') {
    return 'The microphone is busy: another program may be using it.'
  }
  return BLOCKED
}

export function useListen(onText: (text: string) => void): Listening {
  const [phase, setPhase] = useState<ListenPhase>('idle')
  const [seconds, setSeconds] = useState(0)
  const [notice, setNotice] = useState<string | null>(null)
  const phaseRef = useRef<ListenPhase>('idle')
  const recorder = useRef<MediaRecorder | null>(null)
  const stream = useRef<MediaStream | null>(null)
  const parts = useRef<Blob[]>([])
  const startedAt = useRef(0)
  const stopWanted = useRef(false)
  const cancelled = useRef(false)
  const autoStop = useRef<number | null>(null)
  const ticker = useRef<number | null>(null)
  const onTextRef = useRef(onText)
  useEffect(() => {
    onTextRef.current = onText
  }, [onText])

  const move = useCallback((next: ListenPhase) => {
    phaseRef.current = next
    setPhase(next)
  }, [])

  const clearTimers = useCallback(() => {
    if (autoStop.current !== null) window.clearTimeout(autoStop.current)
    if (ticker.current !== null) window.clearInterval(ticker.current)
    autoStop.current = null
    ticker.current = null
  }, [])

  const closeMicrophone = useCallback(() => {
    stream.current?.getTracks().forEach((track) => track.stop())
    stream.current = null
  }, [])

  /** The recorder has stopped: send what it recorded, unless the hold was cancelled. */
  const finish = useCallback(async () => {
    clearTimers()
    closeMicrophone()
    const held = Math.round(performance.now() - startedAt.current)
    const chunks = parts.current
    parts.current = []
    recorder.current = null
    if (cancelled.current) {
      move('idle')
      return
    }
    if (held < VOICE_LIMITS.minClipMs) {
      // a tap: the recorder had no time to make a clip. Nothing is sent; main is told the hold is over (its gate shuts) and the person is told what to do.
      void window.api.voice.cancel().catch(() => undefined)
      setNotice(VOICE_WORDS.tooShort)
      move('idle')
      setSeconds(0)
      return
    }
    move('sending')
    try {
      const bytes = new Uint8Array(await new Blob(chunks, { type: 'audio/webm' }).arrayBuffer())
      const result = await window.api.voice.end(bytes, held)
      if (result.ok) onTextRef.current(result.text)
      else setNotice(result.error)
    } catch {
      setNotice('The recording could not be sent. Nothing was kept.')
    }
    move('idle')
    setSeconds(0)
    reloadVoiceStatus()
  }, [clearTimers, closeMicrophone, move])

  const cancel = useCallback(() => {
    if (phaseRef.current === 'idle' || phaseRef.current === 'sending') return
    cancelled.current = true
    stopWanted.current = true
    const active = recorder.current
    if (active !== null && active.state !== 'inactive')
      active.stop() // its stop handler (finish) closes everything
    else {
      clearTimers()
      closeMicrophone()
      move('idle')
    }
    void window.api.voice.cancel().catch(() => undefined)
    setSeconds(0)
  }, [clearTimers, closeMicrophone, move])

  const release = useCallback(() => {
    if (phaseRef.current === 'starting') {
      stopWanted.current = true // let go before the microphone was ready: it stops as soon as it is
      return
    }
    const active = recorder.current
    if (phaseRef.current === 'recording' && active !== null && active.state === 'recording') {
      active.stop()
    }
  }, [])

  const press = useCallback(() => {
    if (phaseRef.current !== 'idle') return
    cancelled.current = false
    stopWanted.current = false
    parts.current = []
    setNotice(null)
    setSeconds(0)
    move('starting')
    void (async () => {
      const begun = await window.api.voice.begin().catch(() => null)
      if (begun === null || !begun.ok) {
        setNotice(begun === null ? 'The recording could not be started.' : begun.error)
        move('idle')
        reloadVoiceStatus()
        return
      }
      if (cancelled.current) return
      let media: MediaStream
      try {
        media = await navigator.mediaDevices.getUserMedia({ audio: true })
      } catch (error) {
        void window.api.voice.cancel().catch(() => undefined)
        setNotice(microphoneProblem(error))
        move('idle')
        return
      }
      if (
        cancelled.current ||
        typeof MediaRecorder === 'undefined' ||
        !MediaRecorder.isTypeSupported(MIME)
      ) {
        media.getTracks().forEach((track) => track.stop())
        void window.api.voice.cancel().catch(() => undefined)
        if (!cancelled.current)
          setNotice('This window cannot record in a form the speech service takes.')
        move('idle')
        return
      }
      stream.current = media
      const made = new MediaRecorder(media, { mimeType: MIME, audioBitsPerSecond: BITS_PER_SECOND })
      recorder.current = made
      made.ondataavailable = (event) => {
        if (event.data.size > 0) parts.current.push(event.data)
      }
      made.onstop = () => void finish()
      startedAt.current = performance.now()
      made.start(250)
      move('recording')
      ticker.current = window.setInterval(
        () => setSeconds(Math.floor((performance.now() - startedAt.current) / 1000)),
        250
      )
      // main closes the gate a few seconds after the longest hold; stop a little before, so the clip is still in time
      autoStop.current = window.setTimeout(
        () => {
          if (made.state === 'recording') made.stop()
        },
        Math.max(1000, begun.maxMs - 300)
      )
      if (stopWanted.current) made.stop()
    })()
  }, [finish, move])

  // Leaving the window, or the page going away, ends a hold: a recording does not go on in the background.
  useEffect(() => {
    const away = (): void => cancel()
    const hidden = (): void => {
      if (document.visibilityState === 'hidden') cancel()
    }
    window.addEventListener('blur', away)
    document.addEventListener('visibilitychange', hidden)
    return () => {
      window.removeEventListener('blur', away)
      document.removeEventListener('visibilitychange', hidden)
      cancel()
    }
  }, [cancel])

  return { phase, seconds, notice, press, release, cancel }
}
