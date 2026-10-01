import registryFile from '../../registry/models.json'
import { parseRegistry, type RegistryResult } from '../shared/registry'

// registry/models.json is built into the app: it is a JSON import, so the build tool embeds it and there
// is no file to look for at run time, whether the app runs from source or is installed (D-014). It is
// checked once, when this module first loads. The result is kept whole, errors included: a broken
// registry is something to show the person, not something to hide behind a fallback list.
const loaded: RegistryResult = parseRegistry(registryFile)

export function getRegistry(): RegistryResult {
  return loaded
}

/** Puts whatever is wrong with the registry file in the log. Called once, at startup. */
export function reportRegistryProblems(): void {
  if (!loaded.ok) console.error(`registry/models.json cannot be used: ${loaded.error}`)
  for (const problem of loaded.problems) console.warn(`registry/models.json: ${problem}`)
}
