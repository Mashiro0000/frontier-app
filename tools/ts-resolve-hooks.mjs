// Test harness only: the module hooks that tools/ts-resolve.mjs registers.
//  - a relative import WITHOUT an extension ("./ipc") is retried as "<specifier>.ts" (the bundler and TypeScript resolve these; Node does not);
//  - an import ending in "?raw" (the bundler's way to get a file as text, used for the launcher script) gives the file's text as the default export.
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

export async function resolve(specifier, context, nextResolve) {
  if (specifier.endsWith('?raw')) {
    const found = await nextResolve(specifier.slice(0, -4), context)
    return { ...found, url: found.url + '?raw', shortCircuit: true }
  }
  try {
    return await nextResolve(specifier, context)
  } catch (error) {
    if (error && error.code === 'ERR_MODULE_NOT_FOUND' && /^\.{1,2}\//.test(specifier)) {
      return nextResolve(specifier + '.ts', context)
    }
    throw error
  }
}

export async function load(url, context, nextLoad) {
  if (url.endsWith('?raw')) {
    const text = readFileSync(fileURLToPath(url.slice(0, -4)), 'utf8')
    return { format: 'module', source: 'export default ' + JSON.stringify(text), shortCircuit: true }
  }
  return nextLoad(url, context)
}
