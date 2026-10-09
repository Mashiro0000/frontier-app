import { useCallback, useEffect, useState } from 'react'
import type { AppliedChange, ChangeSummary } from '../../../shared/changes'
import type { ToolsStatus } from '../../../shared/tools'
import type { WorkspaceStatus } from '../../../shared/workspace'

export interface ToolSettingsState {
  /** Which tools are on and the caps on one reply, as main has them (D-041, 11.4), or null until main has answered (or if it could not). */
  status: ToolsStatus | null
  setStatus: (status: ToolsStatus) => void
  /** The code workspace (D-042, 12.3): the chosen folder and whether the model may ask to use it, as main has them, or null until main has answered. */
  workspace: WorkspaceStatus | null
  /** The changes the model proposed and nobody has decided on (D-042, 12.5): a summary of each, or null until main has answered. */
  changes: ChangeSummary[] | null
  /** The changes that were applied (D-042, 12.6), newest first, or null until main has answered. */
  applied: AppliedChange[] | null
  setWorkspace: (status: WorkspaceStatus) => void
  /** Asks main again: when the Tools page opens, so that it shows what a reply will really be allowed. */
  reload: () => void
}

/** Asks main for the tool settings when the window opens, and again on `reload`. Main keeps them and reads them itself at every reply. */
export function useToolSettings(): ToolSettingsState {
  const [status, setStatus] = useState<ToolsStatus | null>(null)
  const [workspace, setWorkspace] = useState<WorkspaceStatus | null>(null)
  const [changes, setChanges] = useState<ChangeSummary[] | null>(null)
  const [applied, setApplied] = useState<AppliedChange[] | null>(null)

  const reload = useCallback((): void => {
    if (!window.api) return // the preload did not load: the app says so elsewhere (useSettingsStatus)
    window.api.tools.status().then(setStatus, () => setStatus(null))
    window.api.workspace.status().then(setWorkspace, () => setWorkspace(null))
    window.api.changes.list().then(setChanges, () => setChanges(null))
    window.api.changes.applied().then(setApplied, () => setApplied(null))
  }, [])

  useEffect(() => {
    reload()
  }, [reload])

  return { status, setStatus, workspace, setWorkspace, changes, applied, reload }
}

/** True when any tool is switched on: the Stop button of a reply then says what it really does (it ends the reply, stops a running tool and closes a question). */
export const anyToolOn = (status: ToolsStatus | null, workspace: WorkspaceStatus | null = null): boolean =>
  (status !== null && status.problem === null && status.tools.some((tool) => tool.on)) ||
  (workspace !== null && workspace.on && workspace.folder !== null && workspace.unusable === null)
