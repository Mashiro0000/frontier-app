// Writes the negative-control specs for Stage 21.4 (D-053, the box: chips, examples, Enhance, the sizes) and 21.5 (Search chats): one sabotage each, which
// verify-21-4w / verify-21-5w (window) or verify-21-4 / verify-21-5 (Node) must notice.
// usage: node tools/make-specs2145.mjs
//   then: node tools/guarded-window-copy.mjs tools/nc-all.mjs specs214w <names...>   (and specs215w)
//         node tools/nc-all.mjs specs214 <names...>                                   (and specs215)
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { TOOLS } from './paths.mjs'
import { scratch } from './drive.mjs'

const P = '{{REPO}}/src/renderer/src/'
const VIEW = P + 'chat/ChatView.tsx', COMPOSER = P + 'chat/Composer.tsx', SEARCH = P + 'history/SearchDialog.tsx', APP = P + 'App.tsx', CSS = P + 'assets/main.css'
const RULES = '{{REPO}}/src/shared/chatSearch.ts', CHAT = '{{REPO}}/src/main/chat.ts'

const sets = {
  specs214w: {
    suite: 'verify-21-4w.mjs', port: '8857',
    specs: {
      'w214-chips-never': [[VIEW, '      {messages.length === 0 && chips}', '      {false && chips}']],
      'w214-chips-stay': [[VIEW, '      {messages.length === 0 && chips}', '      {chips}']],
      'w214-examples-stand-still': [[COMPOSER, '(n + 1) % examples.length), 4000)', '(n + 1) % examples.length), 400000)']],
      'w214-enhance-sends': [[COMPOSER, '      setText(result.text)', '      onSend(result.text)']],
      'w214-undo-keeps-rewrite': [[COMPOSER, '                  setText(before)', '                  void before']],
      'w214-column-768': [[CSS, '  --chat-width: 800px;', '  --chat-width: 768px;']]
    }
  },
  specs215w: {
    suite: 'verify-21-5w.mjs', port: '8858',
    specs: {
      'w215-enter-does-nothing': [[SEARCH, '            void openHit(shown[0].id)', '            void 0']],
      'w215-no-ctrl-k': [[APP, "event.key.toLowerCase() === 'k') {", "event.key.toLowerCase() === 'q') {"]],
      'w215-not-cleared': [[SEARCH, "    setQuery('')\n", '']],
      'w215-oldest-first': [[RULES, 'hits.sort((a, b) => b.updatedAt - a.updatedAt)', 'hits.sort((a, b) => a.updatedAt - b.updatedAt)']],
      'w215-title-only': [[RULES, "    const all = `${chat.title}\\n${texts.join('\\n')}`.toLowerCase()", '    const all = `${chat.title}`.toLowerCase()']]
    }
  }
}
const node = {
  specs214: {
    suite: 'verify-21-4.mjs',
    specs: {
      'n214-enhance-gets-tools': [[CHAT, '      toolsContext === undefined || enhancing', '      toolsContext === undefined']],
      'n214-enhance-takes-a-project': [['{{REPO}}/src/shared/validate.ts', '      projectId !== undefined ||\n', '']]
    }
  },
  specs215: {
    suite: 'verify-21-5.mjs',
    specs: {
      'n215-title-only': [[RULES, "    const all = `${chat.title}\\n${texts.join('\\n')}`.toLowerCase()", '    const all = `${chat.title}`.toLowerCase()']],
      'n215-no-cap': [[RULES, '.slice(0, SEARCH_LIMITS.maxResults)', '']],
      'n215-long-query': [[RULES, 'input.length > SEARCH_LIMITS.maxQueryChars', 'input.length > 100000']]
    }
  }
}

for (const [dir, { suite, port, specs }] of Object.entries(sets)) {
  const wdir = join(TOOLS, dir)
  mkdirSync(wdir, { recursive: true })
  for (const [name, edits] of Object.entries(specs)) {
    const env = { USER_DATA_DIR: scratch(`${dir}nc`), WIPE_USER_DATA: '1', MOCK_PORT: port, PRESEED_FILE: '', LOG_LABEL: `nc-${name}` }
    writeFileSync(join(wdir, `${name}.json`), JSON.stringify({ label: name, edits: edits.map(([file, from, to]) => ({ file, from, to })), argv: ['{{TOOLS}}/run-with-app.mjs', 'dev', `setup-key.mjs,${suite}`, '{{OUT}}/shots', '9222'], env }, null, 2) + '\n')
  }
  console.log(`wrote ${Object.keys(specs).length} specs in ${dir}`)
}
for (const [dir, { suite, specs }] of Object.entries(node)) {
  const ndir = join(TOOLS, dir)
  mkdirSync(ndir, { recursive: true })
  for (const [name, edits] of Object.entries(specs)) {
    writeFileSync(join(ndir, `${name}.json`), JSON.stringify({ label: name, edits: edits.map(([file, from, to]) => ({ file, from, to })), argv: [`{{TOOLS}}/${suite}`], env: {} }, null, 2) + '\n')
  }
  console.log(`wrote ${Object.keys(specs).length} specs in ${dir}`)
}
