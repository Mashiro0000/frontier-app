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
needed, or when automated UI tests are wanted (none exist; Stages 1 and 2 were checked by driving the
real app). Stage 2's settings did not need shared state: one `useState` in `App` and a small hook. Stage 2
did add one runtime package, Anthropic's SDK, in the main process only (D-012).

## D-008 - Replies come from a `ReplyFn` (the echo in Stage 1, IPC to the main process since Stage 2.4)

`ReplyFn` is `(history, AbortSignal) => AsyncIterable<string>` (see `chat/types.ts`). Real providers
stream and can be cancelled, so the UI is built around that, and the echo streams and stops like a
real one. Keeping the echo in the renderer adds no IPC surface in Stage 1. Status: accepted for
Stage 1. Revisit: in Stage 2 the implementation moves to the main process behind IPC (keys and
network stay in main). `ReplyFn`, `useChat` and the components should not need to change.
Settled in Stage 2.4: `ipcReply` (`chat/ipcReply.ts`) implements it over IPC and the echo is gone.
`ReplyFn` and the components did not change; `useChat` only lost its default reply function, because there
is nothing left to default to. What history to send is D-013.

## D-009 - Message text is plain text only

React escapes text, so pasted HTML cannot run; checked with an `<img onerror>` message. Markdown or
HTML from a model is a bigger risk. The window is now sandboxed (D-004), which limits what a mistake
can reach but does not replace sanitising. Claude writes Markdown by default, so the system prompt
(D-012) asks it for plain text; remove that once Markdown is rendered. Status: accepted. Revisit: before
adding Markdown, use a sanitising renderer.

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

## D-012 - The first provider: Anthropic's Claude, called from the main process with Anthropic's SDK

The roadmap asked for one provider and named none. Anthropic's Claude was chosen: the project had no other
provider in it (the only mention was a parked idea about Ollama), and it is the natural default for this
app. It is reversible: the page knows only `ReplyFn`, and the provider is one module,
`src/main/provider.ts`, which imports nothing from Electron.

- **The SDK, not hand-written HTTP.** `@anthropic-ai/sdk` (MIT, two small dependencies) handles streaming,
  retries and typed errors. It runs in the main process only, and `npm audit` stays at 0 vulnerabilities.
  It is an exception to D-007's "no new packages", and the only one.
- **Model `claude-opus-5-5`**, the default in Anthropic's own guidance. It is the pricier tier (list price
  when chosen: about $4 per million input tokens and $20 per million output tokens), and replies are billed
  to the person's own account. Settings says so and names the model. To change it, edit `MODEL` in
  `provider.ts`; Stage 3 turns it into a choice.
- **The request:** `max_tokens` 16000 (a ceiling on what one reply can cost; the model's thinking counts
  against it); `output_config.effort` "medium", written out because the default differs between models; no
  `thinking` setting (it is always on for this model), no sampling parameters, and no prefill (the last
  message is always the person's); automatic prompt caching (`cache_control`), because a chat resends its
  whole history every turn and a cache hit is billed far lower; and a short system prompt asking for plain
  text (D-009).
- **The credential and the address are pinned.** Left alone, the SDK reads `ANTHROPIC_AUTH_TOKEN` from the
  environment (and would send two credentials, which the API rejects) and `ANTHROPIC_BASE_URL` (which could
  send the key to another server). The key saved in Settings is the only credential and it goes only to
  `https://api.anthropic.com`; tested with hostile variables set. The one exception is
  `FRONTIER_API_BASE_URL`, honoured only when the app runs from source (never in an installer), which exists
  so the whole path can be tested against a fake server.
- **Left out on purpose: server-side refusal fallbacks.** Anthropic's guidance suggests enabling them by
  default. They are a beta feature that I could not check without a real key, and they change billing (the
  fallback model's own rates). A declined request is shown as "The model declined to answer this
  (category)". Adding them later is one request field plus a beta header.
- **Errors** are explained per cause (key rejected, model not found, rate limit, overloaded, interrupted
  connection...) with the request id for support, and the key is scrubbed from every message. The SDK's own
  retries (two, for overload and rate limits) are kept: a transient overload is invisible to the person.
- **Stop, reloading the window and closing it cancel the network request** (checked: the server sees the
  connection close), so an abandoned reply stops costing money.

Checked against a mock of the API only, never the real one, because no key was available: see STEP-LOG.md.
Status: accepted (Stage 2.4). Revisit: Stage 3 (model choice from the registry); showing the cost;
refusal fallbacks; the first check with a real key (a mock cannot reveal where it differs from the real
API); proxy support (the SDK uses Node's network stack, not Chromium's, so a system proxy is not used).

## D-013 - What the model is told about the conversation

Settles the question D-008 left open. The model is sent everything the person saw, including a reply that
was stopped or failed halfway (they may refer to it). A reply with no text at all is left out, because it
says nothing and the API refuses an empty message. Consecutive messages from one side are joined with a blank
line (the API docs disagree on whether the API does this itself, so the app does it: valid either way).
One consequence: after a reply that ended with no text (an instant error, or Stop before any text), the
person's next message travels together with the unanswered one. The alternative, dropping the unanswered
message, would silently leave out something the person typed. The price: a long message retyped after a
failure is sent twice.

The whole conversation is sent again with every message, so its size is its price. Limits
(`CHAT_LIMITS`): 500 messages, 200 000 characters per message, 600 000 in total (about 150 000 tokens).
Beyond that the request is refused with an explanation. There is no "New chat" button yet; closing and
reopening the window starts one. Status: accepted (Stage 2.4). Revisit: a New chat button, saved
conversations, a Retry button (then a failed message need not be retyped), and trimming or summarising old
turns.
