import { useCallback, useState } from 'react'
import type { AuditView } from '../../../shared/audit'

export interface AuditState {
  /** The audit log as main has it (D-041), or null until main has answered. */
  view: AuditView | null
  /** Asks main again: when the Tools page opens, and after a deletion. */
  reload: () => void
}

/** The newest calls of the audit log, asked for when the Tools page opens. Main keeps the log; the page can only read it, export it and ask to delete it. */
export function useAudit(): AuditState {
  const [view, setView] = useState<AuditView | null>(null)

  const reload = useCallback((): void => {
    if (!window.api) return // the preload did not load: the app says so elsewhere (useSettingsStatus)
    window.api.audit.read().then(setView, () => {
      setView({ ok: false, error: 'The audit log could not be read: the app did not answer.' })
    })
  }, [])

  return { view, reload }
}
