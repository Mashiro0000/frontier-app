import { useCallback, useEffect, useState } from 'react'
import { ALL_CHATS, type MemoryStatus, type Note } from '../../../shared/memory'

export interface MemoryState {
  /** The memory as main has it (D-039), or null until main has answered (or if it could not). */
  status: MemoryStatus | null
  setStatus: (status: MemoryStatus) => void
  /** Asks main again: when the Memory dialog opens, so that it shows what will really be sent. */
  reload: () => void
}

/** Asks main for the notes when the window opens, and again on `reload`. Main keeps them and adds them to requests itself. */
export function useMemory(): MemoryState {
  const [status, setStatus] = useState<MemoryStatus | null>(null)

  const reload = useCallback((): void => {
    if (!window.api) return // the preload did not load: the app says so elsewhere (useSettingsStatus)
    window.api.memory.status().then(setStatus, () => setStatus(null))
  }, [])

  useEffect(() => {
    reload()
  }, [reload])

  return { status, setStatus, reload }
}

/** The notes that go with a request of the chat on screen (every chat's, in 10.4; a project's join them in 10.6), or [] while memory is off. */
export const notesSent = (status: MemoryStatus | null): Note[] =>
  status === null || !status.on || status.problem !== null
    ? []
    : status.notes.filter((note) => note.scope === ALL_CHATS)
