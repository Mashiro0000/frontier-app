// Writes the negative-control specs for slice 7.6 (New chat, History and Instructions move under the message box; the header stays one row, D-029):
// one sabotage each (two files for the last one), which verify-7-6w.mjs must notice.
// usage: node tools/make-specs76.mjs
//   then: node tools/nc-all.mjs specs76w <names...>     (the real window: opens one window per sabotage)
// Each spec backs up the file, applies its sabotage, runs the suite, and puts the file back (proved by hash).
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { TOOLS } from './paths.mjs'
import { scratch } from './drive.mjs'

const P = '{{REPO}}/src/renderer/src/'
const CSS = P + 'assets/main.css', BAR = P + 'chat/ChatBar.tsx', APP = P + 'App.tsx'
const CHATBAR_BOX = '  max-width: calc(var(--chat-width) + 40px);\n  margin: 0 auto;\n  padding: 0 20px 10px;'
// the two elements of App.tsx that the move concerns, in the order they have now (the chat area, then the bar) and swapped
const CHAT_VIEW = '      <ChatView\n        status={status}\n        chat={chat}\n        conversationId={history.activeId}\n        onOpenSettings={() => setSettingsOpen(true)}\n      />\n'
const CHAT_BAR = '      {/* New chat, History and Instructions live under the message box, not in the header, so the header stays one row (D-029). */}\n      <ChatBar\n        isReplying={chat.isReplying}\n        messageCount={chat.messages.length}\n        instructions={chat.instructions}\n        saveFailed={history.saveError !== null}\n        onNewChat={history.startNew}\n        onOpenHistory={() => setHistoryOpen(true)}\n        onOpenInstructions={() => setInstructionsOpen(true)}\n      />\n'
const BAR_IN_HEADER = '\n        <ChatBar isReplying={chat.isReplying} messageCount={chat.messages.length} instructions={chat.instructions} saveFailed={false} onNewChat={history.startNew} onOpenHistory={() => setHistoryOpen(true)} onOpenInstructions={() => setInstructionsOpen(true)} />'

// name: [[file, from, to], ...]
const win = {
  // the header may wrap again: the widest state (a task chosen, both badges) needs about 870 px of the 846 there are
  'w76-header-may-wrap-again': [[CSS, '@media (min-width: 720px) {\n  .app-header,\n  .app-header-actions {\n    flex-wrap: nowrap;\n  }', '@media (min-width: 720px) {\n  .app-header,\n  .app-header-actions {\n    flex-wrap: wrap;\n  }']],
  // nothing gives way: in one row the controls spill out of the window or over each other
  'w76-menus-do-not-shrink': [[CSS, '    flex: 0 1 auto;\n    min-width: 96px;', '    flex: none;\n    min-width: 96px;']],
  // the menus give way without a floor
  'w76-menus-shrink-below-the-floor': [[CSS, '    min-width: 96px;', '    min-width: 0;']],
  // the bar is not as wide as the message box, so its first button is not lined up with the box
  'w76-bar-not-aligned': [[CSS, CHATBAR_BOX, CHATBAR_BOX.replace('max-width: calc(var(--chat-width) + 40px);', 'max-width: none;')]],
  // the bar cannot wrap: at 280 px the three buttons and the mark spill out of the window
  'w76-bar-does-not-wrap': [[CSS, '.chat-bar {\n  flex: none;\n  display: flex;\n  flex-wrap: wrap;', '.chat-bar {\n  flex: none;\n  display: flex;\n  flex-wrap: nowrap;']],
  // the bar is drawn above everything instead of under the box
  'w76-bar-above-everything': [[CSS, '.chat-bar {\n  flex: none;', '.chat-bar {\n  order: -1;\n  flex: none;']],
  // the bar takes far too much of the chat area
  'w76-bar-too-tall': [[CSS, CHATBAR_BOX, CHATBAR_BOX.replace('padding: 0 20px 10px;', 'padding: 0 20px 250px;')]],
  // History can be opened while a reply is arriving
  'w76-history-enabled-while-replying': [[BAR, "        disabled={isReplying}\n        title={\n          isReplying\n            ? 'History can be opened", "        disabled={false}\n        title={\n          isReplying\n            ? 'History can be opened"]],
  // New chat is on in an empty chat
  'w76-new-chat-ignores-empty': [[BAR, 'disabled={isReplying || messageCount === 0}', 'disabled={isReplying}']],
  // the bar is not a named group
  'w76-bar-is-not-a-group': [[BAR, 'role="group" aria-label="This chat"', 'aria-label="This chat"']],
  // the buttons are in the header too
  'w76-buttons-also-in-the-header': [[APP, '<h1 className="app-title">Frontier App</h1>', '<h1 className="app-title">Frontier App</h1>' + BAR_IN_HEADER]],
  // the bar comes first in the page's order but is drawn last, so what is seen is right and the keyboard order is not
  'w76-bar-first-in-the-tab-order': [[APP, CHAT_VIEW + CHAT_BAR, CHAT_BAR + CHAT_VIEW], [CSS, '.chat-bar {\n  flex: none;', '.chat-bar {\n  order: 99;\n  flex: none;']]
}

const winEnv = (name) => ({ USER_DATA_DIR: scratch('s76nc'), WIPE_USER_DATA: '1', MOCK_PORT: '8796', PRESEED_FILE: '', LOG_LABEL: `nc-${name}` })
const winArgv = ['{{TOOLS}}/run-with-app.mjs', 'dev', 'setup-key.mjs,verify-7-6w.mjs', '{{OUT}}/shots', '9222']
const wdir = join(TOOLS, 'specs76w')
mkdirSync(wdir, { recursive: true })
for (const [name, edits] of Object.entries(win)) {
  writeFileSync(join(wdir, `${name}.json`), JSON.stringify({ label: name, edits: edits.map(([file, from, to]) => ({ file, from, to })), argv: winArgv, env: winEnv(name) }, null, 2) + '\n')
}
console.log(`wrote ${Object.keys(win).length} specs in specs76w`)
