declare global {
  interface Window {
    /** What the preload exposes to the page. Nothing yet; chat and settings arrive in Stage 2. */
    api: Record<string, never>
  }
}

export {}
