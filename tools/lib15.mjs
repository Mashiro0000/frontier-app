// Helpers for the Stage 15 window runs (voice, D-047). Test tooling only.
import { mkdirSync, writeFileSync } from 'node:fs'
import { win32 } from 'node:path'

/** A mono 16-bit PCM WAV of a sine tone, `seconds` long: the file Chromium's fake microphone plays (it loops it). */
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

/**
 * The Chromium flags of a window run with the FAKE microphone (NOT `--use-fake-ui-for-media-stream`: that switch answers the request inside Chromium and the app's permission handler is never asked,
 * which hid the gate from 15.5's first run): the harness's default flags (a covered window is not "hidden"), the fake devices (and the fake camera, to see
 * what the page could open) and a tone file made in the run's own folder `run` (C:\frontier-tmp\guarded-w-...).
 */
export function fakeMicrophoneFlags(run, hz = 440) {
  const dir = win32.join(run, 'voice')
  mkdirSync(dir, { recursive: true })
  const tone = win32.join(dir, `tone-${hz}.wav`)
  writeFileSync(tone, toneWav(hz))
  return `--disable-features=CalculateNativeWinOcclusion --disable-backgrounding-occluded-windows --disable-renderer-backgrounding --use-fake-device-for-media-stream --use-file-for-fake-audio-capture=${tone}`
}
