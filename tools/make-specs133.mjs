// Writes the negative-control specs for slice 13.3 (the scratch copy, D-043): one sabotage each of src/main/scratchCopy.ts, which verify-13-3.mjs must notice.
// usage: node tools/make-specs133.mjs
//   then: node tools/check-specs.mjs                   (dry check: every sabotage text occurs exactly once)
//         node tools/nc-all.mjs specs133 <names...>    (each runs only the parts of verify-13-3.mjs that can notice it, ONLY=...)
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { TOOLS } from './paths.mjs'

const SC = '{{REPO}}/src/main/scratchCopy.ts'
const e = (from, to) => ({ file: SC, from, to })

// name: [edits, parts of verify-13-3.mjs that run]
const controls = {
  // ----- what is copied -----
  mkLink: [[e("      if (entry.isSymbolicLink()) {\n        leave(here, 'link', folder)", "      if (false) {\n        leave(here, 'link', folder)")], 'A'],
  mkFollowLinks: [[e("      if (entry.isSymbolicLink()) {\n        leave(here, 'link', folder)", "      if (false) {\n        leave(here, 'link', folder)"), e('      const folder = entry.isDirectory()\n', '      const folder = entry.isDirectory() || entry.isSymbolicLink()\n')], 'A'],
  mkHard: [[e('      if (info.nlink > 1) {', '      if (false) {')], 'A'],
  mkNever: [[e("      if (kind === 'never') {", '      if (false) {')], 'A'],
  mkOne: [[e("      if (kind === 'one-by-one') {", '      if (false) {')], 'A'],
  mkPrefix: [[e('const kind = classifyNames([...prefix, ...here]).fileClass', 'const kind = classifyNames([...here]).fileClass')], 'A'],
  mkReserved: [[e("      if (rel.length === 0 && entry.name.toLowerCase() === SCRATCH.reserved) {\n        leave", "      if (rel.length === 0 && entry.name.toLowerCase() === 'x') {\n        leave")], 'A'],
  mkLong: [[e("      if (here.join('/').length > SCRATCH.maxPathChars) {", '      if (false) {')], 'A'],
  mkKey: [[e('        if (holdsKey(data, keys)) {', '        if (false) {')], 'A'],
  mkKeyPieces: [[e("  if (data.length <= SCRATCH.keyScanBytes) return heldKey(data.toString('latin1'), keys) !== null", "  if (data.length <= SCRATCH.keyScanBytes) return keys.some(({ key }) => data.includes(key))")], 'A'],
  mkKeyBig: [[e('  return keys.some(({ key }) => key.length > 0 && data.includes(key))', '  return false')], 'A'],
  mkKeysDropped: [[e('const keys = (await options.savedKeys?.()) ?? []', 'const keys: readonly SavedKey[] = []')], 'A'],
  mkHash: [[e('{ size: data.length, sha256: sha256(data) }', '{ size: data.length, sha256: sha256(Buffer.alloc(0)) }')], 'A'],
  mkLookOnly: [[e('  if (options.lookOnly === true) {', '  if (false) {')], 'A'],
  mkLookCounts: [[e('        copiedFiles: files.length,\n        copiedBytes: bytes\n', '        copiedFiles: 0,\n        copiedBytes: 0\n')], 'A'],
  // ----- the caps and the race -----
  mkFilesCap: [[e('      files.push({ rel: here, size: info.size })\n      bytes += info.size\n      if (dirs.length + files.length > maxFiles) return tooMany(maxFiles)', '      files.push({ rel: here, size: info.size })\n      bytes += info.size')], 'B'],
  mkDirsCap: [[e('        dirs.push(here)\n        if (dirs.length + files.length > maxFiles) return tooMany(maxFiles)', '        dirs.push(here)')], 'B'],
  mkBytesCap: [[e('      if (bytes > maxBytes) return tooBig(maxBytes)', '')], 'B'],
  mkRace: [[e('        if (data.length !== size) {', '        if (false) {')], 'C'],
  // ----- afterwards -----
  cmpHash: [[e('        if (sha256(data) === before.sha256) {', '        if (true) {')], 'D'],
  cmpReserved: [[e("      if (rel.length === 0 && entry.name.toLowerCase() === SCRATCH.reserved) continue", '')], 'D'],
  cmpLink: [[e("      if (entry.isSymbolicLink()) {\n        out(key, 'link', 'link')", "      if (false) {\n        out(key, 'link', 'link')")], 'D'],
  cmpNever: [[e("      if (cls === 'never') {", '      if (false) {')], 'D'],
  cmpOne: [[e("      if (cls === 'one-by-one') {", '      if (false) {')], 'D'],
  cmpBig: [[e('      if (size > WORKSPACE_LIMITS.maxFileBytes) {', '      if (false) {')], 'D'],
  cmpText: [[e('      if (!decoded.ok) {', '      if (false) {')], 'D'],
  cmpDeleted: [[e('    if (seen.has(key)) continue', '')], 'D'],
  cmpBase: [[e('baseSha256: before?.sha256 ?? null', 'baseSha256: null')], 'D'],
  // ----- clearing up -----
  rmContain: [[e("  if (!isInside(home, target) || win32.dirname(target).toLowerCase() !== home.toLowerCase())\n    return false", '')], 'E'],
  rmDirect: [[e(' || win32.dirname(target).toLowerCase() !== home.toLowerCase())', ')')], 'E'],
  rmRetry: [[e('maxRetries: 12, retryDelay: 250', 'maxRetries: 0, retryDelay: 0')], 'E'],
  swMounts: [[e('lettersRemoved: sweepMounts(runRoot)', 'lettersRemoved: []')], 'E'],
  swSpecs: [[e('      await fs.rm(win32.join(specs, name), { recursive: true, force: true })', '      void name')], 'E'],
  swScratch: [[e('    if (await removeScratch(win32.join(home, name), runRoot)) sweep.scratchRemoved++', '    if (await Promise.resolve(true)) sweep.scratchRemoved++')], 'E'],
  // ----- where the run root lives -----
  rrRename: [[e("      await fs.rename(win32.join(probe, 'a.txt'), win32.join(probe, 'b.txt'))", '')], 'F'],
  rrOrder: [[e('  return [win32.join(drive, folderName), win32.join(win32.resolve(systemTemp), folderName)]', '  return [win32.join(win32.resolve(systemTemp), folderName), win32.join(drive, folderName)]')], 'F']
}

mkdirSync(join(TOOLS, 'specs133'), { recursive: true })
for (const [name, [edits, only]] of Object.entries(controls)) {
  const spec = { label: `n133-${name}`, edits, argv: ['{{TOOLS}}/verify-13-3.mjs'], env: { ONLY: only }, timeoutMs: 600000 }
  writeFileSync(join(TOOLS, 'specs133', `n133-${name}.json`), JSON.stringify(spec, null, 2) + '\n')
}
console.log(`wrote ${Object.keys(controls).length} specs in specs133`)
