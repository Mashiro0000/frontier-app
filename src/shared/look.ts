// (22.4, D-054) The look, as AI Fiesta's Settings > General: the theme (System follows Windows), an accent colour and a font. Plain data and functions: the page
// keeps the choice on this computer (appearance.ts) and puts it on the page as CSS custom properties. Every accent is checked by numbers (tools/verify-22-4.mjs):
// white on the accent 4.5:1 or more (New chat, Send), the accent's text colour 4.5:1 or more on the window and the message box of its theme.

export type ThemeChoice = 'system' | 'dark' | 'light'
export type Theme = 'dark' | 'light'

export interface Accent {
  id: string
  label: string
  /** Buttons with white text on them (New chat, Send, Start a chat), and the selected edge of a card. */
  solid: string
  hover: string
  /** The gradient of the app's mark, New chat and Send: from `solid` to this. */
  to: string
  /** Links, marks and the focus ring: one per theme, readable on its window and message box. */
  text: Record<Theme, string>
  /** A faint wash of the colour: the mark of an expert, the glow behind the greeting. As r, g, b. */
  rgb: string
}

export const ACCENTS: readonly Accent[] = [
  {
    id: 'violet',
    label: 'Violet',
    solid: '#6a4dff',
    hover: '#5a3df0',
    to: '#a43be0',
    text: { dark: '#a794ff', light: '#5b3ff0' },
    rgb: '124, 92, 255'
  },
  {
    id: 'blue',
    label: 'Blue',
    solid: '#2563eb',
    hover: '#1d4ed8',
    to: '#4f46e5',
    text: { dark: '#8ab4ff', light: '#1d4ed8' },
    rgb: '37, 99, 235'
  },
  {
    id: 'teal',
    label: 'Teal',
    solid: '#0f766e',
    hover: '#115e59',
    to: '#0e7490',
    text: { dark: '#5eead4', light: '#0f766e' },
    rgb: '20, 184, 166'
  },
  {
    id: 'green',
    label: 'Green',
    solid: '#15803d',
    hover: '#166534',
    to: '#0f766e',
    text: { dark: '#86efac', light: '#15803d' },
    rgb: '34, 197, 94'
  },
  {
    id: 'orange',
    label: 'Orange',
    solid: '#c2410c',
    hover: '#9a3412',
    to: '#be123c',
    text: { dark: '#fdba74', light: '#c2410c' },
    rgb: '249, 115, 22'
  },
  {
    id: 'pink',
    label: 'Pink',
    solid: '#be185d',
    hover: '#9d174d',
    to: '#a21caf',
    text: { dark: '#f9a8d4', light: '#be185d' },
    rgb: '236, 72, 153'
  }
]

export const DEFAULT_ACCENT = 'violet'

export interface FontChoice {
  id: string
  label: string
  /** The CSS font list: the font, then the app's own default as the fallback (a font that is missing changes nothing). */
  stack: string
}

const UI_FALLBACK = "'Segoe UI Variable Text', 'Segoe UI', system-ui, sans-serif"

/** Fonts Windows itself comes with: nothing is downloaded (the plan's rule). */
export const FONTS: readonly FontChoice[] = [
  { id: 'segoe', label: 'Segoe UI (default)', stack: UI_FALLBACK },
  { id: 'calibri', label: 'Calibri', stack: `Calibri, ${UI_FALLBACK}` },
  { id: 'candara', label: 'Candara', stack: `Candara, ${UI_FALLBACK}` },
  { id: 'bahnschrift', label: 'Bahnschrift', stack: `Bahnschrift, ${UI_FALLBACK}` },
  { id: 'verdana', label: 'Verdana', stack: `Verdana, ${UI_FALLBACK}` },
  { id: 'trebuchet', label: 'Trebuchet MS', stack: `'Trebuchet MS', ${UI_FALLBACK}` },
  { id: 'georgia', label: 'Georgia (serif)', stack: `Georgia, ${UI_FALLBACK}` },
  { id: 'cambria', label: 'Cambria (serif)', stack: `Cambria, ${UI_FALLBACK}` }
]

export const DEFAULT_FONT = 'segoe'

/** The theme on screen: the person's choice, or Windows' when they chose System. */
export const effectiveTheme = (choice: ThemeChoice, windowsIsDark: boolean): Theme =>
  choice === 'system' ? (windowsIsDark ? 'dark' : 'light') : choice

export const accentById = (id: string | null): Accent =>
  ACCENTS.find((a) => a.id === id) ?? (ACCENTS.find((a) => a.id === DEFAULT_ACCENT) as Accent)

export const fontById = (id: string | null): FontChoice =>
  FONTS.find((f) => f.id === id) ?? (FONTS.find((f) => f.id === DEFAULT_FONT) as FontChoice)

/** The custom properties an accent sets on the page, for the theme on screen. */
export function accentProperties(accent: Accent, theme: Theme): Record<string, string> {
  return {
    '--color-accent': accent.solid,
    '--color-accent-hover': accent.hover,
    '--color-accent-text': accent.text[theme],
    '--color-focus': accent.text[theme],
    '--color-accent-soft': `rgba(${accent.rgb}, ${theme === 'dark' ? 0.18 : 0.1})`,
    '--accent-rgb': accent.rgb,
    '--gradient': `linear-gradient(135deg, ${accent.solid} 0%, ${accent.to} 100%)`,
    '--gradient-shadow': `0 6px 18px rgba(${accent.rgb}, 0.35)`
  }
}

// ---- contrast (WCAG 2.x), for the checks ----

const channel = (v: number): number => {
  const s = v / 255
  return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
}

/** The relative luminance of a #rrggbb colour. */
export function luminance(hex: string): number {
  const n = Number.parseInt(hex.slice(1), 16)
  return (
    0.2126 * channel((n >> 16) & 255) + 0.7152 * channel((n >> 8) & 255) + 0.0722 * channel(n & 255)
  )
}

/** The contrast ratio of two #rrggbb colours, 1 to 21. */
export function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (hi + 0.05) / (lo + 0.05)
}
