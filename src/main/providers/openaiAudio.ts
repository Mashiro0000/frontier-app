import { toFile } from 'openai'
import { TRANSCRIBE_MODEL } from '../../shared/voice'
import { describeFailure } from './errors'
import { newClient, openaiAdapter } from './openai'
import type { Credentials, ErrorKind } from './types'

// Speech to text, through OpenAI's own SDK (Stage 15.3, D-047): one clip in, the words out. Nothing here imports Electron. The model, the endpoint and the fields are fixed
// in this file: the page names none of them, and the request carries exactly three fields (the clip as `clip.webm`, the model, the answer's format) and nothing the
// person said in text. The client is the one the chat uses (`newClient`: nothing is read from the environment, the key goes only where openai.ts says).
//
// One request, ONE try: the SDK's own retries are switched off, because a clip that was sent twice is billed twice. A failure is thrown as `TranscribeFailed` with the
// sentence for the person (the API key scrubbed out of it) and whether the provider refused the request outright (`rejected`: nothing is owed).

/** The longest this waits for the provider, in milliseconds. A minute of speech is transcribed in a few seconds. */
export const TRANSCRIBE_TIMEOUT_MS = 45_000

export interface TranscribeRequest {
  credentials: Credentials
  /** The WebM clip, already checked by voiceClip.ts. */
  clip: Buffer
  signal?: AbortSignal
  timeoutMs?: number
}

export interface Transcription {
  /** What the provider heard, as it sent it (the service cleans it). */
  text: string
  /** The seconds of audio the provider says it billed, when it says so (`usage` of the kind `duration`); null otherwise. */
  providerSeconds: number | null
}

export class TranscribeFailed extends Error {
  readonly kind: ErrorKind
  /** The provider refused the request outright (a key it does not accept, no credit, a request it will not take): nothing is owed. */
  readonly rejected: boolean
  /** The caller's signal was aborted (Stop, or the window went away): the request was given up, not refused. */
  readonly stopped: boolean
  constructor(message: string, kind: ErrorKind, rejected: boolean, stopped = false) {
    super(message)
    this.name = 'TranscribeFailed'
    this.kind = kind
    this.rejected = rejected
    this.stopped = stopped
  }
}

/** Kinds of failure in which the provider refused the request before doing any work. */
const REFUSED_KINDS: readonly ErrorKind[] = [
  'auth',
  'permission',
  'not-found',
  'quota',
  'bad-request'
]

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

export async function transcribe(request: TranscribeRequest): Promise<Transcription> {
  const { credentials, clip, signal, timeoutMs = TRANSCRIBE_TIMEOUT_MS } = request
  let answer: unknown
  try {
    const file = await toFile(clip, 'clip.webm', { type: 'audio/webm' })
    answer = await newClient(credentials).audio.transcriptions.create(
      { file, model: TRANSCRIBE_MODEL, response_format: 'json' },
      { signal, timeout: timeoutMs, maxRetries: 0 }
    )
  } catch (error) {
    if (signal?.aborted === true) {
      throw new TranscribeFailed('The recording was not sent.', 'unknown', false, true)
    }
    const normalized = openaiAdapter.normalizeError(error, { modelId: TRANSCRIBE_MODEL })
    throw new TranscribeFailed(
      describeFailure(normalized, credentials.apiKey),
      normalized.kind,
      REFUSED_KINDS.includes(normalized.kind)
    )
  }
  if (!isRecord(answer) || typeof answer.text !== 'string') {
    throw new TranscribeFailed('OpenAI sent an answer the app could not read.', 'provider', false)
  }
  const usage = answer.usage
  const seconds =
    isRecord(usage) &&
    usage.type === 'duration' &&
    typeof usage.seconds === 'number' &&
    Number.isFinite(usage.seconds) &&
    usage.seconds >= 0 &&
    usage.seconds <= 3600
      ? usage.seconds
      : null
  return { text: answer.text, providerSeconds: seconds }
}
