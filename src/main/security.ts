// Rules for where the window may go and what it may hand to the operating system. Plain functions
// with no Electron imports, so they can be checked without starting the app.

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
