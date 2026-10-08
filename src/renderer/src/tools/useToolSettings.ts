import { useCallback, useEffect, useState } from 'react'
import type { ToolsStatus } from '../../../shared/tools'

export interface ToolSettingsState {
  /** Which tools are on and the caps on one reply, as main has them (D-041, 11.4), or null until main has answered (or if it could not). */
  status: ToolsStatus | null
  setStatus: (status: ToolsStatus) => void
  /** Asks main again: when the Tools page opens, so that it shows what a reply will really be allowed. */
  reload: () => void
}

/** Asks main for the tool settings when the window opens, and again on `reload`. Main keeps them and reads them itself at every reply. */
export function useToolSettings(): ToolSettingsState {
  const [status, setStatus] = useState<ToolsStatus | null>(null)

  const reload = useCallback((): void => {
    if (!window.api) return // the preload did not load: the app says so elsewhere (useSettingsStatus)
    window.api.tools.status().then(setStatus, () => setStatus(null))
  }, [])

  useEffect(() => {
    reload()
  }, [reload])

  return { status, setStatus, reload }
}

/** True when any tool is switched on: the Stop button of a reply then says what it really does (it ends the reply, stops a running tool and closes a question). */
export const anyToolOn = (status: ToolsStatus | null): boolean =>
  status !== null && status.problem === null && status.tools.some((tool) => tool.on)
