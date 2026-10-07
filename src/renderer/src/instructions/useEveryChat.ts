import { useCallback, useEffect, useState } from 'react'
import type { EveryChatStatus } from '../../../shared/ipc'

export interface EveryChatState {
  /** The person's instructions for every chat as main has them (D-039), or null until main has answered (or if it could not). */
  status: EveryChatStatus | null
  setStatus: (status: EveryChatStatus) => void
  /** Asks main again: when the Instructions dialog opens, so that it shows what will really be sent. */
  reload: () => void
}

/** Asks main for the instructions for every chat when the window opens, and again on `reload`. Main keeps them and adds them to requests itself. */
export function useEveryChat(): EveryChatState {
  const [status, setStatus] = useState<EveryChatStatus | null>(null)

  const reload = useCallback((): void => {
    if (!window.api) return // the preload did not load: the app says so elsewhere (useSettingsStatus)
    window.api.instructions.getEveryChat().then(setStatus, () => setStatus(null))
  }, [])

  useEffect(() => {
    reload()
  }, [reload])

  return { status, setStatus, reload }
}
