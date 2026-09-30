# Architecture (v0.1)

> Stub. Describes what exists during Stage 2 and what is planned. Update as the app grows.

## What this is

Frontier App is a desktop AI chat app built with Electron, Vite, React and TypeScript.
It is a working chat window: you save your own Anthropic API key in Settings, and replies stream in from
Claude (D-012). The page never sees the key or the network. The main process holds the key, makes the
only network call (to the Anthropic API) and streams the reply back to the page.

## Process model

Electron runs three kinds of code. Each has its own folder under `src/`.

| Folder         | Runs in                       | Job                                                                     |
| -------------- | ----------------------------- | ----------------------------------------------------------------------- |
| `src/main`     | Main process (Node.js)        | Creates windows, talks to the OS, owns the API key and the network call |
| `src/preload`  | Bridge (runs before the page) | Exposes a small, safe API from main to the renderer                     |
| `src/renderer` | Browser window (React)        | The user interface                                                      |
| `src/shared`   | Imported by any of them       | The contract between page and main (`ipc.ts`) and checks both sides run |

The renderer should never touch Node.js or the network for model calls directly. It asks main
through the preload bridge (IPC).

Stage 1 changed only `src/renderer`. Stage 2 added the files below (see Security notes):

| File                         | Job                                                                                         |
| ---------------------------- | ------------------------------------------------------------------------------------------- |
| `src/main/index.ts`          | Creates the sandboxed window, wires the navigation lock, registers the message handlers     |
| `src/main/security.ts`       | Plain functions: is this URL the app's own page? may it be opened in the browser?           |
| `src/main/ipc.ts`            | The message handlers. Each one first checks that the app's own page is calling              |
| `src/main/keyStore.ts`       | Saves, reads and deletes the API key, encrypted by the operating system                     |
| `src/main/chat.ts`           | Runs each reply: reads the key, calls the provider, sends text to the page as events        |
| `src/main/provider.ts`       | The one provider: Anthropic's Claude through the official SDK. No Electron imports          |
| `src/preload/index.ts`       | Builds `window.api`, the only thing the page can ask main for                               |
| `src/preload/index.d.ts`     | Tells the renderer's TypeScript what `window.api` looks like                                |
| `src/shared/ipc.ts`          | Every message that crosses the boundary: types, channel names                               |
| `src/shared/validate.ts`     | `checkApiKey`, `checkChatRequest`: the page may use them for feedback, main runs them again |
| `src/renderer/src/settings/` | The Settings dialog and the hook that asks main whether a key is saved                      |

### Settings and the API key

```
Settings dialog --window.api.settings.setApiKey(key)--> preload --> ipc.ts guard --> keyStore --> credentials.json
   (page)             one named function, no ipcRenderer           is the caller the app's       encrypted by the OS
                                                                   own page? checkApiKey again
```

The page can ask "is a key saved?" and hand over a new key. It can never read one back: the key is
not part of any reply. The saved key lives in `credentials.json` in the per-user data folder
(`app.getPath('userData')`), encrypted by Electron's `safeStorage`. See DECISIONS.md D-010 and D-011.

### Sending a message

```
page                                 preload               main process                                     network
Composer -> useChat.send
  -> ipcReply(history, signal)
     toWireMessages (history.ts) ---> chat.start(request) -> chat.ts: sender guard, checkChatRequest,
                                                               read the key (keyStore) ->  provider.ts
                                                               (SDK: pin key + address, merge turns)  ------> api.anthropic.com
     text pieces  <---------------- onEvent(listener) <---- sender.send('chat:event', ...)  <--- stream
  -> useChat: bubble grows; done / stopped / error note
```

Stop, reloading the window and closing it all abort the network request in main. The reply comes back as
three kinds of event: `text`, `done` and `error` (see `src/shared/ipc.ts`). What the model is told about
earlier turns is D-013.

## Chat UI (`src/renderer/src/chat/`)

| File                | Job                                                                                        |
| ------------------- | ------------------------------------------------------------------------------------------ |
| `ChatView.tsx`      | Puts the pieces together and owns the `useChat` hook                                       |
| `useChat.ts`        | Conversation state, and the cycle: send, reply streams in, then done / stopped / error     |
| `ipcReply.ts`       | The reply function: sends the conversation to main over the bridge and streams the answer  |
| `history.ts`        | Decides what the model is told about earlier turns (D-013)                                 |
| `types.ts`          | `ChatMessage`, `MessageStatus` and `ReplyFn`                                               |
| `MessageList.tsx`   | Scrolling list. Stays on the newest text unless the reader scrolled up                     |
| `MessageBubble.tsx` | One message: typing dots while waiting, a "Stopped" or error line when needed              |
| `Composer.tsx`      | Input box. Enter sends, Shift+Enter adds a line. Shows Send, or Stop while a reply streams |

`App.tsx` adds the header. All styling is one stylesheet, `assets/main.css`, with colours as CSS
variables at the top. The UI is dark only.

```
Composer --onSend--> useChat.send --> reply(history, signal) --text pieces--> messages --> MessageList
                                        ^ ipcReply: asks the main process, which asks the model
```

### The reply seam

`ReplyFn` is `(history, signal) => AsyncIterable<string>`: the conversation so far and an
`AbortSignal` go in, and the reply comes out as a stream of text pieces. `useChat` accepts any
`ReplyFn` (`ChatView` passes `ipcReply`). Real providers also stream and can be cancelled, so they fit this
shape. The function behind it lives in the main process, reached over IPC; `useChat` and the components did
not have to change. See DECISIONS.md D-008.

`ChatMessage` (with its status) stays in the renderer: main does not need it. What main needs for chat
(plain role-and-text messages and the reply events) is in `src/shared/ipc.ts`, which both
`tsconfig.node.json` and `tsconfig.web.json` include.

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

- No API keys or `.env` files in the repo. The key is stored per user, outside git (D-010): encrypted by
  the operating system, and never sent to the page. It protects against a copy of the file on another
  computer or account. It does not protect against a program running as you on this computer, which
  can ask the same secure storage to decrypt it.
- Do not save files in the data folder by writing a temp file and renaming it over the real one. On
  this project's own PC, which has Windows EFS encryption on `%APPDATA%`, every rename there fails
  with EXDEV. Write in place (or copy then delete) and read the result back. Test storage code in an
  EFS-encrypted folder, not only in `%TEMP%`.
- The key is sent only to `https://api.anthropic.com`, and only by `src/main/provider.ts`. The SDK's
  environment fallbacks (`ANTHROPIC_AUTH_TOKEN`, `ANTHROPIC_BASE_URL`) are switched off on purpose (D-012).
  `FRONTIER_API_BASE_URL` redirects it for testing, but only when running from source.
- Every message handler in main (`src/main/ipc.ts`, `src/main/chat.ts`) runs through a guard: only a call from the window's
  top frame, on the app's own page, is answered. The preload API also exists in an `about:blank` page,
  so the guard does not just trust "it came from our window". It then validates the input again.
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

Conversation history on disk (closing the window loses the chat, and there is no New chat button),
Markdown rendering (replies are plain text; the system prompt asks for that), a model choice, a cost display,
a check against the real API (Stage 2 was tested against a mock). See ROADMAP.md.
