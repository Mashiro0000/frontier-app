import { useSyncExternalStore } from 'react'

/**
 * How the window looks (D-051): the theme (dark unless the person picks light) and whether the sidebar is folded to a rail of icons.
 * Both are the person's own choice for this computer and tell nothing about their chats, keys or spending, so the page keeps them
 * itself, in its own storage; main is not asked. A value that is missing, damaged or cannot be read only means the defaults.
 */

export type Theme = 'dark' | 'light'

const THEME_KEY = 'frontier.theme'
const RAIL_KEY = 'frontier.sidebar'

function read(key: string): string | null {
  try {
    return window.localStorage.getItem(key)
  } catch {
    return null
  }
}

function write(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value)
  } catch {
    // Not kept: the choice still holds until the window closes.
  }
}

let theme: Theme = read(THEME_KEY) === 'light' ? 'light' : 'dark'
let rail = read(RAIL_KEY) === 'rail'

const listeners = new Set<() => void>()

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

function changed(): void {
  for (const listener of listeners) listener()
}

/** Puts the theme on the page; called once before the first render, so a light window does not start dark. */
export function applyTheme(): void {
  document.documentElement.dataset.theme = theme
}

export function setTheme(next: Theme): void {
  theme = next
  write(THEME_KEY, next)
  applyTheme()
  changed()
}

export function setRail(next: boolean): void {
  rail = next
  write(RAIL_KEY, next ? 'rail' : 'open')
  changed()
}

export const useTheme = (): Theme => useSyncExternalStore(subscribe, () => theme)

export const useRail = (): boolean => useSyncExternalStore(subscribe, () => rail)
