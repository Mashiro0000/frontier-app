// Voice in and out (Stage 15, D-047): the part main and the window share. Plain types, constants and the checks of what the page may say. No Electron imports.
//
// What the stage does, in one paragraph: the person HOLDS a button, the window records the microphone while it is held, main sends the clip to OpenAI's
// speech-to-text and the words come back as text in the message box (never sent by themselves); and a reply is read aloud, on a click, with the voices of this PC.
// Anthropic has no speech API, and OpenAI's text-to-speech models end on 6 January 2027, so nothing is bought from a provider for the voice OUT (D-047).

/** The limits of voice. Constants, not settings: a higher one is a change that lets the app do more, and this stage has no box for it. */
export const VOICE_LIMITS = Object.freeze({
  /** The longest a hold is recorded. The gate closes by itself a few seconds after this (the time the window needs to start the microphone). */
  maxClipSeconds: 60,
  /** A clip shorter than this is thrown away without being sent (a tap, not speech). */
  minClipMs: 300,
  /** The most bytes of one clip main takes: 60 seconds of Opus is about 1 MB here (15.1: 16 KB a second). */
  maxClipBytes: 1_048_576,
  /** The most of a transcription kept: it goes into the message box, which takes 600,000 characters in a whole chat. */
  maxTranscriptChars: 20_000,
  /** A reply is read in pieces of at most this many characters, so that Stop works at once. */
  readPieceChars: 600,
  /** A reply longer than this is read up to here, and the window says so. */
  readMaxChars: 20_000,
  /** The gate stays armed this long after `maxClipSeconds`, for the window to get the microphone going. */
  graceMs: 5000,
  /** At most this many holds in `burstMs`; after that the gate rests for `restMs`. (A page that arms in a loop gets a rest, not a flashing title.) */
  burstHolds: 8,
  burstMs: 30_000,
  restMs: 30_000
})

/** The speech-to-text model (15.1: in the installed SDK; no shutdown date; the older ones end on 26 February 2027). */
export const TRANSCRIBE_MODEL = 'gpt-transcribe'
/** What it costs, in US dollars a minute (OpenAI's pricing page, read on 16 October 2026). Billed by the second here, rounded up, at least a second. */
export const TRANSCRIBE_USD_PER_MINUTE = 0.0045

/** What a clip costs, in US dollars, for `seconds` of speech (a whole number of seconds, at least 1). */
export const transcribeFee = (seconds: number): number =>
  (Math.max(1, Math.ceil(seconds)) / 60) * TRANSCRIBE_USD_PER_MINUTE

/** What the person chose. Both switches start OFF; a missing or damaged file means both are off. */
export interface VoiceSettings {
  /** "Speak to type": the microphone button, and the clip going to OpenAI. Switched on only after the person's yes in the system's box. */
  readonly listen: boolean
  /** "Read aloud": the button on a reply. Nothing leaves the PC, so no box asks. */
  readonly speak: boolean
  /** The name of the voice (as the window lists them), or null for the system's own choice. */
  readonly voice: string | null
  /** How fast, in percent: 100 is normal. */
  readonly rate: number
}

export const VOICE_RATE_BOUNDS = Object.freeze({ min: 50, max: 200 })
export const VOICE_NAME_MAX = 120

export const DEFAULT_VOICE_SETTINGS: VoiceSettings = Object.freeze({
  listen: false,
  speak: false,
  voice: null,
  rate: 100
})

/** A voice's name as the window lists it: visible characters only (no control, no line break), 1 to 120 of them. */
export function isVoiceName(value: unknown): value is string {
  if (typeof value !== 'string' || value.length < 1 || value.length > VOICE_NAME_MAX) return false
  for (const ch of value) {
    const code = ch.codePointAt(0) as number
    // controls, the unassigned and format characters that hide (zero-width, bidirectional marks), and the line and paragraph separators
    if (code < 0x20 || (code >= 0x7f && code <= 0x9f)) return false
    if (code === 0x2028 || code === 0x2029 || (code >= 0x200b && code <= 0x200f)) return false
    if ((code >= 0x202a && code <= 0x202e) || (code >= 0x2066 && code <= 0x2069) || code === 0xfeff)
      return false
  }
  return value.trim() === value
}

export const isRate = (value: unknown): value is number =>
  typeof value === 'number' &&
  Number.isInteger(value) &&
  value >= VOICE_RATE_BOUNDS.min &&
  value <= VOICE_RATE_BOUNDS.max

/** What the page is told. Never a path, a key or a clip. */
export interface VoiceStatus {
  readonly listen: boolean
  readonly speak: boolean
  readonly voice: string | null
  readonly rate: number
  /** Why "Speak to type" cannot be used right now (no OpenAI key, no limits chosen, the settings unreadable), as a sentence; null when it can. */
  readonly listenBlocked: string | null
  /** The settings file could not be read: both switches are off and the sentence says why; null when it is fine. */
  readonly problem: string | null
  /** For the words on the page: the model, the price of a minute, the longest hold. */
  readonly model: string
  readonly usdPerMinute: number
  readonly maxSeconds: number
}

/** The answer to a change of a switch, the voice or the speed. */
export type VoiceChangeResult = { ok: true; status: VoiceStatus } | { ok: false; error: string }

/** What `voice.begin` answers: the window may open the microphone now, for at most `maxMs`. */
export type VoiceBeginResult = { ok: true; maxMs: number } | { ok: false; error: string }

/** What `voice.end` answers: the words, and what the clip cost. */
export type VoiceEndResult =
  | { ok: true; text: string; seconds: number; costUsd: number }
  /** `short`: nothing was sent, the hold was a tap; `empty`: the provider heard nothing. The others are failures. */
  | { ok: false; error: string; kind: 'short' | 'empty' | 'refused' | 'failed' }

/** The messages the window may send for voice. Names only; the page gets no function that takes a path, a key or an address. */
export const VOICE_CHANNELS = Object.freeze({
  status: 'voice:status',
  setListen: 'voice:set-listen',
  setSpeak: 'voice:set-speak',
  setVoice: 'voice:set-voice',
  reset: 'voice:reset',
  begin: 'voice:begin',
  end: 'voice:end',
  cancel: 'voice:cancel'
})

/** The sentences for the refusals the page shows. */
export const VOICE_WORDS = Object.freeze({
  off: 'Speak to type is off. Switch it on in Settings, under Voice.',
  noKey: 'Speak to type needs an OpenAI key. Save one in Settings.',
  noLimits: 'Choose your spending limits first (Settings, Spending limits).',
  busy: 'The microphone is in use already.',
  resting: 'Too many recordings in a short time. Wait a little and try again.',
  tooShort: 'That was too short to hear. Hold the button while you speak.',
  heardNothing: 'Nothing was heard. Check that your microphone is on and try again.',
  notTheClip: 'The recording could not be used.',
  failed: 'The words could not be written down. Nothing was kept.',
  cancelled: 'Recording cancelled. Nothing was sent.'
})
