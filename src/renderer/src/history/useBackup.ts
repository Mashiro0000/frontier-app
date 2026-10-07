import { useCallback, useEffect, useRef, useState } from 'react'
import type {
  BackupRequest,
  HistoryExportResult,
  HistoryRestoreApplyResult,
  RestorePreview
} from '../../../shared/ipc'

const NO_BRIDGE = 'the window could not connect to the app (the preload did not load)'
const NO_ANSWER = 'the app did not answer'

const chats = (count: number): string => `${count} ${count === 1 ? 'chat' : 'chats'}`
export const attached = (count: number): string =>
  `${count} attached ${count === 1 ? 'file' : 'files'}`
export const projectsWord = (count: number): string =>
  `${count} ${count === 1 ? 'project' : 'projects'}`
export const notesWord = (count: number): string => `${count} ${count === 1 ? 'note' : 'notes'}`
/** "2 projects and 5 notes", leaving out a part that is none (10.7). */
export const keptWords = (projects: number, notes: number): string =>
  [
    ...(projects > 0 ? [projectsWord(projects)] : []),
    ...(notes > 0 ? [notesWord(notes)] : [])
  ].join(' and ')

/** What the person is told after a backup (D-034). */
export function describeExport(result: Extract<HistoryExportResult, { ok: true }>): string {
  const left =
    result.leftOut === 0
      ? ''
      : ` ${result.leftOut === 1 ? '1 saved file' : `${result.leftOut} saved files`} could not be read and ${result.leftOut === 1 ? 'is' : 'are'} not in it.`
  // The attached files it holds (D-037), said only for a backup that has any.
  let files = ''
  if (result.files !== undefined) {
    const { count, leftOut } = result.files
    const lost = `${attached(leftOut)} could not be read and ${leftOut === 1 ? 'is' : 'are'} not in it`
    files =
      count > 0
        ? ` It holds their ${attached(count)} too${leftOut > 0 ? `; ${lost}` : ''}.`
        : leftOut > 0
          ? ` ${lost}.`
          : ''
  }
  // The projects and the notes (10.7, D-039), said only for a backup that has them or should have had them.
  const kept =
    result.kept !== undefined && result.kept.projects + result.kept.notes > 0
      ? ` It holds your ${keptWords(result.kept.projects, result.kept.notes)} too.`
      : ''
  const keptLeft = result.keptLeftOut !== undefined ? ` ${result.keptLeftOut}` : ''
  return `Backed up ${chats(result.count)} to ${result.where}. The file was read back and every chat matched.${left}${files}${kept}${keptLeft}`
}

/** What the person is told after chats were added from a backup. */
export function describeRestore(result: Extract<HistoryRestoreApplyResult, { ok: true }>): string {
  const parts: string[] = []
  // The projects and notes first (10.7, D-039): they were added (or not) before the chats.
  const k = result.kept
  if (k !== undefined) {
    if (k.projects + k.notes > 0) parts.push(`Added ${keptWords(k.projects, k.notes)}.`)
    if (k.declined) parts.push('No project or note was added: you did not say yes in the question.')
    if (k.problem !== null) parts.push(k.problem)
    if (k.same > 0)
      parts.push(
        `${k.same === 1 ? '1 project or note' : `${k.same} projects and notes`} already here.`
      )
    if (k.notAdded > 0 && !k.declined && k.problem === null) {
      parts.push(
        `${k.notAdded === 1 ? '1 project or note was' : `${k.notAdded} projects and notes were`} not added (no room, a saved API key inside, or not usable).`
      )
    }
  }
  // A restore that only put files back (its chats were here already) does not say "Added 0 chats".
  if (result.added + result.copies > 0 || (result.files === undefined && k === undefined)) {
    parts.push(
      `Added ${chats(result.added + result.copies)}${result.copies > 0 ? ` (${result.copies === 1 ? '1 as a copy' : `${result.copies} as copies`})` : ''}.`
    )
  }
  if (result.same > 0)
    parts.push(
      `${chats(result.same)} already here, left as ${result.same === 1 ? 'it is' : 'they are'}.`
    )
  const notAdded = result.refused + result.noRoom + result.failed
  if (notAdded > 0) {
    const why: string[] = []
    if (result.refused > 0) why.push(`${result.refused} could not be used`)
    if (result.noRoom > 0) why.push(`${result.noRoom} had no room`)
    if (result.failed > 0) why.push(`${result.failed} could not be written`)
    parts.push(`Not added: ${why.join(', ')}.`)
  }
  // The attached files (D-037), said only for a backup that has any.
  if (result.files !== undefined) {
    const f = result.files
    if (f.added > 0)
      parts.push(
        `Put back ${attached(f.added)}${f.already > 0 ? ` (${f.already} already here)` : ''}.`
      )
    else if (f.already > 0) parts.push(`${attached(f.already)} already here.`)
    const lost = f.noRoom + f.failed + f.refused
    if (lost > 0) {
      const they = lost === 1 ? 'it' : 'they'
      const why: string[] = []
      if (f.noRoom > 0)
        why.push(
          f.noRoom === lost ? 'the attachments folder is full' : `${f.noRoom} for lack of room`
        )
      if (f.failed > 0)
        why.push(
          f.failed === lost ? `${they} could not be written` : `${f.failed} could not be written`
        )
      if (f.refused > 0)
        why.push(
          f.refused === lost ? `${they} could not be used` : `${f.refused} could not be used`
        )
      parts.push(`${attached(lost)} could not be put back: ${why.join(', ')}.`)
    }
  }
  return parts.join(' ')
}

export type Notice = { kind: 'ok' | 'error'; text: string }

export interface UseBackup {
  /** True while a dialog is open or a file is being written or read: the other buttons wait. */
  working: boolean
  notice: Notice | null
  /** What a backup file holds, shown before anything is added. */
  preview: RestorePreview | null
  exportAll: () => Promise<void>
  exportOne: (id: string) => Promise<void>
  /** Asks for a backup file and reads it. Adds nothing. */
  look: () => Promise<void>
  /** Adds the chats of the file that was looked at. */
  add: () => Promise<void>
  /** Drops the preview without adding anything. */
  dismiss: () => void
  clearNotice: () => void
}

/**
 * Backing up chats to a file and restoring them (D-034). The page never names a file: the person chooses in the system's dialogs, which the
 * main process opens, and the page is told only the outcome.
 */
export function useBackup(reload: () => void): UseBackup {
  const [working, setWorking] = useState(false)
  const [notice, setNotice] = useState<Notice | null>(null)
  const [preview, setPreview] = useState<RestorePreview | null>(null)
  const latestToken = useRef<string | null>(null)

  // What the main process is holding for a look at a file is let go when the page lets go of it.
  const drop = useCallback((): void => {
    if (latestToken.current !== null && window.api)
      window.api.history.restoreCancel(latestToken.current)
    latestToken.current = null
  }, [])
  useEffect(() => drop, [drop])

  async function run(task: () => Promise<void>): Promise<void> {
    if (working) return
    if (!window.api) {
      setNotice({ kind: 'error', text: `Nothing was done: ${NO_BRIDGE}.` })
      return
    }
    setWorking(true)
    setNotice(null)
    try {
      await task()
    } catch {
      setNotice({ kind: 'error', text: `Nothing was done: ${NO_ANSWER}.` })
    } finally {
      setWorking(false)
    }
  }

  async function exportWith(request: BackupRequest): Promise<void> {
    await run(async () => {
      const result = await window.api.history.exportChats(request)
      if (result.ok) setNotice({ kind: 'ok', text: describeExport(result) })
      else if (!result.cancelled) setNotice({ kind: 'error', text: result.error })
    })
  }

  return {
    working,
    notice,
    preview,
    exportAll: () => exportWith({ scope: 'all' }),
    exportOne: (id) => exportWith({ scope: 'one', id }),
    look: () =>
      run(async () => {
        drop()
        setPreview(null)
        const result = await window.api.history.restoreLook()
        if (result.ok) {
          latestToken.current = result.preview.token
          setPreview(result.preview)
        } else if (!result.cancelled) setNotice({ kind: 'error', text: result.error })
      }),
    add: () =>
      run(async () => {
        if (preview === null) return
        const token = preview.token
        latestToken.current = null // used up, whatever the answer is
        setPreview(null)
        const result = await window.api.history.restoreApply(token)
        if (result.ok) setNotice({ kind: 'ok', text: describeRestore(result) })
        else setNotice({ kind: 'error', text: result.error })
        reload() // the list shows what was added, or what is there after a failure
      }),
    dismiss: () => {
      drop()
      setPreview(null)
    },
    clearNotice: () => setNotice(null)
  }
}
