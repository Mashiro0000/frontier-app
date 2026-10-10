// Writes the negative-control specs for the file-system guard (tools/fsguard.mjs, D-043): one sabotage each, which tools/verify-fsguard.mjs must notice.
// usage: node tools/make-specs-fsguard.mjs
//   then: node tools/check-specs.mjs                          (dry check: every sabotage text occurs exactly once)
//         node tools/nc-all.mjs specsfsguard <names...>       (each runs verify-fsguard.mjs with the guard sabotaged)
// Nothing here removes anything: verify-fsguard.mjs aims every removing call at a name that does not exist.
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { TOOLS } from './paths.mjs'

const G = '{{TOOLS}}/fsguard.mjs'
const r = String.raw // the texts below hold backslashes exactly as they stand in fsguard.mjs

// name: [from, to]
const controls = {
  // ----- the decision -----
  gBoundary: [r`p.startsWith(root + '\\')`, 'p.startsWith(root)'],
  gFold: ['const fold = (p) => p.toLowerCase()', 'const fold = (p) => p'],
  gPhysical: ['if (roots.some((r) => inside(r.lex, path) && inside(r.phys, real))) return null', 'if (roots.some((r) => inside(r.lex, path))) return null'],
  gRealpath: ['return win32.join(fs.realpathSync.native(head), ...rest.reverse(), name)', 'return absolute'],
  gPrefix: [r`.replace(/^\\\\[?.]\\(?=[A-Za-z]:(\\|$))/, '')`, ''],
  gDots: [r`/[. ]$/.test(part)`, 'false'],
  gStream: ["text.indexOf(':', 2) !== -1 ||", ''],
  gWild: [r`if (/[<>"|?*]/.test(text))`, 'if (false)'],
  gNul: [r`if (raw.includes('\0')) return { bad: 'a NUL character in a path' }`, ''],
  gRemoveRoots: ["const roots = op === 'remove' ? rules.remove : rules.write", 'const roots = rules.write'],
  gNonPath: ['if (raw === null) return null\n    const lex', "if (raw === null) return 'x'\n    const lex"],
  // ----- what each kind of call checks -----
  gRename: ["rename: (a) => [['write', a[0]], ['write', a[1]]],", "rename: (a) => [['write', a[1]]],"],
  gCopy: ["copy: (a) => [['write', a[1]]],", "copy: (a) => [['write', a[0]]],"],
  gLink: ["link: (a) => [['write', a[0]], ['write', a[1]]],", "link: (a) => [['write', a[1]]],"],
  gSymlinkTarget: [", ['write', a[0], asText(a[1]) === null ? undefined : win32.dirname(win32.resolve(asText(a[1])))]", ''],
  gSymlinkBase: ['asText(a[1]) === null ? undefined : win32.dirname(win32.resolve(asText(a[1])))', 'undefined'],
  gDisposable: ["disposable: (a) => [['write', a[0]], ['remove', a[0]]],", "disposable: (a) => [['write', a[0]]],"],
  gOpenStr: ['return !/^(rs?|sr)$/.test(String(flags))', 'return false'],
  gOpenNum: ['return (flags & (O.O_WRONLY | O.O_RDWR | O.O_CREAT | O.O_APPEND | O.O_TRUNC)) !== 0', 'return false'],
  // ----- which functions are patched -----
  gNoRm: ["  rm: 'remove',\n", ''],
  gNoUnlink: ["  unlink: 'remove',\n", ''],
  gNoCp: ["  cp: 'copy',\n", ''],
  gNoLink: ["  link: 'link',\n", ''],
  gNoOpen: ["  symlink: 'symlink',\n  open: 'open'\n", "  symlink: 'symlink'\n"],
  gNoMkdtemp: ["  mkdtemp: 'write',\n", ''],
  // making sure a folder is there changes nothing, so it is not a write: but only for a folder that is there, only with `recursive`
  gMkdirAny: ["a[1].recursive === true && asText(a[0]) !== null && isFolder(asText(a[0]))", "a[1].recursive === true && asText(a[0]) !== null && true"],
  gMkdirFlag: ["&& a[1].recursive === true &&", "&& true &&"],
  gMkdirNoExemption: ["a[1] !== null && typeof a[1] === 'object' && a[1].recursive === true && asText(a[0]) !== null && isFolder(asText(a[0]))", 'false'],
  gPromises: ["swap(fs.promises, base, kind, 'promise')", ''],
  gCallback: ["swap(fs, base, kind, 'callback')", ''],
  gSync: ["swap(fs, base + 'Sync', kind, 'sync')", ''],
  gStreamWrap: ["swap(fs, 'createWriteStream', 'write', 'sync')\n    syncBuiltinESMExports()", 'syncBuiltinESMExports()'],
  gEsmSync: ["swap(fs, 'createWriteStream', 'write', 'sync')\n    syncBuiltinESMExports()", "swap(fs, 'createWriteStream', 'write', 'sync')"],
  // ----- naming the folders, and putting things back -----
  gDepth: ['if (parts.length < 3) throw new Error(', 'if (parts.length < 1) throw new Error('],
  gRemoveInside: ['if (!anywhere && !rules.write.some((w) => inside(w.lex, root.lex) && inside(w.phys, root.phys))) throw', 'if (false) throw'],
  gRemoveAnywhere: ['if (!anywhere && !rules.write.some((w) => inside(w.lex, root.lex) && inside(w.phys, root.phys))) throw', 'if (!rules.write.some((w) => inside(w.lex, root.lex) && inside(w.phys, root.phys))) throw'],
  // ----- the window-run options (writeAnywhere, removePatterns) -----
  gAnywhereRemove: ["if (op !== 'remove' && anywhere) return null", "if (anywhere) return null"],
  gAnywhereAlways: ["if (op !== 'remove' && anywhere) return null", 'if (op !== "remove") return null'],
  gAnywhereFlag: ["const anywhere = options?.writeAnywhere === true", 'const anywhere = true'],
  gAnywhereNeedsRoot: ["if (!anywhere && (!Array.isArray(writeList) || writeList.length === 0))", 'if (false)'],
  // (not here: `path === p.base.lex` in patternAllows is a second wall behind the last containment test, so taking it out changes nothing: an equivalent mutant)
  gPatternName: ['if (!p.name.test(first)) return false', ''],
  // (10 October 2026: the real path is not compared any more, because a packaged app's AppData is redirected by Windows; a link on the way is looked for name by name)
  gPatternReal: ['return linkFree(p.base.path, written)', 'return true'],
  gPatternLinkLast: ['if (info.isSymbolicLink() && i < names.length - 1) return false', 'if (info.isSymbolicLink()) return false'],
  gPatternFirst: ["const first = written.slice(p.base.path.length + 1).split('\\\\')[0]", 'const first = written.slice(p.base.path.length + 1)'],
  gPatternChecked: ["if (op === 'remove' && patternAllows(lex.path, path)) return null", "if (patternAllows(lex.path, path)) return null"],
  gPatternRegex: ["if (!(pattern?.name instanceof RegExp)) throw new Error('fsguard: a remove pattern needs a name (a regular expression)')", ''],
  gUninstall: ['for (const { target, name, original } of originals.reverse()) target[name] = original', 'for (const x of []) void x'],
  gTwice: ["if (installed !== null) throw new Error('fsguard: it is installed already')", ''],
  gCode: ['{ code: REFUSED, syscall: name }', "{ code: 'EPERM', syscall: name }"]
}

mkdirSync(join(TOOLS, 'specsfsguard'), { recursive: true })
for (const [name, [from, to]] of Object.entries(controls)) {
  const spec = { label: `nfsg-${name}`, edits: [{ file: G.replace('{{TOOLS}}', '{{REPO}}/tools'), from, to }], argv: ['{{TOOLS}}/verify-fsguard.mjs'], env: {}, timeoutMs: 120000 }
  writeFileSync(join(TOOLS, 'specsfsguard', `nfsg-${name}.json`), JSON.stringify(spec, null, 2) + '\n')
}
console.log(`wrote ${Object.keys(controls).length} specs in specsfsguard`)
