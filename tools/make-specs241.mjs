// Writes the negative-control specs for Stage 24 (D-056): one sabotage each, which verify-24-1w (window) must notice.
// usage: node tools/make-specs241.mjs
//   then: node tools/guarded-window-copy.mjs tools/nc-all.mjs specs241w <names...>
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { TOOLS } from './paths.mjs'
import { scratch } from './drive.mjs'

const P = '{{REPO}}/src/renderer/src/'
const APP = P + 'App.tsx', PICKER = P + 'settings/ModelPicker.tsx', SETTINGS = P + 'settings/SettingsDialog.tsx', CSS = P + 'assets/main.css'

const specs = {
  'w241-chooser-in-the-form': [[PICKER, '      {createPortal(', '      {((node: React.ReactNode, _where: Element) => node)(']],
  'w241-typing-page-closes': [[APP, `      if (page.querySelector('textarea:focus, input[type="text"]:focus') !== null) return\n`, '']],
  'w241-sidebar-click-lost': [[APP, "      if (under instanceof Element) under.closest('button')?.click()", '      void under']],
  'w241-details-always-shown': [[CSS, '.settings:not(.settings-details) .settings-more {\n  display: none;', '.settings:not(.settings-details) .settings-more {\n  display: block;']],
  'w241-all-panes-shown': [[SETTINGS, "hidden={pane !== 'general'}", 'hidden={false}']],
  'w241-button-squeezed': [[CSS, '.composer-row .chat-bar {\n  flex: 1 0 auto;', '.composer-row .chat-bar {\n  flex: 1 1 0;']],
  'w241-menu-below-the-plus': [[CSS, '  bottom: calc(anchor(top) + 8px);', '  top: calc(anchor(bottom) + 8px);']]
}

const full = join(TOOLS, 'specs241w')
mkdirSync(full, { recursive: true })
for (const [name, edits] of Object.entries(specs)) {
  writeFileSync(join(full, `${name}.json`), JSON.stringify({
    label: name,
    edits: edits.map(([file, from, to]) => ({ file, from, to })),
    argv: ['{{TOOLS}}/run-with-app.mjs', 'dev', 'setup-key.mjs,verify-24-1w.mjs', '{{OUT}}/shots', '9222'],
    env: { USER_DATA_DIR: scratch('specs241wnc'), WIPE_USER_DATA: '1', MOCK_PORT: '8868', PRESEED_FILE: '', LOG_LABEL: `nc-${name}` }
  }, null, 2) + '\n')
}
console.log(`wrote ${Object.keys(specs).length} specs in specs241w`)
