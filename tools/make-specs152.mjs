// Writes the negative-control specs for slice 15.2 (voice: the rules, D-047): one sabotage each, which verify-15-2.mjs must notice.
// usage: node tools/make-specs152.mjs
//   then: FRONTIER_MAY_REMOVE=1 FRONTIER_KEEP_TEMP=1 TEMP=C:\frontier-tmp TMP=C:\frontier-tmp node tools/nc-all.mjs specs152 <names...>
//   (nc.mjs backs the file up in the temp folder, sabotages it, runs the suite and puts it back, proved by its hash; it removes nothing. The suite runs under the wrapper of
//   tools/guarded.mjs.)
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { TOOLS } from './paths.mjs'

const SHARED = '{{REPO}}/src/shared/voice.ts'
const SETTINGS = '{{REPO}}/src/main/voiceSettings.ts'
const CLIP = '{{REPO}}/src/main/voiceClip.ts'
const GATE = '{{REPO}}/src/main/voiceGate.ts'
const SPEECH = '{{REPO}}/src/renderer/src/voice/speechText.ts'

// name: [suite, ONLY (or null), file, from, to]
const controls = {
  // ---- the shared part ----
  sLongHold: ['15-2', 'A', SHARED, '  maxClipSeconds: 60,', '  maxClipSeconds: 600,'],
  sShortHold: ['15-2', 'A', SHARED, '  minClipMs: 300,', '  minClipMs: 30,'],
  sBigClip: ['15-2', 'A', SHARED, '  maxClipBytes: 1_048_576,', '  maxClipBytes: 10_485_760,'],
  sFee: ['15-2', 'A', SHARED, '(Math.max(1, Math.ceil(seconds)) / 60) * TRANSCRIBE_USD_PER_MINUTE', '(seconds / 60) * TRANSCRIBE_USD_PER_MINUTE'],
  sReversing: ['15-2', 'A', SHARED, '    if ((code >= 0x202a && code <= 0x202e) || (code >= 0x2066 && code <= 0x2069) || code === 0xfeff)', '    if (false)'],
  sRateWhole: ['15-2', 'A', SHARED, '  Number.isInteger(value) &&\n', ''],
  // ---- voice.json ----
  jFields: ['15-2', 'B', SETTINGS, "  if (keys !== 'listen,rate,speak,version,voice' || raw.version !== VOICE_SETTINGS_VERSION) {", '  if (raw.version !== VOICE_SETTINGS_VERSION) {'],
  jBoolean: ['15-2', 'B', SETTINGS, "  if (typeof listen !== 'boolean' || typeof speak !== 'boolean') return null", '  if (false) return null'],
  jVoice: ['15-2', 'B', SETTINGS, '  if (voice !== null && !isVoiceName(voice)) return null', '  if (false) return null'],
  jRate: ['15-2', 'B', SETTINGS, '  if (!isRate(rate)) return null', '  if (false) return null'],
  jDamagedOn: ['15-2', 'B', SETTINGS, '          return { settings: DEFAULT_VOICE_SETTINGS, problem: current.why }', '          return { settings: { ...DEFAULT_VOICE_SETTINGS, listen: true }, problem: current.why }'],
  // ---- the clip and the words ----
  cWebm: ['15-2', 'C', CLIP, '  if (!looksLikeWebm(bytes)) return refused()', ''],
  cMagic: ['15-2', 'C', CLIP, '  if (bytes.length < 16 || !hasAt(bytes, 0, EBML)) return false', '  if (bytes.length < 16) return false'],
  cDocType: ['15-2', 'C', CLIP, '  for (let i = 4; i <= end; i++) if (hasAt(bytes, i, DOCTYPE)) return true\n  return false', '  return true'],
  cShort: ['15-2', 'C', CLIP, '  if (ms < VOICE_LIMITS.minClipMs) return', '  if (false) return'],
  cLongest: ['15-2', 'C', CLIP, '|| ms < 0 || ms > longest) return refused()', '|| ms < 0) return refused()'],
  cShape: ['15-2', 'C', CLIP, "  if (keys !== 'bytes,ms') return refused()", ''],
  cSize: ['15-2', 'C', CLIP, "  if (bytes === null || bytes.length === 0 || bytes.length > VOICE_LIMITS.maxClipBytes) {", "  if (bytes === null || bytes.length === 0) {"],
  cLie: ['15-2', 'C', CLIP, 'Math.ceil(ms / 1000), Math.ceil(bytes.length / MAX_BYTES_PER_SECOND))', 'Math.ceil(ms / 1000))'],
  cCopy: ['15-2', 'C', CLIP, 'clip: Buffer.from(bytes), seconds', 'clip: Buffer.from(bytes.buffer, bytes.byteOffset, bytes.length), seconds'],
  cControls: ['15-2', 'C', CLIP, '    if (code < 0x20 || (code >= 0x7f && code <= 0x9f)) continue\n    if (code === 0x2028', '    if (code === 0x2028'],
  cBidi: ['15-2', 'C', CLIP, '    if (code >= 0x202a && code <= 0x202e) continue\n', ''],
  cCap: ['15-2', 'C', CLIP, '  if (out.length > VOICE_LIMITS.maxTranscriptChars) {', '  if (false) {'],
  cPair: ['15-2', 'C', CLIP, '    if (last >= 0xd800 && last <= 0xdbff) out = out.slice(0, -1)', ''],
  // ---- the gate ----
  gBusy: ['15-2', 'D', GATE, "      if (armed) return { ok: false, why: 'busy' }", ''],
  gSelfClose: ['15-2', 'D', GATE, '      }, maxMs + VOICE_LIMITS.graceMs)', '      }, 1e12)'],
  gBurst: ['15-2', 'D', GATE, '      if (holds.length > VOICE_LIMITS.burstHolds) {', '      if (false) {'],
  gRest: ['15-2', 'D', GATE, "      if (at < restingUntil) return { ok: false, why: 'resting' }", ''],
  gClosedMeansClosed: ['15-2', 'D', GATE, '    mayOpenMicrophone: () => armed,', '    mayOpenMicrophone: () => true,'],
  gStaleTimer: ['15-2', 'D', GATE, '    if (timer !== null) timers.clear(timer)\n', ''],
  // ---- what is said ----
  eCode: ['15-2', 'E', SPEECH, "      out.push('Code block.')", '      out.push(block.text)'],
  eInlineCode: ['15-2', 'E', SPEECH, "        out += node.text.length <= 40 ? node.text : 'code'", '        out += node.text'],
  eAddress: ['15-2', 'E', SPEECH, "    const end = /[.,;:!?]+$/.exec(found)?.[0] ?? ''", "    const end = ''"],
  ePieceSize: ['15-2', 'E', SPEECH, "        if (current !== '' && current.length + part.length > size) flush()", '        if (false) flush()'],
  eTruncate: ['15-2', 'E', SPEECH, '    if (used + piece.length > max) {', '    if (false) {']
}

mkdirSync(join(TOOLS, 'specs152'), { recursive: true })
for (const [name, [suite, only, file, from, to]] of Object.entries(controls)) {
  // (nc.mjs puts `to` in with String.replace: a `$` followed by one of these would be read as a pattern, not as text)
  if (typeof file !== 'string' || typeof from !== 'string' || typeof to !== 'string' || /\$[$&`'0-9<]/.test(to)) throw new Error(`the control ${name} is not well formed`)
  const spec = {
    label: `n152-${name}`,
    edits: [{ file, from, to }],
    argv: ['{{TOOLS}}/guarded.mjs', `{{TOOLS}}/verify-${suite}.mjs`],
    env: only === null ? {} : { ONLY: only },
    timeoutMs: 400000
  }
  writeFileSync(join(TOOLS, 'specs152', `n152-${name}.json`), JSON.stringify(spec, null, 2) + '\n')
}
console.log(`wrote ${Object.keys(controls).length} specs in specs152`)
