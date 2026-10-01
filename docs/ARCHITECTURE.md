# Architecture (v0.1)

> Stub. Describes what exists at the end of Stage 4 and what is planned. Update as the app grows.

## What this is

Frontier App is a desktop AI chat app built with Electron, Vite, React and TypeScript.
It is a working chat window: you save your own Anthropic API key in Settings, and replies stream in from
Claude (D-012). The page never sees the key or the network. The main process holds the key, makes the
only network call (to the Anthropic API) and streams the reply back to the page. Which Claude model answers
is a choice from a registry of models (`registry/models.json`, D-014); the main process holds the choice and
saves it (D-015). Conversations are saved on disk as they go, one file each, and can be reopened (D-016, D-017).

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

Stage 1 changed only `src/renderer`. Stage 2 added the files below (see Security notes), Stage 3 added or
changed the ones marked (3), Stage 4 the ones marked (4), and Stage 5 the ones marked (5):

| File                              | Job                                                                                                                                                                                       |
| --------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/main/index.ts`               | Creates the sandboxed window, wires the navigation lock, registers the message handlers. (4) Holds the quit until saves finish                                                            |
| `src/main/security.ts`            | Plain functions: is this URL the app's own page? may it be opened in the browser?                                                                                                         |
| `src/main/ipc.ts`                 | The message handlers. Each one first checks that the app's own page is calling. (4) The four `history:` handlers                                                                          |
| `src/main/keyStore.ts`            | Saves, reads and deletes the API key, encrypted by the operating system                                                                                                                   |
| `src/main/chat.ts`                | Runs each reply: reads the key, asks the model's provider adapter, sends text to the page as events. (5) Provider-neutral                                                                 |
| `src/main/providers/types.ts`     | (5) The provider layer's vocabulary: `ProviderAdapter` (`listModels`, `stream`, `usage`, `normalizeError`), the neutral message and request, usage and errors. No Electron imports        |
| `src/main/providers/anthropic.ts` | (5) The Anthropic adapter: the one place that calls Anthropic's API, through the official SDK. It was `provider.ts`                                                                       |
| `src/main/providers/request.ts`   | (5) The app's own rules for a reply, applied once for every provider: system prompt, reply ceiling, joining consecutive turns (D-013)                                                     |
| `src/main/providers/errors.ts`    | (5) The sentences for a failure, shared by every provider; adds the request id and scrubs the key                                                                                         |
| `src/main/providers/usage.ts`     | (5) Reading token counts out of a provider's usage report                                                                                                                                 |
| `src/main/providers/index.ts`     | (5) The adapter for each provider: a table that must be complete, or it does not compile                                                                                                  |
| `src/main/registry.ts`            | (3) The registry file, embedded in the build and checked once at startup                                                                                                                  |
| `src/main/models.ts`              | (3) Which model answers: the saved choice (`preferences.json`) or the registry's default; changes run one at a time                                                                       |
| `src/preload/index.ts`            | Builds `window.api`, the only thing the page can ask main for. (4) Gained `history`                                                                                                       |
| `src/preload/index.d.ts`          | Tells the renderer's TypeScript what `window.api` looks like                                                                                                                              |
| `src/shared/ipc.ts`               | Every message that crosses the boundary: types, channel names. (4) The history types and `HISTORY_LIMITS`                                                                                 |
| `src/shared/validate.ts`          | `checkApiKey`, `checkChatRequest`, `checkModelChoice`: the page may use them for feedback, main runs them again. (4) `checkConversationId`, `checkConversationSave`, `checkSavedMessages` |
| `src/shared/registry.ts`          | (3) The shape of the registry file, `parseRegistry` (the strict check), and `toModelOption` (what the page may know about a model)                                                        |
| `src/renderer/src/settings/`      | (3) The Settings dialog, the model menu in the header, and the hook that asks main for the settings status                                                                                |
| `src/main/conversationStore.ts`   | (4) The saved conversations: one JSON file each, saved copy-then-delete, read with a recovery rule, listed from memory. No Electron imports                                               |
| `src/renderer/src/history/`       | (4) `useHistory` (autosave and the list), `HistoryDialog` (open and delete), and the conversions between the chat and what is saved                                                       |

### Settings and the API key

```
Settings dialog --window.api.settings.setApiKey(key)--> preload --> ipc.ts guard --> keyStore --> credentials.json
   (page)             one named function, no ipcRenderer           is the caller the app's       encrypted by the OS
                                                                   own page? checkApiKey again
```

The page can ask "is a key saved?" and hand over a new key. It can never read one back: the key is
not part of any reply. The saved key lives in `credentials.json` in the per-user data folder
(`app.getPath('userData')`), encrypted by Electron's `safeStorage`. See DECISIONS.md D-010 and D-011.

### Choosing a model

```
header menu --window.api.settings.setModel(id)--> preload --> ipc.ts guard --> inOrder (one at a time)
 (page)        one named function                 is the caller the app's      checkModelChoice, chooseModel (the id must be
                                                  own page?                    in the registry: checked twice) --> preferences.json
```

The registry says which models exist; `models.ts` keeps the person's choice (or the registry's default if there
is none, or if the saved one is no longer offered). `getStatus` hands the page the list (names, descriptions,
sizes, prices, never how a model is called) and the current choice. The model is fixed when a reply starts
(`chat.ts`), and the menu is disabled while a reply is arriving. See DECISIONS.md D-014 and D-015.

### Saving conversations

```
page: useChat.messages --useHistory (on every change; a streaming reply at most once a second)--> window.api.history.save({ id, messages })
        |                                                                              preload --> ipc.ts guard --> checkConversationSave
        |                                                                                  (the title and dates are not the page's)
        |                                                                                              |
        |                                             conversationStore: one at a time, in order. <id>.json.tmp written + read back,
        |                                             copied over <id>.json + read back, .tmp deleted   --> conversations/<id>.json
        +-- History dialog --list / load / remove--> the same guard and validation, the same store
```

The page holds the conversation while it is being written and hands over a snapshot after each change that
matters; main checks it and writes it (D-017). Nothing is saved until there is a message. A file is written
as `<id>.json.tmp` first, then copied over `<id>.json`, so a crash in the middle leaves either a whole
`.tmp` (which wins when the folder is read) or a cut-off one (which is ignored): see D-016. The quit is held
until the saves in progress have finished (`before-quit`, at most 5 s). The files are plain JSON in the
per-user data folder, in `conversations/`, and the History dialog shows where.

### Sending a message

```
page                                 preload               main process                                     network
Composer -> useChat.send
  -> ipcReply(history, signal)
     toWireMessages (history.ts) ---> chat.start(request) -> chat.ts: sender guard, checkChatRequest,
                                                               read the key (keyStore) ->  adapter.stream()
                                                               (providers/anthropic.ts: SDK, pin key + address) ------> api.anthropic.com
     text pieces  <---------------- onEvent(listener) <---- sender.send('chat:event', ...)  <--- stream
  -> useChat: bubble grows; done / stopped / error note
```

Stop, reloading the window and closing it all abort the network request in main. The reply comes back as
three kinds of event: `text`, `done` and `error` (see `src/shared/ipc.ts`). What the model is told about
earlier turns is D-013.

## Chat UI (`src/renderer/src/chat/`)

| File                | Job                                                                                                                                  |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `ChatView.tsx`      | Puts the message list and the input box together. The conversation itself is held in `App`, which also feeds the header's model menu |
| `useChat.ts`        | Conversation state, and the cycle: send, reply streams in, then done / stopped / error. (4) `load` replaces the conversation         |
| `ipcReply.ts`       | The reply function: sends the conversation to main over the bridge and streams the answer                                            |
| `history.ts`        | Decides what the model is told about earlier turns (D-013)                                                                           |
| `types.ts`          | `ChatMessage`, `MessageStatus` and `ReplyFn`                                                                                         |
| `MessageList.tsx`   | Scrolling list. Stays on the newest text unless the reader scrolled up                                                               |
| `MessageBubble.tsx` | One message: typing dots while waiting, a "Stopped" or error line when needed                                                        |
| `Composer.tsx`      | Input box. Enter sends, Shift+Enter adds a line. Shows Send, or Stop while a reply streams                                           |

`App.tsx` adds the header (New chat, History, the model menu, Settings). All styling is one stylesheet, `assets/main.css`, with colours as CSS
variables at the top. The UI is dark only.

```
Composer --onSend--> useChat.send --> reply(history, signal) --text pieces--> messages --> MessageList
                                        ^ ipcReply: asks the main process, which asks the model
```

### The reply seam

`ReplyFn` is `(history, signal) => AsyncIterable<string>`: the conversation so far and an
`AbortSignal` go in, and the reply comes out as a stream of text pieces. `useChat` accepts any
`ReplyFn` (`App` passes `ipcReply`). Real providers also stream and can be cancelled, so they fit this
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

`registry/` holds plain JSON data about models (D-005, D-014).

- `registry/models.json` - the models the app offers. **In use since Stage 3.** Envelope: `schemaVersion` ("0.2"),
  `updatedAt` and `source` (when and where the facts and prices were checked), `defaultModelId` and `models`. Each model:
  `provider`, `id`, `label`, `description`, `contextWindow`, `maxOutputTokens`, `pricing` (US dollars per million
  tokens, `inputPerMTok` and `outputPerMTok`) and `effort` (`low`, `medium`, `high`, or `null` for a model that rejects
  the setting, such as Haiku 4.5). Every object must have exactly these fields.
- `registry/rankings.json` - how models score on tasks, so the app can suggest one. Still an empty template
  (`{ "schemaVersion": "0.1", "updatedAt": null, "source": null, "rankings": [] }`); nothing reads it yet.

`models.json` is **embedded in the app at build time** (a JSON import in `src/main/registry.ts`), so there is no
file to find at run time, and it is checked once at startup by `parseRegistry` (`src/shared/registry.ts`). Edit it,
then restart `npm run dev` (or run `npm run dev -- --watch`, which rebuilds and restarts by itself).

- A file that is not valid JSON stops the build, with the file and position.
- An entry with a typo is left out and named in the app's log; the other models keep working.
- A file that cannot be used as a whole (wrong `schemaVersion`, no usable entry, a `defaultModelId` that is not
  usable) shows "Models unavailable"; replies explain why and no request is made. There is no built-in fallback list.
- The file holds no addresses and no credentials, and a `provider` the code cannot call is left out: the API
  address and the key's destination stay in the adapter (`src/main/providers/anthropic.ts`).

## Security notes

- No API keys or `.env` files in the repo. The key is stored per user, outside git (D-010): encrypted by
  the operating system, and never sent to the page. It protects against a copy of the file on another
  computer or account. It does not protect against a program running as you on this computer, which
  can ask the same secure storage to decrypt it.
- Do not save files in the data folder by writing a temp file and renaming it over the real one. On
  this project's own PC, which has Windows EFS encryption on `%APPDATA%`, every rename there fails
  with EXDEV. Write in place (or copy then delete) and read the result back. Test storage code in an
  EFS-encrypted folder, not only in `%TEMP%`.
- The registry cannot redirect the key: it holds no address or credential, only facts about models and one
  request setting per model, and a provider the code cannot call is left out (D-014). The model choice is saved in
  `preferences.json`, apart from the key file, written in place like it (D-010, D-015). The page can only choose a
  model that is on offer, and main checks that twice.
- The key is sent only to `https://api.anthropic.com`, and only by `src/main/providers/anthropic.ts`. The SDK's
  environment fallbacks (`ANTHROPIC_AUTH_TOKEN`, `ANTHROPIC_BASE_URL`) are switched off on purpose (D-012).
  `FRONTIER_API_BASE_URL` redirects it for testing, but only when running from source.
- Every message handler in main (`src/main/ipc.ts`, `src/main/chat.ts`) runs through a guard: only a call from the window's
  top frame, on the app's own page, is answered. The preload API also exists in an `about:blank` page,
  so the guard does not just trust "it came from our window". It then validates the input again.
- The window is sandboxed, context-isolated and has no Node.js (D-004). A sandboxed preload may only
  require `electron`, `events`, `timers` and `url`: no npm packages, no other files at run time (the
  build tool bundles files the preload imports). If it breaks that rule the preload fails to load and
  the page silently gets no `window.api`; check the console for "Unable to load preload script".
- Saved conversations are plain text on disk, not encrypted like the key (D-016): the History dialog says so and
  names the folder. The id of a conversation becomes part of a file name, so it is checked twice (in
  `ipc.ts` and inside the store) against the one spelling the app makes; the title and dates are never the
  page's; a file's size is looked at before it is read; and nothing deletes a file but the person's own Delete.
  The four `history:` handlers run through the same sender guard as the rest.
- The page gets only what `src/preload/index.ts` lists under `window.api`. Never expose Electron's
  whole `ipcRenderer`: any script in the page could then call any channel.
- The window cannot navigate away from the app's own page, and only http(s) links reach the operating
  system (`src/main/security.ts`). `about:blank` is the one navigation this cannot stop, and that page
  still gets `window.api`, so every IPC handler must also check who is calling.
- Message text is shown as plain text. React escapes it, so pasted HTML cannot run. Markdown or
  HTML from a model needs a sanitising renderer first; see D-009.

## Not built yet

Markdown rendering (replies are plain text; the system prompt asks for that), a cost display, naming the model
that wrote each reply, renaming or searching saved chats, a check against the real API (Stages 2 to 4 were tested
against a mock, which covers four models), `registry/rankings.json` (an empty template), other providers. See
ROADMAP.md.
