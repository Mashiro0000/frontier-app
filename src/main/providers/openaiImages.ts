import OpenAI from 'openai'
import { IMAGE_LIMITS } from '../../shared/images'
import { checkAnswerPictures, type CheckedPicture } from '../imageCheck'
import { describeFailure } from './errors'
import { newClient, openaiAdapter } from './openai'
import type { Credentials, ErrorKind } from './types'

// Pictures from a description, through OpenAI's own SDK (Stage 16.3, D-048): one request in, the checked pictures out. Nothing here imports Electron. The endpoint and the
// fields are fixed in this file, and the values come from main's checked request (checkImageAsk: a model of registry/images.json, one of the three sizes, low, medium or high,
// 1 to 4): the request carries exactly `model`, `prompt`, `n`, `size`, `quality` and `output_format` ('png'), and nothing else. `moderation` is never sent (OpenAI's default,
// 'auto'): a refused description is told, never tried again with a lower level. The description goes exactly as the person typed it. The client is the chat's own
// (`newClient`: nothing is read from the environment, the key goes only where openai.ts says).
//
// One request, ONE try: the SDK's own retries are switched off (16.1 measured that its default sends the same request three times on a 503, and a picture asked for twice
// is billed twice). The answer is read strictly (16.1: the SDK checks nothing in it): the pictures by imageCheck.ts, the tokens only when they are whole numbers in bounds.
// A failure is thrown as `ImageFailed` with the sentence for the person (the API key scrubbed out of it) and whether the provider refused the request outright
// (`rejected`: nothing is owed).

export interface PictureRequest {
  credentials: Credentials
  model: string
  /** For the sentences ("GPT Image 2"). */
  modelLabel: string
  prompt: string
  size: string
  quality: 'low' | 'medium' | 'high'
  count: number
  signal?: AbortSignal
  timeoutMs?: number
}

export interface PictureAnswer {
  pictures: CheckedPicture[]
  /** The tokens the answer says were used, when it says so in whole numbers that make sense; null otherwise (then the cost is the table's figure). */
  tokens: { input: number; output: number } | null
}

export class ImageFailed extends Error {
  readonly kind: ErrorKind | 'blocked' | 'unusable'
  /** The provider refused the request outright (a key it does not accept, no credit, a description its safety system refused, an organisation not verified): nothing is owed. */
  readonly rejected: boolean
  /** The caller's signal was aborted (Stop, or the window went away): the request was given up, not refused. It may still be billed. */
  readonly stopped: boolean
  constructor(
    message: string,
    kind: ErrorKind | 'blocked' | 'unusable',
    rejected: boolean,
    stopped = false
  ) {
    super(message)
    this.name = 'ImageFailed'
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
/** The most tokens believed: far above what the largest picture is said to take, so a number past it is not a report but a mistake. */
const MAX_INPUT_TOKENS = 100_000
const MAX_OUTPUT_TOKENS_EACH = 100_000

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
const isTokens = (value: unknown, max: number): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 && value <= max

/** The coarse categories a block names (`safety_violations=[violence, ...]`), as plain words; at most five, letters only. */
export function blockedCategories(message: string): string[] {
  const found = /safety_violations=\[([^\]]{0,200})\]/.exec(message)
  if (found === null) return []
  return found[1]
    .split(',')
    .map((word) => word.trim().toLowerCase())
    .filter((word) => /^[a-z][a-z_-]{0,30}$/.test(word))
    .slice(0, 5)
    .map((word) => word.replace(/[_-]/g, ' '))
}

/** The tokens of an answer's `usage`, when they are whole numbers in bounds; null otherwise. */
export function readTokens(
  usage: unknown,
  count: number
): { input: number; output: number } | null {
  if (!isRecord(usage)) return null
  const { input_tokens: input, output_tokens: output } = usage
  if (!isTokens(input, MAX_INPUT_TOKENS) || !isTokens(output, MAX_OUTPUT_TOKENS_EACH * count))
    return null
  if (output === 0) return null
  return { input, output }
}

export async function generatePictures(request: PictureRequest): Promise<PictureAnswer> {
  const {
    credentials,
    model,
    modelLabel,
    prompt,
    size,
    quality,
    count,
    signal,
    timeoutMs = IMAGE_LIMITS.timeoutMs
  } = request
  let answer: unknown
  try {
    answer = await newClient(credentials).images.generate(
      { model, prompt, n: count, size, quality, output_format: 'png' },
      { signal, timeout: timeoutMs, maxRetries: 0 }
    )
  } catch (error) {
    if (signal?.aborted === true) {
      throw new ImageFailed('Stopped. OpenAI may still bill the request.', 'unknown', false, true)
    }
    // An answer that is not JSON (the SDK's parser throws a SyntaxError) is an answer the app cannot read, not a sentence to show.
    if (error instanceof SyntaxError) {
      throw new ImageFailed('OpenAI sent an answer the app could not read.', 'provider', false)
    }
    if (error instanceof OpenAI.APIError && error.code === 'moderation_blocked') {
      const words = blockedCategories(error.message)
      throw new ImageFailed(
        `OpenAI's safety system refused this description${words.length > 0 ? ` (${words.join(', ')})` : ''}. Nothing was made. You can change the description and try again.`,
        'blocked',
        true
      )
    }
    if (error instanceof OpenAI.PermissionDeniedError && /must be verified/i.test(error.message)) {
      throw new ImageFailed(
        `OpenAI says your organization must be verified before it can use ${modelLabel}. Verify it on OpenAI's website (your organization's settings), then try again.`,
        'permission',
        true
      )
    }
    const normalized = openaiAdapter.normalizeError(error, { modelId: model })
    const words =
      normalized.kind === 'not-found'
        ? `OpenAI says ${modelLabel} (${model}) is not available to this account (404).`
        : describeFailure(normalized, credentials.apiKey)
    throw new ImageFailed(words, normalized.kind, REFUSED_KINDS.includes(normalized.kind))
  }
  if (!isRecord(answer)) {
    throw new ImageFailed('OpenAI sent an answer the app could not read.', 'provider', false)
  }
  const checked = checkAnswerPictures(answer.data, count)
  if (!checked.ok) {
    throw new ImageFailed(
      `The pictures that came back could not be used (${checked.why}), so nothing was kept.`,
      'unusable',
      false
    )
  }
  return { pictures: checked.pictures, tokens: readTokens(answer.usage, count) }
}
