import imagesFile from '../../registry/images.json'
import {
  parseImagesRegistry,
  retirementWarnings,
  type ImagesRegistryResult
} from '../shared/images'

// registry/images.json is built into the app (Stage 16.2, D-048), as models.json is (D-014): a JSON import, embedded by the build tool, checked once when this module first
// loads. It holds no address and no credential (the reader refuses one). A broken file is kept whole with its error: no picture can be asked for, and the page says why.
const loaded: ImagesRegistryResult = parseImagesRegistry(imagesFile)

export function getImagesRegistry(): ImagesRegistryResult {
  return loaded
}

/** Puts what is wrong with the file, and the models that retire within 30 days or have retired, in the log. Called once, at startup. */
export function reportImagesRegistry(now: number = Date.now()): void {
  if (!loaded.ok) {
    console.error(`registry/images.json cannot be used: ${loaded.error}`)
    return
  }
  for (const problem of loaded.problems) console.warn(`registry/images.json: ${problem}`)
  for (const warning of retirementWarnings(loaded.registry, now))
    console.warn(`registry/images.json: ${warning}`)
}
