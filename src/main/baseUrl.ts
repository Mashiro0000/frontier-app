import { app } from 'electron'
import { PROVIDER_NAMES, type ProviderId } from '../shared/registry'

/**
 * For testing the whole path without the real service: FRONTIER_API_BASE_URL points the app at a fake server on this
 * computer, for every call to a provider (a reply, and Settings' "Test key"). It works only when running from source,
 * never in an installed app, so nothing outside could redirect where a real key is sent.
 */
let warnedAboutOverride = false

export function baseUrlOverride(provider: ProviderId): string | undefined {
  const value = process.env['FRONTIER_API_BASE_URL']
  if (!value || app.isPackaged) return undefined
  try {
    const { protocol } = new URL(value)
    if (protocol === 'http:' || protocol === 'https:') {
      // Said once, loudly: requests (and the saved key) are going somewhere other than the provider.
      if (!warnedAboutOverride) {
        warnedAboutOverride = true
        console.warn(
          `FRONTIER_API_BASE_URL is set: requests go to ${value}, NOT to ${PROVIDER_NAMES[provider]}.`
        )
      }
      return value
    }
  } catch {
    // fall through to the warning
  }
  console.warn('Ignoring FRONTIER_API_BASE_URL: it is not an http(s) address.')
  return undefined
}
