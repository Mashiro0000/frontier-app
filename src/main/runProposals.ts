import { promises as fs } from 'fs'
import { WORKSPACE_LIMITS } from '../shared/workspace'
import { makeCreate, makeReplace, PROPOSAL_LIMITS, sha256, type ProposalStore } from './proposals'
import type { Comparison } from './scratchCopy'
import type { WorkspaceGuard } from './workspaceGuard'
import { decodeText } from './workspaceText'

// What a run brings back (Stage 13.5, D-043): the text files the program changed or made in its COPY become Stage 12 proposals, which change nothing until the person
// applies them in the Review window (12.5, 12.6). Nothing here writes: a proposal is a change held in memory. Each candidate of the comparison (scratchCopy.ts) goes
// back past the workspace guard as a path of the REAL workspace, and a changed file must still be, byte for byte, the file that was copied (a file the person or
// something else has changed since is not overwritten by a stale proposal; the apply looks again as well). A reply makes at most PROPOSAL_LIMITS.perReply proposals in
// all, whether the model proposes them or a run brings them back, and the store holds at most PROPOSAL_LIMITS.waiting. No Electron imports.

export interface BringBackOptions {
  guard: WorkspaceGuard
  store: ProposalStore
  /** This reply's proposals so far, shared with the tools that propose, so that one reply never makes more than the limit in all. */
  counter: { made: number }
  now?: () => number
}

export interface NotMade {
  /** The path below the workspace, as the model and the person know it. */
  path: string
  /** A fixed sentence: never a path, never any of the file. */
  why: string
}

export interface BroughtBack {
  made: number
  notMade: NotMade[]
}

export const WHY_STALE = 'the file in the workspace is no longer the one that was copied'
export const WHY_NOT_THERE = 'the file is not available in the workspace now'
export const WHY_EXISTS = 'a file by that name is in the workspace now'
export const WHY_BIG = 'the file would be bigger than a file may be here'
export const WHY_NOT_TEXT = 'the file in the workspace cannot be read as text'
export const WHY_REFUSED = 'it could not be made into a proposal'
export const WHY_REPLY_FULL = 'this reply has made all the proposals it may'
export const WHY_STORE_FULL = 'there are already as many proposals waiting as there may be'

/** The reason a proposal carries when a run made it: the model's own reason for the run, after a few words that say where the change came from. */
const reasonFor = (why: string): string => `Made by a program that was run: ${why}`.slice(0, 300)

export function createBringBack(
  options: BringBackOptions
): (comparison: Comparison, call: { why: string }) => Promise<BroughtBack> {
  const now = options.now ?? Date.now
  return async (comparison, call) => {
    const result: BroughtBack = { made: 0, notMade: [] }
    for (const candidate of comparison.candidates) {
      const skip = (why: string): void => {
        result.notMade.push({ path: candidate.path, why })
      }
      if (options.counter.made >= PROPOSAL_LIMITS.perReply) {
        skip(WHY_REPLY_FULL)
        continue
      }
      const changed = candidate.kind === 'changed'
      const verdict = await options.guard.check({
        path: candidate.path,
        op: changed ? 'edit' : 'create'
      })
      if (!verdict.ok) {
        // a new file whose name is taken now is said so; every other refusal (a link, the data folder, outside the workspace, a file that is gone) is "not available"
        skip(verdict.code === 'exists' ? WHY_EXISTS : WHY_NOT_THERE)
        continue
      }
      const secret = verdict.fileClass === 'one-by-one'
      let made
      if (changed) {
        if (verdict.kind !== 'file') {
          skip(WHY_NOT_THERE)
          continue
        }
        if (verdict.size > WORKSPACE_LIMITS.maxFileBytes) {
          skip(WHY_BIG)
          continue
        }
        const bytes = await fs.readFile(verdict.real)
        if (sha256(bytes) !== candidate.baseSha256) {
          skip(WHY_STALE)
          continue
        }
        const decoded = decodeText(bytes)
        if (!decoded.ok) {
          skip(WHY_NOT_TEXT)
          continue
        }
        made = makeReplace({
          bytes,
          decoded,
          rel: verdict.rel,
          real: verdict.real,
          after: candidate.text,
          bom: candidate.bom,
          why: reasonFor(call.why),
          secret,
          now: now()
        })
      } else {
        if (verdict.kind !== 'missing') {
          skip(WHY_EXISTS)
          continue
        }
        made = makeCreate({
          rel: verdict.rel,
          real: verdict.real,
          content: candidate.text,
          why: reasonFor(call.why),
          secret,
          now: now()
        })
      }
      if (!made.ok) {
        skip(WHY_REFUSED)
        continue
      }
      const kept = options.store.add(made.proposal)
      if (!kept.ok) {
        skip(WHY_STORE_FULL)
        continue
      }
      options.counter.made++
      result.made++
    }
    return result
  }
}
