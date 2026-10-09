// Test harness only (lives outside the project on purpose).
// The project's .ts files import each other WITHOUT file extensions ("./ipc"), which the bundler and
// TypeScript resolve but Node's own ESM loader does not. Importing this file first teaches Node to try
// "<specifier>.ts" when a relative import cannot be found, so pure modules in src/shared and
// src/main can be loaded and checked under plain Node (it strips the types itself).
// Since 13.2 it also gives a "?raw" import (a file as text, as the bundler does) its text: see ts-resolve-hooks.mjs.
import { register } from 'node:module'

register('./ts-resolve-hooks.mjs', import.meta.url)
