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

/** What the person is told after a backup (D-034). */
export function describeExport(result: Extract<HistoryExportResult, { ok: true }>): string {
  const left =
    result.leftOut === 0
      ? ''
      : ` ${result.leftOut === 1 ? '1 saved file' : `${result.leftOut} saved files`} could not be read and ${result.leftOut === 1 ? 'is' : 'are'} not in it.`
  return `Backed up ${chats(result.count)} to ${result.where}. The file was read back and every chat matched.${left}`
}

/** What the person is told after chats were added from a backup. */
export function describeRestore(result: Extract<HistoryRestoreApplyResult, { ok: true }>): string {
  const parts = [`Added ${chats(result.added + result.copies)}`]
  if (result.copies > 0)
    parts[0] += ` (${result.copies === 1 ? '1 as a copy' : `${result.copies} as copies`})`
  parts[0] += '.'
  if (result.same > 0) parts.push(`${chats(result.same)} already here, left as they are.`)
  const notAdded = result.refused + result.noRoom + result.failed
  if (notAdded > 0) {
    const why: string[] = []
    if (result.refused > 0) why.push(`${result.refused} could not be used`)
    if (result.noRoom > 0) why.push(`${result.noRoom} had no room`)
    if (result.failed > 0) why.push(`${result.failed} could not be written`)
    parts.push(`Not added: ${why.join(', ')}.`)
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
