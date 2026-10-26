// Writes the negative-control specs for Stage 20 (D-052, the layout from ChatGPT and Claude): one sabotage each, which verify-20-1w.mjs must notice.
// usage: node tools/make-specs201.mjs
//   then: node tools/guarded-window-copy.mjs tools/nc-all.mjs specs201w <names...>     (the real window: one window per sabotage)
// Each spec backs up the file, applies its sabotage, runs the suite, and puts the file back (proved by hash).
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { TOOLS } from './paths.mjs'
import { scratch } from './drive.mjs'

const P = '{{REPO}}/src/renderer/src/'
const CSS = P + 'assets/main.css', BASE = P + 'assets/base.css', VIEW = P + 'chat/ChatView.tsx', SETTINGS = P + 'settings/SettingsDialog.tsx'

// name: [[file, from, to], ...]
const win = {
  // an empty chat is never marked: the box stays at the foot
  'w201-empty-never-marked': [[VIEW, "className={messages.length === 0 ? 'chat chat-empty' : 'chat'}", 'className="chat"']],
  // the mark stays after the first message: the box stays in the middle
  'w201-empty-always-marked': [[VIEW, "className={messages.length === 0 ? 'chat chat-empty' : 'chat'}", 'className="chat chat-empty"']],
  // the empty chat's layout sends the box to the foot anyway
  'w201-empty-box-at-foot': [[CSS, '.chat-empty {\n  justify-content: center;', '.chat-empty {\n  justify-content: flex-end;']],
  // the note under the box is gone
  'w201-no-footnote': [[VIEW, '      <p className="chat-footnote">Models can make mistakes. Check what matters.</p>\n', '']],
  // (20b: Claude's layout measured) the title is centred again, not at the left
  'w201-title-centred': [[CSS, '  font-weight: 500;\n  white-space: nowrap;\n  text-overflow: ellipsis;\n  color: var(--color-text);\n}', '  font-weight: 500;\n  text-align: center;\n  white-space: nowrap;\n  text-overflow: ellipsis;\n  color: var(--color-text);\n}']],
  // the menus are drawn above the message box, not under it
  'w201-menus-above-the-box': [[VIEW, '        {menus}\n      </div>', '      </div>'], [VIEW, '      <Composer\n', '      {menus}\n      <Composer\n']],
  // the note and the menus are never side by side
  'w201-note-never-beside-menus': [[CSS, '  justify-content: space-between;\n  gap: 0 12px;', '  flex-direction: column;\n  justify-content: space-between;\n  gap: 0 12px;']],
  // the greeting is in the sans-serif of the app again
  'w201-greeting-sans': [[CSS, "  font-family: Georgia, 'Times New Roman', serif;\n", '']],
  // the model's name gives way first
  'w201-model-shrinks-first': [[CSS, '.composer-menus .header-select {\n  flex-shrink: 0;', '.composer-menus .header-select {\n  flex-shrink: 6;']],
  // the menus have their boxes back
  'w201-menus-boxed': [[CSS, '  appearance: none;\n  background: transparent var(--chevron) no-repeat right 8px center / 14px;\n  border: 0;', '  appearance: none;\n  background: transparent var(--chevron) no-repeat right 8px center / 14px;\n  border: 1px solid var(--color-input-border);']],
  // the menus are as wide as their longest choice
  'w201-menus-full-width': [[CSS, '  field-sizing: content; /* as wide as the choice shown, not as the longest choice */\n', '']],
  // the model's name is as muted as the other menus
  'w201-model-muted': [[CSS, '.header-select {\n  font-weight: 600;\n  color: var(--color-text);\n}', '.header-select {\n  font-weight: 600;\n  color: var(--color-text-muted);\n}']],
  // New chat is a filled button again
  'w201-new-chat-filled': [[CSS, '  text-align: left;\n  color: var(--color-text);\n  background: transparent;\n  border: 0;\n  border-radius: 10px;\n  cursor: pointer;\n}\n\n.sidebar-new .icon {', '  text-align: left;\n  color: var(--color-text);\n  background: var(--gradient);\n  border: 0;\n  border-radius: 10px;\n  cursor: pointer;\n}\n\n.sidebar-new .icon {']],
  // the sidebar keeps its old width
  'w201-sidebar-old-width': [[CSS, '  --sidebar-width: 260px;', '  --sidebar-width: 248px;']],
  // the person's bubble gets its pointed corner back
  'w201-bubble-corner': [[CSS, '.message-user .bubble {\n  color: var(--color-text);\n  background: var(--color-user-bubble);\n}', '.message-user .bubble {\n  color: var(--color-text);\n  background: var(--color-user-bubble);\n  border-bottom-right-radius: 6px;\n}']],
  // the text of messages is the controls' size again
  'w201-message-text-15': [[CSS, '  padding: 10px 18px;\n  font-size: 16px;', '  padding: 10px 18px;\n  font-size: 15px;']],
  // the gradient dot is back before the model's name
  'w201-dot-back': [[CSS, '/* "Stopped" / error line under a message */', ".message-model::before {\n  content: '';\n  width: 10px;\n  height: 10px;\n  background: var(--gradient);\n}\n\n/* \"Stopped\" / error line under a message */"]],
  // the column is wider than 768 px
  'w201-column-wider': [[CSS, '  --chat-width: 768px;', '  --chat-width: 860px;']],
  // the message box is too faint to read on
  'w201-composer-low-contrast': [[BASE, '  --color-composer: #303030; /* the message box */', '  --color-composer: #6a6a6a; /* the message box */']],
  // Settings lists only nine sections
  'w201-nav-misses-one': [[SETTINGS, "  'Voice',\n", '']],
  // an entry goes nowhere
  'w201-nav-goes-nowhere': [[SETTINGS, "    target?.scrollIntoView({ block: 'start' })", '    void target']],
  // the list scrolls away with the page
  'w201-nav-not-sticky': [[CSS, '.settings-nav {\n  position: sticky;', '.settings-nav {\n  position: static;']],
  // Settings scrolls sideways
  'w201-settings-sideways': [[CSS, '  grid-template-columns: 180px minmax(0, 1fr);', '  grid-template-columns: 180px 900px;']],
  // a narrow window keeps the list
  'w201-narrow-keeps-nav': [[CSS, '  .settings-nav {\n    display: none;\n  }', '  .settings-nav {\n    display: flex;\n  }']]
}

const winEnv = (name) => ({ USER_DATA_DIR: scratch('s201nc'), WIPE_USER_DATA: '1', MOCK_PORT: '8796', PRESEED_FILE: '', LOG_LABEL: `nc-${name}` })
const winArgv = ['{{TOOLS}}/run-with-app.mjs', 'dev', 'setup-key.mjs,verify-20-1w.mjs', '{{OUT}}/shots', '9222']
const wdir = join(TOOLS, 'specs201w')
mkdirSync(wdir, { recursive: true })
for (const [name, edits] of Object.entries(win)) {
  writeFileSync(join(wdir, `${name}.json`), JSON.stringify({ label: name, edits: edits.map(([file, from, to]) => ({ file, from, to })), argv: winArgv, env: winEnv(name) }, null, 2) + '\n')
}
console.log(`wrote ${Object.keys(win).length} specs in specs201w`)
