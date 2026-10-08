import { promises as fs } from 'fs'
import type { ChangeActionResult, ChangeState, ChangeSummary, ReviewModel } from '../shared/changes'
import { sha256, type Proposal, type ProposalStore } from './proposals'
import { reviewModelOf, summaryOf } from './reviewModel'
import type { WorkspaceGuard } from './workspaceGuard'

// What can be done with the changes the model has proposed (Stage 12.5, D-042): see the waiting ones (a summary, for the chat page), see one whole (the model for the
// Review window), drop one, and ask for one to be applied. The rules are these. Dropping does less than applying: it asks nothing. APPLYING needs three things
// before the system's box is even shown: the person has scrolled the whole difference to its end in the Review window (main is told by that window, which
// the chat page cannot script), the file is still what the proposal saw (so that nothing the person wrote meanwhile is overwritten), and the path is still one the
// guard lets through. The apply itself, its box and the undo copy are 12.6 and are handed in as `requestApply`. No Electron imports.

export const SCROLL_FIRST = 'Scroll the whole difference to its end before you apply it.'
export const NOT_THERE = 'That change is not there any more.'
const WHY_NOT: Readonly<Record<Exclude<ChangeState, 'ok'>, string>> = {
  changed:
    'The file is not what it was when this change was proposed (it was changed since), so the change is not applied. Ask the model to propose it again.',
  gone: 'The file is not there any more, so the change is not applied.',
  exists: 'A file with that name is there now, so the new file is not made.',
  unavailable: 'The path of this change is not available any more, so the change is not applied.'
}

export interface ChangesService {
  /** The waiting changes, newest first, as the chat page may see them. */
  list(): ChangeSummary[]
  /** One change whole, for the Review window, with the state of the file now; null when it is not there. */
  model(id: unknown): Promise<ReviewModel | null>
  /** The Review window says the whole difference was scrolled to its end. */
  markReachedEnd(id: unknown): boolean
  /** Drops a change (no question: doing less than applying). */
  drop(id: unknown): boolean
  /** Asks for a change to be applied, after the checks above; `owner` is the window the question is for. */
  apply(id: unknown, owner: unknown): Promise<ChangeActionResult>
}

export interface ChangesServiceOptions {
  store: ProposalStore
  /** Whether the file is still what the proposal saw. */
  state: (proposal: Proposal) => Promise<ChangeState>
  /** 12.6: the system's box, the undo copy and the write. */
  requestApply: (proposal: Proposal, owner: unknown) => Promise<ChangeActionResult>
}

export function createChangesService(options: ChangesServiceOptions): ChangesService {
  const { store } = options
  /** Which changes have had their difference scrolled to its end: by id and fingerprint, so that a change that is not the same bytes never inherits it. */
  const reached = new Set<string>()
  const key = (proposal: Proposal): string => `${proposal.id}:${proposal.fingerprint}`
  const stateOf = async (proposal: Proposal): Promise<ChangeState> => {
    try {
      return await options.state(proposal)
    } catch {
      return 'unavailable'
    }
  }

  return {
    list: () => store.list().map(summaryOf),

    model: async (id) => {
      const proposal = store.get(id)
      if (proposal === undefined) return null
      return reviewModelOf(proposal, await stateOf(proposal), reached.has(key(proposal)))
    },

    markReachedEnd: (id) => {
      const proposal = store.get(id)
      if (proposal === undefined) return false
      reached.add(key(proposal))
      return true
    },

    drop: (id) => {
      const proposal = store.get(id)
      if (proposal === undefined) return false
      reached.delete(key(proposal))
      return store.remove(id)
    },

    apply: async (id, owner) => {
      const proposal = store.get(id)
      if (proposal === undefined) return { ok: false, error: NOT_THERE }
      if (!reached.has(key(proposal))) return { ok: false, error: SCROLL_FIRST }
      const state = await stateOf(proposal)
      if (state !== 'ok') return { ok: false, error: WHY_NOT[state] }
      try {
        return await options.requestApply(proposal, owner)
      } catch {
        return { ok: false, error: 'The change could not be applied.' }
      }
    }
  }
}

/**
 * Whether the file is still what the proposal saw: for an edit, the same bytes (by SHA-256); for a new file, still not there. The path is judged again by the workspace
 * guard, which refuses it if it is a link now, outside, or the folder has changed. Read-only.
 */
export function fileStateOf(guard: WorkspaceGuard): (proposal: Proposal) => Promise<ChangeState> {
  return async (proposal) => {
    const verdict = await guard.check({
      path: proposal.path,
      op: proposal.kind === 'edit' ? 'edit' : 'create'
    })
    if (!verdict.ok) {
      if (verdict.code === 'not-found') return proposal.kind === 'edit' ? 'gone' : 'unavailable'
      if (verdict.code === 'exists') return 'exists'
      return 'unavailable'
    }
    if (proposal.kind === 'create') return 'ok'
    if (verdict.kind !== 'file') return 'gone'
    const bytes = await fs.readFile(verdict.real)
    return proposal.baseHash !== null && sha256(bytes) === proposal.baseHash ? 'ok' : 'changed'
  }
}
