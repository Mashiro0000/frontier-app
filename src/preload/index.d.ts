import type { FrontierApi } from '../shared/ipc'

declare global {
  interface Window {
    /** What the preload exposes to the page. The contract is in src/shared/ipc.ts. */
    api: FrontierApi
  }
}
