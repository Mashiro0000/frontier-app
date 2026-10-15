import { BrowserWindow, ipcMain, type WebContents } from 'electron'
import {
  askFirstAmount,
  estimateRequest,
  needsConfirmation,
  needsConfirmationAgain,
  type RequestEstimate
} from '../shared/askFirst'
import { CHANNELS, type ChatRequest, type ChatStreamEvent } from '../shared/ipc'
import { checkAgainstLimits, withFilesNote, type Limits } from '../shared/limits'
import type { Note } from '../shared/memory'
import type { Project } from '../shared/projects'
import { PROVIDER_NAMES, type Effort, type ProviderId } from '../shared/registry'
import type { ToolSettings } from '../shared/tools'
import {
  costOf,
  costOfRecord,
  estimateFileTokens,
  estimateInputTokens,
  estimateOutputTokens,
  NO_TOKENS,
  SEARCH_FEE_USD,
  tokensAreEmpty,
  type LedgerRecord,
  type LedgerState,
  type ReplyUsage,
  type SearchFee,
  type TokenCounts
} from '../shared/usage'
import { checkChatRequest } from '../shared/validate'
import type { AskFirstStore } from './askFirst'
import { resolveAttachments } from './attachmentRequest'
import type { ReadResult } from './attachmentStore'
import { baseUrlOverride } from './baseUrl'
import { createConfirmations } from './confirmation'
import { readApiKey } from './keyStore'
import { currentModel } from './models'
import type { LimitsStore } from './limits'
import { adapterFor } from './providers'
import { describeFailure, unknownError } from './providers/errors'
import { buildStreamRequest } from './providers/request'
import { SEARCH_MAX_OUTPUT_TOKENS, SEARCH_SYSTEM, searchPrompt } from './providers/search'
import type {
  ErrorKind,
  NeutralMessage,
  NeutralToolCall,
  ProviderAdapter,
  ReplyEnd,
  SearchResult,
  ToolSpec,
  Usage
} from './providers/types'
import type { ConnectorTools, ToolRuntime, TurnEnd } from './replyTools'
import { heldKey, keyInInstructions, keyInNotes, type SavedKey } from './secrets'
import { isTrustedSender } from './security'
import { RequestRefused, type UsageLedger } from './usageLedger'

const noKeyMessage = (provider: ProviderId): string =>
  `No API key is saved yet. Open Settings and add your ${PROVIDER_NAMES[provider]} API key.`

/**
 * Failures that mean the provider turned the request away before doing any work, so nothing is owed for it: a key, a permission, a
 * model, a rate or a credit it would not accept, a request it could not take, a connection that never reached it, or a provider too
 * busy to start. Every other failure may have cost something (a connection dropped in the middle of a reply, a timeout, a server
 * error) and is counted as a guess (D-030), as is any failure that came after some text had arrived.
 */
const REFUSED_BEFORE_WORK: ReadonlySet<ErrorKind> = new Set([
  'auth',
  'permission',
  'not-found',
  'rate-limit',
  'quota',
  'bad-request',
  'connection',
  'overloaded'
])

const tokensOf = (usage: Usage): TokenCounts => ({
  input: usage.inputTokens,
  cacheRead: usage.cacheReadTokens,
  cacheWrite: usage.cacheWriteTokens,
  output: usage.outputTokens
})

const replyUsageOf = (record: LedgerRecord): ReplyUsage => ({
  tokens: record.tokens,
  costUsd: costOfRecord(record),
  estimate: record.estimate
})

/** The usage of a reply that sent several requests (a tool was used): the requests added up. One request is reported exactly as it always was. */
function replyUsageOfAll(records: readonly LedgerRecord[]): ReplyUsage {
  if (records.length === 1) return replyUsageOf(records[0])
  const tokens: TokenCounts = { ...NO_TOKENS }
  let costUsd = 0
  let estimate = false
  for (const record of records) {
    tokens.input += record.tokens.input
    tokens.cacheRead += record.tokens.cacheRead
    tokens.cacheWrite += record.tokens.cacheWrite
    tokens.output += record.tokens.output
    costUsd += costOfRecord(record)
    estimate = estimate || record.estimate
  }
  return { tokens, costUsd, estimate }
}

/** Replies in progress, by "<window id>:<stream id>", so each one can be stopped on its own. */
const running = new Map<string, AbortController>()
const watched = new WeakSet<WebContents>()
/** Large requests waiting for the person's yes (D-032), under the same keys as `running`: a yes is heard only for a question that is waiting. */
const confirmations = createConfirmations()

function stopAllFor(windowId: number): void {
  for (const [key, controller] of running) {
    if (key.startsWith(`${windowId}:`)) controller.abort()
  }
}

/** A reply nobody is waiting for any more should not keep running (and costing money). */
function stopWhenPageGoes(sender: WebContents): void {
  if (watched.has(sender)) return
  watched.add(sender)
  const id = sender.id
  sender.once('destroyed', () => stopAllFor(id))
  sender.on('did-start-navigation', (details) => {
    if (details.isMainFrame && !details.isSameDocument) stopAllFor(id) // a reload, for example
  })
}

function endEvent(streamId: string, end: ReplyEnd): ChatStreamEvent {
  switch (end.kind) {
    case 'cut-off':
      return {
        streamId,
        type: 'error',
        message: 'The reply reached the length limit and was cut off.'
      }
    case 'declined':
      return {
        streamId,
        type: 'error',
        message: `The model declined to answer this${end.category ? ` (${end.category})` : ''}.`
      }
    case 'context-full':
      return {
        streamId,
        type: 'error',
        message: 'The conversation has grown too long for the model to continue.'
      }
    default:
      return { streamId, type: 'done' }
  }
}

/** What the reply says when a cap on its tools was reached (the model's words so far stay). The person can change both on the Tools page. */
function capMessage(
  reason: Exclude<TurnEnd, 'stopped' | null>,
  caps: { steps: number; seconds: number },
  fileCaps: { calls: number; chars: number }
): string {
  switch (reason) {
    case 'step-cap':
      return `Stopped: this reply used all ${caps.steps} of its tool steps.`
    case 'file-cap':
      return `Stopped: this reply used all ${fileCaps.calls} of its file calls.`
    case 'chars-cap':
      return `Stopped: this reply was given all ${fileCaps.chars.toLocaleString('en-US')} characters of file text it may read.`
    default:
      return `Stopped: this reply used all ${caps.seconds} seconds of its tool time.`
  }
}

/** A guess at the input a search request sends beyond the words: the pages it reads arrive as input tokens (a search typically reads thousands). */
const SEARCH_RESULTS_GUESS_TOKENS = 8000
/** A guess at what the tools' definitions add to a request: the definitions themselves, and the provider's own lines about using tools. */
const TOOL_PROMPT_GUESS_TOKENS = 400

/**
 * What a reply needs besides the request: the stores it counts and checks against, the reader of the attachments' copies (D-037), the person's
 * instructions for every chat and the saved keys (D-039).
 */
interface ReplyContext {
  ledger: UsageLedger
  limitsStore: LimitsStore
  askFirstStore: AskFirstStore
  readAttachment: (id: string) => Promise<ReadResult>
  /** The instructions for every chat, from main's own file: the text ('' for none), or the sentence that refuses the request while it cannot be read. */
  everyChat: () => Promise<{ ok: true; text: string } | { ok: false; error: string }>
  /** The API keys saved in this app: none of them goes out inside instructions. */
  savedKeys: () => Promise<SavedKey[]>
  /**
   * The person's notes for a chat in a project (or none, `null`), from main's own file (10.4): their text, oldest first ([] while memory is off), or the
   * sentence that refuses the request while the file cannot be read.
   */
  notes: (
    projectId: string | null
  ) => Promise<{ ok: true; notes: Note[] } | { ok: false; error: string }>
  /** The project a chat in it brings (10.6), from main's own file: null when there is no such project, or the sentence that refuses the request. */
  project: (
    id: string
  ) => Promise<{ ok: true; project: Project | null } | { ok: false; error: string }>
  /**
   * The tools (11.3, D-041). `settings` answers with which tools are switched on and the caps, from main's own file, at every turn (every tool off when
   * the file cannot be read); `runtime` makes the tools of one reply. Absent: no tool is ever offered, and the reply is what it always was.
   */
  tools?: {
    settings: () => Promise<ToolSettings>
    runtime: ToolRuntime
    /** The tools of the connectors that are switched on (14, D-045), read when a reply begins; the settings say at every turn which of them are still on. */
    connectors?: () => Promise<ConnectorTools>
  }
}

async function runReply(
  windowId: number,
  owner: unknown,
  request: ChatRequest,
  send: (event: ChatStreamEvent) => void,
  context: ReplyContext
): Promise<void> {
  const { ledger, limitsStore, askFirstStore } = context
  const { streamId } = request
  const key = `${windowId}:${streamId}`
  if (running.has(key)) {
    send({ streamId, type: 'error', message: 'That reply is already running.' })
    return
  }
  const controller = new AbortController()
  running.set(key, controller)
  let apiKey = ''
  let modelId = ''
  let adapter: ProviderAdapter | null = null
  // The ledger's record of the request in flight (D-030): made just before it is sent, and settled exactly once, with the provider's own report
  // when there is one, with a guess marked as one when there is not, or as "nothing owed" when the provider turned it away. A reply that uses a tool
  // sends several requests, one after another (11.3), and a search is one more; each has a record of its own, and the usage the page is told is their sum.
  let began: LedgerRecord | null = null
  const settledAs: { record: LedgerRecord | null } = { record: null }
  let arrivedBytes = 0
  /** Every record of this reply that was settled, in order. */
  const settledRecords: LedgerRecord[] = []

  /** Settles one record: the provider's report, or a guess marked as one, or nothing owed. Returns the record as it now stands (null if it could not be written). */
  const settleRecord = async (
    record: LedgerRecord,
    state: Exclude<LedgerState, 'sent'>,
    real: Usage | null,
    arrived: number,
    search?: SearchFee
  ): Promise<LedgerRecord | null> => {
    const report = real !== null && !tokensAreEmpty(tokensOf(real)) ? tokensOf(real) : null
    // With no report (a reply stopped, a connection dropped, a provider that said nothing): the input that was sent and the text that
    // arrived, as a guess. Nothing at all for a request that was turned away.
    const tokens: TokenCounts =
      state === 'rejected'
        ? { ...NO_TOKENS }
        : (report ?? {
            ...NO_TOKENS,
            input: record.tokens.input,
            output: estimateOutputTokens(arrived)
          })
    const finished = await ledger.finish(record.id, {
      state,
      tokens,
      estimate: state !== 'rejected' && report === null,
      ...(search === undefined || search.count === 0 ? {} : { search })
    })
    if (finished) settledRecords.push(finished.record)
    return finished ? finished.record : null
  }

  const settle = async (state: Exclude<LedgerState, 'sent'>, real: Usage | null): Promise<void> => {
    if (began === null || settledAs.record !== null) return
    const finished = await settleRecord(began, state, real, arrivedBytes)
    if (finished) settledAs.record = finished
  }

  /** Tells the page what the reply cost, if anything is owed. Called just before the reply's last event. */
  const sendUsage = (): void => {
    const owed = settledRecords.filter((record) => record.state !== 'rejected')
    if (owed.length > 0) send({ streamId, type: 'usage', usage: replyUsageOfAll(owed) })
  }

  try {
    // The model is fixed here, for this whole reply: a later change of model applies from the next one. Its provider
    // decides which adapter answers, and which key goes with the request.
    const model = await currentModel()
    if (!model.ok) {
      send({ streamId, type: 'error', message: model.error })
      return
    }
    const { entry, effort } = model // fixed with the model, for this whole reply (D-024)
    adapter = adapterFor(entry.provider)
    modelId = entry.id
    // Before anything else is looked up or sent, say who answers (D-021): the page records it on the reply, so even a reply
    // that fails at once (no key, a key that is refused) says which model was asked. Nothing secret is in it.
    send({ streamId, type: 'start', provider: entry.provider, model: entry.id })
    // Each provider has a key of its own (D-020): the one that goes with this model's provider, and no other.
    const saved = await readApiKey(entry.provider)
    if (saved === null) {
      send({ streamId, type: 'error', message: noKeyMessage(entry.provider) })
      return
    }
    apiKey = saved
    // The chat's project (D-039, 10.6), read from main's own file for every request: a project that cannot be read refuses the request, and one that is
    // not there any more is none. The page only names it.
    let project: Project | null = null
    if (request.projectId !== undefined) {
      const found = await context.project(request.projectId)
      if (!found.ok) {
        send({ streamId, type: 'error', message: found.error })
        return
      }
      project = found.project
    }
    // A project's files go with every message of its chats, at the start of the conversation, before the first message's own (a file the chat also
    // carries is sent once). They count against the caps of one request together with the chat's own.
    const projectFiles = (project?.files ?? []).map((file) => ({ id: file.id, name: file.name }))
    const messages =
      projectFiles.length === 0
        ? request.messages
        : request.messages.map((message, index) =>
            index === 0
              ? {
                  ...message,
                  attachments: [
                    ...projectFiles,
                    ...(message.attachments ?? []).filter(
                      (file) => !projectFiles.some((p) => p.id === file.id)
                    )
                  ]
                }
              : message
          )
    // The files of the conversation (D-037): read from main's own copies and checked, every time, before anything is counted or sent. A file that cannot be
    // read, a kind of file the model cannot read, or files over the caps of one request: nothing is sent, and the person is told why.
    const resolved = await resolveAttachments(messages, entry, context.readAttachment)
    if (!resolved.ok) {
      send({
        streamId,
        type: 'error',
        message:
          projectFiles.length === 0
            ? resolved.error
            : `${resolved.error} The project's files count too: they go with every message of its chats.`
      })
      return
    }
    // The person's instructions for every chat (D-039), from main's own file and never from the page, read for every request. A file that cannot be read
    // refuses the request: a chat is never sent without them in silence.
    const everyChat = await context.everyChat()
    if (!everyChat.ok) {
      send({ streamId, type: 'error', message: everyChat.error })
      return
    }
    // No API key saved in this app goes out inside instructions, whichever part holds it: the person may have pasted one before saving it in Settings.
    const keys = await context.savedKeys()
    for (const [whose, text] of [
      ['for every chat', everyChat.text],
      ['for this project', project?.instructions ?? ''],
      ['for this chat', request.instructions ?? '']
    ] as const) {
      const held = heldKey(text, keys)
      if (held !== null) {
        send({ streamId, type: 'error', message: keyInInstructions(held, whose) })
        return
      }
    }
    // The person's notes (10.4), from main's own file and never from the page, read for every request: every chat's, then the project's (10.6).
    // A file that cannot be read refuses the request, and so does a note that holds a saved key (looked at one note at a time).
    const memory = await context.notes(project?.id ?? null)
    if (!memory.ok) {
      send({ streamId, type: 'error', message: memory.error })
      return
    }
    for (const note of memory.notes) {
      const held = heldKey(note.text, keys)
      if (held !== null) {
        send({ streamId, type: 'error', message: keyInNotes(held) })
        return
      }
    }

    // The tools of this reply (11.3, D-041). Which are switched on is read from main's own file now and again before every turn; none is on unless the
    // person switched it on (deny by default). The cheapest effort the model lists for a search request: it only has to run one search and say what it found.
    const searchEffort: Effort | null = entry.capabilities.effortLevels.includes('low')
      ? 'low'
      : effort
    const countedSearch = async (query: string, signal: AbortSignal): Promise<SearchResult> => {
      if (adapter === null) throw new Error('there is no provider to ask')
      const limits = await limitsStore.read()
      // The search is a request like any other: counted in the ledger before it goes out, with the spending limits applied (D-030, D-031).
      const input =
        estimateInputTokens(SEARCH_SYSTEM, [{ content: searchPrompt(query) }]) +
        SEARCH_RESULTS_GUESS_TOKENS
      const record = await ledger.begin(
        {
          chat: request.conversationId ?? null,
          provider: entry.provider,
          model: entry.id,
          effort: searchEffort,
          prices: entry.pricing,
          inputTokens: input,
          reserveUsd: SEARCH_FEE_USD[entry.provider] // the provider's fee for the search is counted against the limits too (11.6)
        },
        (spend) => checkAgainstLimits(limits, spend)
      )
      try {
        const found = await adapter.search({
          credentials: { apiKey, baseURL: baseUrlOverride(entry.provider) },
          model: entry,
          effort: searchEffort,
          query,
          maxOutputTokens: SEARCH_MAX_OUTPUT_TOKENS,
          signal
        })
        await settleRecord(
          record,
          signal.aborted ? 'stopped' : 'done',
          found.usage,
          Buffer.byteLength(found.text),
          // The provider bills each search it ran, and none that failed (11.6).
          { count: found.searches, usdEach: SEARCH_FEE_USD[entry.provider] }
        )
        return found
      } catch (error) {
        const failure = adapter.normalizeError(error, { modelId })
        await settleRecord(
          record,
          signal.aborted
            ? 'stopped'
            : REFUSED_BEFORE_WORK.has(failure.kind)
              ? 'rejected'
              : 'failed',
          null,
          0
        )
        throw error
      }
    }
    // Whether a search could be paid for under the spending limits as they are NOW (11.6), asked before the person is: a search the limits would refuse is not
    // asked about, because a yes could not make it run. A fault in looking counts as yes: the search itself is checked again, and refused there, when it is made.
    const affordableSearch = async (): Promise<boolean> => {
      const limits = await limitsStore.read()
      const sums = await ledger.summary(null)
      const guess =
        estimateInputTokens(SEARCH_SYSTEM, [{ content: searchPrompt('') }]) +
        SEARCH_RESULTS_GUESS_TOKENS
      return (
        checkAgainstLimits(limits, {
          today: sums.today.costUsd,
          month: sums.month.costUsd,
          request:
            costOf({ ...NO_TOKENS, input: guess }, entry.pricing) + SEARCH_FEE_USD[entry.provider]
        }) === null
      )
    }
    const toolsContext = context.tools
    const replyTools =
      toolsContext === undefined
        ? null
        : toolsContext.runtime.forReply({
            owner,
            signal: controller.signal,
            settings: await toolsContext.settings(),
            provider: PROVIDER_NAMES[entry.provider],
            affordable: affordableSearch,
            search: countedSearch,
            onEvent: (event) => send({ streamId, type: 'tool', event }),
            ...(toolsContext.connectors === undefined
              ? {}
              : { connectors: await toolsContext.connectors().catch(() => undefined) })
          })
    let specs: ToolSpec[] = replyTools === null ? [] : replyTools.specs()
    /** The tool turns of this reply so far, after the conversation: what the model asked for, and what came of each call. */
    const turns: NeutralMessage[] = []

    const buildFor = (): ReturnType<typeof buildStreamRequest> =>
      buildStreamRequest({
        credentials: { apiKey, baseURL: baseUrlOverride(entry.provider) },
        model: entry,
        effort,
        instructions: request.instructions, // the person's own, already checked (D-027): added after the app's rules
        everyChat: everyChat.text, // before the chat's own (D-039)
        notes: memory.notes.map((note) => note.text), // first after the rules, as information (10.4)
        project: project?.instructions, // after every chat's, before the chat's own (10.6)
        messages: [...resolved.messages, ...turns],
        tools: specs,
        signal: controller.signal
      })
    let streamRequest = buildFor()
    // One guess at what this request sends, used three times and the same each time: for the question below (D-032), for the limit's check
    // (D-031) and for the ledger's first line (D-030). The files are part of it (D-037): images by their size, PDFs by their pages, text by its bytes;
    // and so are all the instructions, which are in the system prompt (D-039). With tools on, so are their definitions (11.3).
    const fileTokens = estimateFileTokens(resolved.files)
    const files =
      resolved.files.count > 0
        ? {
            count: resolved.files.count,
            tokens: fileTokens,
            ...(projectFiles.length > 0 ? { project: projectFiles.length } : {})
          }
        : undefined
    const inputTokensFor = (): number =>
      estimateInputTokens(streamRequest.system, streamRequest.messages) +
      fileTokens +
      (specs.length === 0
        ? 0
        : Math.ceil(JSON.stringify(specs).length / 4) + TOOL_PROMPT_GUESS_TOKENS)
    let inputTokens = inputTokensFor()
    // The spending limits (D-031), as they are now. They are asked for on EVERY request, whichever way it came (a new message, Regenerate,
    // an edited message): this is the only place a provider is called. A file that cannot be read at all refuses the request (null, after
    // the page has been told), and so does a limit that has not been chosen yet.
    const readLimits = async (): Promise<Limits | null> => {
      try {
        return await limitsStore.read()
      } catch (error) {
        // Logged here only; the message could name a file path.
        console.error('Reading the limits failed:', error instanceof Error ? error.message : error)
        send({
          streamId,
          type: 'error',
          message: 'Nothing was sent: the spending limits could not be read on this computer.'
        })
        return null
      }
    }
    // A very large request is asked about BEFORE anything is written or sent (D-032): what it could cost at the most is shown to the person,
    // and it goes only on their yes. Nothing is begun in the ledger while the question is open, so a request that is never answered never counts.
    // The answer comes from `confirmations`, which hears a yes only for a question that is waiting.
    const estimate = estimateRequest(
      inputTokens,
      streamRequest.maxOutputTokens,
      entry.pricing,
      files
    )
    const askFirst = await askFirstStore.read() // never throws: damage to the file is "nothing chosen", and the default asks
    const askAbove = askFirstAmount(askFirst)
    /**
     * The question itself, for the request that is about to go out: its figures, shown as they are, and the wait for the person's yes. False when the request must not
     * be sent: the limits refuse it anyway (the person was told why), the person said no, or the reply was stopped. `later` (12.7) marks a request in the middle of a
     * reply, after files were read: the page words the question for that.
     */
    const askLarge = async (asked: RequestEstimate, later: boolean): Promise<boolean> => {
      if (askAbove === null) return true
      const before = await readLimits()
      if (before === null) return false
      // A request the limits will refuse anyway is not asked about: the person is told why it cannot go. This look is only so that the question is not
      // wasted; the check that counts is the one inside `begin`, below, which runs again after the yes.
      let refusal: string | null = null
      try {
        const sums = await ledger.summary(null)
        refusal = withFilesNote(
          checkAgainstLimits(before, {
            today: sums.today.costUsd,
            month: sums.month.costUsd,
            request: costOf({ ...NO_TOKENS, input: asked.inputTokens }, entry.pricing)
          }),
          files
        )
      } catch {
        // The ledger could not be read: `begin` below fails the same way and says so. The question is asked meanwhile.
      }
      if (refusal !== null) {
        send({ streamId, type: 'error', message: refusal })
        return false
      }
      const answer = await confirmations.ask(key, controller.signal, () =>
        send({
          streamId,
          type: 'confirm',
          model: entry.id,
          estimate: asked,
          askAboveUsd: askAbove,
          ...(later ? { later: true } : {})
        })
      )
      // No yes: the person said no, or the window went away. Nothing was sent and nothing was written. (A yes and a Stop at the same moment: Stop wins.)
      return answer === 'send' && !controller.signal.aborted
    }
    // What the person has agreed to so far in this reply: the request they were asked about, or the first one when it was small enough not to ask (12.7).
    let approvedInputUsd = estimate.inputUsd
    if (needsConfirmation(askFirst, estimate) && !(await askLarge(estimate, false))) return

    /**
     * Counts the request that is about to go out: read the limits as they are NOW (after any wait), and write the ledger's first line BEFORE it is sent
     * (D-030), with the limit checked in the same turn (D-031): what has been spent and the line that adds this request to it cannot be parted by another.
     * False when the request must not be sent (the person was told why).
     */
    const beginRequest = async (): Promise<boolean> => {
      const limits = await readLimits()
      if (limits === null) return false
      try {
        began = await ledger.begin(
          {
            chat: request.conversationId ?? null,
            provider: entry.provider,
            model: entry.id,
            effort,
            prices: entry.pricing,
            inputTokens
          },
          (spend) => withFilesNote(checkAgainstLimits(limits, spend), files)
        )
      } catch (error) {
        if (error instanceof RequestRefused) {
          send({ streamId, type: 'error', message: error.message }) // a sentence for the person, naming the limit; nothing was written
          return false
        }
        // Logged here only; the message could name a file path.
        console.error(
          'Writing to the usage ledger failed:',
          error instanceof Error ? error.message : error
        )
        send({
          streamId,
          type: 'error',
          message:
            'Nothing was sent: what this request would use could not be recorded on this computer.'
        })
        return false
      }
      return true
    }

    // The reply: one request, or, when the model asks for a tool and the person allows it, a request, the tool, and a request again (11.3). A hard bound on
    // the passes stands behind the reply's own caps (steps and time), which every pass of the loop spends.
    let breakBeforeText = false
    for (let pass = 0; pass < 25; pass++) {
      // (12.7) A reply that reads files sends what it read with every request after it: when that has made the next request cost more than the amount more than the
      // one the person agreed to, they are asked again (the question was only for the first request before).
      if (pass > 0) {
        const next = estimateRequest(
          inputTokens,
          streamRequest.maxOutputTokens,
          entry.pricing,
          files
        )
        if (needsConfirmationAgain(askFirst, next, approvedInputUsd)) {
          if (!(await askLarge(next, true))) return
          approvedInputUsd = next.inputUsd
        }
      }
      if (!(await beginRequest())) return
      let end: ReplyEnd | null = null
      let usage: Usage | null = null
      let calls: NeutralToolCall[] = []
      let record: unknown = null
      let said = ''
      // The reply's working time is the time spent on tools (11.3): the clock stands still while the model writes.
      replyTools?.budget.pause()
      try {
        for await (const event of adapter.stream(streamRequest)) {
          if (event.type === 'text') {
            if (breakBeforeText) {
              breakBeforeText = false
              send({ streamId, type: 'text', text: '\n\n' }) // the model's words before a tool and after it are two paragraphs
            }
            arrivedBytes += Buffer.byteLength(event.text)
            said += event.text
            send({ streamId, type: 'text', text: event.text })
          } else {
            end = event.end
            usage = event.usage
            calls = event.calls ?? []
            record = event.record ?? null
          }
        }
      } finally {
        replyTools?.budget.resume()
      }
      // An adapter ends every reply that did not fail with an `end` event. Saying "done" without one would hide a bug.
      if (end === null) throw new Error('the provider ended the reply without saying how it ended')
      // The provider's report is counted even if the person pressed Stop at the last moment: the reply was made, and billed.
      await settle(controller.signal.aborted ? 'stopped' : 'done', usage)
      if (controller.signal.aborted) return
      // What the reply used, once, for the log (D-018, D-021). It is not stored with the message and never holds a key.
      if (usage) {
        console.log(
          `Reply from ${entry.provider}/${entry.id} used ${usage.inputTokens} input, ${usage.cacheReadTokens} cache-read, ${usage.cacheWriteTokens} cache-write and ${usage.outputTokens} output tokens.`
        )
      }
      // The model stopped to use a tool, and tools are on: decide each call, ask, run, and go on with what came of them.
      if (end.kind === 'tool-use' && replyTools !== null && specs.length > 0 && calls.length > 0) {
        turns.push({ role: 'assistant', content: said, toolTurn: { calls, record } })
        const turn = await replyTools.runTurn(calls)
        turns.push({
          role: 'user',
          content: turn.results.map((result) => result.text).join('\n\n'),
          toolResults: turn.results
        })
        if (controller.signal.aborted || turn.ended === 'stopped') return // the person pressed Stop everything: nobody is listening
        if (turn.ended !== null) {
          sendUsage()
          send({
            streamId,
            type: 'error',
            message: capMessage(turn.ended, replyTools.budget.caps, replyTools.budget.fileCaps)
          })
          return
        }
        breakBeforeText = said.trim() !== ''
        // Read again: the settings may have changed while the person decided, and the next request offers only what is on now.
        if (toolsContext !== undefined) replyTools.setSettings(await toolsContext.settings())
        specs = replyTools.specs()
        streamRequest = buildFor()
        inputTokens = inputTokensFor()
        began = null
        settledAs.record = null
        arrivedBytes = 0
        continue
      }
      sendUsage()
      // A model that asks for a tool when none was offered gets nothing, and its words so far are the reply.
      send(endEvent(streamId, end.kind === 'tool-use' ? { kind: 'done' } : end))
      return
    }
    throw new Error('the reply asked for tools more often than the app allows')
  } catch (error) {
    // Stopped by the person (or the page went away): not a failure, and nobody is listening. What it used is still counted.
    if (controller.signal.aborted) {
      await settle('stopped', null)
      return
    }
    const failure = adapter ? adapter.normalizeError(error, { modelId }) : unknownError(error)
    await settle(
      REFUSED_BEFORE_WORK.has(failure.kind) && arrivedBytes === 0 ? 'rejected' : 'failed',
      null
    )
    sendUsage()
    send({ streamId, type: 'error', message: describeFailure(failure, apiKey) })
  } finally {
    // Whatever happened, a request that was begun is ended in the ledger: a throw while sending an event, for instance, lands here.
    await settle('failed', null)
    running.delete(key)
  }
}

/** Registers the chat messages. Called from registerIpc, after the app is ready. */
export function registerChatIpc(appUrl: string, context: ReplyContext): void {
  ipcMain.on(CHANNELS.chatStart, (event, raw: unknown) => {
    if (!isTrustedSender(event, appUrl)) return // nobody to answer: it is not our page
    const sender = event.sender
    const send = (reply: ChatStreamEvent): void => {
      if (!sender.isDestroyed()) sender.send(CHANNELS.chatEvent, reply)
    }
    const check = checkChatRequest(raw)
    if (!check.ok) {
      if (check.streamId) send({ streamId: check.streamId, type: 'error', message: check.error })
      return
    }
    stopWhenPageGoes(sender)
    // The window the questions of a tool are for (11.3): the one this reply belongs to, never one the page named.
    void runReply(sender.id, BrowserWindow.fromWebContents(sender), check.request, send, context)
  })

  ipcMain.on(CHANNELS.chatCancel, (event, streamId: unknown) => {
    if (!isTrustedSender(event, appUrl) || typeof streamId !== 'string') return
    running.get(`${event.sender.id}:${streamId}`)?.abort()
  })

  // The person's yes to a large request that is waiting (D-032). Heard only from a window that is asking, for its own stream and only while the
  // question is waiting: a yes sent ahead of the question, twice, or for a stream that is not asking finds nobody and is dropped.
  ipcMain.on(CHANNELS.chatConfirm, (event, streamId: unknown) => {
    if (!isTrustedSender(event, appUrl) || typeof streamId !== 'string') return
    confirmations.send(`${event.sender.id}:${streamId}`)
  })
}
