# Architecture (v0.1)

> Stub. Describes what exists at Stage 1 and what is planned. Update as the app grows.

## What this is

Frontier App is a desktop AI chat app built with Electron, Vite, React and TypeScript.
At Stage 1 it is a working chat window whose replies are fake: the app echoes your message back.
No model provider, network call or API key exists yet.

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

Stage 1 changed only `src/renderer`. Stage 2.2 then changed main and preload (see Security notes):

| File                     | Job                                                                                   |
| ------------------------ | ------------------------------------------------------------------------------------- |
| `src/main/index.ts`      | Creates the sandboxed window and wires the navigation lock                            |
| `src/main/security.ts`   | Plain functions: is this URL the app's own page? may it be opened in the browser?     |
| `src/preload/index.ts`   | Builds `window.api`, the only thing the page can ask main for (empty until Stage 2.3) |
| `src/preload/index.d.ts` | Tells the renderer's TypeScript what `window.api` looks like                          |

## Chat UI (`src/renderer/src/chat/`)

| File                | Job                                                                                        |
| ------------------- | ------------------------------------------------------------------------------------------ |
| `ChatView.tsx`      | Puts the pieces together and owns the `useChat` hook                                       |
| `useChat.ts`        | Conversation state, and the cycle: send, reply streams in, then done / stopped / error     |
| `echoReply.ts`      | The fake "model": waits briefly, then streams `Echo: <your message>` word by word          |
| `types.ts`          | `ChatMessage`, `MessageStatus` and `ReplyFn`                                               |
| `MessageList.tsx`   | Scrolling list. Stays on the newest text unless the reader scrolled up                     |
| `MessageBubble.tsx` | One message: typing dots while waiting, a "Stopped" or error line when needed              |
| `Composer.tsx`      | Input box. Enter sends, Shift+Enter adds a line. Shows Send, or Stop while a reply streams |

`App.tsx` adds the header. All styling is one stylesheet, `assets/main.css`, with colours as CSS
variables at the top. The UI is dark only.

```
Composer --onSend--> useChat.send --> reply(history, signal) --text pieces--> messages --> MessageList
                                        ^ echoReply today; a real provider later
```

### The reply seam

`ReplyFn` is `(history, signal) => AsyncIterable<string>`: the conversation so far and an
`AbortSignal` go in, and the reply comes out as a stream of text pieces. `useChat` accepts any
`ReplyFn` (default: `echoReply`). Real providers also stream and can be cancelled, so they fit this
shape. In Stage 2 the function behind it moves to the main process, reached over IPC. `useChat` and
the components should stay as they are. See DECISIONS.md D-008.

Message types live in the renderer for now, because nothing crosses the process boundary yet. When
main needs them, move `types.ts` to `src/shared` and add `src/shared` to the `include` list of both
`tsconfig.node.json` and `tsconfig.web.json`. Neither covers it today.

## Build tooling

- `electron-vite` builds all three targets. Output goes to `out/` (git-ignored).
- `npm run dev` runs the app with hot reload. `npm run build` type-checks and builds.
  `npm run start` builds, then runs the production build from `out/`.
- Config lives in `electron.vite.config.ts`; TypeScript is split into `tsconfig.node.json`
  (main and preload) and `tsconfig.web.json` (renderer).
- The app runs on Electron 44 (D-003). electron-vite 5.0.0 only knows Electron up to 39 and would
  silently build for Node 16 / Chrome 108, so `electron.vite.config.ts` sets the build targets by
  hand. Update them whenever Electron is upgraded; the comment there says how to read the real values.
- Electron 42+ does not download its program during `npm install`. `postinstall` runs
  `install-electron` (about 150 MB the first time, cached afterwards) and then
  `electron-builder install-app-deps`. Only a plain `npm install` runs `postinstall`; adding package
  names to the command skips it. Run `npm run postinstall` if `npm run dev` says "Electron uninstall".

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
- The window is sandboxed, context-isolated and has no Node.js (D-004). A sandboxed preload may only
  require `electron`, `events`, `timers` and `url`: no npm packages, no other files at run time (the
  build tool bundles files the preload imports). If it breaks that rule the preload fails to load and
  the page silently gets no `window.api`; check the console for "Unable to load preload script".
- The page gets only what `src/preload/index.ts` lists under `window.api`. Never expose Electron's
  whole `ipcRenderer`: any script in the page could then call any channel.
- The window cannot navigate away from the app's own page, and only http(s) links reach the operating
  system (`src/main/security.ts`). `about:blank` is the one navigation this cannot stop, and that page
  still gets `window.api`, so every IPC handler must also check who is calling.
- Message text is shown as plain text. React escapes it, so pasted HTML cannot run. Markdown or
  HTML from a model needs a sanitising renderer first; see D-009.

## Not built yet

Provider calls, settings, key storage, conversation history (closing the window loses the chat),
Markdown rendering. See ROADMAP.md.
