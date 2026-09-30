# Architecture (v0.1)

> Stub. Describes what exists at Stage 0 and what is planned. Update as the app grows.

## What this is

Frontier App is a desktop AI chat app built with Electron, Vite, React and TypeScript.
Stage 0 is only the shell: one empty window titled "Frontier App".

## Process model

Electron runs three kinds of code. Each has its own folder under `src/`.

| Folder         | Runs in                       | Job                                                                  |
| -------------- | ----------------------------- | -------------------------------------------------------------------- |
| `src/main`     | Main process (Node.js)        | Creates windows, talks to the OS, will own secrets and network calls |
| `src/preload`  | Bridge (runs before the page) | Exposes a small, safe API from main to the renderer                  |
| `src/renderer` | Browser window (React)        | The user interface                                                   |
| `src/shared`   | Imported by any of them       | Types and constants used on both sides (empty for now)               |

The renderer should never touch Node.js or the network for model calls directly. It asks main
through the preload bridge (IPC).

## Build tooling

- `electron-vite` builds all three targets. Output goes to `out/` (git-ignored).
- `npm run dev` runs the app with hot reload. `npm run build` type-checks and builds.
- Config lives in `electron.vite.config.ts`; TypeScript is split into `tsconfig.node.json`
  (main and preload) and `tsconfig.web.json` (renderer).

## Registry

`registry/` holds plain JSON data the app will read at startup. Both files are empty templates
at v0.1 and have no fields beyond the envelope below.

- `registry/models.json` - which models the app knows about (provider, id, context size, pricing...).
- `registry/rankings.json` - how models score on tasks, so the app can suggest one.

Envelope for both files:

```json
{ "schemaVersion": "0.1", "updatedAt": null, "models": [] }
```

(`rankings.json` uses `rankings` instead of `models`, plus a `source` field.)

## Security notes

- No API keys or `.env` files in the repo. Keys will be stored per user, outside git.
- Context isolation is on. The scaffold sets `sandbox: false` on the window; see DECISIONS.md D-004.

## Not built yet

Chat UI, provider calls, settings, key storage, conversation history. See ROADMAP.md.
