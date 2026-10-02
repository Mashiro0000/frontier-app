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
