import { promises as fs } from 'fs'
import { WORKSPACE_LIMITS } from '../shared/workspace'
import type { Executor } from './toolCore'
import type { ToolDefinition } from './toolRegistry'
import { makeCreate, makeEdit, PROPOSAL_LIMITS, type ProposalStore } from './proposals'
import { decodeText } from './workspaceText'

// The two tools that PROPOSE (Stage 12.4, D-042). A proposal changes nothing: it is a change held in memory (proposals.ts) for the person to look at in the Review
// window and apply or drop (12.5, 12.6). There is no tool that applies: the model cannot write a file, and cannot make the question that asks for a write
// appear. Both tools are asked about by the reply, like the read tools (the reply's one yes covers a proposal, which needs no question of its own: it is decided
// when the person applies it), and counted as file calls; a file that is hidden or looks like it holds secrets is still asked about on its own. No Electron
// imports.

const BODY = WORKSPACE_LIMITS.maxBodyChars

export const PROPOSE_EDIT: ToolDefinition = {
  id: 'propose_edit',
  title: 'Propose a change to a file in the workspace',
  noun: 'file access',
  describe:
    "Propose a change to one existing text file in the person's code workspace: the text in `find` must occur exactly once in the file, and is replaced by `replace`. " +
    'Nothing is changed: the person sees the whole difference in a window of the app and decides, and you cannot apply it. For several places, make several proposals. ' +
    'Read the file first and copy the text to find exactly (letters, spaces and line breaks count). Never put hidden or reversing characters in the new text.',
  effect:
    'This lets the model propose changes to files in your workspace. A proposal changes nothing until you apply it, in a window of the app, after you have seen the whole difference.',
  yes: 'Allow for this reply',
  ask: 'reply',
  counts: 'file',
  args: {
    path: {
      kind: 'workspace_path',
      op: 'edit',
      label: 'File',
      describe: 'The file to change, relative to the workspace.'
    },
    find: {
      kind: 'body',
      label: 'Text to find',
      describe: 'The text to replace. It must occur exactly once in the file.',
      max: Math.floor(BODY / 5)
    },
    replace: {
      kind: 'body',
      label: 'New text',
      describe: 'The text to put in its place.',
      max: Math.floor(BODY / 5)
    }
  }
}

export const PROPOSE_NEW_FILE: ToolDefinition = {
  id: 'propose_new_file',
  title: 'Propose a new file in the workspace',
  noun: 'file access',
  describe:
    "Propose a new text file in the person's code workspace (the file must not exist yet; folders on the way may be new). Nothing is created: the person sees the " +
    'whole file in a window of the app and decides, and you cannot apply it. Never put hidden or reversing characters in the text.',
  effect:
    'This lets the model propose new files in your workspace. A proposal creates nothing until you apply it, in a window of the app, after you have seen the whole file.',
  yes: 'Allow for this reply',
  ask: 'reply',
  counts: 'file',
  args: {
    path: {
      kind: 'workspace_path',
      op: 'create',
      label: 'File',
      describe: 'The new file, relative to the workspace.'
    },
    content: {
      kind: 'body',
      label: 'Text of the file',
      describe: 'The whole text of the new file.',
      max: BODY
    }
  }
}

/** The tools of the workspace that propose. */
export const WORKSPACE_PROPOSE_TOOLS: readonly ToolDefinition[] = [PROPOSE_EDIT, PROPOSE_NEW_FILE]

const fmt = (n: number): string => n.toLocaleString('en-US')

export interface ProposalExecutorOptions {
  store: ProposalStore
  now?: () => number
}

/** The executors for ONE reply: they count the proposals the reply makes. */
export function createProposalExecutors(options: ProposalExecutorOptions): {
  propose_edit: Executor
  propose_new_file: Executor
} {
  const now = options.now ?? Date.now
  let made = 0

  /** What the model is told when a proposal is made, or why it was not. Never anything of the file. */
  const told = (
    id: string,
    path: string,
    added: number,
    removed: number,
    created: boolean
  ): string =>
    `Proposal ${id} recorded: ${created ? 'a new file' : 'a change to'} "${path}" (${fmt(added)} ${added === 1 ? 'line' : 'lines'} added, ${fmt(removed)} removed). Nothing was changed on disk. ` +
    'The person will see the whole difference in a window of the app and decide. It is NOT applied yet: do not say that it is, and do not rely on it until the person has applied it (you can read the file again later to see).'
  const refusedText = (why: string): string => `No proposal was made: ${why}`
  const limit = (): string | null =>
    made >= PROPOSAL_LIMITS.perReply
      ? refusedText(
          `this reply has already made ${PROPOSAL_LIMITS.perReply} proposals, the most one reply may make.`
        )
      : null

  const propose_edit: Executor = async (args, ctx) => {
    const over = limit()
    if (over !== null) return { text: over }
    const verdict = await ctx.again('path')
    if (!verdict.ok || verdict.kind !== 'file') {
      return { text: refusedText('that file is not available just now.') }
    }
    if (verdict.size > WORKSPACE_LIMITS.maxFileBytes) {
      return {
        text: refusedText(`the file is larger than ${fmt(WORKSPACE_LIMITS.maxFileBytes)} bytes.`)
      }
    }
    const bytes = await fs.readFile(verdict.real)
    if (bytes.length > WORKSPACE_LIMITS.maxFileBytes) {
      return {
        text: refusedText(`the file is larger than ${fmt(WORKSPACE_LIMITS.maxFileBytes)} bytes.`)
      }
    }
    const decoded = decodeText(bytes)
    if (!decoded.ok)
      return { text: refusedText(`the file cannot be read as text: ${decoded.why}.`) }
    const made1 = makeEdit({
      bytes,
      decoded,
      rel: verdict.rel,
      real: verdict.real,
      find: String(args.find),
      replace: String(args.replace),
      why: ctx.why,
      secret: verdict.fileClass === 'one-by-one',
      now: now()
    })
    if (!made1.ok) return { text: refusedText(made1.why) }
    const kept = options.store.add(made1.proposal)
    if (!kept.ok) return { text: refusedText(kept.why) }
    made++
    return {
      text: told(
        kept.proposal.id,
        kept.proposal.path,
        kept.proposal.added,
        kept.proposal.removed,
        false
      )
    }
  }

  const propose_new_file: Executor = async (args, ctx) => {
    const over = limit()
    if (over !== null) return { text: over }
    const verdict = await ctx.again('path')
    if (!verdict.ok || verdict.kind !== 'missing') {
      return { text: refusedText('that path is not available for a new file just now.') }
    }
    const made1 = makeCreate({
      rel: verdict.rel,
      real: verdict.real,
      content: String(args.content),
      why: ctx.why,
      secret: verdict.fileClass === 'one-by-one',
      now: now()
    })
    if (!made1.ok) return { text: refusedText(made1.why) }
    const kept = options.store.add(made1.proposal)
    if (!kept.ok) return { text: refusedText(kept.why) }
    made++
    return {
      text: told(
        kept.proposal.id,
        kept.proposal.path,
        kept.proposal.added,
        kept.proposal.removed,
        true
      )
    }
  }

  return { propose_edit, propose_new_file }
}
