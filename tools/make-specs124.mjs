// Writes the negative-control specs for slice 12.4 (the model can propose a change, D-042): one sabotage each, which a suite must notice.
// usage: node tools/make-specs124.mjs
//   then: node tools/check-specs.mjs                   (dry check)
//         node tools/nc-all.mjs specs124 <names...>    (verify-12-4.mjs, plain Node)
//         node tools/nc-all.mjs specs124w <names...>   (run123.mjs: the real window, which holds the section for proposals)
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { TOOLS } from './paths.mjs'

const R = '{{REPO}}/'
const LD = R + 'src/main/lineDiff.ts', PR = R + 'src/main/proposals.ts', PT = R + 'src/main/proposalTools.ts', RTL = R + 'src/main/replyTools.ts', COR = R + 'src/main/toolCore.ts', IPC = R + 'src/main/ipc.ts', WTL = R + 'src/main/workspaceTools.ts'

const range = (text) => [PR, `  ${text},\n`, '']
const node = {
  // ----- the line diff -----
  dSplitFinal: [LD, "  if (lines[lines.length - 1] === '' && /(\\r\\n|\\n|\\r)$/.test(text)) lines.pop()\n", ''],
  dHead: [LD, '  while (head < before.length && head < after.length && before[head] === after[head]) head++', '  void 0'],
  dTail: [LD, '  while (\n    tail < before.length - head &&', '  while (\n    false &&'],
  dCells: [LD, '  if (n === 0 || m === 0 || (n + 1) * (m + 1) > MAX_DIFF_CELLS) {', '  if (n === 0 || m === 0) {'],
  dMax: [LD, '            : Math.max(table[(i + 1) * width + j], table[i * width + j + 1])', '            : table[(i + 1) * width + j]'],
  dEq: [LD, '            ? table[(i + 1) * width + j + 1] + 1', '            ? table[(i + 1) * width + j + 1]'],
  dCount: [LD, "    if (line.kind === 'add') added++", "    if (line.kind === 'del') added++"],
  dCountRemoved: [LD, "    else if (line.kind === 'del') removed++", "    else if (line.kind === 'add') removed++"],
  dNumber: [LD, "    lines.push({ kind: 'same', text, oldNo: oldNo++, newNo: newNo++ })", "    lines.push({ kind: 'same', text, oldNo, newNo: newNo++ })"],
  dNumberAdd: [LD, "    lines.push({ kind: 'add', text, oldNo: null, newNo: newNo++ })", "    lines.push({ kind: 'add', text, oldNo: null, newNo })"],
  uDevNull: [LD, "'/dev/null'", "'a/x'"],
  uFrom: [LD, '    const from = Math.max(0, index - context)', '    const from = index'],
  uTo: [LD, '    const to = Math.min(diff.lines.length - 1, index + context)', '    const to = index'],
  uMerge: [LD, '    if (last !== undefined && from <= last[1] + 1) last[1] = Math.max(last[1], to)', '    if (last !== undefined && from <= last[1] - 1) last[1] = Math.max(last[1], to)'],
  uOldStart: [LD, '    const oldStart = oldCount === 0 ? oldBefore : oldBefore + 1', '    const oldStart = oldBefore + 1'],
  uNewStart: [LD, '    const newStart = newCount === 0 ? newBefore : newBefore + 1', '    const newStart = newBefore + 1'],
  uOldCount: [LD, "    const oldCount = part.filter((l) => l.kind !== 'add').length", "    const oldCount = part.filter((l) => l.kind === 'same').length"],
  uSign: [LD, "  add: '+',\n  del: '-'\n}", "  add: '-',\n  del: '+'\n}"],
  // ----- making a proposal -----
  pOverlap: [PR, '  for (let at = text.indexOf(needle); at !== -1; at = text.indexOf(needle, at + 1)) {', '  for (let at = text.indexOf(needle); at !== -1; at = text.indexOf(needle, at + needle.length)) {'],
  pOnce: [PR, '  if (count > 1) {', '  if (false as boolean) {'],
  pFound: [PR, '  if (count === 0) {', '  if (false as boolean) {'],
  pSame: [PR, '  if (find === replace)\n    return no(', '  if (false as boolean)\n    return no('],
  pHiddenEdit: [PR, '  if (hidden !== null) {\n    return no(\n      `The new text holds a hidden', '  if (false as boolean) {\n    return no(\n      `The new text holds a hidden'],
  pHiddenCreate: [PR, '  if (hidden !== null) {\n    return no(\n      `The new file', '  if (false as boolean) {\n    return no(\n      `The new file'],
  pRange202a: range('[0x202a, 0x202e]'),
  pRange2066: range('[0x2066, 0x2069]'),
  pRange200b: range('[0x200b, 0x200f]'),
  pRange2060: range('[0x2060, 0x2064]'),
  pRangeFeff: range('[0xfeff, 0xfeff]'),
  pRangeSoft: range('[0x00ad, 0x00ad]'),
  pRangeAlm: range('[0x061c, 0x061c]'),
  pRange180e: [PR, '  [0x180e, 0x180e]\n', ''],
  pCrlfHay: [PR, "  const hay = crlf ? decoded.text.replace(/\\r\\n/g, '\\n') : decoded.text", '  const hay = decoded.text'],
  pCrlfNeedle: [PR, "  const needle = crlf ? find.replace(/\\r\\n/g, '\\n') : find", '  const needle = find'],
  pCrlfPut: [PR, "  const put = crlf ? replace.replace(/\\r\\n/g, '\\n') : replace", '  const put = replace'],
  pCrlfBack: [PR, "  if (crlf) after = after.replace(/\\n/g, '\\r\\n')", ''],
  pNoChange: [PR, "  if (after === decoded.text) return no('That change would leave the file as it is.')\n", ''],
  pSize: [PR, '  if (bytes.length > WORKSPACE_LIMITS.maxFileBytes) {', '  if (false as boolean) {'],
  pBom: [PR, '    bom: decoded.bom,', '    bom: false,'],
  pBase: [PR, '    baseHash: sha256(input.bytes),', '    baseHash: null,'],
  pFinger: [PR, '      fingerprint: sha256(bytes).slice(0, 12),', '      fingerprint: sha256(bytes).slice(0, 8),'],
  pBytesFor: [PR, "  Buffer.from(bom ? BOM + text : text, 'utf8')", "  Buffer.from(text, 'utf8')"],
  pEol: [PR, '    eol: decoded.eol,', "    eol: 'lf',"],
  pRunsPackage: [PR, '(package\\.json|makefile|', '(makefile|'],
  pRunsMakefile: [PR, '(package\\.json|makefile|', '(package\\.json|'],
  pRunsBat: [PR, '[^/]*\\.(bat|cmd|ps1|vbs|vbe|wsf|sh))$', '[^/]*\\.(cmd|ps1|vbs|vbe|wsf|sh))$'],
  pRunsPs1: [PR, '[^/]*\\.(bat|cmd|ps1|vbs|vbe|wsf|sh))$', '[^/]*\\.(bat|cmd|vbs|vbe|wsf|sh))$'],
  pRunsSh: [PR, '[^/]*\\.(bat|cmd|ps1|vbs|vbe|wsf|sh))$', '[^/]*\\.(bat|cmd|ps1|vbs|vbe|wsf))$'],
  pRunsTasks: [PR, '|(^|\\/)\\.vscode\\/tasks\\.json$', ''],
  pRunsWorkflows: [PR, '|(^|\\/)\\.github\\/workflows\\//i', '/i'],
  pRunsCase: [PR, 'workflows\\//i', 'workflows\\//'],
  pRunsFlag: [PR, '      flags: { secret: parts.secret, runsCommands: runsCommands(path) },', '      flags: { secret: parts.secret, runsCommands: false },'],
  pSecretFlag: [PR, '      flags: { secret: parts.secret, runsCommands: runsCommands(path) },', '      flags: { secret: false, runsCommands: runsCommands(path) },'],
  pStoreLimit: [PR, '      if (waiting.size >= PROPOSAL_LIMITS.waiting) {', '      if (false as boolean) {'],
  pStoreId: [PR, '      counter++\n', ''],
  pFrozen: [PR, '      const kept: Proposal = Object.freeze({ ...proposal, id: `p${counter}` })', '      const kept: Proposal = { ...proposal, id: `p${counter}` }'],
  pList: [PR, '    list: () => [...waiting.values()].reverse(),', '    list: () => [...waiting.values()],'],
  pRemoveType: [PR, "    remove: (id) => (typeof id === 'string' ? waiting.delete(id) : false),", '    remove: (id) => waiting.delete(id as string),'],
  pLimitWaiting: [PR, '  waiting: 20,', '  waiting: 21,'],
  pLimitReply: [PR, '  perReply: 10', '  perReply: 11'],
  // ----- the tools -----
  tPerReply: [PT, '    made >= PROPOSAL_LIMITS.perReply', '    false as boolean'],
  tMade: [PT, '    made++\n    return {\n      text: told(\n        kept.proposal.id,\n        kept.proposal.path,\n        kept.proposal.added,\n        kept.proposal.removed,\n        false\n      )', '    return {\n      text: told(\n        kept.proposal.id,\n        kept.proposal.path,\n        kept.proposal.added,\n        kept.proposal.removed,\n        false\n      )'],
  tSize: [PT, '    if (verdict.size > WORKSPACE_LIMITS.maxFileBytes) {', '    if (false as boolean) {'],
  tDecode: [PT, '    if (!decoded.ok)\n      return { text: refusedText(`the file cannot be read as text', '    if (false as boolean)\n      return { text: refusedText(`the file cannot be read as text'],
  tNothing: [PT, ' Nothing was changed on disk. ', ' '],
  tNotApplied: [PT, 'It is NOT applied yet: do not say that it is, and do not rely on it until the person has applied it (you can read the file again later to see).', 'It is applied.'],
  tWhy: [PT, '      replace: String(args.replace),\n      why: ctx.why,', "      replace: String(args.replace),\n      why: '',"],
  tSecretEdit: [PT, "      replace: String(args.replace),\n      why: ctx.why,\n      secret: verdict.fileClass === 'one-by-one',", "      replace: String(args.replace),\n      why: ctx.why,\n      secret: false,"],
  tSecretCreate: [PT, "      content: String(args.content),\n      why: ctx.why,\n      secret: verdict.fileClass === 'one-by-one',", "      content: String(args.content),\n      why: ctx.why,\n      secret: false,"],
  tDescribeNothing: [PT, "    'Nothing is changed: the person sees the whole difference in a window of the app and decides, and you cannot apply it. For several places, make several proposals. ' +", "    'The person sees the whole difference in a window of the app and decides. For several places, make several proposals. ' +"],
  tIds: [WTL, "  'propose_edit',\n  'propose_new_file'\n]", "  'propose_edit'\n]"],
  tNoExecutors: [RTL, '              ...createProposalExecutors({ store: options.workspace.proposals, now: options.now })', ''],
  tWhyContext: [COR, '            why,\n            runMsLeft', "            why: '',\n            runMsLeft"],
  xWrites: [PT, '    const bytes = await fs.readFile(verdict.real)\n    if (bytes.length > WORKSPACE_LIMITS.maxFileBytes) {\n      return {\n        text: refusedText(`the file is larger', "    await fs.writeFile(verdict.real + '.x', '')\n    const bytes = await fs.readFile(verdict.real)\n    if (bytes.length > WORKSPACE_LIMITS.maxFileBytes) {\n      return {\n        text: refusedText(`the file is larger"],
  xFsInProposals: [PR, "import { createHash } from 'crypto'", "import { createHash } from 'crypto'\nimport { promises as fs } from 'fs'\nvoid fs"]
}

const win = {
  wRegistry: [IPC, '    ...WORKSPACE_PROPOSE_TOOLS\n  ])', '  ])'],
  wIds: [WTL, "  'propose_edit',\n  'propose_new_file'\n]", "  'propose_edit'\n]"],
  wNoExecutors: [RTL, '              ...createProposalExecutors({ store: options.workspace.proposals, now: options.now })', ''],
  wLengths: [COR, "        def.args[argName]?.kind === 'body'\n          ? `(${String(value).length} characters)`\n          : typeof value === 'string' || typeof value === 'number'\n            ? value\n            : JSON.stringify(value)", '        value']
}

const write = (dir, specs, argv, env, timeoutMs, prefix) => {
  mkdirSync(join(TOOLS, dir), { recursive: true })
  for (const [name, edit] of Object.entries(specs)) {
    const [file, from, to] = edit
    writeFileSync(join(TOOLS, dir, `${prefix}${name}.json`), JSON.stringify({ label: `${prefix}${name}`, edits: [{ file, from, to }], argv, env, ...(timeoutMs ? { timeoutMs } : {}) }, null, 2) + '\n')
  }
}
write('specs124', node, ['{{TOOLS}}/verify-12-4.mjs'], {}, 280000, 'n124-')
write('specs124w', win, ['{{TOOLS}}/run123.mjs', 'dev'], { NO_RETRY: '1' }, 600000, 'w124-')
console.log(`wrote ${Object.keys(node).length} specs in specs124 and ${Object.keys(win).length} in specs124w`)
