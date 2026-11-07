// Stage 22.4 (D-054), the look under plain Node: every accent readable by numbers in both themes (white on the accent and on its gradient's end 4.5:1 or more;
// the accent's text colour 4.5:1 or more on its theme's window, message box, dialog and sidebar); System follows Windows; an unknown accent or font is the
// default; the fonts are Windows' own (no address, nothing to download); the default accent and font leave base.css's colours untouched.
// usage: node tools/verify-22-4.mjs
import './ts-resolve.mjs'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { checker } from './cdp.mjs'
import { REPO_URL } from './paths.mjs'

const check = checker()
const L = await import(`${REPO_URL}/src/shared/look.ts`)
const read = (path) => readFileSync(fileURLToPath(`${REPO_URL}/${path}`), 'utf8')

// The surfaces of each theme, read from base.css itself (not copied here), so a change of a surface is checked too.
const base = read('src/renderer/src/assets/base.css')
const block = (selector) => base.slice(base.indexOf(selector), base.indexOf('}', base.indexOf(selector)))
const colour = (css, name) => css.match(new RegExp(`${name}:\\s*(#[0-9a-f]{6})`, 'i'))?.[1]
const SURFACES = ['--color-background', '--color-background-soft', '--color-background-mute', '--color-composer', '--color-sidebar']
const surfaces = {
  dark: SURFACES.map((n) => colour(block(":root[data-theme='dark']"), n)),
  light: SURFACES.map((n) => colour(block(":root[data-theme='light']"), n))
}
check('A: (setup) the five surfaces of each theme are read from base.css', [...surfaces.dark, ...surfaces.light].every((c) => /^#[0-9a-f]{6}$/i.test(c ?? '')), JSON.stringify(surfaces))

check('A: the contrast sum is right on known pairs (black on white 21, a colour on itself 1)', Math.abs(L.contrast('#000000', '#ffffff') - 21) < 0.01 && Math.abs(L.contrast('#6a4dff', '#6a4dff') - 1) < 0.001)
check('A: six accents, each with its own id, violet the default', L.ACCENTS.length === 6 && new Set(L.ACCENTS.map((a) => a.id)).size === 6 && L.DEFAULT_ACCENT === 'violet')
for (const a of L.ACCENTS) {
  const white = Math.min(L.contrast('#ffffff', a.solid), L.contrast('#ffffff', a.to), L.contrast('#ffffff', a.hover))
  check(`A: ${a.label}: white text on it and on its gradient 4.5:1 or more`, white >= 4.5, white.toFixed(2))
  for (const theme of ['dark', 'light']) {
    const worst = Math.min(...surfaces[theme].map((s) => L.contrast(a.text[theme], s)))
    check(`A: ${a.label}: its ${theme} text colour 4.5:1 or more on every ${theme} surface`, worst >= 4.5, worst.toFixed(2))
  }
}
const violet = L.accentById('violet')
const darkBlock = block(":root,\n:root[data-theme='dark']")
check('A: violet is base.css\'s own violet (the default looks as before)', violet.solid === colour(darkBlock, '--color-accent') && violet.text.dark === colour(darkBlock, '--color-accent-text') && violet.text.light === colour(block(":root[data-theme='light']"), '--color-accent-text'))

check('B: System follows Windows: dark when Windows is dark, light when it is light', L.effectiveTheme('system', true) === 'dark' && L.effectiveTheme('system', false) === 'light')
check('B: Dark and Light are kept whatever Windows is', L.effectiveTheme('dark', false) === 'dark' && L.effectiveTheme('light', true) === 'light')
check('B: an unknown or missing accent is the default', L.accentById('neon').id === 'violet' && L.accentById(null).id === 'violet')
check('B: an unknown or missing font is the default', L.fontById('comic').id === L.DEFAULT_FONT && L.fontById(null).id === L.DEFAULT_FONT)
const props = L.accentProperties(L.accentById('teal'), 'light')
check('B: an accent sets the colours the page uses, with its light text colour in the light theme', props['--color-accent'] === '#0f766e' && props['--color-accent-text'] === L.accentById('teal').text.light && props['--color-focus'] === props['--color-accent-text'] && /0f766e/.test(props['--gradient']))

check('C: eight fonts, each named and with the app\'s default after it', L.FONTS.length === 8 && L.FONTS.every((f) => f.label && f.stack.endsWith("'Segoe UI Variable Text', 'Segoe UI', system-ui, sans-serif")))
check('C: no font is fetched: no address, no @font-face, no url( anywhere in the fonts or the styles', L.FONTS.every((f) => !/url\(|https?:|\/\//.test(f.stack)) && !/@font-face/.test(read('src/renderer/src/assets/main.css') + base))

const appearance = read('src/renderer/src/appearance.ts')
check('D: the default accent and font are taken OFF the page (base.css shows), another is put on', /accent === DEFAULT_ACCENT\) root\.style\.removeProperty\(name\)/.test(appearance) && /font === DEFAULT_FONT\) root\.style\.removeProperty\('--font-ui'\)/.test(appearance))
check('D: System hears Windows change (a listener on prefers-color-scheme) and acts only when System is chosen', /matchMedia\('\(prefers-color-scheme: dark\)'\)\.addEventListener\('change'/.test(appearance) && /if \(choice !== 'system'\) return/.test(appearance))
check('D: the choices are kept on this computer only (localStorage), main is not asked', /localStorage\.setItem/.test(appearance) && !/window\.api/.test(appearance))
const section = read('src/renderer/src/settings/AppearanceSection.tsx')
check('D: Settings > Appearance offers System, Light and Dark, the accents and the fonts', /'system'/.test(section) && /'light'/.test(section) && /'dark'/.test(section) && /ACCENTS\.map/.test(section) && /FONTS\.map/.test(section))
const css = read('src/renderer/src/assets/main.css')
check('E: the light theme has a glow behind the greeting, in the accent\'s colour', /:root\[data-theme='light'\] \.empty::before/.test(css) && /rgba\(var\(--accent-rgb, 124, 92, 255\)/.test(css))

process.exit(check.summary() ? 0 : 1)
