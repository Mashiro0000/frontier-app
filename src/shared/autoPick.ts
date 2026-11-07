import { costTier } from './costTier'
import type { ModelOption, ProviderStatus } from './ipc'
import type { Suggestion, TaskId } from './rankings'

// (21.3, D-053) Auto: the model is picked for each message BY RULES, with no extra call (the owner's answer: no model is asked to choose, so a message is never
// sent one more time to pick its model). The rules use only what the app already knows: which makers have a key, the task the person said (the Task menu),
// the shortlist the makers' own pages give for it (D-023), the prices, and whether the message carries pictures or PDFs. Plain functions, checked under Node.

export interface AutoInput {
  models: readonly ModelOption[]
  providers: readonly ProviderStatus[]
  /** The shortlist for the makers with a key (SettingsStatus.suggestions). */
  suggestions: readonly Suggestion[]
  task: TaskId | null
  /** The message (or the chat) carries pictures / PDFs: only a model that reads them may answer. */
  pictures: boolean
  pdfs: boolean
}

export type AutoPick = { ok: true; modelId: string; reason: string } | { ok: false; reason: string }

const byPrice = (a: ModelOption, b: ModelOption): number =>
  a.pricing.outputPerMTok - b.pricing.outputPerMTok ||
  a.pricing.inputPerMTok - b.pricing.inputPerMTok

/**
 * The model Auto picks, and the reason in words (shown above the reply). In order:
 *  1. only models whose maker has a key, and that read the pictures and PDFs the message carries;
 *  2. "Quick answer": the cheapest of them;
 *  3. a task the makers name models for: the cheapest of the models named for it;
 *  4. otherwise (no task, or none named): the cheapest mid-priced all-rounder ($$$), or else the cheapest of them all.
 */
export function pickAuto(input: AutoInput): AutoPick {
  const keyed = new Set(input.providers.filter((p) => p.hasKey).map((p) => p.id))
  const able = input.models
    .filter((m) => keyed.has(m.provider))
    .filter((m) => (!input.pictures || m.imageInput) && (!input.pdfs || m.documentInput))
    .slice()
    .sort(byPrice)
  if (able.length === 0) {
    return {
      ok: false,
      reason:
        keyed.size === 0
          ? 'Auto has no model to pick: add an API key in Settings.'
          : 'Auto has no model to pick: none of the models you have a key for reads what this message carries.'
    }
  }
  if (input.task === 'quick') {
    return {
      ok: true,
      modelId: able[0].id,
      reason: 'the cheapest model you have a key for, for a quick answer'
    }
  }
  if (input.task !== null) {
    const named = new Set(
      input.suggestions.filter((s) => s.task === input.task).map((s) => s.modelId)
    )
    const pick = able.find((m) => named.has(m.id))
    if (pick !== undefined) {
      return {
        ok: true,
        modelId: pick.id,
        reason: `the lowest-priced model its maker names for ${taskWords(input.task)}`
      }
    }
  }
  const allRounder = able.find((m) => costTier(m.pricing) === 3)
  if (allRounder !== undefined) {
    return { ok: true, modelId: allRounder.id, reason: 'a balanced all-rounder at a middle price' }
  }
  return { ok: true, modelId: able[0].id, reason: 'the cheapest model you have a key for' }
}

function taskWords(task: TaskId): string {
  switch (task) {
    case 'coding':
      return 'coding'
    case 'writing':
      return 'writing'
    case 'chat':
      return 'chat'
    case 'quick':
      return 'quick answers'
  }
}
