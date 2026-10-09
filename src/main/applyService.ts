import { randomBytes } from 'crypto'
import { constants, promises as fs } from 'fs'
import { dirname, join } from 'path'
import type { AppliedChange, ChangeActionResult } from '../shared/changes'
import type { ToolEvent } from '../shared/tools'
import type { Journal } from './journal'
import { bytesFor, sha256, type Proposal } from './proposals'
import {
  QUESTION_BUSY,
  QUESTION_FAILED,
  QUESTION_RESTING,
  type QuestionGate,
  type SystemQuestion
} from './systemQuestion'
import { ASKED_HERE, SHOWN_LIMIT, shown } from './toolQuestion'
import { foldJournal, UNDO_LIMITS, type UndoEntry } from './undoRecords'
import type { WorkspaceGuard } from './workspaceGuard'

// Applying a change, and undoing it (Stage 12.6, D-042): the ONLY place in the app that writes a file of the person's workspace. Nothing here runs unless the Review window
// asked for it after the whole difference was scrolled to its end (reviewService.ts), and then in this order, any step able to stop it and none able to be skipped:
//   the undo journal has room -> the question is RECORDED in the audit log -> the question, in the system's own box, naming the file, the counts, the fingerprint and
//   the warnings -> the answer is recorded -> only a yes goes on -> the file is looked at AGAIN (still the bytes the proposal saw, the path still allowed) -> the undo copy
//   is written to the journal and READ BACK from the disk (if that fails, nothing is written) -> the start is recorded -> the file is written (an edit: a temporary file in
//   the same folder, then put in place; a new file: made exclusively, so that nothing is overwritten) -> read back and compared byte for byte (a mismatch puts the original
//   back) -> the result is recorded.
// Undo is the same road backwards: the file must still be EXACTLY what the change wrote (by SHA-256; a file that was changed afterwards is never overwritten), the person
// is asked in the box, and the original is put back (or the new file removed). Every one of these is a line of the audit log, as a call of the tools "apply_change" and
// "undo_change". No Electron imports.

export const ROOM_FULL =
  'The undo journal is full, so no more changes can be applied. Delete the undo history on the Tools page (the files stay as they are), or undo changes you no longer need.'
export const NOT_WRITTEN = 'Nothing was written.'
const BUSY_APPLY = 'Another change is being applied or undone. Wait for it to finish.'
const NOT_RECORDED_TEXT = 'Nothing was done: the app could not keep its record of it.'
const NO_UNDO_COPY =
  'Nothing was written: the app could not keep the copy of the original that would let you undo it.'
const TOO_LONG = 'Nothing was done: the question would not fit in the box in full.'

/** A file that looks like this is not touched: its attribute says it cannot be written. */
const READ_ONLY = 'The file is read-only, so it was not changed.'

export interface ApplierOptions {
  guard: WorkspaceGuard
  journal: Journal<UndoEntry>
  gate: QuestionGate
  /** The audit record (auditLog.ts `append`); rejecting means nothing is asked or done. */
  record: (event: ToolEvent) => Promise<void>
  now?: () => number
  /** How a written file is read back to be compared with what was written (the checks hand in a disk that lies; the default reads the file). */
  readBack?: (path: string) => Promise<Buffer>
}

export interface Applier {
  apply(proposal: Proposal, owner: unknown): Promise<ChangeActionResult>
  /** The newest applied changes (at most 50), each with whether it can be undone now. */
  applied(): Promise<AppliedChange[]>
  undo(id: unknown, owner: unknown): Promise<ChangeActionResult>
  /** Deletes the undo journal after asking (the files stay as they are). */
  clearHistory(owner: unknown): Promise<ChangeActionResult>
}

const fmt = (n: number): string => n.toLocaleString('en-US')

/** The question before a change is written. */
export function applyQuestion(proposal: Proposal): SystemQuestion {
  const edit = proposal.kind === 'edit'
  const lines = [
    `${edit ? 'A change to this file' : 'A new file'}: ${shown(proposal.real)}`,
    edit
      ? `${fmt(proposal.added)} ${proposal.added === 1 ? 'line' : 'lines'} added, ${fmt(proposal.removed)} removed; the file will be ${fmt(proposal.bytes)} bytes.`
      : `${fmt(proposal.added)} ${proposal.added === 1 ? 'line' : 'lines'}; the file will be ${fmt(proposal.bytes)} bytes.`,
    `Fingerprint of the exact bytes that will be written: ${proposal.fingerprint} (the Review window showed the same).`
  ]
  if (proposal.flags.secret)
    lines.push('WARNING: this file is hidden or looks like it holds secrets.')
  if (proposal.flags.runsCommands) {
    lines.push(
      'WARNING: this file runs commands when it is used later (a script, package.json, a task file or a workflow).'
    )
  }
  lines.push(
    `The model's reason: ${shown(proposal.why)}`,
    '',
    edit
      ? 'Before anything is changed the app keeps a copy of the original in its own data folder (not in your folder), so that you can undo this.'
      : 'To undo it, the app can delete the new file again, if it is still exactly as written.',
    'Only this change is written, and only what you saw in the Review window.',
    '',
    ASKED_HERE
  )
  return {
    title: 'Code workspace',
    message: edit ? 'Write this change to your file?' : 'Create this new file?',
    detail: lines.join('\n'),
    yes: edit ? 'Write this change' : 'Create this file',
    no: "Don't write"
  }
}

function undoQuestion(
  entry: Extract<UndoEntry, { type: 'applied' }>,
  real: string
): SystemQuestion {
  const edit = entry.kind === 'edit'
  return {
    title: 'Code workspace',
    message: edit ? 'Put the original back?' : 'Delete the file this change made?',
    detail: [
      `${edit ? 'File' : 'New file'}: ${shown(real)}`,
      edit
        ? `The file goes back to the version the app kept before the change was applied. The file is still exactly as the change wrote it (fingerprint ${entry.fingerprint}), so nothing you wrote since is lost.`
        : `The file is still exactly as the change wrote it (fingerprint ${entry.fingerprint}), so it is deleted. (Folders that were made for it stay.)`,
      '',
      ASKED_HERE
    ].join('\n'),
    yes: edit ? 'Put the original back' : 'Delete the file',
    no: "Don't undo"
  }
}

function clearQuestion(count: number | null): SystemQuestion {
  return {
    title: 'Code workspace',
    message: 'Delete the undo history?',
    detail: [
      count === null || count === 0
        ? "This deletes the app's whole undo history (it holds no change that can be read). Your files are not touched, and nothing can be undone afterwards."
        : `This deletes the app's copies of the originals of ${fmt(count)} applied ${count === 1 ? 'change' : 'changes'}. Your files are not touched, and nothing can be undone afterwards.`,
      '',
      ASKED_HERE
    ].join('\n'),
    yes: 'Delete the history',
    no: "Don't delete"
  }
}

export function createApplier(options: ApplierOptions): Applier {
  const { guard, journal, gate, record } = options
  const now = options.now ?? Date.now
  const readBack = options.readBack ?? ((path: string): Promise<Buffer> => fs.readFile(path))
  let busy = false
  let counter = 0
  const newId = (prefix: string): string => {
    counter += 1
    return `${prefix}${now().toString(36)}-${counter.toString(36)}`
  }
  const keep = async (event: ToolEvent): Promise<boolean> => {
    try {
      await record(event)
      return true
    } catch {
      return false
    }
  }
  const oneAtATime = async (
    task: () => Promise<ChangeActionResult>
  ): Promise<ChangeActionResult> => {
    if (busy) return { ok: false, error: BUSY_APPLY }
    busy = true
    try {
      return await task()
    } finally {
      busy = false
    }
  }

  /** Writes bytes over an existing file: a temporary file in the same folder, put in place, then looked at; in place if the rename is refused. */
  async function replaceFile(real: string, bytes: Buffer): Promise<void> {
    const tmp = join(dirname(real), `.frontier-${randomBytes(6).toString('hex')}.tmp`)
    try {
      await fs.writeFile(tmp, bytes, { flag: 'wx' })
      if (!(await fs.readFile(tmp)).equals(bytes))
        throw new Error('the temporary file did not read back')
      try {
        await fs.rename(tmp, real)
      } catch {
        await fs.writeFile(real, bytes)
        await fs.rm(tmp, { force: true })
      }
    } catch (error) {
      await fs.rm(tmp, { force: true }).catch(() => undefined)
      throw error
    }
  }

  const answerText = (answer: string): string => {
    if (answer === 'busy') return QUESTION_BUSY
    if (answer === 'resting') return QUESTION_RESTING
    if (answer === 'failed') return QUESTION_FAILED
    return NOT_WRITTEN
  }

  /** One question with its record before and after: the same rule as every question of the tools. Null for a yes, or the answer to give back. */
  async function ask(
    owner: unknown,
    question: SystemQuestion,
    call: string,
    tool: string,
    args: Record<string, string | number>,
    why: string
  ): Promise<ChangeActionResult | null> {
    if (question.detail.length > SHOWN_LIMIT) return { ok: false, error: TOO_LONG }
    if (!(await keep({ type: 'asked', at: now(), call, tool, step: 1, args, why }))) {
      return { ok: false, error: NOT_RECORDED_TEXT }
    }
    const answer = await gate.ask(owner, question)
    const recorded = await keep({ type: 'answered', at: now(), call, tool, step: 1, answer })
    if (answer !== 'yes') return { ok: false, error: answerText(answer) }
    if (!recorded) return { ok: false, error: NOT_RECORDED_TEXT }
    return null
  }

  async function roomForOne(): Promise<boolean> {
    const size = await journal.size()
    if (size >= UNDO_LIMITS.maxBytes) return false
    const all = await journal.readAll()
    if (all.state === 'too-big') return false
    return foldJournal(all.entries).length < UNDO_LIMITS.maxChanges
  }

  async function apply(proposal: Proposal, owner: unknown): Promise<ChangeActionResult> {
    const edit = proposal.kind === 'edit'
    const newBytes = bytesFor(proposal.after, proposal.bom)
    if (sha256(newBytes).slice(0, 12) !== proposal.fingerprint) {
      return {
        ok: false,
        error: 'The change does not match its fingerprint, so it is not written.'
      }
    }
    let room = false
    try {
      room = await roomForOne()
    } catch {
      room = false
    }
    if (!room) return { ok: false, error: ROOM_FULL }
    const call = newId('apply-')
    const args = { change: proposal.id, path: proposal.path, fingerprint: proposal.fingerprint }
    const no = await ask(owner, applyQuestion(proposal), call, 'apply_change', args, proposal.why)
    if (no !== null) return no

    // The yes is given: the file is looked at AGAIN, because it could have changed while the person decided.
    const verdict = await guard.check({ path: proposal.path, op: edit ? 'edit' : 'create' })
    if (!verdict.ok || (edit && verdict.kind !== 'file') || (!edit && verdict.kind !== 'missing')) {
      await finish(call, false, 0)
      return {
        ok: false,
        error:
          'The file changed while you were deciding (or its path is not available any more). Nothing was written.'
      }
    }
    let original: Buffer | null = null
    if (edit) {
      try {
        original = await fs.readFile(verdict.real)
        await fs.access(verdict.real, constants.W_OK)
      } catch (error) {
        await finish(call, false, 0)
        return {
          ok: false,
          error:
            (error as NodeJS.ErrnoException).code === 'EACCES' ||
            (error as NodeJS.ErrnoException).code === 'EPERM'
              ? READ_ONLY
              : 'The file could not be read, so it was not changed.'
        }
      }
      if (proposal.baseHash === null || sha256(original) !== proposal.baseHash) {
        await finish(call, false, 0)
        return {
          ok: false,
          error:
            'The file is not what it was when this change was proposed (it was changed while you were deciding). Nothing was written.'
        }
      }
    }
    const afterHash = sha256(newBytes)
    const id = newId('u')
    // The undo copy first, and proved: if it cannot be kept, the file is not touched.
    try {
      await journal.append({
        type: 'applied',
        id,
        at: now(),
        kind: proposal.kind,
        path: proposal.path,
        before: original === null ? null : original.toString('base64'),
        beforeHash: original === null ? null : sha256(original),
        afterHash,
        afterBytes: newBytes.length,
        fingerprint: proposal.fingerprint
      })
    } catch (error) {
      console.error('Keeping the undo copy failed:', error instanceof Error ? error.message : error)
      await finish(call, false, 0)
      return { ok: false, error: NO_UNDO_COPY }
    }
    if (!(await keep({ type: 'ran', at: now(), call, tool: 'apply_change', step: 1 }))) {
      await neutralise(id)
      return { ok: false, error: NOT_RECORDED_TEXT }
    }
    try {
      if (edit) {
        await replaceFile(verdict.real, newBytes)
      } else {
        await fs.mkdir(dirname(verdict.real), { recursive: true })
        await fs.writeFile(verdict.real, newBytes, { flag: 'wx' })
      }
      if (!(await readBack(verdict.real)).equals(newBytes))
        throw new Error('the file did not read back as written')
    } catch (error) {
      console.error('Writing the change failed:', error instanceof Error ? error.message : error)
      // Put things back as they were: the original over an edit, nothing where a new file was.
      try {
        if (original !== null) await replaceFile(verdict.real, original)
        else await fs.rm(verdict.real, { force: true })
      } catch {
        /* the journal still holds the original */
      }
      await neutralise(id)
      await finish(call, false, 0)
      return {
        ok: false,
        error: 'The change could not be written, and the file was put back as it was.'
      }
    }
    await finish(call, true, newBytes.length)
    return {
      ok: true,
      message: edit
        ? 'Done. The change was written. The original is kept: you can undo it on the Tools page.'
        : 'Done. The new file was made. You can undo it on the Tools page.'
    }

    async function finish(callId: string, ok: boolean, size: number): Promise<void> {
      await keep({
        type: 'result',
        at: now(),
        call: callId,
        tool: 'apply_change',
        step: 1,
        ok,
        size,
        sources: [],
        searched: null,
        searches: 0
      })
    }
  }

  /** An entry whose write did not happen is closed as undone, so that it is never offered for undo. */
  async function neutralise(id: string): Promise<void> {
    try {
      await journal.append({ type: 'undone', id, at: now() })
    } catch {
      /* the file no longer matches its entry, which makes the entry "changed" and not undoable */
    }
  }

  async function appliedNow(): Promise<AppliedChange[]> {
    const all = await journal.readAll()
    if (all.state === 'too-big') return []
    const records = foldJournal(all.entries).reverse().slice(0, 50)
    const out: AppliedChange[] = []
    for (const { entry, undone } of records) {
      let state: AppliedChange['state'] = undone ? 'undone' : 'undoable'
      if (!undone) {
        const verdict = await guard
          .check({ path: entry.path, op: entry.kind === 'edit' ? 'edit' : 'read' })
          .catch(() => null)
        if (verdict === null || !verdict.ok) {
          state =
            verdict !== null && !verdict.ok && verdict.code === 'not-found' ? 'gone' : 'unavailable'
        } else {
          try {
            state =
              sha256(await fs.readFile(verdict.real)) === entry.afterHash ? 'undoable' : 'changed'
          } catch {
            state = 'unavailable'
          }
        }
      }
      out.push({
        id: entry.id,
        at: entry.at,
        kind: entry.kind,
        path: entry.path,
        bytes: entry.afterBytes,
        fingerprint: entry.fingerprint,
        state
      })
    }
    return out
  }

  async function undo(id: unknown, owner: unknown): Promise<ChangeActionResult> {
    if (typeof id !== 'string')
      return { ok: false, error: 'That change is not in the undo history.' }
    const all = await journal.readAll()
    if (all.state === 'too-big') return { ok: false, error: 'The undo history cannot be read.' }
    const record1 = foldJournal(all.entries).find((r) => r.entry.id === id)
    if (record1 === undefined)
      return { ok: false, error: 'That change is not in the undo history.' }
    if (record1.undone) return { ok: false, error: 'That change was already undone.' }
    const { entry } = record1
    const edit = entry.kind === 'edit'
    const look = async (): Promise<{ real: string } | { error: string }> => {
      const verdict = await guard.check({ path: entry.path, op: edit ? 'edit' : 'read' })
      if (!verdict.ok || verdict.kind !== 'file')
        return { error: 'The file is not there or not available any more, so nothing was undone.' }
      let bytes: Buffer
      try {
        bytes = await fs.readFile(verdict.real)
      } catch {
        return { error: 'The file could not be read, so nothing was undone.' }
      }
      if (sha256(bytes) !== entry.afterHash) {
        return {
          error:
            'The file was changed after this change was applied. Undoing it would lose what was written since, so nothing was undone.'
        }
      }
      return { real: verdict.real }
    }
    const first = await look()
    if ('error' in first) return { ok: false, error: first.error }
    return oneAtATime(async () => {
      const call = newId('undo-')
      const args = { change: entry.id, path: entry.path, fingerprint: entry.fingerprint }
      const no = await ask(
        owner,
        undoQuestion(entry, first.real),
        call,
        'undo_change',
        args,
        'You asked to undo it.'
      )
      if (no !== null) return no
      const again = await look()
      if ('error' in again) {
        await keep({
          type: 'result',
          at: now(),
          call,
          tool: 'undo_change',
          step: 1,
          ok: false,
          size: 0,
          sources: [],
          searched: null,
          searches: 0
        })
        return { ok: false, error: again.error }
      }
      if (!(await keep({ type: 'ran', at: now(), call, tool: 'undo_change', step: 1 })))
        return { ok: false, error: NOT_RECORDED_TEXT }
      try {
        if (edit) {
          const original = Buffer.from(entry.before ?? '', 'base64')
          await replaceFile(again.real, original)
          if (!(await readBack(again.real)).equals(original))
            throw new Error('the original did not read back')
        } else {
          await fs.rm(again.real, { force: true })
        }
        await journal.append({ type: 'undone', id: entry.id, at: now() })
      } catch (error) {
        console.error('Undoing the change failed:', error instanceof Error ? error.message : error)
        await keep({
          type: 'result',
          at: now(),
          call,
          tool: 'undo_change',
          step: 1,
          ok: false,
          size: 0,
          sources: [],
          searched: null,
          searches: 0
        })
        return { ok: false, error: 'The change could not be undone.' }
      }
      await keep({
        type: 'result',
        at: now(),
        call,
        tool: 'undo_change',
        step: 1,
        ok: true,
        size: edit ? (entry.before ?? '').length : 0,
        sources: [],
        searched: null,
        searches: 0
      })
      return { ok: true, message: edit ? 'The original is back.' : 'The new file was deleted.' }
    })
  }

  async function clearHistory(owner: unknown): Promise<ChangeActionResult> {
    const all = await journal.readAll()
    if (
      all.state === 'none' ||
      (all.state === 'ok' && all.entries.length === 0 && all.skipped === 0)
    )
      return { ok: true, message: 'There was nothing to delete.' }
    const count = all.state === 'ok' ? foldJournal(all.entries).length : null
    return oneAtATime(async () => {
      const call = newId('clear-')
      const no = await ask(
        owner,
        clearQuestion(count),
        call,
        'undo_clear',
        { changes: count ?? 0 },
        'You asked to delete the undo history.'
      )
      if (no !== null) return no
      try {
        await journal.removeAll()
      } catch {
        await keep({
          type: 'result',
          at: now(),
          call,
          tool: 'undo_clear',
          step: 1,
          ok: false,
          size: 0,
          sources: [],
          searched: null,
          searches: 0
        })
        return { ok: false, error: 'The undo history could not be deleted.' }
      }
      await keep({
        type: 'result',
        at: now(),
        call,
        tool: 'undo_clear',
        step: 1,
        ok: true,
        size: count ?? 0,
        sources: [],
        searched: null,
        searches: 0
      })
      return { ok: true, message: 'The undo history was deleted.' }
    })
  }

  return {
    apply: (proposal, owner) => oneAtATime(() => apply(proposal, owner)),
    applied: appliedNow,
    undo,
    clearHistory
  }
}
