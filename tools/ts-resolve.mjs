// Test harness only (lives outside the project on purpose).
// The project's .ts files import each other WITHOUT file extensions ("./ipc"), which the bundler and
// TypeScript resolve but Node's own ESM loader does not. Importing this file first teaches Node to try
// "<specifier>.ts" when a relative import cannot be found, so pure modules in src/shared and
// src/main can be loaded and checked under plain Node (it strips the types itself).
import { register } from 'node:module'

const hooks = `
export async function resolve(specifier, context, nextResolve) {
  try {
    return await nextResolve(specifier, context)
  } catch (error) {
    if (error && error.code === 'ERR_MODULE_NOT_FOUND' && /^\\.{1,2}\\//.test(specifier)) {
      return nextResolve(specifier + '.ts', context)
    }
    throw error
  }
}
`
register('data:text/javascript,' + encodeURIComponent(hooks))
