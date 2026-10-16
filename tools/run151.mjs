// usage: node tools/guarded-window-copy.mjs tools/run151.mjs [mode=dev]
// Slice 15.1 (D-047), the probe: the real window with Chromium's FAKE microphone (a file of a tone that plays in a loop; no real microphone is opened) and the voices of this PC.
// It must be started through tools/guarded-window-copy.mjs (the run needs its own folder in C:\frontier-tmp, where the tone file is made).
import { runApp, scratch } from './drive.mjs'
import { mkdirSync, writeFileSync } from 'node:fs'
import { win32 } from 'node:path'

const mode = process.argv[2] ?? 'dev'
const tag = mode === 'preview' ? 'p-' : 'd-'
const run = process.env.FRONTIER_GUARD_ROOT
if (!run || !/^C:\\frontier-tmp\\guarded-w-[^\\]+$/i.test(run)) {
  console.error('run151.mjs must be started as: node tools/guarded-window-copy.mjs tools/run151.mjs (the run needs its own folder in C:\\frontier-tmp)')
  process.exit(2)
}

/** A mono 16-bit PCM WAV of a sine tone, `seconds` long: the file the fake microphone plays (Chromium loops it). */
export function toneWav(hz, seconds = 1, rate = 48000, amplitude = 0.3) {
  const n = Math.round(rate * seconds)
  const buf = Buffer.alloc(44 + n * 2)
  buf.write('RIFF', 0)
  buf.writeUInt32LE(36 + n * 2, 4)
  buf.write('WAVEfmt ', 8)
  buf.writeUInt32LE(16, 16)
  buf.writeUInt16LE(1, 20) // PCM
  buf.writeUInt16LE(1, 22) // mono
  buf.writeUInt32LE(rate, 24)
  buf.writeUInt32LE(rate * 2, 28)
  buf.writeUInt16LE(2, 32)
  buf.writeUInt16LE(16, 34)
  buf.write('data', 36)
  buf.writeUInt32LE(n * 2, 40)
  for (let i = 0; i < n; i++) buf.writeInt16LE(Math.round(Math.sin((2 * Math.PI * hz * i) / rate) * amplitude * 32767), 44 + i * 2)
  return buf
}

const HZ = 440
const dir = win32.join(run, 'voice')
mkdirSync(dir, { recursive: true })
const tone = win32.join(dir, 'tone-440.wav')
writeFileSync(tone, toneWav(HZ))
// the default flags of the harness (a covered window is not "hidden") + the fake microphone (and the fake camera, to see what the page could open) that auto-answers Chromium's own prompt
const FLAGS = `--disable-features=CalculateNativeWinOcclusion --disable-backgrounding-occluded-windows --disable-renderer-backgrounding --use-fake-device-for-media-stream --use-fake-ui-for-media-stream --use-file-for-fake-audio-capture=${tone}`

const result = runApp({
  label: `${tag}w151`,
  mode,
  scripts: 'probe-15-1.mjs',
  env: {
    USER_DATA_DIR: scratch('s151'),
    WIPE_USER_DATA: '1',
    INSPECT_PORT: '9237',
    FAKE_TONE_HZ: String(HZ),
    EXTRA_ELECTRON_ARGS: FLAGS
  },
  timeoutMs: 300000
})
console.log(`${result.passed}/${result.total} checks passed`)
for (const f of result.fails) console.log(String(f).trim())
process.exit(result.ok ? 0 : 1)
