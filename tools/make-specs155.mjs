// Writes the negative-control specs for slice 15.5 (voice: the service, the ledger's audio fee and the wiring, D-047): one sabotage each, which the named suite must notice.
// usage: node tools/make-specs155.mjs
//   then: FRONTIER_MAY_REMOVE=1 FRONTIER_KEEP_TEMP=1 TEMP=C:\frontier-tmp TMP=C:\frontier-tmp node tools/nc-all.mjs specs155 <names...>
//   and for the window controls (they change a COPY of the tree): node tools/guarded-window-copy.mjs tools/nc-all.mjs specs155w <names...>
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { TOOLS } from './paths.mjs'

const SVC = '{{REPO}}/src/main/voiceService.ts'
const USAGE = '{{REPO}}/src/shared/usage.ts'
const LEDGER = '{{REPO}}/src/main/usageLedger.ts'
const IPC = '{{REPO}}/src/main/ipc.ts'
const COPY = '{{REPO}}/src/renderer/src/useCopy.ts'
const PERM = '{{REPO}}/src/main/voicePermissions.ts'
const WIN = '{{REPO}}/src/main/voiceWindow.ts'
const INDEX = '{{REPO}}/src/main/index.ts'

const SHAPE = "        if (!exactly(input, 'on') || typeof input.on !== 'boolean') {\n          return { ok: false, error: NOT_UNDERSTOOD }\n        }\n"
const OFF = "          mic.close()\n          inFlight?.abort()\n          return write({ ...now.settings, listen: false })"
const FINISH_STATE = "          state: failed?.rejected ? 'rejected' : failed?.stopped ? 'stopped' : 'failed',"
const CANCEL = "    cancel: () => {\n      mic.close()\n      inFlight?.abort()\n    }"
const END_SHUT = "      if (!mic.close()) return { ok: false, kind: 'refused', error: VOICE_WORDS.notTheClip }\n"
const BEGIN_CHECK = "      if (problem !== null || !settings.listen) return { ok: false, error: VOICE_WORDS.off }\n      if ((await options.key()) === null) return { ok: false, error: VOICE_WORDS.noKey }\n      try {"

// name: [suite, ONLY (or null), file, from, to]
const controls = {
  // ---- the switches ----
  sShape: ['15-5', 'B', SVC, SHAPE + '        const now = await current()\n        if (!now.ok) return now\n        if (!input.on) {', '        const now = await current()\n        if (!now.ok) return now\n        if (!(input as { on?: boolean }).on) {'],
  sNoQuestion: ['15-5', 'B', SVC, '        const answer = await gate.ask(owner, listenOnQuestion())', "        const answer = 'yes'"],
  sOnlyYes: ['15-5', 'B', SVC, "        if (answer !== 'yes') return { ok: false, error: NOT_ON }", ''],
  sBusy: ['15-5', 'B', SVC, "        if (answer === 'busy') return { ok: false, error: QUESTION_BUSY }", ''],
  sKeyFirst: ['15-5', 'B', SVC, '        if ((await options.key()) === null) return { ok: false, error: VOICE_WORDS.noKey }\n        const answer', '        const answer'],
  sOffCloses: ['15-5', 'B', SVC, OFF, "          return write({ ...now.settings, listen: false })"],
  sOffAborts: ['15-5', 'D', SVC, OFF, "          mic.close()\n          return write({ ...now.settings, listen: false })"],
  sDamaged: ['15-5', 'B', SVC, '    return problem !== null ? { ok: false, error: changeRefused(problem) } : { ok: true, settings }', '    return { ok: true, settings }'],
  sVoiceName: ['15-5', 'B', SVC, '        if ((voice !== null && !isVoiceName(voice)) || !isRate(rate)) {', '        if (false) {'],
  sSpeakShape: ['15-5', 'B', SVC, SHAPE + '        const now = await current()\n        if (!now.ok) return now\n        return write({ ...now.settings, speak: input.on })', '        const now = await current()\n        if (!now.ok) return now\n        return write({ ...now.settings, speak: Boolean((input as { on?: boolean } | null)?.on) })'],
  // ---- the hold ----
  hOff: ['15-5', 'C', SVC, BEGIN_CHECK, "      if ((await options.key()) === null) return { ok: false, error: VOICE_WORDS.noKey }\n      try {"],
  hKey: ['15-5', 'C', SVC, BEGIN_CHECK, "      if (problem !== null || !settings.listen) return { ok: false, error: VOICE_WORDS.off }\n      try {"],
  hLimits: ['15-5', 'C', SVC, '        if (refusal !== null) return { ok: false, error: refusal }', ''],
  hArm: ['15-5', 'C', SVC, "      if (!armed.ok) {\n        return { ok: false, error: armed.why === 'busy' ? VOICE_WORDS.busy : VOICE_WORDS.resting }\n      }\n", ''],
  // ---- the clip ----
  eShutFirst: ['15-5', 'D', SVC, END_SHUT, '      mic.close()\n'],
  eNoHold: ['15-5', 'D', SVC, END_SHUT, ''],
  eCheckClip: ['15-5', 'D', SVC, '      if (!clip.ok) return { ok: false, kind: clip.kind, error: clip.error }\n', ''],
  eStillOn: ['15-5', 'D', SVC, "      if (problem !== null || !settings.listen) {\n        return { ok: false, kind: 'refused', error: VOICE_WORDS.off }\n      }\n", ''],
  eKeyGone: ['15-5', 'D', SVC, "      if (apiKey === null) return { ok: false, kind: 'refused', error: VOICE_WORDS.noKey }\n", ''],
  eLimitsInLedger: ['15-5', 'D', SVC, '          (spend) => checkAgainstLimits(chosen, spend)', '          undefined'],
  eReserve: ['15-5', 'D', SVC, '            reserveUsd: audioFeeUsd(reserved),\n', ''],
  eProviderSeconds: ['15-5', 'D', SVC, '          heard.providerSeconds !== null\n            ? Math.max(1, Math.ceil(heard.providerSeconds))\n            : clip.seconds', '          clip.seconds'],
  eGuessFlag: ['15-5', 'D', SVC, '          estimate: heard.providerSeconds === null,', '          estimate: false,'],
  eClean: ['15-5', 'D', SVC, '        const text = cleanTranscript(heard.text)', '        const text: string | null = heard.text'],
  eRejected: ['15-5', 'D', SVC, FINISH_STATE, "          state: 'failed',"],
  eStopped: ['15-5', 'D', SVC, FINISH_STATE, "          state: failed?.rejected ? 'rejected' : 'failed',"],
  eCancelAborts: ['15-5', 'D', SVC, CANCEL, '    cancel: () => {\n      mic.close()\n    }'],
  eCancelCloses: ['15-5', 'C', SVC, CANCEL, '    cancel: () => {\n      inFlight?.abort()\n    }'],
  // ---- the cost ----
  fFee: ['15-5', 'F', USAGE, '  (Math.max(1, Math.ceil(fee.seconds)) / 60) * fee.usdPerMinute', '  (fee.seconds / 60) * fee.usdPerMinute'],
  fCost: ['15-5', 'D', USAGE, '  (record.audio === undefined ? 0 : audioFeeUsd(record.audio))', '  0'],
  fParseKind: ['15-5', 'F', USAGE, "      audio.kind !== 'transcribe' ||\n", ''],
  fParseMax: ['15-5', 'F', USAGE, '      (audio.seconds as number) > 3600 ||\n', ''],
  fParseExtra: ['15-5', 'F', USAGE, "      Object.keys(audio).sort().join() !== 'kind,seconds,usdPerMinute' ||\n", ''],
  fLedgerBegin: ['15-5', 'D', LEDGER, '          ...(input.audio === undefined ? {} : { audio: { ...input.audio } })', ''],
  fLedgerFinish: ['15-5', 'D', LEDGER, '          ...(outcome.audio === undefined ? {} : { audio: { ...outcome.audio } })', ''],
  // ---- the wiring ----
  wKept: ['15-5', 'G', IPC, '      connectorStore.file,\n      voiceSettings.file\n    ])', '      connectorStore.file\n    ])'],
  wIdle: ['15-5', 'G', IPC, '      voiceSettings.file.whenIdle(),\n', ''],
  wQuit: ['15-5', 'G', IPC, '    voice.cancel() // a recording or a clip on its way ends with the app\n', ''],
  wGuard: ['15-5', 'G', IPC, '    CHANNELS.voiceBegin,\n    guarded(', '    CHANNELS.voiceBegin,\n    ('],
  wKey: ['15-5', 'G', IPC, "    key: () => readApiKey('openai'),", "    key: () => readApiKey('anthropic'),"]
}

// the window controls: they change a copy of the tree (tools/guarded-window-copy.mjs tools/nc-all.mjs specs155w ...); [runner, file, from, to]
const windowControls = {
  gClosedGate: ['run155.mjs', PERM, '      if (!ctx.mayRecord) return false', ''],
  gWindowTitle: ['run155.mjs', WIN, "  window.on('page-title-updated', (event) => event.preventDefault())", "  window.on('page-title-updated', () => {})"],
  gTitleSet: ['run155.mjs', WIN, '    window.setTitle(titleFor(recording))', '    void titleFor(recording)'],
  gDefaultSession: ['run155.mjs', INDEX, '    session.defaultSession,', "    session.fromPartition('somewhere-else'),"],
  gVideo: ['run155.mjs', PERM, '        ask.mediaTypes.length === 1 &&\n', ''],
  gBegin: ['run155.mjs', SVC, '      const armed = mic.arm()', '      const armed = { ok: true as const, maxMs: 60000 }'],
  // (the first version ran 7.2's suite, which clicks Copy with the async clipboard API working, so it never needed the old way: it passed with the fallback broken. 15.6's suite makes that API fail on purpose.)
  cCopyFallback: ['run156.mjs', COPY, "    return document.execCommand('copy')", '    return false']
}

for (const name of Object.keys(controls)) if (name in windowControls) throw new Error(`a control is in both lists: ${name}`)
const check = (name, file, from, to) => {
  if (typeof file !== 'string' || typeof from !== 'string' || typeof to !== 'string' || /\$[$&`'0-9<]/.test(to)) throw new Error(`the control ${name} is not well formed`)
}
mkdirSync(join(TOOLS, 'specs155'), { recursive: true })
for (const [name, [suite, only, file, from, to]] of Object.entries(controls)) {
  check(name, file, from, to)
  const spec = { label: `n155-${name}`, edits: [{ file, from, to }], argv: ['{{TOOLS}}/guarded.mjs', `{{TOOLS}}/verify-${suite}.mjs`], env: only === null ? {} : { ONLY: only }, timeoutMs: 400000 }
  writeFileSync(join(TOOLS, 'specs155', `n155-${name}.json`), JSON.stringify(spec, null, 2) + '\n')
}
mkdirSync(join(TOOLS, 'specs155w'), { recursive: true })
for (const [name, [runner, file, from, to]] of Object.entries(windowControls)) {
  check(name, file, from, to)
  const spec = { label: `w155-${name}`, edits: [{ file, from, to }], argv: [`{{TOOLS}}/${runner}`, 'dev'], env: { NO_RETRY: '1', ...(runner === 'run156.mjs' ? { STOP_AFTER: 'A' } : {}) }, timeoutMs: 600000 }
  writeFileSync(join(TOOLS, 'specs155w', `w155-${name}.json`), JSON.stringify(spec, null, 2) + '\n')
}
console.log(`wrote ${Object.keys(controls).length} specs in specs155 and ${Object.keys(windowControls).length} in specs155w`)
