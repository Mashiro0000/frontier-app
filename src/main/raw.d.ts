// A file imported as text with the bundler's "?raw" suffix (the launcher script of Stage 13). tools/ts-resolve-hooks.mjs does the same under plain Node.
declare module '*.ps1?raw' {
  const text: string
  export default text
}
