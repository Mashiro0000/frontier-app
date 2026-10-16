import type { Session, WebContents } from 'electron'
import { isAppUrl } from './security'
import type { VoiceGate } from './voiceGate'

// What the window may ask of the system, and what tells the person the microphone is on (Stage 15.4, D-047). Plain functions that use Electron only for TYPES (nothing is
// imported from it at run time), so every rule is checked under plain Node with played requests and a played session; voiceWindow.ts needs Electron itself.
//
// Until this stage the chat window had NO permission handler, and Electron then grants every request the page makes: 15.1 measured that the page opened the microphone and the
// camera by itself, with no question. Now the answer is NO unless a rule below says yes:
//  - the microphone (`media` for audio ONLY) while main has opened the gate for a hold, to the app's own page, in the window's top frame, and nothing else in the same request
//    (a request for audio AND video is refused whole; so is a request that names no type, or one the app does not know);
//  - writing text to the clipboard (`clipboard-sanitized-write`, which "Copy" in the app uses), to the app's own page, in the top frame;
//  - nothing else: not the camera, not the screen, not reading the clipboard, not the location, notifications, fullscreen, devices (HID, USB, serial), midi, sensors...
// The same rules answer the CHECK a page makes before it asks (`navigator.permissions.query`, and the labels of devices), so a closed gate also hides the microphone's name.

export type PermissionKind = 'request' | 'check'

export interface PermissionAsk {
  kind: PermissionKind
  permission: string
  /** For a request: the types the page asked for at once (`audio`, `video`). */
  mediaTypes?: readonly string[]
  /** For a check: the one type asked about. */
  mediaType?: string
  /** The last address the asking frame loaded. A missing one is not the app's page. */
  requestingUrl?: string
  isMainFrame: boolean
  /** The asking web contents is the app's chat window (not another window, not no document at all). */
  fromMainWindow: boolean
}

export interface PermissionContext {
  /** The gate is open: main opened it for a hold that is going on. */
  mayRecord: boolean
  /** Whether an address is the app's own page. */
  isApp: (url: string) => boolean
}

/** True only for the two things the app uses. Everything else is false, whatever the name. */
export function permissionAllowed(ask: PermissionAsk, ctx: PermissionContext): boolean {
  if (!ask.fromMainWindow || !ask.isMainFrame) return false
  if (typeof ask.requestingUrl !== 'string' || !ctx.isApp(ask.requestingUrl)) return false
  switch (ask.permission) {
    case 'clipboard-sanitized-write':
      return true
    case 'media': {
      if (!ctx.mayRecord) return false
      if (ask.kind === 'check') return ask.mediaType === 'audio'
      return (
        Array.isArray(ask.mediaTypes) &&
        ask.mediaTypes.length === 1 &&
        ask.mediaTypes[0] === 'audio'
      )
    }
    default:
      return false
  }
}

/** The window's title: the page cannot set it (voiceWindow.ts stops the page from renaming the window), so these are main's words. */
export const NORMAL_TITLE = 'Frontier App'
export const RECORDING_TITLE = 'Frontier App - RECORDING (the microphone is on)'
export const titleFor = (recording: boolean): string => (recording ? RECORDING_TITLE : NORMAL_TITLE)

/** The red dot on the taskbar button while the microphone is on: 16 x 16 pixels, BGRA, a filled circle with a white ring, transparent outside it. */
export const DOT_SIZE = 16
export function recordingDot(): Buffer {
  const buffer = Buffer.alloc(DOT_SIZE * DOT_SIZE * 4)
  const centre = (DOT_SIZE - 1) / 2
  for (let y = 0; y < DOT_SIZE; y++) {
    for (let x = 0; x < DOT_SIZE; x++) {
      const distance = Math.hypot(x - centre, y - centre)
      const at = (y * DOT_SIZE + x) * 4
      if (distance <= 5.5) {
        buffer.set([0x1c, 0x1c, 0xd8, 0xff], at) // red (B, G, R, A)
      } else if (distance <= 7.2) {
        buffer.set([0xff, 0xff, 0xff, 0xff], at) // the white ring that keeps it seen on a dark taskbar
      }
    }
  }
  return buffer
}

interface RequestDetails {
  mediaTypes?: string[]
  requestingUrl?: string
  isMainFrame?: boolean
}
interface CheckDetails {
  mediaType?: string
  requestingUrl?: string
  isMainFrame?: boolean
}

/**
 * Puts the permission rules under the session the chat window uses. DENY BY DEFAULT: a request or a check is answered by `permissionAllowed` and by nothing else,
 * and the devices the page could ask to open itself (HID, USB, serial) are refused. `chatContents` is the chat window's page, read at every question (the window can be
 * made again).
 */
export function installPermissionHandlers(
  ses: Session,
  appUrl: string,
  gate: Pick<VoiceGate, 'mayOpenMicrophone'>,
  chatContents: () => WebContents | null
): void {
  const context = (): PermissionContext => ({
    mayRecord: gate.mayOpenMicrophone(),
    isApp: (url) => isAppUrl(url, appUrl)
  })
  ses.setPermissionRequestHandler((contents, permission, callback, details) => {
    const d = details as RequestDetails
    const ask: PermissionAsk = {
      kind: 'request',
      permission,
      mediaTypes: d.mediaTypes,
      requestingUrl: d.requestingUrl,
      isMainFrame: d.isMainFrame === true,
      fromMainWindow: contents === chatContents()
    }
    callback(permissionAllowed(ask, context()))
  })
  ses.setPermissionCheckHandler((contents, permission, _origin, details) => {
    const d = details as unknown as CheckDetails
    const ask: PermissionAsk = {
      kind: 'check',
      permission,
      mediaType: d.mediaType,
      requestingUrl: d.requestingUrl,
      isMainFrame: d.isMainFrame === true,
      fromMainWindow: contents !== null && contents === chatContents()
    }
    return permissionAllowed(ask, context())
  })
  ses.setDevicePermissionHandler(() => false)
}
