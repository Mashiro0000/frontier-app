// Writes the negative-control specs for slice 11.2 (the audit log of tool calls, D-041): one sabotage each, which a suite must notice.
// usage: node tools/make-specs112.mjs
//   then: node tools/check-specs.mjs                   (dry check)
//         node tools/nc-all.mjs specs112 <names...>    (verify-11-2.mjs, plain Node: the events, the file, the rewrite, the service, the core writing into the log)
//         node tools/nc-all.mjs specs112w <names...>   (run112.mjs: the real window)
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { TOOLS } from './paths.mjs'

const R = '{{REPO}}/'
const LOG = R + 'src/main/auditLog.ts', SVC = R + 'src/main/auditService.ts', COR = R + 'src/main/toolCore.ts', SHT = R + 'src/shared/tools.ts'
const IPC = R + 'src/main/ipc.ts', PRE = R + 'src/preload/index.ts', TD = R + 'src/renderer/src/tools/ToolsDialog.tsx', CB = R + 'src/renderer/src/chat/ChatBar.tsx'
const UCS = R + 'src/renderer/src/settings/useChatStorage.ts'

const s = {
  // ----- the events -----
  aKeys: [LOG, '    have.length === keys.length &&\n    keys.every((key) => Object.prototype.hasOwnProperty.call(raw, key))', '    true'],
  aHidden: [LOG, 'const HIDDEN = /[\\p{Cc}\\p{Cf}\\p{Zl}\\p{Zp}\\p{Co}\\p{Cn}\\p{Cs}]/u', 'const HIDDEN = /(?!)/u'],
  aUrlScheme: [LOG, "  if (!/^https:\\/\\/[\\x21-\\x7e]+$/.test(url) || !isSafeExternalUrl(url)) return null", '  void isSafeExternalUrl'],
  aUrlAscii: [LOG, '  if (!/^https:\\/\\/[\\x21-\\x7e]+$/.test(url) || !isSafeExternalUrl(url)) return null', '  if (!isSafeExternalUrl(url)) return null'],
  aUrlSafe: [LOG, '  if (!/^https:\\/\\/[\\x21-\\x7e]+$/.test(url) || !isSafeExternalUrl(url)) return null', '  if (!/^https:\\/\\/[\\x21-\\x7e]+$/.test(url)) return null'],
  aSourcesMax: [LOG, 'Array.isArray(sources) || sources.length > TOOL_RESULT_LIMITS.maxSources) return null', 'Array.isArray(sources)) return null'],
  aTitleLength: [LOG, '  if (Array.from(title).length > TOOL_RESULT_LIMITS.maxTitleChars) return null\n', ''],
  aStep: [LOG, '!isCount(step, 100_000)', '!isCount(step, Infinity)'],
  aSize: [LOG, 'isCount(size, TOOL_RESULT_LIMITS.maxChars + 200)', 'isCount(size, Infinity)'],
  aTime: [LOG, 'Number.isSafeInteger(value) && value > 0\n', 'true\n'],
  aCallId: [LOG, "typeof call !== 'string' || !CALL_ID.test(call)", "typeof call !== 'string'"],
  aToolId: [LOG, '!TOOL_ID.test(tool) ||', ''],
  aArgsMax: [LOG, '      if (names.length > 8) return null\n', ''],
  aArgName: [LOG, '        if (!ARG_NAME.test(name)) return null\n', ''],
  aCodes: [LOG, "typeof code !== 'string' || !(REFUSAL_CODES as readonly string[]).includes(code)", "typeof code !== 'string'"],
  aAnswers: [LOG, "typeof answer !== 'string' || !(ANSWER_CODES as readonly string[]).includes(answer)", "typeof answer !== 'string'"],
  aRoundtrip: [LOG, "  if (back === null || JSON.stringify(lineObject(back)) !== text) {", '  if (false) {'],
  aLineExtra: [LOG, '      return {\n        ...head,\n        ok: event.ok,', '      return {\n        ...head,\n        ...event,\n        ok: event.ok,'],
  aVersion: [LOG, '  if (o.v !== AUDIT_FORMAT_VERSION) return null\n', ''],
  // ----- the file -----
  bRefused: [LOG, "    if ('refused' in mode) throw new KeptRefused(mode.refused)\n    const plain", '    const plain'],
  bTail: [LOG, "    if (!tail.equals(wrote)) throw new Error('the record did not reach the disk as it was written')\n", ''],
  bReadBack: [LOG, "    if (after.size < before.size + wrote.length) throw new Error('the audit log did not grow')\n    const tail = await lastBytes(file, wrote.length)\n    if (!tail.equals(wrote)) throw new Error('the record did not reach the disk as it was written')\n", ''],
  bNewline: [LOG, "${before.endsInNewline ? '' : '\\n'}${data}", '${data}'],
  bPrecheck: [LOG, "    if ('bad' in check || check.plain !== plain || check.form !== mode.form) {", '    if (false) {'],
  bPlainWhenSealed: [LOG, "    if (mode.form === 'encrypted') {\n      if (box === undefined", "    if (false) {\n      if (box === undefined"],
  bBom: [LOG, "      if (text.charCodeAt(0) === 0xfeff) text = text.slice(1) // a byte-order mark, which some editors add\n", ''],
  bPartialFirst: [LOG, "        const cut = text.indexOf('\\n')\n        text = cut < 0 ? '' : text.slice(cut + 1)", '        void 0'],
  bSkipCount: [LOG, '        skipped += 1\n', ''],
  bSealedCount: [LOG, "        if (decoded.bad === 'sealed') sealedClosed += 1\n", ''],
  bFormMixed: [LOG, "plain > 0 && sealed > 0 ? 'mixed' :", "plain > 0 && sealed > 0 ? 'plain' :"],
  bRemoveTmp: [LOG, '    await fs.rm(`${file}.tmp`, { force: true })\n    await fs.rm(file, { force: true })', '    await fs.rm(file, { force: true })'],
  bRemoveFile: [LOG, '    await fs.rm(`${file}.tmp`, { force: true })\n    await fs.rm(file, { force: true })', '    await fs.rm(`${file}.tmp`, { force: true })'],
  bRecoverAlways: [LOG, '    if (!current.startsWith(body)) {', '    if (true) {'],
  bRecoverNever: [LOG, '    if (!current.startsWith(body)) {', '    if (false) {'],
  bRecoverCut: [LOG, '    if (current === null || body === null) {', '    if (current === null) {'],
  bRecoverDeleted: [LOG, '    if (current === null || body === null) {', '    if (body === null) {'],
  bWholeBody: [LOG, '  return last === commitLine(count) && count > 0 ? body : null', '  return body'],
  bWholeCount: [LOG, '  return last === commitLine(count) && count > 0 ? body : null', '  return count > 0 ? body : null'],
  bConformSealed: [LOG, "      if ('bad' in d && d.bad === 'sealed') return 'unreadable' // the file stays exactly as it is\n", ''],
  bConformDamaged: [LOG, "        if ('bad' in d || d.form === wanted) return raw // a damaged line is kept as it is", "        if (d.form === wanted) return raw"],
  bConformProof: [LOG, '      if (!(await proved(file, body)) || !sameEvents(body)) {', '      if (false) {'],
  bConformAlready: [LOG, "    if (!decoded.some(({ d }) => !('bad' in d) && d.form !== wanted)) return 'already'\n", ''],
  bConformRefused: [LOG, "    if ('refused' in mode) return 'refused'\n    const wanted", '    const wanted'],
  bFormPrefix: [LOG, '      if (line.startsWith(SEALED_PREFIX)) sealed += 1', '      if (false) sealed += 1'],
  bFormTarget: [LOG, "        ? target === 'encrypted'\n          ? 'plain'\n          : 'encrypted'", '        ? target'],
  // ----- the service -----
  sGroupById: [SVC, 'let call = byId.get(event.call)', 'let call = byId.get(event.tool)'],
  sOutcomeRefused: [SVC, "  if (call.refused !== null) return { kind: 'refused', code: call.refused }\n", ''],
  sOutcomeDeclined: [SVC, "  if (call.answer !== null && call.answer !== 'yes') {", '  if (call.answer !== null && false) {'],
  sViewOrder: [SVC, 'calls: calls.slice(-AUDIT_VIEW_CALLS).reverse(),', 'calls: calls.slice(0, AUDIT_VIEW_CALLS),'],
  sViewLimit: [SVC, 'calls: calls.slice(-AUDIT_VIEW_CALLS).reverse(),', 'calls: calls.slice().reverse(),'],
  sExportInside: [SVC, '    if (await isInside(options.dataDir, dest)) {', '    if (false) {'],
  sExportAbsolute: [SVC, "    if (typeof dest !== 'string' || !isAbsolute(dest)) {", '    if (false) {'],
  sExportOrder: [SVC, '  for (const call of calls) {', '  for (const call of [...calls].reverse()) {'],
  sExportQuote: [SVC, 'const quoted = (text: string): string => JSON.stringify(text)', 'const quoted = (text: string): string => text'],
  sExportEmpty: [SVC, '    if (calls.length === 0) {\n      return { ok: false, error:', '    if (false) {\n      return { ok: false, error:'],
  sDeleteNo: [SVC, "    if (answer !== 'yes') return { ok: false, cancelled: true, error: 'Nothing was deleted.' }\n", ''],
  sDeleteBusy: [SVC, '    if (answer === \'busy\') return { ok: false, error: QUESTION_BUSY }\n', ''],
  sDeleteSilent: [SVC, "    if (snapshot !== null && snapshot.state === 'none') return { ok: true } // nothing to delete: nothing asked\n", ''],
  sDeleteWords: [SVC, "    yes: 'Delete the log',", "    yes: 'Always delete the log',"],
  sTitles: [SHT, "  web_search: 'Search the web'", "  web_search: 'Web search'"],
  // ----- the core writing into the log -----
  cCallId: [COR, 'return `${now().toString(36)}-${counter.toString(36)}-${Math.random().toString(36).slice(2, 8)}`', "return 'one-id'"],
  cSources: [COR, '        sources: result.sources.map(({ title, url }) => ({ title, url }))', '        sources: []'],
  cHref: [COR, '    href = new URL(url).href', '    href = url'],
  // ----- the wiring and the window -----
  wBridgeAppend: [PRE, "    deleteAll: () => ipcRenderer.invoke(CHANNELS.auditDeleteAll)", "    deleteAll: () => ipcRenderer.invoke(CHANNELS.auditDeleteAll),\n    append: (event: unknown) => ipcRenderer.invoke('audit:append', event)"],
  wHandlerExtra: [IPC, '  ipcMain.handle(CHANNELS.settingsStatus, guarded(currentStatus))', "  ipcMain.handle(CHANNELS.settingsStatus, guarded(currentStatus))\n  ipcMain.handle('audit:append', guarded(async () => true))"],
  wNotSealed: [IPC, '      auditLog.document,\n      toolSettings.file', '      toolSettings.file'],
  wReport: [UCS, 'your projects and the audit log of tool calls are encrypted too.', 'and your notes are encrypted too.'],
  wButton: [CB, '        Tools\n      </button>', '        Tool box\n      </button>'],
  wBusy: [CB, "        className=\"chat-button chat-tools\"\n        disabled={isReplying}", '        className="chat-button chat-tools"\n        disabled={false}'],
  wCancelError: [TD, "setNotice({ kind: result.cancelled ? 'ok' : 'error', text: result.error })", "setNotice({ kind: 'error', text: result.error })"],
  wEscape: [TD, '        if (busyRef.current) event.preventDefault()', '        void busyRef'],
  wLinks: [TD, '<span className="tools-source-url">{source.url}</span>', '<a className="tools-source-url" href={source.url}>{source.url}</a>'],
  wHtml: [TD, '<p className="tools-why">The model&apos;s reason: {call.why}</p>', '<p className="tools-why" dangerouslySetInnerHTML={{ __html: call.why }} />'],
  wBusyButtons: [TD, '          disabled={busy || view === null || !view.ok || (view.total === 0 && view.skipped === 0)}', '          disabled={view === null || !view.ok || (view.total === 0 && view.skipped === 0)}']
}

const node = {
  'n112-event-keys': [s.aKeys], 'n112-event-hidden': [s.aHidden], 'n112-event-url-scheme': [s.aUrlScheme], 'n112-event-url-ascii': [s.aUrlAscii], 'n112-event-url-safe': [s.aUrlSafe],
  'n112-event-sources-max': [s.aSourcesMax], 'n112-event-title-length': [s.aTitleLength], 'n112-event-step': [s.aStep], 'n112-event-size': [s.aSize], 'n112-event-time': [s.aTime],
  'n112-event-call-id': [s.aCallId], 'n112-event-tool-id': [s.aToolId], 'n112-event-args-max': [s.aArgsMax], 'n112-event-arg-name': [s.aArgName], 'n112-event-codes': [s.aCodes],
  'n112-event-answers': [s.aAnswers], 'n112-event-roundtrip': [s.aRoundtrip], 'n112-event-line-extra': [s.aLineExtra], 'n112-event-version': [s.aVersion],
  'n112-file-refused': [s.bRefused], 'n112-file-no-tail-check': [s.bTail], 'n112-file-no-readback': [s.bReadBack], 'n112-file-newline': [s.bNewline], 'n112-file-precheck': [s.bPrecheck],
  'n112-file-plain-when-sealed': [s.bPlainWhenSealed], 'n112-file-bom': [s.bBom], 'n112-file-partial-first': [s.bPartialFirst], 'n112-file-skip-count': [s.bSkipCount],
  'n112-file-sealed-count': [s.bSealedCount], 'n112-file-form-mixed': [s.bFormMixed], 'n112-file-remove-tmp': [s.bRemoveTmp], 'n112-file-remove-file': [s.bRemoveFile],
  'n112-mend-always': [s.bRecoverAlways], 'n112-mend-never': [s.bRecoverNever], 'n112-mend-cut': [s.bRecoverCut], 'n112-mend-deleted': [s.bRecoverDeleted],
  'n112-mend-whole-body': [s.bWholeBody], 'n112-mend-whole-count': [s.bWholeCount],
  'n112-conform-sealed': [s.bConformSealed], 'n112-conform-damaged': [s.bConformDamaged], 'n112-conform-proof': [s.bConformProof], 'n112-conform-already': [s.bConformAlready],
  'n112-conform-refused': [s.bConformRefused], 'n112-document-prefix': [s.bFormPrefix], 'n112-document-target': [s.bFormTarget],
  'n112-service-group': [s.sGroupById], 'n112-service-refused': [s.sOutcomeRefused], 'n112-service-declined': [s.sOutcomeDeclined], 'n112-service-view-order': [s.sViewOrder],
  'n112-service-view-limit': [s.sViewLimit], 'n112-service-export-inside': [s.sExportInside], 'n112-service-export-absolute': [s.sExportAbsolute], 'n112-service-export-order': [s.sExportOrder],
  'n112-service-export-quote': [s.sExportQuote], 'n112-service-export-empty': [s.sExportEmpty], 'n112-service-delete-no': [s.sDeleteNo], 'n112-service-delete-busy': [s.sDeleteBusy],
  'n112-service-delete-silent': [s.sDeleteSilent], 'n112-service-delete-words': [s.sDeleteWords], 'n112-service-titles': [s.sTitles],
  'n112-core-call-id': [s.cCallId], 'n112-core-sources': [s.cSources], 'n112-core-href': [s.cHref],
  'n112-reach-bridge': [s.wBridgeAppend], 'n112-reach-handler': [s.wHandlerExtra]
}

const win = {
  'w112-bridge-append': [s.wBridgeAppend],
  'w112-handler-extra': [s.wHandlerExtra],
  'w112-not-sealed': [s.wNotSealed],
  'w112-report-sentence': [s.wReport],
  'w112-button-label': [s.wButton],
  'w112-button-busy': [s.wBusy],
  'w112-cancel-as-error': [s.wCancelError],
  'w112-escape-while-asking': [s.wEscape],
  'w112-sources-as-links': [s.wLinks],
  'w112-reason-as-html': [s.wHtml],
  'w112-buttons-while-asking': [s.wBusyButtons],
  'w112-export-inside': [s.sExportInside],
  'w112-delete-no-deletes': [s.sDeleteNo],
  'w112-view-order': [s.sViewOrder],
  'w112-group-by-tool': [s.sGroupById]
}

const write = (dir, specs, argv, env, timeoutMs) => {
  mkdirSync(join(TOOLS, dir), { recursive: true })
  for (const [name, edits] of Object.entries(specs)) {
    writeFileSync(join(TOOLS, dir, `${name}.json`), JSON.stringify({ label: name, edits: edits.map(([file, from, to]) => ({ file, from, to })), argv, env, ...(timeoutMs ? { timeoutMs } : {}) }, null, 2) + '\n')
  }
}
write('specs112', node, ['{{TOOLS}}/verify-11-2.mjs'], {})
write('specs112w', win, ['{{TOOLS}}/run112.mjs', 'dev'], { NO_RETRY: '1' }, 600000)
