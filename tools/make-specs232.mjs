// Writes the negative-control specs for Stage 23.2 to 23.7 (D-055): one sabotage each, which verify-23-2w (window) or verify-23-5 (Node) must notice.
// usage: node tools/make-specs232.mjs
//   then: node tools/guarded-window-copy.mjs tools/nc-all.mjs specs232w <names...>
//         node tools/nc-all.mjs specs235 <names...>
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { TOOLS } from './paths.mjs'
import { scratch } from './drive.mjs'

const P = '{{REPO}}/src/renderer/src/'
const ACTIONS = P + 'chat/MessageActions.tsx', BAR = P + 'chat/ChatBar.tsx', BLOCK = P + 'markdown/CodeBlock.tsx', COLOUR = P + 'markdown/colour.ts'
const APP = P + 'App.tsx', CHOOSER = P + 'settings/ModelChooser.tsx', SETTINGS = P + 'settings/SettingsDialog.tsx', CSS = P + 'assets/main.css'

const windowSpecs = {
  'w232-action-words-shown': [[ACTIONS, "  <span className={shown ? 'message-action-label' : 'visually-hidden'}>{text}</span>", '  <span className="message-action-label">{text}</span>']],
  'w232-labels-always-shown': [[BAR, "(on ? 'chat-label' : 'chat-label visually-hidden')", "(on ? 'chat-label' : 'chat-label')"]],
  'w232-labels-never-shown': [[BAR, "(on ? 'chat-label' : 'chat-label visually-hidden')", "(on ? 'chat-label visually-hidden' : 'chat-label visually-hidden')"]],
  'w232-no-task-in-chooser': [[CHOOSER, '        {onTask !== undefined && (', '        {false && (']],
  'w232-pill-square': [[CSS, '  padding: 1px;\n  border: 1px solid var(--color-border);\n  border-radius: 999px;\n}', '  padding: 1px;\n  border: 1px solid var(--color-border);\n  border-radius: 8px;\n}']],
  'w232-no-colours': [[BLOCK, '  const pieces = useMemo(() => colourCode(text, lang), [text, lang])', '  const pieces = useMemo(() => (lang === lang ? null : colourCode(text, lang)), [text, lang])']],
  'w232-esc-does-not-stop': [[APP, '        chat.stop()', '        void chat']],
  'w232-no-shortcut-list': [[APP, "key === '/') {", "key === '?') {"]],
  'w232-no-close-at-top': [[SETTINGS, '          aria-label="Close Settings"', '          aria-label="Close"']],
  'w232-title-row-taller': [[CSS, '  margin: -4px -8px -4px 0;', '  margin: 0 -8px 0 0;']]
}
const nodeSpecs = {
  'n235-groups-shift': [[COLOUR, "      parts.length > 0 ? `(${parts.join('|')})` : '((?!))',", "      parts.length > 0 ? `(${parts.join('|')})` : '(?!)',"]],
  'n235-not-case-blind': [[COLOUR, '      grammar.keywords.has(grammar.caseBlind ? word.toLowerCase() : word)', '      grammar.keywords.has(word)']],
  'n235-loses-the-end': [[COLOUR, '  plain(text.slice(at))\n', '']]
}

const write = (dir, specs, make) => {
  const full = join(TOOLS, dir)
  mkdirSync(full, { recursive: true })
  for (const [name, edits] of Object.entries(specs)) {
    writeFileSync(join(full, `${name}.json`), JSON.stringify({ label: name, edits: edits.map(([file, from, to]) => ({ file, from, to })), ...make(name) }, null, 2) + '\n')
  }
  console.log(`wrote ${Object.keys(specs).length} specs in ${dir}`)
}
write('specs232w', windowSpecs, (name) => ({
  argv: ['{{TOOLS}}/run-with-app.mjs', 'dev', 'setup-key.mjs,verify-23-2w.mjs', '{{OUT}}/shots', '9222'],
  env: { USER_DATA_DIR: scratch('specs232wnc'), WIPE_USER_DATA: '1', MOCK_PORT: '8867', INSPECT_PORT: '9251', PRESEED_FILE: '', LOG_LABEL: `nc-${name}` }
}))
write('specs235', nodeSpecs, () => ({ argv: ['{{TOOLS}}/verify-23-5.mjs'], env: {} }))
