import { nativeImage, type BrowserWindow } from 'electron'
import { createVoiceGate } from './voiceGate'
import { DOT_SIZE, recordingDot, titleFor } from './voicePermissions'

// The microphone, under Electron (Stage 15.4, D-047): the gate (one for the app) and what shows that the microphone is on. The rules are voicePermissions.ts and
// voiceGate.ts (the session's handlers are in voicePermissions.ts, which Electron is only a type for, so they are checked under plain Node); this file needs Electron itself.

/** The one gate for the microphone. voiceService.ts opens it for a hold; the handlers below ask it. */
export const microphoneGate = createVoiceGate()

/**
 * What shows that the microphone is on, and is main's and not the page's: the window's title says so (the page cannot rename the window: its title changes are
 * cancelled here) and the taskbar button carries a red dot. When the window goes away the gate closes.
 */
export function showMicrophoneState(window: BrowserWindow): void {
  window.setTitle(titleFor(false))
  window.webContents.on('page-title-updated', (event) => event.preventDefault())
  const dot = nativeImage.createFromBitmap(recordingDot(), { width: DOT_SIZE, height: DOT_SIZE })
  const stop = microphoneGate.onChange((recording) => {
    if (window.isDestroyed()) return
    window.setTitle(titleFor(recording))
    if (process.platform === 'win32') {
      window.setOverlayIcon(recording ? dot : null, recording ? 'The microphone is on' : '')
    }
  })
  window.on('closed', () => {
    stop()
    microphoneGate.close()
  })
}
