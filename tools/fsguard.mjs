// A guard under the real file system, for every check that runs code which writes, renames or removes (D-043).
//
// Why it exists: on 2026-10-09 a negative control took the "is this path inside the run root?" test out of removeScratch(), and the check handed the function a REAL
// drive root ('A:\'): it removed about 14 GB of the owner's files. A check that exercises a destructive function now installs this FIRST. From then on every call of
// Node's file system API in this process that would make, write, rename, copy to, link or remove something is judged BEFORE it runs, and refused (error.code 'EFSGUARD')
// unless the path is inside a folder the check named:
//   write    folders where things may be made, written, renamed and copied to  (the check's own scratch folder, nothing else)
//   remove   folders where things may be removed. EMPTY unless the owner has allowed removing: then nothing at all can be removed by this process.
// A path is judged twice: as written (made absolute, case-blind, `..` taken out, the long-path prefix taken off) and by where the folder it lies in really is (a junction that
// leads out of an allowed folder is not a way out). A name that the file system reads differently from how it is written (a trailing dot or space, a stream suffix after a
// colon, wildcards) is refused. A folder this near the top of a drive (the drive itself, or one level below it) can never be named as allowed.
//
// NOT watched: programs the check starts (child processes), worker threads, the stream classes made with `new` (fs.WriteStream, fs.Utf8Stream), and file handles that were
// open before the guard was installed.
// The completeness check in verify-fsguard.mjs fails when a Node version brings a function of `fs` that is in neither the guarded list nor the reviewed harmless list.
import fs from 'node:fs'
import { syncBuiltinESMExports } from 'node:module'
import { win32 } from 'node:path'
import { fileURLToPath } from 'node:url'

export const REFUSED = 'EFSGUARD'

// name -> what the call does to its path arguments
export const GUARDED = {
  writeFile: 'write',
  appendFile: 'write',
  mkdir: 'mkdir',
  mkdtemp: 'write',
  mkdtempDisposable: 'disposable', // makes a folder that REMOVES itself when disposed: needs both rights
  truncate: 'write',
  utimes: 'write',
  lutimes: 'write',
  chmod: 'write',
  lchmod: 'write',
  chown: 'write',
  lchown: 'write',
  rm: 'remove',
  rmdir: 'remove',
  unlink: 'remove',
  rename: 'rename',
  copyFile: 'copy',
  cp: 'copy',
  link: 'link',
  symlink: 'symlink',
  open: 'open'
}

const fold = (p) => p.toLowerCase()
const inside = (root, p) => p === root || p.startsWith(root + '\\')

function asText(value) {
  if (typeof value === 'string') return value
  if (Buffer.isBuffer(value)) return value.toString('utf8')
  if (value instanceof URL) return fileURLToPath(value)
  return null // a file descriptor or a file handle: it has no path
}

/** The path made absolute (a relative one is judged against `base`, by default the working folder), or the reason it is refused. */
export function lexical(raw, base = process.cwd()) {
  if (raw === '') return { bad: 'an empty path' }
  if (raw.includes('\0')) return { bad: 'a NUL character in a path' }
  let text = raw.replaceAll('/', '\\').replace(/^\\\\[?.]\\(?=[A-Za-z]:(\\|$))/, '')
  if (/[<>"|?*]/.test(text)) return { bad: 'a wildcard or a character that is not allowed in a name' }
  if (text.indexOf(':', 2) !== -1 || (text.length > 1 && text[1] !== ':' && text.includes(':'))) return { bad: 'a colon where only a drive letter may have one (a stream name)' }
  text = win32.resolve(base, text)
  if (text.split('\\').some((part) => part !== '' && /[. ]$/.test(part))) return { bad: 'a name that ends in a dot or a space (Windows reads it as another name)' }
  return { path: text }
}

/** Where the folder holding `absolute` really is (links followed), with the last name put back. */
function physical(absolute) {
  const parent = win32.dirname(absolute)
  if (parent === absolute) return absolute
  const name = win32.basename(absolute)
  const rest = []
  let head = parent
  for (;;) {
    try {
      return win32.join(fs.realpathSync.native(head), ...rest.reverse(), name)
    } catch {
      const up = win32.dirname(head)
      if (up === head) return absolute
      rest.push(win32.basename(head))
      head = up
    }
  }
}

function rootOf(raw, what) {
  const text = asText(raw)
  const lex = text === null ? { bad: 'not a path' } : lexical(text)
  if (lex.bad) throw new Error(`fsguard: the ${what} folder ${String(raw)} is refused: ${lex.bad}`)
  const parts = lex.path.split('\\').filter(Boolean)
  if (parts.length < 3) throw new Error(`fsguard: the ${what} folder ${lex.path} is too near the top of a drive to be named`)
  return { path: lex.path, lex: fold(lex.path), phys: fold(physical(lex.path)) }
}

const O = fs.constants
function writing(flags) {
  if (flags === undefined || flags === null) return false
  if (typeof flags === 'number') return (flags & (O.O_WRONLY | O.O_RDWR | O.O_CREAT | O.O_APPEND | O.O_TRUNC)) !== 0
  return !/^(rs?|sr)$/.test(String(flags))
}

let installed = null

/**
 * options.write   folders where the check may make, write, rename and copy to (at least one)
 * options.remove  folders where it may remove (each inside a write folder); none by default
 * options.watch   false: only the decision (check()) is made, nothing is patched (for the guard's own pure checks)
 */
export function installFsGuard(options) {
  if (installed !== null) throw new Error('fsguard: it is installed already')
  const writeList = options?.write ?? []
  if (!Array.isArray(writeList) || writeList.length === 0) throw new Error('fsguard: name the folder where the check may write')
  const rules = { write: writeList.map((r) => rootOf(r, 'write')), remove: [] }
  const refusals = []
  const originals = []

  const addRemove = (raw) => {
    const root = rootOf(raw, 'remove')
    if (!rules.write.some((w) => inside(w.lex, root.lex) && inside(w.phys, root.phys))) throw new Error(`fsguard: the remove folder ${root.path} is not inside a write folder`)
    rules.remove.push(root)
  }
  for (const r of options?.remove ?? []) addRemove(r)

  /** null when allowed, else the reason. */
  const check = (op, value, base) => {
    const raw = asText(value)
    if (raw === null) return null
    const lex = lexical(raw, base)
    if (lex.bad) return `${op} of ${JSON.stringify(raw).slice(0, 120)}: ${lex.bad}`
    const roots = op === 'remove' ? rules.remove : rules.write
    const path = fold(lex.path)
    const real = fold(physical(lex.path))
    if (roots.some((r) => inside(r.lex, path) && inside(r.phys, real))) return null
    return `${op} of ${lex.path}: not inside a folder this check may ${op === 'remove' ? 'remove from' : 'write in'}`
  }

  /** True when the path is an ordinary folder that is there (not a link): making it again, with `recursive`, changes nothing. */
  const isFolder = (text) => {
    try {
      const info = fs.lstatSync(win32.resolve(text))
      return info.isDirectory() && !info.isSymbolicLink()
    } catch {
      return false
    }
  }

  // the path arguments of one call, as [op, value, base] (what the call does to each)
  const parts = {
    // "make sure this folder is there" (mkdir with `recursive`) on a folder that is there changes nothing, so it is not a write (the checks' paths.mjs does it at import)
    mkdir: (a) =>
      a[1] !== null && typeof a[1] === 'object' && a[1].recursive === true && asText(a[0]) !== null && isFolder(asText(a[0]))
        ? []
        : [['write', a[0]]],
    write: (a) => [['write', a[0]]],
    remove: (a) => [['remove', a[0]]],
    disposable: (a) => [['write', a[0]], ['remove', a[0]]],
    rename: (a) => [['write', a[0]], ['write', a[1]]],
    copy: (a) => [['write', a[1]]],
    link: (a) => [['write', a[0]], ['write', a[1]]],
    symlink: (a) => [['write', a[1]], ['write', a[0], asText(a[1]) === null ? undefined : win32.dirname(win32.resolve(asText(a[1])))]],
    open: (a) => (writing(a[1]) ? [['write', a[0]]] : [])
  }

  const refuse = (reason, style, args, name) => {
    const error = Object.assign(new Error(`fsguard: refused ${name}: ${reason}`), { code: REFUSED, syscall: name })
    refusals.push({ name, reason })
    if (style === 'promise') return { rejected: Promise.reject(error) }
    if (style === 'callback' && typeof args.at(-1) === 'function') {
      process.nextTick(args.at(-1), error)
      return { rejected: undefined }
    }
    throw error
  }
  const wrap = (original, kind, style, name) =>
    function guarded(...args) {
      for (const [op, value, base] of parts[kind](args)) {
        const reason = check(op, value, base)
        if (reason !== null) return refuse(reason, style, args, name).rejected
      }
      return Reflect.apply(original, this, args)
    }
  const swap = (target, name, kind, style) => {
    const original = target[name]
    if (typeof original !== 'function') return
    originals.push({ target, name, original })
    target[name] = wrap(original, kind, style, name)
  }

  if (options?.watch !== false) {
    for (const [base, kind] of Object.entries(GUARDED)) {
      swap(fs, base, kind, 'callback')
      swap(fs, base + 'Sync', kind, 'sync')
      swap(fs.promises, base, kind, 'promise')
    }
    swap(fs, 'createWriteStream', 'write', 'sync')
    syncBuiltinESMExports()
  }

  installed = {
    rules,
    refusals,
    check,
    /** Another folder where this check may write (a fresh one the check made itself, e.g. outside the scratch root on purpose). */
    allowWrite(raw) {
      rules.write.push(rootOf(raw, 'write'))
    },
    /** Another folder where this check may remove. Only when the owner has allowed it. */
    allowRemove: addRemove,
    patched: originals.map((o) => o.name),
    uninstall() {
      for (const { target, name, original } of originals.reverse()) target[name] = original
      if (options?.watch !== false) syncBuiltinESMExports()
      installed = null
    }
  }
  return installed
}

/** The guard installed now, or null. */
export const currentGuard = () => installed
