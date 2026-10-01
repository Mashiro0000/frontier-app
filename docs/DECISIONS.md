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
Status: accepted. Stage 3 filled `models.json` and put it to use (D-014); `rankings.json` is still an
empty template.

## D-006 - No secrets in the repo

No API keys, no `.env` files, no pushing to a remote during Stage 0. Status: accepted.

## D-007 - Chat UI is plain React and one stylesheet

No UI kit, state library, Markdown renderer or test framework in Stage 1; `useState` and one hook
were enough. Each dependency is something to audit, and this app will hold API keys. Status:
accepted. Revisit: when state is shared across several screens (Stage 2 settings), when Markdown is
needed, or when automated UI tests are wanted (none exist; Stages 1 and 2 were checked by driving the
real app). Stage 2's settings did not need shared state: one `useState` in `App` and a small hook. Stage 2
did add one runtime package, Anthropic's SDK, in the main process only (D-012). Stages 3 and 4 added none.

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
one), write in place or copy-then-delete, read back, and test in an EFS-encrypted folder. Stage 3's
`preferences.json` (D-015) follows that rule, and so do Stage 4's conversation files, with a recovery rule for
a crash in the middle of a write (D-016). A "master password" or a check that the key works (a real request)
are possible later additions.

## D-011 - One shared contract for everything that crosses page, preload and main

`src/shared/ipc.ts` lists every message between the page and the main process: types and channel
names. The preload exposes exactly those as `window.api`, never Electron's `ipcRenderer`. Every
handler in main (`src/main/ipc.ts`) runs through a guard that answers only a call made from the
window's top frame, on the app's own page. This is needed because the preload API also exists in an
`about:blank` page, which the navigation lock cannot stop (D-004). The guard is checked against real
`about:blank` calls, in dev and in the built app. The input is validated again in main: the checks in
the page are only for quick feedback. Status: accepted (Stage 2.3).
Revisit: each new message needs the same guard and its own validation; add them in `ipc.ts`, and
only through the contract. Stage 3 added `settings:set-model` that way (D-015), and Stage 4 added
`history:list`, `history:load`, `history:save` and `history:remove` (D-016, D-017).

## D-012 - The first provider: Anthropic's Claude, called from the main process with Anthropic's SDK

The roadmap asked for one provider and named none. Anthropic's Claude was chosen: the project had no other
provider in it (the only mention was a parked idea about Ollama), and it is the natural default for this
app. It is reversible: the page knows only `ReplyFn`, and the provider is one module,
`src/main/provider.ts`, which imports nothing from Electron. (Stage 5.1: that module is now the Anthropic adapter,
`src/main/providers/anthropic.ts`, one adapter among others behind one interface: D-018.)

- **The SDK, not hand-written HTTP.** `@anthropic-ai/sdk` (MIT, two small dependencies) handles streaming,
  retries and typed errors. It runs in the main process only, and `npm audit` stays at 0 vulnerabilities.
  It is an exception to D-007's "no new packages", and the only one.
- **Model `claude-opus-5-5`**, the default in Anthropic's own guidance. It is the pricier tier (list price
  when chosen: about $4 per million input tokens and $20 per million output tokens), and replies are billed
  to the person's own account. Settings says so and names the model. Some models (Haiku 4.5, for one)
  reject the `effort` setting. Settled in Stage 3: the model is now a choice, with the settings each model
  takes, from the registry (D-014, D-015). `MODEL` and `MODEL_LABEL` no longer exist.
- **The request:** `max_tokens` 16000 (a ceiling on what one reply can cost; the model's thinking counts
  against it; lower if the model's own maximum is lower); `output_config.effort`, written out because the
  default differs between models ("medium" for Opus 5.5, as above; per model since Stage 3, D-014); no
  `thinking` setting (it is always on for this model), no sampling parameters, and no prefill (the last
  message is always the person's); automatic prompt caching (`cache_control`), because a chat resends its
  whole history every turn and a cache hit is billed far lower; and a short system prompt asking for plain
  text (D-009).
- **The credential and the address are pinned.** Left alone, the SDK reads `ANTHROPIC_AUTH_TOKEN` from the
  environment (and would send two credentials, which the API rejects) and `ANTHROPIC_BASE_URL` (which could
  send the key to another server). The key saved in Settings is the only credential and it goes only to
  `https://api.anthropic.com`; tested with hostile variables set. The one exception is
  `FRONTIER_API_BASE_URL`, honoured only when the app runs from source (never in an installer), which exists
  so the whole path can be tested against a fake server. It logs a warning, once, whenever it is in use. The
  registry (D-014) holds no addresses, so it cannot change where the key goes.
- **Left out on purpose: server-side refusal fallbacks.** Anthropic's guidance suggests enabling them by
  default. They are a beta feature that I could not check without a real key, and they change billing (the
  fallback model's own rates). A declined request is shown as "The model declined to answer this
  (category)". Adding them later is one request field plus a beta header. Still left out in Stage 3, for the
  same reasons, now for the three further models (the API reference says to enable them by default for Fable
  5.1, Opus 5.5 and Sonnet 5.5; for Sonnet 5.5 only in a "default" form).
- **Errors** are explained per cause (key rejected, model not found, rate limit, overloaded, interrupted
  connection...) with the request id for support, and the key is scrubbed from every message. The SDK's own
  retries (two, for overload and rate limits) are kept: a transient overload is invisible to the person.
- **Stop, reloading the window and closing it cancel the network request** (checked: the server sees the
  connection close), so an abandoned reply stops costing money.

Checked against a mock of the API only, never the real one, because no key was available: see STEP-LOG.md.
Status: accepted (Stage 2.4). Revisit: showing the cost; refusal fallbacks; the first check with a real key
(a mock cannot reveal where it differs from the real API, and Stage 3 added three more models to that gap);
proxy support (the SDK uses Node's network stack, not Chromium's, so a system proxy is not used). The model
choice from the registry was Stage 3 (D-014, D-015).

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
Beyond that the request is refused with an explanation. Since Stage 4 there is a "New chat" button and
conversations are saved (D-016, D-017), so a conversation that has grown too long stays as it is and the
person starts another. Status: accepted (Stage 2.4). Revisit: a Retry button (then a failed message need not
be retyped), and trimming or summarising old turns.

## D-014 - The registry: plain JSON, embedded in the app, read strictly, and never trusted with an address

Stage 3 fills `registry/models.json` and puts it to use. D-005 chose plain JSON files; this decides what is
in one and how the app reads it.

- **What is in it.** Facts about each model, and the one setting the app picks for it. An envelope
  (`schemaVersion` "0.2", `updatedAt`, `source`, `defaultModelId`) and a list of models. Each model has
  `provider`, `id`, `label`, `description`, `contextWindow`, `maxOutputTokens`, `pricing` (US dollars per
  million tokens, in and out) and `effort`: the level the app asks for (`low`, `medium` or `high`), or `null`
  for a model that rejects the setting. What stays in code, because it is policy and not a fact about a
  model: the 16 000-token reply ceiling (lowered to a model's own maximum when that is smaller), automatic
  caching, the plain-text system prompt (D-009) and the API address (D-012). So nothing in the file can
  change where the API key is sent, and an entry for a provider the code cannot call is left out.
- **The four models** are the current generation: Claude Fable 5.1, Opus 5.5, Sonnet 5.5 and Haiku 4.5.
  Older ones are superseded; Mythos is for approved Project Glasswing customers only. The facts and prices
  were read on 2026-10-01 from Anthropic's models overview, effort and prompt-caching pages, and they matched
  the API reference bundled with the session (cached 2026-09-25). I did not call the Models API: it needs a
  key. The default stays Opus 5.5, so nobody's bill changes unless they pick another model.
- **`effort` per model.** Opus 5.5 `medium`: its own default, so its request is byte-for-byte what Stage 2
  sent (checked against a copy of that request taken before any Stage 3 code). Sonnet 5.5 `medium`: its
  default is `high`, and Anthropic suggests `medium` for chat. Fable 5.1 `high`: its default and Anthropic's
  suggested starting point. Haiku 4.5 `null`: it rejects the setting, the case D-012 warned about. `xhigh`
  and `max` are not allowed in the file, because not every model that takes `effort` accepts them (Stage 5.2
  lifted this: each model now lists the levels it accepts, D-019). These values are my reading of the docs, and a
  one-word edit per model.
- **Haiku's id is the dated snapshot** `claude-haiku-4-5-20251001`, which Anthropic's docs list as its API
  id (`claude-haiku-4-5` is an alias for it). Its retirement is "not sooner than October 15, 2026", two
  weeks after this was written. When it goes the API answers 404, the app names the model that was not found
  and says to choose another, and removing the entry is the fix.
- **Embedded, not read from disk.** `src/main/registry.ts` imports the JSON, so the build tool puts it inside
  the app: there is no path to find at run time in `npm run dev`, in `npm run start` or in an installer.
  Packaging was never tried on this project, and this removes one way for it to fail. The file is checked
  once, at startup. A file that is not even valid JSON stops the build with the file and position, and no
  window opens (checked). A typo in one entry leaves that entry out and names it in the app's log, and the
  other models keep working. A file that cannot be used as a whole (wrong schema version, no usable entry, a
  default that is not usable) shows "Models unavailable", makes replies explain why, and still lets a key be
  saved. There is deliberately no fallback list: a second copy of the models in code is what the registry
  replaces. Editing the file takes a restart of `npm run dev`, or `npm run dev -- --watch`, which rebuilds
  the main process and restarts the app by itself (both checked: plain `npm run dev` does not notice).
- **Strict.** Every object must have exactly the fields above. A misspelt field is reported as both a
  missing and an unknown field, so the typo is easy to see. The default is explicit and never guessed,
  because it decides what a person is billed.

Status: accepted (Stage 3.1 and 3.2). Revisit: updating the registry without a new release (a checked copy in
the data folder, written in place, D-010); a build-time check that runs the same validator; per-model reply
limits; more providers (an entry plus a provider module); `rankings.json`, still an empty template.

## D-015 - Which model answers: main holds the choice, saves it in its own file, and the page can only pick from the registry

- **Main is the source of truth**, like the API key (D-010, D-011). The page asks for the list and the
  current choice (`getStatus`) and asks to change it (`setModel`). `settings:set-model` goes through the same
  guard as every handler: a call from `about:blank` is refused (checked, and with the guard switched off it
  is not). Its input is checked twice, by `checkModelChoice` (the id must be exactly one on offer) and again
  in `chooseModel`; either alone is enough (checked by switching each off, then both). What is saved is the
  registry's own string, never the page's.
- **Saved in `preferences.json`** (`{"version":1,"modelId":"..."}`) in the per-user data folder, apart from
  `credentials.json`: removing the key does not forget the model, and a model name is no secret. Written in
  place and read back (D-010), and tested in scratch profiles inside the EFS-encrypted `%APPDATA%`. Nothing is
  written until the person chooses, and reading never rewrites the file.
- **A saved choice the registry no longer offers** (a retired model, a hand edit, a different letter case),
  or a file that is empty, corrupt, from another version, or 5 MB of random bytes (16 cases tried), means the
  registry's default, with one line in the log naming the missing model. The file is left as it is, so the
  choice comes back if the model does; choosing from the menu replaces it.
- **When a choice applies.** The model is fixed when a reply starts. The menu is disabled while a reply is
  arriving, and says why; a change applies from the next message. If a misbehaving page changes it mid-reply
  anyway, the reply already running keeps its model (checked). Switching in the middle of a chat sends the
  whole chat to the new model (D-013), and the prompt cache does not carry across models, so the first
  message after a switch is billed in full. Settings says so.
- **Changes are handled one at a time, in order.** Holding an arrow key on the menu changes the choice for
  every option it passes, so several calls can be in flight. Run side by side their writes crossed, and the
  person saw "The choice could not be saved" (seen with the ordering switched off); `inOrder` in `models.ts`
  runs them in turn. In 25 bursts of six quick changes the menu, main and the file always agreed on the last.
- **What the person sees.** The header menu shows names only. Settings shows the chosen model's
  description, how much it can read, its list prices and the date they were checked, and that the bill goes
  to the Anthropic account. The "No API key" badge stays; the model badge is gone.

Status: accepted (Stage 3.3 and 3.4). Revisit: showing which model wrote each reply (history saved from Stage 4
on does not record it, D-017); switching automatically when a model is not found; letting the person choose the
effort level; a cost display (D-012).

## D-016 - Conversation history: one plain JSON file per conversation, saved copy-then-delete, not encrypted

Stage 4 saves conversations on disk. This decides the file format and how it is written; D-017 decides who
saves, when, and what the person sees.

- **One file per conversation, no index.** `conversations/<id>.json` in the per-user data folder, one line of
  JSON: `{"version":1,"id","title","createdAt","updatedAt","messages":[{"role","content","status","error"?}]}`.
  There is no second file to keep in step with the first, and a damaged file loses only itself. The list is
  built by reading every file once, the first time anything asks, then kept in memory (1000 conversations of
  about 22 KB each, first look: 0.2 s in a normal temp folder, 0.9 s in this PC's EFS-encrypted `%APPDATA%`).
  `status` is `done`, `stopped` or `error`; a reply that was still arriving when it was saved is saved as
  `stopped`, because a reply cut off by closing the window never finishes. Messages carry no id (the page
  makes fresh ones on opening) and no model: see D-017 on the model.
- **The id is a lower-case UUID that the page makes and main checks.** It becomes part of a file name, so the
  check (`isConversationId`, and again inside the store) accepts exactly the spelling `crypto.randomUUID()`
  produces. Upper case is refused because Windows treats upper and lower case as one file, so two spellings of
  one id would be one conversation. The title (the first thing the person wrote, on one line, cut at 60
  characters) and both dates are worked out by main; the page cannot choose them.
- **Written copy-then-delete (D-010's revisit), with a recovery rule.** A key or a model choice that is torn by
  a crash only has to be entered again. A conversation is something a person would be sorry to lose half of,
  so a save is three steps: (1) write the whole text to `<id>.json.tmp` and read it back; (2) copy it over
  `<id>.json` and read that back; (3) delete the `.tmp`. A `.tmp` is written first and deleted last, so a
  `.tmp` that parses is always at least as new as the real file, and a cut-off JSON object never parses. So
  reading follows one rule: **a `.tmp` that parses wins; one that does not was cut off in step 1, and the real
  file is still the untouched old copy.** Checked with every crash state built by hand, and with faults
  injected into each step (a failing copy, a write cut off halfway, a read-back that differs, a `.tmp` that
  cannot be deleted), in a normal folder and in the EFS one (where `rename` fails with EXDEV, as D-010 found).
  Nothing renames, so that quirk never matters.
- **Reading never writes.** A file that cannot be read (torn, empty, 5 MB of random bytes, another version, an
  id that does not match its name) is counted, named in the log by its id (never a path), and left exactly as
  it is: nothing deletes a file except the person's own Delete. A file's size is looked at before it is read,
  so no file can fill the memory. A byte-order mark (some editors add one) is tolerated, because the file is
  the person's own data and refusing it would strand a conversation. Files that are not conversations
  (`notes.txt`, an upper-case id) are ignored without being counted.
- **Limits** (`HISTORY_LIMITS`): 1000 conversations, 2000 messages each, 400 000 characters per message,
  1 500 000 in total, an error text of 2000 characters, 10 MB per file. They are deliberately above what chat
  will send (`CHAT_LIMITS`, D-013): a reply can push a conversation past what can be sent, and messages with no
  text (a failed reply) are saved though they are not sent; the person must still be able to save what they
  were shown. Whatever is written must be readable again, so the 10 MB limit applies to writing as well (the
  worst case of the text limit, every character escaped to six bytes, is about 9 MB). A refusal is explained.
- **Not encrypted, and the person is told.** Unlike the API key (D-010), conversations are plain text on disk.
  Encrypting them with the operating system's secure storage would make every conversation unreadable after a
  Windows profile change or a keyring reset, and on a Linux desktop with no keyring it would be refused; plain
  JSON keeps them portable, searchable, and deletable with a file manager, which is how D-005 treats the other
  data files. What it costs: anyone who can read this account's files can read the conversations. On this PC
  the data folder is EFS-encrypted by Windows, which covers that case; elsewhere it depends on the disk. The
  History dialog says so, and names the folder. Deleting a conversation deletes its file; copies the operating
  system or an SSD keep are out of the app's hands.
- **Quitting waits for saves.** The main process holds `before-quit` until every save it has accepted has
  finished, for at most 5 seconds (so a stuck disk can never keep the app open), then quits. With 60 saves of a
  1.4 MB conversation queued, the file ended as the last save, whole, with no `.tmp` (the quit took 6 s).

Status: accepted (Stage 4.1 and 4.2). Revisit: encrypting history (an option, with the recovery problem it
brings); an index file if reading every file at start ever becomes too slow (about a thousand conversations is
the tested size); a size or age limit with a clear-out; a "Delete all"; file names a person can recognise.

## D-017 - Who saves, when, and what the person sees

- **The page sends the whole conversation, main checks and writes it.** The conversation lives in the page
  while it is being written (`useChat`, D-008), so the page hands over a snapshot after each change that
  matters, and main validates it as it validates everything (D-011: the same guard, the input checked again, a
  call from `about:blank` refused, the title and dates not the page's). The alternative, main assembling the
  conversation from the reply events it already sees, would change the chat protocol that D-008 and D-013 keep
  stable, and could not save a failed reply that left no text. Snapshots are handled one at a time, in order,
  so the last one asked for is what is on disk (60 saves fired at once: the 60th was kept).
- **When.** Nothing is saved until there is a message: opening the app, listing and closing it again leave no
  file and no folder. The person's message is saved at once; a reply that streams in is saved at most once a
  second; a finished, stopped or failed reply is saved at once; a conversation just opened from disk is not
  saved again (that would only move its date). The page also sends what is waiting when the window is closed
  or reloaded (`pagehide`). Measured: closing the window in the middle of a reply left the file with exactly
  the text that was on screen (186 of 186 characters); without that last send the loss would be up to a
  second of text, and a crash can still lose that much.
- **The app opens on a new, empty chat.** The last conversation is one click away in History, not restored by
  itself: nothing is written until the first message, and an app that reopens on yesterday's chat is
  surprising when the chat is a day old. A deliberate choice that costs one click.
- **The header has New chat and History.** New chat is off while the chat is empty (there is nothing to start
  over from) and while a reply arrives; History is off while a reply arrives. That is the model menu's rule
  (D-015), for the same reason: what is on screen is being written. Opening the conversation that is already
  on screen does nothing, because reloading it from disk could only lose a message that is not saved yet.
- **History is a dialog, not a sidebar.** It is the Settings dialog's pattern: a modal `<dialog>` (focus
  trapped, Escape closes, the page behind it inert), which keeps the header and the narrow-window layout
  (checked at 420 and 320 pixels) as simple as in Stage 3. A sidebar is a larger redesign for later. Each row
  shows the title, when it was last saved and how many messages it holds; the open one is marked. Delete asks
  first ("Delete? Delete / Keep", with Keep focused) because it is the one action here that cannot be undone;
  deleting the chat that is open starts a new one. The list scrolls inside the dialog, so the heading and Close
  stay in view with 150 chats (a first version scrolled the whole dialog and Close ended up 9000 pixels down). The
  dialog has its own class names rather than reusing Settings' (a first version did, and a selector for the
  Settings dialog then matched the History one).
- **A save that fails is shown, not hidden.** The header gets a "Not saved" button (its tooltip says why;
  pressing it tries again), and the next change tries again by itself; the page is only ever told a plain
  sentence, never the disk's own error or a path (those go to the log). The History dialog warns that opening or
  starting another chat would lose the one on screen. Nothing blocks the person, who may be able to free some
  space and press the button. A failure belongs to the chat that had it: starting another chat clears the badge,
  and deleting a chat whose last save failed does not save it again (a first version did). Checked by injecting a
  disk fault into the running app.
- **Left out on purpose** (all in `docs/IDEAS.md`): which model wrote each reply. History saved in Stage 4 does
  not record it, and that cannot be reconstructed later; the page does not know it (the model is fixed in main
  when a reply starts, D-015), and telling it would change the reply events. Also left out: renaming,
  searching, exporting, and a sidebar.

Status: accepted (Stage 4.3 and 4.4). Revisit: recording the model per reply (it needs an event from main to
the page and a field in the file, and old files would lack it); a Retry button for failed replies (D-013); rename
and search once a person has more than a screenful.

## D-018 - One adapter per provider behind a neutral interface; the app's own rules stay outside the adapters

Stage 5 makes the app talk to more than one provider. Stage 5.1 is the refactor that makes room for that, done first
and on its own: the Anthropic code moved out of `src/main/provider.ts` into `src/main/providers/` behind an interface,
and **nothing the app does changed**. (The request said to refactor "all OpenAI calls". There were none: the only
provider was Anthropic's Claude (D-012). The existing code therefore became the first adapter, and a second provider
is added in its own slice, D-022.)

- **The interface** (`ProviderAdapter`, `providers/types.ts`) has the four methods asked for.
  - `stream(request)` is an async generator: `text` events as they arrive, then exactly one `end` event (how the reply
    ended, and what it used). A failure makes it throw, and so does a Stop (the caller knows which, from its own
    signal). Both SDKs' streams are used the documented way (iterate the raw events, then `finalMessage()`). A
    generator also adds a property the old callback did not have: a consumer that stops looping cancels the network
    request.
  - `usage(report)` turns a provider's usage report into four buckets that never overlap: ordinary input, cache reads,
    cache writes and output (the thinking a model does first is output, because it is billed as output). They can be
    added up and priced one by one. Anthropic reports its cache numbers beside the input ones, not inside them;
    another provider may report them inside (D-022), which is why each adapter converts its own report. It never
    throws: a report it cannot read counts as nothing.
  - `normalizeError(error, { modelId })` reads the facts out of whatever an SDK threw (a kind, the status, the
    provider's own words, the request id). The sentences are chosen in one place (`errors.ts`), so every provider says
    the same thing the same way. Anthropic's existing sentences are the old ones character for character.
    `describeFailure` adds the request id and scrubs the key, as before.
  - `listModels(credentials)` asks the provider which models this key can use. It costs no tokens, which is why
    Settings' "Test key" uses it (D-020).
- **The neutral message** is `{ role, content }` with `content` plain text, as the chat is (D-009). The page's
  `WireMessage` already had exactly that shape, so nothing about it changed. The provider layer has a type of its own
  so that either side can grow alone: an image would be a content part here and a translation in each adapter.
- **The app's rules sit outside the adapters.** `request.ts` decides the system prompt (written per provider: a model
  told it is Claude when it is not answers oddly), the 16 000-token ceiling lowered to a model's own maximum, and the
  joining of consecutive turns (D-013). An adapter is handed a finished `StreamRequest` and only translates it. What
  stays in an adapter is what is true of one API: its address, how the key travels, the SDK's environment fallbacks
  (still pinned off, D-012) and the wire format.
- **A table that must be complete.** `providers/index.ts` holds a `Record<ProviderId, ProviderAdapter>`. Add a
  provider to the registry's list without writing its adapter and the build fails.
- **One deliberate difference, the only one.** `chat.ts` now looks up the model first and the key second, because the
  model decides the provider and the provider decides which key to use. Before, the key came first. The two orders
  differ only when the registry cannot be loaded and no key is saved: the person is now told about the registry first.

How "nothing changed" was shown (the check scripts live outside the repository, as in every stage):

- A **golden record**, taken from the untouched code and again from the new code: for all four models and six shapes
  of conversation the full request (every header and the exact body text); for 16 behaviours of the mock API the text
  pieces, the ending and the sentence the person reads; and 33 hand-built errors in four variants each (every status
  the SDK has a class for, things that are not Errors, chains of causes, a key inside the message). The two records are
  **byte-identical** (99 KB). Ten one-line sabotages of the new code were each caught (a letter missing from the system
  prompt, the body's key order, a full stop in a sentence, 529 changed to 500, thinking passed on as text, a cut-off
  reply reported as done, no request id, no key scrub, effort sent to every model, no joining of turns).
- The old provider suite (93 checks) passes against the new code through a small shim that gives it its old function
  names.
- Every earlier suite again on the new tree: 53 runs, all clean, with the counts they had before. The three plain-Node
  suites (provider 93 through the shim, registry 162, history store 389); in the dev window Stage 1 to 3's suites (110,
  64 and 5, 71, 77 and 13), the 16 saved-choice launches (9 each) and the 10 registry scenarios, then Stage 4's seven
  runs (89, 17, 9 and 8, 4, 32, 24, 19); and the built app (53, 71, 77, and Stage 4's seven again). One of them, the
  quit with 60 queued saves (`verify-4-3c`), is steady only on an idle machine: it sits at the edge of the 5-second
  quit grace, and it failed twice in the first baseline while I was running other checks on the same computer. After
  the refactor, on an idle machine, it passed 4 of 4 in the dev window and in the built app.
- A new suite for what is new (84 checks): the table of adapters, the request builder, the shape of `stream` (text,
  then exactly one `end`; a failure or a Stop throws; breaking out of the loop closes the connection), `usage` for
  reports of every shape, `listModels` (pages, a rejected key, every status, nothing listening, an aborted signal,
  hostile environment variables) and `normalizeError`. Twelve sabotages of the new code were each caught by it.

Status: accepted (Stage 5.1). Revisit: image or tool content in `NeutralMessage` (a new content type, and a
translation in each adapter); a cost display, which needs cache prices in the registry as well (D-019); showing the
usage that `end` already carries.

## D-019 - The registry says what a model can do; the app acts on what it needs

Stage 5.2 moves `registry/models.json` to schema `0.3` (D-014 described `0.2`). The file still holds facts about models
and the one setting the app picks for each, and still never an address or a credential.

- **`capabilities`**, a new object on every entry, with exactly these fields: `imageInput`, `toolUse`, `reasoning`
  and `promptCaching` (true or false), and `effortLevels` (the effort levels the model's API accepts; an empty list for a
  model that rejects the setting). They are facts from the provider's own documentation, read on 2026-10-01 (for
  Anthropic: the models overview and the Models API's capability fields, plus the effort and prompt-caching pages), not
  settings. `reasoning` means the model thinks by itself before it answers, so Haiku 4.5, which only thinks when it is
  asked to and is not asked here, is `false`.
- **What the app acts on today, and what it does not yet.** `promptCaching` decides whether the Anthropic request
  carries `cache_control` (true for every model now, so no request changed: the golden record from D-018 still
  matches). `effortLevels` is checked against the effort the app picks (below). `imageInput` and `toolUse` change nothing
  today, because the chat is text only: they are stated now because the registry is where such facts belong, and each is
  cheap to state and to check while the file is being edited anyway.
- **`effort` (the pick) and `effortLevels` (the facts) must agree**, and the file is refused entry by entry when they
  do not. The pick is `null` exactly when the list is empty; otherwise it is one of the listed levels, written out
  because the default differs between models (D-014: never guessed). A model that lists levels must be one that
  thinks. The words are checked against what each provider knows (`PROVIDER_EFFORTS`): `none` is not an Anthropic word.
- **The effort vocabulary is wider** (`none`, `low`, `medium`, `high`, `xhigh`, `max`). D-014 allowed only `low`, `medium`
  and `high`, "because not every model that takes `effort` accepts" the higher ones. A model now lists its own, which
  answers that objection, so `xhigh` and `max` can be picked by editing one word. No pick changed in this stage.
- **Ids are unique across providers**, not just within one: the chosen model is saved as its id alone (D-015), and two
  providers each offering the same id would make that choice ambiguous. A second entry with an id already used is left out
  and reported, as before.
- **Not in the registry on purpose:** the prices of cached and cache-written tokens. `usage` (D-018) already counts them
  apart; a cost display (IDEAS) will need their prices too, and they differ by provider and model in ways I could not
  confirm from the documentation I could read.

Status: accepted (Stage 5.2). Revisit: prices for cache reads and writes; checking the file against each provider's own
model listing (`listModels`, D-018: Anthropic's reports `max_input_tokens`, `max_tokens` and a capability tree) to notice a
fact that has drifted, which needs a real key to see how ids and values are spelled; the retirement date of a model.

## D-020 - API keys: one encrypted file per provider, each tied to its provider, tested with a free call

Stage 5.3 gives every provider a key of its own. D-010 still holds for everything it said about how a key is protected
and written; this decides the layout, and what Settings can do with a key.

- **The operating system's secure storage, as before.** "The OS keychain" is, in this app, Electron's `safeStorage`:
  Windows DPAPI, the macOS Keychain, the Linux desktop's secret service (D-010). On Windows that is the facility behind
  Credential Manager, but the key is not an entry you can see there: it is an encrypted file in the app's data folder.
  Putting keys in Credential Manager itself would need a native module (a keyring package), and with it a build and
  packaging step that has never been tried on this project, for no gain against the one threat any per-user store
  has (a program running as you can ask for the key either way). Behind `keyStore.ts` it is one module to swap if you
  want that.
- **One file per provider**, `credentials.<provider>.json`, holding `{ version: 2, provider, key }`. Saving or removing
  one key never rewrites another, a torn write can cost only the key it was writing, and the logic stays as small as
  D-010's. The store itself, `credentialStore.ts`, takes the secure storage as an argument and imports nothing from Electron,
  so it is checked under plain Node in an EFS-encrypted folder with faults injected, like the conversation store.
- **A file is tied to its provider.** The file says which provider its key is for, and that must be the provider asked
  for. A file copied or renamed to the wrong name is treated as holding nothing: it must never hand one provider's key to
  another provider's servers.
- **The old file is still read.** `credentials.json` (`{ version: 1, anthropicApiKey }`) is Anthropic's key when there is
  no file of the new kind. Reading never writes (D-016's rule): it is replaced, and deleted, only when the person saves
  or removes that key.
- **Writes are in place and read back, and one at a time.** A read in the middle of a write cannot happen, and "Saved"
  is said only after the key has been read back. A file larger than 16 KB is not a key file and is not read.
- **Test key** asks the provider for its list of models (`listModels`, D-018). That costs no tokens, so it is free,
  and it proves what a person wants proved: that the provider accepts this key. It always uses the key that is _saved_,
  never one the page hands over, so the page can still never read or aim a key; it gives up after 20 seconds; and the
  page learns only how many models were listed, or one sentence saying what failed (with the key scrubbed from it).
  Saving does not test, because saving should not use the network.
- **What the page is told** about keys is a list of providers, each with its name and whether a key is saved. The calls it
  can make are `setApiKey(provider, key)`, `clearApiKey(provider)` and `testApiKey(provider)`; each goes through the sender
  guard (D-011), the provider is checked against the list in the page and again in main, and a key is checked as before.
- **Settings has one section per provider** (heading, where to create a key, status, the field, Save, Test, Remove), made
  from the list the main process sends, so a provider that is added shows up without a change to the page. The header's
  "No API key" badge and the empty chat's hint are about the provider of the model that will answer.

- **What was checked.** With the check scripts (now in the repository, `tools/`): the credential store under plain Node, in a
  normal folder and in the EFS-encrypted one, with faults injected (174 checks; 12 sabotages of the store were each
  caught, one of them only in the EFS folder); the Settings suite in the real window against the mock (66 checks: Test
  key accepted, refused, 403, 429, 500, 529 and a provider that never answers, the key files on disk, the old
  `credentials.json`, abuse from the page and from `about:blank`, narrow windows; 8 sabotages caught); and the whole
  earlier regression on this tree: the plain-Node suites (provider 93, registry 225, history store 389, adapters 88,
  credential store 174), the window suites of Stages 1-3 (110, 64, 5, 71, 77, 13), all 16 damaged-preferences launches
  (9 checks each), all 10 registry scenarios, the history suites of Stage 4 (dev and built app) and the Settings suite
  in the built app. Everything passed once the following were explained. Two harness faults, both mine: a note the runner
  added about the app's state started with "!!", which the history runners count as a failure, so a test that quits the
  app on purpose looked failed; and the first full run showed seven launches as "0/0" because the old driver printed 0/0
  for any suite that died before its summary line (it is now reported as a crash, with the reason). One flaky check
  was changed: the quit with 60 queued 1.4 MB saves sits right at the 5 s the app waits for saves, and it had already failed once
  before Stage 5 began, so it now queues 30 (3.4 s). A window of the built app was lost 6 s after it opened in one
  launch (nothing in its log) and the same launch passed when repeated, 77/77; such losses are probably caused
  from outside the app (see tools/README.md), and the check driver now retries a lost launch once and says so. **Not done:** a real call to either provider (no key was ever saved; the person has to make
  the first one).

Status: accepted (Stage 5.3). Revisit: keys in Credential Manager (a keyring package); a "master password"; testing a key
before it is saved; showing which models the key can use next to the registry's list (needs a real key to see how the
provider spells its model ids).

## D-021 - Each reply records who answered; the saved file is version 2, and version 1 is upgraded as it is read

Stage 5.4. D-017 left this out on purpose ("it cannot be reconstructed later"). The model can change in the middle of a
chat (D-015), and now the provider can too, so each reply now says which one wrote it.

- **What is stored.** Every assistant message gets two fields, `provider` (one of the registry's providers) and `model`
  (the model's id), in `conversations/<id>.json`, which becomes `"version": 2`. The person's own messages have neither.
  The request spoke of "columns" and a "migration", but there is no table here (D-005, D-016: files, not a database), so
  these are fields, and the migration is a change of file version.
- **The main process says which model answers, before the first word.** The page cannot know: the model is fixed in main
  when a reply starts (D-015). So a reply now begins with a `start` event naming the provider and the model, sent before
  the key is looked up: a reply that fails at once (no key saved, a key that is refused) still records which model was
  asked. The page keeps what it is told on the message and hands it back in each snapshot (D-017). This is data for
  display and not a security property: main checks its shape (a provider from the registry's list, a model id that looks
  like one) as it checks everything, and a page that lies can only mislabel its own conversation.
- **The migration, version 1 to 2.** A version 1 file has no such fields. It is read as a version 2 file whose assistant
  messages say provider `anthropic` (every reply the app ever wrote came from Anthropic, so that is known) and model `null`
  (which of the four models it was is not known and cannot be worked out afterwards; `null` is the honest value, and the
  page shows no name for it). **Reading never writes** (D-016): the file on disk stays version 1, byte for byte, until the
  person next saves that conversation, which writes version 2. Nothing is rewritten in bulk, so no crash can leave the
  history half-converted. A file of version 3 or later is "made by another version" and left alone, as before; a build
  from before this stage treats a version 2 file the same way.
- **Reading is forgiving about these two fields and strict about everything else.** A saved file whose provider is one this
  build does not know, or whose model is not an id, is still a conversation: the unusable field is read as `null`. The
  page's own saves are strict: a provider that is not in the list, or a model that is not an id, refuses the whole save,
  like any other malformed conversation.
- **Shown, quietly.** The list names the model above a reply when it is the first reply and wherever the model changes
  (a chat that never changes model would otherwise repeat one name above every reply). The name is the registry's
  label, or the id for a model the registry no longer lists. This is the one thing the request did not ask for; it is
  what makes the stored field visible, and it is one small component to remove.
- **Usage.** What a reply used (D-018) is logged by main once per reply, with the provider and model. It is not stored with
  the message: nothing needs it yet, and a cost display needs the prices of cached tokens too (D-019).

- **What was checked.** Under plain Node (`tools/verify-5-4-store.mjs`, 107 checks, each store check in a normal folder and in the EFS-encrypted
  one): what the page may save (strict), what is read from a file (forgiving), a version 1 file read as version 2 without being rewritten (same bytes,
  same modification time), the file that is written; 11 sabotages of the new code were each caught. In the real window against the mock
  (`tools/verify-5-4.mjs`, 47 checks, in dev and in the built app): a version 1 file opened and left untouched, then saved as version 2 with its old
  replies "anthropic"/null; the model recorded for replies from Opus and Sonnet, for a refused reply, a stopped one and one with no key saved; the
  names above the replies, also after a reload; the events (`start` first, and no `start` for a request main refuses); everything the page may
  not save; one usage line in the log per finished reply; 10 sabotages of the app were each caught. The earlier suites were ported where this stage
  changes something on purpose (the file version, loaded replies carrying the two fields) and re-run: the plain-Node suites, the window suites of
  Stages 1-3 and 5.3, the history suites of Stage 4 in dev, and the built app's chat suite. **Not re-run on this slice:** the seeded launches and
  registry scenarios (nothing here touches them) and the history suites in the built app: the full regression runs again after Stage 5.5. Two
  scroll checks of the Stage 1 chat suite failed once and passed on the repeat; the cause was not found.

Status: accepted (Stage 5.4). Revisit: storing the usage with each reply; a bulk upgrade of old files, if ever wanted (it
would have to be written with D-016's care); searching or filtering history by model.

## D-022 - OpenAI is the second provider: the Responses API through OpenAI's own SDK, nothing kept on their side

Stage 5.5. The provider layer (D-018) and the per-provider keys (D-020) were built so that a second provider is one new adapter,
one entry in each table, and rows in the registry. OpenAI was chosen as the second provider (Gemini would be the third).

- **What was added.** `src/main/providers/openai.ts` (the adapter), `openai` in `SUPPORTED_PROVIDERS` (the type of the adapter table, of
  the provider names and of the key help is what makes the list and the code agree: a provider added to the list without them does not
  compile), the three models of OpenAI's current GPT-6 family in `registry/models.json` (gpt-6-astra, gpt-6.1-sol, gpt-6-luna: 1,050,000
  tokens of context and 128,000 of output each, prices of USD 10/50, 2/10 and 0.10/0.50 per million tokens in/out; effort levels low to max,
  and Luna also none; read from OpenAI's model pages on 2026-10-01), and one new kind of failure, `quota`. The default model is still
  Claude Opus 5.5, so nothing changes for a person who adds no OpenAI key.
- **The Responses API, not Chat Completions.** OpenAI recommends it for new work and the model pages list both. It takes the
  conversation as `input`, the system prompt as `instructions`, and `reasoning.effort`. The SDK (`openai`, Apache-2.0, no runtime
  dependencies, `npm audit` clean) does the streaming, the retries and the error classes, as the Anthropic SDK does (D-012). Reasoning is
  on for every model in the family and is billed as output, so the reply ceiling (16,000 tokens, D-012) covers it too.
- **`store: false` on every request.** Responses are kept on OpenAI's side by default. This app sends the whole conversation each time and
  uses none of that, so it asks for nothing to be kept. A mock that refuses a request without it checks this.
- **The key goes where this file says, and nowhere else.** The SDK fills anything it is not given from the environment
  (`OPENAI_API_KEY`, `OPENAI_BASE_URL`, `OPENAI_ORG_ID`, `OPENAI_PROJECT_ID`, `OPENAI_CUSTOM_HEADERS`, ...). The adapter gives every option
  explicitly, so none is read from there, and removes `OPENAI_CUSTOM_HEADERS` (the one thing with no option to override it) for the
  moment the client is built. Pinning `adminAPIKey` and `webhookSecret` has no effect on the two calls this app makes; it is kept as a
  precaution and is not something a test can see.
- **Usage.** OpenAI's `input_tokens` already contains the cached and cache-written tokens (they are subsets of it), so the adapter
  subtracts them to give the four separate counts of D-018. Reasoning tokens are inside `output_tokens` and need no handling.
- **Failures in the app's words.** The same sentences as for Anthropic (D-018), naming OpenAI. OpenAI answers 429 both for "too many
  requests" and for "no credit left" (told apart by the error's own code), so there is a new kind, `quota`, with its own sentence: your
  account has no credit left or has reached its spending limit; check your billing. A reply that ends `incomplete` for `max_output_tokens`
  is "cut off"; for `content_filter`, and a refusal written as the reply's text, it is "declined".
- **What the assistant is called.** The system prompt does not name a product for OpenAI ("You are an AI assistant, ..."): a model told
  it is someone else answers oddly, and the app does not know what OpenAI's models call themselves.
- **One conversation, either provider.** The conversation is plain text turns (D-018), so a chat started with Claude can be continued with
  a GPT model and back, and each reply records which one wrote it (D-021). Each request carries only its own provider's key.
- **What was checked, and what was not.** Against local mocks only, as every stage so far. The OpenAI mock is _my reading of OpenAI's
  documentation and of the SDK's own types_: it refuses a request shape the documentation says is refused (a missing \`store: false\`, an
  effort the model does not take, an unknown field, an \`x-api-key\` header), and misbehaves on demand. Under plain Node
  (\`provider-openai-test-5.mjs\`, 107 checks): the request each model gets, the stream, usage with cached tokens, refusals, incomplete and
  failed replies, a connection dropped half way, every error class and status, the key scrubbed from an error, a hostile environment
  (\`OPENAI_BASE_URL\`, \`OPENAI_CUSTOM_HEADERS\`, ...), and a runaway listing; 13 sabotages of the adapter were each caught. In the real
  window (\`verify-5-5.mjs\`, 53 checks, against both mocks at once): a key saved for each provider through Settings, Test key for OpenAI,
  each of the three models answering, a conversation that moves from GPT models to Claude and carries all of it, the errors in the app's
  words, a missing key named for the right provider, the two keys never crossing, and the usage in the log; 8 sabotages of the app were
  each caught. The whole regression then passed on the finished tree (see STEP-LOG, Stage 5, step 7). **Not checked: a real call to OpenAI.** No key was ever saved, and a real key cannot be typed for you. Where the mock and
  the real API could disagree: the exact spelling of the model ids and of the stream's events, what a real 429 for a spent budget carries,
  and whether a real key is allowed to list models (a restricted key may not be, which Test key would report as a 403). The first real call
  is yours: Settings (Save key, Test key, send a message), or \`node tools/real-call.mjs\`.

Status: accepted (Stage 5.5). Revisit: the first real call (the model ids, the default effort of gpt-6-astra, which the documentation does
not state, and which is set to "medium" like the other two); Chat Completions as a fallback if the Responses API misbehaves; image input and
tools (the registry already records which models take them); showing a model's retirement date (D-014); Gemini as the third provider.
