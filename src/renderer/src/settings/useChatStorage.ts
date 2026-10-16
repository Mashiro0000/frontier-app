import { useCallback, useEffect, useState } from 'react'
import type { ChatStorageReport, ChatStorageResult, ChatStorageStatus } from '../../../shared/ipc'

const NO_BRIDGE = 'the window could not connect to the app (the preload did not load)'
const NO_ANSWER = 'the app did not answer'

const chats = (count: number): string => `${count} ${count === 1 ? 'chat' : 'chats'}`
const files = (count: number): string => `${count} saved ${count === 1 ? 'file' : 'files'}`
const attached = (count: number): string => `${count} attached ${count === 1 ? 'file' : 'files'}`
const gallery = (count: number): string =>
  `${count} ${count === 1 ? 'picture' : 'pictures'} in the gallery`

export type Notice = { kind: 'ok' | 'error'; text: string }

/** What the person is told after encryption was turned on (D-035): the backup that came first, what was encrypted, and what was not. */
export function describeEncrypted(report: ChatStorageReport): string {
  const parts: string[] = []
  if (report.backup !== null) {
    let backed = `Backed up ${chats(report.backup.count)} to ${report.backup.where} first, and checked it. It is a plain file: keep it somewhere safe.`
    if (report.backup.leftOut > 0) {
      backed += ` ${files(report.backup.leftOut)} could not be read and ${report.backup.leftOut === 1 ? 'is' : 'are'} not in it.`
    }
    parts.push(backed)
  }
  parts.push(
    report.changed === 0 && report.failed === 0
      ? 'Every saved chat was already encrypted.'
      : `Encrypted ${chats(report.changed)}.`
  )
  if (report.failed > 0) {
    parts.push(
      `${chats(report.failed)} could not be rewritten and ${report.failed === 1 ? 'is' : 'are'} as before; "Encrypt the rest" tries again.`
    )
  }
  // The attached files (D-037), said only when there are any.
  if (report.files !== undefined) {
    if (report.files.changed > 0) parts.push(`Encrypted ${attached(report.files.changed)} too.`)
    if (report.files.failed > 0) {
      parts.push(
        `${attached(report.files.failed)} could not be rewritten and ${report.files.failed === 1 ? 'is' : 'are'} as before.`
      )
    }
  }
  // The instructions for every chat and the notes (D-039), said only when there are any.
  if (report.documents !== undefined) {
    if (report.documents.changed > 0) {
      parts.push(
        'Your instructions for every chat, your notes, your projects, your tool settings and the audit log of tool calls are encrypted too.'
      )
    }
    if (report.documents.failed > 0) {
      parts.push(
        'Some of your instructions for every chat, notes, projects, tool settings or the audit log could not be rewritten and are as before.'
      )
    }
  }
  // The gallery's pictures (D-048), said only when there are any.
  if (report.pictures !== undefined) {
    if (report.pictures.changed > 0)
      parts.push(`Encrypted ${gallery(report.pictures.changed)} too.`)
    if (report.pictures.failed > 0) {
      parts.push(
        `${gallery(report.pictures.failed)} could not be rewritten and ${report.pictures.failed === 1 ? 'is' : 'are'} as before.`
      )
    }
  }
  parts.push('Chats you save from now on are encrypted too.')
  return parts.join(' ')
}

/** What the person is told after going back to plain files. */
export function describePlain(report: ChatStorageReport, status: ChatStorageStatus): string {
  const parts = [
    report.changed === 0 && report.failed === 0
      ? 'Chats you save from now on are plain files.'
      : `Rewrote ${chats(report.changed)} as ${report.changed === 1 ? 'a plain file' : 'plain files'}. Chats you save from now on are plain files too.`
  ]
  if (report.failed > 0) {
    parts.push(
      `${chats(report.failed)} could not be rewritten and ${report.failed === 1 ? 'is' : 'are'} still encrypted.`
    )
  }
  if (report.files !== undefined) {
    if (report.files.changed > 0)
      parts.push(
        `Rewrote ${attached(report.files.changed)} as ${report.files.changed === 1 ? 'a plain file' : 'plain files'} too.`
      )
    if (report.files.failed > 0) {
      parts.push(
        `${attached(report.files.failed)} could not be rewritten and ${report.files.failed === 1 ? 'is' : 'are'} still encrypted.`
      )
    }
  }
  if (report.documents !== undefined) {
    if (report.documents.changed > 0) {
      parts.push(
        'Your instructions for every chat, your notes, your projects, your tool settings and the audit log of tool calls are plain files again too.'
      )
    }
    if (report.documents.failed > 0) {
      parts.push(
        'Some of your instructions for every chat, notes, projects, tool settings or the audit log could not be rewritten and are still encrypted.'
      )
    }
  }
  if (report.pictures !== undefined) {
    if (report.pictures.changed > 0)
      parts.push(
        `Rewrote ${gallery(report.pictures.changed)} as ${report.pictures.changed === 1 ? 'a plain file' : 'plain files'} too.`
      )
    if (report.pictures.failed > 0) {
      parts.push(
        `${gallery(report.pictures.failed)} could not be rewritten and ${report.pictures.failed === 1 ? 'is' : 'are'} still encrypted.`
      )
    }
  }
  if (status.unopened > 0) {
    parts.push(
      `${files(status.unopened)} ${status.unopened === 1 ? 'is' : 'are'} encrypted and cannot be opened with this computer's key; ${status.unopened === 1 ? 'it was' : 'they were'} left exactly as ${status.unopened === 1 ? 'it is' : 'they are'}.`
    )
  }
  return parts.join(' ')
}

export interface UseChatStorage {
  /** How the chats are kept; null until the main process has answered. */
  status: ChatStorageStatus | null
  loadError: string | null
  /** True while the system's dialog is open or the chats are being rewritten: nothing else is started. */
  working: boolean
  notice: Notice | null
  encrypt: () => Promise<void>
  decrypt: () => Promise<void>
}

/**
 * How the saved chats are kept, and the two things the person can do about it (D-035). The page never names a file, a key or a place: the main process asks
 * the person in the system's own dialogs, and tells the page only what was done. `onChanged` is told after a change, so the History list can look again.
 */
export function useChatStorage(open: boolean, onChanged: () => void): UseChatStorage {
  const [status, setStatus] = useState<ChatStorageStatus | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [working, setWorking] = useState(false)
  const [notice, setNotice] = useState<Notice | null>(null)

  const refresh = useCallback((): void => {
    // `window.api` is missing when the preload failed to load (D-004): say so, and set state only in the callbacks, never straight away.
    const request = window.api ? window.api.history.storage() : Promise.reject(new Error(NO_BRIDGE))
    request.then(
      (next) => {
        setStatus(next)
        setLoadError(null)
      },
      (error: unknown) => setLoadError(error instanceof Error ? error.message : String(error))
    )
  }, [])

  // Looked at again each time Settings opens: the chats may have changed since (a restore, a chat that was saved).
  useEffect(() => {
    if (open) refresh()
  }, [open, refresh])

  async function run(
    task: () => Promise<ChatStorageResult>,
    describe: (report: ChatStorageReport, status: ChatStorageStatus) => string
  ): Promise<void> {
    if (working) return
    if (!window.api) {
      setNotice({ kind: 'error', text: `Nothing was done: ${NO_BRIDGE}.` })
      return
    }
    setWorking(true)
    setNotice(null)
    try {
      const result = await task()
      if (result.ok) {
        setStatus(result.status)
        setNotice({ kind: 'ok', text: describe(result.report, result.status) })
      } else if (!result.cancelled) {
        setNotice({ kind: 'error', text: result.error })
      }
      onChanged()
      refresh()
    } catch {
      setNotice({ kind: 'error', text: `Nothing was done: ${NO_ANSWER}.` })
    } finally {
      setWorking(false)
    }
  }

  return {
    status,
    loadError,
    working,
    notice,
    encrypt: () => run(() => window.api.history.encryptChats(), describeEncrypted),
    decrypt: () => run(() => window.api.history.decryptChats(), describePlain)
  }
}
