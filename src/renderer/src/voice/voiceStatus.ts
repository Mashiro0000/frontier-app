import { useSyncExternalStore } from 'react'
import type { VoiceStatus } from '../../../shared/voice'

// What the page knows of the voice settings (Stage 15.6, D-047): one copy for the whole page, read from main when the page first asks and again whenever something changes
// them (Settings, or a failure that says the settings are not what was thought). Many places look at it (the microphone button, a "Read aloud" button under each reply, the
// Settings section), and each of them asking main would be a message for every reply on the screen. The page only reads and displays: main keeps the settings.

type Listener = () => void

let current: VoiceStatus | null = null
let started = false
const listeners = new Set<Listener>()

function publish(next: VoiceStatus | null): void {
  current = next
  for (const listener of [...listeners]) listener()
}

/** Reads the status from main again. A failure leaves what the page knew. */
export function reloadVoiceStatus(): void {
  started = true
  void window.api.voice.status().then(
    (status) => publish(status),
    () => undefined
  )
}

/** Tells the page that main's settings have a new status (the answer to a change the page asked for). */
export function setVoiceStatus(status: VoiceStatus): void {
  started = true
  publish(status)
}

function subscribe(listener: Listener): () => void {
  listeners.add(listener)
  if (!started) reloadVoiceStatus()
  return () => {
    listeners.delete(listener)
  }
}

/** The voice settings, or null until main has answered. */
export function useVoiceStatus(): VoiceStatus | null {
  return useSyncExternalStore(subscribe, () => current)
}
