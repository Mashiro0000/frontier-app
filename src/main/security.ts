// Rules for where the window may go, what it may hand to the operating system, and who may talk to
// the main process. Plain functions with no Electron imports, so they can be checked without
// starting the app.

/** True if `url` is the app's own page. A different hash or query string on the same page is fine. */
export function isAppUrl(url: string, appUrl: string): boolean {
  let target: URL
  let app: URL
  try {
    target = new URL(url)
    app = new URL(appUrl)
  } catch {
    return false
  }
  // A file: URL has no origin to compare (they are all "null"), so compare the file itself.
  if (app.protocol === 'file:') {
    return target.protocol === 'file:' && target.pathname === app.pathname
  }
  return target.origin === app.origin
}

/**
 * Only ordinary web links may be handed to the operating system. Other schemes (file:, ms-msdt:,
 * custom app protocols, ...) can start a program on this computer.
 */
export function isSafeExternalUrl(url: string): boolean {
  try {
    const { protocol } = new URL(url)
    return protocol === 'https:' || protocol === 'http:'
  } catch {
    return false
  }
}

/** The part of an Electron IPC event that the trust check reads. */
export interface IpcSender {
  senderFrame: { url: string } | null
  sender: { mainFrame: unknown }
}

/**
 * True only for a message sent by the app's own page, from the window's top frame. The preload's API
 * also exists in an `about:blank` page (the navigation lock cannot stop that one), so being "in our
 * window" is not enough: check who is really calling.
 */
export function isTrustedSender(event: IpcSender, appUrl: string): boolean {
  const frame = event.senderFrame
  return frame !== null && frame === event.sender.mainFrame && isAppUrl(frame.url, appUrl)
}
