import { useSyncExternalStore } from 'react'
import {
  accentById,
  accentProperties,
  DEFAULT_ACCENT,
  DEFAULT_FONT,
  effectiveTheme,
  fontById,
  type Theme,
  type ThemeChoice
} from '../../shared/look'

/**
 * How the window looks (D-051, D-054): the theme (dark unless the person picks light or System, which follows Windows), the accent colour, the font, and whether
 * the sidebar is folded to a rail of icons. All are the person's own choice for this computer and tell nothing about their chats, keys or spending, so the page
 * keeps them itself, in its own storage; main is not asked. A value that is missing, damaged or cannot be read only means the defaults.
 */

export type { Theme, ThemeChoice }

const THEME_KEY = 'frontier.theme'
const RAIL_KEY = 'frontier.sidebar'
const ACCENT_KEY = 'frontier.accent'
const FONT_KEY = 'frontier.font'
const PAGES_KEY = 'frontier.pages'

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

const savedTheme = read(THEME_KEY)
let choice: ThemeChoice = savedTheme === 'light' || savedTheme === 'system' ? savedTheme : 'dark'
let rail = read(RAIL_KEY) === 'rail'
let accent = accentById(read(ACCENT_KEY)).id
let font = fontById(read(FONT_KEY)).id

// Windows' own light or dark, for System; the page hears when it changes.
const windowsDark = (): boolean => {
  try {
    return window.matchMedia('(prefers-color-scheme: dark)').matches
  } catch {
    return true
  }
}
let theme: Theme = effectiveTheme(choice, windowsDark())

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

/** Puts the look on the page; called once before the first render, so a light window does not start dark. */
export function applyTheme(): void {
  theme = effectiveTheme(choice, windowsDark())
  const root = document.documentElement
  root.dataset.theme = theme
  root.dataset.accent = accent
  // The default accent is base.css's own colours, untouched; another one is put on the page over them.
  for (const [name, value] of Object.entries(accentProperties(accentById(accent), theme))) {
    if (accent === DEFAULT_ACCENT) root.style.removeProperty(name)
    else root.style.setProperty(name, value)
  }
  if (font === DEFAULT_FONT) root.style.removeProperty('--font-ui')
  else root.style.setProperty('--font-ui', fontById(font).stack)
}

try {
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
    if (choice !== 'system') return
    applyTheme()
    changed()
  })
} catch {
  // No media queries: System stays at the theme it started with.
}

/** The theme chosen: Dark, Light or System. */
export function setThemeChoice(next: ThemeChoice): void {
  choice = next
  write(THEME_KEY, next)
  applyTheme()
  changed()
}

/** Dark or light, chosen outright (the button at the foot of the sidebar). */
export const setTheme = (next: Theme): void => setThemeChoice(next)

export function setAccent(id: string): void {
  accent = accentById(id).id
  write(ACCENT_KEY, accent)
  applyTheme()
  changed()
}

export function setFont(id: string): void {
  font = fontById(id).id
  write(FONT_KEY, font)
  applyTheme()
  changed()
}

/** (23.8, D-055) The order of the sidebar's pages as saved (anything: shared/order.ts makes it usable), and saving a new one. */
export function savedPageOrder(): unknown {
  try {
    return JSON.parse(read(PAGES_KEY) ?? 'null')
  } catch {
    return null
  }
}
export const savePageOrder = (order: readonly string[]): void =>
  write(PAGES_KEY, JSON.stringify(order))

export function setRail(next: boolean): void {
  rail = next
  write(RAIL_KEY, next ? 'rail' : 'open')
  changed()
}

/** The theme on screen (System resolved). */
export const useTheme = (): Theme => useSyncExternalStore(subscribe, () => theme)
export const useThemeChoice = (): ThemeChoice => useSyncExternalStore(subscribe, () => choice)
export const useAccent = (): string => useSyncExternalStore(subscribe, () => accent)
export const useFont = (): string => useSyncExternalStore(subscribe, () => font)
export const useRail = (): boolean => useSyncExternalStore(subscribe, () => rail)
