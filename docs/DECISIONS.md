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
(D-012) asks it for plain text; remove that once Markdown is rendered. Status: **superseded by D-025**
(Stage 7.2): a reply is now drawn as Markdown by a reader of the app's own that can only make a fixed set of
elements, and the system prompt says so. What the person types is still shown as plain text, as typed.

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

## D-023 - `rankings.json` is a shortlist of what the providers' own pages say, not a ranking; the app offers it and never picks

The roadmap said "use `registry/rankings.json` to suggest a model per task". The plan was a score from 0 to 100 per model and task. **No such
score could be backed.** The pages that were read (Anthropic's model overview and "Choosing a model", OpenAI's model pages, 1 October 2026) give
words, not numbers that compare these models with each other: a use-case matrix, a latency tier, "best for" lines. A benchmark table on a
vendor's own page compares its own models with each other and with the previous generation, not Claude with GPT; the one place that put the
two together (OpenAI's announcement) answered 403 and was never read, and third-party articles that quote it are not a source. A number
written here anyway would look like a fact. So the file does not hold scores.

- **A row is a statement, with its evidence.** `{ task, modelId, note, source, asOf }`: this provider's page names this model for this task,
  `note` is what the page says (quoted), `source` is the https address, `asOf` the day it was read. Schema 0.2. Exactly these fields; a typo,
  a score slipped in, an `http:` address, a date that is not a date, or the same model twice for one task leaves that row out and says so in
  the log, and the other rows stay (as D-014 does for models). A file that is wrong as a whole (the wrong version) is refused. An empty list
  is a valid file.
- **The tasks are four, fixed in the code**: chat, coding, writing, quick answer. The page is told the list; it never makes one up.
- **Seven rows, and what was left out.** Opus 5.5 coding; Sonnet 5.5 coding and writing; Haiku 4.5 quick; Astra coding and writing; Sol coding.
  Left out because nothing that was read says it: **chat** (no page names a model for plain chat; "most workloads start with Opus 5.5" is
  not about chat), **Fable 5.1** (named for "the highest available capability" and long agentic work, which is none of the four), **GPT-6
  Luna** ("focused, high-volume tasks" is efficiency, not a task of these four), and **quick answer for OpenAI** (OpenAI states no
  latency). Two rows rest on a reading of the page's wording: "content creation" (Sonnet) and "document creation" (Astra) as _writing_.
  Chat therefore shows "No suggestion for chat". That is the honest answer today.
- **The app never picks.** The header has a **Task** menu (any task, or one of the four). Choosing one changes nothing: the model menu then
  marks the models named for it with "(suggested)", and a tooltip lists each with the page's words, its address and the date. There is no
  single "best" and no one-click accept, because without scores there is nothing to order by that would not be a guess (the registry's
  order and the prices are facts, but "cheapest of those named" is a judgement about what the person is billed, and that is theirs). Choosing
  a task writes nothing to disk and does not touch the model that answers. The task is not saved: it is a hint for the next choice.
- **Only models that can be used now.** A row is offered if its model is in the registry and its provider has a key saved. A model that has
  left the registry (Haiku 4.5 may be retired from 15 October 2026) has its row skipped, not reported: that is normal, and the row can be
  deleted later. The rankings file is **optional**: if it is broken, the log says why, there are no suggestions, and the chat, the models
  and Settings are unaffected.
- **Where it runs.** `src/shared/rankings.ts` (the check and `suggestionsFor`, plain functions), `src/main/rankings.ts` (the embedded file,
  checked once, like the registry), `getStatus` gains `tasks` and `suggestions` (main filters by key; the page filters by task), and two
  small components, `TaskPicker` and a change to `ModelPicker`. The registry's check helpers were exported to be reused, not copied.
- **What was checked.** Under plain Node (`verify-6-1.mjs`, 108 checks): the real file, every kind of damage to the file and to a row, the
  suggestions with each key combination, Haiku removed, hostile and frozen inputs; 10 sabotages of `rankings.ts` were each caught. In the
  real window (`verify-6-2.mjs`, 27 checks; `verify-6-3.mjs`, 6 and 7 checks with the file damaged on purpose): the menus, the marks per
  task and per key, the note for chat, nothing chosen or saved by choosing a task, a removed key, a whole file and a single row broken;
  5 sabotages of the app were each caught. The three older suites that listed the exact fields of `getStatus` were updated for the two new ones.

Status: accepted (Stage 6). Revisit: real benchmark rows once there is a source that compares these models on one scale (then a schema 0.3
with an optional score, and an order); a row for chat; deleting the Haiku row if it is retired; whether people want a single suggestion
after all (the cheapest of those named is the obvious rule, and would be a decision about their money).

## D-024 - The person chooses how hard each model thinks (Effort); main keeps the choice per model and checks it against the registry every time

Until now every reply asked for the one level that `registry/models.json` names for the model (D-014, D-019), and the person could not change
it. The Claude desktop app has an Effort control and the roadmap asked for one (Stage 7). Higher effort means the model thinks longer before it
answers: slower, and the thinking is billed as output.

- **What the person sees.** A menu next to the model menu: "Effort: Low (faster)", "Effort: Medium (default)", ..., "Effort: Max (smarter)". It
  lists only the levels the registry gives the chosen model (`capabilities.effortLevels`), from the one that thinks least to the one that
  thinks most (sorted by the app, not trusted to the registry's order). It is not in the page at all for a model that takes none (Haiku 4.5).
  The level the registry picks stays in force until the person chooses, and is marked "(default)". The menu is disabled while a reply is
  arriving: the effort is fixed when a reply starts, like the model. Its tooltip says what a higher level costs (slower, billed as output) and
  that the thinking counts against the reply's length limit.
- **Kept per model.** `preferences.json` stays version 1 and gains `efforts`: `{ "<model id>": "<level>" }`. Choosing a level for Opus does not
  touch Sonnet's. One function writes the whole file (`writePreferences`), so choosing a model never drops the efforts and choosing an effort
  never drops the model; it is written in place and read back (D-010, D-015), and both kinds of change share one queue (`inOrder`), so two
  calls cannot cross.
- **Checked three times, never the page's word.** (1) The handler: `checkEffortChoice` accepts only a model that is on offer and a level that
  model's own entry lists, matched exactly (no other letter case, no padding), and hands back the registry's strings, never the page's.
  (2) `chooseEffort` checks again where it saves. (3) Every time a reply starts, `resolveEffort` checks the saved level against the model's
  list: the registry can change under a saved choice. A level the model no longer lists is not used (the registry's pick is), once in the log,
  and the file is left alone so the choice comes back if the level does (as a saved model does, D-015).
- **Reading is forgiving, so a damaged `efforts` never costs the model choice.** `parseSavedEfforts` keeps the usable entries and drops the
  rest (a key that is not shaped like a model id, a value that is not a known level), takes at most 200, and builds a Map, so no key (`__proto__`
  included) is special.
- **The page decides nothing about a reply.** The chat request carries no effort. `chat.ts` takes it from `currentModel()`, fixed with the model
  for the whole reply, and `StreamRequest.effort` is what an adapter sends (never `model.effort`, which is only the registry's default). The page
  is told `{ levels, selected, default }` for the chosen model and nothing about how a model is called (`toModelOption` still says nothing about
  effort).
- **Nothing chosen, nothing changed.** With no level chosen, the requests are byte-identical to Stage 6's (compared on a copy of `main`,
  42 requests, see "What was checked").
- **The ceiling is unchanged.** A reply is still limited to 16,000 tokens and the thinking counts against it, so at the highest levels a reply
  may stop early and show the existing "cut off" notice. Raising the ceiling would be a decision about spending, which is Stage 8's.

**Threat note (what could go wrong, what stops it, what is left).**

- _The page, or a script in it, sends an invented model or level_ (`max` for Haiku, `none` to Anthropic, `__proto__`, padding, another case, a
  non-string): refused by the handler, and again where it is saved; 19 kinds of bad input were refused with plain sentences that do not echo
  the input, and nothing was written. A call from an `about:blank` page is rejected by the sender guard. **Left:** a script in the app's own
  page can still choose any level a model takes. That is what the menu does, so it is no new power.
- _A hand-edited or damaged `preferences.json`_: read forgivingly (above), capped, no special keys; nine stale or damaged seeds were each read and gave the expected model and level. **Left:** whoever can write to your profile can set a level the model takes, the same as the menu; that is the same
  limit as D-010 and D-015.
- _A saved level the registry stops offering_: not used, once in the log, the registry's pick applies.
- _Cost_: a higher level is billed as more output. The tooltip says so; there is no limit yet. **Left:** one click sets a level for every later
  reply of that model until it is changed, and nothing counts or caps the extra thinking beyond the 16,000-token ceiling per reply. Stage 8's
  spending limit has to count it.
- _A reply cut short by the thinking_: the existing notice for a cut-off reply. Not a safety matter; it can surprise.
- _Two copies of the app at once_ can overwrite each other's `preferences.json` (as for the model, D-015). Not handled.

**What was checked, and what was not.** Against local mocks and scratch profiles only. Under plain Node (`verify-7-1.mjs`, 90 checks): the
check, the saved-file reader and the resolver with every kind of damage, hostile and frozen input. In the real window (`run71.mjs`, 198
checks): the menu for each of the seven models (Haiku has none), the request each reply sends (the strict mock refuses what the real API
documentation says is refused), per-model memory, a restart, the menu locked during a reply while a reply already running keeps its level,
19 kinds of bad input, a call from `about:blank`, bursts of rapid changes ending on the last choice, the keyboard, two narrow widths (420 and 320 px:
nothing overflows), no key or warning in the log, and ten seeded `preferences.json` files (one good, nine with a stale, damaged or hostile
`efforts`). Negative controls: the Node suite caught 17 of 17
sabotages; the window suite had 15 sabotages: 13 were caught clearly, and two need a note: switching off the handler's check alone is caught only by
the refusal sentence, and switching off the save-time check alone changes nothing **by design** (two layers, either alone suffices, as in
D-015); the seeds caught 6 of 6. The request bytes of a reply with nothing chosen are identical to Stage 6's. The older suites were then re-run on the new tree (`node tools/regress.mjs t71 node window seeds scenarios`, 2 October 2026): 46 runs, 44 clean the first time. The two that were not were checks this slice made stale, not faults: the adapter suite's list of the fields of a request (which now holds `effort`) and `verify-3-4`'s Tab order (the Effort menu now sits between the model menu and Settings). Both were updated and pass on their own re-run (94 of 94, 78 of 78). The Stage 4 history suites and the built-app (`preview`) runs were not re-run for this slice.
**Not checked:** (1) **a real call to either provider.** How a real API answers at each level, whether it accepts every level the registry
lists for each model, how much more it thinks and costs, and where the 16,000 ceiling cuts a reply at the highest levels are all unknown; the
mock is my reading of the documentation. The first real use is yours: Settings, then a message at two levels. (2) The OS-drawn list of the
menu (it cannot be seen or clicked through the debug protocol): levels were chosen with the keyboard and by calling the same function the
menu calls; a mouse pick of an entry was not exercised. (3) A screen reader. (4) The built app (`preview`) for this slice; it runs at the
end of Stage 7. (5) Any system other than Windows.

Status: accepted (Stage 7.1). Revisit: the first real call (the levels each model really accepts, and what each costs); Stage 8's spending
limit counting the thinking; a per-chat level, if one level per model proves too coarse; raising the 16,000 ceiling for the highest levels.

## D-025 - Replies are drawn as Markdown by a reader of the app's own that can only make a fixed set of elements; a link asks before it opens

Until now a reply was shown as plain text, and the system prompt asked the model for plain text, because Markdown or HTML from a model needs a
renderer that cannot be talked into running anything (D-009). Stage 7.2 draws replies as Markdown. D-009 is superseded.

- **No package, no HTML.** The usual route (`marked` or `markdown-it` for HTML, then a sanitiser such as DOMPurify, then
  `dangerouslySetInnerHTML`) puts a string of HTML between a model and the window, and the sanitiser is then the only thing in the way.
  `react-markdown` avoids the string but pulls in dozens of packages (the `unified` tree). This app has no reader that ever makes HTML:
  `parse.ts` turns text into a tree of fourteen known kinds (seven inline, seven block), and `Markdown.tsx` turns that tree into React
  elements. The reader is about 740 lines and the rest about 310, all the app's own code, with no dependency and nothing to audit but
  itself. The price is that it is not CommonMark, and it has the bugs of a new reader (see "not checked").
- **What it reads:** paragraphs (a line break the model wrote is kept), headings, **bold**, _italic_, ~~strike-through~~, `inline code`, fenced
  code (three backticks or three tildes, with a language label), code indented by four spaces (how replies were written under the old plain-text
  rules, so old chats still show their code as code), block quotes, bulleted and numbered lists (nested), tables with alignment, rules, and
  links. **What it does not read, and shows as the text it was:** raw HTML, images (`![alt](url)` appears as written and nothing is loaded),
  reference links, bare web addresses (not clickable), footnotes, task lists, setext headings, entities (`&amp;` stays), maths.
- **A closed set of elements.** The page makes only `p`, `h1` to `h6`, `strong`, `em`, `del`, `code`, `pre`, `blockquote`, `ul`, `ol`, `li`,
  `table`, `thead`, `tbody`, `tr`, `th`, `td`, `hr`, `br`, `div`, `span` and `button`, with the attributes `class` (a fixed list), `title` (only an
  https address), `type="button"` and `start` (digits). No `style`, no `href`, no `src`, no event handler of a reply's making, and no
  `dangerouslySetInnerHTML` anywhere. What a reply says goes in as text, which React escapes.
- **Links.** Only `[text](https://...)`. The address must be https, have no user name or password, no space, control character, backslash,
  angle bracket or quote, be at most 2000 characters, and be accepted by `new URL`; what is shown and opened is the address as `new URL` writes
  it (a host with accents appears in its `xn--` form). Anything else stays visible text. A link is a `button` with no `href`: a click opens a
  dialog with the whole address, the host in words ("It goes to example.org") and **Cancel** (which has the focus; so has Escape) or **Open**.
  Only Open calls `window.open`, which the main process passes to the operating system only for an https address without credentials (it
  also passed plain http before; `isSafeExternalUrl` is narrower now). A middle click does nothing. The point of the dialog is a link whose
  words say one address and whose target is another. **Left:** a script in the app's own page can still call `window.open('https://...')`
  without the dialog; that is the app's own code, which the dialog was never meant to stand against.
- **Limits, so that a hostile or broken text costs bounded work.** Quotes and lists nest to 6; emphasis and links to 6; a table has at most 20
  columns and 200 rows (the rest stays text); a link's text is at most 1000 and its address 2000 characters; and each piece of text gets a work
  budget of 40 steps per character (and 5000 over), after which the rest of that piece is plain text. The scan limits on links and the budget
  overlap: either one alone is enough against a slow text, as the two layers in D-015.
- **Streaming.** A reply is cut into pieces at a blank line that is followed by an unindented line, never inside a code fence. A finished piece
  is read once (the page remembers it by its text); only the piece still growing is read again with each word. A list whose items are
  separated by blank lines therefore becomes one list per item, each keeping its number; it looks the same.
- **The person's own messages stay as typed.** They are not read as Markdown. What is sent to the model, and what is saved, is the Markdown
  source as written, never HTML.
- **The system prompt** now says the window renders Markdown, names what it draws, says that HTML, images and diagrams are not shown and that
  only https links open, and asks short answers to stay plain. That is a request, not a safety measure: the reader above is what keeps a
  model from doing anything. The requests are otherwise unchanged (see "what was checked").
- **Copy on a code block** writes exactly the characters of the block to the clipboard when it is clicked (`navigator.clipboard.writeText`),
  and says "Copied". Nothing in the app reads the clipboard, and nothing writes it except that click. It is a small new power, with no change
  in the main process. A tab stays a tab inside a fenced block (Go, Makefiles). Windows itself turns line ends into CR LF on the clipboard.

**Threat note (what could go wrong, what stops it, what is left).**

- _A reply that tries to be HTML or script_ (`<script>`, `<img onerror>`, `<iframe>`, `<style>`, handlers, `javascript:` and `data:` links, an
  attribute broken out of with a quote, text arriving in halves so that `<scr` and `ipt>` meet): there is no HTML reader to hand it to; the
  markup is text. Checked in the real window with such texts (nothing ran, no forbidden element, nothing loaded, the page still showing), also
  while streaming two characters at a time, and in Node by rendering 22 attack texts and 3000 random ones and reading everything React wrote
  back against a list of tags, attributes and classes.
- _A link that lies_ (words say one address, target is another; a user name in the address to hide the host; accents that imitate a host): the
  dialog shows the real address and host, the user-name form is not offered, and the `xn--` form is shown honestly. **Left:** nothing stops a
  person from pressing Open on a bad address. The app does not judge addresses, and does not stop https pages that are themselves harmful.
- _Something loading by itself_ (an image, a font, a frame): nothing a reply makes has a `src` or an address of its own, and the page's
  Content-Security-Policy (no remote sources) was left as it was. No request for anything outside the app was seen while the attack texts
  were on screen.
- _A text built to make the reader slow_ (a hundred thousand brackets, backticks or stars, quotes nested 50,000 deep, a 64 KB line, a table
  of 5000 columns): 29 such texts, each read in under 1.5 s without an error, and 6000 random ones, none slower than 50 ms. **Left:** a text of
  64 KB still takes some milliseconds, not none; the 16,000-token ceiling of a reply (D-024) is what keeps it from being larger.
- _The clipboard._ **Left:** Electron grants every permission request when no handler is set, and this app sets none; the page asks for
  nothing but the clipboard write, and the only code in the page is the app's own. A deny-by-default handler is in IDEAS.
- _A model that ignores the system prompt and writes something the reader does not know:_ shown as text. Nothing breaks.

**What was checked, and what was not.** Against local mocks and scratch profiles only. Under plain Node (`verify-7-2.mjs`, 193 checks): the
reader (inline, links with 23 kinds of refused address, blocks, tables, lists, the pieces of a growing text), 29 hostile texts and 6000
random ones, `isSafeExternalUrl` (17 addresses), and the elements the page makes (22 attack texts, 3000 random texts, the allowed list). In
the real window (`run72.mjs`, 53 checks): every kind of Markdown drawn; the person's own message untouched; what is sent back to the model
being the source; attacks; a link asking first and only Open reaching a recorder in place of `shell.openExternal` (the real browser is never
opened by the suite), by Cancel, Escape, Enter on Cancel, Open, a middle click, and a link whose words are another address; what
`window.open` from the page can reach; Copy by mouse and by keyboard with exact characters; streaming by words and by two characters at a
time (the finished page is the same DOM, and no snapshot on the way had a forbidden element); a 21 KB reply with 150 headings; old-style
replies; the saved chat holding the source and being drawn again from History; empty and half-failed replies; 420 and 320 px wide. Negative controls: of 25 deliberate breakages of the reader, the elements, the link rule
and the system prompt under Node, 22 were caught; the 3 that were not are layers that overlap by design, so removing one alone changes
nothing (the depth cap, because the work budget stops a deep text first; the link-scan limits, because the budget bounds them too; the
http spelling in the address check, because `new URL` refuses the scheme as well). All 8 breakages of the real window were caught (a link
that opens without asking, Copy adding a character, the person's own text rendered, the bubble not capped, lines not kept, main letting http
through, the old prompt, text written as HTML); every file was put back and proved identical by hash. The last of these also showed what the
page's Content-Security-Policy does and does not add behind the reader: with text written as HTML, the policy refused the inline handler of an
injected `<img>` (`script-src 'self'`, in the app's log, so nothing ran), but it did not stop an injected `<style>` from hiding the page
(`style-src` allows inline styles, which the app's own React code needs). So the reader is the wall for markup, and the policy is only a
second wall for scripts.
The older suites were re-run on this tree (`node tools/regress.mjs t72 node window scenarios`, 2 October 2026): 32 runs, 28 clean the first
time. The four that were not were checks this slice made stale, not faults: the Stage 2 golden request holds the old system prompt; the
Stage 1 chain, `verify-2-4` and `verify-5-5` read an assistant bubble's text, where trailing spaces are no longer shown, paragraphs are
elements and a run of spaces collapses (they now read what a person sees, `innerText`, and the person's own message is checked as typed).
All four pass on their own re-run (96, 110, 71 and 53 checks). The requests of every model in every conversation shape (42 of them) were
compared with those of the Stage 7.1 commit: they differ only in the system prompt (and the Content-Length it causes, by the same 107 bytes
each), and the outcomes, the error sentences and the message merging are identical. The seeded launches, the Stage 4 history suites and the
built-app (`preview`) runs were not re-run for this slice.
**Not checked:** (1) **real model output.** Only the mock and my own samples. How real replies use Markdown (nested lists with odd
indentation, tables with pipes in code, HTML inside code, maths, lines wrapped by the model) is unseen, and the reader is not run against the
CommonMark test suite, so differences from CommonMark are expected beyond the ones listed. (2) A screen reader. (3) Syntax colours (none
exist). (4) The real `shell.openExternal` (replaced by a recorder; the mechanism is Stage 2.2's and is unchanged). (5) The built app
(`preview`) and the Stage 4 history suites; they run at the end of Stage 7. (6) Any system other than Windows. (7) Typing a very long message
(21 KB) into the box stalls the page for about 2.5 s; that is the input box, not this slice, and was not looked into.

Status: accepted (Stage 7.2). Revisit: the first real replies (what the reader gets wrong); syntax colours; the parts of Markdown left out; a
deny-by-default permission handler; whether a line break inside a paragraph should be a space as in CommonMark (it is kept, which is right
for old replies and wrong for a model that wraps its lines).

## D-026 - Copy, Regenerate and Edit-and-send-again: asking again replaces what was there, and every way of asking again waits for a reply that is arriving

Stage 7.3 puts small buttons under the messages of a chat. They are shown when the pointer is over a message or the keyboard is in it, always
under the last message, and always where there is no pointer to hover with.

- **Copy**, on any message that has finished arriving: puts the text on the clipboard as it is stored, that is, what the person typed, or a
  reply as the Markdown the model wrote (not the drawn text), and says "Copied". One function (`useCopy`) is now the only place in the app that
  writes the clipboard; the Copy button of a code block (D-025) uses it too. It is written on a click and at no other time, and nothing reads
  the clipboard.
- **Regenerate**, on the last reply only ("Try again" when it failed, which is the retry button IDEAS asked for): the last reply is replaced by a
  new one. The conversation up to the person's last message is sent again, with the model and the effort chosen now (so changing either and
  pressing Regenerate is how two models are compared; the new reply says who wrote it, D-021).
- **Edit**, on the person's own messages: the message becomes a text box in its place. **Send** replaces the message with the new text, drops
  everything after it, and asks the model again. Enter sends, Shift+Enter makes a new line, Escape cancels, as in the box at the bottom. Send is
  off until the text is changed and is not empty, and the text is trimmed as it is in the box. **When more than the last exchange would go** (that
  is, more than the one reply right after the message), it asks first: "Sending this replaces the 5 messages after it, here and in the saved
  chat. They cannot be brought back." and the button says "Send anyway"; changing the text takes the question back.
- **Replaces, and keeps no versions.** That was the simplest choice and the one the plan named. What it costs: the replaced reply, or the
  messages after an edited one, are gone, from the screen and from the saved chat (the file is rewritten with the shorter conversation: still
  one chat, one file, and the title follows the first message). **Left:** there is no undo, and no "keep both"; Regenerate does not ask, because
  it replaces one reply.
- **Billed again.** Each of Regenerate and Edit-and-send makes a new request that carries the whole conversation. The buttons' tooltips and the
  edit box say so. Nothing here repeats by itself: every request comes from a click, so there is no loop. **Left:** no limit stops a person who
  clicks Regenerate twenty times; Stage 8's spending limit has to count these requests too.
- **Off while a reply is arriving.** Regenerate and Edit are disabled, with a tooltip that says when they come back, and `useChat` also refuses
  a second request while one is running (so a double click cannot start two). **One difference from the plan** ("all off while replying"):
  Copy stays on for messages that have finished, because it asks nothing of the model; the message that is still arriving has none.
- **What is sent, and what is not new.** The conversation to send is worked out by three plain functions (`chat/rewrite.ts`: the conversation
  without its last reply, the conversation up to an edited message, how many messages follow one), which change nothing they are given. The
  main process is unchanged: the request is the same `chat:start` as a message typed in the box, checked the same way, and no new message
  crosses the bridge. A script in the page can do nothing here that it could not do before.
- **Small things.** The page keeps older messages from drawing again while a reply streams in (the callbacks that reach them are the same
  function from one render to the next). After asking again the keyboard goes back to the box at the bottom. A chat that gets shorter (an
  earlier message edited) scrolls to its end, where the new reply is.

**Threat note (what could go wrong, what stops it, what is left).**

- _Losing something by a click._ Regenerate replaces the last reply at once; Edit asks first only when more than the last exchange goes.
  **Left:** a reply that was good and was regenerated cannot be brought back. The saved copy is overwritten too.
- _Money._ Each click bills again, and the tooltips say so. **Left:** no limit until Stage 8; nothing repeats without a click.
- _A second request while one runs._ Refused in the buttons (disabled, checked in the window) and again in `useChat`. **Not tested:** that
  second guard is not reachable from outside the page (a second click lands on a button that is no longer there), so a sabotage of it would
  go unnoticed; it is there as a belt to the braces.
- _The clipboard._ Copy writes only on a click, only the text of a message already on screen. **Left:** what is copied may hold anything the
  model wrote, and whatever the person pastes it into is theirs to watch.
- _Text typed into the edit box_ is shown in a plain text box and goes out through the same checks as any message; it is never drawn as
  Markdown (D-025).

**What was checked, and what was not.** Against local mocks and scratch profiles only. Under plain Node (`verify-7-3.mjs`, 27 checks): the
three functions with every shape of conversation, frozen inputs, hostile ids and texts. In the real window (`run73.mjs`, 53 checks):
what is offered under each message; Copy of a reply, of a message, of a Markdown reply (the source) and while another reply arrives; every
button waiting for a reply that is arriving; Regenerate (what is sent, that the reply is replaced and not added, that the saved chat follows,
that another model answers and says so); Try again after a failure and the way out by editing; Edit of the first, a middle and the last
question (what is asked, what is sent, what is gone from the screen and from the file); Escape, Cancel, Enter and Shift+Enter; a chat opened
from History; the keyboard returning to the box; 420 and 320 px wide. Negative controls: all 12 breakages of the three functions were caught under Node. Of 13 breakages of the real window, 12 were caught (the one that sends the old reply along with the question ended its first launch without a summary, which is not a detection, so it was run again on its own and failed three checks), and one was not: taking the trimming out of the edit box changes nothing, because the function that works out the conversation trims as well (two layers, as in D-015). Every file was put back and proved identical by hash. The older suites were re-run on this tree (`node tools/regress.mjs t73 node window scenarios`, 2 October 2026): the Node suites all passed, and the window and scenario parts passed 23 of 23 on the second run. The first run had ended early, and the reason was the test harness, not the app: a launcher (`run71.mjs`, a dozen launches) outran `regress.mjs`'s 400-second limit, was killed, and left its app on the debug port, which stopped the launches after it. The limit is now 15 minutes and tools/README says what to do if it happens. No older check had to be changed for this slice. The Stage 4 history suites, the seeded launches and the built-app (`preview`) runs were not re-run.
**Not checked:** (1) a real model asked again (only the mock); (2) a screen reader, and the layout where there is no pointer (`hover: none`);
(3) a very long chat edited near its start (the shortening is the only direction a save has to handle, and it was tried with six messages);
(4) Stage 4's history suites and the built app, which run at the end of Stage 7; (5) Windows only.

Status: accepted (Stage 7.3). Revisit: versions of a reply (keep the old one, flip between them) if replacing proves too blunt; asking before
Regenerate; counting the requests against Stage 8's limit.

## D-027 - The person can give a chat instructions of its own: they are added after the app's rules, sent with every request of that chat, and saved with it (file version 3)

Stage 7.4 puts an **Instructions** button in the header. It opens a dialog with one text box, and what is written there is told to the model with
every message of that chat: who to be, how long to write, what to leave out. It is the "system prompt of your own per chat" of the roadmap.

- **One text per chat.** Not per model and not for the whole app: a new chat starts without instructions, and a chat opened from History brings its
  own back. Empty means none. The text is trimmed, and may hold at most 8,000 characters once trimmed (about 2,000 tokens): they go out with
  EVERY request, so the limit is also a price, and a page of instructions is what the box is for. One function, `checkInstructions` (in
  `src/shared/validate.ts`), applies that rule to everything that carries them: the chat request, the save, the file when it is read and
  the store when it writes, so what is written can always be read and what is sent is what the person saw. The page runs it for its count; main
  runs it again.
- **After the app's rules, never in their place.** The system prompt is the app's own rules (what the window can draw, D-025), then a blank
  line, then one line, "The person has given these instructions for this chat:", a blank line, and the text. That line is the only text the app
  adds. The instructions are last, so the person's words are the last word. The page cannot set the system prompt: the request has no such field
  (`ChatRequest.instructions`; the plan's working name `system` was dropped because a field with that name suggests the page controls the prompt),
  and `checkChatRequest` drops a `system` field if a script sends one. What this costs: an instruction such as "ignore the rules above" may be
  followed, and the model may then write raw HTML, which the window shows as text (D-025). Nothing safety-relevant depends on the prompt: the
  limits are in the app's code, never in what a model is asked.
- **Nothing changes for a chat without instructions.** The prompt is then exactly what Stage 7.3 sent, and the request has no new field on the way
  to main (the page leaves the key out when there are none). Checked byte for byte against the recorded requests (below).
- **Seen first, and always visible (safety rule 1).** The dialog says, next to the box: the instructions are added to the app's own rules and
  sent with every message of this chat, to the company that runs the model that answers (and to another company if the model is changed),
  billed as part of the conversation, saved as plain text in this chat's file on this computer, not for passwords or keys, and a new chat starts
  without them. While they are set the header button says "on" (and its tooltip says how long they are). Nothing is sent that was not written in
  the box, and the box shows all of it; the app's own rules are described, not shown (showing them would need a new message from main).
- **A draft until Save.** Typing changes nothing. Save (the button reads "Turn off" when the box has been emptied) sets the chat's instructions;
  Escape and Cancel throw the draft away. The count is of the trimmed text and turns into a warning ("1 too many") with Save off; the box does
  **not** use `maxLength`, because a long paste would be cut without a word. Saving sends nothing; the chat is saved at once if it has messages (a
  chat with no message has no file, as before). The button is off while a reply arrives, like the model and the effort menus (D-015, D-024), and
  `useChat.setInstructions` refuses then too. **Asking again** (Regenerate, an edited message) sends the instructions the chat has at that
  moment, so changing them and pressing Regenerate shows the difference.
- **Saved with the chat: file version 3.** The `instructions` field sits between the dates and the messages and is always there (`""` for none). A
  version 1 or 2 file is read as a version 3 one with no instructions and stays exactly as it is on disk until that chat is next saved: reading
  never writes, and nothing is converted in bulk, as in D-021. In a version 3 file the field must be there and be usable text: **strict**,
  like the title and the dates, because a chat that opened without the instructions it was saved with would quietly answer differently. A file
  whose instructions are not usable is counted as unreadable and left alone, like any damaged file. A version 4 file is another build's and is
  left alone. (A version 2 file that carries an `instructions` field, which no build wrote, is read without it.) The store also refuses to write
  instructions it could not read back. **What it costs:** a chat saved by this build is version 3, so a build from before Stage 7.4 would count it
  as unreadable and leave it alone; there is no way back to the old format.
- **Small things.** The dialog keeps its title and buttons in view and scrolls only its body, so it fits the default window (900 by 670) and
  works at 320 px wide. At the default window width the header's controls now wrap under the title (the header's own rule for a narrow window;
  the new button made them wider than the window): measured at 886 px of page, with a key saved, the header goes from one row of 47 px to two
  rows of 80 px, which takes 33 px of height from the chat (115 px when a badge such as "No API key" is also shown). **Left:** Escape discards a draft without
  asking. (**Since D-029** the three buttons are under the message box and the header is one row again.)

**Threat note (what could go wrong, what stops it, what is left).**

- _Something sent that the person did not write or see._ Nothing is added but the one line above and the app's own rules; the text is the
  person's, shown in the box; the header says "on" while it is set. A chat file brought from somewhere else (put in the folder by another
  program) carries instructions that go out with that chat's next message; the "on" mark and the box show them, and the messages of such a
  file would be sent just the same. **Left:** nothing marks a chat as coming from outside.
- _The page replacing the app's rules._ There is no way to: the request has no system field, a script's `system` is dropped, and `instructions`
  is added after the rules. Tried from the page with raw calls (below).
- _A model's output setting them._ Nothing reads a reply for instructions; only Save in the dialog sets them.
- _Too much, or the wrong thing._ A text over the limit, or one that is not text, is refused by main with a sentence for the page, in a request
  and in a save, and nothing is sent or written. A damaged saved file is left alone.
- _Secrets._ The dialog says not to put them there. **Left:** the app cannot tell a password from a sentence, so this is a warning only; the
  text is saved as plain text with the chat, like the messages (D-016).
- _Money._ Up to about 2,000 more input tokens with every request, and the dialog says it is billed. **Left:** no limit before Stage 8, which
  has to count them.
- _Losing text._ Escape and Cancel discard a draft, and turning the instructions off deletes the text (it lived only in the chat's file, which
  is rewritten). Instructions set on a chat that has no message yet are not saved anywhere (a chat with no message has no file), so opening
  another chat from History before the first message replaces them. **Left:** no undo, and no warning in any of these cases.
- _A real model._ The mock proves what is sent, in which field, in which order, to which provider. How a real model weighs the instructions
  against the rules was not tried (no real API call has been made).

**What was checked, and what was not.** Against local mocks and scratch profiles only: no real API call has been made. **Under plain Node** (`verify-7-4.mjs`, 151 checks; the store ones in a normal folder and in the EFS-encrypted AppData): `checkInstructions` on text of every kind and on a dozen things that are not text (an object that prints as text, a symbol, a bigint, ...), and the limit exactly (8,000 pass, 8,001 do not, counted after trimming and in JavaScript's own characters); `checkChatRequest` (nothing added when there are none, a `system` field dropped, the instructions not counted towards the 600,000); the save check; the system prompt for both providers (exactly the Stage 7.3 text with none; the rules, then the one line, then the text, trimmed, also for instructions that try to cancel the rules or hold characters that a string replacement treats as special); what each adapter really sends to the strict mock (two request bodies that differ in the system field only); and the file (version 3 in the documented order and read back; versions 1 and 2 read with no instructions and left byte for byte, modification time included, by listing and loading them; the next save making them version 3; a damaged or version 4 file counted and left alone; a whole `.tmp` of version 3 winning and a cut-off one ignored). **In the real window** (`run74.mjs`, 84 checks; it seeds four conversation files before the launch): the seeded files open, or are left alone, and are never rewritten by reading; the button, the dialog (draft, Escape, Cancel, Enter, real typing, a real paste of 9,000 characters, the count, the limit, trimming, the focus going back); what is sent with each message and in what order, to an OpenAI model and back to Anthropic; what is saved; History bringing the instructions back, also after a reload; Regenerate and Edit using the instructions the chat has then; the button off while a reply arrives; raw calls from the page (a `system` field, 8,001 characters, something that is not text, a save that knows nothing of instructions); 420 and 320 px wide. **Requests:** the golden capture (42 requests, 21 outcomes, 33 errors times four, 6 merges: 163,796 bytes) is byte for byte what it was before the change; to show that this comparison can fail, three breakages of the prompt each changed it. **Negative controls** (`tools/specs74*`): 26 breakages under Node, all caught (three first ended with no summary line because a check threw; each section of the suite now turns a throw into a FAIL line, and those three were run again); 17 in the real window, all caught in the end. One was **not** caught the first time: the check that a long paste is not cut set the box's value from a script, which a `maxlength` never meets (it now pastes for real, and the control is caught). One ran out of time (the runner's limit) and was run again. One was caught only by a helper that wanted the form gone, not by the check meant for it (the helper was relaxed, and the intended check caught it). Four more stop the suite early (the chat is not saved; the dialog closes at the first keystroke), which counts as caught but does not reach the later checks. Every file was put back and proved identical by hash. **Older suites:** `node tools/regress.mjs t74 node window scenarios` (2 October 2026): 35 of 36 runs clean. The one that was not was 7.3's Copy, Regenerate and Edit suite (28 of 31): with the header two rows high at the default window size, an early message of a six-message chat scrolls out of view, and that suite's hover and click on it missed; it now scrolls the message into view first (53 of 53). Eight older checks that pinned the file at version 2, or version 3 as another build's, were moved up by one, and the Stage 4 header checks (the order and the count of the header's controls) learned of the new button. Nine negative-control specs that had gone stale were repaired (four by this slice, five before it), found by a new dry check, `tools/check-specs.mjs`. Two Stage 4 items were run once because they were edited: `run43a` (damaged folders, 32 of 32) and `verify-4-2` (88 of 90: the two that fail compare a reply's saved text with the text read from the page, which Markdown (7.2) changed; they are ported at 7.5).

**Not checked:** (1) a real model given instructions, and how it weighs them against the rules; (2) a screen reader, and the layout where there is no pointer (`hover: none`); (3) window sizes other than the default (900 px wide), 420 and 320; (4) the Stage 4 history suites (all but the two above), the seeded `preferences.json` launches and the built app, which run at the end of Stage 7; (5) the guard in `useChat.setInstructions`, which the disabled button makes unreachable from outside; (6) Windows only.

Status: accepted (Stage 7.4). Revisit: default instructions for every new chat (a setting); asking before Escape throws a long draft away; a header that does not wrap at the default window size; a mark on a chat that came from outside; counting the instructions against Stage 8's limit.

## D-028 - Stage 7 as a whole: what it added to the app's surface, the threat note across its four slices, and what it hands to Stage 8

Stage 7 (D-024 to D-027) made the chat nicer to use: an Effort menu, replies drawn as Markdown, Copy / Regenerate / Edit, and instructions of
your own for each chat. Every slice has its own threat note. This is the stage's: the surface the four slices added taken together, the risks
that only exist where they meet, what the full regression of 7.5 showed, and what is left for later stages. It changes no code.

**What the stage added, in one list.**

- **Across the bridge:** one new function, `settings.setEffort` (channel `settings:set-effort`), checked by main twice (D-024); and one optional
  field, `instructions`, on two calls that already existed (`chat:start`, `history:save`), checked by main (D-027). Nothing else in the preload
  changed and no other message exists.
- **On disk:** `preferences.json` gained `efforts` (it is still version 1). A saved chat is now **version 3** (it holds the instructions);
  versions 1 and 2 are still read and are not touched by reading. The step is one way: a build from before 7.4 cannot read a version 3 chat.
- **Two small new powers of the page, both approved in the plan:** it writes the clipboard on a click (one function, `useCopy`), and it can ask
  for an https address to be opened in the browser after a click and a confirmation. Main now lets through only https without a user name or
  password (before, plain http too), which is narrower, not wider.
- **Two new ways to ask the model again** (Regenerate, Edit), both from a click. They use the ordinary `chat:start`; there is no new message.
- **One new thing the person writes that goes out with every request:** the chat's instructions, at most 8,000 characters.
- **Not added:** no package (`package.json` and the lock file are unchanged), nothing in `registry/`, no access to files, commands, the network,
  a camera or a microphone. The window's own guards (sandbox, context isolation, the navigation lock, the window-open handler, the
  Content-Security-Policy) were not touched: `src/main/index.ts` and `index.html` are the same as at Stage 6, and the one change in
  `security.ts` is the https-only rule above.

**Threat note across the slices (what could go wrong where they meet, what stops it, what is left).**

- _A model's words drawn as Markdown (7.2), and the person's instructions that may tell the model to drop the app's rules (7.4)._ Together they
  allow a model that writes raw HTML or script. The reader has no way to turn text into HTML, so it appears as text (D-025: 22 attack texts and
  3,000 random ones read back against a list of elements and attributes, and the same attacks in the real window). At the end of this stage a
  search of `src` for `dangerouslySetInnerHTML`, `innerHTML`, `outerHTML`, `insertAdjacentHTML`, `document.write`, `eval`, `new Function` and
  `srcdoc` found nothing but one comment that says there is none. Nothing safety-relevant depends on the prompt: the limits are in the code.
- _Money, three ways at once (7.1, 7.3, 7.4)._ A higher Effort is billed as more output; Regenerate and Edit each send the whole chat again;
  the instructions add up to about 2,000 input tokens to every request. A person at "Max", with long instructions, in a long chat, who presses
  Regenerate again and again pays for all three each time. The tooltips and the dialog say that it is billed, and nothing repeats without a
  click (safety rule 4). **Left: no limit exists until Stage 8**, and that stage has to count, per request: the output including the thinking
  (which depends on the level), every request that Regenerate and Edit make, the instructions inside each request's input, and the whole
  conversation that goes out again each time. The only bounds until then are the ceiling of 16,000 tokens a reply (D-024) and the limit of
  600,000 characters of conversation in one request (the instructions come on top of that, up to 8,000).
- _What leaves the PC (rule 1)._ Nothing new leaves it unseen. A request holds the chat that is on the screen (D-013 says how it is tidied),
  the app's own rules, and the instructions as written in a box that shows all of them; changing the model sends the same chat to another
  company, which the Instructions dialog says. There is no telemetry, and nothing loads by itself: a reply cannot make an `img`, `a` with an
  address, `script`, `style` or a frame, and the Content-Security-Policy is unchanged.
- _The saved files (rule 9)._ The instructions are plain text next to the messages (D-016: chats are not encrypted). A chat file brought in from
  elsewhere carries instructions that go out with that chat's next message; the "on" mark shows them, and nothing marks a chat as coming from
  outside. Version 3 cannot be taken back.
- _Losing something._ Regenerate and Edit replace without an undo, turning the instructions off deletes the text, and Escape drops a draft.
  Each is in its slice's note and in IDEAS. **Left:** no versions and no question before Escape.
- _What the app's own page can still do._ Choose any effort level a model takes, call `window.open` with an https address without the dialog,
  and write the clipboard. That is what its own code does: the checks stand against a hostile reply, a hostile file and a hostile caller of the
  bridge, not against the app's own code. **Left:** Electron grants every permission request when no handler is set, and this app sets none; a
  deny-by-default handler is in IDEAS and is worth having before any stage that asks for a real permission (the microphone, Stage 15).
- _Rules 2 and 4 (untrusted content is data; no chaining)._ Nothing in this stage acts on what a model says. A reply is drawn and never read for
  instructions; there are no tools, no loops, and no request that a click or a key press of the person did not start.

**The roadmap's Stage 7 safety line, claim by claim.**

- _A renderer that cannot make HTML, and no raw HTML._ A closed list of elements and attributes built from a tree of fourteen known kinds
  (D-025); the Node attack suites; the window attack suites; the search of `src` above.
- _Links are text and open in the browser only after a click on an https address._ `[text](https://...)` only; a button, not an address; a
  dialog with the whole address and host; main passes only https without credentials (D-025; the window suite replaces `shell.openExternal`
  with a recorder, so the real browser was never opened by a check).
- _No image or resource loads by itself._ Nothing a reply makes has a `src` or an address; the policy is unchanged; no request for anything
  outside the app was seen while the attack texts were on screen (D-025).
- _Nothing can navigate or script the app window._ The navigation lock and the window-open handler were not touched; the 7.2 suite clicked
  links and called `window.open` from the page and the window did not navigate; calls from an `about:blank` page are refused (re-run by the
  older suites).
- _Higher effort is billed as output, the control says so, and Stage 8's limit must count it._ The tooltip says it (D-024); what the limit has
  to count is in the money paragraph above.

**What the full regression of 7.5 showed (2 October 2026).** `node tools/regress.mjs t75`, all six parts, 54 minutes, on the tree of the 7.4
commit with only the test tools changed (`src/` and `registry/` are identical to the commit, checked afterwards with `git diff`): 78 runs, 75
clean the first time and the other three clean when run again on their own. Clean the first time: the 12 plain-Node suites; 11 of the 14 window
launches (Stages 1, 3, 5, 6 and 7.1 to 7.4, with their restarts); the 16 seeded `preferences.json` launches; the 10 registry scenarios (each put
`registry/models.json` back, proved by hash); all 7 Stage 4 history launches against the dev app (damaged folders, closing the window in the
middle of a reply, 30 saves queued at quit, injected disk faults) and again all 7 against the built app; and the 11 window suites against the
built app (`electron-vite build`, then the same suites on the compiled bundle). The three that failed were `verify-2-3`, its restart
`verify-2-3b` and `verify-2-4`: in `verify-2-3` and `verify-2-4` the test window reported itself hidden (`visibilityState: "hidden"`) and the
debug protocol's mouse input was acknowledged only after 5 s, so a click on Settings did not open its dialog in time; the restart failed only
because the first never saved its key. They passed on their own re-run (64, 5 and 71 checks). This is the stall described in `tools/README.md`,
a fault of the test window and not of the app, but **its cause is still not proven**: a read-only watcher of the operating system's windows
(started after the incident; it is `tools/watch-windows.ps1`) saw 30 moments of input and three times the test window behind the Claude window,
and no stall in any of them.
**Stage 4 had gone stale, and was ported.** Its suites had not been run since Stage 7 began. Three checks failed at the 7.4 commit for the
same reason, Markdown (7.2): they compared a reply as read from the page with the text saved in the file, and a reply's paragraphs are
elements now and its trailing space is not drawn (two in `verify-4-2`, one in `verify-4-3d`; shown by running the old files again, which gave
`verify-4-2` 88 of 90 and `verify-4-3d` 7 of 8). `tools/lib4.mjs` now reads a reply as a person sees it, and the saved side goes through one
small function (`shown`); the same suites pass with it (`verify-4-2` 90 of 90, `verify-4-3d` 8 of 8, against the dev app and the built one). A
fourth comparison (`verify-4-2b`, 17 of 17) was changed as a precaution and had passed before too. The app was not at fault in any of the three.

**Not checked, for the stage as a whole.** (1) **A real call to either provider**: none has been made by me in any stage. How a real API
answers at each effort level, how a real model draws on the Markdown rules and weighs the instructions against them, what real replies look
like to the reader, and what a regenerated reply costs are all unknown; the mock is my reading of the documentation. The first real use is yours
(Settings, then a message). (2) The OS-drawn list of a `<select>` (it cannot be seen or clicked through the debug protocol: levels were chosen
by keyboard and by calling what the menu calls). (3) A screen reader, and the layout where there is no pointer (`hover: none`). (4) Window
sizes other than the default 900 px, 420 and 320. (5) Any system other than Windows. (6) The reader against CommonMark's own test suite. (7)
Typing a message of 21 KB stalls the page for about 2.5 s (the box, not investigated). (8) Two guards that the disabled buttons make unreachable
from outside (`useChat.setInstructions` and the second-request refusal in `useChat`). (9) Two copies of the app at once overwriting each
other's `preferences.json`. (10) The packaged installer: the built-app runs use `electron-vite preview` on the compiled bundle, not a
program made by `electron-builder` (Stage 18); `app.isPackaged` is false in them, which is also why the mock's address is honoured there.

Status: accepted (Stage 7 closed). Revisit: Stage 8's counting of everything in the money paragraph; the first real replies (what the reader
gets wrong, what each effort level really costs); versions of a replaced reply; a deny-by-default permission handler; a header that does not
wrap at the default window width (decided afterwards and done in 7.6, D-029).

## D-029 - New chat, History and Instructions move from the header to a slim row under the message box, so that the header is one row at the default window width

D-027 reported, and D-028 left open for the owner, that the Instructions button made the header wider than the default window (900 px, 886 of
page): its controls wrapped under the title, 47 px became 80 px (115 px with a "No API key" badge), and the chat lost 33 to 68 px of height. The
owner decided (2 October 2026): move New chat, History and Instructions out of the header, so that it never wraps to two rows at the default
width. This is slice 7.6, made after 7.5 at the owner's request.

- **Where they went.** A new component, `ChatBar` (`src/renderer/src/chat/ChatBar.tsx`), draws the three buttons in a slim row directly under the
  message box: as wide as the box (at most 760 px, centred, so that the first button lines up with the box's left edge), a group named "This
  chat", the last thing on the page. What was weighed: a row above the box (it reads as a second header row and sits between the messages and the
  box), buttons inside the message box (that changes the box's layout and the place of Send, which Stage 1's checks pin down), and a sidebar (a
  much larger change). Under the box costs the least height.
- **Nothing about the buttons changed.** The same labels, tooltips and rules: all three wait for a reply that is arriving; New chat is off in an
  empty chat and warns when the chat could not be saved; Instructions says "on" and how long they are. The same dialogs, which still return the
  keyboard to the button that opened them. The state stays in `App` (the dialogs, the chat, the history). Only the class names changed
  (`chat-bar`, `chat-button`, `chat-instructions`, `chat-mark`), because the header no longer holds them. The header keeps the Task, model and
  Effort menus, the badges ("Not saved", "No API key") and Settings.
- **The header is one row by construction, not by luck.** After the move the widest state a person can reach (a task chosen, which makes the model
  menu say "(suggested)" and widen to 200 px, with both badges showing) still needs about 870 px against the 846 the header has, so taking the
  three buttons out alone would have left a rare wrap. From 720 px of page up the header therefore does not wrap, and the three menus give way
  instead: their text is cut with an ellipsis, and none goes below 96 px. The title, the badges and Settings never shrink. Below 720 px the
  controls drop under the title as before. Measured in the real window at 886 px: 47 px in every state, for each of the seven models (the OpenAI
  ones with "No API key" showing, Haiku with no Effort menu), each of the five task choices, and the widest state, which also holds at 800 and
  720 px.
- **What the chat area gets.** At the default window: 47 px of header, 480 px of messages, 71 px of message box and 36 px of bar. Against 7.4
  that is 12 px more height with a key saved (468 before) and 46 px more with a badge showing (434); against 7.3, before there was a bar, it is
  22 px less (502).
- **The keyboard order changed.** Tab used to reach New chat, History and Instructions first. Now the header's menus and Settings come first, then
  the messages, the box and Send, and last the three buttons: the page's order is the order on the screen, and the group is named for a screen
  reader. Shift+Tab goes back the same way.
- **Narrow windows.** The bar wraps instead of overflowing (checked at 420, 320 and 280 px, with the "on" mark, which makes Instructions wider).

**Threat note.** No new power, and nothing in the main process, the preload or `src/shared` changed (the change is in `src/renderer` only), so the
page can do exactly what it could before. What could go wrong: (1) a button out of reach in a narrow window: the bar wraps; (2) the header
wrapping again with a long label (a long model name in the registry): the menus give way, down to 96 px, with an ellipsis; (3) New chat clicked by
mistake, now that it is nearer the box: it only starts a new chat, which stays saved in History, and it is off in an empty chat and while a reply
arrives; the one loss is a chat that could not be saved (the "Not saved" badge and the button's own sentence say so, as before). **Left:** nothing
asks before New chat discards a chat that could not be saved (D-017 chose the sentence).

**What was checked, and what was not.** Against local mocks and scratch profiles only. A new window suite, `verify-7-6w.mjs` (46 checks): where
the buttons are and that the header holds only Settings; one row for each model, each task, and the widest state at 886, 800 and 720 px, and the
page just under 720 px; the bar's place, its alignment with the box and its size; the rules the buttons keep (an empty chat, a reply that is
arriving, Stop, History and Instructions opening and giving the keyboard back, Save and the "on" mark); the order of the keyboard; 420, 320 and
280 px. `verify-4-5` has one more check, with the real "Not saved" badge showing (20 checks).
**Negative controls** (`tools/specs76w`): 12 breakages of the bar and the header (the header allowed to wrap; menus that cannot give way, or give
way with no floor; a bar not lined up with the box; one that cannot wrap; one drawn above everything; one far too tall; History on while a reply
arrives; New chat on in an empty chat; a bar that is not a named group; the buttons also in the header; the bar first in the page's order but
drawn last). 11 were caught the first time. The twelfth was not: with `flex-wrap: nowrap` the buttons simply broke their labels over two lines and
nothing overflowed, which my narrow-window check could not see. The check now also requires every label on one line, and that breakage is caught.
After the batch `src/` and `registry/` were proved identical to before by hash (64 files). The suites that used the three buttons in the header
were ported (Stage 1's layout checks; Stage 4's helpers, `verify-4-2`, 4-2b, 4-3a, 4-3d, 4-4, 4-5 and 5-4; the window suites of 7.2, 7.3 and 7.4),
and the two control specs that named the Instructions button's code were pointed at its new file.
**The full regression** (`node tools/regress.mjs t76`, 80 runs, 2 October 2026): 79 clean the first time. The one that was not was the built-app
launch of `verify-5-3` (keys and Settings): it waited 30 s for the 20 s timeout of a Test-key call that never answers, and the notice did not
come. The watcher logged keyboard or mouse input at that moment (a key press or a click can close the dialog the suite is waiting on), the
window was in front, and the same launch passed on its own re-run (66 of 66, no input logged); the suite had passed in the dev app in the same
regression. The cause is **not proven**. The new suite passed in the dev app and in the built one, and so did every Stage 4 suite (`verify-4-2`
has 91 checks now, the injected-disk-fault suite 20). The hidden-window stall of 7.5 (`verify-2-3`, `verify-2-4`) did not happen this time. The
harness's retry message in `tools/lib3.mjs` now also lists the open dialogs, the messages on screen and the selected model: the new suite's first
message once needed its one retry in 7 launches, unexplained, and the next occurrence should say more.

**Not checked:** (1) page zoom: at about 125 % or more the 900 px window has fewer than 720 CSS px, so the header drops its controls under the
title, as in any narrow window; (2) a very long label in the registry (only the seven real labels were used); (3) a touch screen and a screen
reader; (4) systems other than Windows; (5) the real "Not saved" badge was checked at the default width only (the other widths used a copy of it
made on the page).

Status: accepted (Stage 7.6). Revisit: page zoom; asking before New chat discards a chat that could not be saved; a sidebar for these buttons and
History in wide windows.

## D-030 - Stage 8.1: every request is counted in a plain ledger the main process writes, priced at four list prices, and shown per reply, per chat, today and this month

Stage 8 is the money stage (safety rule 6: usage and cost are shown, and a limit stops requests; nothing that can loop is built before it). The
owner approved its plan on 2 October 2026 with three decisions: (1) **the limits are the owner's own, with no preset numbers** (I had proposed $5 a
day and $50 a month, and was told to leave the numbers to the owner: on first run the app asks for a daily and a monthly limit before the first send,
and Settings has a deliberate "No limit" with a one-line warning; that is 8.2); (2) **encrypted history is its own later stage, 8b**, with a tested
backup and export before any encryption (ROADMAP); (3) **a guess marked "about" is counted** when a reply is stopped or fails with no usage report,
and it is replaced if a real report arrives. This is slice 8.1, the counting. It adds no limit, and it counts what D-028 listed: the output
including the thinking (at whatever Effort), every request that Regenerate and Edit make, the instructions inside each request, and the whole
conversation that goes out again each time (they are all in the request, so they are all in the provider's report).

- **The ledger.** One plain file, `usage/ledger.jsonl` in the app's data folder, written by the main process alone (`src/main/usageLedger.ts`).
  One line of JSON per request, written twice under one id: when the request is about to be sent (state "sent", its input as a guess, marked
  an estimate) and when it ends (state "done", "stopped", "failed" or "rejected", with the provider's report or a guess). When the file is read,
  the later line replaces the earlier one with the same id. Why twice: a request that never ends (the app is killed while a reply is arriving) is
  still on the books for what it had cost by then, and 8.2 needs the requests that are in flight. Why appended and never rewritten: a crash can
  only cut off the last line, which is skipped when the file is read and counted (and the next write starts on a new line, so it cannot join the
  cut one); no rename is used (D-010: renames fail with EXDEV in this project's own %APPDATA%). A line has the model, the effort, the chat, the time
  the request began, the four token counts, the **four prices it was counted at** (the registry may change later; an old record keeps its prices) and,
  beside them for a person who reads the file, the cost, which is not read back: the cost is always worked out again from the numbers. The file
  holds no message text and no key. It is read whole at the first request or the first question, up to 64 MiB (the newest part, with a note in
  the log, beyond that: about 100,000 requests).
- **`begin` is awaited before the request goes out, and a request that cannot be written down is not sent.** The reply says "Nothing was sent: what
  this request would use could not be recorded on this computer." This is the one place where the ledger fails closed, because it is what makes a
  limit mean something. The end of a request (`finish`) never throws: the reply has happened, so a failed write is logged, the sums in memory are
  right for as long as the app runs, and the file keeps the "sent" line (a guess of the input), which is what a later run counts.
- **Four buckets, four prices (registry schema 0.4).** A reply's tokens are billed in four buckets that never overlap (D-018): ordinary input, input
  read back from the provider's cache, input written to it, and output (which includes the thinking). D-019 left the cache prices out of the registry
  because I could not confirm them; I read both providers' pricing pages on 2 October 2026 (Anthropic's `about-claude/pricing` page, and OpenAI's
  pricing table), which also show that the input and output prices already in the file are right. Each model in `registry/models.json` now has
  `cacheReadPerMTok` and `cacheWritePerMTok` beside `inputPerMTok` and `outputPerMTok`, all required (the file is hand-edited and checked as strictly as
  input from the page): Fable 5.1 10 / 0.25 / 12.50 / 50; Opus 5.5 4 / 0.20 / 5 / 20; Sonnet 5.5 2 / 0.20 / 2.50 / 10; Haiku 4.5 1 / 0.10 / 1.25 / 5;
  GPT-6 Astra 10 / 1 / 12.50 / 50; GPT-6.1 Sol 2 / 0.10 / 2.50 / 10; GPT-6 Luna 0.10 / 0.01 / 0.125 / 0.50 (in / cache read / cache write / out, dollars
  per million tokens). Two things the pages say that a rule of thumb would get wrong: a cache hit costs 0.1 of the input price for most Claude models,
  but 0.05 for Opus 5.5 and 0.025 for Fable 5.1; and the Claude cache write that the app's own request asks for (`cache_control` "ephemeral", the
  5-minute cache) is 1.25 times the input price (the 1-hour write, 2 times, is not asked for). A cache read dearer than ordinary input is refused as a
  typo. `updatedAt` stays "2026-10-01" (the other facts were not re-read); the `source` line says the prices were read on 2026-10-02.
- **When a provider gives no report, a guess marked "about" is counted (the owner's decision 3).** The rule: input = the system prompt and every
  message that was sent, in UTF-8 bytes divided by 3, rounded up, plus 4 for each message; output = the bytes of the text that arrived, divided by 3.
  Three bytes to a token is on the high side for English (about four characters) and about right for Chinese, Japanese and Korean (about one token a
  character); it knows no tokenizer. It **leaves out thinking that was never shown**, which cannot be seen, so a stopped reply from a model that thinks
  can have cost more than its guess; the line under a reply and Settings say that. When it applies: a reply the person stopped, a request that failed
  after the provider may have worked on it (a connection dropped in the middle, a timeout, a server error, an error that is none of the known kinds,
  and any failure after some text had arrived), and a reply that ended normally but whose usage report was empty (all four numbers zero is read as "no
  report"). A real report replaces a guess for the same request: the ledger takes the later line. In the running app that can happen when Stop is
  pressed after the report has already arrived (the report is counted, as "stopped", not as a guess); a report that comes after the app has
  stopped listening cannot, because there is nobody left to read it. **Nothing owed** ("rejected", zero tokens, not counted): the provider turned the
  request away before doing any work, which is what these failures mean: the key, the permission, a model it does not have, the rate, the credit, a
  request it could not take, a connection that never reached it, or a provider too busy to start, when no text had arrived.
- **What the page sees.** One new event, `usage` (`{ tokens, costUsd, estimate }`), sent just before a reply's last event and only when something is owed;
  one small line under a finished reply, "865 in, 300 out, $0.0065" (the whole input side added up; "about $..." for a guess; the four buckets, "the
  thinking counts as writing" and "your provider's invoice decides" when hovered); and **Settings > Usage**, three rows (this chat, today, this month)
  with their requests, tokens and cost, asked of main each time Settings opens. One new bridge function, `usage.summary(conversationId | null)`, and one
  new optional field on the chat request, `conversationId`, which the page sets to the id the chat is saved under and which only decides which chat a
  cost is shown under. The line under a reply is kept on the screen only: it is not saved with the message (the ledger is the record), so a chat opened
  from History shows no line under its replies, and its sum in Settings is read from the ledger and is still there. Saving it would make the chat file
  version 4, one more step a build cannot take back (IDEAS). A replaced reply (Regenerate, Edit) stays counted: it was billed.
- **Where the sums are shown.** In Settings, not in the header (7.6 made it one row) or the chat bar (which has rules of its own). Today and this month
  follow this computer's clock (midnight, the first of the month); a changed time zone or clock moves the edges.

**Choices I made where things were unclear.** One file, not one per month (the sums are worked out from the records in memory, and a file per month
would need records to cross files when a request ends in another month). Prices are stored in the record, not looked up later. The guess uses bytes,
not characters, because that is what a token follows more closely. The failures that count were chosen by what a provider is likely to bill: the
safe error is to count something that was not billed. "Rejected" records are written (not skipped) so the file shows every request. The ledger fails
closed on `begin` and open on `finish`. A model name that is not in the registry any more still counts (the record carries its prices). The page's
`conversationId` is refused when it is not an id, not quietly dropped (a page that sends one is ours and is wrong, or is not ours).

**Threat note.** What could go wrong, what stops it, what is left.

- _A hostile or broken page._ It has no function that writes the ledger; it cannot name a record's id, price, token count or state (main makes all of
  them; fields a page adds to a request are not read, and a window check sends some); it can say which chat a cost is shown under, which changes only
  the "This chat" row and not today's or the month's sums, and which is refused unless it is an id; `usage.summary` answers with sums, the count of
  unreadable lines and a time, and no path, record or id. The summary of anything that is not a chat id is the summary with no chat.
- _Spending that is not counted._ (1) Thinking that was never shown, in a guess (above). (2) A request the provider billed although it turned it away
  (we assume it did not). (3) A request that was begun and whose line could not be written is refused, not counted. (4) A damaged line in the file is skipped
  and its cost is missing from the sums; Settings says how many lines could not be read. (5) The ledger edited or deleted by the person: it is their file and
  plain on purpose (safety rule 9); the limit of 8.2 stops the app, not a person who changes the file. (6) Two copies of the app at once: each reads the
  file once, so each misses the other's lines until it is restarted; a line is written whole and the check after a write allows the file to have grown.
  (7) Costs that are not tokens and not list prices: Fast mode, the Batch API, data residency (1.1 times), web search, an invoice's discounts or tax.
  The app uses none of these now; the figure is **list prices, and the provider's invoice is what counts** (the Settings text says so).
- _Prices that are wrong._ They are hand-edited facts with a date (Settings shows when they were checked); a price that has changed since is a wrong
  cost. The registry file is checked at startup, a cache read dearer than input is refused, and `verify-8-1.mjs` compares each of the seven models'
  four prices with what the pages said.
- _The clock._ A clock set back or forward, or a changed time zone, moves "today" and "this month". A record dated in the future counts in both.
- _Growth._ The file grows by two lines (about 600 bytes) a request for ever; nothing compacts it (IDEAS).
- _Rule 1 (nothing leaves the PC unseen)._ Nothing new leaves it: the ledger is local, and nothing in a request changed (the golden requests are the
  same bytes).

**What was checked, and what was not.** Against local mocks and scratch profiles only. A plain-Node suite, `verify-8-1.mjs` (194 checks, every file
check in a normal folder and in the EFS-encrypted %APPDATA%): the cost of each bucket alone and together; the guess; the strict reader (a table of 40
refused lines); the sums, with the edges of a day and a month (the last millisecond of yesterday, the first instant of the month, the turn of the year);
the file (a second line replacing the first, a guess replaced by a real report, also after a restart, a cut-off last line, damaged and odd lines, 25
requests at once, a request that cannot be written, a disk that refuses the end, the size cap); the registry's four prices for all seven models
against the pages; and the request's new field. A window suite, `verify-8-1w.mjs` (81 checks, `run81.mjs`), against the fake Anthropic API, which now
reports cache tokens ("cached") and nothing at all ("no-usage") on request: the file, the line under a reply, the sums in Settings against a second
count made from the file, a guess after Stop, every kind of failure (eleven), Regenerate and Edit, chats kept apart and a chat's sum back after History, what
a page cannot do, and a request refused when the ledger is read-only. A restart suite, `verify-8-1b.mjs`, on the same profile after a crash has been
imitated in the file (a request that never ended, a cut-off line). **Negative controls** (`tools/specs81`, `specs81w`): 21 breakages under Node and 15 in the real window, **all caught**, each file proved restored by hash (and one hash over `src/` and `registry/` identical before and after the window batch). They cover: each bucket priced at the wrong price, a wrong guess rule, a reader that accepts a negative count or an unknown state, sums that count a refused request, start "today" a day early or leave out the first instant of the month, a file where the first line of an id wins or a cut-off line is joined by the next write or the size cap is off or `begin` swallows a failure, a registry that accepts a cache read dearer than input or does not require a price or has a wrong price, a chat id that is not checked (in the request, and in the summary), the refused and the failed counted the wrong way round, the report ignored, a guess not marked, a stopped reply not settled, no usage event, a request sent although it could not be recorded, the chat id dropped by main or not sent by the page or not told to the chat, the summary taking the page's id, "about" not said, and a line that carries an extra field or text that was sent. Three were caught by one check each (the unwritable ledger, the stopped reply, the summary of a non-id) and the rest by two or more (up to 18).
**Not checked:** (1) **a real call to either provider**: no real usage report has been read by this app, so what a real Anthropic or OpenAI stream
reports (the cache numbers, whether the thinking is in `output_tokens`, what a stopped reply is billed) is my reading of the documentation; the cost
for a real reply is for you to compare with the provider's own usage page. (2) The OpenAI path through the window (its usage conversion is checked
under Node, D-022, and the cost is the same function). (3) That `Page.bringToFront`, which the test client now calls when the test window reports
"hidden", fixes the stall: it did not need to fire in the runs of this slice. (4) Daylight-saving changes and other time zones. (5) Two copies of the
app. (6) A ledger near the 64 MiB cap in the real app (only with a small cap under Node). (7) A screen reader and the layout at 280 px for the new
section. (8) The built app: `npm run build` passes, but the suites were not run against the built app (the `preview` part of the regression waits for your go-ahead), and neither was the full regression: what was run is the plain-Node part (all 13 suites), the new suites on the dev app, and the controls above.

Status: accepted (Stage 8.1). Revisit: the first real replies (do the numbers match the provider's usage page?); 8.2's limits, which will read
`summary` and the in-flight records, and must say in Settings that deleting the file resets the count; thinking that is not shown, in a guess; a ledger
that is compacted; the per-reply line on a chat from History (a file version 4).

## D-031 - Stage 8.2: spending limits, chosen by the owner, checked in the main process before every request

Safety rule 6 (money has a hard stop) is what this slice makes true: 8.1 counted, 8.2 stops. It carries out the owner's decision of 2 October 2026 that
**there are no preset numbers**: the app asks for a daily and a monthly limit before the first send, with nothing filled in, and Settings has a
deliberate "No limit" with a one-line warning. Nothing that can loop or spend more (Stages 11 to 13) is built before this exists.

- **What a limit is.** Two of them, a daily and a monthly one, each in US dollars in whole cents ($0.01 to $10,000), or **"No limit" chosen on purpose**.
  "Not chosen yet" is a third state, kept apart from "No limit" everywhere (the file, the status the page gets, the check). Today runs midnight to midnight
  and the month from the 1st, by this computer's clock (as the Usage sums do, D-030). They are kept in `limits.json` in the data folder, beside
  `preferences.json`, as a line a person can read: `{"version":1,"daily":5,"monthly":"none"}` (a limit not chosen is left out). Written in place and read back (D-010:
  no rename on this PC's EFS-encrypted %APPDATA%), read once and kept; a change made to the file while the app runs is heard at the next start.
- **Until both are chosen, nothing is sent.** The page asks in a dialog before the first message ("Set your spending limits": two empty boxes with a "No
  limit" tick each, what is billed and by whom, and that they can be changed in Settings). It can be put off ("Not now" or Escape); then the empty chat says "Set
  your spending limits to start chatting" with a "Set limits" button, and **main refuses every request** with a sentence ("Nothing was sent: no spending limits are
  set yet. Open Settings, set a daily and a monthly limit (or choose No limit), and try again."). The page cannot get round it: a request made straight through its
  bridge is refused the same way (checked). A `limits.json` that is **missing, damaged or cut off holds no choice**, never a default and never "No limit": each field
  is read on its own (a bad daily keeps a good monthly), a bad one is "not chosen", the app asks again, and what was chosen is filled in. A file that cannot be
  read at all (a folder in its place, a disk error) refuses requests with "the spending limits could not be read on this computer", and Settings shows "not chosen" so
  that the person can choose; saving then says it could not write (checked with a folder in the file's place).
- **The check.** In `src/main/chat.ts`, for every request, **in the ledger's own turn** (`begin` is given the check; it runs after the ledger is read and before the
  request's line is written, so what has been spent and the line that adds this request to it cannot be parted by another request: ten requests asked for at
  once with money for three let exactly three through, checked). It takes today's and this month's spending as the ledger counts them (requests still on their way
  included, at their input guess; a refused request owes nothing; the provider's own report replaces a guess), adds **this request's input at list price**
  (the least it can cost), and refuses if that is **more than** a limit: an amount that lands exactly on the limit may go, a cent more may not, and a limit that is
  already reached refuses anything. A refusal writes nothing to the ledger (nothing was sent) and reaches the page as the reply's error, in one plain sentence that
  names the limit: "Nothing was sent: you have reached your daily limit of $5.00 ($6.00 so far today). You can raise the limit in Settings (today's count starts
  again at midnight)." ("this would take this month's spending past your monthly limit of $50.00 ($49.50 so far)" when it has not been reached yet; both limits in
  one sentence when both stop it).
- **Every way to ask is covered, because there is one place a provider is called.** A new message, Regenerate ("Try again" after a failure), an edited message sent
  again, and a call made through the bridge all reach `runReply` in `chat.ts`, which is the only caller of a provider's `stream` (a source check in `verify-8-2.mjs` says
  so, and that the check comes before the call). "Test key" asks for the list of models, which costs nothing, and is not a request in this sense.
- **The one way past a limit, and how far.** The length of a reply is not known before it ends, so **a request that starts under a limit can end over it**: by at most what
  one reply can write (the ceiling is 16,000 tokens a reply, thinking included: $0.80 at the dearest output price in the registry, $50 a million; $0.32 at Opus 5.5's
  $20; $0.08 at Haiku 4.5's $5), plus whatever the real input was above the app's guess of it (the guess is on the high side for English), plus the same again for each request
  that is in flight at the same moment (the page lets one reply run at a time; a script calling the bridge could start several, and each would pass on the same money). The
  limit is on **the app's own count at list prices, not on the invoice** (D-030), so a provider's own limit in its account remains the real backstop, which the "No limit" line
  says. Settings says the first part ("can end a little over it, by at most that one reply"). 8.3 (the confirmation before a very large request) will show the
  worst case before it is sent.
- **What the page can do.** One new bridge function, `settings.setLimits({ daily, monthly })`, and one new field in the settings status, `limits`. Main checks what it is given
  (both sides, each "none" or an amount in whole cents between $0.01 and $10,000; an amount as text, a fraction of a cent, zero, a negative number, NaN or a missing side is
  refused) and **builds its own copy field by field**, so nothing else the page adds is kept. The page **cannot take a choice back to "not chosen"**, cannot read the file
  or its path, and has no function that touches the ledger. In Settings: a "Spending limits" section (two boxes, "No limit", the warning when either is ticked, a hint when
  the daily limit is above the monthly one, what the limit counts, the one-reply overshoot, and that **deleting the usage file starts the count again from zero**), and the
  Usage rows say how much of each limit has gone ("$6.00 of $5.00").

**Choices I made where things were unclear.** (1) The check adds only the request's own input, not the most the reply could cost: adding the ceiling would refuse
requests while there is still room (a $50 limit would stop at $49.20 on the dearest model) and is what 8.3 shows the owner to decide on. (2) A reply is not stopped in the middle
when its running cost passes a limit (IDEAS): the running figure of an unfinished reply is a guess, and a half reply is also billed. (3) The limits are in their own file, not in
`preferences.json`: the two files are read and written in different directions of safety (a torn preferences file forgets a model, a torn limits file must forget nothing that
lets money through). (4) The dialog can be put off, because a person who opens the app to read an old chat should not be forced to choose first; main is what refuses. (5) Whole cents
and a ceiling of $10,000: a fraction of a cent cannot be typed, and "No limit" says what a larger number would mean. (6) A limit of zero is refused (it would be "pause the app", and
"Not now" does that). (7) Today and this month follow the computer's clock, as the sums do. (8) The first-run dialog and the Settings section share one form
(`LimitsForm`); the Settings section is rebuilt each time Settings opens, so its boxes show what is saved now (a first version showed empty boxes after the limits had been
chosen in the dialog: found by the window suite, fixed, and the check stays).

**Threat note.** What could go wrong, what stops it, what is left.

- _A hostile or broken page._ It can only choose limits, in whole cents within bounds, and cannot unset them; every field is rebuilt by main; a refused choice leaves the file byte for
  byte as it was (checked for nine kinds of bad choice); it cannot read `limits.json`, learn its path, or write the ledger; the check is in main, in the one place a provider is called,
  and runs whatever the page says. A page that raised its own limit would be doing what the person's own Settings does; nothing in a reply (a model's output is text, never a call) can reach it.
- _The person's own files._ `limits.json` and the ledger are plain files the owner can edit or delete (safety rule 9). Raising a limit in the file is the owner raising it; deleting the
  ledger resets the count (Settings says so); damaging `limits.json` makes the app ask again, never lets money through. The limits stop the app, not a person who changes its files.
- _Spending that is not stopped._ (1) The reply that passes the limit it started under (above). (2) Anything D-030 lists as not counted: thinking that was never shown in a guess,
  a request the provider billed although it refused it, an unreadable ledger line (Settings says how many; the limit does not fail closed on them, because a cut-off last line is
  what a crash leaves), two copies of the app each reading the file once, costs that are not tokens at list prices. (3) The clock: a clock set back, or a changed time zone, moves
  "today" and "this month" and so can give back room that was used; it is the person's own computer. (4) Requests on their way when the app is killed count for their input only
  (D-030). (5) A model whose price changed since the registry was checked (D-030): the limit counts at the price in the registry.
- _A limit that is not there._ Not chosen is never "No limit": a missing, empty, cut-off, not-JSON or wrong-version file, a field that is not an amount this app could have
  written, and a file that cannot be read all refuse requests; "No limit" is only what a person ticked (the file reads it only as `"none"`, in lower case).
- _A refusal that costs something._ Nothing: a refused request is not sent and not written, and the limit is read from memory, so refusing does not touch the disk.
- _Rule 1 (nothing leaves the PC unseen)._ Nothing new leaves it: the limits are local, and nothing in a request changed.

**What was checked, and what was not.** Against local mocks and scratch profiles only. A plain-Node suite, `verify-8-2.mjs` (215 checks, every file check in a normal folder and in the
EFS-encrypted %APPDATA%): what an amount is and the 40 or so texts a person might type (a table of accepted and refused ones); what the page may hand over (a table of 25 bad choices, extra
fields dropped); what `limits.json` holds and how each kind of damage is read (every one as "not chosen", a good field kept beside a bad one); the check itself (exactly at the limit may go,
a cent more may not, a limit already reached, the daily alone, the monthly alone, both, "No limit", the sentences); the ledger running the check in its own turn (a refusal writes nothing, not even
the folder; what the check is given, including requests on their way and a finished request's real report; yesterday's spending is in the month and not in the day, to the millisecond; **ten
requests at once with money for three let exactly three through**; the limit still holds after a restart); the store (missing, damaged, empty, cut off, with a byte-order mark, unreadable, a save that
fails, twenty saves at once, a read between two saves, an edit made while the app runs not heard); and two source checks (a provider is called from one place in main, and the check comes before
the call). A window suite, `verify-8-2w.mjs` (62 checks, `run82.mjs`), on a profile that has never chosen limits, against the fake Anthropic API (which now has `[[mock:heavy]]`, a million
tokens in and a hundred thousand out, $6 at Opus's prices): the first-run dialog (empty boxes, what is typed, "No limit", the warning, "Not now", Save), every way of asking refused while nothing is chosen
(the message box, "Try again", the bridge), a request under the limits going, **a daily limit that is reached refusing a new message, "Try again", an edited message and a call through the bridge, each
with the same sentence, nothing reaching the mock and nothing written to the ledger**, raising the limit in Settings and the retry going through, the monthly limit alone (with the day set to "No limit"),
"No limit" for both, the limit passed by one reply that started under it (as the text says), nine kinds of bad choice from the page leaving the file byte for byte as it was, and extra fields dropped;
a restart (`verify-8-2b.mjs`, 8 checks: the limits and the spending survive, the question does not come back, the daily limit is still reached with $12.00 counted from the file, and raising it lets
the next request through); and three launches with a `limits.json` that is half there, not JSON, or a folder (`verify-8-2c.mjs`, 21 checks: asked again with what is known filled in, refused through
the bridge, choosing repairs it, and with a folder in the file's place the request is refused with "could not be read" and Save says it could not write). **Negative controls: 32 breakages, all
caught** (`tools/specs82`: 23 under Node; `tools/specs82w`: 9 in the real window), each file proved restored by hash. They cover: a limit that refuses at its own amount, a limit ignored (each of the two),
the request's input not added, "not chosen" allowed or counted as chosen when only one is, an amount of zero or above the most accepted, three decimals accepted, extra fields or "unset" accepted from the
page, a bad field or a file that is not JSON or a missing file read as "No limit", an unreadable file read as "not chosen", a byte-order mark, a cache that is not updated, the ledger skipping or ignoring
its check or running it on yesterday's clock or with a request that costs nothing, the check not passed in `chat.ts`, a refusal treated as a write failure, the limits not read, a save of the page's choice
without the check, a status that hides "not chosen", the dialog never opening, the amount used not shown, the "No limit" warning missing, and Save on while a limit is missing. Five of the nine window
controls ended without a summary line because the suite waited for something that the breakage had made impossible (a dialog that never opened, a request that went through); each printed the failed
checks that name the breakage first, so they are detections, but they are not counted as a clean pass-fail run. **What the suites found:** one real fault of mine, a Settings form that showed empty boxes
after the limits had been chosen in the first-run dialog (the form was built before they existed); fixed, and the check stays. Everything else the first window run reported was my test (a click on a button
below the fold of a dialog taller than the window; a limit of 7 that the profile's $12 of spending rightly refused). **Older suites made stale** by 8.1 or this slice and updated: the exact lists of the bridge
and of the settings status in `verify-2-3`, `verify-3-4`, `verify-4-2`, `verify-4-3d` and `verify-5-3` (`usage` since 8.1, `setLimits` and `limits` now), the button count in `verify-5-3`'s check at 420 and 320
px (which now also proves that "Save limits" stays inside the dialog), and one negative-control spec of 7.6 (`App.tsx` gained props). Re-run on this tree and clean: `verify-2-3` (64), `verify-2-3b` (5),
`verify-3-4` (78), `verify-5-3` (66), `verify-7-6w` (46), `verify-8-1w` and `verify-8-1b` (81 and 12), and the plain-Node part of the regression (14 suites).
**Not checked:** (1) **a real call to either provider**: nothing was sent to a real API, so a real usage report has still never been read by this app. (2) **The full regression** (about 54 minutes) and **the
built app**: only the suites named above were run on this tree; the other window suites, the seeds, the scenarios, Stage 4 and the `preview` part wait for your go-ahead. (3) Daylight-saving changes, other time
zones and a clock set back (the edges of a day and a month are checked under Node with the local clock). (4) Two copies of the app at once (each reads the ledger once). (5) A screen reader, and the limits
form at 280 px (the older check at 320 and 420 px covers the Save button only). (6) A ledger near its size cap together with a limit. (7) A real reply that ends over a limit by more than the figure above
(it is the registry's ceiling and prices, not a measurement).

Status: accepted (Stage 8.2). Revisit: the first real replies (does the count the limit uses match the provider's usage page?); stopping a reply in the middle (IDEAS); 8.3, which shows the worst case before a
very large request is sent; a warning when a limit is nearly used; a billing-day reset (IDEAS); what happens when the registry's prices change (the limit counts at the price in the registry).

## D-032 - Stage 8.3: a question before a very large request, asked by the main process, with the figures shown

The limits of 8.2 are the hard stop; they cannot tell the person what a request could cost before it goes, and they let a reply that starts under a limit end over it (D-031). This slice
is the question that can come before the limit's check: when a request is large, the app shows what it could cost at the most, in dollars, and sends nothing until the person says yes.
The plan said only "before a very large request, it shows the estimate and asks first", so **what "very large" means is my design, and the one number in it is mine**: see the choices.

- **What is worked out, and by whom.** The main process, for every request, after the key is found and the request is built and **before anything is written or sent**. One guess at the
  tokens the request sends (`estimateInputTokens`, D-030: the app's rules, the person's instructions and every message), made once and used three times, so the question, the limit's check
  and the ledger's first line carry the same number (a check in the window suite compares the three). From it, `estimateRequest` (`src/shared/askFirst.ts`):
  **what sending could cost at the most**, the tokens at the **dearer of the ordinary input price and the cache-write price** (the Anthropic request asks for caching, D-030, and the first
  send of a conversation is written to the cache at a quarter more; a conversation the provider still holds from a message a few minutes ago costs far less, so the figure says "up to"
  and the question says why), and **what the reply could cost at the most**: the request's own ceiling (`streamRequest.maxOutputTokens`: 16,000 tokens, thinking included, or less for a
  model that cannot write that much) at the output price. The two added are the most the request could cost. All are guesses on the high side, at list prices; the provider's invoice decides.
- **When it asks.** When **what the request sends** could cost **more than** the person's amount (exactly at the amount goes, as exactly at a limit does; the comparison is in millionths
  of a dollar so that float noise cannot decide). **Not the reply**: its length is not known, and on the two dearest models a reply at its ceiling alone ($0.80) would make every request
  "large". The amount is the person's: Settings > Large requests, in whole cents ($0.01 to $10,000) or a deliberate **"Never ask"**, kept in `ask-first.json` beside `limits.json`
  (`{"version":1,"above":0.5}`, `"above":"never"`), written in place and read back (D-010), read once and kept. **Until the person chooses, $0.50 applies** (see the choices). Where $0.50
  begins to ask, from the registry's prices (checked in `verify-8-3.mjs`): above **40,000 tokens** on Claude Fable 5.1 and GPT-6 Astra, **100,000** on Opus 5.5, **200,000** on Sonnet 5.5 and
  GPT-6.1 Sol, **400,000** on Haiku 4.5, **4,000,000** on GPT-6 Luna. The dearest request the app can make today (the caps of `CHAT_LIMITS`: 600,000 characters of messages, 8,000 of
  instructions) is about **$3.36** on Fable 5.1 or Astra: $2.56 to send and $0.80 to reply.
- **A damaged file asks; it never turns the question off.** This is the opposite of the limits' file on purpose: a limit file that is damaged holds no choice and **refuses** requests (D-031),
  and this one holds no choice and **asks at the default**. A file that is missing, damaged, cut off, in the wrong version, spelled in a way this app never writes (`"Never"` in capitals) or
  unreadable (a folder in its place) reads as nothing chosen, and **never as "Never ask"**: every cut-off copy of the "Never ask" file reads as the default (checked). `read` never throws, so the
  question cannot be skipped by a failure to read; an unreadable file is not remembered, so repairing it is heard.
- **The question.** The main process sends the page a `confirm` event (the model, the figures, and the amount it asked above) **instead of sending the request**, and waits. The page shows
  "Send this large request?" with three rows that add up (sending the conversation, the reply, the most it could cost), a line that these are guesses at list prices and a cached conversation
  costs less, a line that the app asks above $X and that Settings changes it, and two buttons, **"Don't send" first and focused** (Enter alone cannot send a large request) and "Send". Escape is
  no. It is a modal `<dialog>` with the role `alertdialog`, labelled by its title and described by its introduction. The page works out no figure of its own: it shows main's, each rounded **up** to the cent so that none is shown below what it could be, and the total is the sum of the rows as shown.
  A request on the cheaper models almost never meets it (the most the app can send costs about $0.51 to send on Sonnet 5.5 and GPT-6.1 Sol, about $0.26 on Haiku 4.5); a request that is only
  large because the conversation is long does meet it on the dearer ones (the whole conversation is what goes out again).
- **Nothing is sent, and nothing is written, while it asks; and a yes means something.** The request waits in a small waiting room (`src/main/confirmation.ts`, no Electron imports) under the same
  key as its running reply, "<window id>:<stream id>". **The ledger is not begun while the question is open**, so a request that is never answered counts nothing and an app that is killed
  leaves nothing. A yes (`chat.confirm(streamId)`, a new bridge function) is **heard only for a question that is waiting**: one sent ahead of the question, twice, for another stream, for
  a question already declined, or after a Stop is dropped (checked over the bridge, and with 100 questions at once under Node). A Stop, a reload, a closed window or a "no" **declines**: main
  returns without a request. A question for a key that is already waiting is declined at once; a question that cannot be shown is declined; the question is shown only after it is waiting, so an
  answer can never come too early to be heard. The request itself cannot carry an approval: `checkChatRequest` builds main's own copy, so a `confirmed` or `askFirst` field the page adds is
  not read (checked, and a control breaks it).
- **The limits come after the yes, never instead of it.** After a yes, main reads the limits **again** (they may have changed while the question was open) and `ledger.begin` runs the check of
  8.2 in the ledger's own turn, exactly as before. A request that the limits would refuse anyway is **not asked about**: before asking, main looks at the sums and the limits, and if they refuse
  the request it sends their sentence at once. That look only spares the person a question that cannot matter; the check that counts is the one inside `begin`.
- **What the person sees afterwards.** "Don't send" (and Escape) ends the reply as an error line, **"Not sent: you chose not to send this request."**, with **Try again** (which asks again); the
  page tells main (`chat.cancel`) so the question is gone from main and a later yes for it is dropped. It is saved in the chat like any failed reply. A Stop while the question is open ends the
  reply as "Stopped". Regenerate, Try again and an edited message are asked about like a new message: all of them reach `runReply`, the one place a provider is called.
- **What the page can do.** Two new bridge functions: `chat.confirm(streamId)` and `settings.setAskFirst(choice)` (an amount in whole cents, or "Never ask", checked again in main and rebuilt
  field by field; the page cannot take a choice back to "nothing chosen", read the file or reach the ledger), one new event (`confirm`) and one new field in the settings status (`askFirst`).

**Choices I made where things were unclear.**

1. **What "very large" means: the input, not the worst case.** A trigger on the most the whole request could cost (input plus the reply ceiling) asks for every request on the dearest models, because
   $0.80 of ceiling is always there; a trigger on the input alone is the part that grows with the conversation and is known. The figure for the reply is shown in the question, not part of the trigger.
2. **An amount of my own, $0.50, until the person chooses.** The owner's decision of 2 October 2026 was that the spending **limits** have no numbers of the app's own. This is not a limit: it only
   asks, the limits still decide, and it is the one place where I chose a number. I chose a default (instead of asking for a third number in the first-run dialog, or leaving the question off until
   it was found) because a question that is off until someone finds it protects nobody, and a third box in the first-run dialog would be one more thing to answer before the first message. It is
   shown in Settings ("You have not chosen an amount, so the app asks above $0.50") and in the question itself, changing it is one box, and "Never ask" is there on purpose. **This is the one
   number to confirm or change.** I did not tie it to the limits (a fraction of the smaller limit): it would move whenever a limit is edited, and with a small budget it would ask on every message
   to the dearest model.
3. **The dearer of the two input prices.** For an Anthropic model the first send is billed at the cache-write price, so pricing the input at the ordinary price would show less than it can cost. The
   question therefore says "up to", and says that a conversation still in the provider's cache costs much less. It overstates for an active chat; that is the safe way.
4. **A question in the page, held by main, not an operating system dialog.** It is the same kind of dialog as the others, and the real window can be driven (an operating system dialog cannot be, by
   the checks this project has). The cost is that the page can answer its own question: see the threat note.
5. **It asks every time.** In a long chat on a dear model every message after the first asks, because the whole conversation goes out again. "Don't ask again in this chat" would weaken the question
   (IDEAS); the amount in Settings is the way to ask less.
6. **Figures rounded up, rows that add up.** A figure "up to $0.50" under an amount of $0.50 would look like a mistake when the request is a hair above it; so each figure is rounded up to the cent
   and the total is the sum of the rows as shown (so the total can be a cent above the true total, never below).
7. **`AmountField` is shared.** The amount box of the limits form was taken out into its own file and used by both forms; the page it draws is the same (the 8.2 suite re-run on it is clean).
8. **The README was stale since 8.2** (it still said that nothing limits spending); it now says what 8.2 and 8.3 do.

**Threat note.** What could go wrong, what stops it, what is left.

- _A hostile or broken page._ **This question is not a defence against a hostile page, and says so:** a page that can call the bridge can call `chat.confirm` itself the moment it sees the `confirm`
  event, and can choose "Never ask" in `settings.setAskFirst`, exactly as the person's own Settings can. What stops a hostile page spending is the limit (D-031), which the question never replaces
  and which runs after any yes. What the page **cannot** do: give a yes ahead of time (dropped, checked), approve a request by a field on it (not read, checked), approve a question that was
  declined or stopped (dropped, checked), approve another stream's question, make main skip the limit's check, read `ask-first.json` or its path, write the ledger, or turn the question off with
  anything but the two choices main accepts. The question guards the person against their own slip and against a bug in the page.
- _The person's own files._ `ask-first.json` is a plain file the person can edit or delete (rule 9). Damage to it asks at the default; a person who writes "never" into it has chosen "Never ask".
- _Spending the question does not stop._ (1) A request under the amount, however many (a chat that grows in small steps asks the first time its input is over the amount, and every time after).
  (2) Everything D-030 and D-031 list as not counted or not stopped: the figure is the app's own guess at list prices, on the high side for English and about right for Chinese, Japanese and Korean,
  and it leaves out thinking that is not shown only in a guess made after the fact; a model whose price changed since the registry was checked. (3) "Never ask". (4) The reply, whose length is not
  known: the question shows the most it could cost, and a reply that starts under a limit can still end over it (D-031).
- _A question that is never answered._ It waits until the window closes, reloads or the person answers; nothing is written and nothing is sent meanwhile, so waiting costs nothing. If the app is
  closed with a question open, the chat is saved with the reply as "stopped" (as any reply that was still arriving).
- _A question that is wrong._ The figures are main's own guess, rounded up. A model changed while the question is open does not change what was asked about: the request was built with the model that
  is shown, and that is the one that answers. The limits are read again after the yes. A key removed meanwhile does not stop a request already built (the key was read before the question).
- _Rule 1 (nothing leaves the PC unseen)._ Nothing new leaves it, and nothing in a request changed (the golden requests are the same bytes). The `confirm` event carries a model id and numbers, no text.

**What was checked, and what was not.** Against local mocks and scratch profiles only. A plain-Node suite, `verify-8-3.mjs` (288 checks, every file check in a normal folder and in the
EFS-encrypted %APPDATA%): the estimate for all seven models in the registry (a million tokens in at the dearer input price, the 16,000-token ceiling out, the two added; the ceiling of the request
that is really built, including a model that can only write 4,000), where the default begins to ask on each model (a table, and the first token count that asks), when the question is asked
(16 cases: exactly at the amount, a millionth above it, float noise, "Never ask" for a request that could cost a million dollars, the input and not the reply deciding), what is typed (14 accepted and
25 refused texts, and that the words are not the words of a limit), what the page may hand over (a table of 25 bad choices, extra fields dropped, the kind "default" refused), what `ask-first.json`
holds (the exact texts; 26 damaged files, each read as the default and none as "Never ask"; every one of the 29 cut-off copies of the "Never ask" file; the whole file still reading as "Never ask"),
the store (missing, damaged, with and without a byte-order mark, a folder in its place with `read` not throwing and the failure not remembered, a save that cannot be written, 20 saves at once,
a read between two saves, an edit made while the app runs not heard), **the waiting room** (a yes the moment the question is shown, a yes before any question not remembered, a stop, a signal already
aborted, the same key twice, a `show` that throws, other keys, a yes and a stop together in both orders, 100 questions at once, and no listener left on any signal), the way the amounts are written (ten
cases and 20,000 random pairs: never below what it is, never more than a cent above, the rows adding up), and source checks (the question comes after the estimate and before the limits are read again,
before the ledger and before the provider; nothing between touches the ledger but a look at the sums; one guess; the ceiling and the prices are the request's own; the provider is still called from
one place; the yes handler checks who asks and answers only the sender's own stream; the page works out no estimate of its own; a chat request carries no field that approves it). A window suite,
`verify-8-3w.mjs` (84 checks, `run83.mjs`) against the fake Anthropic API with Fable 5.1 chosen and **real 150,000-character requests**: a small request goes without a question; a large one opens the
question with nothing sent and nothing written while it is open; the figures on screen against figures worked out in the suite from what the mock then received (**the same token count three times**: the
question, the ledger's first line and an independent count of the request the provider got); Send, "Don't send", Escape, Try again, an edited message, the keyboard (focus on "Don't send", Enter
declines, Tab then Enter sends), a Stop while the question is open, and **a yes sent afterwards by a script for each question that was declined or stopped, which sends nothing**; the limits coming first
(a request a daily limit of $0.01 refuses is refused at once and not asked about); Settings (what it says, the box refusing "abc", 0 and 20000, Save, the sentence, the file, an amount of $5 letting the
same request through, $0.10 asking for a conversation that is large only as a whole, "Never ask" with its warning); what the page cannot do (ten bad choices from the bridge leaving the file byte for byte
as it was, extra fields dropped, **a yes sent twice the moment a request starts, and for other streams, and malformed, a field that claims approval, a yes after the end**, none of which sent anything,
and a yes given to the question that is waiting sending exactly one request); narrow windows (420, 320 and 280 px); and a reload while the question is open. A restart suite, `verify-8-3b.mjs`
(7 checks: $0.25 read back from the file and honoured by a request that the default would not ask about) and three launches with a damaged file, `verify-8-3c.mjs` (9, 9 and 10 checks: not JSON,
`"Never"` in capitals, a folder: the default asks, saving repairs the file, and with a folder in its place Save says it could not write and the question is still asked). **Negative controls: 65
breakages, all caught** (`tools/specs83`: 44 under Node; `tools/specs83w`: 21 in the real window), each file proved restored by hash, and the hash over `src/` and `registry/` identical before and
after every batch. They cover: the estimate (the input at the plain price, or at the cache-write price alone; the reply priced as input; the total without the reply; the ceiling a constant
instead of the request's own), when it asks (exactly at the amount asking; the reply counting in the trigger; "Never ask" still asking; no rounding to millionths; the default amount changed; the
default read as "Never ask"), what is typed (three decimals, zero, no maximum), what the page may hand over ("default" accepted, extra fields kept, an amount not checked), the file (not JSON, a
cut-off file, a bad amount, "never" in any case, each read as "Never ask"; the version ignored), the store (a missing file read as "Never ask", an unreadable one thrown or remembered, a
byte-order mark, a cache not updated, a save not read back), the waiting room (an early yes remembered, a stop not heard, an answered question not removed, a second question replacing the first,
a stopped reply still shown its question, the question shown before it waits, a `show` that throws), a request that keeps a field that approves it, the figures (rounded down, without the small
subtraction, a total from unrounded figures), `chat.ts` (the guess made twice, the limits not read again after the wait, the yes handler not checking who asks, a yes keyed without the window, the
answer ignored) and, in the window, the question never asked, the request sent whatever the answer, the ledger begun before the question, no look at the limits first, the saved choice ignored,
Send saying no, "Don't send" saying yes, Escape saying yes, the keyboard starting on Send, a Stop not heard, the yes never sent, the no not told to main, a choice saved unchecked, the status hiding
the choice, Save on for an invalid amount, the "Never ask" warning missing, the dialog's role missing, a field that approves a request (kept and honoured), and the waiting room not hearing a stop
together with `chat.ts` not checking its signal. **What the controls taught me about the checks and the harness:** (1) The window suite cannot see the waiting room's own abort listener on its own:
`chat.ts` also refuses to send when its signal was aborted, which stands behind the room, so nothing a person or a script can do shows the difference. The Node suite sees it; the window control
removes both protections and is seen. (2) A field that is only kept and never read changes nothing in the window; the Node suite sees it kept, and the window control makes `chat.ts` honour it.
(3) One window control first looked caught only because a step at the very start of the suite failed for an unrelated reason (a flake); a second run showed it was not caught, which is how (1) was
found. A control that is caught at its first check is worth running twice. (4) The checks of the waiting room could hang on a sabotaged room; every awaited answer now has a timeout, so it is a FAIL
line. (5) The window suite now records a step that waits for something that never comes as a failed check ("the suite stopped before its end: ..."), so a control that breaks the flow shows as a
named detection with a summary and not as a crash. (6) **A real fault of the harness:** after one Node control `nc.mjs` did not put `chat.ts` back, and printed nothing about it (its copy-back step
failed or never ran; the cause is not proven, a file held for a moment by another program on Windows is the likely one, and the same control ran clean when repeated). It was found only because the
whole tree was hashed before and after the batch. The file was restored from its backup (the backup's hash checked against the one printed by the other controls), `nc.mjs` now retries the copy for
several seconds, proves each file by hash and prints `RESTORE FAILED` if it cannot, and `nc-all.mjs` says when a control printed no "restored" line.
**What the suites found:** one real fault of mine, found by the check that the page logs no console error: the new Settings section had the same React key as the section beside it (the first window
run reported "two children with the same key"); fixed with its own key, and the check stays. A second, found by the narrow-window check: the question's table of three columns overflowed sideways
at 280 px; it is now two columns with the tokens under each label. Everything else the first runs reported was my test (a wrong paragraph number in two checks; waiting for the Send button while the
question was open; a millionth-of-a-dollar rounding that made "one more token" the wrong expectation on the cheapest model). **Older suites made stale** by this slice and updated: the exact lists of the
bridge and of the settings status in `verify-2-3`, `verify-2-4`, `verify-3-4`, `verify-4-2`, `verify-5-3` and `verify-8-2w` (`setAskFirst`, `chat.confirm`, `askFirst`), the button count in
`verify-5-3`'s check at 420 and 320 px (the Settings dialog has one more Save), and two negative controls of 8.1 and 8.2 whose target line had moved in `chat.ts`. Re-run on this tree and clean: `verify-2-3` (64; its first run had one failure, a status-shape line I had
missed), `verify-2-3b` (5), `verify-2-4` (71), `verify-3-4` (78), `verify-4-2` (91), `verify-5-3` (66), `verify-7-3` (53), `verify-7-6w` (46), the 8.1 suites (81 and 12), the 8.2 suites (62, 8, 8, 6
and 7), and the plain-Node part of the regression (15 suites).
**Not checked:** (1) **a real call to either provider**: nothing was sent to a real API, so what a real request costs against these figures is unknown (compare the first real replies with the provider's
usage page; the figure is a guess on the high side, and a cached conversation costs far less). (2) **The full regression** (about 55 minutes) and **the built app**: only the suites named above were run on
this tree; the other window suites, the seeds, the scenarios, Stage 4 and the `preview` part wait for your go-ahead. (3) The question with an OpenAI model through the window (the code is provider-neutral and
the estimate is checked for all seven models under Node; the window was driven with Fable 5.1 only). (4) A screen reader (the dialog is a modal `<dialog>` with the role `alertdialog`, a label and a description, and its rows are a table with row
headers; only the attributes were checked), and a real keyboard rather than the test client's key events. (5) Another display scale, a right-to-left language, and a window zoomed to 200%. (6) A model whose `maxOutputTokens` is lower
than 16,000 in the window (checked under Node). (7) Two windows (the app has one).

Status: accepted (Stage 8.3). Revisit: the first real requests (is the figure about right against the provider's usage page, and is $0.50 the right amount to start from); "don't ask again in this chat"
(IDEAS); the limits still left in the question (IDEAS); whether the question should be an operating system dialog once there is a way to check one; Stage 9's attachments, which will change the cap on a
request and so how often this asks.

## D-033 - Stage 8 as a whole (8.1 to 8.3): what it added to the app's surface, the threat note across its three slices, and what was not checked

Stage 8 (D-030 to D-032) is the money stage (safety rule 6): every request is counted in a ledger, a daily and a monthly limit that the owner chose stop requests in the main
process, and a question comes before a very large request. Each slice has its own threat note. This is the stage's: the surface the three slices added taken together, the risks
that exist only where they meet, what the full regression of 8.5 showed, and what was not checked. It changes no code. **It corrects one sentence of D-032** (the first bullet
of the threat note below). 8.4, encrypted history, is not part of Stage 8: it is Stage 8b (the owner's decision of 2 October 2026).

**What the stage added, in one list.**

- **Across the bridge:** four functions (`usage.summary`, `settings.setLimits`, `settings.setAskFirst`, `chat.confirm`; channels `usage:summary`, `settings:set-limits`,
  `settings:set-ask-first`, `chat:confirm`), two events from main to the page (`usage`, `confirm`), one optional field on `chat:start` (`conversationId`, which decides only which chat
  a cost is shown under) and two fields in the settings status (`limits`, `askFirst`). Main checks everything the page hands over and builds its own copy field by field. The page has
  no function that writes the ledger, reads one of the files or learns a path.
- **On disk:** three new plain files in the data folder: `usage/ledger.jsonl` (appended to, never rewritten), `limits.json` and `ask-first.json` (written in place and read back, no
  rename: D-010). None holds message text or a key. Saved chats are still version 3 and `preferences.json` is unchanged. `registry/models.json` is schema 0.4 (four prices a model).
- **One order, in one place.** `runReply` in `chat.ts` is the only place a provider is called, and every way to ask (a new message, Regenerate, Try again, an edited message, a call
  made straight through the bridge) goes through it: the key is read and the request built; one guess of the input tokens; **only if what the request sends could cost more than the
  person's amount**, a look at the limits (a request they would refuse is not asked about) and the question; the limits read again; `ledger.begin` runs the limit's check in the
  ledger's own turn and writes the request's first line; the provider is called; the ledger's second line, however the request ends.
- **Not added:** no package (`package.json` and the lock file are the same as at Stage 7), no network call (a search of the diff of `src/main`, `src/shared` and `src/preload` for
  `fetch`, addresses, `net`, `http`, `shell` and `child_process` found only the pattern that reads a typed amount), and nothing in `src/main/index.ts`, `src/main/security.ts` or
  `index.html`: the window's guards (sandbox, context isolation, navigation lock, window-open handler, Content-Security-Policy) were not touched since Stage 7.

**Threat note across the slices (what could go wrong where they meet, what stops it, what is left).**

- _Who can lift the three protections: a correction to D-032._ D-032, and `ARCHITECTURE.md` after it, said that what stops a hostile page spending is the limit. That is true of a slip
  of the person's, of a bug in the page and of anything a model writes (a reply is drawn as text and can call nothing, D-025). **It is not true of a page that is itself hostile.** The
  same page can call `settings.setLimits` with "No limit" for both (or $10,000), `settings.setAskFirst` with "Never ask", and `chat.confirm` for its own question, and then send as many
  requests as it likes: main checks each call for its form and for who is asking, and does not ask the person. The regression shows it from the other side, since `verify-8-3w` lifts
  both limits through the bridge to run its own requests. So the three protections stop the app from spending by accident and at a model's word; they do not stop code running in the
  page. What keeps such code out is the window's own guards (no HTML from a reply, the policy, the navigation lock: D-025, D-028), not the limit. **Left, and my recommendation before
  Stage 11:** raising a limit or choosing "No limit" should need the person's answer to a question that main asks outside the page (an operating system dialog, or a confirmation a
  page cannot send). I did not build it: 8.5 is the check and the note, nothing in the app yet lets a model's words reach the bridge, and it is the owner's call. It is in IDEAS.
- _The data folder, once a tool can write._ The ledger, `limits.json` and `ask-first.json` are plain files the owner can edit or delete (rule 9), and the limit stops the app, not
  a program run as the person. Today nothing writes in the data folder but the app's own code. A command run on approval (Stage 13) is a program run as the person: it could raise a
  limit in the file or delete the ledger (which resets the count). The app reads each file once and keeps it, so a limit edited on disk while the app runs is heard only at the next
  start; that narrows the gap and does not close it. **Left, for Stages 12 and 13:** the data folder must lie outside every folder a tool can read or write, and a command's approval
  must show the command in full. Stage 10's memory and Stage 12's folder choice must not be allowed to point at it.
- _Money, the three layers together._ The ledger counts what the provider reports (8.1), the limit refuses when the spending so far plus this request's input is over it (8.2), the
  question asks when the input alone could cost more than the person's amount (8.3). **Three things none of them stops:** (1) The reply, whose length is not known: one reply can end
  over a limit by at most its ceiling ($0.80 at the dearest output price in the registry, 16,000 tokens with the thinking), plus whatever the real input was above the guess, plus the
  same again for each request in flight at that moment. (2) A conversation that grows in small steps, or a request just under the amount: on a dear model every message after the first
  asks, so the person may come to press Send each time; "Don't send" holds the focus so that Enter alone cannot send, and what stops it then is the limit. (3) "No limit" and "Never ask",
  both chosen on purpose. The count is the app's own, at list prices; **the provider's own limit on its account is the real backstop**, which Settings says.
- _The guess is used three times._ One guess of the input tokens (the bytes of the app's rules, the instructions and every message, divided by 3) is shown in the question, used by the
  limit and written as the ledger's first line, so the three never disagree; a real report then replaces it in the ledger and the sums catch up afterwards. It is on the high side for
  English and about right for Chinese, Japanese and Korean. **It has not been measured against a real tokenizer for text that tokenizes badly** (long random strings, minified code,
  runs of digits), where it could be low, and so could the question and the check made before such a request. A guess made after the fact leaves out thinking that was never shown.
- _Counted is not billed._ Fast mode, the Batch API, data residency, web search, an invoice's discounts and tax are not in the figure (the app uses none of them now); a price that
  changed after 2 October 2026 is a wrong cost until the registry is updated; a request the provider billed although it turned it away is counted as nothing. The figure is list prices.
- _Three files that fail in different directions, on purpose._ A first line that cannot be written: nothing is sent. A second line that cannot be written: logged, the request has
  happened, and the first line (a guess of the input) is what a later run counts. `limits.json` missing, damaged, cut off or in the wrong version: "not chosen", and every request is
  refused; unreadable (a folder in its place): refused with a sentence. `ask-first.json` damaged or unreadable: the default amount, so the question is still asked, and **never "Never
  ask"**. Damage to these files can only make the app ask or refuse more. The exceptions are a damaged **line** of the ledger (skipped and counted, so the sums are smaller; Settings
  says how many; the limit does not fail closed on it because a cut-off last line is what a crash leaves) and a ledger that has lost whole lines, which nothing can see.
- _A question that waits._ It costs nothing and writes nothing; a Stop, a reload, a closed window or a "no" declines it, and a yes is heard only while it waits. A key removed
  meanwhile does not stop a request already built, and a model changed meanwhile does not change which one answers (the request was built with the model that is shown).
- _Rule 1 (nothing leaves the PC unseen)._ Nothing new leaves it: the ledger, the limits and the question are local, the request is the same bytes (the provider suite's golden-request check, taken from Stage 2, still passes), the
  `confirm` event carries a model id and numbers and no text, and `usage:summary` answers with sums. (The providers' prices were read from their pages by me, on 2 October 2026,
  not by the app.)
- _Rules 2 and 4 (untrusted content is data; no chaining)._ Nothing in this stage acts on what a model says. A reply cannot call the bridge, no request begins without a click or a
  key press of the person, and there are no tools, loops or agents. The question is the first place where the app waits for the person's decision before a request.
- _Losing something._ "Don't send" ends as a saved error line and Try again asks again; a replaced reply stays counted because it was billed; nothing in the stage deletes anything.
  Deleting the ledger resets the count, and Settings says so.

**The roadmap's Stage 8 safety line (rule 6), claim by claim.**

- _Usage and cost are shown._ Per reply, for this chat, today and this month (D-030); how much of each limit has gone; the question's figures; always as list prices ("about" for a
  guess, "your provider's invoice decides").
- _A limit stops requests._ Checked in main before every request, in the ledger's own turn, whichever way it was asked (D-031): exactly at the limit may go, a cent over may not, the
  refusal is a sentence that names the limit, and a refused request writes nothing. **It holds against** a slip, a bug in the page, a model's words and a script that only reaches
  `chat:start`; **it does not hold against a page that changes the limit** (the first bullet above).
- _Anything that can loop comes after._ Nothing loops: no tool, search or agent exists, and every request begins with a click or a key press. Stages 11 to 13 are not built.
- _It counts what D-028 listed._ The output including the thinking at any effort level, every Regenerate and Edit, the instructions inside each request's input and the whole
  conversation that goes out again each time: all of it is in the request or in the provider's report, and the window suite sends each of them (D-030).

**What the full regression of 8.5 showed (5 October 2026).** `node tools/regress.mjs t85`, all six parts, 69 minutes (15:21 to 16:30), on the tree of the 8.3 commit (`31b4f59`) with only
`docs/` changed while it ran (a hash over every file of `src/` and `registry/` was the same before and after, and `git diff` of them is empty): **89 runs, 86 clean the first time, and
the other three clean when run again after two fixes to the tests (below). No app was at fault.** Clean the first time: the 15 plain-Node suites (2,468 checks: the provider suite
with its golden-request check, the registry, the store, the adapters, the credential store, the rankings, Effort, Markdown, Regenerate and Edit, Instructions, and the three of this
stage: the ledger 194, the limits 215, the question 288); 17 of the 18 window launches against the dev app (Stages 1 to 3, 5, 6, 7 and 8, with their restarts: 111, 64, 5, 71, 78,
66, 53, 27, 58, 53, 53, 84, **81, 62, 84** (the three of Stage 8, restarts and damaged files included), 46 and 13 checks); the 16 seeded `preferences.json` launches; 9 of the 10
registry scenarios (each put `registry/models.json` back, proved by hash); all 7 Stage 4 history launches against the dev app and again against the built one; and 14 of the 15
launches against the built app (`electron-vite build`, then the same suites on the compiled bundle, **the three Stage 8 suites included: 81, 62 and 84 checks, the same counts as in
the dev app**). The three that failed were stale expectations in two test files that earlier slices had made out of date and nobody had run since: (1) `verify-5-4` (dev and built, 46
of 47) expected a reply's events to be `start`, text, `done`, and since 8.1 a `usage` event comes just before `done` (D-030); the check now says `start`, text, one `usage`, `done`.
(2) The `wrong-version` scenario (8 of 13) expected the message "this version of the app reads 0.3", and the registry has been schema 0.4 since 8.1; the expected text is now 0.4
(`verify-5-2` already said so). Both were found by reading the failing line and checked against D-030 before the test was changed. After the fixes: the scenario 13 of 13 (and
`registry/models.json` back, identical by hash), `verify-5-4` 47 of 47 on the dev app and 47 of 47 on a freshly built one. The changed `verify-5-4` check has no negative control of its
own (it fails if the `usage` event is absent, by reading, and was not sabotaged). **There was no hidden-window stall, no lost window and no retry in these 89 runs**: the watcher
(`tools/watch-windows.ps1`) logged five moments of keyboard or mouse input, none in a launch that failed, so the stalls of 2 October did not recur, and their cause is still not known.
(In all this, the 8.1 to 8.3 negative controls were not run again: they were run when each slice was made, 65 + 32 + 36 breakages, each caught, and `src/` has not changed since; what
this run re-proves is that the checks still pass on the whole tree.)

**Not checked, for the stage as a whole.** (1) **A real call to either provider**: none has been made in any stage, so no real usage report has been read by this app. How a real
API reports the cache numbers, whether the thinking is inside the output count, what a stopped reply is billed, and whether the app's figures match the provider's usage page are all
unknown; the mock is my reading of the documentation. The first real use is the owner's: compare the figures with the provider's page. (2) **Whether $0.50 is a sensible amount to
ask above** (D-032: the one number I chose); it is only a default and the owner decides. (3) **The owner's own profile**: nothing ran there, only scratch profiles; it will show the
first-run limits question when this build first starts on it, because it has no `limits.json`. (4) **The OpenAI path through the window**: the ledger, the limits and the question
were driven with Anthropic models only (the conversion of OpenAI's report and the estimate for all seven models are checked under Node). (5) **The guess against a real tokenizer**
(above). (6) **Time**: daylight-saving changes, other time zones, a clock set back, and midnight passing while the app is open (the edges of a day and a month are checked under Node
with the local clock). (7) **Two copies of the app at once** (each reads the ledger once), and a file edited while the app runs. (8) **A big ledger in the real app**: near its 64 MiB
cap, and how long the first request takes to read it (only a small cap under Node). (9) **A screen reader**, a real keyboard (the test client sends key events), a zoom of 200%,
another display scale, a right-to-left language, and window sizes other than 900, 420, 320 and 280 px (the limits form was measured at 320 and 420 for its Save button only). (10) **A model
that can write less than 16,000 tokens, in the window** (checked under Node). (11) **A hostile page** lifting the protections: shown by code and by the suite's own use of the bridge,
not attacked as a separate test. (12) **The packaged installer** (the built-app runs use `electron-vite preview` on the compiled bundle, and `app.isPackaged` is false there), and any
system other than Windows. (13) **Why the test window sometimes reports "hidden"** (tools/README); not proven.

Status: accepted (Stage 8 closed; 8.4 is Stage 8b). Revisit: the first real requests (the figures, and $0.50); a way to raise or remove a limit that the page cannot do alone, before
Stage 11; the data folder kept out of reach of tools, before Stages 12 and 13; a measured guess; a ledger that is compacted; a warning when a limit is nearly used (IDEAS).

## D-034 - Stage 8b.1 and 8b.2: chats are backed up to one plain file the person chooses the place for, the file is read back before it counts, and a restore never replaces a chat

Stage 8b is "optional encrypted history", and the owner's decision of 2 October 2026 (ROADMAP, D-030) put **a tested backup and export path before any encryption exists**, because losing the
key would mean losing the chats. This entry is that path: **8b.1 backs up** (one chat, or all of them, to a file) and **8b.2 restores** (from such a file). Encryption itself (8b.3 and 8b.4) was
not started here: it waited for the owner to try the backup on real chats, and follows in D-035. (On 5 October 2026 the owner had no preference for how the chats would be encrypted and left the choice, and where to pause, to me;
the plan is in ROADMAP: each chat file encrypted with Electron's `safeStorage`, the protection the API keys already have, with no key and no cryptography of my own.)

**The file.** One plain text file, JSON Lines, UTF-8 (`src/main/backup.ts`): line 1 is a header (`format`, `version`, `exportedAt`); then one line per chat, `{"n":1,"sha256":"...","chat":{...}}`, where
`chat` is exactly what the chat's own file holds (version 3) and `sha256` is the checksum of that text; the last line says `{"end":true,"count":N,"leftOut":K}` (how many chats, and how many saved
files could not be read when it was made and so are not in it). Why lines and not one JSON object: a file that was cut off (a copy that stopped, a full disk) still gives back every chat before the cut and
_says_ it is not whole, where one big object would give back nothing; and a reader never needs more memory than one chat. Why a checksum on each chat: a changed byte inside a message still parses as JSON, so
nothing else would notice; with it a changed chat is refused, named by its line, and the others are unaffected. **The checksum guards against damage, not against a person who rewrites both the chat and its
checksum: the file is the owner's own, and a backup from anyone else is untrusted data (below).** The last line is what tells a whole file from a cut-off one.

**Reading** (`readBackup`) never writes anything and never needs more memory than one line: the file is read in 64 KB pieces, a line longer than the largest chat is skipped without being kept (a 160 MB
line was read with the memory growing by 11 MB), a file over 2 GiB is not read, and at most 1000 chat lines are looked at. Every chat goes through the same strict check as a saved file's contents
(`parseSavedFile`: versions 1 to 3, the id's one spelling, the dates, the instructions, the messages and every limit of D-016), after its checksum and its id. A damaged file is a **result, never an
exception**: "not a Frontier chat backup", "made by another version", the chats that could be read, and the lines that could not (the first 20 with their reasons). `complete` means the file is whole: the last line
is there, its count is the number of chat lines, the lines are numbered 1, 2, 3 ... and nothing comes after the end. A byte-order mark and CR LF line ends are tolerated; invalid UTF-8 is not.

**Writing** (`writeBackup`) follows D-016's rule: the new file is written beside the real one as `<name>.part` and flushed, **read back with the same reader** (every checksum, every id, the count, the
last line, and that it holds exactly what was written, in the order it was written), copied over the real path, read back again, and only then is the `.part` removed. A disk fault before the copy leaves the
old file exactly as it was and no `.part`; once the copy has begun a whole `.part` is kept and named in the error. A backup is never "saved" on the word of the write.

**Where it goes: the person chooses, in the system's own dialog, and the page never names a path.** The page can say `{scope:'all'}` or `{scope:'one', id}` (`checkBackupRequest`: nothing else is read, so a
path in the request is ignored) and, later, "add what you showed me". Main opens the save or open dialog for the window that asked (`BrowserWindow.fromWebContents(event.sender)`, in the one wrapper
`guardedForWindow`, which runs through the same sender guard as every handler), and only afterwards does the page learn where the file went. **A backup is refused inside the app's own data folder**
(`isInside`, looking through links: a path through a junction, a path that climbs out and back in with `..`, and other capitals all count as inside), so it can never land on a key file or a setting:
with that check removed, the suite's backup overwrote the stand-in key file. One backup or restore runs at a time (a second call is told to wait and opens no second dialog), and quitting waits for it.

**Restoring is two steps, so that nothing is added before the person has seen what is in the file.** `restoreLook` opens the dialog, reads the file and **adds nothing**; it answers with the file's
name (never its folder), when it was made, whether it is whole, how many chats are new, already here, or share an id with a different chat, how many cannot be used and why, how many carry
instructions of their own, the first ten titles, and how much room there is. `restoreApply` adds, and only with the token that look returned: **one use, ten minutes, replaced by a newer look, dropped by
Cancel, and only if the file is still the file that was looked at (same size, same time)**. It reads the file _again_ and checks every chat again as it adds it, so what is added is what passes now. **A restore never
replaces anything**: a chat whose id is free is added as it was (its dates and instructions kept, its title worked out again from its messages); the same chat already here is skipped; a different chat under the same id, or a damaged file under it, is
added as a **copy under a new id**; an id taken between the look and the apply is a copy too. The look and the apply use the same classifier, so a chat that appears twice in one file is not copied twice.
It stops at the limit of 1000 saved chats, and the chats that did not fit are counted ("no room").

**The store gained two methods** (`conversationStore.ts`; the rest of `save` is unchanged, with the three-step write moved into one function that both use): `inspect(id)` (free, here, or damaged) and `add(chat)`, which
keeps the chat's own dates and **never replaces**: it answers `occupied` for an id that is listed, one whose file cannot be read, a file that appeared after the list was made, or a half-saved `.tmp`.

**What the page shows** (`HistoryDialog`, `useBackup`, `RestorePreviewPanel`): an **Export** button on each row, **Back up all chats...** and **Restore from a backup...** in the footer, a notice after each (a status
for success, an alert for a refusal; a closed dialog is not an error and shows nothing), every button off while a dialog or a file is being worked on, and a preview that replaces the list until the person adds or lets it go. The
**safe button has the focus** ("Don't add"; "Back to the list" when there is nothing to add). The preview says when the file is not whole, which chats cannot be used and why, that chats with instructions of their own
will send them with every message (D-027), and **to add only a backup the person made or trusts**, because the model reads what is in a chat as a conversation that really happened.

**Testing the dialogs.** The system's dialogs cannot be driven from the page, so the window suite replaces `dialog.showSaveDialog` and `showOpenDialog` from the main process's inspector (as 7.2 did for
`shell.openExternal`): each ask is recorded (was it modal, the name suggested, the file type, the ask before replacing) and answered with a path the suite chose or with "the person closed it". **No switch
was added to the app for this**, and the code under test is the real one. The flow itself takes its two dialogs as functions, so the plain-Node suites play them directly.

**What the work found.**

1. **A real weakness in `isInside`, found by the EFS pass.** This PC reaches `%APPDATA%` through a package folder for programs started by the Claude desktop app, so a path that exists resolves into one tree and a path that does not
   yet exist, "as typed", sits in another: a backup to a folder that did not exist yet was judged outside the data folder. It now resolves the deepest folder that exists and adds the rest on, for both sides. (The suite's junction
   check had the same artefact and now makes its junction from the resolved target.)
2. **Restoring is slow where the disk is slow.** 1000 chats took 7 s in a normal folder and **109 s in this PC's EFS-encrypted data folder**, because each chat goes through the same four file steps as any save (D-016). The page
   shows nothing but "buttons off" while it works. A restore is safe to repeat (the chats already added are skipped), so cutting it short is harmless; a progress line is in IDEAS.
3. **Three older checks went stale, none because the app was wrong:** `verify-4-2` lists the bridge's exact functions (four more, as intended here); `verify-4-4` allows two Tab stops per row to reach Close and there are three now
   (Export), so it allows three; and five negative-control specs of earlier stages no longer found their sabotage text (the save code moved into one function, and my two new handlers repeated the sender check that the "guard off" controls
   expect once; the handlers now go through `guarded`, and the two store specs point at the new text).
4. **Two of my own checks were wrong at first** (a place where a changed byte is harmlessly not noticed: the file's final line break; a 280 px click that landed below the fold of a scrolling dialog). Both were read before they were
   believed; the second also showed a real layout flaw (the preview was a small scroll box inside the scrolling dialog), which is fixed and now has its own check and control.

**What was checked (plain Node, then the real window).** `verify-8b-1.mjs`, 129 checks, in a normal folder and in the EFS one: the file's exact shape; a backup of 12 chats, of one, with chats left out; **the file cut at each of its 4,827
lengths** (never an exception; always a prefix of whole chats, exactly as they were, never half a chat; "whole" only when nothing but the last line break is missing) and **one byte changed at each of its 4,826 places** (never an exception; never a
chat that is not exactly an original; every change noticed except in the time it was made, the left-out count and the last line break, which carry no chat); not-a-backup files (empty, random bytes, a PNG header, a chat file, a ledger line,
another format or version, a bad time); a line deleted, repeated, out of order, appended after the end; an edited message, a wrong or malformed checksum; 22 chats that are well-formed and checksummed but not what the app saves; old versions
inside a backup; `__proto__` and extra fields; the caps (a cap of 3 chats, a 1000-chat file, one chat line more, a file over the cap); a 160 MB line; and the writer with nine disk faults (no room, a write that fails, a flush that fails, a byte
changed silently, a failing copy, a short copy, an undeletable `.part`, a chat that cannot be read, too large), each leaving the old file or a whole copy. `verify-8b-2.mjs`, 254 checks (131 in the quick mode the controls use): the store's
`add` and `inspect` (occupied in four ways, full, too large, a copy that fails); the flow with fake dialogs (what the page may ask: 13 junk requests all refused before any dialog; a path in a request ignored; seven places inside the data folder
refused; one at a time; cancel); restoring (an empty profile, the same file again, a different chat under the same id, a damaged file under another, a chat twice in one file, instructions, a changed line, a cut file, a letter, a folder, a missing
file; the token refused in eight ways, reused, expired, cancelled, replaced; the file longer, replaced or deleted after the look; no room); **1000 chats out and back in, and a backup of the restored profile is byte for byte the first
backup**; and eleven checks of the source. `verify-8b-w.mjs`, 68 checks on the dev app and 68 on the built one: the dialog, every notice, the preview, the focus, Escape, deleted chats coming back byte for byte, nothing replaced, a cut file and a
changed chat, a letter, the bridge refusing junk, a path in a request ignored, the dialog at 460, 320 and 280 px, and in a window only 300 px high. **Negative controls: 50 for the plain-Node suites (`specs8b`) and 18 for the window suite (`specs8bw`), every one caught, each file put back (proved by hash; `src/` identical after each batch).** They were not all caught the first time, and the misses were read, not shrugged off: five were fixed in the **checks**, none by changing the app. `n8b-ipc-look-no-window` (the open dialog given no parent window) had no plain-Node check (a source check was added; the window suite already saw it); the footer's wrap is held by two layers, so removing one changes nothing a person can see (the control now removes both); the preview's own scroll box needed a short window to show (a 300 px high pass was added); a notice that is on screen when the dialog closes was never tested (it is now); and a token used twice was only tested under Node (a page script can call the bridge, so the window suite does it now). **The full regression `t8b`: 93 runs in 73 minutes (18:38 to 19:51), 92 clean the first time**, with the Node part (17 suites), the 18 window launches, the 16 seeded launches, the 10 registry scenarios, the 7 Stage 4 launches and the built app (the new 8b suite 68 of 68 there too, and the three of Stage 8). `src/` and `registry/` were identical by hash before and after, the watcher logged no keyboard or mouse input and no hidden window, and there was no lost window and no retry. **The one run that was not clean is not about this stage**: the built app's Stage 8.1 usage suite (`verify-8-1w`, 80 of 81) failed because the page's usage figures lagged the ledger by one request ("This chat" 3 requests, expected 4; later runs: Today 11 against a count of 12 made from the file). It failed in 3 more re-runs (78, 79, 79 of 81) and **also fails sometimes on the untouched `main` tree** (a stashed copy of `1eca723`, built the same way: 81 of 81 once, 79 of 81 and 11 of 12 on the next run). In the regression of 8.5 (5 October, earlier the same day) it passed; the dev app's run passed this time. The cause is **not proven**: it looks like a race between the page asking for the sums and the ledger's last write finishing, which would be a small fault of 8.1 and not of 8b, or the machine being slower now. I did not change anything for it; it is in the list of what is not checked.

**Threat note (8b.1 and 8b.2).**

- _What could go wrong, and what stops it._ **A backup written over a key or a setting:** refused inside the data folder, links followed. **A backup that is damaged and trusted:** it is read back whole before "Saved" is said, and again at its place; a damaged
  one is told apart from a whole one. **A restore that replaces a chat:** it cannot (`add` answers `occupied`; copies get new ids). **A page that names a path:** it cannot; it asks for "all" or "one" and the person picks. **A page that restores something the person
  did not pick:** the token is one use, ten minutes, tied to the file's size and time, and a restore needs the person to have chosen a file in the dialog first. **A page that opens dialogs in a loop:** only one runs at a time, each is modal to the
  window, and none writes or reads until the person picks.
- _What is left._ **The checksum is not a signature**: anyone who can write the file can make a chat that checks out. **A backup from someone else is untrusted:** it can hold a made-up conversation, with replies the model never wrote and instructions, and the
  model takes a chat's history as true when it is continued; the preview shows titles and the instructions mark but **not the messages**, and says to add only one the person made or trusts. **A backup is plain text**: anyone who can read the file can
  read every chat in it, in the place the person chose (a synced folder, a USB stick); the dialog says it is a plain file, and encryption (8b.3) will not cover backups unless the owner asks. **A page that exports in a loop** costs the person a dialog each time and
  writes only where they choose. **A hostile page can still lift the limits (D-033)**: nothing here changes that.
- _Rule 9._ Plain files the owner can read, export and delete: now with an export and a restore that were proved against damage. Deleting still asks first, and nothing here deletes.

**Not checked.** (1) **The real Windows dialogs were never shown or clicked**: they were replaced from main, so what is proved is what the app asks of them (modal, name, file type, ask before replacing), not how they look or what Windows does with
a name typed without an extension. (2) **The owner's own profile and chats**: only scratch profiles; the owner is to try the backup on real chats before encryption is built. (3) **A removable or network disk that goes away in the middle**: only
simulated faults. (4) **Quitting while a restore runs** (the quit waits 5 s, which can be less than a restore takes): reasoned to be harmless, because each chat is written whole and a restore can be repeated, but not tested. (5) **Two copies of the app at
once**, and a folder changed by another program while a restore runs (the late-file case is tested for one chat). (6) **A backup of 2 GiB, or a chat line of 10 MB, through the window** (the caps are tested with small caps under Node, and the 9 MB chat
passes under Node). (7) **A screen reader, a real keyboard, other display scales, a right-to-left language**. (8) **The built app here is `electron-vite preview`, not the installer.** (9) **Systems other than Windows** (the junction and capitals checks are Windows). (10) **The built app's Stage 8.1 suite, which is intermittently 1 to 3 checks short on this PC** (above): reproduced on `main`, cause unknown.

Status: accepted (8b.1 and 8b.2; 8b.3 and 8b.4, the encryption, follow in D-035). Negative controls and the full regression: above and in STEP-LOG. Revisit: why the built app's 8.1 usage figures sometimes lag the ledger; a progress line while a restore runs; a mark on a chat that came from a backup; a way to back up the settings and the
ledger too; a Markdown export (IDEAS); encryption (8b.3).

## D-035 - Stage 8b.3 and 8b.4: saved chats can be encrypted with the operating system's secure storage, one module decides how a chat may be written, and when the key cannot be read nothing is saved and nothing is changed

D-034 built the way back (a backup and a restore) before any encryption existed, because losing the key would mean losing the chats. This entry is the encryption itself (8b.3) and what the app does when the key cannot be
read (8b.4). **How to encrypt was the owner's open question** ("I don't have any idea", 5 October 2026), and **the choice is mine**: each chat's file sealed by Electron's `safeStorage`, the protection the API keys already have,
with **no key and no cryptography of my own**. The owner's "go." of the same day, sent after the backup was pushed, was taken as the go for 8b.3 to 8b.5 that D-034 waited for. I do not know whether the backup was tried on real chats first;
if it was not, that is still the thing to do before relying on this.

**What a person sees.** Settings has a "Saved chats" section. With encryption off (the default) it says the chats are plain files and offers "Encrypt my saved chats...". That button asks, in the system's own save dialog, where to put a
**backup of every chat** (titled "Back up your chats before they are encrypted"), checks the backup exactly as any backup is checked (D-034), and only then encrypts: the choice is written, and every chat is rewritten as a sealed file. With encryption on it says how many
chats are encrypted, reminds the person that a backup holds the chats only as they were when it was made (a chat saved after the last backup is lost with the key), and offers "Go back to plain files...", which the **system** asks about in a message box ("Keep encryption" is the default and the Escape answer). The History dialog says which way the files are kept.

**The file.** A chat keeps its name, `<id>.json`. Sealed, it holds `{"format":"frontier-chat-encrypted","v":1,"data":"<base64>"}`, where `data` is what the secure storage made of the chat's own file text (the very text a plain file holds,
version 3). Nothing about the chat is readable in it (not the title, the dates, the messages or the instructions); the file's name, size and date still show that a chat exists and when it was written. The envelope has no `version` field on purpose: an
older copy of the app takes it for a file of another version and leaves it alone, which is right. Reading takes either form, so a folder with both (a conversion that was cut short) is fine; a sealed file's inner id must be the file's name (a sealed chat renamed
is not read as another chat); and a sealed chat is bigger than the chat in it (base64), so it has its own size limit, and **a file bigger than a plain file may be is read only if its first bytes say it is sealed** (the old rule that a file of any size cannot fill the
memory is kept; `verify-4-1`'s sparse 11 MB file proved the first version of this wrong: see below).

**The choice and the one rule (`chatProtection.ts`).** The choice lives in its own small plain file, `chat-encryption.json` (`{"version":1,"encrypt":false}` or `{"version":1,"encrypt":true,"check":"<base64>"}`), written in place and read back like `limits.json` and `ask-first.json`.
`check` is a short known text that the secure storage encrypted when the choice was made, and **it is opened again before every write**: that is how the app knows, without opening a single chat, that the key is still the one that sealed them. **This module alone says how
the next chat may be written, and the store asks it before every write (a save, a chat added from a backup, a conversion)**:

| the choice file                                                                                      | the secure storage   | the check                                                         | the next write |
| ---------------------------------------------------------------------------------------------------- | -------------------- | ----------------------------------------------------------------- | -------------- |
| missing, or `encrypt: false`                                                                         | any                  | not looked at                                                     | plain          |
| `encrypt: true`                                                                                      | there                | opens                                                             | **sealed**     |
| `encrypt: true`                                                                                      | there                | does not open (a reset profile, another account, a copied folder) | **refused**    |
| `encrypt: true`                                                                                      | missing (no keyring) | not looked at                                                     | **refused**    |
| there, but not exactly one of the two shapes (not JSON, cut off, another version, a folder, too big) | any                  | not looked at                                                     | **refused**    |

"Refused" means nothing is written and the sentence says why and that nothing was changed. **Damage never means "plain" and never means "encrypted"; it means "ask"** (the opposite of `ask-first.json`, whose damage means the default, because there the default is the safe side; here the safe side is not to write). **The secure storage is asked to encrypt in exactly one place besides
a sealed write: turning encryption on (the check).** While writing is refused it is never asked at all, which is what "makes no new key behind the owner's back" means here: the app has no key of its own to make, and it does not use a key that cannot be the one the saved chats were made with. A read that fails because a file is locked is not kept: the next look reads the real file.

**Turning it on** (`chatEncryptionService.ts`, inside the backup service's lock, so a backup, a restore and a change of how chats are kept never overlap): (1) the secure storage must be there, and if encryption was already on its key must open the check; (2) if there are saved chats,
**a backup of all of them**, written, read back and checked in the place the person chose; closing the dialog stops everything, and a backup that cannot be made stops everything: nothing is encrypted without a backup the person made; (3) the secure storage is shown to encrypt and decrypt a check, the choice is written with it and
read back; (4) `store.conform()` rewrites every readable chat as a sealed file, **one chat per turn of the queue** (a save meanwhile takes its turn between two chats; a restore of 1000 chats, with the same four file steps per chat, took 109 s in this PC's EFS data folder), each by the same three steps as any save, **proved by opening what was written** and read again from disk, its dates, title and
instructions kept (a version 1 or 2 file comes out as version 3). The choice is written _before_ the conversion, so no new plain file can appear while it runs; a crash in the middle leaves a state the page shows ("N chats are not encrypted yet") and "Encrypt the rest" finishes (a fresh backup first). With no saved chats there is nothing to back up and no dialog.
**Going back** asks the person in the system's message box, writes the choice, and `conform()` rewrites every chat that can be opened as plain; a chat that cannot be opened is not converted and not deleted. **The question is the system's, not the page's, on purpose (D-033):** the page can already read every chat through the bridge, so what it must not be able to do is quietly make the
files on disk readable too. With nothing encrypted and the choice already off nobody is asked, because nothing is weakened.

**When the key cannot be read (8b.4)** the page says so in three places (the section in Settings, with an alert; the History dialog; and, after the first message, the "Not saved" badge, whose title carries the sentence), saves nothing (the reply is on screen, and the chat is saved when the way out is taken: "Not saved", then retry), changes no file, and offers only
"Turn encryption off...". **The ways out, proved end to end on this PC's real secure storage:** (a) **Restore from the backup** made when encryption was turned on: the six sealed files cannot be opened, so each chat in the backup is added as a _copy under a new id_ (D-034's rule for "a damaged file under that id"), after encryption is turned off (a restore is refused while writing is refused); the old
sealed files are left exactly as they are, counted ("N saved files could not be read ... N of them are encrypted and could not be opened with this computer's key"); (b) **turning encryption off** while the key is lost changes only the choice (nothing can be turned back); (c) **if the key comes back** (the original `Local State` put back), the old files open again, nothing was lost, and "Turn the encrypted chats back to plain files" gives
the very bytes that were seeded. **What the backup covers is the chats at the moment it was made**: a chat written after it is lost with the key. **A damaged choice file** is handled the same way on screen (launch 5): nothing is saved and no file changes until the person chooses again; "Use plain files..." was checked on screen, and "Encrypt my saved chats..." (which writes the choice file afresh the same way) under Node.

**What the work found.**

1. **A plain copy could hide behind a newer encrypted one (found while writing the tests, before the first run).** If a conversion's copy step fails, the chat is left with a plain real file and a whole encrypted `.tmp`, and D-016's recovery rule reads the `.tmp`, so the chat looked encrypted while its plain text stayed on disk. Fixed in two ways, each with a control: a chat's form is "plain" if **any** readable copy is plain (the count says "not encrypted yet"), and **a leftover `.tmp` always forces a rewrite**, which removes it (a cut-off one can hold part of a chat as text).
2. **The first version read files it should have refused.** I let the early size check use the sealed limit (about 14 MB) for every file, so an 11 MB plain file was read before being refused; `verify-4-1`'s "its content was never read" check caught it. Now a file between the two limits is looked at by its first 35 bytes only, and read only if it begins like a sealed chat.
3. **What the secure storage really does when its key is lost, on this PC.** Deleting a scratch profile's `Local State` while the app is not running (a real reset profile) leaves the secure storage _working_ (`canEncrypt` true) with a **different key**: `decryptString` throws on every blob made before. I had not assumed which of the two (unavailable, or a different key) it would be; the check catches the second, and the rule for the first is tested with a stand-in. "Another Windows account" (DPAPI that cannot unwrap the key) was not made.
4. **My own layout fault, and a wrong guess about it.** The notice after turning encryption on names the place of the backup, a long path with no spaces; it widened the Settings dialog at 320 and 280 px. The first check measured the whole dialog and I guessed the cause was the spending-limits form of 8.2; a probe on a fresh profile showed the dialog was fine without my notice. Fixed with `overflow-wrap: anywhere`; the check now measures the section and the dialog's horizontal scrollbar separately. The buttons got `height: auto` for the same reason (`.button` is a fixed 36 px and the labels are long).
5. **A longer hint cost the History list a line**, so six rows no longer fit in a 634 px window and `verify-4-3a` clicked the paragraph under the list instead of the last row (proved with `elementFromPoint`). The list scrolls, so it was the harness: `H.clickRow` and `clickRowButton` now scroll the row into view.
6. **Stale checks, none because the app was wrong:** `verify-4-2` (the bridge's exact list: three more functions), `verify-8b-2` (the count of handlers that open a dialog: four now), `verify-5-3` (the count of the Settings dialog's action buttons: seven now; found by the full regression), and **seven negative-control specs** whose sabotage text my edits moved (four of Stage 4, three of 8b), repointed at the new text (what each sabotage means is unchanged).
7. **Four controls were not caught the first time, and each miss was read** (51 of 55 in the first pass of the plain-Node batch): one was **dead code** (`data.length === 0` in the reader, which the base64 pattern already refuses: removed, and its control with it); the other three were gaps in the CHECKS, not in the app: the reason a malformed envelope is refused was not looked at (a too-long `data` was still refused, but as a key that does not open it); a conversion that rewrote a plain chat while writing was refused was reported as "failed" by accident (its post-write proof happened to fail), so the test now looks for **any file write in the chat folder**; and the "a save is not kept waiting" test queued its save before the conversion began, so it passed even with the whole conversion in one turn (it now asks while three chats are already sealed).

**What was checked.** `verify-8b-3.mjs` under plain Node, with a stand-in secure storage that can lose its key (`lib8b3.mjs`), in a normal folder and in this PC's EFS-encrypted data folder: **276 checks** (154 in the normal folder alone, which the controls use). It covers: the envelope (nothing readable in it; each malformed envelope refused as a format this version cannot read; a flipped character refused as a key that does not open it; the sizes); the choice and every kind of damage to it (fifteen shapes, a folder in its place, a locked file), each a refusal that is never plain and never encrypted, and the person's own choice replacing a damaged file in either direction; a lost key, a missing storage, and **the secure storage never asked to encrypt while writing is refused (counted)**; turning it on with a storage that does not work, that gives the wrong text back, or with a file that does not read back; the store (12 chats turned on, off and on again, **byte for byte what they were**; version 1 and 2 files; saves, restores and conversions obey the rule; a storage that hands back garbage never leaves a half-sealed chat; sealed files that cannot be opened are left alone and counted; a plain copy never hides behind an encrypted `.tmp`; two failing copies in the middle of a conversion and the pass that finishes it; a save asked for while 80 chats are being converted comes back before the conversion ends; the sizes, with a 2000-byte limit); the flow (the backup asked for first, and when it was asked nothing had changed; cancel; a backup that cannot be made or is inside the data folder; one thing at a time; the question; **the lost key end to end, with no file written in the chat folder at all while writing is refused**, the way out through the backup, and the key coming back; no secure storage; a conversion cut short and finished; no chats at all); and 12 source checks. **`run8b3.mjs` in the real window, on this PC's real secure storage: 87 checks in five launches, on the dev app and on the built one** (40 + 8 + 20 + 9 + 10 each): (1) turning it on (the save dialog asked first, with the profile unchanged at that moment; the buttons off while it is open; what is on disk: envelopes, not a readable word, a setting with a check; History lists and opens sealed chats; a message is saved sealed; what the page can and cannot do through the bridge; "Keep encryption"; going back; on again; the section down to 280 px with no sideways scroll), (2) a restart (nothing is rewritten at start), (3) **a real lost key** (the profile's `Local State` deleted while the app is not running: the secure storage works with a different key, the app says so, saves nothing, writes nothing, and the ways out through the backup and through turning encryption off are taken), (4) **the original key put back** (the six sealed chats open again and go back to the very bytes that were seeded), (5) the choice's own file damaged. **Negative controls: 54 for the plain-Node suite (`specs8b3`) and 22 for the window suite (`specs8b3w`), every one caught, each file put back (proved by hash; `src/` and `registry/` identical after each batch).** Three of the Node ones were not caught the first time and a fourth was dead code (finding 7); the others were caught in the first pass, on a suite with three fewer checks, and were not run again. **Re-run on the final tree:** `verify-4-1` 389, `verify-5-3-store` 174, `verify-5-4-store` 108, `verify-8b-1` 129, `verify-8b-2` 131 (quick mode), the three Stage 8 Node suites (194, 215, 288), the 8b window suite 68 of 68, and the Stage 4 history suites 7 of 7 runs clean. **The full regression (8b.5, `t8b3`, 5 to 6 October 2026): 96 runs in 79 minutes, 94 clean.** The two others are one stale
check, on the dev app and on the built one: `verify-5-3` counts the Settings dialog's action buttons at 420 and 320 px and expected six; "Encrypt my saved chats..." is the seventh, and the same check found no sideways scroll and every
button inside the dialog. The count is now seven, and the two launches were run again: 66 of 66 on each. `src/` and `registry/` had the same hash before and after the run; no launch was retried or slowed. The built app's 8.1 suite (item 13 below) passed this time (81 of 81).

**Threat note (8b.3 and 8b.4; the notes for 8b.1 and 8b.2 are in D-034).**

- _What could go wrong, and what stops it._ **Chats left readable on disk after "encrypt":** every readable copy is rewritten, a plain copy behind a newer encrypted one counts as plain, a leftover `.tmp` is rewritten and removed, and the section counts what is still plain; proved with failing copies and a cut-off plain `.tmp`.
  **The key is lost and the chats with it:** a backup is made and checked first, in a place the person chose, and nothing happens without it; a lost key is seen by the check before any write; the ways out were proved on the real storage. **A silent downgrade to plain:** a damaged choice, a lost key and a missing storage all refuse; going back to plain needs a yes in the system's own message box, which the page cannot answer (the bridge sends no argument; a source check and a control hold that).
  **A new key behind the owner's back:** the secure storage is asked to encrypt only when the person turns encryption on and by a write the check allowed; counters in the tests show it is not asked once while writing is refused, and a spy shows no file is written in the chat folder either. **A page that turns encryption on, or asks to go back, in a loop:** one dialog at a time (the lock), modal to the window, each cancellable (the save dialog, or the message box with "Keep encryption" as its default); with everything already sealed, turning it on answers at once with no dialog.
  **A damaged or foreign sealed file:** left as it is and counted (never deleted, never written over); its id must be its name; a flipped character, another version and a cut-off file are each refused with a reason; a file's size is looked at before it is read.
- _What is left._ **The secure storage does not protect against a program running as the person** (it can ask the same storage to open the chats) **and not against the page**, which can read every chat through the bridge (D-033 still holds: the page can lift the limits). **A backup is a plain file** (the dialog says so), as is the usage ledger (counts, times and ids; no message text). **Old plain text may linger on the disk**: a rewrite in place does not wipe what a
  solid-state disk, EFS, a shadow copy or the file system's journal kept; encryption protects what is written from now on (IDEAS). **A single damaged sealed file looks like a lost key for that one file**, and the app cannot tell which; the check says whether the key as a whole is usable. **The person at the keyboard** can do anything, including delete the choice file (then the choice is "off" and the section says how many chats are still encrypted).
  **The sealed files show how many chats there are and when each was written** (names, sizes, dates).
- _Rule 9 (crash-safe and local, readable by the owner)._ Chats are plain files the owner can read, export and delete, **or** sealed ones the owner turned on knowingly, with a verified backup first and a way back; every write is the three steps of D-016 and proved by opening it; nothing here deletes a chat.

**Not checked.** (1) **The real Windows dialogs** (the save dialog for the backup, the message box for going back) were replaced from main's inspector: what is proved is what the app asks of them (modal to the window, title, file name and type, "Keep encryption" as default and Escape answer), not how they look or what Windows does with them (since run once for real, after the merge: see below). (2) **Your own profile and chats**: only scratch profiles (since run once on the owner's profile, after the merge: see below). (3) **"Another Windows account"** (DPAPI that cannot unwrap the key) and a corrupted key container: the lost key was
a deleted `Local State` (a reset profile), undone by putting the copy back; macOS's Keychain and Linux's secret service were not run (the code treats Linux's `basic_text` fallback as "no secure storage", as for keys). (4) **The "no secure storage" state on screen**: the service answers with a sentence under Node; the section's disabled button and hint were not seen, because this PC has the storage. (5) **Quitting while a conversion runs** (the quit waits at most 5 s; each chat is written whole, and a cut-off conversion is a state the page shows and "Encrypt the rest" finishes):
reasoned, and the cut state was made with disk faults, but not by quitting. (6) **Two copies of the app at once**, and a folder changed by another program during a conversion (the late file is tested under Node). (7) **The time of a conversion of 1000 chats**: the restore of D-034 took 109 s in this PC's EFS data folder and a conversion does the same four file steps per chat plus one encryption; 80 chats were converted under Node, 5 in the window. (8) **Old plain bytes lingering on the disk** after encrypting: not looked for. (9) **The built app is `electron-vite preview`, not the installer**; systems other than
Windows. (10) **A key that changes and comes back** is not told from one that never changed (the check opens in both), and one damaged sealed file cannot be told from a lost key for that file. (11) **A screen reader, the Tab order through the new section, other display scales, a right-to-left language.** (12) **A real API call** (never made). (13) **The built app's Stage 8.1 suite** (D-034, item 10) is as it was: intermittently short on this PC, on `main` too, cause unknown (it passed in the full regression of 8b.5).

**Decisions that are mine and may be changed** (the owner left the design to me): the secure storage per file (not a key of my own, not one file for all chats); the backup is **always fresh** when encryption is turned on or finished (even if an older backup exists) and is a plain file; the damaged choice file **refuses** to save until the person chooses (fail closed, like `limits.json`) instead of defaulting to plain; going back to plain is asked in the **system's** message box (D-033's recommendation, applied
here); with encryption on and the key unusable the only button is "Turn encryption off..." (nothing can be encrypted until the key is usable or the choice is changed).

**After the merge (6 October 2026): the owner's own profile, the real Windows dialogs, and the wording.** At the owner's request ("Why don't you do it", then "You do. Just don't mess with anything else in my desktop") I ran
the whole flow once on the owner's real profile (one chat, a version 2 file), after a byte copy of the chat folder: the page driven from the debug port, and the **real** dialogs read and answered with `tools/real-dialogs.ps1` (Windows' UI Automation
reads the dialog; window messages go to that dialog's own controls; no mouse, no keyboard, nothing else on the desktop). What it showed: the save dialog ("Back up chats", in Documents, `frontier-chats-2026-10-06.jsonl`, "Frontier chat backup (\*.jsonl)") wrote a backup that the app read back and
matched, and my own reading of it agreed (the chat as the app reads it: version 3, an empty `instructions`); the open dialog ("Restore chats from a backup") gave a preview with "1 chat already here" and nothing to add; "Encrypt my saved chats..." asked first in a save dialog titled "Back up your chats before they are encrypted", and **while it was open nothing had changed**;
then the chat file was an envelope with none of the chat's words in it, `chat-encryption.json` held a check, and History opened the six messages; **after a restart the profile's own key opened it** ("key usable"); the message box showed the warning sign, "1 chat will be rewritten as plain files." and "Keep encryption" as the default; its Escape answer (IDCANCEL) and "Keep encryption" both kept
encryption with the file unchanged, and "Go back to plain files" rewrote the chat as plain (version 3, the same content). Afterwards, with the app closed, the original file was put back byte for byte, and the test backups and the copy were deleted; the profile keeps `chat-encryption.json` saying off (the same as no file). The limits question that a profile with no `limits.json` shows at start was closed with "Not now" (nothing written).
The owner's own copy of the app was running when I first started mine (two copies of one profile, which nothing tests): I closed mine at once, and later theirs through its window, after they chose that I do the test. **What it found: the wording.** With one chat the question said "1 chat will be rewritten as plain files" and "read them", the notice "Rewrote 1 chat as plain files", the restore preview
"1 chat already here, left as they are"; and, found by reading the code for the same fault, the restore notice the same way, "1 chat new, to be added as they are", "1 chat share an id ... as copies", and with two or more "2 of these chats have instructions of its own". Fixed (`chatEncryptionService.ts`, `useChatStorage.ts`, `useBackup.ts`, `RestorePreviewPanel.tsx`); every plural sentence is byte for byte what it was. **Checked by** `verify-8b-wording.mjs` under plain Node (15 checks: the question, the two notices, and the
restore preview panel rendered to text by React's server renderer after esbuild turns its JSX into JavaScript, at 0, 1 and 2 chats; on the old code 7 of them fail and the 8 plural ones pass, which is the proof that the plural sentences did not change), and **13 negative controls** (`specs8bw`), every one caught, each file put back (hash). The two 8b window suites were run again on the dev app with the new wording: 68 of 68 and 87 of 87 (five launches). What this does not prove: how the dialogs look with other Windows settings, a screen reader,
another account; the built app was not run again for the wording.

Status: accepted (8b.3, 8b.4 and 8b.5; the full regression: 94 of 96 runs clean, the two others one stale check, fixed and passed again; after the merge, the owner's own profile with the real dialogs, and the count wording fixed). Revisit: another Windows account for real; a password-based key for chats that must open elsewhere; a progress line for a long conversion; where old plain bytes may linger (IDEAS).

## D-036 - Claude Haiku 4.5 removed from the registry ahead of its retirement

The project's notes from the documentation read on 2026-10-01 say Claude Haiku 4.5 may be retired from 2026-10-15. **The owner asked on 6 October 2026: "Remove the haiku 4.5".**

**What changed.** `registry/models.json` lists six models: Claude Fable 5.1, Opus 5.5 (the default) and Sonnet 5.5, and OpenAI's GPT-6 Astra, GPT-6.1 Sol and GPT-6 Luna. `registry/rankings.json` loses Haiku's only row, the one for "Quick answer", which now says
"No suggestion for quick answer" (the page's own empty case: nothing is guessed). **Both files keep their `updatedAt` and `source`**: no fact was read again, and the tests define `updatedAt` as the day the facts were checked. (My first edit added a note to the registry's `source`; reading the validator
before running anything showed the line is capped at 300 characters, which the note passed, so the whole registry would have been refused as "Models unavailable". The removal is recorded here instead.) **No code changed** apart from four comments that named Haiku as the example of a model with no effort setting.

**What happens to what people already have.**

- **A saved choice of Haiku 4.5**: the default, Opus 5.5, is shown, and the log says "The saved model ... is not in the registry any more, so the default is used" (D-015). The file keeps the saved id until the person chooses a model, and a level saved for Haiku is kept as well. New seeds check both: `retired-haiku` (`verify-3-5`) and `eff-retired-model-has-a-level` (`verify-7-1c`).
- **Saved chats with replies from Haiku** open as before; the caption above such a reply shows the id `claude-haiku-4-5-20251001` instead of the name (D-021's rule for a model the registry no longer lists).
- **The usage ledger** keeps the prices each record was written with (D-030), so past costs do not change. Backups (D-034) and encrypted chats (D-035) hold text and are not affected.
- **The owner's own profile** has Sonnet 5.5 chosen, so nothing changes there.

**A model with no effort setting** (the page hides the Effort menu, main sends no effort, D-024) stays in the code for a model that may come. With no such model in the registry it cannot be reached in the window any more; it is checked under Node against the fixed registry, `tools/registry-good.json`, which keeps Haiku's last entry and must otherwise hold every live entry unchanged (a check in `verify-7-1`). The mock still knows Haiku 4.5: it imitates the provider, which serves the model until it retires, not the registry.

**The tests.** Every check that took Haiku from the live registry now uses a listed model with the same meaning: Fable as the valid saved choice, the choice left for the restart test (`verify-3-4b`) and the entry the registry scenarios break (with the same faults: an effort set with no levels, an unknown provider); Sonnet's id inside the damaged preference files (wrong case, wrong version, a byte-order mark, an object), so each still tests what it did; Opus and Sonnet for the switches in the middle of a reply and of a chat; and the counts (seven models, four Anthropic ones, the prices, the large-request thresholds) say six. **Found on the way:** the regression reused a seed manifest whenever one existed, so it would have run the old seeds; it now rewrites them for every run, as `run71.mjs` already did.

**The full regression: 97 runs, 94 clean the first time** (`h45`, 66 runs, stopped after the registry scenarios when the session that had started it ended; `h45b`, the rest as a process of its own: 31 of 31). The three others: two more stale counts (`verify-5-3` expected at least seven models, `verify-6-3` exactly seven;
both now read the registry's count) and, in `verify-7-4w`, the Edit-and-send-again check while the window watcher logged eight keyboard or mouse inputs in 16 seconds; all three passed when run again alone (66/66, 6/6 and 7/7 with 6-2's 27/27, 84/84). `verify-5-5`'s "the OpenAI ones last" had become blind to GPT-6 Astra (it began at the fifth model): fixed and run again (53/53). `src/` and `registry/` had the same hash before and after.

Status: accepted. Revisit: a documented model for "Quick answer" (IDEAS); a "retires on" field in the registry (IDEAS).

## D-037 - Stage 9: images and files in. 9.1: the attachment store: a file is checked by its bytes, copied into the app's data folder under its hash, stripped of image metadata, capped, sealed like the chats, and deleted only when nothing uses it

The plan is in ROADMAP (Stage 9). **The owner approved it on 6 October 2026 and answered its five questions with "your picks"**, so: (1) image metadata is **always** removed; (2) a PDF goes **as it is**, its metadata included, and the chip says so (removing it needs a PDF library, a new dependency); (3) the caps are mine, checked against the providers' own pages (below); (4) a big image is **made smaller** before it is kept; (5) backups will **hold the attachments** (9.5). This entry grows slice by slice; 9.1 is the store in the main process, with no window.

**The providers' own pages, read on 6 October 2026** (platform.claude.com, "Vision" and "PDF support"; developers.openai.com, "Images and vision" and "File inputs"). Anthropic: JPEG, PNG, GIF and WebP; at most 8000 x 8000 px and 10 MB (base64) an image on the API; when a request holds more than 20 images, **every** image in it must be at most 2000 px a side (earlier turns count, since the whole conversation is sent again); a request of at most 32 MB; PDFs of at most 100 pages in a request to a model whose context window is under 1M tokens (600 otherwise), each page billed as its text (1,500 to 3,000 tokens) and as an image; an animation's first frame only; "Claude does not parse or receive any metadata". OpenAI: PNG, JPEG, WebP and **non-animated** GIF; up to 1,500 images and 512 MB a request; files of at most 50 MB each and 50 MB together a request; a PDF is read as its text and an image of each page.

**The caps that follow** (`ATTACHMENT_LIMITS`, `src/shared/attachments.ts`), each below both providers' limits so that the app never sends a request either refuses for its size: **an image is sent at most 2000 px on its longer side** (a bigger PNG or JPEG is made smaller to that; this is the plan's 8000 lowered, because a chat with more than 20 images would otherwise be refused by Anthropic), and its header may say at most 8000 a side and 40 million pixels (refused before anything decodes it); a PNG or JPEG may come in at up to 20 MB and is kept at most 5 MB; a GIF or WebP is sent as it is, so it must come in at most 5 MB and 2000 px a side; a PDF at most 10 MB and 100 pages; a text file at most 200,000 characters (one message's limit) and 1 MB; **10 files a message and 50 a chat; 20 MB of attachments and 100 PDF pages in one request** (20 MB becomes about 27 MB as base64, under Anthropic's 32 MB with the text); **the folder at most 5,000 files and 2 GB**, and a full folder refuses a new file with a sentence: nothing is ever deleted to make room. **Animated images are refused** (OpenAI takes none; Anthropic would read one frame), with a sentence.

**What a file is comes from its bytes** (`src/main/attachmentFormats.ts`, plain functions on a Buffer, no package): PNG, JPEG, GIF, WebP and PDF by their first bytes (a PDF's `%PDF-` must be at byte 0), and anything else is text only if it is valid UTF-8 with no control character but tab, line feed and carriage return (a byte-order mark is dropped). The name never decides anything: a PNG named `invoice.pdf` is an image. **An image's size is read from its header before anything decodes it** (a 9000 x 9000 PNG with a few bytes of picture, "a decompression bomb", is refused unread), with whether it is animated (APNG's `acTL`, a GIF of more than one picture, WebP's animation flag or frames) and its EXIF orientation. Every reader is bounded by the buffer and answers a result, never an exception: checked by cutting each kind at every length and changing every byte.

**Metadata is taken out by rewriting the bytes, nothing decoded.** A JPEG keeps only its picture and what decoders need (JFIF without its thumbnail, the ICC colour profile, Adobe's colour transform); EXIF (where a phone keeps the place a photo was taken), XMP, IPTC and Photoshop data, comments, the extra pictures of MPF and **everything after the end of the picture** (a phone's "motion photo" keeps a video there) go. A PNG keeps the chunks that draw it and its colours; text (`tEXt`, `zTXt`, `iTXt` with XMP), EXIF, its time and private chunks go. A GIF loses comments and application blocks (XMP, the loop setting); a WebP loses EXIF, XMP and unknown chunks, and its header's flags are put right. The picture's own bytes are untouched (the scan of a JPEG, a PNG's `IDAT`, byte for byte), and **with Electron's decoder the stripped JPEG and PNG decode to exactly the same pixels**. The chip will say "metadata removed" only when there was some.

**Made smaller and turned upright with Electron's own `nativeImage`** (`src/main/attachmentImages.ts`; no package). What it does was **measured on Electron 44, not assumed**: it decodes PNG and JPEG and **not GIF or WebP** (so those are never given to it: they go as they are, which is why their caps are lower); it **does not apply a photo's EXIF orientation** (a JPEG marked "turn 90 degrees" decodes as stored), so taking the EXIF out would have left phone photos lying on their side: a photo with an orientation other than 1 is re-encoded **turned** (the eight orientations of EXIF are moved pixel by pixel by `orientBitmap`, a pure function); and it writes no metadata. A PNG or JPEG is re-encoded only when it must be (over 2000 px, turned, or over 5 MB once stripped); a PNG that is still too heavy and has no transparency becomes a JPEG ("converted from PNG" on the chip); one with transparency stays a PNG and is made smaller until it fits, or is refused. **What the image tools make is checked like a new file** (its type, its header, no "turn me" left, no larger than the original, the shape of the original as it is meant to be seen, at most 5 MB), and its metadata is taken out again. A picture whose header is fine but which does not decode, or decodes to another size, is refused.

**PDFs** are counted, not rendered: the largest `/Count` of a `/Type /Pages` dictionary, in the file and inside its compressed object streams (unpacked with Node's zlib, **at most 64 MB in all**, so a zip bomb stops there: 200 MB of zeros cost under 150 MB of memory), or else the `/Type /Page` objects. **This is a reading of the file's structure, not a renderer**: a damaged or unusual PDF can be counted wrong, and the provider has the last word. A PDF with a password (`/Encrypt`) is refused (neither provider reads one), and so is one with no `%%EOF` (cut off) and one whose pages cannot be counted.

**Names** (`cleanFileName`): the last part of what was given (never a folder), white space as one space, no control characters and **no characters that reverse the direction of text** (which make `invoice[RLO]gnp.exe` read as `invoiceexe.png`), at most 200 characters (by character), else a name from the type ("image.png" for a pasted image).

**A file the person chose** (`readLocalFile`, for 9.2's open dialog, which main opens: the page never names a path): only `X:\...` on this computer; a network share, `\\?\` and `\\.\` paths, a relative path, an alternate data stream (`file:stream`), a folder and **a file that is itself a link** (a symbolic link or a junction) are refused, not followed; the real place is checked again (a mapped network drive resolves to `\\server\share` and is refused); the size is looked at before reading, and **not one byte of a file over the cap is read** (counted). Links in the middle of a path (a folder that is a junction) are followed, as Windows itself does.

**The folder** (`src/main/attachmentStore.ts`, no Electron imports: the image tools and the secure storage are handed in). A copy is named by the **SHA-256 of what is kept** (64 lower-case hex characters, no extension), so the same picture is kept once (with its metadata gone, two copies of a photo that differ only in EXIF are one file), and **every read checks the hash**: a copy with one changed byte is "damaged" and never handed out, and adding the same file again writes it anew. It is written like a chat (D-016; never renamed, D-010): `<id>.tmp` written and read back, copied over `<id>` and read back, the `.tmp` removed; a whole `.tmp` is used if the copy is damaged. A file bigger than any copy may be is not read. **Sealed when the chats are** (D-035): the store asks `chatProtection.writeMode()` before every write, like the chat store; a sealed copy is a first line (`FRONTIER-SEALED-ATTACHMENT-1`) and what the secure storage made of the file, its name still the hash of the file itself (checked after opening, so a secure storage that hands back other bytes is caught); while writing is refused (a lost key) nothing is written and the secure storage is never asked to encrypt; with the key lost a sealed copy is "unopened" and left as it is; `conform()` rewrites every copy in the current form, one per turn, and removes a plain `.tmp` left beside a sealed copy. A plain text file that happens to begin like a sealed copy is still read as what it is (its hash is its name).

**Nothing is deleted but by two calls**, both of which skip what a saved chat uses and what was attached in this run and not taken off (`hold`): `deleteUnused` (the chat that used a file was deleted; the person took a file off a message) and `sweep` (at start: copies no chat uses and older than an hour, left by a message that was never sent; its caller must know every chat, so with an unreadable chat nothing is swept). Files in the folder that are not copies are never touched. (Wiring these to the chats comes with 9.3.)

**What was checked.** `verify-9-1.mjs` under plain Node, in a normal folder and in this PC's EFS-encrypted `%APPDATA%`: **185 checks** (146 in the normal folder alone, which the controls use): the first bytes of real files (`tools/fixtures9/`, made by Electron's own encoders and Chromium's print: a JPEG, PNGs, three WebPs, PDFs of 3 and 101 pages) and made ones; headers, every cut length and every changed byte of each image kind; EXIF in both byte orders, and a SHORT tag that is not the orientation; metadata out of each kind with the picture's bytes untouched; PDFs (plain, object streams, no `/Count`, a password, cut off, uncountable, a 200 MB zip bomb, every changed byte); text (twelve kinds of not-text); `prepare` with stand-in image tools that count their calls (every cap at its edge and one over, **nothing decoded for an image refused by its header**, shrinking, turning, both at once, what the tools make checked against seven misbehaviours, names, ids); `readLocalFile` (twelve refused paths, a junction, a file over the cap with its reads counted); the folder (hash names, the same file once, damage found and rewritten, a `.tmp` used and a cut one not, four disk faults, both caps, hold, `deleteUnused`, `sweep` with a clock); sealed copies (sealed, read back, conform both ways byte for byte, refused while writing is refused with the encryptions counted, a lost key, no storage, a changed byte, a storage that lies twice, a text that begins like a sealed copy, a store with no storage, a lingering `.tmp`); five source checks. `run91.mjs` with **Electron's real `nativeImage`** (an Electron main script with no window, the modules bundled by esbuild): **14 checks**, among them the eight EXIF orientations each upright (the colours of four quadrants where a person sees them), 3000 x 2000 to 2000 x 1333, a 6000 x 4000 photo held sideways in 0.7 s, a 9.3 MB PNG of noise to a JPEG, an 8 MB one with transparency to a smaller PNG, the same pixels after the metadata goes, the thumbnail, a damaged PNG refused. **Negative controls: 73 for the Node suite (`specs91`) and 6 for the Electron one (`specs91e`), all caught in the end, each file put back (hash; `src/` and `registry/` identical after the batch).** Five of the Node ones were not caught at first, and each miss was read: four were **blind checks** (any SHORT tag taken for the orientation: my EXIF had no other SHORT; the hash after opening a sealed copy: my lying storage handed back text that failed an earlier test; a damaged copy taken for "already": the sabotage left a second guard; the WebP animation flag: my animated WebP had both the flag and the frames), each now has a check that fails with the sabotage; the fifth is **two layers by design** (a copy for "encrypted" with no secure storage is stopped by an explicit refusal and again by the proof after the write), and its control now removes both.

**Not checked (9.1).** No window yet: the dialog, paste and drop, the chips (9.2); sending and saving (9.3); costs (9.4); backups (9.5). A **real mapped network drive** (the rule that its real path is `\\server\...` is Windows' and Node's, not seen here; the string forms are checked). A CMYK JPEG, a 16-bit or interlaced PNG through `nativeImage` (Chromium's decoder; not tried). **PDF page counts** of unusual files (only Chromium's own PDFs and hand-made ones). A real provider reading what the app makes (no real API call, as always).

**9.2: getting files in.** **"Attach..."** is the first button of the chat bar under the message box. Unlike New chat, History and Instructions it stays on while a reply arrives (the next message can be written meanwhile, files included); it is off while main is working on files, and when the message already carries ten. It asks main to open the system's **open dialog** (`pickAttachmentPaths`, in `backupDialogs.ts`, still the one file that opens dialogs), modal to the window that asked (`guardedForWindow`), titled "Attach files", several files at once, **one filter, "All files"**: a text file can have any extension, and what a file is comes from its bytes. Main reads each chosen file with `readLocalFile` (9.1) and keeps it with the store; at most ten a time, and one dialog at a time (`attachmentService.ts`, no Electron imports). The page learns what was kept and, for each file that was not, one sentence that names it (never its folder) and says why.

**Pasting and dropping hand main the bytes, never a path.** An image pasted into the message box is attached, not typed; **when the clipboard also holds text** (copied cells of a spreadsheet carry a picture of them too) **the text is pasted and nothing is attached**, so a copy never sends a picture by surprise. A file dropped on the chat is read by the page (`File.arrayBuffer`) and handed over with its name; the page never asks for a dropped file's place on disk (no `webUtils`), and the window itself takes no drop outside the chat. The bridge has exactly three functions: `pick()` (it takes nothing), `addBytes(name, bytes)` (`checkAttachmentBytes`: only a name of at most 1,000 characters, which is a label, and a `Uint8Array` of at most 20 MB, looked at before anything is copied; the exact bytes of a view into a bigger buffer) and `discard(id)` (the person took a file off the message: main stops holding it and deletes its copy if no saved chat uses it; when that cannot be known, nothing is deleted).

**The chips** (`AttachmentChips.tsx`, words in `attachmentText.ts`): above the message box, one per file, with a small picture made by main (a PNG data URL for a PNG or JPEG; the file itself for a GIF or WebP, which the page's own decoder draws; the page's policy already allows `data:` pictures), or "PDF" / "TXT"; the name (cut with "..." when long, whole in the tooltip, with a text's first five lines); what it is ("JPEG image, 32 x 64, 501 bytes", "PDF, 3 pages, 22 KB", "Text, 9 lines"); what was done to it ("metadata removed; made smaller from 4,032 x 3,024; turned upright; a JPEG image made from a PNG image"), and for a PDF "sent as it is, with any metadata it holds"; and a button "Remove <name>". Under them, **where they go** (rule 1): "These files go to Anthropic with this message, and again with each later message of this chat." (the provider of the model that will answer; the whole conversation is sent again each time, D-028). Refusals show as one sentence each, as an alert. Until 9.3, Send waits while files are on the message and says so.

**What the real Windows dialog showed (run once on a scratch profile, `verify-9-2-real.mjs`, driven by `tools/real-dialogs.ps1` with window messages only).** The dialog is titled "Attach files", has a file name box and an Open button, takes one file by its full path and two at once by Windows' own syntax (names in quotes) and both became chips. **It found a real fault**: with "All files" first and "Images" second in the list of filters, Windows opened the dialog on "Images", which would have hidden every PDF and text file from a person browsing; most likely Windows reuses the filter position of an earlier dialog of this program (not proven). The dialog now has one filter, and the real dialog opens on "All files (\*.\*)". **The run's first screenshot showed the owner's own Downloads folder** (the folder Windows remembered), so it was deleted at once and the script takes no screenshot of the dialog any more; `real-dialogs.ps1` gained `cancel` and `filetype` (which reads only the file type box).

**Found on the way.** Electron 44's clipboard in the main process is the web's asynchronous one (`clipboard.write([new ClipboardItem(...)])`; `writeImage` is gone): only the tests write the clipboard. DevTools' `Input.dispatchDragEvent` with a real path is taken by Chromium as a drop of a file from Windows (the page gets the bytes), so a real drop is tested too.

**Older checks that went stale, none because the app was wrong:** `verify-4-2` (the bridge's exact functions: `attachments` added; the chat bar read by position: it filters out Attach...; six controls at 420 and 320 px, not five), `verify-7-6w` (the three buttons of 7.6 are filtered the same way; Tab from Send now goes to Attach... first), `verify-8b-2` (five handlers open a dialog now, not four), and **four negative-control specs** whose text my edits moved (`w76-bar-first-in-the-tab-order`, `n8b-ipc-quit-not-waiting`, `w8b3-ipc-store-no-box`, `w8b3-ipc-store-no-writemode`): each repointed to the new text with the same meaning, and each run again: all caught.

**What was checked.** `verify-9-2.mjs` under plain Node, **30 checks**: the service with a played dialog and a real store (kept and refused files, the sentences, no path in any answer, ten at a time, a closed dialog, one dialog at a time, raced so that a missing lock fails instead of hanging), `addBytes` against twelve kinds of junk and a file over the cap, a view into a bigger buffer, `discard` with a chat that uses the file, with none, with junk, and when the chats cannot be known; the words of a chip; eight source checks. `verify-9-2w.mjs` in the real window, **36 checks, on the dev app and on the built one**: the button, three files from the (replaced) dialog with what the dialog was asked (modal, title, several files, the one filter), each chip and its notes, the place they go, no path on screen, three copies named by their hash with no EXIF in the photo's, the originals untouched, Send waiting, taking one off (its copy deleted), four refusals, twelve files with two already on the message (ten kept, both sentences, Attach... off, the extra copies deleted), a closed dialog, a made paste, a paste that also carries text, **a real paste of an image through the system clipboard**, a made drop and **a drop of a real file**, the bridge refusing junk, the layout at 320 and 280 px (chips wrap, at least 150 px wide), no console errors. `verify-9-2-real.mjs` with the real dialog: 6 checks. **Negative controls: 20 for the Node suite (`specs92`) and 13 for the window suite (`specs92w`), all caught in the end, each file put back (hash).** Three were not caught the first time, each read: the lock test **hung** instead of failing (it now races the second pick against a timer); a drop was accepted by **two layers** (the chat and the whole window), so removing the chat's changed nothing: the window no longer accepts drops at all, which is also better for the person (a drop outside the chat now shows that it does nothing); and the line saying where files go was read with `textContent`, which a hidden line still has (it now asks whether the line is shown).

**Not checked (9.2).** A screen reader; the keyboard alone through the chips (each × is a button in the Tab order, not walked); a paste from another program's real clipboard formats (only an image written by Electron); a drop from Windows Explorer itself (the drag was DevTools'); Windows dialogs with other settings or another account.

**9.3: sending and saving files.** **A request names its files, never their bytes or a path**: a message of the person's may carry `attachments`, a list of `{ id, name }` (`checkWireAttachments`: at most ten, each id the spelling of a copy's name and named once, the name cleaned like any file name; an empty list is the same as none; a reply never carries files); a message may be only files; a conversation may name at most **50 different files** ("This chat has more than 50 files, which is too many to send. Start a new chat."). **Main reads every copy again for every request** (`src/main/attachmentRequest.ts`, no Electron imports; the whole chat is sent again with each message, D-028), through the store, which checks each copy against its hash, and nothing is sent, with one sentence, when: a copy is missing, damaged or cannot be opened ("Nothing was sent: the file "notes.md" in this chat is no longer in the app's data folder."); the model chosen cannot read a kind of file the chat holds ("Nothing was sent: GPT-6 Luna cannot read images, and this chat has one ("diagram.png"). Choose a model that can."); or the chat's files pass the caps of one request (20 MB, 100 PDF pages, and **600,000 characters of text files**, as much again as the conversation's own text may be; each sentence says that every file of a chat goes with every message, so a new chat is the way to send more). The same check returns what the files come to (images by size, PDF pages, text characters, bytes) for 9.4's cost guess.

**The registry says which models read PDFs** (schema 0.5: `documentInput` beside `imageInput`; all six models read both, per the providers' pages read on 6 October 2026), and the page is told both flags. **The page says it first**: with a kind of file in the chat (on any message: they are all sent again) that the chosen model cannot read, Send is off and the reason is written under the message box and in Send's tooltip, naming the model; a page that sends anyway is refused by main with the sentence above, and nothing reaches the provider. With every model in today's registry reading everything, this is seen only in the window suite's run with a changed registry.

**Each provider's own form** (`anthropic.ts`, `openai.ts`), the files before the words (Anthropic's guide: a picture or a document before the question reads best): Anthropic gets an `image` block (base64, its type), a PDF as a `document` block of base64 titled with its name, a text file as a `document` block of plain text titled with its name, then a `text` block if there are words (none for a message of only files: the API refuses an empty text block). OpenAI gets `input_image` (a data URL; the detail left to the model, `auto`), `input_file` (a data URL and the file name, which always ends in ".pdf", `pdfName`), a text file as `input_text` led by one line ("The person attached a text file named "notes.md". Its text follows."; the Responses API has no titled text document), then the words. Two turns of the same side that are joined (D-013) keep their files. **A message without files is built exactly as before, `{ role, content }`**, and this was proven: **70 requests recorded before 9.3** (`tools/capture-golden-9.mjs`: every model of both providers, with conversations of one message, several turns, two of the person's in a row, instructions, Unicode and a long text; each body's length and SHA-256, its path and headers, in `tools/golden-9.json`) **are byte for byte the same after it.**

**The chat file is version 4 only when a message carries files** (`fileVersion`), so a chat without files is written exactly as before (version 3). Each message keeps its files' descriptions (`AttachmentInfo`: id, name, kind, type, size and the notes; `checkAttachmentInfo` reads them strictly, key by key) and never a picture or a path; a version 4 file must hold a file and its instructions, or it is left alone as unreadable; a build from before 9.3 leaves a version 4 file alone ("made by another version of the app"); a version 3 file that has an `attachments` field is read without it. A chat whose first message is only files is titled with their names. **A backup line is the chat's own file** (D-034), so a chat with files is a version 4 line with its files' descriptions; the files themselves come into backups in 9.5.

**On screen.** A sent message shows its files above its words (the chips without a Remove button); the chips leave the message box with the message. A chat opened from History asks main once per file for its small picture or first lines (`attachments.describe(ids)`: at most 50 ids, anything else gives nothing; made from the copies, sealed ones included), **kept apart from the messages, so opening a chat does not save it again**; a copy that is gone shows as "cannot be read any more", its tooltip says why, and sending in that chat says which file is missing.

**Deleting.** Deleting a chat deletes the copies no other chat uses, only when every chat could be read; at start, copies no chat uses that are older than an hour are swept, only when every chat could be read (a younger one may belong to a message being written). Discarding a chip deletes its copy unless a saved chat uses it.

**Encryption** (D-035) now rewrites the copies with the chats, both ways, and the notice says so only when there are files ("Encrypted 1 attached file too.", "Rewrote 1 attached file as a plain file too."); a file attached while encryption is on is written sealed at once; "Encrypt my saved chats..." with every chat sealed but a file still plain rewrites the file instead of saying there is nothing to do.

**The mock learned the forms** (`tools/mock-files.mjs`, my reading of the four documentation pages, not the real APIs): Anthropic's blocks (types, base64, a media type that matches the bytes, 8000 px, 10 MB, the rule for more than 20 images, a PDF that starts as one, text blocks never empty, files only on the person's turns) and a request over 32 MB (413); OpenAI's parts (data URLs of the four image types and PDF, the four detail values, no animated GIF, 50 MB of files in a request). `[[mock:files]]` makes the reply say what the last message carried, part by part (each image's type, size in pixels and bytes; each PDF's title and bytes; each text's title and characters; the words).

**Found by the window suite, and fixed.** (1) **A file attached in this run stayed "held" after it was sent** (the hold protects a file on a message being written), so deleting its chat kept the copy until the next start: saving a chat now lets go of the files it names (the saved chat protects them). One case is left: the same file on a message being written while a chat that holds it is deleted; its copy is deleted with the chat, and sending then says the file is missing (nothing is sent). (2) **A backup wrote every chat as version 3**, so a chat with files failed the backup's own read-back, and turning encryption on (which backs up first) stopped: a backup line now has the chat's own version. (3) Found while writing it: the pictures of a chat opened from History were remembered across chats (the view stays while chats change), so a copy deleted since would still have shown its picture: they are now asked for again per chat.

**Older checks that went stale, none because the app was wrong:** `verify-5-2` and `verify-8-1` (the schema is 0.5; the page is told two flags more; capabilities have six fields), `verify-5-4-store` and `verify-7-4` (they took version 4 for a later build's file: it is now a chat with files, so version 5 is used, and a version 4 file without files is checked to be refused for that), `verify-4-2` (the bridge's `attachments` has `describe`), `verify-9-2w` (Send is on with files), the 9.2 window control that let Send through with files (now it keeps Send off), and **seven older negative-control specs** whose text my edits moved (`writes-version-1`, `n74-store-writes-version-2`, `n74-store-old-files-instructions-read`, `w74-ipc-save-drops-instructions`, `w76-bar-first-in-the-tab-order`, `n3-svc-asks-when-nothing-to-weaken`, `n3-svc-noop-asks-backup`): each repointed with the same meaning, and run again with the 9.2 one: all caught.

**What was checked.** `verify-9-3.mjs` under plain Node, **74 checks**: what the page may send and save (eight kinds of junk on a request, sixteen faults in a description, the caps of a message and a chat, a message of only files, an older file's messages read without files); the chat file (version 3 byte for byte without files, version 4 with them, read back, the title, which files the chats use and when that is not known, four damaged version 4 files, version 5), a backup with and without files; the files of a request (a message without files is `{ role, content }`, a missing, damaged and unopened copy, a model blind to images or PDFs, each cap at its edge, a file named twice counted twice, `pdfName`); both adapters through the mock (the form, the order, a message of only files, joined turns, what the mock refuses) and the golden of 70; the registry at 0.5 and the two flags; encryption with files; seven source checks; the page's side as plain functions (what it tells main, what it saves and reads back, which files a chat holds, why Send waits). `run93.mjs` in the real window: **`verify-9-3w.mjs`, 42 checks, on the dev app and the built one** (three files to Anthropic, each in its form, the photo without its metadata, the PDF as it is, the text word for word; the reply; the files on the message; the version 4 file with no picture or path; the files sent again; a message of only files; the same chat to OpenAI; a new chat titled by its file; History with pictures made again and no second save; a copy deleted and the chat opened again; nothing sent and the sentence; deleting a chat and the copy another chat uses kept; encryption sealing the copy, the sealed copy sent as it was, a file attached while sealed, going back; the bridge refusing three kinds of request and junk for `describe`; 320 and 280 px; no console errors), **`verify-9-3b.mjs` after a restart, 6** (the sweep: an unused copy two hours old deleted, a new one kept, a used one two hours old kept; the picture and a request after the restart), and **`verify-9-3c.mjs`, 10, from source with GPT-6 Luna made blind to images and PDFs** (the line under the box for an image earlier in the chat and for a PDF on the message, Enter sends nothing, the bridge refused, a text file still goes; the registry put back and checked by hash). **Negative controls: 40 for the Node suite (`specs93`) and 14 for the window (`specs93w`, each running only the launches it needs, `RUN93_ONLY`), all caught the first time, each file put back (hash; `src/` and `registry/` identical after each).**

**Not checked (9.3).** A real provider reading what the app sends (no real API call, as always): the forms are my reading of the documentation, checked by a mock written from the same reading. A chat with fifty files, or a request near 20 MB, in the window (the caps are checked under Node). The cost guess for files (9.4). A screen reader on the files of a message.

**9.4: what files are guessed to cost.** Until this slice the one guess of what a request sends (D-030: one token for every three bytes of text, and a little for each message) counted only the text, so **a chat's files were invisible to the question before a large request (D-032), to the spending limits (D-031) and to the ledger's first line**: a 100-page PDF went as if it were a few words. The guess now adds the files, the way the providers count them, on the high side as the rest of it is (`estimateFileTokens`, `src/shared/usage.ts`): **an image by its size** (one token for every square of 28 x 28 pixels, and a quarter more: at least Anthropic's own rule of one token for every 750 pixels at every size the app sends; OpenAI counts fewer; an image is sent at most 2000 px a side, so one is at most 6,480 tokens), **a PDF by its pages** (4,800 a page: Anthropic bills each page as its text, 1,500 to 3,000 tokens, and as a picture of the page), **a text file by its bytes** (the text rule), and 16 tokens of framing for each file. Each file is counted each time it is sent (the whole chat goes with every message, D-028; a file named on two messages counts twice); what a request's files come to is returned by the same check that reads them (`resolveAttachments`, 9.3), so the guess and what is sent cannot disagree about which files go.

**The figures a person sees say it.** The question before a large request gets the files' share (`RequestEstimate.files`: how many, and how many of its tokens they are; absent for a request without files, which is described exactly as before) and one sentence: "The file attached in this chat is about 144K tokens of it: every file in a chat is sent again with each message, so a new chat without it costs less." (the dialog writes tokens the way its other rows do). A spending limit's refusal of a request with files gets the same sentence, with the exact count ("about 144,016 tokens", `withFilesNote`, in main); "no limits are set yet" does not (it is not about the cost). The ledger's first line is the same guess, files included; the provider's report replaces it when the reply ends, as before.

**What was checked.** `verify-9-4.mjs` under plain Node, **21 checks**: the image rule at several sizes and against Anthropic's at seven, the PDF page, text bytes, the sum; what the request check counts (a file named twice counted twice, the UTF-8 bytes of a text file); the estimate with and without files (without: the five fields it always had); the default question asked for a 30-page PDF on Claude Opus 5.5 (about $0.72) and not without it; the limits' sentence with one file, three, none, and for limits not set; four source checks (the files are in the one guess, before the question, the limits and the ledger). `run94.mjs` in the real window (`verify-9-4w.mjs`, **11 checks, on the dev app and the built one**): a small photo goes without the question; a 30-page PDF is asked about, the question says the file is about 144K tokens of it, "Don't send" sends and writes nothing; with a daily limit of $0.10 the request is refused with the file's sentence and nothing is sent; with no limit it goes, and the ledger's first line is the guess worked out again in the test from what the provider was sent. **Negative controls: 14 for the Node suite (`specs94`) and 4 for the window (`specs94w`), all caught the first time, each file put back (hash).**

**Older checks that went stale, none because the app was wrong:** two source checks of `verify-8-3` (the call that prices a request is wrapped over lines now and takes the files' share) and four negative-control specs whose text moved (`w81-guess-input-without-system-prompt`, `n82-chat-no-check`, `w82-chat-no-check`, `n83-chat-ceiling-constant`): each repointed with the same meaning, and run again: all caught (`w82-chat-no-check` as when it was written: two checks fail and the suite stops).

**Not checked (9.4).** How close the guess is to a real provider's count (no real API call: the mock reports fixed numbers). The guess is meant to be high; a real bill for images is probably lower.

**9.5: backups hold the files** (the owner's answer 5). **A backup with files is version 2 of the backup file** (D-034), written only when a chat in it carries files, so a backup without files is byte for byte what it always was (version 1). After the chat lines it has one line for each file those chats name, once however often they name it: `{"file":"<id>","data":"<base64>"}`, the file's **plain bytes even when its copy is sealed** (a backup is a plain file, D-035: the owner keeps it safe), and its last line counts them (`"files"`, and `"filesLeftOut"` for copies that could not be read, which are left out and said, like chats). The header is written as version 1 and its one digit changed in place once the file lines are written (the two headers are the same length), so the writer still holds one chat at a time. Every line is read back before the backup counts, the file lines too, in order. A version 2 file holding the largest files is bigger than before (a 10 MB PDF is a 14 MB line); a line longer than any chat that is not a file line is still refused unread.

**Reading a file line** checks it the way a copy in the app's folder is checked (`fileOfLine`): exactly its id and its data, an id that is one, base64, no larger than the largest file, **bytes that hash to its id**, and bytes that are a file the app keeps (`factsOf`). One that fails is set aside and counted apart from the chats, with why; the chats and the other files are read as before. A version 1 file has no file lines (a line that looks like one is a chat line that cannot be used). Version 3 is another version of the app.

**Restoring puts the files back** (`adopt`, in the store: the same checks again, the folder's caps, the form encryption asks for now, so a copy put back while encryption is on is written sealed; a whole copy already here is left as it is). Only the files of chats that are here once the restore has added what it could (added, added as a copy, or already here) are put back; a file named by a chat that could not be added is left (the chat's own failure is said), and a file no chat in the backup names is not put back. **The look before adding says how many files the backup holds, how many are not here yet, and how many cannot be used**; when every chat is already here but its copies are gone (a folder lost, a profile copied without them), the button offers "Put back 2 attached files" instead of "Nothing to add". The notices: "Backed up 1 chat to D:\b.jsonl. The file was read back and every chat matched. It holds their 2 attached files too." and "Added 1 chat. Put back 2 attached files." (a restore that only put files back does not say "Added 0 chats"); each sentence about files appears only for a backup that has them.

**What was checked.** `verify-9-5.mjs` under plain Node, **33 checks**: the file (version 1 without files, version 2 with them, the order of the lines, a file named twice written once, a copy that cannot be read left out and counted, a sealed copy written as its plain bytes, read back whole); reading (a changed byte, a bad id, data that is not base64, a field more, bytes that are no file the app keeps, file lines in a version 1 file, a trailer without its file counts, a file line missing, version 3); `adopt` (put back and read, "already", four kinds of refused bytes, a full folder, a refused write, sealed when encryption is on); the service (a backup of all chats and of one, the look, a restore into an empty profile, the same restore again, a file no chat names, a version 1 backup, copies lost with the chats here); the words with and without files. `run95.mjs` in the real window (`verify-9-5w.mjs`, **14 checks, on the dev app and the built one**): a chat with a photo and a PDF backed up through History, the version 2 file on disk, the chat deleted and its copies with it, the look, the restore, the copies back under their hashes, the chat opened with its pictures and its files sent again, the same bytes; with encryption on, the backup made before encrypting holds the files too (plain), and the copies deleted and put back sealed by "Put back 2 attached files". (A first draft of the suite restored the older backup at that step and saw "add as a copy": the chat had a message more than that backup, which is what a restore should say.) **Negative controls: 20 for the Node suite (`specs95`) and 3 for the window (`specs95w`), all caught in the end, each file put back (hash).** One was not caught at first, and was read: with the refusal to write taken out of `adopt`, the copy's own read-back proof (D-016) still ended the write in "failed" and removed what it had begun, so the result was right and the check blind; but a write had begun (the folder made, a `.tmp` written and removed) while writing was refused, which D-035 says must not happen. The check now also requires that nothing at all is written, not even the folder, and catches it.

**Older checks that went stale, none because the app was wrong:** one check of `verify-8b-1` (it took a version 2 header for a newer app's: version 3 now) and three negative-control specs whose text moved (`n8b-reader-any-version`, `n8b-writer-leftout-lost`, `n91-store-caps-off`): each repointed with the same meaning, and run again: all caught.

**Not checked (9.5).** A backup near its size limit (2 GB) or a restore into a folder at its cap in the window (the caps are checked under Node). A backup moved to another computer or account (the same as D-034: nothing in a backup depends on the computer).

Status: accepted (9.1 to 9.5). The stage as a whole, with its threat note and the full regression (9.6), is D-038.

## D-038 - Stage 9 as a whole (9.1 to 9.5): what it added to the app's surface, the threat note across its slices, and what was not checked

Stage 9 (D-037) brings images and files into a chat: a checked copy of each file is kept by the main process, sent to the provider in its own form with every message of the chat, saved with the chat, counted in the cost, sealed with the chats and carried by backups. Each slice has its own part of D-037. This is the stage's: the surface the five slices added taken together, the risks that exist only where they meet, what the full regression showed, and what was not checked. The only code it changes is the fault from Stage 8 that the regression found (below).

**What the stage added, in one list.**

- **Across the bridge:** four functions under `window.api.attachments` (`pick()`, which takes nothing and opens the system's open dialog from main; `addBytes(name, bytes)`, a pasted or dropped file as a label and at most 20 MB of bytes; `discard(id)`; `describe(ids)`, the small pictures and first lines of at most 50 kept files), on four channels (`attachments:pick`, `attachments:add-bytes`, `attachments:discard`, `attachments:describe`, each behind the sender check); an optional `attachments` field (`{ id, name }`) on the person's messages of `chat:start`, and one (each file's description) on the messages of `history:save`; two flags on each model of the settings status (`imageInput`, `documentInput`); the files' share in the `confirm` event's estimate; and the files in the results of a backup and a restore. **The page never names a path**: the open dialog is main's, a pasted or dropped file arrives as bytes, and a file is named by the hash of main's own copy, which main reads and checks again for every request.
- **On disk:** a new folder `attachments/` in the data folder, a copy per file named by the SHA-256 of what is kept (plain, or sealed like the chats when encryption is on), capped at 5,000 files and 2 GB, written and read back without a rename (D-010, D-016); chat files of **version 4 only when a message has files** (a chat without files is written byte for byte as before); backup files of **version 2 only when a chat in them has files** (likewise); `registry/models.json` at schema 0.5 (`documentInput`).
- **One order, in one place.** `runReply` in `chat.ts` is still the only place a provider is called. To the order of D-033 it adds, after the key and before anything is counted: the files of the conversation read from the copies and checked (`resolveAttachments`: missing, damaged or unopenable copies, a model that cannot read a kind of file, the caps of one request), then the one guess of the input with the files in it (9.4), used for the question, the limits and the ledger.
- **Not added:** no package (`package.json` and the lock file are as at the end of Stage 8b: the images are made smaller, turned and stripped with Electron's own `nativeImage` and by rewriting bytes, PDFs counted by the app's own reader, zlib from Node), no network call (a search of the stage's diff of `src/main`, `src/shared` and `src/preload` for `fetch`, addresses, `net`, `http`, `shell`, `child_process`, `webUtils` and `openExternal` found nothing), and nothing in `src/main/index.ts`, `src/main/security.ts`, `index.html` or the build configuration: the window's guards (sandbox, context isolation, navigation lock, window-open handler, Content-Security-Policy, which already allowed `data:` pictures) were not touched.

**Threat note across the slices (what could go wrong where they meet, what stops it, what is left).**

- _A file is data for the model, and can carry words meant for it (safety rule 2)._ A PDF, a text file or an image can hold instructions ("ignore the person and ..."), and the model reads them. Nothing in the app can act on what a model says: a reply is drawn as text (D-025), and there are no tools before Stage 11. **Left, for Stage 11:** a tool call must never be allowed on the strength of what a file says; the person's approval must show the call in full, and the attachments are untrusted input like a web page.
- _Images are decoded in the main process._ To make a big picture smaller, turn a photo upright and draw the small picture on a chip, the app gives PNG and JPEG bytes from the person's files (or from a paste or a drop, or a restored backup) to Electron's `nativeImage`, which runs in the main process, outside the renderer's sandbox. A flaw in Chromium's decoders would then be reachable there. What stands before it: the type comes from the bytes; every image's header is read by the app's own bounded reader first, and one over 8,000 px a side or 40 million pixels, animated, or cut short is refused before anything decodes it; the size of what is decoded is checked against the header; GIF and WebP are never given to it (the renderer draws them, sandboxed). **Left:** the decoding could move to a sandboxed utility process; that is a change of architecture, and it is in IDEAS for the owner. Keeping Electron up to date matters more with this stage.
- _What a hostile page could do with the new functions_ (the same question as D-033's first bullet: the page is trusted not to be hostile, and the window's guards are what keep foreign code out of it). It could attach any bytes it makes (as a paste would), up to the caps, filling the folder up to 5,000 files and 2 GB (nothing is ever deleted to make room, and a full folder refuses with a sentence); send any file id the app keeps in a request, to the provider of the chosen model (where the person's chats with those files have already gone); ask for the small pictures and first lines of kept files (what History shows anyway); and discard a file that no saved chat uses, which deletes its copy. It cannot read a file's bytes: no function hands them to the page. None of these reaches a file outside the app's folder, a path, or the network beyond the provider of the chosen model. The limits of D-031 count the files (9.4) and, as D-033 says, a hostile page can lift them.
- _Privacy of what is sent._ A photo's metadata (where it was taken, the camera, comments) is always taken out (the owner's answer 1); a PDF is sent as it is, with whatever its author's program put in it, and its chip says so (answer 2); a text file is sent as it is. **The file's name is sent too** (a PDF's title, a text file's title, OpenAI's file name), and the chip shows it. Every file of a chat goes to the provider again with every message of that chat, and the line under the chips says so; so does the question before a large request.
- _At rest._ Copies are sealed when the chats are (D-035), and a copy attached while encryption is on is written sealed at once. **A backup holds the files as their plain bytes**, like the chats (D-034, D-035): anyone who can read a backup can read its files. Settings says a backup is always a plain file (D-035), and Stage 9.5's "Things to know" says it again for files.
- _A backup that is not the person's own._ A restored file is checked as a copy is (its bytes hash to its name and are a file the app keeps) and only files named by the backup's chats are put back; but a backup made by someone else can hold any file that passes, with chats that look real. The restore panel already says to add only a backup you made yourself or trust (D-034).
- _The data folder, once a tool can write._ D-033's point now covers `attachments/` too: a command run as the person (Stage 13) could replace a copy (its hash would no longer match and it would be refused as damaged, so it could not be sent in place of another) or delete one (the chat then shows it as missing and sends nothing). **Left, for Stages 12 and 13:** the data folder, `attachments/` included, must lie outside every folder a tool can read or write.

**The full regression (9.6).** **112 runs, 101 clean the first time** (regression `t96`: every suite of every stage, the plain-Node ones, the window ones on the dev app, the seeded profiles, the registry scenarios, Stage 4's, and the built app). **All Stage 9 suites passed on both apps.** The 11 others: **ten failed only on checks written before Stage 9** that listed the bridge's functions (`attachments` is there since 9.2: `verify-2-3`, `verify-4-3d`, `verify-5-3`, `verify-8-2w`), the fields of a model the page is told about (`imageInput` and `documentInput` since 9.3: `verify-3-4`, `verify-5-3`) or the registry's schema (0.5: the `wrong-version` scenario, whose sentence is right and says 0.5); each was updated with the same meaning and run again on both apps: all pass. **The eleventh was a real fault, from Stage 8**: the built app's `verify-8-1` (78 of 81, and 80 of 81 run again) found **Settings showing the sums of its previous opening for a moment when it opened again**, until main answered, and read them in that moment ("0 requests" just after a reply). The Usage section now says "Checking..." from the moment Settings opens until the new sums arrive. A new check in `verify-8-1w` reads the table in the same turn of the page as the click, before main can have answered, so it no longer depends on timing: it failed on the old code (its negative control, `w81-settings-shows-old-sums`, is caught) and passes on the new. The suites that read that table (`verify-8-1`, `verify-8-2`) pass on the dev app and on a new build: `verify-8-1` 94 of 94 and `verify-8-2` 91 of 91 on each.

**What was not checked, across the stage.** A real provider reading what the app sends (no real API call was made, as always: the forms of 9.3 are my reading of the four documentation pages, checked by a mock written from the same reading); a real model's count of image and PDF tokens against the app's guess (9.4); a screen reader on the chips and the files of a message; a drag from Windows Explorer itself (the drops tested were DevTools' and the page's own); a mapped network drive; CMYK, 16-bit or interlaced pictures through `nativeImage`; unusual PDFs (the page count is a reading of the file's structure); the folder or a backup near their caps in the window (checked under Node); another Windows account, and another computer.

Status: accepted.

## D-039 - Stage 10: projects, custom instructions and memory. 10.1: a change that lets the app spend more is saved only after the person's yes in the system's own message box, which the page cannot answer; 10.2: instructions for every chat, kept and sent by main; 10.3: the memory store; 10.4: memory in the window and in every request; 10.5: projects; 10.6: a project's parts in every request

The plan is in ROADMAP (Stage 10). **The owner approved it on 7 October 2026 and answered its five questions with "your picks"**, so: (1) notes for one project as well as notes for every chat; (2) notes are made only by the person ("Remember..." on a message, "Add" on the Memory page), with no offer when a message starts with "Remember"; (3) the system's own dialog asks before notes, instructions and a project's files are saved, and before a limit is raised; (4) a project's files go with every message of its chats; (5) the caps are mine. This entry grows slice by slice; 10.1 is the question itself, put first in front of the limits, which closes the first finding of D-033.

**What 10.1 changes.** Until now the page could raise a spending limit, choose "No limit" or choose "Never ask" with no answer from the person (`settings.setLimits` and `settings.setAskFirst` needed none, D-033), so the limits stopped a slip, a page bug and a model's words but not a page that was itself hostile. Now main saves such a change only after the person says yes in **the system's own message box**, which the operating system draws, modal to the app's window: the page cannot see into it, click it or answer it, and no channel exists by which it could (`src/shared/ipc.ts` has none, and `window.api` is unchanged). **What counts as "more"** (`limitChange`, `limitsRaise` in `src/shared/limits.ts`; `askFirstLoosens` in `src/shared/askFirst.ts`, compared in whole cents): for a limit, any choice made from "not chosen" (which refuses every request, so the first choice is asked about too), a higher amount, and "No limit"; for the question before a large request, an amount above the one in force (the default's $0.50 until the person picks one) and "Never ask". **A change that only lowers a limit or asks sooner is saved at once**, with no question: it can only make the app send less. Both limits are compared separately, so a pair that lowers one and raises the other is asked about.

**The rules of the question** (`src/main/systemQuestion.ts`, no Electron imports; the box is handed in from `backupDialogs.ts`, still the only file that opens a dialog). **One question at a time, across the app**: a change that needs one while one is open is refused at once with a sentence, never queued, so a page that asks a thousand times gets one box, not a thousand in a row (and, in `limitChanges.ts`, one change of a limit or of the amount at a time: a second while the first is being asked about or saved is refused). **One answer per question**: the answer is what the box returned for that question; nothing can answer ahead of it or be kept for later. **Only a yes is a yes**: `true` from the box, nothing that looks like it (an answer of 1, the text "yes"); a box that cannot be shown is "failed", and nothing changes. **After a no, nothing is asked for three seconds** (`QUIET_AFTER_NO_MS`): found by the window suite, where a stand-in that answers at once let fifty calls through the page's bridge ask one after another. With a person the open box makes the others busy, but a page that asks again the moment the person says no could keep a modal box in front of them for good (they could not even reach the window to close it) or wear them down to a yes. The pause gives them the window back; a change asked in it is refused with "You said no to a question a moment ago. Wait a few seconds, then try again." Lowering is not affected.

**The box** (`askPerson`): the warning icon; the title "Spending limits" or "Large requests"; the question names the change ("Raise your daily spending limit to $20.00?", "Remove your monthly spending limit?", "Save these spending limits?" for the first choice, "Stop asking before large requests?", "Ask before a large request only above $3.00?"); the detail gives each limit as it would be and as it is ("Daily limit: $20.00 (now $5.00)", "Monthly limit: $50.00 (as now)"), the warning that with "No limit" nothing in the app stops spending in that period, and a last line saying why it is asked there ("...which the app's page cannot answer"); two buttons, the yes named for the change ("Raise the limit", "Never ask") and "Cancel", which has the focus and is the box's cancel (Escape and closing it), so only a deliberate click says yes. **The page's side**: the form says before Save when the system will ask once more ("This lets the app spend more, so when you save, the system asks you once more in a window of its own."); a no shows "Not saved: the limits are as they were." as a plain notice, not as a failure (`cancelled` in the answer); the first-run question stays open after a no, and requests are still refused until both limits are chosen.

**What it closes, and what it does not.** A hostile page can no longer raise a limit, remove one or turn the question off: **the limits are now a hard stop for it too**. What it can still do: spend up to the limits (it can still answer its own question before a large request, `chat.confirm`, which stays in the page by design, D-032: that question guards a slip; the limits are the stop); lower a limit or ask sooner (the safe direction); and put one question in front of the person at a time, with a pause after each no. The files themselves (`limits.json`, `ask-first.json`, the ledger) are still plain files that a program running as the person can edit (D-033's second point, for Stages 12 and 13).

**Found on the way: Settings scrolled sideways at 280 px since 8.1.** Usage's "$0.00 of $20.00" was kept on one line and pushed the dialog 16 px past its edge (seen while measuring the new line; never measured at that width before). Its two amounts are now separate pieces that each stay whole, and below 341 px the cell may break before "of"; at 420 px it is one line, as before.

**Older suites.** The window suites of 8.2, 8.3 and 9.4 raise limits through the page's bridge to do their work; they now stand in for the person from the main process (the box replaced through the inspector, `tools/lib10.mjs`, answering yes) and their launches have an inspector port; they test what they always tested (91, 119 and 11 checks, all pass). Three negative-control specs pointed at code that moved (the checks of what the page sends are now in `limitChanges.ts`; the Usage cell is two pieces) and were repointed with the same meaning; the 8.2 and 8.3 window specs got the inspector port.

**What was checked.** `verify-10-1.mjs` under plain Node, **90 checks**: "more" for both kinds, every edge (from "not chosen", one cent, 0.1 + 0.2 against 0.3, from "No limit", from "Never ask"); the words of every question; the gate (one at a time, the window handed to the box, only `true`, a box that throws, the pause after a no to the millisecond, none after a yes or a failure); the flow with the real stores of 8.2 and 8.3 in a temporary folder (lowering saves with no question; a no saves nothing, byte for byte; a yes saves exactly what was shown; the first choice; a half-chosen file; five kinds of junk refused before any question; a change while a question is open, two at once and fifty at once; a file that cannot be read); and source checks (both handlers go through the flow for the window that asked, `ipc.ts` saves nothing itself, one gate for the app, the box's buttons and focus, no channel that answers). `verify-10-1w.mjs` in the real window, with the box replaced from main, **42 checks on the dev app** (the built app passed the 41 of the version before one check was split in two so that a control names what it broke; the app did not change): the first-run question (asked, a no, the pause, a yes), Settings (lower: no question; higher, "No limit", a higher amount and "Never ask": asked; the line before Save; the notices), the bridge (a raise cannot leave the question out; while one is open a lower change is refused; the pause; fifty at once give one box; only a yes lets one through; `window.api` unchanged), 420 and 280 px, no console errors. **`verify-10-1-real.mjs` once with the REAL Windows box** on a scratch profile (UI Automation read its texts; window messages pressed its buttons; no screenshot), **10 checks**: titled "Spending limits", the exact question and lines, the buttons "Raise the limit" and "Cancel" with the focus on Cancel, and Cancel, the box's own cancel (Escape) and the yes button each doing what they say. **40 negative controls, all caught** (23 under Node, 17 in the window; `make-specs101.mjs`); a hash of every file of `src/` and `registry/` was the same before and after. One Node control at first hung instead of failing (a gate that let a second question through waited for an answer that never came): the check is now bounded and the control is caught. Five window controls were at first caught only by the suite stopping (the first-run question closed when a no was taken as a yes); the first section now checks the file and the question before it reads the form, and all five fail on named checks.

**Not checked (10.1).** A screen reader reading the box; a high-contrast theme or another Windows version (only this Windows 11); a person's real reaction to the pause (three seconds is my number); two app windows at once (there is one; the gate is for the whole app); macOS and Linux, where the box looks different (never tested, as for every dialog).

### 10.2: instructions for every chat

**What it adds.** What other apps call custom instructions: one text of at most 8,000 characters that goes with every message of every chat. **Main keeps it**, in `instructions.json` in the data folder (`{"version":1,"text":"..."}`, `src/main/everyChat.ts`), and **adds it to the system prompt itself, reading the file for every request** (`chat.ts`); the page can read it and ask to change it, and a chat request that names its own `everyChat` or `system` field loses it. **The order of the prompt** (`systemPromptFor` in `src/main/providers/request.ts`): the app's rules; "The person has given these instructions for every chat:" and the text; then the chat's own instructions (D-027), after "The person has given these instructions for this chat:" when they are the only part, exactly as in 7.4, or after "The person has given these instructions for this chat; where they differ from the instructions above, follow these:" when both are set, so the most particular comes last and says it wins. **With nothing set, or only the chat's own, every request is byte for byte what it was**: the 70 recorded requests of both providers (`tools/golden-9.json`) are identical. The guess before a request counts the text, since it is in the system prompt, so the limits and the question before a large request see it (the window suite checks the ledger's guess against the guess of exactly that prompt).

**Asked outside the page.** Saving new or changed text asks in the system's message box (10.1's gate: one question at a time, three seconds after a no), which shows the text (its first 400 characters, then "...") and its length, says where it goes, and can be answered only there; a no saves nothing and is shown as a plain notice. Turning them off (an empty box) sends less, so it asks nothing. **My choice, to report: a chat's OWN instructions get no system question.** They have been the page's since 7.4 (the page saves them in the chat's file with the messages), and the page writes the chat's messages anyway: a question that the page could go around by putting the same text in a message would protect nothing.

**Secrets** (rule 5; `src/main/secrets.ts`). Before either part is kept, main looks for secrets. **An API key saved in the app** (the whole key, or any 24 characters of it, also with spaces and line breaks taken out) **is refused outright**, with a sentence that says whose key and shows none of it. Text that **looks like** a key, a token or a password (the shapes of Anthropic, OpenAI, AWS, GitHub, Slack, Google and Stripe keys, a web token, a private-key block, "password:" and the like, a long random-looking run) is refused with a warning that lists each part masked (its first four and last two characters and its length; a short one its first character), and is kept only with **"Save anyway"**, which the system's question then mentions. **Main looks again before every request**: one whose instructions (either part) hold a saved key is refused, so a key saved in Settings after the text was kept still never goes out inside it. Found on the way (the Node suite): ordinary text was taken for a key (a long link, a hyphenated phrase, "sk-learn-..."); the providers' shapes now need a digit, and a long run needs both cases and two digits.

**A file that cannot be read** (cut off, edited, from another version, sealed with a key that cannot be used): **no request is sent at all**, with what, why and the way out ("Nothing was sent: your instructions for every chat could not be read (...). Open Instructions to replace them or turn them off."); the Instructions button shows "!", and the dialog says what and why. The way out is new text (asked about; the question says the old file is kept) or "Turn off" (asks nothing); either first keeps a copy of the damaged file beside it, `instructions.json.damaged-<time>`, read back before anything else. Nothing is cached: every read is of the disk, so damage, or a key that comes back, is noticed at the next request. The file is written like a chat (`src/main/keptFile.ts`: D-016's three steps, a whole `.tmp` left by a crash wins, never renamed), sealed like the chats when encryption is on (the same envelope and the same one rule, D-035), rewritten when encryption is turned on or off (the report says so), and left exactly as it is when it cannot be read. Backups do not hold it yet (10.7).

**The window.** The Instructions dialog shows every part in the order it is sent, "For every chat" and then "For this chat", each with its text or "None."; one box, which starts on this chat's part (as in 7.4) and which "Change..." moves when nothing in it is waiting to be saved. While the system's box is open the dialog says so and Escape does not close it. The button under the message box says "on" when either part is set, with a tooltip that names each part and its length.

**Older suites.** Six suites list the page's bridge and now expect `instructions` (2.3, 4.2, 4.3d, 5.3, 8.2w, 10.1w); 7.4w's list of the dialog's buttons gained "Change..."; 16 negative-control specs pointed at lines that changed (the prompt is built from pieces, the encryption flow's conditions, the chat bar, the dialog) and were repointed with the same meaning. **Running every plain-Node suite found two checks that 10.1 had made stale** and 10.1's own runs had not included: 8.3's source check looked in `ipc.ts` for code that moved to `limitChanges.ts`, and 8b.2 counted five handlers that open a dialog for their window (seven since 10.1, eight now). Both now check the same thing where it is; the regression's node part now runs in every slice.

**What was checked.** `verify-10-2.mjs` under plain Node, **118 checks**: the look for secrets (the masks, a saved key whole, in pieces, broken every 20 characters, none for 23; each shape found; nine kinds of ordinary text left alone; "Save anyway" never passes a saved key); the kept file (the D-016 write, a `.tmp` that wins and one that is cut off, a byte-order mark, a damaged file never written over or deleted by itself and copied first when the person starts again, too big, sealed, a lost key and its return, a refused write, conversion both ways); the service (the file's exact shape, the question and its words, one question, a no, the pause, turning off, the same text, a saved key, a lookalike, "Save anyway" only for `true`, 8,000 and 8,001 characters, seven kinds of junk that must not turn it off, a busy gate, a box that fails, a damaged file and both ways out, sealed and a lost key, the check for a chat's own part); the prompt in every combination and through both adapters to the mock; the golden of 70 requests; the encryption flow; source checks (chat.ts reads main's file before it builds the request, the handlers, the bridge). `verify-10-2w.mjs` in the real window, **56 checks, on the dev app and on the built one**: the dialog and its parts, the question (its options, a no, Escape while it is open, a yes), what each request carries (every chat's alone, both, after New chat, after turning off), the ledger's guess, no chat file holding it, secrets for both parts (named, masked, "Save anyway"), a saved key refused again at request time for either part, the page's own `everyChat` and `system` fields ignored, a damaged file (marked, every request refused, "Turn off" keeping a copy), encryption on and off, the bridge, 420 and 280 px, no console errors. **64 negative controls, all caught**: 31 under Node and 17 in the window for this slice (`make-specs102.mjs`), and the 16 older ones that were repointed (8 under Node, 8 in the window); a hash of every file of `src/` and `registry/` was the same before and after. At first one Node control (the check for a saved key at request time removed) was caught only by the window suite, and three window controls only by the suite stopping (a wait that timed out once a sabotage had closed the dialog); the checks were made sharper and all four now fail on named checks.

**Not checked (10.2).** A real provider reading the instructions (no real API call, as before); how a model weighs "follow these" (a wording, not a guarantee); a screen reader; secrets in shapes the list does not know (a password written as a plain word with no label is not found: the look is a safety net, not a guarantee).

### 10.3: the memory store (in main; the window comes in 10.4)

**What it adds.** The notes the person keeps (`src/shared/memory.ts` for the rules both sides use, `src/main/memory.ts` for the store): `memory.json` in the data folder, `{"version":1,"on":true,"notes":[...]}`, each note `{id, text, scope, createdAt, updatedAt}`, where `scope` is `"all"` (every chat) or a project's id (from 10.5; until then no project exists, and a note for one is refused). It is kept like the instructions (`keptFile.ts`: written like a chat, sealed like the chats, converted with them). Nothing in the window uses it yet: this slice is the store and its rules, checked under plain Node; 10.4 adds the Memory page and sends the notes.

**The rules.** A note is 1 to 500 characters (trimmed); a place (every chat, or one project) holds at most 8,000 characters and 100 notes, about 2,000 tokens with every message, as for the instructions. **A note is made or changed only after the person's yes in the system's message box** (10.1's gate), which shows the note (and its old words when it is changed), where it goes, whether memory is on, and the room it leaves ("With this one: 3 notes for every chat, 412 of 8,000 characters."). The look for secrets is the instructions' (a saved key refused, a lookalike only with "Save anyway"). The same note again in the same place is not asked about ("This is already one of your notes."). **Deleting a note, deleting them all and turning memory off send less, so they ask nothing in the system's box** (the page asks first, as for a chat); turning memory back on asks when there are notes, saying how many and how long. One change at a time. What goes with a request (`forRequest`, used from 10.4): every chat's notes, then (10.6) those of the chat's project, oldest first; none while memory is off.

**A file that cannot be read.** Every request is refused (from 10.4) with what, why and the way out, and nothing is changed but by the two ways out, "Delete all" and "Turn memory off", each of which first keeps a copy of the damaged file (`memory.json.damaged-<time>`). The file is read strictly: anything but exactly what this app writes is not read (a field more or less, an id twice, a note over 500 characters or not trimmed, a place over its caps, a time that is not a whole number).

**The export** ("Export all..." from 10.4): every note under the place it is for, with when it was made and changed, in one plain text file that the person places in the system's save dialog; never in the app's own data folder; read back before the app says it is done.

**Found on the way, in 10.2's code, and fixed here.** (1) A note id used twice made `memory.json` a file this app would then not read (the suite's own ids collided with the seeded ones): the store now makes an id that no note has, and **every kept file refuses to write what its own reader would refuse** (`keptFile.ts`), so a fault can never turn the person's document into one that stops every request. (2) The mask of a secret showed six characters of a nine-character password; below 24 characters (a key's length) it now shows only the first character and the length, and it never shows more than a quarter of a part.

**What was checked.** `verify-10-3.mjs` under plain Node, **74 checks**: a note's rules; the file read strictly (15 kinds of wrong file); the service: the question and its words (for every chat, for a project, a change with the old words, turning memory on), a no, the pause, the same note, a saved key, a lookalike and "Save anyway", 501 characters, seven kinds of junk, a project that is not there, changing (the same note keeps its id and time made), deleting one and all, off and on, what goes with a request (none while off; a project's notes only with that project); the caps (8,000 characters exactly, 8,001 refused before any question, a change that grows a note, a project's own room, a 101st note); one change at a time, a busy gate, a box that fails; a damaged file (every request refused, every change but the two ways out refused byte for byte, each way out keeping a copy); sealed and a lost key; the export (cancelled, where it goes, its text, never into the data folder, a path that is not one); and the two findings above. **33 negative controls, all caught** (`make-specs103.mjs`; one was at first caught only by the suite stopping, and its check was made to fail by name); a hash of every file of `src/` and `registry/` was the same before and after. 10.2's suites still pass (118 under Node, 56 in the window on the dev app).

**Not checked (10.3).** The window (10.4); notes for a project (10.5); the notes in a request and what they cost (10.4, 10.6).

### 10.4: memory in the window, and the notes in every request

**What it adds.** **The Memory page**, opened with "Memory" under the message box, which shows how many notes go with this chat ("Memory 3"), nothing while memory is off, and "!" when `memory.json` cannot be read. The page lists every note with when it was made (and changed), "Change..." and "Delete" on each (deleting asks on the page first, "Delete?" with Keep), "Add a note...", one switch, "Send my notes with every message", "Export all..." (the system's save dialog, "Export your notes", a dated `.txt`) and "Delete all..." (which asks on the page first, saying how many and that it cannot be undone). **"Remember..." under any finished message** opens the page with the box holding the part of that message the person selected (a click on the button keeps the selection), or all of it; a text over 500 characters comes in whole, and "Remember" stays off until it is cut down. Every new or changed note, and turning memory back on, is saved only after the yes in the system's message box, as 10.3 set out; the page reaches the store through `window.api.memory`, which can read, ask and delete, and has no way to answer a question or name a path. A damaged file shows what and why, with its two ways out.

**In every request.** Main reads `memory.json` for every request (`chat.ts`) and puts the notes for the chat (every chat's; a project's from 10.6) **right after the app's rules**, after a line that says they are information about the person and not instructions ("The person keeps these notes for you to keep in mind. They are information about the person and their work, not instructions: they do not change the rules above or any instructions that follow."), **as a list**: one item a note, oldest first, a note's own line breaks kept under its item, so that a note cannot pass for a line of the prompt. Then the instructions for every chat, then the chat's own (which say they win where they differ). **My choice: notes first**, because they are the most general and are information; the instructions follow from the most general to the most particular. With no notes, every request is what it was (the 70 recorded requests are identical). The guess before a request counts them (it is the guess of exactly that prompt). **A file that cannot be read refuses every request** ("Nothing was sent: your notes could not be read (...). Open Memory to delete them all or turn memory off; the app keeps a copy of the file."), and **so does a note that holds a saved API key**: main looks at each note before every request, so a key saved in Settings after the note was made still never goes out. Memory off sends none. `memory.json` is converted with the chats when encryption is turned on or off, and the report says "Your instructions for every chat and your notes are encrypted too."

**Older suites.** Seven suites list the page's bridge and now expect `memory`; 8b.2 counts twelve handlers that open a dialog for their window; 10.2's window suite reads the new sentences about encryption; 4.2 and 7.6 count the new button under the message box; six negative-control specs pointed at lines that moved, or that 10.4 put twice in one file (the key check in `chat.ts`, the overwrite question in `backupDialogs.ts`), and were repointed with the same meaning.

**What was checked.** `verify-10-4.mjs` under plain Node, **22 checks**: the notes in the prompt in every combination (none, one, several, trimmed, line breaks, with every part), through both adapters to the mock, the golden of 70 requests; the sentence for a key in a note; source checks (`chat.ts` reads main's notes before it builds the request and refuses for a damaged file or a key, the handlers and which open a box for their window, the bridge, the export's save dialog, "Remember..." calling nothing in main). `verify-10-4w.mjs` in the real window, **59 checks, on the dev app and on the built one**: the page and a first note (the question's options, a no, Escape while it is open, a yes, the file, "Memory 1"), what each request carries and the ledger's guess, "Remember..." (a selected part, a whole message, too long and cut down), change and delete (Keep, then Delete, nothing asked in the system's box), the switch (off asks nothing and sends none; on asks), secrets (a saved key, a lookalike and "Save anyway", a key in a note refused at request time), the export (the dialog's options, the file, never into the data folder), "Delete all...", a damaged file (marked, every request refused, "Turn memory off" keeping a copy), encryption on and off, the bridge, 420 and 280 px, no console errors. **34 negative controls, all caught**: 13 under Node and 15 in the window for this slice (`make-specs104.mjs`), and the six older ones that were repointed; a hash of every file of `src/` and `registry/` was the same before and after. One more window control was not caught: it removed reading the selection when the mouse goes down, and a click on a button keeps the selection anyway, so that code was taken out instead (the control that reads no selection at all is caught). Two others were at first caught only by the suite stopping (a wait that a sabotage left waiting) and now fail on named checks.

**Not checked (10.4).** How a real model weighs notes against instructions (no real API call); a screen reader on the page; a selection that spans two messages ("Remember..." takes a selection only from inside its own message, otherwise the whole message). At 280 px the Memory page scrolls as a whole, its buttons with it (nothing is cut off; the History dialog keeps its buttons in view, this one does not).

### 10.5: projects

**What it adds.** A project is a name, instructions and files for a group of chats, kept by main in `projects.json` (`src/main/projects.ts` over `keptFile.ts`: written like a chat, sealed like the chats, converted with them; at most 100 projects, 20 files each). **The name is the person's label and is never sent to the model**, so making a project, renaming it, taking a file off it and deleting it send nothing new and ask nothing in the system's box (deleting asks on the page first). **Its instructions** are saved after the look for secrets and the person's yes in the system's message box, as for every chat's. **Its files** come through the system's open dialog (main's own copies, checked by their bytes, D-037) and are added only after a second question that names each one, what it is and that it goes with every message of the project's chats; a no, or a file already there, lets the copy go. In this slice nothing of a project goes into a request yet: that is 10.6. (The Projects page already says what will go: my choice, since 10.6 follows at once.)

**Chats in a project.** "Project" under the message box (after Memory) opens the Projects page, where the chat on screen can be put in a project or taken out; the button then says "Project: name". "New chat in this project" starts one in it. **A chat in a project is saved as a version 5 file**, the version 3 or 4 fields and then `"project"`; a chat in no project is written exactly as before (version 3, or 4 with files), so an older build reads every chat that is in no project and none that is in one (as in 7.4 and 9.3). A version 5 file must name a project by an id that is one; an older file's "project" field is not read. A chat saved for a project that is not there any more is saved in none. History names each chat's project and can show one project's chats, or those in none. The Memory page has a place for each project's notes (the question names the project).

**Deleting a project** deletes its notes and the copies of its files that no chat and no other project uses; its chats stay as they are (their files still name it, and a project that is not there is none). **The start-up sweep and every deletion now count the projects' files as used**, and delete nothing while a chat or `projects.json` cannot be read. A damaged `projects.json` is left as it is; nothing is changed, and the way out ("Delete all projects...") keeps a copy first.

**Older suites.** The bridge lists now expect `projects`; the chat bar holds "Project" last (4.2, 7.6); 8b.2 counts fourteen handlers that open a dialog; 5.4 and 7.4 now call version 6 a later build's; 9.3's source checks look for the one helper that deletes unused copies; 8b.3's window suite waits for the save dialog's call instead of reading it as the buttons go off (main counts the kept documents first, so the call came a moment later: a race in the test, found by the regression); 21 negative-control specs pointed at lines that 10.5 changed (the chat file's versions, the save of a chat, the sweep and deletions, the History hook) and were repointed with the same meaning.

**What was checked.** `verify-10-5.mjs` under plain Node, **54 checks**: a project's rules; `projects.json` read strictly (13 kinds of wrong file); making, renaming and the same name twice; instructions (the question and its words, a no, a saved key, a lookalike, turning off); files (the dialog, the question naming each, a file already there, a no, past 20, taking one off); deleting (its notes, its files offered for deletion); a damaged file and its way out; sealing; one change at a time; the chat file version 5 (written only for a chat in a project, read strictly, back to version 3 when the chat leaves it, a backup holding it); a project's notes and deleting them; source checks. `verify-10-5w.mjs` in the real window, **38 checks, on the dev app and on the built one**: the page, a project made, instructions (a no, a yes), files (the open dialog and the question, a duplicate, a no), the chat moved in ("Project: name", the file version 5, History naming it and filtering, "New chat in this project", "New chat" in none), renaming, a project's note, deleting (asks first, its chats stay, its note and files go), a damaged file, a chat saved for a project that is not there (saved in none), encryption, the bridge, 420 and 280 px, no console errors. **47 negative controls, all caught**: 15 under Node and 11 in the window for this slice (`make-specs105.mjs`) and the 21 older ones repointed; two of mine were at first not caught (the sweep's use of the projects' files, checked only by its source loosely; a chat saved for a project that is gone, not tried in the window) and their checks were made sharper. Three older window controls are caught by the suite stopping at the very wait that reads what they sabotage, as in Stages 4 and 7.4. A hash of every file of `src/` and `registry/` was the same before and after.

**Not checked (10.5).** A project's parts in a request (10.6); backups holding the projects (10.7; until then a backup holds a chat in a project as its version 5 text, which an older build will not restore); paste and drop onto a project (files come only through the open dialog).

### 10.6: a project's parts in every request of its chats

**What it adds.** A request now names the chat's project (`projectId`, checked to be an id; absent for a chat in no project, which is sent exactly as before), and **main reads that project from its own file** for every request: the page only names it. A project that is not there any more (deleted while its chat was open) is none; a `projects.json` that cannot be read refuses the request ("Nothing was sent: your projects could not be read (...). Open Projects to delete them all; the app keeps a copy of the file.") and a chat in no project still goes. **The prompt**, in this order: the app's rules; the notes (every chat's, then the project's, as information); the instructions for every chat; **the project's instructions**, after "The person has given these instructions for the project this chat belongs to:"; then the chat's own, under the line that says they win where they differ. The project's name is never part of it. **The project's files go at the start of the conversation**, ahead of the first message's own (a file both carry is sent once), so a provider's cache keeps them from one message to the next; they are read and checked like the chat's own (D-037) and **count against the caps of one request together with them**. A refusal over the caps adds "The project's files count too: they go with every message of its chats."; the page turns Send off with the same reason before anything is sent (it now also checks the 20 MB, 100 pages and 600,000 characters of one request, which only main checked before). The guess before a request counts them (they are in it); a limit's refusal and the question before a large request say how many of the files are the project's. A saved API key in the project's instructions refuses the request, as for every other part.

**Older suites.** Eight negative-control specs pointed at lines the project's part moved (the prompt's order, the builder, the refusal over the caps, the page's file check, App's chat view) and were repointed with the same meaning.

**What was checked.** `verify-10-6.mjs` under plain Node, **25 checks**: the prompt with the project's part in every combination and the golden of 70 requests; the request check; the notes about a project's files in a refusal and in the question; the page's reason for Send being off (pages, size, a file both carry, a model that cannot read a project's PDF); source checks (`chat.ts` reads the project from main's file, puts its files first, reads its notes, checks its instructions for a key; the page sends only the id). `verify-10-6w.mjs` in the real window, **14 checks, in dev and in the built app** (the built app's first run after a build stopped once waiting for the Projects page and passed whole when run again): a project's note, instructions and file in the request in that order and its file before the first message's text, once per request, its name sent nowhere; the chat's own instructions after it; a chat in no project untouched; the question before a large request naming the project's file; a saved key in the project's instructions; a damaged `projects.json` refusing a project chat and not another; a project deleted while its chat is open. **29 negative controls, all caught** (12 under Node, 9 in the window, and 8 older ones moved to the new code: three of 10.2 and its window's prompt order, 7.4's lead, two of 9.3, 7.6's keyboard order), every file put back byte for byte. The regression's Node, window and Stage 4 parts (r106, 67 runs) found 4 tests that still expected requests without a project (9.3, 10.2 and 10.4 source checks, 10.5's window looking for no project instructions); fixed, and each passes again.

**Not checked (10.6).** A real provider's cache with a project's files (the order is chosen for it; no real API call); a project whose files alone pass the caps in the window (the Node suite checks the page's reason, and main's own check is Stage 9's).

Status: accepted (10.1 to 10.6). The stage grows here slice by slice.
