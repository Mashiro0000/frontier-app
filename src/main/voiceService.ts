import { checkAgainstLimits, limitsAreSet, unsetLimits } from '../shared/limits'
import { NO_TOKENS, audioFeeUsd, type AudioFee } from '../shared/usage'
import {
  TRANSCRIBE_MODEL,
  TRANSCRIBE_USD_PER_MINUTE,
  VOICE_LIMITS,
  VOICE_WORDS,
  isRate,
  isVoiceName,
  transcribeFee,
  type VoiceBeginResult,
  type VoiceChangeResult,
  type VoiceEndResult,
  type VoiceSettings,
  type VoiceStatus
} from '../shared/voice'
import { KeptRefused } from './keptFile'
import type { LimitsStore } from './limits'
import { TranscribeFailed, transcribe as realTranscribe } from './providers/openaiAudio'
import {
  QUESTION_BUSY,
  QUESTION_FAILED,
  QUESTION_RESTING,
  type QuestionGate,
  type SystemQuestion
} from './systemQuestion'
import { ASKED_HERE } from './toolQuestion'
import { RequestRefused, type UsageLedger } from './usageLedger'
import { checkClip, cleanTranscript } from './voiceClip'
import type { VoiceGate } from './voiceGate'
import type { VoiceSettingsStore } from './voiceSettings'

// What the person can do with voice (Stage 15.5, D-047). The settings file is voiceSettings.ts; the gate for the microphone is voiceGate.ts; this decides what may change and
// what a hold becomes. Main alone; the page gets `status()` and these calls, and no way to answer a question, to name a model, a price or a key, or to open the microphone
// by itself (the gate opens only here, in `begin`, after every check).
//
// The rules:
//  - "Speak to type" goes ON only after the person's yes in the system's own message box, which says what is sent, to whom (OpenAI, even while chatting with Claude), what is
//    kept (nothing, by the app) and what it costs. OFF is at once and closes the gate. "Read aloud" sends nothing anywhere, so neither direction asks.
//  - `begin` opens the gate for ONE hold only if the switch is on, an OpenAI key is saved, the limits are chosen and a clip of the longest length would fit under them.
//  - `end` closes the gate FIRST, then judges the clip, then writes the request in the usage ledger (with the limits applied in the ledger's own turn), then sends it. A clip
//    is never sent without a record, and a record is never left in "sent" for good: every way out settles it.
//  - What comes back goes to the page as text, cleaned. The app keeps neither the clip nor the words: they exist in memory for the length of the call.
// No Electron imports.

const BUSY = 'The voice settings are still being changed.'
const NOT_UNDERSTOOD = 'That change was not understood.'
const NOT_ON = 'Speak to type is still off.'
const NOTHING_TO_RESET = 'The voice settings can be read, so there is nothing to start again.'

const changeRefused = (why: string): string =>
  `Nothing was changed: your voice settings could not be read (${why}). Both switches are off. Start again in Settings; the app keeps a copy of the file.`

/** The question before "Speak to type" is switched on. */
export function listenOnQuestion(): SystemQuestion {
  return {
    title: 'Speak to type',
    message: 'Let this app send your voice to OpenAI?',
    detail: [
      'While you HOLD the microphone button in the message box, the app records your microphone and sends the recording to OpenAI, which writes it down as text. The text appears in the message box; nothing is sent as a message until you press Send.',
      '',
      'This happens even when you chat with Claude: Anthropic has no speech service, so every recording goes to OpenAI, with your OpenAI key.',
      '',
      'The app keeps no recording and no copy of the words. OpenAI handles what it receives under its own policy.',
      '',
      `It costs about $${TRANSCRIBE_USD_PER_MINUTE} a minute (at most $${transcribeFee(VOICE_LIMITS.maxClipSeconds)} for a recording, which is at most ${VOICE_LIMITS.maxClipSeconds} seconds). It counts against your spending limits and shows in Settings, under Usage.`,
      '',
      'While the microphone is on, the window title says RECORDING and the taskbar button shows a red dot. Windows may show its own microphone icon as well.',
      '',
      'You can turn it off again in Settings, under Voice.',
      '',
      ASKED_HERE
    ].join('\n'),
    yes: 'Turn on',
    no: "Don't turn on"
  }
}

export interface VoiceServiceOptions {
  store: VoiceSettingsStore
  gate: QuestionGate
  mic: VoiceGate
  /** The saved OpenAI key, or null. For this file only: it is never sent to the page. */
  key: () => Promise<string | null>
  /** FRONTIER_API_BASE_URL, when running from source. */
  baseUrl: () => string | undefined
  limits: LimitsStore
  ledger: UsageLedger
  /** Instead of the real adapter, for the checks. */
  transcribe?: typeof realTranscribe
}

export interface VoiceService {
  status(): Promise<VoiceStatus>
  /** `{ on }` from the page. ON asks in the system's box (for `owner`, the window that asked); OFF does not. */
  setListen(owner: unknown, input: unknown): Promise<VoiceChangeResult>
  /** `{ on }` from the page. Asks nothing either way: read aloud sends nothing anywhere. */
  setSpeak(input: unknown): Promise<VoiceChangeResult>
  /** `{ voice, rate }` from the page. */
  setVoice(input: unknown): Promise<VoiceChangeResult>
  /** Starts again when the file could not be read: both switches off, the old file kept as a copy. */
  reset(): Promise<VoiceChangeResult>
  /** The person pressed the button: opens the microphone's gate for one hold, if everything allows it. */
  begin(): Promise<VoiceBeginResult>
  /** The person let go: `{ bytes, ms }`. The gate closes, the clip is judged, counted, sent and the words come back. */
  end(input: unknown): Promise<VoiceEndResult>
  /** Cancels the hold, or the clip on its way. Sends nothing. */
  cancel(): void
}

const reason = (error: unknown): unknown => (error instanceof Error ? error.message : error)
const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
const exactly = (value: unknown, keys: string): value is Record<string, unknown> =>
  isRecord(value) && Object.keys(value).sort().join() === keys

export function createVoiceService(options: VoiceServiceOptions): VoiceService {
  const { store, gate, mic, limits, ledger } = options
  const transcribe = options.transcribe ?? realTranscribe
  let changing = false
  let inFlight: AbortController | null = null

  async function oneAtATime(task: () => Promise<VoiceChangeResult>): Promise<VoiceChangeResult> {
    if (changing) return { ok: false, error: BUSY }
    changing = true
    try {
      return await task()
    } finally {
      changing = false
    }
  }

  async function status(): Promise<VoiceStatus> {
    const { settings, problem } = await store.read()
    const key = await options.key()
    const chosen = limitsAreSet(await limits.read().catch(() => unsetLimits()))
    const blocked =
      problem !== null
        ? `Your voice settings could not be read (${problem}).`
        : key === null
          ? VOICE_WORDS.noKey
          : !chosen
            ? VOICE_WORDS.noLimits
            : null
    return {
      listen: settings.listen,
      speak: settings.speak,
      voice: settings.voice,
      rate: settings.rate,
      listenBlocked: blocked,
      problem,
      model: TRANSCRIBE_MODEL,
      usdPerMinute: TRANSCRIBE_USD_PER_MINUTE,
      maxSeconds: VOICE_LIMITS.maxClipSeconds
    }
  }

  async function write(settings: VoiceSettings, replace = false): Promise<VoiceChangeResult> {
    try {
      await store.write(settings, { replace })
    } catch (error) {
      if (error instanceof KeptRefused) return { ok: false, error: error.message }
      console.error('Writing the voice settings failed:', reason(error))
      return { ok: false, error: 'The voice settings could not be saved.' }
    }
    return { ok: true, status: await status() }
  }

  /** The reason the settings may not be changed now, or null. A file that cannot be read means nothing can be changed (except starting again). */
  async function current(): Promise<
    { ok: true; settings: VoiceSettings } | { ok: false; error: string }
  > {
    const { settings, problem } = await store.read()
    return problem !== null ? { ok: false, error: changeRefused(problem) } : { ok: true, settings }
  }

  // ---- the hold ----

  /** The seconds and the fee a clip of the longest length would be reserved at, for the check before a hold begins. */
  const longestFee = (): number => transcribeFee(VOICE_LIMITS.maxClipSeconds)

  async function refusedByLimits(requestUsd: number): Promise<string | null> {
    const now = await ledger.summary(null)
    return checkAgainstLimits(await limits.read(), {
      today: now.today.costUsd,
      month: now.month.costUsd,
      request: requestUsd
    })
  }

  return {
    status,

    setListen: (owner, input) =>
      oneAtATime(async () => {
        if (!exactly(input, 'on') || typeof input.on !== 'boolean') {
          return { ok: false, error: NOT_UNDERSTOOD }
        }
        const now = await current()
        if (!now.ok) return now
        if (!input.on) {
          mic.close()
          inFlight?.abort()
          return write({ ...now.settings, listen: false })
        }
        if (now.settings.listen) return { ok: true, status: await status() }
        if ((await options.key()) === null) return { ok: false, error: VOICE_WORDS.noKey }
        const answer = await gate.ask(owner, listenOnQuestion())
        if (answer === 'busy') return { ok: false, error: QUESTION_BUSY }
        if (answer === 'resting') return { ok: false, error: QUESTION_RESTING }
        if (answer === 'failed') return { ok: false, error: QUESTION_FAILED }
        if (answer !== 'yes') return { ok: false, error: NOT_ON }
        return write({ ...now.settings, listen: true })
      }),

    setSpeak: (input) =>
      oneAtATime(async () => {
        if (!exactly(input, 'on') || typeof input.on !== 'boolean') {
          return { ok: false, error: NOT_UNDERSTOOD }
        }
        const now = await current()
        if (!now.ok) return now
        return write({ ...now.settings, speak: input.on })
      }),

    setVoice: (input) =>
      oneAtATime(async () => {
        if (!exactly(input, 'rate,voice')) return { ok: false, error: NOT_UNDERSTOOD }
        const { voice, rate } = input
        if ((voice !== null && !isVoiceName(voice)) || !isRate(rate)) {
          return { ok: false, error: NOT_UNDERSTOOD }
        }
        const now = await current()
        if (!now.ok) return now
        return write({ ...now.settings, voice, rate })
      }),

    reset: () =>
      oneAtATime(async () => {
        const { problem } = await store.read()
        if (problem === null) return { ok: false, error: NOTHING_TO_RESET }
        mic.close()
        return write({ listen: false, speak: false, voice: null, rate: 100 }, true)
      }),

    begin: async () => {
      const { settings, problem } = await store.read()
      if (problem !== null || !settings.listen) return { ok: false, error: VOICE_WORDS.off }
      if ((await options.key()) === null) return { ok: false, error: VOICE_WORDS.noKey }
      try {
        const refusal = await refusedByLimits(longestFee())
        if (refusal !== null) return { ok: false, error: refusal }
      } catch (error) {
        console.error('Checking the limits for a recording failed:', reason(error))
        return { ok: false, error: VOICE_WORDS.noLimits }
      }
      const armed = mic.arm()
      if (!armed.ok) {
        return { ok: false, error: armed.why === 'busy' ? VOICE_WORDS.busy : VOICE_WORDS.resting }
      }
      return { ok: true, maxMs: armed.maxMs }
    },

    end: async (input) => {
      // The hold is over whatever becomes of the clip: the gate is shut first. A call with no hold open sends nothing.
      if (!mic.close()) return { ok: false, kind: 'refused', error: VOICE_WORDS.notTheClip }
      const clip = checkClip(input)
      if (!clip.ok) return { ok: false, kind: clip.kind, error: clip.error }
      const { settings, problem } = await store.read()
      if (problem !== null || !settings.listen) {
        return { ok: false, kind: 'refused', error: VOICE_WORDS.off }
      }
      const apiKey = await options.key()
      if (apiKey === null) return { ok: false, kind: 'refused', error: VOICE_WORDS.noKey }

      const reserved: AudioFee = {
        kind: 'transcribe',
        seconds: clip.seconds,
        usdPerMinute: TRANSCRIBE_USD_PER_MINUTE
      }
      let record
      try {
        // The limits are read first, as the chat does: the ledger's check runs in its own turn and is not asynchronous.
        const chosen = await limits.read()
        record = await ledger.begin(
          {
            chat: null,
            provider: 'openai',
            model: TRANSCRIBE_MODEL,
            effort: null,
            prices: {
              inputPerMTok: 0,
              cacheReadPerMTok: 0,
              cacheWritePerMTok: 0,
              outputPerMTok: 0
            },
            inputTokens: 0,
            reserveUsd: audioFeeUsd(reserved),
            audio: reserved
          },
          (spend) => checkAgainstLimits(chosen, spend)
        )
      } catch (error) {
        if (error instanceof RequestRefused) {
          return { ok: false, kind: 'refused', error: error.message }
        }
        console.error('Counting a recording failed:', reason(error))
        return {
          ok: false,
          kind: 'failed',
          error: 'The recording could not be counted, so it was not sent.'
        }
      }

      const control = new AbortController()
      inFlight = control
      try {
        const heard = await transcribe({
          credentials: { apiKey, baseURL: options.baseUrl() },
          clip: clip.clip,
          signal: control.signal
        })
        const seconds =
          heard.providerSeconds !== null
            ? Math.max(1, Math.ceil(heard.providerSeconds))
            : clip.seconds
        const fee: AudioFee = { ...reserved, seconds }
        await ledger.finish(record.id, {
          state: 'done',
          tokens: { ...NO_TOKENS },
          estimate: heard.providerSeconds === null,
          audio: fee
        })
        const text = cleanTranscript(heard.text)
        if (text === null) return { ok: false, kind: 'empty', error: VOICE_WORDS.heardNothing }
        return { ok: true, text, seconds, costUsd: audioFeeUsd(fee) }
      } catch (error) {
        const failed = error instanceof TranscribeFailed ? error : null
        // refused outright: nothing is owed; given up (Stop, the switch turned off, the window gone): maybe billed, counted as a guess; anything else: maybe billed
        await ledger.finish(record.id, {
          state: failed?.rejected ? 'rejected' : failed?.stopped ? 'stopped' : 'failed',
          tokens: { ...NO_TOKENS },
          estimate: true,
          audio: reserved
        })
        if (failed?.stopped) return { ok: false, kind: 'failed', error: VOICE_WORDS.cancelled }
        if (failed === null) console.error('Sending a recording failed:', reason(error))
        return { ok: false, kind: 'failed', error: failed?.message ?? VOICE_WORDS.failed }
      } finally {
        if (inFlight === control) inFlight = null
      }
    },

    cancel: () => {
      mic.close()
      inFlight?.abort()
    }
  }
}
