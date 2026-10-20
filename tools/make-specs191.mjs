// Writes the negative-control specs for Stage 19 (D-051, the new look): one sabotage each, which verify-19-1w.mjs must notice.
// usage: node tools/make-specs191.mjs
//   then: node tools/guarded-window-copy.mjs tools/nc-all.mjs specs191w <names...>     (the real window: one window per sabotage)
// Each spec backs up the file, applies its sabotage, runs the suite, and puts the file back (proved by hash).
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { TOOLS } from './paths.mjs'
import { scratch } from './drive.mjs'

const P = '{{REPO}}/src/renderer/src/'
const CSS = P + 'assets/main.css', BASE = P + 'assets/base.css', LOOK = P + 'appearance.ts', SIDE = P + 'sidebar/Sidebar.tsx'
const COMPOSER = P + 'chat/Composer.tsx', SETTINGS = P + 'settings/SettingsDialog.tsx'

// name: [[file, from, to], ...]
const win = {
  // a fresh profile starts light
  'w191-default-light': [[LOOK, "let theme: Theme = read(THEME_KEY) === 'light' ? 'light' : 'dark'", "let theme: Theme = read(THEME_KEY) === 'dark' ? 'dark' : 'light'"]],
  // the theme is not kept: a reload starts dark again
  'w191-theme-not-kept': [[LOOK, '  theme = next\n  write(THEME_KEY, next)\n', '  theme = next\n']],
  // the rail is not kept
  'w191-rail-not-kept': [[LOOK, "  rail = next\n  write(RAIL_KEY, next ? 'rail' : 'open')\n", '  rail = next\n']],
  // the rail shows the labels and the list of chats (its rules never apply)
  'w191-rail-rules-never-apply': [[CSS, '@container sidebar (max-width: 120px) {', '@container sidebar (max-width: 10px) {']],
  // a narrow window keeps the open sidebar
  'w191-narrow-keeps-the-sidebar': [[CSS, '@media (max-width: 719px) {\n  .app {\n    --sidebar-width: var(--rail-width);', '@media (max-width: 719px) {\n  .app {\n    --sidebar-width: 248px;']],
  // the saved chats can be opened while a reply is arriving
  'w191-chats-open-while-replying': [[SIDE, 'disabled={isReplying || opening}', 'disabled={opening}']],
  // New chat can be pressed while a reply is arriving
  'w191-new-chat-while-replying': [[SIDE, 'disabled={isReplying || messageCount === 0}', 'disabled={messageCount === 0}']],
  // the chat's buttons are drawn above the message box, not in it
  'w191-bar-outside-the-box': [[COMPOSER, '      <div className="composer-inner">\n        {attachments}', '      {toolbar}\n      <div className="composer-inner">\n        {attachments}'], [COMPOSER, '        <div className="composer-row">\n          {toolbar}\n', '        <div className="composer-row">\n']],
  // the muted text of the dark theme is too faint to read
  'w191-dark-muted-too-faint': [[BASE, '  --color-text-muted: #9ba1b4; /* 7.4:1 on the window */', '  --color-text-muted: #4a4f60; /* 7.4:1 on the window */']],
  // the edge of a control in the light theme cannot be seen
  'w191-light-edges-too-faint': [[BASE, '  --color-input-border: #82879b; /* 3.3:1 on the window, 3.6:1 on white */', '  --color-input-border: #c4c7d4; /* 3.3:1 on the window, 3.6:1 on white */']],
  // Settings jumps ahead in the keyboard order
  'w191-tabindex-on-settings': [[SIDE, '          className="header-button sidebar-item"\n          title="Settings"', '          className="header-button sidebar-item"\n          tabIndex={1}\n          title="Settings"']],
  // the chat's title squeezes the menus at the default window instead of giving way
  'w191-title-always-shown': [[CSS, '@container main (max-width: 699px) {\n  .chat-title {\n    display: none;', '@container main (max-width: 699px) {\n  .chat-title {\n    display: block;']],
  // Settings has no Appearance section
  'w191-no-appearance-section': [[SETTINGS, '      <AppearanceSection />\n', '']],
  // the rail's toggle says the sidebar is open when it is not
  'w191-toggle-always-expanded': [[SIDE, 'aria-expanded={!rail}', 'aria-expanded={true}']]
}

const winEnv = (name) => ({ USER_DATA_DIR: scratch('s191nc'), WIPE_USER_DATA: '1', MOCK_PORT: '8796', PRESEED_FILE: '', LOG_LABEL: `nc-${name}` })
const winArgv = ['{{TOOLS}}/run-with-app.mjs', 'dev', 'setup-key.mjs,verify-19-1w.mjs', '{{OUT}}/shots', '9222']
const wdir = join(TOOLS, 'specs191w')
mkdirSync(wdir, { recursive: true })
for (const [name, edits] of Object.entries(win)) {
  writeFileSync(join(wdir, `${name}.json`), JSON.stringify({ label: name, edits: edits.map(([file, from, to]) => ({ file, from, to })), argv: winArgv, env: winEnv(name) }, null, 2) + '\n')
}
console.log(`wrote ${Object.keys(win).length} specs in specs191w`)
