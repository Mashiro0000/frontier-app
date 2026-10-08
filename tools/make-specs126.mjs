// Writes the negative-control specs for slice 12.6 (applying a change and undoing it, D-042): one sabotage each, which a suite must notice.
// usage: node tools/make-specs126.mjs
//   then: node tools/check-specs.mjs                   (dry check)
//         node tools/nc-all.mjs specs126 <names...>    (verify-12-6.mjs, plain Node)
//         node tools/nc-all.mjs specs126w <names...>   (run126.mjs: the real window)
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { TOOLS } from './paths.mjs'

const R = '{{REPO}}/'
const AS = R + 'src/main/applyService.ts', JN = R + 'src/main/journal.ts', UR = R + 'src/main/undoRecords.ts', IPC = R + 'src/main/ipc.ts', RS = R + 'src/main/reviewService.ts'
const SEC = R + 'src/renderer/src/tools/ChangesSection.tsx', AUD = R + 'src/shared/audit.ts', TL = R + 'src/shared/tools.ts', PRE = R + 'src/preload/index.ts', RP = R + 'src/main/reviewPage.ts'

const node = {
  // ----- the apply, in its order -----
  aFingerprint: [AS, '    if (sha256(newBytes).slice(0, 12) !== proposal.fingerprint) {', '    if (false as boolean) {'],
  aRoomCheck: [AS, '    if (!room) return { ok: false, error: ROOM_FULL }\n', ''],
  aRoomCount: [AS, '    return foldJournal(all.entries).length < UNDO_LIMITS.maxChanges', '    return foldJournal(all.entries).length <= UNDO_LIMITS.maxChanges'],
  aRoomCountLow: [AS, '    return foldJournal(all.entries).length < UNDO_LIMITS.maxChanges', '    return foldJournal(all.entries).length < UNDO_LIMITS.maxChanges - 1'],
  aRoomSize: [AS, '    if (size >= UNDO_LIMITS.maxBytes) return false', '    if (false as boolean) return false'],
  aRoomTooBig: [AS, "    if (all.state === 'too-big') return false\n    return foldJournal", '    return foldJournal'],
  aRoomThrow: [AS, "    try {\n      room = await roomForOne()\n    } catch {\n      room = false\n    }", '    room = await roomForOne()'],
  aAskRecord: [AS, "    if (!(await keep({ type: 'asked', at: now(), call, tool, step: 1, args, why }))) {\n      return { ok: false, error: NOT_RECORDED_TEXT }\n    }", "    await keep({ type: 'asked', at: now(), call, tool, step: 1, args, why })"],
  aTooLong: [AS, '    if (question.detail.length > SHOWN_LIMIT) return { ok: false, error: TOO_LONG }\n', ''],
  aAnswerNotYes: [AS, "    if (answer !== 'yes') return { ok: false, error: answerText(answer) }", "    if (answer === 'no') return { ok: false, error: answerText(answer) }"],
  aAnsweredRecord: [AS, '    if (!recorded) return { ok: false, error: NOT_RECORDED_TEXT }\n', ''],
  aOwner: [AS, '    const answer = await gate.ask(owner, question)', '    const answer = await gate.ask(null, question)'],
  aAgainGuard: [AS, "    if (!verdict.ok || (edit && verdict.kind !== 'file') || (!edit && verdict.kind !== 'missing')) {", '    if (false as boolean) {'],
  aAgainKind: [AS, "(edit && verdict.kind !== 'file') || (!edit && verdict.kind !== 'missing')", '(!edit && verdict.kind !== "missing")'],
  aReadOnly: [AS, '        await fs.access(verdict.real, constants.W_OK)\n', ''],
  aBaseHash: [AS, '      if (proposal.baseHash === null || sha256(original) !== proposal.baseHash) {', '      if (false as boolean) {'],
  aNoCopy: [AS, '      await finish(call, false, 0)\n      return { ok: false, error: NO_UNDO_COPY }', '      await finish(call, false, 0)'],
  aCopyBytes: [AS, "        before: original === null ? null : original.toString('base64'),", "        before: original === null ? null : Buffer.from('').toString('base64'),"],
  aCopyHash: [AS, '        afterHash,\n        afterBytes: newBytes.length,', "        afterHash: sha256(Buffer.from('x')),\n        afterBytes: newBytes.length,"],
  aRanRecord: [AS, '      await neutralise(id)\n      return { ok: false, error: NOT_RECORDED_TEXT }', '      await neutralise(id)'],
  aRanNeutral: [AS, '      await neutralise(id)\n      return { ok: false, error: NOT_RECORDED_TEXT }', '      return { ok: false, error: NOT_RECORDED_TEXT }'],
  aExclusive: [AS, "        await fs.writeFile(verdict.real, newBytes, { flag: 'wx' })", '        await fs.writeFile(verdict.real, newBytes)'],
  aReadBackApply: [AS, '      if (!(await readBack(verdict.real)).equals(newBytes))', '      if (false as boolean)'],
  aRestoreEdit: [AS, '        if (original !== null) await replaceFile(verdict.real, original)', '        if (false as boolean) await replaceFile(verdict.real, original!)'],
  aRestoreCreate: [AS, '        else await fs.rm(verdict.real, { force: true })', '        else void 0'],
  aNeutralFail: [AS, "      await neutralise(id)\n      await finish(call, false, 0)\n      return {\n        ok: false,\n        error: 'The change could not be written", "      await finish(call, false, 0)\n      return {\n        ok: false,\n        error: 'The change could not be written"],
  aFinishSize: [AS, '    await finish(call, true, newBytes.length)', '    await finish(call, true, 0)'],
  aFinishChanged: [AS, "    if (!verdict.ok || (edit && verdict.kind !== 'file') || (!edit && verdict.kind !== 'missing')) {\n      await finish(call, false, 0)", "    if (!verdict.ok || (edit && verdict.kind !== 'file') || (!edit && verdict.kind !== 'missing')) {"],
  aReplaceReadBack: [AS, "      if (!(await fs.readFile(tmp)).equals(bytes))\n        throw new Error('the temporary file did not read back')\n", ''],
  // ----- the list and the undo -----
  aListState: [AS, "              sha256(await fs.readFile(verdict.real)) === entry.afterHash ? 'undoable' : 'changed'", "              'undoable'"],
  aListGone: [AS, "verdict.code === 'not-found' ? 'gone'", "verdict.code === 'zz' ? 'gone'"],
  aListLimit: [AS, '.reverse().slice(0, 50)', '.reverse()'],
  aListOrder: [AS, '.reverse().slice(0, 50)', '.slice(0, 50)'],
  aListOp: [AS, "op: entry.kind === 'edit' ? 'edit' : 'read'", "op: 'create'"],
  aUndoAlready: [AS, "    if (record1.undone) return { ok: false, error: 'That change was already undone.' }\n", ''],
  aUndoHash: [AS, '      if (sha256(bytes) !== entry.afterHash) {', '      if (false as boolean) {'],
  aUndoLook: [AS, '      const again = await look()', '      const again = first'],
  aUndoRestore: [AS, '          await replaceFile(again.real, original)\n', ''],
  aUndoReadBack: [AS, '          if (!(await readBack(again.real)).equals(original))', '          if (false as boolean)'],
  aUndoClose: [AS, "        await journal.append({ type: 'undone', id: entry.id, at: now() })\n      } catch (error) {", '      } catch (error) {'],
  aUndoCreate: [AS, '          await fs.rm(again.real, { force: true })', '          void 0'],
  aUndoRan: [AS, "      if (!(await keep({ type: 'ran', at: now(), call, tool: 'undo_change', step: 1 })))\n        return { ok: false, error: NOT_RECORDED_TEXT }", "      await keep({ type: 'ran', at: now(), call, tool: 'undo_change', step: 1 })"],
  aUndoTool: [AS, "        'undo_change',\n        args,", "        'apply_change',\n        args,"],
  aClearNone: [AS, "      all.state === 'none' ||", '      (false as boolean) ||'],
  aClearRemove: [AS, '        await journal.removeAll()', '        void 0'],
  aBusy: [AS, '    if (busy) return { ok: false, error: BUSY_APPLY }\n', ''],
  aBusyRelease: [AS, '    } finally {\n      busy = false\n    }', '    } finally {\n      void 0\n    }'],
  aWrapper: [AS, '    apply: (proposal, owner) => oneAtATime(() => apply(proposal, owner)),', '    apply,'],
  aTool: [AS, "const no = await ask(owner, applyQuestion(proposal), call, 'apply_change', args, proposal.why)", "const no = await ask(owner, applyQuestion(proposal), call, 'web_search', args, proposal.why)"],
  // ----- the journal -----
  jSealCheck: [JN, "    if ('bad' in check || check.plain !== plain || check.form !== mode.form) {", '    if (false as boolean) {'],
  jRecover: [JN, '    if (current === null || body === null) {', '    if (current === null) {'],
  jWhole: [JN, '    return last === commitLine(version, count) && count > 0 ? body : null', '    return body'],
  jAlready: [JN, "    if (!decoded.some(({ d }) => !('bad' in d) && d.form !== wanted)) return 'already'\n", ''],
  jSealedKeep: [JN, "      if ('bad' in d && d.bad === 'sealed') return 'unreadable' // the file stays exactly as it is\n", ''],
  jNewline: [JN, "const wrote = Buffer.from(`${before.endsInNewline ? '' : '\\n'}${data}\\n`, 'utf8')", "const wrote = Buffer.from(`${data}\\n`, 'utf8')"],
  jLineMax: [JN, '      if (opened.text.length > maxLineChars) return { bad: \'damaged\' }\n', ''],
  // ----- the records -----
  uVersion: [UR, "  if (o.v !== UNDO_VERSION || typeof o.type !== 'string') return null", "  if (typeof o.type !== 'string') return null"],
  uUndoneKeys: [UR, "    if (!exactKeys(o, ['v', 'type', 'id', 'at'])) return null", '    if (false as boolean) return null'],
  uAppliedKeys: [UR, '  if (\n    !exactKeys(o, [', '  if (\n    false &&\n    !exactKeys(o, ['],
  uId: [UR, 'const ID = /^u[0-9a-z]{1,12}-[0-9a-z]{1,12}$/', 'const ID = /^.*$/'],
  uTime: [UR, 'Number.isSafeInteger(v) && v > 0', 'Number.isSafeInteger(v) && v >= 0'],
  uTimeInt: [UR, 'typeof v === \'number\' && Number.isSafeInteger(v) && v > 0', "typeof v === 'number' && Number.isFinite(v) && v > 0"],
  uHidden: [UR, '    HIDDEN.test(path)\n', '    false\n'],
  uPathLen: [UR, '    path.length > WORKSPACE_LIMITS.maxPathChars ||', '    path.length > 100000 ||'],
  uKind: [UR, "  if (kind !== 'edit' && kind !== 'create') return null\n", ''],
  uCreateBefore: [UR, '    if (before !== null || beforeHash !== null) return null', '    void 0'],
  uBase64: [UR, '      !BASE64.test(before) ||', '      false ||'],
  uBeforeHash: [UR, '    if (bytes.length > WORKSPACE_LIMITS.maxFileBytes || sha256(bytes) !== beforeHash) return null', '    if (bytes.length > WORKSPACE_LIMITS.maxFileBytes) return null'],
  uFingerprint: [UR, '    fingerprint !== afterHash.slice(0, 12)', '    false'],
  uSizeMax: [UR, '    afterBytes > WORKSPACE_LIMITS.maxFileBytes\n', '    false\n'],
  uSizeMin: [UR, '    afterBytes < 0 ||', '    false ||'],
  uBeforeType: [UR, "      typeof before !== 'string' ||\n      !BASE64", '      !BASE64'],
  uFoldDup: [UR, '      if (!byId.has(entry.id)) byId.set(entry.id, { entry, undone: false })', '      byId.set(entry.id, { entry, undone: false })'],
  uFoldUnknown: [UR, '      if (found !== undefined) found.undone = true', '      found!.undone = true'],
  uExact: [UR, '    have.length === keys.length && keys.every', '    keys.every'],
  // ----- the wiring and the words -----
  iUndoWindow: [IPC, '    CHANNELS.changesUndo,\n    guardedForWindow(', '    CHANNELS.changesUndo,\n    guarded('],
  iUndoOwner: [IPC, '        return await applier.undo(id, window)', '        return await applier.undo(id, null)'],
  iClearOwner: [IPC, '        return await applier.clearHistory(window)', '        return await applier.clearHistory(null)'],
  iKept: [IPC, 'workspaceStore.file,\n      undoJournal.document', 'workspaceStore.file'],
  iIdle: [IPC, 'workspaceStore.file.whenIdle(),\n      undoJournal.whenIdle()', 'workspaceStore.file.whenIdle()'],
  iApply: [IPC, '    requestApply: (proposal, owner) => applier.apply(proposal, owner)', '    requestApply: (proposal, owner) => applier.apply(proposal, owner),\n    secondWay: (p: Proposal, o: unknown) => applier.apply(p, o)'],
  tTitle: [TL, "  apply_change: 'Write a change to the workspace',\n", ''],
  wDone: [AUD, "? 'You said yes. It was undone.'", "? 'You said yes. It was removed.'"]
}

const win = {
  wSecGate: [SEC, "{change.state === 'undoable' && (", '{true && ('],
  wIpcRequest: [IPC, '    requestApply: (proposal, owner) => applier.apply(proposal, owner)', "    requestApply: async () => ({ ok: false, error: 'Applying a change is not available yet in this version.' })"],
  wIpcPath: [IPC, "join(app.getPath('userData'), 'workspace', 'changes.jsonl')", "join(app.getPath('userData'), 'changes.jsonl')"],
  wIpcOwner: [IPC, '        return await applier.undo(id, window)', '        return await applier.undo(id, null)'],
  wReviewRemove: [RS, '          store.remove(proposal.id)\n', ''],
  wPreUndo: [PRE, '    undo: (id) => ipcRenderer.invoke(CHANNELS.changesUndo, { id }),\n', ''],
  wPageMessage: [RP, "{ say(r.ok ? (r.message || 'Done.') : r.error, !r.ok); return load().then(() => { say(r.ok ? (r.message || 'Done.') : r.error, !r.ok) }) }", "{ say(r.ok ? 'Done.' : r.error, !r.ok); return load().then(() => { say(r.ok ? 'Done.' : r.error, !r.ok) }) }"],
  wAudit: [AUD, "? 'You said yes. It was undone.'", "? 'You said yes. It was removed.'"],
  wApplyWrite: [AS, '        await replaceFile(verdict.real, newBytes)', '        await replaceFile(verdict.real, Buffer.from(newBytes.toString("utf8").toUpperCase()))'],
  wUndoOnly: [AS, '      if (sha256(bytes) !== entry.afterHash) {', '      if (false as boolean) {']
}

const write = (dir, specs, argv, env, timeoutMs, prefix) => {
  mkdirSync(join(TOOLS, dir), { recursive: true })
  for (const [name, edit] of Object.entries(specs)) {
    const [file, from, to] = edit
    writeFileSync(join(TOOLS, dir, `${prefix}${name}.json`), JSON.stringify({ label: `${prefix}${name}`, edits: [{ file, from, to }], argv, env, ...(timeoutMs ? { timeoutMs } : {}) }, null, 2) + '\n')
  }
}
write('specs126', node, ['{{TOOLS}}/verify-12-6.mjs'], {}, 280000, 'n126-')
write('specs126w', win, ['{{TOOLS}}/run126.mjs', 'dev'], { NO_RETRY: '1' }, 600000, 'w126-')
console.log(`wrote ${Object.keys(node).length} specs in specs126 and ${Object.keys(win).length} in specs126w`)
