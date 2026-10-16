// Slice 16.6 under plain Node (no window): the page of image generation (D-048), as what its source must keep true. The behaviour itself is shown in the real window
// (verify-16-6w.mjs); this suite holds the lines a later change could quietly lose. What it shows:
//   A. the page only asks main: the status store, the dialog and the gallery call window.api.images and nothing else (no fetch, no path, no address, no storage);
//   B. the dialog: the cost shown is main's estimate for the CURRENT choice only, Make waits for it and for a description within the limit, Escape is blocked while busy,
//      Stop asks main, the form exists only while the dialog is open, a made picture goes into the chat;
//   C. the gallery: pictures as data: URLs from main, Use in chat only when the model reads pictures, Delete reloads the list and the count, Escape goes back first;
//   D. Settings and the chat bar: the switch asks main (the box is main's), it cannot be pressed without a key, the button shows only while on, the page's policy.
// Run: node tools/guarded.mjs tools/verify-16-6.mjs      (ONLY=A,C runs some parts)
import { checker } from './cdp.mjs'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { REPO } from './paths.mjs'

const check = checker()
const ONLY = process.env.ONLY ? new Set(process.env.ONLY.split(',')) : null
const guard = async (name, fn) => { if (ONLY && !ONLY.has(name)) return; try { await fn() } catch (error) { check(`${name} did not run to its end: ${String(error?.stack ?? error).slice(0, 500)}`, false) } }
const source = (rel) => readFileSync(join(REPO, rel), 'utf8')
const ST = source('src/renderer/src/images/imageStatus.ts')
const MD = source('src/renderer/src/images/MakeImageDialog.tsx')
const GD = source('src/renderer/src/images/GalleryDialog.tsx')
const IS = source('src/renderer/src/settings/ImagesSection.tsx')
const CB = source('src/renderer/src/chat/ChatBar.tsx')
const AP = source('src/renderer/src/App.tsx')
const SD = source('src/renderer/src/settings/SettingsDialog.tsx')
const FORBIDDEN = /fetch\(|XMLHttpRequest|file:|https?:\/\/|localStorage|sessionStorage|indexedDB|createObjectURL|dangerouslySetInnerHTML|require\(/

// ============ A. the page only asks main ============
await guard('A', async () => {
  for (const [name, text] of [['imageStatus.ts', ST], ['MakeImageDialog.tsx', MD], ['GalleryDialog.tsx', GD], ['ImagesSection.tsx', IS]]) {
    check(`A: ${name} reaches nothing but main (no fetch, address, path, storage or raw HTML)`, !FORBIDDEN.test(text), (text.match(FORBIDDEN) ?? [])[0])
  }
  check('A: the status is read from main (images.status) and a failure keeps what the page knew', /window\.api\.images\.status\(\)\.then\(\s*\(status\) => publish\(status\),\s*\(\) => undefined\s*\)/.test(ST))
  check('A: the status store is one copy read through useSyncExternalStore', /useSyncExternalStore\(subscribe, \(\) => current\)/.test(ST))
  const calls = [...new Set([...`${MD}\n${GD}\n${IS}\n${AP}`.matchAll(/window\.api\.images\s*\.(\w+)\(/g)].map((m) => m[1]))].concat(/window\.api\.images\.status\(\)/.test(ST) ? ['status'] : []).sort().join()
  check('A: the page asks main for estimate, generate, list, picture, remove, reset, saveCopy, setOn, status, stop and useInChat only', calls === 'estimate,generate,list,picture,remove,reset,saveCopy,setOn,status,stop,useInChat', calls)
})

// ============ B. the dialog ============
await guard('B', async () => {
  check('B: an estimate is kept with the choice it was asked for, and shown only for that choice', /const choiceKey = `\$\{modelId\}\|\$\{shape\}\|\$\{quality\}\|\$\{count\}`/.test(MD) && /answered !== null && answered\.key === choiceKey \? answered\.estimate : null/.test(MD))
  check('B: an answer that comes after the choice changed is dropped (live flag)', /if \(live\) setAnswered/.test(MD) && /return \(\) => \{\s*live = false\s*\}/.test(MD))
  const can = MD.match(/const canMake =([\s\S]*?)\n\n/)?.[1] ?? ''
  check('B: Make waits for: not busy, a status, no block, a model, a description, within the limit, an estimate, no refusal', ['!making', 'status !== null', 'blocked === null', 'chosenModel !== null', "trimmed !== ''", '!tooLong', 'estimate !== null', '!refused'].every((part) => can.includes(part)), can)
  check('B: the length limit is the shared one (4,000 characters)', /const tooLong = prompt\.length > IMAGE_LIMITS\.maxPromptChars/.test(MD))
  check('B: make() checks canMake again before it sends', /async function make\(\): Promise<void> \{\s*if \(!canMake \|\|/.test(MD))
  check('B: what is sent is exactly the prompt, model, shape, quality, count and chat', /const ask = \{ prompt, model: chosenModel\.id, shape, quality, count, chat: chatId \}/.test(MD) && /window\.api\.images\.generate\(ask\)/.test(MD))
  check('B: a retired model cannot be chosen', /m\.state !== 'retired'/.test(MD) && /disabled=\{m\.state === 'retired'\}/.test(MD))
  check('B: Escape does not close the dialog while a request is on its way', /if \(busy\.current\) event\.preventDefault\(\)/.test(MD))
  check('B: Stop asks main to stop', /onClick=\{\(\) => void window\.api\.images\.stop\(\)\}/.test(MD))
  check('B: the form exists only while the dialog is open', /\{open && \(\s*<MakeImageForm/.test(MD))
  check('B: a made picture goes into the chat with the ids main gave, then the dialog closes', /onMade\(prompt, \{\s*ids: result\.pictures\.map\(\(p\) => p\.id\)/.test(MD) && /\}\)\s*onDone\(\)\s*\}/.test(MD) && /onMade=\{chat\.addPicture\}/.test(AP))
  check('B: a refusal is shown in words and nothing goes into the chat', /if \(!result\.ok\) \{\s*setError\(result\.error\)\s*return\s*\}/.test(MD))
})

// ============ C. the gallery ============
await guard('C', async () => {
  check('C: a picture large is the data: URL main gave (the page policy allows nothing else)', /src: result\.dataUrl/.test(GD) && /src=\{large\.src\}/.test(GD))
  check('C: Use in chat can be pressed only when the model reads pictures', /disabled=\{busy \|\| large\.src === null \|\| !canAttach\}/.test(GD) && /canAttach=\{chosenModel\?\.imageInput === true\}/.test(AP))
  check('C: Use in chat asks main to make it an attachment, and an answer is adopted or said', /\.useInChat\(id\)\s*\.then\(\(result\) => \(result\.ok \? adopt\(result\.file\) : say\(result\.error\)\)\)/.test(AP))
  check('C: after a delete the list and the count are read again', /setLarge\(null\)\s*reloadImageStatus\(\)\s*load\(\)/.test(GD))
  check('C: Escape goes back to the grid first, and does nothing while busy', /if \(busyRef\.current\) \{\s*event\.preventDefault\(\)\s*return\s*\}/.test(GD) && /event\.preventDefault\(\) \/\/ Escape goes back to the grid first\s*setLarge\(null\)/.test(GD))
  check('C: each opening of the gallery is a fresh one (keyed by the visit)', /key=\{galleryVisit\}/.test(AP) && /setGalleryVisit\(\(n\) => n \+ 1\)/.test(AP))
  check('C: the description is shown as text', !/Markdown/.test(GD))
})

// ============ D. Settings and the chat bar ============
await guard('D', async () => {
  check('D: the switch asks main (setOn); the page cannot answer the box', /window\.api\.images\.setOn\(!status\.on\)/.test(IS))
  check('D: the switch cannot be pressed to ON without an OpenAI key or with a damaged file', /disabled=\{busy \|\| cannotTurnOn\}/.test(IS) && /status\.problem !== null \|\|/.test(IS) && /OpenAI key/.test(IS))
  check('D: Settings shows the Images section', /<ImagesSection key=\{`images:\$\{session\}`\} open=\{open\} \/>/.test(SD))
  check('D: the chat bar shows "Make an image..." only while making images is on', /\{imagesOn && \(/.test(CB) && /imagesOn=\{imageStatus\?\.on === true\}/.test(AP))
  check('D: it cannot be pressed while a reply is coming', /className="chat-button chat-make-image"\s*disabled=\{isReplying\}/.test(CB))
  check("D: the page's policy is unchanged (img-src 'self' data:)", /img-src 'self' data:"/.test(source('src/renderer/index.html')))
})

const ok = check.summary()
process.exit(ok ? 0 : 1)
