// Writes the negative-control specs for slice 12.1 (the folder is the boundary, D-042): one sabotage each, which the suite must notice.
// usage: node tools/make-specs121.mjs
//   then: node tools/check-specs.mjs                   (dry check)
//         node tools/nc-all.mjs specs121 <names...>    (verify-12-1.mjs, plain Node)
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { TOOLS } from './paths.mjs'

const R = '{{REPO}}/'
const GRD = R + 'src/main/workspaceGuard.ts', WSM = R + 'src/main/workspace.ts', TXT = R + 'src/main/workspaceText.ts', IPC = R + 'src/main/ipc.ts', CH = R + 'src/shared/ipc.ts'
const NEVER = '/^(\\.git|\\.hg|\\.svn|\\$recycle\\.bin|system volume information)$/iu'
const SECRET = '/^(id_rsa|id_ed25519|id_ecdsa|id_dsa|credentials|secrets?)|\\.(pem|key|pfx|p12|ppk|kdbx|jks|keystore|env)$/iu'

const g = {
  // ----- what is never reached, and what is asked about one by one -----
  gNeverGit: [GRD, NEVER, NEVER.replace('\\.git|', '')],
  gNeverHg: [GRD, NEVER, NEVER.replace('\\.hg|', '')],
  gNeverSvn: [GRD, NEVER, NEVER.replace('\\.svn|', '')],
  gNeverBin: [GRD, NEVER, NEVER.replace('\\$recycle\\.bin|', '')],
  gNeverSvi: [GRD, NEVER, NEVER.replace('|system volume information', '')],
  gNeverCase: [GRD, NEVER, NEVER.replace('/iu', '/u')],
  gNeverRule: [GRD, "    if (fileClass === 'never') return no('never', note)\n", ''],
  gDotRule: [GRD, "    if (name.startsWith('.')) {", 'if (false) {'],
  gSecretRule: [GRD, '    if (SECRET_NAME.test(name)) {', '    if (false) {'],
  gSecretCase: [GRD, SECRET, SECRET.replace('/iu', '/u')],
  gSecretFold: [GRD, SECRET, SECRET.replace('/iu', '/i')],
  gSecretIdRsa: [GRD, SECRET, SECRET.replace('id_rsa|', '')],
  gSecretEd25519: [GRD, SECRET, SECRET.replace('id_ed25519|', '')],
  gSecretEcdsa: [GRD, SECRET, SECRET.replace('id_ecdsa|', '')],
  gSecretDsa: [GRD, SECRET, SECRET.replace('id_dsa|', '')],
  gSecretCredentials: [GRD, SECRET, SECRET.replace('credentials|', '')],
  gSecretSecrets: [GRD, SECRET, SECRET.replace('secrets?', 'xx')],
  gSecretSecret: [GRD, SECRET, SECRET.replace('secrets?', 'secrets')],
  gSecretPem: [GRD, SECRET, SECRET.replace('(pem|', '(')],
  gSecretKey: [GRD, SECRET, SECRET.replace('|key|', '|')],
  gSecretPfx: [GRD, SECRET, SECRET.replace('|pfx', '')],
  gSecretP12: [GRD, SECRET, SECRET.replace('|p12', '')],
  gSecretPpk: [GRD, SECRET, SECRET.replace('|ppk', '')],
  gSecretKdbx: [GRD, SECRET, SECRET.replace('|kdbx', '')],
  gSecretJks: [GRD, SECRET, SECRET.replace('|jks', '')],
  gSecretKeystore: [GRD, SECRET, SECRET.replace('|keystore', '')],
  gSecretEnv: [GRD, SECRET, SECRET.replace('|env)', ')')],
  gRealNames: [GRD, '    const relNames = realParts.slice(root.realParts.length).concat(tail)', '    const relNames = below'],
  gTailNames: [GRD, '    const relNames = realParts.slice(root.realParts.length).concat(tail)', '    const relNames = tail'],
  // ----- the path -----
  gAbsolute: [GRD, "    if (platform === 'win32' ? ABSOLUTE_WIN.test(raw) : raw.startsWith('/')) {", '    if (false) {'],
  gAbsoluteDrive: [GRD, 'const ABSOLUTE_WIN = /^[A-Za-z]:|^[\\\\/]/', 'const ABSOLUTE_WIN = /^[\\\\/]/'],
  gOutside: [GRD, "    if (!isInside(parts, root.parts, platform)) return no('outside', 'it leaves the workspace')\n", ''],
  gRealOutside: [GRD, "    if (!isInside(realParts, root.realParts, platform)) {\n      return no('outside', 'it really lies outside the workspace')\n    }\n", ''],
  gLinkRule: [GRD, "      if (stat.isSymbolicLink()) return no('link', 'a link is on the way')\n", ''],
  gLinkFinalOnly: [GRD, "      if (stat.isSymbolicLink()) return no('link', 'a link is on the way')", "      if (stat.isSymbolicLink() && index === below.length - 1) return no('link', 'a link is on the way')"],
  gLinkMiddleOnly: [GRD, "      if (stat.isSymbolicLink()) return no('link', 'a link is on the way')", "      if (stat.isSymbolicLink() && index < below.length - 1) return no('link', 'a link is on the way')"],
  gNotAFolder: [GRD, '      if (index < below.length - 1 && !stat.isDirectory()) {', '      if (false) {'],
  gDataSkipped: [GRD, '    if (!data.ok) return no(data.code, data.why)\n', ''],
  gDataOp: [GRD, "  edit: 'write',", "  edit: 'read',"],
  gDataSource: [GRD, '    const data = await dataGuard.check({\n      path: lexical.abs,', '    const data = await dataGuard.check({\n      path: root.abs,'],
  gRealPath: [GRD, '      real: P.join(real, ...tail),', '      real: lexical.abs,'],
  gRel: [GRD, '      rel: relNames,', '      rel: [],'],
  gSize: [GRD, "      size: kind === 'file' && finalStat !== null ? Number(finalStat.size) : 0,", '      size: 0,'],
  gCreateExists: [GRD, "    if (op === 'create' && kind !== 'missing') return no('exists', 'it is there already')\n", ''],
  gListFolder: [GRD, "    if (op === 'list' && kind !== 'folder')\n      return no(kind === 'missing' ? 'not-found' : 'not-a-folder', 'a folder was needed')\n", ''],
  gReadFile: [GRD, "    if ((op === 'read' || op === 'edit') && kind !== 'file') {\n      return no(kind === 'missing' ? 'not-found' : 'not-a-file', 'a file was needed')\n    }\n", ''],
  gKindOther: [GRD, "    if (kind === null) return no('bad-path', 'neither a file nor a folder')\n", ''],
  gCatch: [GRD, "      try {\n        return await judge(request.path, request.op)\n      } catch {\n        return no('bad-path', 'the check failed')\n      }", '      return await judge(request.path, request.op)'],
  gCatchRoot: [GRD, "      try {\n        const now = await rootNow()\n        if (!now.ok) return { ok: false, why: now.why }\n        return { ok: true, real: now.real, name: now.parts[now.parts.length - 1] }\n      } catch {\n        return { ok: false, why: 'the chosen folder could not be checked' }\n      }", '      const now = await rootNow()\n      if (!now.ok) return { ok: false, why: now.why }\n      return { ok: true, real: now.real, name: now.parts[now.parts.length - 1] }'],
  // ----- the workspace itself -----
  gRootAgain: [GRD, '    const root = await rootNow()\n    if (!root.ok) return root\n', '    rootCache ??= await rootNow()\n    const root = rootCache\n    if (!root.ok) return root\n'],
  gRootData: [GRD, "    if (!verdict.ok)\n      return no('workspace-changed', 'the chosen folder is, holds or lies in the data folder')\n", ''],
  gRootNotWhole: [GRD, '        recursive: true\n      })\n    } catch {\n      return no(\'workspace-changed\', \'the data-folder check failed\')', '        recursive: false\n      })\n    } catch {\n      return no(\'workspace-changed\', \'the data-folder check failed\')'],
  gRootEquality: [GRD, "    if (!isInside(realParts, parts, platform) || !isInside(parts, realParts, platform)) {\n      return no('workspace-changed', 'the chosen folder is reached through a link now')\n    }\n", ''],
  gRootEqualityHalf: [GRD, '    if (!isInside(realParts, parts, platform) || !isInside(parts, realParts, platform)) {', '    if (!isInside(realParts, parts, platform)) {'],
  gRootLink: [GRD, "      if (found.isSymbolicLink()) return no('workspace-changed', 'the chosen folder is now a link')\n", ''],
  gRootFile: [GRD, "      if (!found.isDirectory()) return no('workspace-changed', 'the chosen folder is not a folder')\n", ''],
  gRootNone: [GRD, "    if (chosen === null || chosen === undefined) return no('no-workspace', 'no folder is chosen')\n", ''],
  gRootRel: [GRD, "    if (!lexical.ok) return no('workspace-changed', 'the chosen folder cannot be understood')\n", ''],
  // ----- the choice of the folder -----
  wLink: [WSM, "    if (found.isSymbolicLink()) {\n      return refuse('That is a link or junction. Choose the folder itself, not a link to it.')\n    }\n", ''],
  wNotFolder: [WSM, "    if (!found.isDirectory()) return refuse('That is not a folder.')\n", ''],
  wDrive: [WSM, "    if (parts.length <= 1) return refuse(\"A drive's root cannot be the workspace: choose a folder.\")\n", ''],
  wEquality: [WSM, '    if (!isInside(realParts, parts, platform) || !isInside(parts, realParts, platform)) {', '    if (false) {'],
  wHolds: [WSM, '      if (named.ok && isInside(partsOf(named.abs, platform), realParts, platform)) {', '      if (false) {'],
  wInside: [WSM, '      if (named.ok && isInside(realParts, partsOf(named.abs, platform), platform)) {', '      if (false) {'],
  wData: [WSM, '    if (!verdict.ok) {\n      return refuse(', '    if (false) {\n      return refuse('],
  wDataTree: [WSM, '      op: \'list\',\n      recursive: true\n    })\n    if (!verdict.ok) {', '      op: \'list\',\n      recursive: false\n    })\n    if (!verdict.ok) {'],
  wInput: [WSM, "    if (!lexical.ok) return refuse('That is not a folder this app can use as a workspace.')\n", ''],
  wFolderName: [WSM, "    return { ok: true, folder: tidy.abs, name: realParts[realParts.length - 1] }", "    return { ok: true, folder: lexical.abs, name: realParts[realParts.length - 1] }"],
  wParseCount: [WSM, '  if (names.length !== 3 || fields.version !== WORKSPACE_FILE_VERSION) return null', '  if (fields.version !== WORKSPACE_FILE_VERSION) return null'],
  wParseVersion: [WSM, '  if (names.length !== 3 || fields.version !== WORKSPACE_FILE_VERSION) return null', '  if (names.length !== 3) return null'],
  wParseLength: [WSM, '  if (typeof folder !== \'string\' || folder.length > MAX_FOLDER_CHARS) return null', "  if (typeof folder !== 'string') return null"],
  wParseSafe: [WSM, '!Number.isSafeInteger(chosenAt) || chosenAt < 0', 'chosenAt < 0'],
  wParseNegative: [WSM, '!Number.isSafeInteger(chosenAt) || chosenAt < 0', '!Number.isSafeInteger(chosenAt)'],
  wParseTidy: [WSM, '  if (!lexical.ok || lexical.abs !== folder || partsOf(lexical.abs, platform).length <= 1)\n    return null','  if (!lexical.ok || partsOf(lexical.abs, platform).length <= 1) return null'],
  wParseRoot: [WSM, '  if (!lexical.ok || lexical.abs !== folder || partsOf(lexical.abs, platform).length <= 1)\n    return null','  if (!lexical.ok || lexical.abs !== folder) return null'],
  wParseObject: [WSM, "  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return null\n", ''],
  wStoreParse: [WSM, '    parse: (text) => parseWorkspace(text),', '    parse: (text) => JSON.parse(text),'],
  wStoreNoProblem: [WSM, "        if (current.state === 'unreadable') return { record: null, problem: current.why }\n", ''],
  wStoreCatch: [WSM, "        console.error(\n          'Reading the workspace setting failed:',\n          error instanceof Error ? error.message : error\n        )\n        return { record: null, problem: 'it could not be read from the disk' }", '        throw error'],
  // ----- is it text -----
  tUtf16: [TXT, '  if (\n    bytes.length >= 2 &&\n    ((bytes[0] === 0xff && bytes[1] === 0xfe) || (bytes[0] === 0xfe && bytes[1] === 0xff))\n  ) {', '  if (false) {'],
  tUtf16Half: [TXT, '|| (bytes[0] === 0xfe && bytes[1] === 0xff))', '|| false)'],
  tNul: [TXT, "  if (bytes.includes(0)) return { ok: false, why: 'it is a binary file (it holds a NUL byte)' }\n", ''],
  tFatal: [TXT, "new TextDecoder('utf-8', { fatal: true, ignoreBOM: true })", "new TextDecoder('utf-8', { fatal: false, ignoreBOM: true })"],
  tBom: [TXT, '  const bom = bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf', '  const bom = false'],
  tCr: [TXT, "  if (cr > 0 || (lf > 0 && crlf > 0)) return 'mixed'", "  if (lf > 0 && crlf > 0) return 'mixed'"],
  tMixed: [TXT, "  if (cr > 0 || (lf > 0 && crlf > 0)) return 'mixed'", "  if (cr > 0) return 'mixed'"],
  tCrlf: [TXT, "  if (crlf > 0) return 'crlf'", "  if (crlf > 0) return 'lf'"],
  // ----- wired in before its time, or doing more than it should -----
  // (17.4: ipc.ts has imported the guard on purpose since 12.3, so the control now puts the import into chat.ts, which must never have it)
  xWired: ['{{REPO}}/src/main/chat.ts', "import { adapterFor, OFFERS_SEARCH } from './providers'", "import { adapterFor, OFFERS_SEARCH } from './providers'\nimport { createWorkspaceGuard } from './workspaceGuard'\nvoid createWorkspaceGuard"],
  xBridge: [CH, 'export const CHANNELS = {', "export const CHANNELS = {\n  workspaceChoose: 'workspace:choose',"],
  xWrites: [GRD, "      real = plainPath(await fs.realpath(existing), platform)", "      await fs.writeFile(existing + '.x', '')\n      real = plainPath(await fs.realpath(existing), platform)"],
  xElectron: [WSM, "import { promises as fs } from 'fs'", "import { promises as fs } from 'fs'\nvoid 'electron'"],
  xImport: [TXT, '// Whether the bytes of a file', "import { posix } from 'path'\nvoid posix\n// Whether the bytes of a file"]
}

// the one control that needs a second edit: a cached root needs its variable
const nodeSpecs = Object.fromEntries(Object.entries(g).map(([name, edit]) => [`n121-${name}`, name === 'gRootAgain' ? [edit, [GRD, '  const { dataGuard } = options\n', '  const { dataGuard } = options\n  let rootCache: unknown\n']] : [edit]]))

mkdirSync(join(TOOLS, 'specs121'), { recursive: true })
for (const [name, edits] of Object.entries(nodeSpecs)) {
  writeFileSync(join(TOOLS, 'specs121', `${name}.json`), JSON.stringify({ label: name, edits: edits.map(([file, from, to]) => ({ file, from, to })), argv: ['{{TOOLS}}/verify-12-1.mjs'], env: {}, timeoutMs: 280000 }, null, 2) + '\n')
}
console.log(`wrote ${Object.keys(nodeSpecs).length} specs in specs121`)
