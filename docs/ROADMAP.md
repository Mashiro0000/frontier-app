# Roadmap (v0.1)

> Stages 0 to 7 are done (v0.1, below; Stage 7 is in v0.2). **The plan for Stages 7 to 18 is at the end of this file (v0.2)**; it is a plan the owner approves stage by
> stage, not a commitment. Stage 4 was
> not written down in advance: the roadmap's "Later" list began with conversation history, and D-010, D-013 and
> the architecture notes all named it as the next piece of work, so that is what Stage 4 became.

## Stage 0 - Shell (done)

- [x] Electron + Vite + React + TypeScript scaffold (electron-vite, `react-ts` template)
- [x] Empty window showing "Frontier App"
- [x] `docs/` stubs, `registry/` templates, `src/{main,preload,renderer,shared}`

## Stage 1 - Chat UI (done)

- [x] Message list, input box, basic layout (header, scrolling list, input box at the bottom)
- [x] Fake/echo replies so the UI can be built before any provider exists. The echo streams word by
      word and can be stopped, because real providers do both
- [x] No new packages; `src/main` and `src/preload` untouched

## Stage 2 - First provider (done)

- [x] D-003 settled: Electron 39 upgraded to 44.5.1, `npm audit` clean (Stage 2.1)
- [x] D-004 settled: `sandbox: true`, narrow preload, navigation lock (Stage 2.2). Both decisions
      are done before any network code exists
- [x] One model provider called from the main process: Anthropic, `claude-opus-5-5` (Stage 2.4, D-012)
- [x] Settings screen and safe per-user storage for the API key (Stage 2.3)
- [x] Replace the renderer-side `echoReply` with a reply function that asks the main process over
      IPC. Same `ReplyFn` shape, so the chat components did not need to change (Stage 2.4, D-008)

## Stage 3 - Registry in use (done)

- [x] `registry/models.json` filled with the four current Anthropic models, embedded in the build, loaded at
      startup and checked strictly. A broken file shows "Models unavailable" and never falls back to a hidden
      list (Stage 3.1, D-014)
- [x] The provider builds its request from a registry entry: the model, its `effort` setting (none for
      Haiku 4.5, which rejects it) and its output limit. The default model's request is unchanged (Stage 3.2)
- [x] The main process keeps the model choice and saves it in `preferences.json`; the page can only pick a
      model the registry offers (Stage 3.3, D-015)
- [x] Model menu in the header, driven by the registry; Settings shows the chosen model's details and
      prices (Stage 3.4)
- `registry/rankings.json` was not touched: it is still an empty template, for "Later"

## Stage 4 - Conversation history (done)

- [x] Every conversation is saved on disk as it goes: one plain JSON file each in `conversations/` in the per-user
      data folder, written copy-then-delete with a recovery rule for a crash in the middle of a write, read back,
      and tested in an EFS-encrypted folder (Stage 4.1 and 4.2, D-016)
- [x] The page sends the whole conversation, main checks and writes it. The message is saved at once, a streaming
      reply at most once a second, a finished or failed reply at once; closing the window or quitting waits for
      the save (Stage 4.2 and 4.3, D-017)
- [x] A **New chat** button and a **History** dialog in the header: open a saved chat and carry on, or delete one
      (with a question first). The app opens on an empty chat (Stage 4.3 and 4.4, D-017)
- [x] Damaged or hand-edited files are counted, named in the log by id, and left alone; the dialog says where
      the files are and that the app does not encrypt them (Stage 4.1 and 4.4, D-016)
- No new packages. The chat's own seam (`ReplyFn`, `useChat`) is unchanged apart from one `load` function, and the
  input box takes a prop so that it can have the focus after New chat

## Stage 5 - Second provider (done)

- [x] A provider layer: one interface (list models, stream a reply, read the usage, explain an error) with one adapter per
      provider; Anthropic became the first adapter with no change in behaviour (Stage 5.1, D-018)
- [x] The registry (schema 0.3) says what each model can do and which effort levels it takes (Stage 5.2, D-019)
- [x] One encrypted key per provider, and a Settings section for each with Save, Test (a free call) and Remove (Stage 5.3, D-020)
- [x] Every reply records which provider and model wrote it; the saved chat is version 2 and an older chat is read as version 2
      without being rewritten (Stage 5.4, D-021)
- [x] OpenAI as the second provider: the Responses API through OpenAI's own SDK, three GPT-6 models in the registry (Stage 5.5, D-022)
- [x] The check scripts live in the repository: `tools/`, with a regression driver and negative controls
- One new package, `openai`. **No real call has been made to either provider**; the first one is the person's to make

## Stage 6 - Suggestions per task (done)

- [x] `registry/rankings.json` (schema 0.2) holds statements from the providers' own pages: this model is named for this task, in the page's
      words, with its address and the day it was read. **No scores**: none that compares these models could be backed (D-023)
- [x] A **Task** menu in the header (any task, chat, coding, writing, quick answer). It chooses nothing: the model menu marks the models named for
      the task with "(suggested)", for the models on offer whose provider has a key
- [x] Seven rows; chat, Fable 5.1, GPT-6 Luna and OpenAI's quick answer have none because nothing that was read says it. A broken file costs
      only the suggestions
- No new packages. `getStatus` gained `tasks` and `suggestions`

---

# Roadmap v0.2: from a text chat to the full desktop-assistant abilities (Stages 7 to 18)

**Goal (set by the owner on 2026-10-01):** Frontier App should do what the Claude and ChatGPT desktop apps do (formatted answers, images and
files, projects and memory, web search, tools, code work, connectors, voice, image generation), on the owner's own API keys, with safety built in
from the first stage and not added at the end. Where those apps rely on their vendors' servers (their memory, Projects, Artifacts, custom GPTs,
directory of one-click connectors, voice quality), Frontier builds its own local version through the providers' APIs; it will not be identical.

Order = value first, but **every stage that can do something (read files, write files, run commands, reach the network, spend money) comes
after the safety stage it depends on** (8 and 11). Stages marked _(investigate)_ need research before they can be promised. This is a plan, not a
contract: each stage starts with a short written plan that the owner approves (as Stages 5 and 6 did), and may be reordered or dropped.

## Safety rules for EVERY stage (the owner asked for these to be built in)

1. **Nothing leaves the PC unseen.** Anything sent to a provider, a tool or a website (a file, an image, a web page, a memory) is visible to the
   owner first or by an obvious, always-on indicator. No telemetry, no analytics, no crash reports sent anywhere.
2. **Untrusted content is data, never instructions.** Web pages, files, tool results, search results, images and the model's own output cannot
   cause an action by themselves (prompt injection is assumed). The model may only _ask_; a person approves.
3. **Default deny, least privilege, approval with the exact action shown.** Every new power (read a folder, write a file, run a command, call a
   connector, use the microphone) is off until switched on, limited to what the owner picked (one folder, one tool), shown exactly ("write
   `src/a.ts`, these lines", "run `npm test` in this folder"), and logged. Read-only is the default. A visible **Stop everything** works at all times.
4. **No chaining on its own.** A model cannot trigger the next risky step without a fresh approval; loops have step and time caps.
5. **Secrets stay secret.** Keys and tokens are encrypted on the PC (as now), never logged, never in a URL, never sent to the page, never in a
   chat or a file the model can read. I (the assistant) never ask for them or type them in; the owner enters them.
6. **Money has a hard stop.** Usage and cost are shown, and a daily and monthly limit stops requests (Stage 8). Anything that can loop (tools,
   search, code work) is built after that limit exists.
7. **Main process checks everything the page says** (as now): sizes, types, paths, ids. Files are checked by content, not by name; paths are
   resolved and kept inside the chosen folder; limits on size, count, time. The window stays sandboxed with its navigation lock and CSP; no
   `dangerouslySetInnerHTML`, no raw HTML from a model, no remote content loaded by itself.
8. **Fakes before the real thing.** Each capability is built and tested against local fakes, with deliberate breakages ("negative controls")
   proving each check can fail, before any real call or real account is touched. The first real use is the owner's own.
9. **Crash-safe and local.** Writes are copy-then-delete as now; history, memory and project data are plain files the owner can read, export and
   delete (a backup and a restore exist since Stage 8b.1 and 8b.2); an option to encrypt them (since Stage 8b.3). Deleting something asks first.
10. **Few, vetted dependencies.** Each new package is justified in `docs/DECISIONS.md`, checked with `npm audit`, pinned, and preferably free of
    install scripts. Electron is kept current.
11. **Every stage ends with:** a short threat note in `docs/DECISIONS.md` (what could go wrong, what stops it, what is left), the full
    regression (`tools/`), and a list of what was NOT checked. I report what is proven and what is not.
12. **I stop and ask before:** adding a new kind of power (file write, command run, network from a tool, microphone), adding a dependency with
    install scripts, publishing or pushing anything, or touching your real profile or accounts.

## Stage 7 - Chat polish (done: 7.1 Effort, 7.2 Markdown, 7.3 Copy, Regenerate and Edit, 7.4 Instructions, 7.5 the stage's threat note and the full regression, 7.6 the header)

Five slices, one commit each: 7.1 Effort, 7.2 Markdown, 7.3 Copy / Regenerate / Edit and resend, 7.4 Instructions per chat, 7.5 docs, threat
note and the full regression (D-028); and a sixth after them, at the owner's request: 7.6, New chat, History and Instructions move out of the header (D-029).

- [x] (7.2, D-025) Markdown with code blocks (language label and a Copy button), tables, lists, quotes, headings, links that ask first.
- [x] (7.3, D-026) **Copy** on each message, **regenerate** the last reply (Try again after a failure), **edit and resend** one of your own messages.
- [x] (7.4, D-027) **Instructions** of your own per chat: added after the app's rules, sent with every message of that chat, saved with it (the file is
      now version 3), shown as "on" while set, at most 8,000 characters, and described in the box (who gets them, billed, plain text on disk).
- [x] (7.1, D-024) An **Effort** control (a Faster to Smarter slider or menu, like the Claude desktop app's) next to the model menu. It offers only the levels
      the registry lists for the chosen model (`capabilities.effortLevels`), and is hidden for a model that takes none (Haiku 4.5). The choice is
      kept per model by the main process, which checks it against the registry again (as it does the model choice), and the default stays what
      `registry/models.json` says until the owner changes it.
- [x] (7.2, D-025; closed in 7.5, D-028) Safety: a renderer that cannot make HTML (D-009), no raw HTML, links are shown as text and open in the browser only after a click on an https address, no
      image or resource loads by itself, nothing can navigate or script the app window. Higher effort is billed as extra output (thinking), so the
      control says so, and Stage 8's spending limit must count it (the list of what it must count is in D-028).
- [x] (7.5, D-028) The stage's threat note across the four slices, the full regression (the Node, window, seeded, registry-scenario and Stage 4
      suites, and the built app), and the list of what was not checked.
- [x] (7.6, D-029) The header stays ONE row at the default window width, whatever is showing: **New chat**, **History** and **Instructions** moved out of it
      into a slim row under the message box (the owner's decision of 2 October 2026, after D-027 had reported that the header wrapped).

## Stage 8 - Usage, cost and spending limits (done: 8.1 the ledger, 8.2 limits, 8.3 the question before a large request, 8.5 the stage's threat note and the full regression; 8.4 moved to Stage 8b)

The owner's decisions of 2 October 2026: **the limits are the owner's own, with no preset numbers**; **encrypted history is its own later stage
(8b)**, with a tested backup and export before any encryption; **a guess marked "about" is counted** when a reply is stopped or fails with no usage
report, and replaced if a real report arrives.

- [x] (8.1, D-030) **The ledger and what it shows.** Every request to a provider is written to a plain file (`usage/ledger.jsonl`) by the main process, once
      before it is sent (a request that cannot be written down is not sent) and once when it ends. Tokens in four buckets (input, cache read, cache write,
      output including thinking), priced at the registry's four list prices per model (schema 0.4). Shown per reply, per chat, today and this month
      (Settings > Usage). A guess marked "about" when there is no report. Regenerate, Edit, the instructions and the thinking are all counted, because
      they are in the request or its report.
- [x] (8.2, D-031) **Limits.** A daily and a monthly limit, **set by the owner with no preset numbers**: on first run the app asks for both before the first
      send, and Settings has a deliberate "No limit" with a one-line warning. The main process checks before every request (send, Regenerate, Edit),
      counting what is already on the ledger and what is in flight, and refuses with a plain sentence that says which limit and why. The page cannot
      bypass it. Until both limits are chosen (an amount or "No limit") every request is refused; a missing or damaged `limits.json` counts as not chosen,
      never as "No limit". A reply that starts under a limit can end over it by at most what one reply can write (D-031 gives the figure).
- [x] (8.3, D-032) **A question before a very large request.** Before anything is written or sent, the main process works out the most the request could cost: what it
      sends (at the dearer of the two input prices) and a reply as long as its ceiling. When **what it sends** could cost more than **an amount of the owner's** (Settings > Large
      requests; $0.50 until chosen, or a deliberate "Never ask") it sends nothing, shows the figures ("Send this large request?": Send, Don't send, Escape is no) and waits for the
      yes. Nothing is written to the ledger while it waits, a yes is heard only for a question that is waiting, and the limits of 8.2 are checked after the yes exactly as before
      (a request they would refuse is not asked about). A damaged or unreadable `ask-first.json` means the default amount, never "Never ask".
- [x] (8.5, D-033) The stage's threat note across the three slices, the full regression (89 runs, the built app included), and the list of what was not checked. **One finding for the owner:**
      the page can raise or remove a limit, and choose "Never ask", with no answer from the person, so the limits stop a slip, a bug and a model's words but not a hostile page; a way
      to raise a limit that the page cannot do alone is recommended before Stage 11 (IDEAS).
- This is the safety foundation for everything that can loop or spend. Nothing in Stages 11 to 13 is built before it.

## Stage 8b - Optional encrypted history (done: 8b.1 backup, 8b.2 restore, 8b.3 the encryption, 8b.4 the key that cannot be read, 8b.5 the threat note and the full regression)

The riskiest part of the plan is that **losing the key means losing the chats**. So **a tested backup and restore path comes first**, before any encryption exists, and the owner is to try it on
real chats before the encryption is built (my call, 5 October 2026, when the owner left it to me). The owner's "go." of 5 October 2026 (after the backup was pushed) was taken as the go for 8b.3 to 8b.5; whether
the backup has been tried on real chats is not known, and it is still the thing to do before relying on encryption.

- [x] (8b.1, D-034) **Back up** one chat, or all of them, to **one plain file** (JSON Lines: a checksum on every chat, a last line that says how many) in a place the person
      chooses in the system's own save dialog. The page never names a path, and a backup is refused inside the app's data folder. The file is **read back and checked before it counts**, and again at its place;
      a disk fault leaves the old file as it was. Proved against a file cut at every length, a byte changed at every place, and nine disk faults.
- [x] (8b.2, D-034) **Restore** from such a file: first a **look** that adds nothing (what is new, already here, shares an id, cannot be used and why, which chats carry instructions, whether the file is whole), then an add with a
      one-use token. **It never replaces a chat**: the same chat is skipped, a different chat under the same id is added as a copy. 1000 chats out and back in give a backup that is byte for byte the first.
- [x] (8b.3, D-035) The option to **encrypt saved chats** (Settings > Saved chats): off until the owner turns it on, each chat file sealed by Electron's `safeStorage` (the same protection as the API keys; no key or cryptography of my own),
      the list built by opening each file, damaged or unopenable files left exactly as they are and counted, a way back to plain files (the system asks the person first), and **turning it on makes a verified backup first**, in the place the person
      chooses, before anything changes. The ledger (Stage 8) stays plain: it holds counts, times and ids, no message text. A backup stays a plain file.
- [x] (8b.4, D-035) **When the key cannot be read** (a reset profile, another account, no keyring): one module (`chatProtection.ts`) says how a chat may be written, and when the key cannot be used it **refuses**: the app says so, saves nothing,
      uses no key (the secure storage is never asked to encrypt), and leaves every file untouched. The way out is the backup (restored as copies) or turning encryption off; and if the key comes back, everything opens. Proved on this PC's real secure storage by deleting a scratch profile's `Local State`.
- [x] (8b.5, D-035) The stage's threat note (in D-035; the notes for 8b.1 and 8b.2 are in D-034) and the full regression: **96 runs, 94 clean**; the two others were one stale check (`verify-5-3` counted six buttons in Settings, now
      seven), fixed in the test and passed again on the dev and the built app.
- [x] (after 8b.5, D-035) Run once on the **owner's own profile with the real Windows dialogs** (backup, the restore preview, encrypt, a restart, the question, back to plain; the original file put back byte for byte afterwards); the
      sentences that carry a count now agree with it ("1 chat will be rewritten as a plain file"), checked by `verify-8b-wording.mjs` and 13 negative controls.

## Stage 9 - Images and files in (plan approved 6 October 2026, the owner's answers: "your picks"; done: 9.1 the store, 9.2 getting files in)

- Attach or paste images, PDFs and text or code files; the models that accept them get them; a preview of exactly what will be sent.
- Safety: type checked by content, size and count caps, no path tricks, files copied into the app's data folder (the original is never
  modified), a clear note that attachments go to the provider, EXIF and metadata shown or stripped, history size limits kept.

**The plan** (mine; approved by the owner on 6 October 2026 with "your picks" for the five questions below; every choice marked _mine_ may still be changed). The caps were checked against the providers' own pages in 9.1 and changed where they had to be (D-037): an image is **sent at most 2000 px a side** (Anthropic refuses any image over that in a request with more than 20), a PNG or JPEG may come in at up to 20 MB and is made smaller, a GIF or WebP goes as it is (at most 5 MB and 2000 px), animated images are refused, and the folder holds at most 5,000 files and 2 GB.

- **How a file gets in** (_mine_). "Attach..." under the message box opens the **system's own** open dialog from main, so the page never names a path (as for backups, D-034). An image can also be **pasted**, and files **dropped** on the message box; then the page hands main the bytes and a name, never a path. Only paths on a local drive; a network share, a device path or a link is refused, not followed.
- **Checked by content** (rule 7). Main decides what a file is from its first bytes: PNG, JPEG, GIF or WebP; PDF; or text (valid UTF-8, no control characters but tab and line breaks; the name's extension only labels the language). Anything else is refused with a sentence. An image's width and height are read from its header **before anything decodes it**.
- **Copied in, never changed.** The file is copied into the app's data folder (`attachments/`, named by its SHA-256, so the same file is kept once), read back and checked; the original is only read. **Image metadata is removed** (_mine_): EXIF and XMP from a JPEG (where a phone keeps the place a photo was taken) and the text chunks of a PNG, by rewriting the bytes, with no new package; the chip says so. **A PDF goes as it is**, its metadata included, and the chip says that too (removing it needs a PDF library, a new dependency: the owner's call).
- **Caps** (_mine_; the numbers are checked against the providers' own pages in 9.1): an image at most 5 MB and 8,000 px a side, a PDF at most 10 MB and 100 pages, a text file at most 200,000 characters (one message, `CHAT_LIMITS`); at most 10 files on a message and 20 MB in one request; a chat and the whole folder have caps (the "history size limits"), and a full folder refuses with a sentence, it never deletes anything to make room. A big PNG or JPEG is made smaller with Electron's own image tools before it is stored (_mine_; the provider would shrink it anyway, and it costs less), and the chip says so.
- **Shown before it goes** (rule 1). Each file is a chip on the message box (name, kind, size; a thumbnail for an image, the pages of a PDF, the first lines of a text) with "goes to Anthropic" or "goes to OpenAI" for the chosen model, and can be removed before sending. A model that cannot take a kind of file (the registry's `imageInput`, and a new `documentInput` for PDFs: schema 0.5) is not sent it: Send says why, and nothing is dropped silently.
- **Sent.** The request names attachments by id; main reads them from its own folder (the page cannot point at any other file) and builds each provider's form (Anthropic's image and document blocks; OpenAI's `input_image` and `input_file`). Text goes as text, marked as the content of a named file. **With no attachment a request is byte for byte what it is today** (a golden check, as in 7.4).
- **Saved and kept.** The chat file becomes version 4, with each message's list of attachments (a build from before cannot read it, as in 7.4). **When encryption is on (D-035), attachment files are sealed like the chats.** Deleting a chat deletes the files no other chat uses. A backup (D-034) holds the attachments too (backup format 2; a format 1 backup still restores).
- **Costs and limits** (rule 6). The guess made before a request counts images and PDF pages (an over-estimate, marked "about"), so the daily and monthly limits and the question before a large request (8.3) see them. The whole conversation is sent again with each message (D-028), attachments included, and the question says so.
- **Untrusted** (rule 2). What a file says is data for the model. Nothing in this stage can act on it (there are no tools before Stage 11).
- **Not in this stage:** images made by a model, audio, Office files (they need a converter), folders, web addresses, the providers' own file storage (everything goes inline).

**Slices** (each with its own Node and window suites, negative controls and decision entry, as before):

- [x] (9.1, D-037) The attachment store in main, no window: the checks by content, the header check before any decoding, the caps, metadata removal (and photos turned upright: Electron's decoder ignores their orientation), the copy read back, names by hash, sealing when encryption is on, deleting what no chat uses (wired to the chats in 9.3). 185 checks under Node, 14 with Electron's real image tools, 79 negative controls.
- [x] (9.2, D-037) Getting files in: "Attach..." (the system's open dialog, opened by main; one filter, "All files", after the real dialog opened on "Images" and hid PDFs), paste and drop as bytes (a paste that carries text pastes the text), the chips (a small picture, what it is, what was done to it, where it goes), removing one before sending. 30 checks under Node, 36 in the window (dev and built), the real dialog once, 33 negative controls.
- [x] (9.3, D-037) Sending and saving: both providers' forms (the mock learns them), a request without files byte for byte what it was (70 recorded requests), the registry's `documentInput` (schema 0.5) and Send off with a reason when the model cannot read a file, the chat file version 4 (only with files), History with the files' pictures, deleting a chat deletes its files, the start-up sweep, encryption of the files. 74 checks under Node, 58 in the window (42 also on the built app), 54 negative controls, all caught.
- [x] (9.4, D-037) Costs and limits: the guess counts files (an image by its size, a PDF by its pages, text by its length), so the question before a large request, the spending limits and the ledger see them, and the question and a limit's refusal say the files are sent again with every message. 21 checks under Node, 11 in the window (dev and built), 18 negative controls.
- [x] (9.5, D-037) Backups with attachments: backup version 2 (only when a chat has files) with each file's plain bytes after the chats, checked when read; a restore puts the files back within the folder's caps, sealed when encryption is on, and offers "Put back N attached files" when the chats are here but their copies are not; version 1 still restores. 33 checks under Node, 14 in the window (dev and built), 23 negative controls.
- [ ] (9.6) The stage's threat note and the full regression.

**Questions for the owner** (each changes the plan): (1) remove image metadata always (my pick), or show it and let you choose for each file? (2) PDF metadata: send it as it is with a note (my pick, no new package), or add a PDF library to remove it? (3) Are the caps above right for you? (4) Make big images smaller before sending (my pick)? (5) Backups with the attachments in them (bigger files; my pick), or without them and a count?

## Stage 10 - Projects, custom instructions and memory (not started)

- **Projects:** a named set of instructions and files for a group of chats. **Memory:** the app's own, local: "remember this" only on request,
  a page where every memory is visible, editable and deletable, with a cap.
- Safety: memory is never saved silently; a warning if text looks like a secret (key, password); memory is data given to the model, not
  instructions that outrank the owner; export and wipe everything in one click.

## Stage 11 - Tool-calling foundation, approvals, and web search (not started)

- The permission system every later power uses: tool definitions, an **approval dialog** showing the exact action, per-tool and per-session
  scope, an **audit log** the owner can read, a **Stop everything** button, step and time caps. First tool: the providers' own web search,
  with sources shown.
- Safety: results are labelled untrusted and cannot trigger tools by themselves; tested against fake "malicious" pages and files that try to
  give the model orders; no tool runs without approval at first (a later "always allow this one read-only tool" is the owner's choice).

## Stage 12 - A code workspace: read and edit files in one folder (not started)

- The owner picks **one folder**. The model can list and read files in it and **propose** changes as a diff; nothing is written until the
  owner approves each change, and the original is kept for undo. No commands are run in this stage.
- Safety: the folder is the boundary (paths resolved, symlinks and `..` refused, no hidden files like `.env` or `.git` internals read unless
  allowed one by one), size caps, every write logged and undoable, a dry-run view.

## Stage 13 - Running commands and code (not started, _investigate_ first)

- Run a command or a snippet **only with approval of the exact command**, in the chosen folder, with a time limit, output size cap, and the
  environment stripped of keys. Windows offers weak isolation (a user-level process is not a sandbox), so the stage starts with research on
  Windows Sandbox, containers or restricted tokens; if real isolation is not possible, commands stay "approve every single one", with no
  "always allow", and the limits are said plainly. Network from a command is off unless the owner allows it for that run.

## Stage 14 - Connectors through MCP (not started)

- An **MCP client**: add a local server (a command) or a remote one (a URL); the app lists its tools; every call goes through Stage 11's
  approval. Local servers first; remote servers with an OAuth sign-in later (the owner signs in; the assistant never enters passwords).
- Safety: servers are untrusted code and data: a local server is started only by the owner's explicit command, in its own process, with a
  stripped environment; tools default to **ask each time**; read-only tools are marked as such by the owner, never taken on the server's word;
  tokens in encrypted storage; tool results are untrusted text (prompt injection tests); a server can be disabled or removed at once.

## Stage 15 - Voice in and out (not started, _investigate_ the providers' voice APIs)

- Push-to-talk speech input and spoken replies through the providers' speech APIs.
- Safety: the microphone is used only while the button is held, with an always-visible indicator; no audio is stored unless the owner
  switches it on; the OS microphone permission is respected; audio goes to the provider only after the owner has been told so.

## Stage 16 - Image generation (and video, _investigate_) (not started)

- Generate images through the providers' image APIs and keep them in the chat and in a gallery. Video generation only if a provider
  offers a stable API at a price that makes sense; otherwise it is dropped and said so.
- Safety: cost shown before each generation and counted in Stage 8's limit; generated files are saved as plain files; no auto-open.

## Stage 17 - More models (not started)

- A third provider (Gemini) as a registry entry and an adapter, as D-018 prepared. Rankings with real scores (and one suggested model per task)
  once a source compares models on one scale (D-023).

## Stage 18 - Packaged installer and updates (not started)

- A Windows installer (`npm run build:win` has never been run), a signed build if a certificate is available, an update check that is
  **opt-in** and tells the owner what it downloads. macOS and Linux only if wanted; they have never been tested.
- Safety: no auto-update without consent, installer and updates verified by signature, no silent network use.

## What is deliberately not promised

Exact copies of vendor-only features (their memory, Projects and Artifacts, custom GPTs, the one-click connector directory), and any power
that cannot be made safe enough: if Stage 13's isolation cannot be built, commands stay manual and say so.
