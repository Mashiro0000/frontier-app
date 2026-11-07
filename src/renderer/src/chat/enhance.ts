import { pickAuto } from '../../../shared/autoPick'
import type { SettingsStatus } from '../../../shared/ipc'
import type { ReplyUsage } from '../../../shared/usage'
import { ipcReply } from './ipcReply'
import type { ChatMessage, LargeRequest } from './types'

// (21.4, D-053) Enhance, as AI Fiesta's "Enhance prompt": the message the person is writing is rewritten by the cheapest model they have a key for (the
// owner's answer), and put back in the box for them to read, change or undo. It is NEVER sent by itself. The rewrite is a request like any other (main
// counts it in the ledger, applies the limits and asks before a large one), but it carries nothing else: no tools, no project, no notes, no instructions,
// no chat (main sees the purpose and leaves them out).

/** What the model is asked: the person's text is quoted after it, and the answer must be the rewritten text alone. */
export const ENHANCE_ASK =
  'Rewrite the message below so that an AI assistant understands it better: clearer and more specific, in the same language, ' +
  'with the same meaning and intent. Do not answer it, and do not add facts or requests it does not make. ' +
  'Reply with the rewritten message only, without quotation marks or any comment.\n\nMessage:\n'

/** The most the text to enhance may be: a long text is not what this is for, and the rewrite would be as long. */
export const ENHANCE_MAX_CHARS = 4000

export type EnhanceResult =
  { ok: true; text: string; model: string; usage: ReplyUsage | null } | { ok: false; error: string }

/** The model Enhance uses: the cheapest one with a key (Auto's rule for a quick answer), or why there is none. */
export function enhanceModel(
  status: SettingsStatus
): { ok: true; modelId: string } | { ok: false; error: string } {
  const pick = pickAuto({
    models: status.models,
    providers: status.providers,
    suggestions: [],
    task: 'quick',
    pictures: false,
    pdfs: false
  })
  return pick.ok
    ? { ok: true, modelId: pick.modelId }
    : { ok: false, error: pick.reason.replace('Auto has', 'Enhance has') }
}

/** The rewrite as the model wrote it, made fit for the box: trimmed, and a pair of quotation marks around it all taken off. */
export function cleanRewrite(text: string): string {
  const trimmed = text.trim()
  const quoted = /^(["'“‘])([\s\S]*)(["'”’])$/.exec(trimmed)
  return (quoted ? quoted[2] : trimmed).trim()
}

/** Asks for the rewrite. `onLargeRequest` is the chat's own question before a large request; `signal` stops it (nothing is put in the box then). */
export async function enhance(
  text: string,
  status: SettingsStatus,
  signal: AbortSignal,
  onLargeRequest: (request: LargeRequest) => Promise<boolean>
): Promise<EnhanceResult> {
  const draft = text.trim()
  if (draft === '')
    return { ok: false, error: 'Write something first: Enhance rewrites your message.' }
  if (draft.length > ENHANCE_MAX_CHARS) {
    return {
      ok: false,
      error: `Enhance is for messages of up to ${ENHANCE_MAX_CHARS.toLocaleString('en-US')} characters.`
    }
  }
  const model = enhanceModel(status)
  if (!model.ok) return model
  const ask: ChatMessage = {
    id: crypto.randomUUID(),
    role: 'user',
    content: ENHANCE_ASK + draft,
    status: 'done'
  }
  let written = ''
  let usage: ReplyUsage | null = null
  try {
    for await (const piece of ipcReply(
      [ask],
      signal,
      () => {},
      '',
      null,
      (u) => {
        usage = u
      },
      onLargeRequest,
      null,
      () => {},
      { modelId: model.modelId, purpose: 'enhance' }
    )) {
      written += piece
    }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) }
  }
  if (signal.aborted) return { ok: false, error: 'Stopped.' }
  const rewritten = cleanRewrite(written)
  if (rewritten === '')
    return { ok: false, error: 'The model wrote nothing back; your message is as it was.' }
  return { ok: true, text: rewritten, model: model.modelId, usage }
}
