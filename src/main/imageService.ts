import { checkAgainstLimits, formatMoney, limitsAreSet, unsetLimits } from '../shared/limits'
import {
  IMAGE_LIMITS,
  IMAGE_WORDS,
  QUALITY_LABELS,
  SHAPE_LABELS,
  checkImageAsk,
  costFromTokens,
  isQuality,
  isShape,
  maximumCost,
  retirement,
  type ImageAsk,
  type ImageChangeResult,
  type ImageEstimate,
  type ImageGenerateResult,
  type ImageModelOption,
  type ImageStatus,
  type ImagesRegistryResult,
  type PictureResult,
  type PictureSummary
} from '../shared/images'
import type { AttachBytesResult } from '../shared/ipc'
import { NO_TOKENS, type ImageFee } from '../shared/usage'
import type { PictureRecord } from './imageIndex'
import type { ImageSettingsStore } from './imageSettings'
import type { ImageStore } from './imageStore'
import { KeptRefused } from './keptFile'
import type { LimitsStore } from './limits'
import { ImageFailed, generatePictures as realGenerate } from './providers/openaiImages'
import {
  QUESTION_BUSY,
  QUESTION_FAILED,
  QUESTION_RESTING,
  type QuestionGate,
  type SystemQuestion
} from './systemQuestion'
import { ASKED_HERE, shown } from './toolQuestion'
import { RequestRefused, type UsageLedger } from './usageLedger'

// What the person can do with pictures (Stage 16.4, D-048). The switch is imageSettings.ts, the gallery imageStore.ts, the request imageCheck.ts and openaiImages.ts; this
// decides what may happen and in which order. Main alone; the page gets `status()` and these calls, and no way to answer a question, to name a size, an address, a key or
// a price (main works the most out itself, from registry/images.json), or to start a picture without the person (the model has no tool for it).
//
// The order of a request (`generate`), each step able to stop it before anything is paid for: one request at a time; the request checked (checkImageAsk); the switch on and
// readable; an OpenAI key; the gallery has room; the most it can cost, from the file; the limits allow that most; above $0.50 the person's yes in the system's box; the
// ledger's record (the most reserved, the limits checked again in the ledger's own turn); THEN the one request; the bytes checked; the record finished at the real cost (the
// tokens the answer reported, or the table's figure marked as a guess); the pictures kept. A request is never sent without a record, and a record is never left "sent" for
// good: every way out settles it. No Electron imports.

const BUSY_CHANGING = 'The image settings are still being changed.'
const NOT_ON = 'Making images is still off.'
const NOTHING_TO_RESET = 'The image settings can be read, so there is nothing to start again.'
const changeRefused = (why: string): string =>
  `Nothing was changed: your image settings could not be read (${why}). Making images is off. Start again in Settings; the app keeps a copy of the file.`

/** The question before "Make images" is switched on. */
export function imagesOnQuestion(): SystemQuestion {
  return {
    title: 'Make images',
    message: 'Let this app send your picture descriptions to OpenAI?',
    detail: [
      'When you press Make in the "Make an image" dialog, the app sends the description you wrote, with the model, shape, quality and number of pictures you chose, to OpenAI, which makes the pictures. Nothing is sent until you press Make, and the model you chat with cannot start a picture.',
      '',
      'This happens even when you chat with Claude: Anthropic cannot make pictures, so every picture comes from OpenAI, with your OpenAI key.',
      '',
      `A picture costs from about $0.005 to $0.21 with GPT Image 2 (the dialog shows the most before you press Make), and the newer models' prices are not published, so their figure is a ceiling. It counts against your spending limits and shows in Settings, under Usage. A request that could cost more than ${formatMoney(IMAGE_LIMITS.askAboveUsd)} asks you again here.`,
      '',
      "OpenAI's content policy applies: it may refuse a description, and the app never asks it to be less strict.",
      '',
      'The app keeps your pictures and their descriptions on this computer, in its data folder (encrypted with your chats when chat encryption is on). OpenAI handles what it receives under its own policy.',
      '',
      'You can turn it off again in Settings, under Images.',
      '',
      ASKED_HERE
    ].join('\n'),
    yes: 'Turn on',
    no: "Don't turn on"
  }
}

const cut = (text: string, max: number): string =>
  Array.from(text).length > max ? `${Array.from(text).slice(0, max).join('')}...` : text

/** The question before a request whose most is above $0.50. */
export function bigRequestQuestion(ask: ImageAsk, maxUsd: number, about: boolean): SystemQuestion {
  const count = `${ask.count} ${ask.count === 1 ? 'picture' : 'pictures'}`
  return {
    title: 'Make images',
    message: `Spend up to ${about ? 'about ' : ''}${formatMoney(maxUsd)} on ${count}?`,
    detail: [
      `Description: ${shown(cut(ask.prompt, 500))}`,
      `Model: ${ask.model.label}`,
      `Shape: ${SHAPE_LABELS[ask.shape]} (${ask.size})`,
      `Quality: ${QUALITY_LABELS[ask.quality]}`,
      `Pictures: ${ask.count}`,
      `At most: ${about ? 'about ' : ''}${formatMoney(maxUsd)}${about ? " (OpenAI does not publish this model's prices, so this is the app's ceiling)" : ''}`,
      '',
      `The app asks here for every request that could cost more than ${formatMoney(IMAGE_LIMITS.askAboveUsd)}. It counts against your spending limits.`,
      '',
      ASKED_HERE
    ].join('\n'),
    yes: 'Make them',
    no: "Don't make them"
  }
}

/** The question before a picture is deleted. */
export function removeQuestion(record: PictureRecord): SystemQuestion {
  return {
    title: 'Delete a picture',
    message: 'Delete this picture from the gallery?',
    detail: [
      `Description: ${shown(cut(record.prompt, 300))}`,
      `Made: ${new Date(record.at).toLocaleString('en-GB')}`,
      '',
      'The app\'s own copy is deleted and cannot be brought back. Copies you saved elsewhere with "Save a copy..." are not touched. A chat that showed it will say that it was deleted.',
      '',
      ASKED_HERE
    ].join('\n'),
    yes: 'Delete',
    no: 'Keep'
  }
}

export interface ImageServiceOptions {
  settings: ImageSettingsStore
  store: ImageStore
  gate: QuestionGate
  /** The saved OpenAI key, or null. For this file only: it is never sent to the page. */
  key: () => Promise<string | null>
  /** FRONTIER_API_BASE_URL, when running from source. */
  baseUrl: () => string | undefined
  limits: LimitsStore
  ledger: UsageLedger
  registry: () => ImagesRegistryResult
  now?: () => number
  /** The system's save dialog for "Save a copy...": the path the person chose, or null. */
  savePath: (owner: unknown, suggestedName: string, type: string) => Promise<string | null>
  /** Writes the plain copy where the person chose (the default writes the file). */
  writeCopy: (path: string, bytes: Buffer) => Promise<void>
  /** Hands a picture to the attachments, as a pasted file would be ("Use in chat"). */
  attach: (bytes: Buffer, name: string) => Promise<AttachBytesResult>
  /** Instead of the real adapter, for the checks. */
  generate?: typeof realGenerate
}

export interface ImageService {
  status(): Promise<ImageStatus>
  /** `{ on }` from the page. ON asks in the system's box (for `owner`, the window that asked); OFF does not, and stops a request on its way. */
  setOn(owner: unknown, input: unknown): Promise<ImageChangeResult>
  /** Starts again when the file could not be read: off, the old file kept as a copy. */
  reset(): Promise<ImageChangeResult>
  /** `{ model, shape, quality, count }`: the most it would cost, and whether it would be refused or asked about. */
  estimate(input: unknown): Promise<ImageEstimate>
  /** `{ prompt, model, shape, quality, count, chat }`: makes the pictures, if everything allows it. `owner` is the window that asked (for the box). */
  generate(owner: unknown, input: unknown): Promise<ImageGenerateResult>
  /** Stops the request on its way. It may still be billed. */
  stop(): void
  list(): Promise<{ pictures: PictureSummary[]; problem: string | null }>
  picture(id: unknown): Promise<PictureResult>
  saveCopy(
    owner: unknown,
    id: unknown
  ): Promise<{ ok: true } | { ok: false; error: string; cancelled?: true }>
  remove(
    owner: unknown,
    id: unknown
  ): Promise<{ ok: true } | { ok: false; error: string; cancelled?: true }>
  useInChat(id: unknown): Promise<AttachBytesResult>
}

const reason = (error: unknown): unknown => (error instanceof Error ? error.message : error)
const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
const exactly = (value: unknown, keys: string): value is Record<string, unknown> =>
  isRecord(value) && Object.keys(value).sort().join() === keys
const EXTENSIONS: Readonly<Record<string, string>> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp'
}

export function createImageService(options: ImageServiceOptions): ImageService {
  const { settings, store, gate, limits, ledger } = options
  const now = options.now ?? Date.now
  const generate = options.generate ?? realGenerate
  let changing = false
  let inFlight: AbortController | null = null
  let making = false

  async function oneChange(task: () => Promise<ImageChangeResult>): Promise<ImageChangeResult> {
    if (changing) return { ok: false, error: BUSY_CHANGING }
    changing = true
    try {
      return await task()
    } finally {
      changing = false
    }
  }

  const modelLabel = (id: string): string => {
    const registry = options.registry()
    return (
      (registry.ok ? registry.registry.models.find((m) => m.id === id)?.label : undefined) ?? id
    )
  }

  async function summaryOf(record: PictureRecord): Promise<PictureSummary> {
    const base = {
      id: record.id,
      prompt: record.prompt,
      model: record.model,
      modelLabel: modelLabel(record.model),
      shape: record.shape,
      quality: record.quality,
      width: record.width,
      height: record.height,
      at: record.at,
      costUsd: record.costUsd,
      estimate: record.estimate,
      chat: record.chat
    }
    const read = await store.read(record.id)
    if (!read.ok) return { ...base, thumbnail: null, missing: read.error }
    return { ...base, thumbnail: await store.thumbnail(record.id) }
  }

  async function status(): Promise<ImageStatus> {
    const { settings: chosen, problem } = await settings.read()
    const key = await options.key()
    const limitsChosen = limitsAreSet(await limits.read().catch(() => unsetLimits()))
    const registry = options.registry()
    const listed = await store
      .list()
      .catch(() => ({ pictures: [], problem: 'it could not be read' }))
    const models: ImageModelOption[] = registry.ok
      ? registry.registry.models.map((m) => ({
          id: m.id,
          label: m.label,
          description: m.description,
          retires: m.retires,
          state: retirement(m, now()),
          published: m.published,
          perPicture: m.perPicture
        }))
      : []
    const blocked =
      problem !== null
        ? `Your image settings could not be read (${problem}).`
        : !registry.ok
          ? IMAGE_WORDS.noModels
          : !chosen.on
            ? IMAGE_WORDS.off
            : key === null
              ? IMAGE_WORDS.noKey
              : !limitsChosen
                ? IMAGE_WORDS.noLimits
                : null
    return {
      on: chosen.on,
      blocked,
      problem,
      registryError: registry.ok ? null : registry.error,
      models,
      defaultModelId: registry.ok ? registry.registry.defaultModelId : null,
      askAboveUsd: IMAGE_LIMITS.askAboveUsd,
      maxCount: IMAGE_LIMITS.maxCount,
      maxPromptChars: IMAGE_LIMITS.maxPromptChars,
      pictures: listed.pictures.length,
      galleryMax: IMAGE_LIMITS.galleryMax
    }
  }

  async function write(on: boolean, replace = false): Promise<ImageChangeResult> {
    try {
      await settings.write({ on }, { replace })
    } catch (error) {
      if (error instanceof KeptRefused) return { ok: false, error: error.message }
      console.error('Writing the image settings failed:', reason(error))
      return { ok: false, error: 'The image settings could not be saved.' }
    }
    return { ok: true, status: await status() }
  }

  /** What the limits say of `requestUsd` now, and what is left today and this month. */
  async function limitsNow(
    requestUsd: number
  ): Promise<{ refusal: string | null; leftToday: number | null; leftMonth: number | null }> {
    const spent = await ledger.summary(null)
    const chosen = await limits.read()
    const left = (setting: typeof chosen.daily, used: number): number | null =>
      setting.kind === 'usd' ? Math.max(0, setting.usd - used) : null
    return {
      refusal: checkAgainstLimits(chosen, {
        today: spent.today.costUsd,
        month: spent.month.costUsd,
        request: requestUsd
      }),
      leftToday: left(chosen.daily, spent.today.costUsd),
      leftMonth: left(chosen.monthly, spent.month.costUsd)
    }
  }

  return {
    status,

    setOn: (owner, input) =>
      oneChange(async () => {
        if (!exactly(input, 'on') || typeof input.on !== 'boolean')
          return { ok: false, error: IMAGE_WORDS.notUnderstood }
        const { settings: chosen, problem } = await settings.read()
        if (problem !== null) return { ok: false, error: changeRefused(problem) }
        if (!input.on) {
          inFlight?.abort()
          return write(false)
        }
        if (chosen.on) return { ok: true, status: await status() }
        if ((await options.key()) === null) return { ok: false, error: IMAGE_WORDS.noKey }
        const answer = await gate.ask(owner, imagesOnQuestion())
        if (answer === 'busy') return { ok: false, error: QUESTION_BUSY }
        if (answer === 'resting') return { ok: false, error: QUESTION_RESTING }
        if (answer === 'failed') return { ok: false, error: QUESTION_FAILED }
        if (answer !== 'yes') return { ok: false, error: NOT_ON }
        return write(true)
      }),

    reset: () =>
      oneChange(async () => {
        const { problem } = await settings.read()
        if (problem === null) return { ok: false, error: NOTHING_TO_RESET }
        inFlight?.abort()
        return write(false, true)
      }),

    estimate: async (input) => {
      if (!exactly(input, 'count,model,quality,shape'))
        return { ok: false, error: IMAGE_WORDS.notUnderstood }
      const registry = options.registry()
      if (!registry.ok) return { ok: false, error: IMAGE_WORDS.noModels }
      const model = registry.registry.models.find((m) => m.id === input.model)
      const { count } = input
      if (
        model === undefined ||
        !isShape(input.shape) ||
        !isQuality(input.quality) ||
        !Number.isInteger(count) ||
        (count as number) < 1 ||
        (count as number) > IMAGE_LIMITS.maxCount
      ) {
        return { ok: false, error: IMAGE_WORDS.notUnderstood }
      }
      const most = maximumCost(model, input.shape, input.quality, count as number)
      try {
        const now2 = await limitsNow(most.usd)
        return {
          ok: true,
          maxUsd: most.usd,
          about: most.about,
          leftTodayUsd: now2.leftToday,
          leftMonthUsd: now2.leftMonth,
          asks: most.usd > IMAGE_LIMITS.askAboveUsd,
          refusal:
            retirement(model, now()) === 'retired'
              ? `${model.label} was retired by OpenAI on ${model.retires} and cannot be used.`
              : now2.refusal
        }
      } catch (error) {
        console.error('Checking the limits for a picture failed:', reason(error))
        return { ok: false, error: IMAGE_WORDS.noLimits }
      }
    },

    generate: async (owner, input) => {
      if (making) return { ok: false, kind: 'refused', error: IMAGE_WORDS.busy }
      making = true
      try {
        const registry = options.registry()
        if (!registry.ok) return { ok: false, kind: 'refused', error: IMAGE_WORDS.noModels }
        const checked = checkImageAsk(input, registry.registry, now())
        if (!checked.ok) return { ok: false, kind: 'refused', error: checked.error }
        const ask = checked.ask
        const { settings: chosen, problem } = await settings.read()
        if (problem !== null || !chosen.on)
          return { ok: false, kind: 'refused', error: IMAGE_WORDS.off }
        const apiKey = await options.key()
        if (apiKey === null) return { ok: false, kind: 'refused', error: IMAGE_WORDS.noKey }
        const full = await store.room(ask.count)
        if (full !== null) return { ok: false, kind: 'refused', error: full }
        const most = maximumCost(ask.model, ask.shape, ask.quality, ask.count)
        try {
          const before = await limitsNow(most.usd)
          if (before.refusal !== null) return { ok: false, kind: 'refused', error: before.refusal }
        } catch (error) {
          console.error('Checking the limits for a picture failed:', reason(error))
          return { ok: false, kind: 'refused', error: IMAGE_WORDS.noLimits }
        }
        if (most.usd > IMAGE_LIMITS.askAboveUsd) {
          const answer = await gate.ask(owner, bigRequestQuestion(ask, most.usd, most.about))
          if (answer === 'busy') return { ok: false, kind: 'refused', error: QUESTION_BUSY }
          if (answer === 'resting') return { ok: false, kind: 'refused', error: QUESTION_RESTING }
          if (answer === 'failed') return { ok: false, kind: 'refused', error: QUESTION_FAILED }
          if (answer !== 'yes') return { ok: false, kind: 'refused', error: IMAGE_WORDS.notAsked }
        }

        const reserved: ImageFee = { kind: 'generate', count: ask.count, usd: most.usd }
        let record
        try {
          // The limits are read first, as the chat does: the ledger's check runs in its own turn and is not asynchronous.
          const chosenLimits = await limits.read()
          record = await ledger.begin(
            {
              chat: ask.chat,
              provider: 'openai',
              model: ask.model.id,
              effort: null,
              prices: {
                inputPerMTok: 0,
                cacheReadPerMTok: 0,
                cacheWritePerMTok: 0,
                outputPerMTok: 0
              },
              inputTokens: 0,
              reserveUsd: most.usd,
              image: reserved
            },
            (spend) => checkAgainstLimits(chosenLimits, spend)
          )
        } catch (error) {
          if (error instanceof RequestRefused)
            return { ok: false, kind: 'refused', error: error.message }
          console.error('Counting a picture request failed:', reason(error))
          return {
            ok: false,
            kind: 'failed',
            error: 'The request could not be counted, so it was not sent.'
          }
        }

        const control = new AbortController()
        inFlight = control
        let answer
        try {
          answer = await generate({
            credentials: { apiKey, baseURL: options.baseUrl() },
            model: ask.model.id,
            modelLabel: ask.model.label,
            prompt: ask.prompt,
            size: ask.size,
            quality: ask.quality,
            count: ask.count,
            signal: control.signal
          })
        } catch (error) {
          const failed = error instanceof ImageFailed ? error : null
          // refused outright: nothing is owed; given up (Stop, the switch turned off, the app closing): maybe billed, counted at the most; anything else: maybe billed
          await ledger.finish(record.id, {
            state: failed?.rejected ? 'rejected' : failed?.stopped ? 'stopped' : 'failed',
            tokens: { ...NO_TOKENS },
            estimate: true,
            image: reserved
          })
          if (failed?.stopped) return { ok: false, kind: 'stopped', error: IMAGE_WORDS.stopped }
          if (failed === null) console.error('Asking for pictures failed:', reason(error))
          return {
            ok: false,
            kind: failed?.kind === 'blocked' ? 'blocked' : 'failed',
            error: failed?.message ?? IMAGE_WORDS.failed
          }
        } finally {
          if (inFlight === control) inFlight = null
        }

        // The cost: the tokens the answer reported, at the model's prices; when it reported none, the table's figure (for a ceiling model, the ceiling), as a guess.
        const costUsd = answer.tokens !== null ? costFromTokens(ask.model, answer.tokens) : most.usd
        const estimate = answer.tokens === null
        await ledger.finish(record.id, {
          state: 'done',
          tokens:
            answer.tokens === null
              ? { ...NO_TOKENS }
              : {
                  input: answer.tokens.input,
                  cacheRead: 0,
                  cacheWrite: 0,
                  output: answer.tokens.output
                },
          estimate,
          image: { kind: 'generate', count: ask.count, usd: Math.min(costUsd, 100) }
        })
        let kept: PictureRecord[]
        try {
          kept = await store.add(answer.pictures, {
            prompt: ask.prompt,
            model: ask.model.id,
            shape: ask.shape,
            quality: ask.quality,
            chat: ask.chat,
            costEach: costUsd / ask.count,
            estimate
          })
        } catch (error) {
          const why =
            error instanceof KeptRefused
              ? error.message
              : 'they could not be written to the data folder'
          if (!(error instanceof KeptRefused))
            console.error('Keeping pictures failed:', reason(error))
          return {
            ok: false,
            kind: 'failed',
            error: `The pictures were made (and counted, ${formatMoney(costUsd)}) but could not be kept: ${why}`
          }
        }
        const pictures: PictureSummary[] = []
        for (const one of kept) pictures.push(await summaryOf(one))
        return { ok: true, pictures, costUsd, estimate }
      } finally {
        making = false
      }
    },

    stop: () => {
      inFlight?.abort()
    },

    list: async () => {
      const listed = await store.list()
      const pictures: PictureSummary[] = []
      // newest first
      for (const record of [...listed.pictures].reverse()) pictures.push(await summaryOf(record))
      return { pictures, problem: listed.problem }
    },

    picture: async (id) => {
      const read = await store.read(id)
      if (!read.ok) return { ok: false, error: read.error }
      return {
        ok: true,
        dataUrl: `data:${read.record.type};base64,${read.bytes.toString('base64')}`,
        summary: await summaryOf(read.record)
      }
    },

    saveCopy: async (owner, id) => {
      const read = await store.read(id)
      if (!read.ok) return { ok: false, error: read.error }
      const day = new Date(read.record.at).toISOString().slice(0, 10)
      const name = `picture-${day}-${read.record.id.slice(0, 8)}.${EXTENSIONS[read.record.type] ?? 'png'}`
      const path = await options.savePath(owner, name, read.record.type)
      if (path === null) return { ok: false, cancelled: true, error: 'Cancelled.' }
      try {
        await options.writeCopy(path, read.bytes)
      } catch (error) {
        console.error('Saving a copy of a picture failed:', reason(error))
        return { ok: false, error: 'The copy could not be saved there.' }
      }
      return { ok: true }
    },

    remove: async (owner, id) => {
      const listed = await store.list()
      const record = listed.pictures.find((p) => p.id === id)
      if (record === undefined)
        return {
          ok: false,
          error:
            listed.problem !== null
              ? `The list of your pictures could not be read (${listed.problem}).`
              : IMAGE_WORDS.missing
        }
      const answer = await gate.ask(owner, removeQuestion(record))
      if (answer === 'busy') return { ok: false, error: QUESTION_BUSY }
      if (answer === 'resting') return { ok: false, error: QUESTION_RESTING }
      if (answer === 'failed') return { ok: false, error: QUESTION_FAILED }
      if (answer !== 'yes') return { ok: false, cancelled: true, error: 'The picture was kept.' }
      return store.remove(record.id)
    },

    useInChat: async (id) => {
      const read = await store.read(id)
      if (!read.ok) return { ok: false, error: read.error }
      const name = `picture-${read.record.id.slice(0, 8)}.${EXTENSIONS[read.record.type] ?? 'png'}`
      return options.attach(read.bytes, name)
    }
  }
}
