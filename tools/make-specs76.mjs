// Writes the negative-control specs for verify-7-6w.mjs (slice 7.6, D-029, as the layout of Stage 19 has it, D-051: the header one row beside the
// sidebar, the chat's buttons in the sidebar and in the message box): one sabotage each, which the suite must notice.
// usage: node tools/make-specs76.mjs
//   then: node tools/guarded-window-copy.mjs tools/nc-all.mjs specs76w <names...>     (the real window: opens one window per sabotage)
// Each spec backs up the file, applies its sabotage, runs the suite, and puts the file back (proved by hash).
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { TOOLS } from './paths.mjs'
import { scratch } from './drive.mjs'

const P = '{{REPO}}/src/renderer/src/'
const CSS = P + 'assets/main.css', BAR = P + 'chat/ChatBar.tsx', APP = P + 'App.tsx', SIDE = P + 'sidebar/Sidebar.tsx', COMPOSER = P + 'chat/Composer.tsx'
// name: [[file, from, to], ...]
// (D-052, 20b) w76-header-may-wrap-again, w76-menus-do-not-shrink and w76-menus-shrink-below-the-floor are retired: the menus left the header for the row
// under the box, and the rules they broke are gone; their spec files are kept, marked "retired".
const win = {
  // the menus' row under the box wraps instead of giving way: at its narrowest the menus take two lines
  'w76-menus-wrap': [[CSS, '.composer-menus {\n  display: flex;\n  flex-wrap: nowrap;', '.composer-menus {\n  display: flex;\n  flex-wrap: wrap;']],
  // nothing in the menus' row gives way: at its narrowest they spill out of the window
  'w76-menus-do-not-give-way': [[CSS, '.composer-menus select {\n  flex: 0 1 auto;', '.composer-menus select {\n  flex: none;']],
  // the bar's first button is not at the left of the message box
  'w76-bar-not-aligned': [[CSS, '  gap: 2px;\n  min-width: 0;\n  margin-left: -6px;', '  gap: 2px;\n  min-width: 0;\n  margin-left: 120px;']],
  // the bar cannot wrap: at 280 px its buttons spill out of the box
  'w76-bar-does-not-wrap': [[CSS, '.chat-bar {\n  display: flex;\n  flex: 1;\n  flex-wrap: wrap;', '.chat-bar {\n  display: flex;\n  flex: 1;\n  flex-wrap: nowrap;']],
  // the chat's buttons are drawn above the message box, not in it
  'w76-bar-outside-the-box': [[COMPOSER, '      <div className="composer-inner">\n        {attachments}', '      {toolbar}\n      <div className="composer-inner">\n        {attachments}'], [COMPOSER, '        <div className="composer-row">\n          {toolbar}\n', '        <div className="composer-row">\n']],
  // the header takes far too much of the window
  'w76-header-too-tall': [[CSS, '  gap: 12px;\n  min-height: 48px;', '  gap: 12px;\n  min-height: 220px;']],
  // History can be opened while a reply is arriving
  'w76-history-enabled-while-replying': [[SIDE, "          disabled={isReplying}\n          title={\n            isReplying\n              ? 'History can be opened", "          disabled={false}\n          title={\n            isReplying\n              ? 'History can be opened"]],
  // New chat is on in an empty chat
  'w76-new-chat-ignores-empty': [[SIDE, 'disabled={isReplying || messageCount === 0}', 'disabled={isReplying}']],
  // the bar is not a named group
  'w76-bar-is-not-a-group': [[BAR, 'role="group" aria-label="This chat"', 'aria-label="This chat"']],
  // a button is in the header again
  'w76-button-in-the-header': [[APP, '          <h2 className="chat-title" title={chatTitle}>', '          <button type="button" className="probe-in-header">Settings</button>\n          <h2 className="chat-title" title={chatTitle}>']],
  // Attach... is left out of the keyboard order
  'w76-attach-not-in-the-tab-order': [[BAR, '        className="chat-button chat-attach"\n        disabled={attachDisabled}', '        className="chat-button chat-attach"\n        tabIndex={-1}\n        disabled={attachDisabled}']]
}

const winEnv = (name) => ({ USER_DATA_DIR: scratch('s76nc'), WIPE_USER_DATA: '1', MOCK_PORT: '8796', PRESEED_FILE: '', LOG_LABEL: `nc-${name}` })
const winArgv = ['{{TOOLS}}/run-with-app.mjs', 'dev', 'setup-key.mjs,verify-7-6w.mjs', '{{OUT}}/shots', '9222']
const wdir = join(TOOLS, 'specs76w')
mkdirSync(wdir, { recursive: true })
for (const [name, edits] of Object.entries(win)) {
  writeFileSync(join(wdir, `${name}.json`), JSON.stringify({ label: name, edits: edits.map(([file, from, to]) => ({ file, from, to })), argv: winArgv, env: winEnv(name) }, null, 2) + '\n')
}
console.log(`wrote ${Object.keys(win).length} specs in specs76w`)
