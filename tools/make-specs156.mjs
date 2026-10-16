// Writes the negative-control specs for slices 15.6 and 15.7 (voice: the page, and what is kept, D-047): one sabotage each, which the named suite must notice.
// usage: node tools/make-specs156.mjs
//   then: FRONTIER_MAY_REMOVE=1 FRONTIER_KEEP_TEMP=1 TEMP=C:\frontier-tmp TMP=C:\frontier-tmp node tools/nc-all.mjs specs156 <names...>
//   and for the window controls (they change a COPY of the tree): node tools/guarded-window-copy.mjs tools/nc-all.mjs specs156w <names...>
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { TOOLS } from './paths.mjs'

const SPEAKER = '{{REPO}}/src/renderer/src/voice/speaker.ts'
const LISTEN = '{{REPO}}/src/renderer/src/voice/useListen.ts'
const MIC = '{{REPO}}/src/renderer/src/voice/MicButton.tsx'
const COMPOSER = '{{REPO}}/src/renderer/src/chat/Composer.tsx'
const ACTIONS = '{{REPO}}/src/renderer/src/chat/MessageActions.tsx'
const SECTION = '{{REPO}}/src/renderer/src/settings/VoiceSection.tsx'
const DIALOG = '{{REPO}}/src/renderer/src/settings/SettingsDialog.tsx'
const COPY = '{{REPO}}/src/renderer/src/useCopy.ts'
const STORE = '{{REPO}}/src/main/voiceSettings.ts'
const SVC = '{{REPO}}/src/main/voiceService.ts'
const UPLOAD = '{{REPO}}/src/main/providers/openaiAudio.ts'
const USAGE = '{{REPO}}/src/shared/usage.ts'
const IPC = '{{REPO}}/src/main/ipc.ts'
const BACKUP = '{{REPO}}/src/main/backupService.ts'

const TRUNC = "        notice: reading.truncated\n          ? `Only the first ${VOICE_LIMITS.readMaxChars.toLocaleString('en-US')} characters of this reply are read aloud.`\n          : null\n"
const READ_USER = "message.role === 'assistant' && message.content !== '' && !arriving"
const HANDLER_END = '    inputRef.current?.focus()\n  })'

// name: [suite, ONLY (or null), file, from, to]
const controls = {
  // ---- 15.6: reading a reply aloud (verify-15-6.mjs) ----
  spOnend: ['15-6', 'B', SPEAKER, '        utterance.onend = () => next(index + 1)\n', ''],
  spToken: ['15-6', 'C', SPEAKER, '        if (token !== mine) return\n        if (index >= reading.pieces.length) {', '        if (index >= reading.pieces.length) {'],
  spCancel: ['15-6', 'C', SPEAKER, '    token++\n    api()?.cancel()\n', '    token++\n'],
  spTokenStop: ['15-6', 'C', SPEAKER, '    token++\n    api()?.cancel()', '    api()?.cancel()'],
  spInterrupted: ['15-6', 'E', SPEAKER, "          if (event.error === 'interrupted' || event.error === 'canceled') return\n", ''],
  spErrorEnds: ['15-6', 'E', SPEAKER, '          token++\n          set({ speaking: null, notice: FAILED })', '          set({ speaking: null, notice: FAILED })'],
  spRate: ['15-6', 'F', SPEAKER, '      const rate = Math.min(2, Math.max(0.5, options.rate / 100))', '      const rate = options.rate / 100'],
  spVoice: ['15-6', 'F', SPEAKER, '        if (voice !== null) {\n          utterance.voice = voice\n          utterance.lang = voice.lang\n        }\n', ''],
  spLang: ['15-6', 'F', SPEAKER, '          utterance.lang = voice.lang\n', ''],
  spTruncNote: ['15-6', 'G', SPEAKER, TRUNC, '        notice: null\n'],
  spNoVoices: ['15-6', 'A', SPEAKER, '      if (speech.getVoices().length === 0) {\n        set({ speaking: null, notice: NO_VOICE })\n        return\n      }\n', ''],
  spEmpty: ['15-6', 'A', SPEAKER, "      if (reading.pieces.length === 0) {\n        set({ speaking: null, notice: 'There is nothing in this reply to read aloud.' })\n        return\n      }\n", ''],
  spWait: ['15-6', 'H', SPEAKER, 'waited < 3000', 'waited < 0'],
  spStopFirst: ['15-6', 'D', SPEAKER, '      const speech = api()\n      stop()\n', '      const speech = api()\n'],
  // ---- 15.6: what the page may do (the source checks) ----
  jComposerSend: ['15-6', 'J', COMPOSER, HANDLER_END, '    inputRef.current?.focus()\n    onSend(words)\n  })'],
  jReadAlways: ['15-6', 'J', ACTIONS, `voice?.speak === true && ${READ_USER}`, READ_USER],
  jReadUser: ['15-6', 'J', ACTIONS, `voice?.speak === true && ${READ_USER}`, "voice?.speak === true && message.content !== '' && !arriving"],
  jReadArriving: ['15-6', 'J', ACTIONS, `voice?.speak === true && ${READ_USER}`, "voice?.speak === true && message.role === 'assistant' && message.content !== ''"],
  jReadAuto: ['15-6', 'J', COMPOSER, HANDLER_END, "    inputRef.current?.focus()\n    speaker.speak('dictated', words, { voice: null, rate: 100 })\n  })"],
  jOpenElsewhere: ['15-6', 'J', MIC, '        listen.press()\n      }}\n      onPointerUp', "        void navigator.mediaDevices.getUserMedia({ audio: true })\n        listen.press()\n      }}\n      onPointerUp"],
  jStorage: ['15-6', 'J', LISTEN, '      if (result.ok) onTextRef.current(result.text)', "      if (result.ok) {\n        localStorage.setItem('words', result.text)\n        onTextRef.current(result.text)\n      }"],
  // ---- 15.7: what is kept, sealed, backed up (verify-15-7.mjs) ----
  kBox: ['15-7', 'A', STORE, '    box: options.box,', '    box: undefined,'],
  kKeys: ['15-7', 'B', STORE, "  if (keys !== 'listen,rate,speak,version,voice' || raw.version !== VOICE_SETTINGS_VERSION) {", '  if (raw.version !== VOICE_SETTINGS_VERSION) {'],
  kBytes: ['15-7', 'B', STORE, 'const MAX_FILE_BYTES = 4 * 1024', 'const MAX_FILE_BYTES = 1024 * 1024'],
  kList: ['15-7', 'E', IPC, '      connectorStore.file,\n      voiceSettings.file,\n      imageSettings.file,\n      imageIndex\n    ])', '      connectorStore.file\n    ])'],
  kIdle: ['15-7', 'E', IPC, '      voiceSettings.file.whenIdle(),\n', ''],
  kBackupNames: ['15-7', 'C', BACKUP, "import { randomUUID } from 'crypto'\n", "import { randomUUID } from 'crypto'\nconst voiceSettingsName = 'voice.json'\nvoid voiceSettingsName\n"],
  kLogs: ['15-7', 'D', SVC, "        console.error('Counting a recording failed:', reason(error))", "        console.error('Counting a recording failed:', reason(error), clip)"],
  kFs: ['15-7', 'D', SVC, "import { checkAgainstLimits, limitsAreSet, unsetLimits } from '../shared/limits'\n", "import { writeFileSync } from 'node:fs'\nimport { checkAgainstLimits, limitsAreSet, unsetLimits } from '../shared/limits'\n"],
  kUpload: ['15-7', 'D', UPLOAD, "toFile(clip, 'clip.webm'", "toFile(readFileSync('clip.webm'), 'clip.webm'"],
  kAudioExtra: ['15-7', 'D', USAGE, "      Object.keys(audio).sort().join() !== 'kind,seconds,usdPerMinute' ||\n", ''],
  kStoragePage: ['15-7', 'D', LISTEN, '      if (result.ok) onTextRef.current(result.text)', "      if (result.ok) {\n        localStorage.setItem('words', result.text)\n        onTextRef.current(result.text)\n      }"]
}

// the window controls (they change a COPY of the tree: tools/guarded-window-copy.mjs tools/nc-all.mjs specs156w ...), the suite is run156.mjs and STOP_AFTER ends it after the part that must notice;
// name: [stopAfter, file, from, to]
const windowControls = {
  aCopyFallback: ['A', COPY, "    return document.execCommand('copy')", '    return false'],
  bMicAlways: ['A', COMPOSER, '{voice?.listen === true && <MicButton listen={listen} />}', '<MicButton listen={listen} />'],
  bReadAlways: ['A', ACTIONS, `voice?.speak === true && ${READ_USER}`, READ_USER],
  bReadUser: ['B', ACTIONS, `voice?.speak === true && ${READ_USER}`, "voice?.speak === true && message.content !== '' && !arriving"],
  bWaiting: ['B', SECTION, "    setNotice(waits ? { kind: 'ok', text: WAITING } : null)", '    setNotice(null)'],
  bReloadOpen: ['B', SECTION, '    if (!open) return\n    reloadVoiceStatus()\n', '    if (!open) return\n'],
  bNoSection: ['B', DIALOG, '      <VoiceSection key={`voice:${session}`} open={open} />\n', ''],
  cAppend: ['C', COMPOSER, "    setText((now) => (now === '' ? words : `${now}${/\\s$/.test(now) ? '' : ' '}${words}`))", '    setText(words)'],
  cFocus: ['C', COMPOSER, HANDLER_END, '  })'],
  cSend: ['C', COMPOSER, HANDLER_END, '    inputRef.current?.focus()\n    onSend(words)\n  })'],
  cCapture: ['C', MIC, '        event.currentTarget.setPointerCapture(event.pointerId)\n', ''],
  dBlur: ['D', LISTEN, "    window.addEventListener('blur', away)\n", ''],
  dVisible: ['D', LISTEN, "      if (document.visibilityState === 'hidden') cancel()", '      cancel()'],
  dHidden: ['D', LISTEN, "    document.addEventListener('visibilitychange', hidden)\n", ''],
  dEscape: ['D', MIC, "        if (event.key === 'Escape') {\n          listen.cancel()", '        if (false) {\n          listen.cancel()'],
  dTap: ['D', LISTEN, '      if (stopWanted.current) made.stop()\n', ''],
  eGum: ['E', LISTEN, '        void window.api.voice.cancel().catch(() => undefined)\n        setNotice(microphoneProblem(error))', '        setNotice(microphoneProblem(error))'],
  fReadArriving: ['F', ACTIONS, `voice?.speak === true && ${READ_USER}`, "voice?.speak === true && message.role === 'assistant' && message.content !== ''"],
  fStopClose: ['F', SECTION, '      speaker.stop() // a "Try the voice" does not go on after Settings is closed\n', ''],
  fVoicePick: ['F', ACTIONS, '                  voice: voice?.voice ?? null,', '                  voice: null,'],
  fRate: ['F', ACTIONS, '                  rate: voice?.rate ?? 100', '                  rate: 100'],
  hProblem: ['H', SECTION, '              disabled={busy || status.problem !== null}', '              disabled={busy}'],
  hConfirm: ['H', SECTION, '              onClick={() => setStarting(true)}', "              onClick={() => void change(() => window.api.voice.reset(), false, 'The voice settings start again.')}"]
}

for (const name of Object.keys(controls)) if (name in windowControls) throw new Error(`a control is in both lists: ${name}`)
const check = (name, file, from, to) => {
  if (typeof file !== 'string' || typeof from !== 'string' || typeof to !== 'string' || /\$[$&`'0-9<]/.test(to)) throw new Error(`the control ${name} is not well formed`)
}
mkdirSync(join(TOOLS, 'specs156'), { recursive: true })
for (const [name, [suite, only, file, from, to]] of Object.entries(controls)) {
  check(name, file, from, to)
  const spec = { label: `n156-${name}`, edits: [{ file, from, to }], argv: ['{{TOOLS}}/guarded.mjs', `{{TOOLS}}/verify-${suite}.mjs`], env: only === null ? {} : { ONLY: only }, timeoutMs: 400000 }
  writeFileSync(join(TOOLS, 'specs156', `n156-${name}.json`), JSON.stringify(spec, null, 2) + '\n')
}
mkdirSync(join(TOOLS, 'specs156w'), { recursive: true })
for (const [name, [stopAfter, file, from, to]] of Object.entries(windowControls)) {
  check(name, file, from, to)
  const spec = { label: `w156-${name}`, edits: [{ file, from, to }], argv: ['{{TOOLS}}/run156.mjs', 'dev'], env: { NO_RETRY: '1', STOP_AFTER: stopAfter }, timeoutMs: 1800000 }
  writeFileSync(join(TOOLS, 'specs156w', `w156-${name}.json`), JSON.stringify(spec, null, 2) + '\n')
}
console.log(`wrote ${Object.keys(controls).length} specs in specs156 and ${Object.keys(windowControls).length} in specs156w`)
