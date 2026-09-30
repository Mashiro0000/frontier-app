import { useEffect, useState } from 'react'
import type { SettingsStatus } from '../../../shared/ipc'

export interface SettingsState {
  /** What the main process says about settings, or null until it has answered. */
  status: SettingsStatus | null
  /** Set if the main process could not be reached at all. */
  loadError: string | null
  setStatus: (status: SettingsStatus) => void
}

/** Asks the main process once, when the window opens, whether an API key is saved. */
export function useSettingsStatus(): SettingsState {
  const [status, setStatus] = useState<SettingsStatus | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    // `window.api` is missing when the preload failed to load (see D-004). Say so, instead of
    // leaving the app quietly half-working.
    const request = window.api
      ? window.api.settings.getStatus()
      : Promise.reject(
          new Error('the window could not connect to the app (the preload did not load)')
        )
    request.then(
      (result) => {
        if (!cancelled) setStatus(result)
      },
      (error: unknown) => {
        if (!cancelled) setLoadError(error instanceof Error ? error.message : String(error))
      }
    )
    return () => {
      cancelled = true
    }
  }, [])

  return { status, loadError, setStatus }
}
