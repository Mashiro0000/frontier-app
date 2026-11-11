// Writes the negative-control specs for the side panel (D-057): one sabotage each, which verify-25-1w (window) must notice.
// usage: node tools/make-specs251.mjs
//   then: node tools/guarded-window-copy.mjs tools/nc-all.mjs specs251w <names...>
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { TOOLS } from './paths.mjs'
import { scratch } from './drive.mjs'

const P = '{{REPO}}/src/renderer/src/'
const PANEL = P + 'canvas/CanvasPanel.tsx', APP = P + 'App.tsx'

const specs = {
  // the frame may run scripts: the lock is gone (the page's own policy still stops an inline script, so the suite must see the attribute)
  'w251-frame-unlocked': [[PANEL, 'sandbox=""\n              srcDoc', 'sandbox="allow-scripts allow-same-origin"\n              srcDoc']],
  'w251-keyboard-not-returned': [[APP, 'if (opener instanceof HTMLElement && opener.isConnected) opener.focus()', 'void opener']],
  'w251-panel-outlives-its-chat': [[APP, 'canvas !== null && canvas.chat === chatKey ? canvas : null', 'canvas']],
  'w251-code-opens-again': [[PANEL, '<CanvasContext.Provider value={null}>', '<CanvasContext.Provider value={() => {}}>']]
}

const full = join(TOOLS, 'specs251w')
mkdirSync(full, { recursive: true })
for (const [name, edits] of Object.entries(specs)) {
  writeFileSync(join(full, `${name}.json`), JSON.stringify({
    label: name,
    edits: edits.map(([file, from, to]) => ({ file, from, to })),
    argv: ['{{TOOLS}}/run-with-app.mjs', 'dev', 'setup-key.mjs,verify-25-1w.mjs', '{{OUT}}/shots', '9222'],
    env: { USER_DATA_DIR: scratch('specs251wnc'), WIPE_USER_DATA: '1', MOCK_PORT: '8869', PRESEED_FILE: '', LOG_LABEL: `nc-${name}` }
  }, null, 2) + '\n')
}
console.log(`wrote ${Object.keys(specs).length} specs in specs251w`)
