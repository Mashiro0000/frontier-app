// After Stage 8b (6 October 2026): the sentences that carry a count agree with it ("1 chat will be rewritten as a plain file", "left as it is", "1 chat shares an id",
// "instructions of their own"), and the plural sentences are exactly what they were (the window suites check them with 2 to 6 chats). Plain Node, no window:
//  A. the main process's question before going back to plain files (plainQuestion: the system's message box shows it);
//  B. the page's notices after going back to plain files and after a restore (describePlain, describeRestore);
//  C. the restore preview panel itself, rendered by React to text (esbuild turns its JSX into JavaScript first), for 0, 1 and 2 chats.
// Run: node tools/verify-8b-wording.mjs
import './ts-resolve.mjs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { build } from 'esbuild'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { checker } from './cdp.mjs'
import { OUT, REPO } from './paths.mjs'

const check = checker()
// A sabotaged module can make a block throw; that must show as a failed check and a summary line, not as a crashed run (tools/README.md).
const guard = async (name, fn) => { try { await fn() } catch (error) { check(`${name} did not run to its end: ${String(error?.stack ?? error).slice(0, 300)}`, false) } }
const SRC = pathToFileURL(join(REPO, 'src')).href
const show = (value) => JSON.stringify(value)

// ============ A. the question before going back to plain files ============
await guard('A', async () => {
  const { plainQuestion } = await import(`${SRC}/main/chatEncryptionService.ts`)
  const one = plainQuestion({ encrypted: 1, unopened: 0, keyUsable: true })
  check('one chat: "1 chat will be rewritten as a plain file."', one.message === '1 chat will be rewritten as a plain file.', show(one.message))
  check('...and the detail says "able to read it", the rest as before', one.detail === "Anyone who can read the app's data folder will then be able to read it, and every chat you save from now on. Your API keys stay encrypted, and a backup you made is not changed.", show(one.detail))
  const two = plainQuestion({ encrypted: 2, unopened: 0, keyUsable: true })
  check('two chats: the message and the detail are exactly what they were ("plain files", "read them")', two.message === '2 chats will be rewritten as plain files.' && two.detail === "Anyone who can read the app's data folder will then be able to read them, and every chat you save from now on. Your API keys stay encrypted, and a backup you made is not changed.", show(two))
  const left = plainQuestion({ encrypted: 1, unopened: 1, keyUsable: true })
  check('one chat and one file that cannot be opened: both parts agree with their own count', left.message === '1 chat will be rewritten as a plain file.' && left.detail.endsWith(' 1 encrypted file cannot be opened with this key and stays exactly as it is.') && left.detail.includes('able to read it,'), show(left))
  const lost = plainQuestion({ encrypted: 1, unopened: 0, keyUsable: false })
  check('the lost-key question has no count and is unchanged', lost.title === 'Turn encryption off?' && lost.message === 'The key that protects your encrypted chats cannot be read.', show(lost))
})

// ============ B. the page's notices ============
await guard('B', async () => {
  const { describePlain } = await import(`${SRC}/renderer/src/settings/useChatStorage.ts`)
  const status = { choice: 'off', canEncrypt: true, keyUsable: null, plain: 1, encrypted: 0, unreadable: 0, unopened: 0, blocked: null }
  const report = (changed, failed = 0) => ({ changed, already: 0, failed, backup: null })
  check('after going back with one chat: "Rewrote 1 chat as a plain file."', describePlain(report(1), status) === 'Rewrote 1 chat as a plain file. Chats you save from now on are plain files too.', show(describePlain(report(1), status)))
  check('...with two: exactly what it was ("Rewrote 2 chats as plain files.")', describePlain(report(2), status) === 'Rewrote 2 chats as plain files. Chats you save from now on are plain files too.', show(describePlain(report(2), status)))
  check('...with none: unchanged', describePlain(report(0), status) === 'Chats you save from now on are plain files.', show(describePlain(report(0), status)))

  const { describeRestore } = await import(`${SRC}/renderer/src/history/useBackup.ts`)
  const restored = (added, same) => ({ ok: true, added, copies: 0, same, refused: 0, noRoom: 0, failed: 0 })
  check('after a restore with one chat already here: "1 chat already here, left as it is."', describeRestore(restored(0, 1)) === 'Added 0 chats. 1 chat already here, left as it is.', show(describeRestore(restored(0, 1))))
  check('...with three: exactly what it was ("3 chats already here, left as they are.")', describeRestore(restored(2, 3)) === 'Added 2 chats. 3 chats already here, left as they are.', show(describeRestore(restored(2, 3))))
})

// ============ C. the restore preview panel, rendered ============
await guard('C', async () => {
  const outfile = join(OUT, 'verify-8b-wording-panel.mjs')
  await build({
    entryPoints: [join(REPO, 'src/renderer/src/history/RestorePreviewPanel.tsx')],
    bundle: true,
    format: 'esm',
    platform: 'node',
    jsx: 'automatic',
    external: ['react', 'react/jsx-runtime', 'react-dom'],
    outfile,
    logLevel: 'silent'
  })
  const Panel = (await import(pathToFileURL(outfile).href)).default
  const text = (html) => html.replace(/<[^>]+>/g, '').replaceAll('&#x27;', "'").replaceAll('&quot;', '"').replaceAll('&amp;', '&').replace(/\s+/g, ' ').trim()
  const render = (fresh, same, copies, withInstructions) => {
    const preview = { token: 't', fileName: 'chats.jsonl', exportedAt: 0, complete: true, leftOutAtExport: 0, fresh, same, copies, withInstructions, refusedCount: 0, refused: [], room: 100, titles: [] }
    const html = renderToStaticMarkup(createElement(Panel, { preview, disabled: false, onAdd() {}, onDismiss() {} }))
    const facts = /<ul class="backup-preview-facts"[^>]*>(.*?)<\/ul>/s.exec(html)?.[1] ?? ''
    return { facts: [...facts.matchAll(/<li>(.*?)<\/li>/gs)].map((m) => text(m[1])), notice: text(/<p class="history-notice" role="status">(.*?)<\/p>/s.exec(html)?.[1] ?? '') }
  }
  const p1 = render(1, 1, 1, 1)
  check('one of each: "1 chat new, to be added as it is", "1 chat already here, left as it is", "1 chat shares an id ... to be added as a copy"', show(p1.facts) === show(['1 chat new, to be added as it is', '1 chat already here, left as it is', '1 chat shares an id with a different chat that is here, to be added as a copy']), show(p1.facts))
  check('...and "1 of these chats has instructions of its own" (what the window suite checks)', p1.notice.startsWith('1 of these chats has instructions of its own, which are sent to the model with every message of that chat.'), show(p1.notice))
  const p2 = render(2, 2, 2, 2)
  check('two of each: exactly what they were ("as they are", "share an id", "as copies")', show(p2.facts) === show(['2 chats new, to be added as they are', '2 chats already here, left as they are', '2 chats share an id with a different chat that is here, to be added as copies']), show(p2.facts))
  check('...and "2 of these chats have instructions of their own" (it said "of its own")', p2.notice.startsWith('2 of these chats have instructions of their own, which are sent to the model with every message of that chat.'), show(p2.notice))
  const p0 = render(0, 0, 0, 0)
  check('none: the plural, as before, and no instructions notice', show(p0.facts) === show(['0 chats new, to be added as they are', '0 chats already here, left as they are', '0 chats share an id with a different chat that is here, to be added as copies']) && p0.notice === '', show(p0))
})

const passed = check.summary()
process.exit(passed ? 0 : 1)
