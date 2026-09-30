# Decisions (v0.1)

> Short log of choices and why. Newest at the bottom. Add a line when you change course.

## D-001 - Electron + Vite + React + TypeScript

Desktop app with web UI skills; TypeScript for safer refactors. Status: accepted.

## D-002 - Scaffold with `@quick-start/electron` (electron-vite), `react-ts` template

It is the scaffold recommended in the electron-vite docs (checked 2026-10-01). It gives a
standard main / preload / renderer layout. Prompts for ESLint/Prettier were skipped via `--skip`;
the template still ships ESLint and Prettier configs. Status: accepted.

## D-003 - Electron version: upgraded from 39 to 44 in Stage 2

Stage 0 kept the scaffold's Electron 39. `npm audit` reported 2 high-severity issues (Electron and
its `extract-zip` helper), the only fix was a major upgrade, and the app loaded no remote content,
popups, webviews or custom protocols, so the flagged features were unused. That was accepted only
until network features arrived. Stage 2 brings them (an API key, model calls, model text on screen),
so it was re-checked on 2026-10-01:

- Electron supports the latest three stable majors. With 44 current, 42 to 44 are supported. The last
  39 release is dated 2026-05-05, the day before 42.0.0, so 39 gets no fixes and never will.
- The four Electron advisories are fixed only in 41.10.6+, 42.x, 43.x and 44.x. None of them affects
  this app as configured: they need untrusted iframes or popups, custom protocol handlers, or
  `<webview>`. That made waiting safe in Stage 0. It is no reason to keep an unsupported browser
  engine once the app holds API keys and shows model output.
- Electron's breaking-changes list for 40 to 44 touches nothing this app uses.

Decision: Electron `^44.5.1` (Node 24.21.0, Chromium 152) and `@types/node` `^24`. `npm audit` went
from 2 high to 0. 44.5.1 was chosen over 42 or 43 because it stays supported longest (until 47 is
released) and is the version `npm audit` itself recommended. Two side effects were handled in the same
change: Electron 42+ no longer downloads its program during `npm install`, so `postinstall` now runs
`install-electron`; and electron-vite 5.0.0 does not know Electron 40+ and would fall back to Node 16 /
Chrome 108 build targets, so `electron.vite.config.ts` pins them. Status: accepted (Stage 2.1).
Revisit: at the start of every stage, run `npm audit` and check the installed major is still one of
Electron's latest three. 44 leaves that window when 47 is released. Raise the pinned build targets
whenever Electron is upgraded.

## D-004 - Window sandbox: turned on in Stage 2

The scaffold shipped the window with `sandbox: false`, and nobody had tried it the other way. Tried in
Stage 2.2: with `sandbox: true` the scaffold's preload does not load (it required an npm package, and
a sandboxed preload may only require `electron`, `events`, `timers` and `url`). The failure is silent:
the window looks normal but the page gets no bridge at all.

Decision: `sandbox: true`, `contextIsolation: true` and `nodeIntegration: false`, written out in
`src/main/index.ts`. The preload is rewritten to use only `contextBridge` (and `ipcRenderer` when IPC
arrives) and exposes `window.api` only. The scaffold's `window.electron`, which was Electron's whole
`ipcRenderer`, is removed, and the `@electron-toolkit/preload` package with it: any script in the page
could have called any IPC channel, including the ones that will hold the API key. Two more rules in
`src/main/security.ts`: the window cannot navigate away from the app's own page (the preload API
exists in whatever page the window shows), and only http(s) links are passed to the operating system
(the scaffold passed any URL to `shell.openExternal`).

Checked in the real dev and built windows: Electron's own report of the window settings from the main
process, the preload loading and exposing only `window.api`, an IPC round trip and a push through the
sandboxed preload, the navigation lock (with a negative control showing the test can fail), and all of
Stage 1's checks. Status: accepted (Stage 2.2).
Revisit: a preload that needs more than the four modules above must be bundled by the build tool,
never un-sandboxed. The lock cannot stop a navigation to `about:blank` (an empty page that still gets
`window.api`; observed), so every IPC handler in main must also check who is calling.

## D-005 - Registry is plain JSON files in the repo

`registry/models.json` and `registry/rankings.json` are easy to edit and diff. No database at v0.1.
Status: accepted.

## D-006 - No secrets in the repo

No API keys, no `.env` files, no pushing to a remote during Stage 0. Status: accepted.

## D-007 - Chat UI is plain React and one stylesheet

No UI kit, state library, Markdown renderer or test framework in Stage 1; `useState` and one hook
were enough. Each dependency is something to audit, and this app will hold API keys. Status:
accepted. Revisit: when state is shared across several screens (Stage 2 settings), when Markdown is
needed, or when automated UI tests are wanted (none exist; Stage 1 was checked by driving the real app).

## D-008 - Replies come from a `ReplyFn`; the echo implements it in the renderer for now

`ReplyFn` is `(history, AbortSignal) => AsyncIterable<string>` (see `chat/types.ts`). Real providers
stream and can be cancelled, so the UI is built around that, and the echo streams and stops like a
real one. Keeping the echo in the renderer adds no IPC surface in Stage 1. Status: accepted for
Stage 1. Revisit: in Stage 2 the implementation moves to the main process behind IPC (keys and
network stay in main). `ReplyFn`, `useChat` and the components should not need to change. Decide
then what history to send: `useChat` currently passes every message, including stopped, failed and
empty replies.

## D-009 - Message text is plain text only

React escapes text, so pasted HTML cannot run; checked with an `<img onerror>` message. Markdown or
HTML from a model is a bigger risk. The window is now sandboxed (D-004), which limits what a mistake
can reach but does not replace sanitising. Status: accepted. Revisit: before adding Markdown, use a
sanitising renderer.

## D-010 - The API key is stored encrypted by the operating system and never leaves main

The key is saved as one small file, `credentials.json`, in the app's per-user data folder, encrypted
with Electron's `safeStorage` (Windows DPAPI, the macOS Keychain, the Linux desktop's secret service).
The page can only ask whether a key is saved and hand a new one over; it can never read one back. On
Linux with no keyring, saving is refused, because Electron would fall back to a password written in
its own source code, which is disguise rather than protection.

What this protects against: a copy of the file on another computer or under another account. What it
does not: a program running as you on this computer can ask the same secure storage to decrypt it.
That is the limit of any per-user store without a master password, and it is the same limit browsers
and most desktop apps live with.

The file is written in place and read back before the app says "Saved". A first version wrote a temp
file and renamed it over the real one, and that failed on this project's own PC: its `%APPDATA%` is
EFS-encrypted, and every rename inside it fails with EXDEV (a direct write and a copy both work). A
test in a normal temp folder could not have shown this. Status: accepted (Stage 2.3).
Revisit: when any other feature writes files in the data folder (conversation history is the next
one), write in place or copy-then-delete, read back, and test in an EFS-encrypted folder. A "master
password" or a check that the key works (a real request) are possible later additions.

## D-011 - One shared contract for everything that crosses page, preload and main

`src/shared/ipc.ts` lists every message between the page and the main process: types and channel
names. The preload exposes exactly those as `window.api`, never Electron's `ipcRenderer`. Every
handler in main (`src/main/ipc.ts`) runs through a guard that answers only a call made from the
window's top frame, on the app's own page. This is needed because the preload API also exists in an
`about:blank` page, which the navigation lock cannot stop (D-004). The guard is checked against real
`about:blank` calls, in dev and in the built app. The input is validated again in main: the checks in
the page are only for quick feedback. Status: accepted (Stage 2.3).
Revisit: each new message needs the same guard and its own validation; add them in `ipc.ts`, and
only through the contract.
