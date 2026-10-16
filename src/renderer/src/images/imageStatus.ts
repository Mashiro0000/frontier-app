import { useSyncExternalStore } from 'react'
import type { ImageStatus } from '../../../shared/images'

// What the page knows of image generation (Stage 16.6, D-048): one copy for the whole page, read from main when the page first asks and again whenever something may have
// changed it (Settings, the dialog opening, a refusal). The chat bar's button, the dialog and the Settings section all look at it. The page only reads and displays: main
// keeps the switch, the models and the gallery, and decides.

type Listener = () => void

let current: ImageStatus | null = null
let started = false
const listeners = new Set<Listener>()

function publish(next: ImageStatus | null): void {
  current = next
  for (const listener of [...listeners]) listener()
}

/** Reads the status from main again. A failure leaves what the page knew. */
export function reloadImageStatus(): void {
  started = true
  void window.api.images.status().then(
    (status) => publish(status),
    () => undefined
  )
}

/** Tells the page that main has a new status (the answer to a change the page asked for). */
export function setImageStatus(status: ImageStatus): void {
  started = true
  publish(status)
}

function subscribe(listener: Listener): () => void {
  listeners.add(listener)
  if (!started) reloadImageStatus()
  return () => {
    listeners.delete(listener)
  }
}

/** The image status, or null until main has answered. */
export function useImageStatus(): ImageStatus | null {
  return useSyncExternalStore(subscribe, () => current)
}
