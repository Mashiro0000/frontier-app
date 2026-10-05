// Helpers for the Stage 8b suites (the backup file, restoring, the store's `add`). Test tooling only.
import { REPO_URL } from './paths.mjs'
import './ts-resolve.mjs'
import { promises as fsp } from 'node:fs'
import { createHash } from 'node:crypto'
import { join } from 'node:path'

export const SRC = `${REPO_URL}/src`
export const backup = await import(`${SRC}/main/backup.ts`)
export const service = await import(`${SRC}/main/backupService.ts`)
export const storeMod = await import(`${SRC}/main/conversationStore.ts`)
export const ipc = await import(`${SRC}/shared/ipc.ts`)
export const validate = await import(`${SRC}/shared/validate.ts`)

export const { titleFor, createConversationStore } = storeMod
export const { HISTORY_LIMITS } = ipc

export const NOW = Date.UTC(2026, 9, 5, 12, 0, 0)
export const same = (a, b) => JSON.stringify(a) === JSON.stringify(b)
export const sha256 = (text) => createHash('sha256').update(text, 'utf8').digest('hex')
export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
export const msg = (role, content, status = 'done', extra = {}) => ({ role, content, status, ...extra })

// A deterministic id from a number: lower-case UUID spelling, so a run can be compared with itself.
export const idOf = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`

// What a person might have written. Built with fromCodePoint, never a backslash-u escape: the tools that write this file decode those.
const CJK = String.fromCodePoint(0x65e5, 0x672c, 0x8a9e)
const SMILE = String.fromCodePoint(0x1f600)
const HEBREW = String.fromCodePoint(0x5d0, 0x5d1, 0x5d2)
const LONE_SURROGATE = String.fromCharCode(0xd800)
const NUL = String.fromCharCode(0)
export const TEXTS = [
  'plain text',
  `quotes "double" and 'single' and \`tick\``,
  'line one\nline two\r\nline three\n',
  `unicode: ${CJK} ${SMILE} ${HEBREW}`,
  'backslashes \\ \\n \\\\ and {"json":[1,2,3]} and </script>',
  'looks like a backup line: {"n":1,"sha256":"00","chat":{}} and {"end":true,"count":0,"leftOut":0}',
  `control ${NUL} characters ${String.fromCharCode(1, 31)} and a lone surrogate ${LONE_SURROGATE} here`,
  'x'.repeat(3000)
]

/** A chat of the current shape (version 3), with its own dates and, for every third one, instructions. */
export function makeChat(i, extra = {}) {
  const messages = [
    msg('user', `Question ${i}: ${TEXTS[i % TEXTS.length]}`),
    msg('assistant', `Answer ${i}: ${TEXTS[(i + 3) % TEXTS.length]}`, 'done', { provider: 'anthropic', model: 'claude-opus-5-5' })
  ]
  if (i % 4 === 1) messages.push(msg('user', 'And then?'), msg('assistant', '', 'error', { error: 'The provider said no.', provider: 'openai', model: 'gpt-6.1-sol' }))
  if (i % 5 === 2) messages.push(msg('user', 'Again'), msg('assistant', 'half a reply', 'stopped', { provider: 'anthropic', model: null }))
  const createdAt = Date.UTC(2026, 0, 1) + i * 3_600_000
  return {
    id: idOf(i),
    title: titleFor(messages),
    createdAt,
    updatedAt: createdAt + 1234 + i,
    instructions: i % 3 === 0 ? `Be brief, chat ${i}. ${SMILE}` : '',
    messages,
    ...extra
  }
}

/** The text of a chat file as the app writes it. */
export const fileText = (chat, version = 3) => JSON.stringify({ version, ...chat })

export async function seedFile(dir, chat, text = fileText(chat)) {
  await fsp.mkdir(dir, { recursive: true })
  await fsp.writeFile(join(dir, `${chat.id}.json`), text)
}

/** Every chat in a store, loaded, sorted by id (so two stores can be compared whatever the order of the list). */
export async function everything(store) {
  const { conversations } = await store.list()
  const loaded = await Promise.all(conversations.map(async (one) => (await store.load(one.id)).conversation))
  return loaded.sort((a, b) => (a.id < b.id ? -1 : 1))
}

/** The `BackupSource` the service builds from a store. */
export const sourceOf = (store, ids, leftOut = 0) => ({
  ids,
  leftOut,
  load: async (id) => {
    const loaded = await store.load(id)
    return loaded.ok ? loaded.conversation : null
  }
})

/** One backup line, with the right checksum for whatever `chat` is (so only the strict reader can refuse it). */
export function lineFor(n, chat, tamper = (x) => x) {
  const text = typeof chat === 'string' ? chat : JSON.stringify(chat)
  const hash = sha256(JSON.stringify(JSON.parse(text)))
  return tamper(`{"n":${n},"sha256":"${hash}","chat":${text}}`)
}
export const headerLine = (exportedAt = NOW) => JSON.stringify({ format: backup.BACKUP_FORMAT, version: backup.BACKUP_VERSION, exportedAt })
export const trailerLine = (count, leftOut = 0) => JSON.stringify({ end: true, count, leftOut })

/** Reads a backup file and collects what comes out of it. */
export async function readAll(path) {
  const chats = []
  const hashes = []
  const read = await backup.readBackup(path, (chat, hash, line) => {
    chats.push(chat)
    hashes.push({ hash, line })
  })
  return { read, chats, hashes }
}

/** A snapshot of a folder: every file's name, size and checksum, to prove nothing in it changed. */
export async function snapshot(dir) {
  let names = []
  try {
    names = (await fsp.readdir(dir)).sort()
  } catch {
    return 'no folder'
  }
  const entries = []
  for (const name of names) {
    const info = await fsp.stat(join(dir, name))
    entries.push(info.isFile() ? `${name}:${info.size}:${sha256((await fsp.readFile(join(dir, name))).toString('latin1'))}` : `${name}:dir`)
  }
  return entries.join('|')
}

/** The two system dialogs, played by the test: a queue of answers per kind (a path, or null for "the person closed it"), and a record of every ask. */
export function fakePickers() {
  const answers = { save: [], open: [] }
  const calls = []
  let hold = null
  return {
    answers,
    calls,
    /** The next ask waits until `release` is called (to look at the service while a dialog is open). */
    holdNext() {
      let release
      hold = new Promise((resolve) => (release = resolve))
      return release
    },
    pickers: {
      savePath: async (owner, suggestedName) => {
        calls.push({ kind: 'save', owner, suggestedName })
        if (hold) { const h = hold; hold = null; await h }
        return answers.save.length ? answers.save.shift() : null
      },
      openPath: async (owner) => {
        calls.push({ kind: 'open', owner })
        if (hold) { const h = hold; hold = null; await h }
        return answers.open.length ? answers.open.shift() : null
      }
    }
  }
}

/** Patches properties of fs.promises for the length of `fn`, and puts them back (a fault that is not undone would poison the next check). */
export async function withFaults(patchOf, fn) {
  const names = ['open', 'copyFile', 'rm', 'writeFile', 'readFile']
  const saved = Object.fromEntries(names.map((name) => [name, fsp[name]]))
  Object.assign(fsp, patchOf(saved))
  try {
    return await fn()
  } finally {
    Object.assign(fsp, saved)
  }
}

/** Wraps what fs.promises.open gives back so that one handle method can be made to misbehave (only for a path that ends with `suffix`). */
export function breakHandle(saved, suffix, methodName, replacement) {
  return {
    open: async (path, ...rest) => {
      const handle = await saved.open(path, ...rest)
      if (String(path).endsWith(suffix)) {
        const original = handle[methodName].bind(handle)
        handle[methodName] = (...args) => replacement(original, ...args)
      }
      return handle
    }
  }
}
