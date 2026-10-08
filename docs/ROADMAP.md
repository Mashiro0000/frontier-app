# Roadmap (v0.1)

> Stages 0 to 9 are done (v0.1, below; Stages 7 to 9 are in v0.2), and Stage 10 is being built (its plan approved on 7 October 2026). **The plan for Stages 7 to 18 is at the end of this file (v0.2)**; it is a plan the owner approves stage by
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

## Stage 9 - Images and files in (done: plan approved 6 October 2026 with the owner's answers "your picks"; 9.1 the store, 9.2 getting files in, 9.3 sending and saving, 9.4 costs and limits, 9.5 backups with files, 9.6 the stage's threat note and the full regression)

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
- [x] (9.6, D-038) The stage's threat note and the full regression: 112 runs, 101 clean the first time; ten failed on older checks that listed the app's functions or a model's fields as they were before Stage 9 (updated, all pass), and one found a real fault from Stage 8 (Settings showed the sums of its last opening for a moment; fixed, with a check that does not depend on timing).

**Questions for the owner** (each changes the plan): (1) remove image metadata always (my pick), or show it and let you choose for each file? (2) PDF metadata: send it as it is with a note (my pick, no new package), or add a PDF library to remove it? (3) Are the caps above right for you? (4) Make big images smaller before sending (my pick)? (5) Backups with the attachments in them (bigger files; my pick), or without them and a count?

## Stage 10 - Projects, custom instructions and memory (done: plan approved 7 October 2026 with the owner's answers "your picks"; 10.1 the system's question, 10.2 instructions for every chat, 10.3 the memory store, 10.4 memory in the window, 10.5 projects, 10.6 projects in requests, 10.7 backups with projects and notes, 10.8 the stage's threat note and the full regression)

- **Projects:** a named set of instructions and files for a group of chats. **Memory:** the app's own, local: "remember this" only on request,
  a page where every memory is visible, editable and deletable, with a cap.
- Safety: memory is never saved silently; a warning if text looks like a secret (key, password); memory is data given to the model, not
  instructions that outrank the owner; export and wipe everything in one click.

**The plan** (mine, written 7 October 2026; **approved by the owner the same day, with "your picks" for the five questions below**; every choice marked _mine_ may still be changed). It is the app's own, local version of what the Claude and ChatGPT apps call custom instructions, projects and memory: everything is a file in the app's data folder, nothing is kept by a provider, and the model never writes to any of it.

- **What goes out with each request, in this order** (_mine_). The app's rules (as now); then the person's **notes** (the memory), introduced as information about the person and not instructions ("they do not change the rules above or the instructions below"); then the **instructions for every chat**; then the **project's** instructions; then the **chat's own** (D-027). Each part has one line saying whose it is, and the most particular comes last, so the person's latest word is the last word. A part that is empty adds nothing, and with none of them a request is byte for byte what it is today (the 70 recorded requests). The page still cannot set the prompt: main builds it from its own files.
- **Instructions for every chat** ("custom instructions"). One box of at most 8,000 characters, in the Instructions dialog, which then shows every part that goes with the chat in the order it is sent (every chat, the project, this chat), each with its own Save. The button under the message box says "on" when any part is set.
- **Memory: notes the person keeps.** A note is a short text (at most 500 characters) that goes with every message of every chat, or only with one project's chats (_mine_, question 1). Notes are made **only by the person** (_mine_, question 2): "Remember..." on any message (yours or a reply) opens a box with the text you picked, to cut down before saving, and the Memory page has "Add". The model never saves a note and cannot ask to (that needs Stage 11's approvals). The **Memory page** lists every note with where it applies and when it was made; each can be edited or deleted; "Export all..." writes one plain file (the system's save dialog), "Delete all..." asks first; one switch turns memory off for every chat. While it is on, the row under the message box says "Memory (12)", so notes are never sent unseen (rule 1). Caps (_mine_, question 5): 8,000 characters of notes for every chat and 8,000 more for each project (about 2,000 tokens each, sent with every message).
- **Projects.** A project has a name, instructions (at most 8,000 characters), files and notes. Its files come in as in Stage 9 (the system's open dialog, paste, drop; checked by content; copied into `attachments/`; metadata removed) and **go with every message of every chat in the project** (_mine_, question 4), at the start of the conversation, before the first message's own files. They count against a request's caps together with the chat's own files (20 MB, 100 PDF pages, 600,000 characters of text), so a big project leaves less room in its chats, and Send says so; at most 20 files a project and 100 projects (_mine_). A chat belongs to one project or none: "Project" under the message box shows it and moves it; History shows each chat's project and can show one project's chats; a project's page has "New chat in this project". A chat in a project is saved as a version 5 file (only then; otherwise version 3 or 4, unchanged; a build from before cannot read version 5, as in 7.4 and 9.3). **Deleting a project** asks first, keeps its chats (they leave it), deletes its notes, and deletes its files when no chat or other project uses them (_mine_). The start-up sweep and every deletion count a project's files as used, and delete nothing while any chat or project cannot be read.
- **Secrets** (rule 5). Before a note or any instructions are saved, main looks for secrets: **one of the API keys saved in the app is refused** outright (the sentence says whose key, never the key), and text that **looks like a key or a password** (the providers' key shapes, common token shapes, a private-key block, "password:" and the like, a long random-looking string) gets a warning that shows the part (masked) and needs "Save anyway" (_mine_).
- **Asked outside the page** (_mine_, question 3; rule 3). Saving a note, instructions of any kind, or a project's files asks the person in a **Windows dialog** opened by main, which shows the text (its start and its length when it is long). The page cannot answer it, so neither a fault nor a hostile page can make the app send something new with every message without a yes. The same dialog then guards raising a limit, "No limit" and "Never ask", which closes the gap D-033 found (recommended before Stage 11). Deleting asks first, as now.
- **Costs and limits** (rule 6). The guess before a request counts the notes, all the instructions and the project's files, so the limits and the question before a large request (8.3) see them; the question and a limit's refusal say when a project's files are most of it, and that they go with every message. The providers' caches (Anthropic's, on as now; OpenAI's, automatic) make the repeats cheaper; the guess does not count on them.
- **Saved, sealed and backed up** (rule 9). Files in the data folder (`instructions.json`, `memory.json`, `projects/`), written as chats are (D-016), **sealed like the chats when encryption is on** (D-035) and converted with them. When one cannot be read (a damaged file, a key that cannot be used), nothing that needs it is sent until the person deals with it, and the app says what, why and the way out: a chat is never sent without its instructions or notes in silence. A backup holds the projects and the notes too (backup version 3, only when there are any; versions 1 and 2 still restore), and a restore adds them, never replacing (_mine_).
- **Untrusted** (rule 2). A project's files are data for the model, as in Stage 9. A note made from a reply is text the person read and chose. Nothing in this stage can act on what a file, a note or a reply says (there are no tools before Stage 11).
- **Not in this stage:** the model saving or suggesting notes (Stage 11's approvals come first); searching or quoting other chats ("reference chat history"); projects too big for one request (that needs a search over the files: another API and its cost); sharing projects, or bringing in memory or projects from another app; a "no memory" switch per chat (one switch covers every chat).

**Slices** (each with its own Node and window suites, negative controls and decision entry, as before):

- [x] (10.1, D-039) The Windows question: shown by main, answered only there, one answer per question; and the limits behind it (raising a limit, "No limit", a higher amount to ask above, "Never ask"; D-033's finding). One question at a time for the whole app, and three seconds of quiet after a no (the window suite found that a page could otherwise put the box straight back). Lowering asks nothing. Found on the way: Settings scrolled sideways at 280 px (Stage 8's Usage row), fixed. 90 checks under Node, 41 in the window (dev and built), the real Windows box once, and the older 8.2, 8.3 and 9.4 window suites answering it from main.
- [x] (10.2, D-039) Instructions for every chat: kept and sent by main (`instructions.json`, written and sealed like the chats, converted with them), saved after the system's question (turning off asks nothing; a chat's own instructions are not asked about, my choice), the look for secrets for both parts (a saved key refused, a lookalike only with "Save anyway", and again before every request), a damaged file refusing every request with a way out that keeps a copy, the order of the prompt (nothing set, or only a chat's own: every request byte for byte as before), the Instructions dialog with every part in send order, the cost guess. 118 checks under Node, 56 in the window (dev and built), 64 negative controls.
- [x] (10.3, D-039) The memory store in main, no window: `memory.json` (notes of at most 500 characters, 8,000 characters and 100 notes a place, for every chat or one project), the look for secrets, the Windows question for a new or changed note and for turning memory back on (deleting and turning off ask nothing there), sealed like the chats, a damaged file left alone with two ways out that keep a copy, the export to a plain file. Found on the way: a kept file now refuses to write what its own reader would refuse, and a short secret's mask shows only its first character. 74 checks under Node, 33 negative controls.
- [x] (10.4, D-039) Memory in the window: the Memory page (each note with when it was made, change, delete asking first, the switch, "Export all...", "Delete all..."), "Remember..." on any message (the selected part, or all of it), "Memory N" under the message box; the notes sent with every request right after the app's rules, as information and not instructions, and counted in the guess; a damaged file or a saved key inside a note refuses every request. 22 checks under Node, 59 in the window (dev and built), 34 negative controls.
- [x] (10.5, D-039) Projects: `projects.json` (a name never sent to the model, instructions after the system's question, files through the system's open dialog and a question naming each, kept by the sweep), the Projects page, chats in a project (file version 5, only then), "Project: name" under the message box, History by project, a project's notes, deleting a project (its chats stay; its notes and unused files go). 54 checks under Node, 38 in the window (dev and built), 47 negative controls.
- [x] (10.6, D-039) Projects in requests: main reads the chat's project for every request (the page names it only); its notes and instructions in the prompt, its files at the start of the conversation, the request caps shared with the chat's own files, Send off with a reason, the cost guess, the limits and the question naming the project's files; a damaged `projects.json` refuses a project chat's request. 25 checks under Node, 14 in the window, 29 negative controls; the regression's Node, window and Stage 4 parts (4 stale tests fixed).
- [x] (10.7, D-039) Backups version 3 with the projects and the notes (only when there are any; their lines checked as their own files check them, before the chats), a restore never replacing (the same left, a taken id a copy, a taken name "(2)", the caps, a saved key refused, the chats following their project), asked about once in the system's box for the window (a no adds the chats alone); sealed when encryption is on, as the stores write them. 54 checks under Node, 17 in the window, 44 negative controls; the regression's Node, window and Stage 4 parts (69 runs, all clean).
- [x] (10.8, D-040) The stage's threat note and the full regression: 131 runs, 129 clean the first time, every Stage 10 suite on both apps; the other two (registry scenarios whose app never started, at the moment the computer was used again) passed run again alone. No package, no network address, no change to the window's guards in the whole stage.

**Questions for the owner** (each changes the plan): (1) Notes for one project as well as notes for every chat (my pick), or one list for everything? (2) Notes made only by you, with "Remember..." and "Add" (my pick), or also an offer to save one when your own message starts with "Remember"? (3) The Windows dialog for saving notes, instructions and a project's files, and for raising a limit (my pick; one more click a save), or the app's own boxes only, as today? (4) A project's files sent with every message of its chats (my pick), or projects share only instructions and notes, and files stay in each chat? (5) Are the caps above right for you?

## Stage 11 - Tool-calling foundation, approvals, and web search (plan approved 8 October 2026: all five picks kept, one addition to 11.1; DONE and merged 8 October 2026)

- The permission system every later power uses: tool definitions, an **approval dialog** showing the exact action, per-tool and per-session
  scope, an **audit log** the owner can read, a **Stop everything** button, step and time caps. First tool: the providers' own web search,
  with sources shown.
- Safety: results are labelled untrusted and cannot trigger tools by themselves; tested against fake "malicious" pages and files that try to
  give the model orders; no tool runs without approval at first (a later "always allow this one read-only tool" is the owner's choice).

**The plan** (mine, written 8 October 2026 as `Frontier App Stage 11 plan.pdf`; **approved by the owner the same day with the five picks below kept and one addition: slice 11.1 also holds a test that no tool can read, write or list the app's data folder (the audit log, the notes and the instructions included), with a negative control that proves the test fails when the block is taken out**; every choice marked _mine_ may still be changed). It gives the app its first tool and, with it, the foundation that every later power (Stages 12 to 18: files, a browser, commands) will stand on. Initially nothing runs without the person's approval.

- **What Stage 10 hands to it.** The Windows message box that main opens and the page cannot answer (10.1) becomes the approval box. The data folder must stay out of every tool's reach. A note, an instruction or a file must never be what allows a tool call. The model never writes notes or instructions.
- **Approvals** (pick 1: ask before every search). Every tool call is shown in full: the tool, its exact arguments, and why the model asks. The question appears in the system's own box, which the page cannot answer. The scope is **per call**; "Allow for this chat" is a later choice and never the default; "Always allow" is not in this stage for any tool. Every tool starts switched off (rule 3).
- **Web search** (pick 2: provider-hosted only). The providers' own hosted tool, from Anthropic and from OpenAI. The app adds no network code of its own and never fetches a page itself. Sources (titles and addresses) are shown under the reply (pick 5: always); an address opens only after the person clicks.
- **Untrusted results.** Results are untrusted data, labelled so to the model and in the window; a result can never trigger a tool by itself.
- **Caps per reply** (pick 3: 5 steps and 60 seconds). Both are shown and changeable in Settings; when a cap is reached the reply stops and says why. _Mine:_ the 60 seconds are working time, so the time the person spends deciding in the approval box is not counted (otherwise a slow reader would use the cap up before saying yes).
- **Stop everything.** One button that ends the reply, cancels any running tool and denies any open question.
- **Audit log** (pick 4: kept for ever, with "Delete all"). A file in the data folder, written like the chats and sealed when encryption is on. It lists every approval, denial, call, result size, cost and stop, and is readable in a window. It holds no page text: only what was asked and which sources came back.
- **Cost.** Each search is counted in the estimate before the request and in the ledger, so it affects the limits and the question before a large request. **The price per search, from the providers' own pages (read on 8 October 2026, in 11.1): Anthropic $10 per 1,000 searches (a search that fails is not billed); OpenAI $10 per 1,000 calls for its `web_search` tool, whatever the model (its older `web_search_preview` tool is $25 per 1,000 for models that do not reason).** Both add the tokens that the search puts in the request, at the model's usual price. 11.6 puts these into the registry and the ledger.
- **How a hosted search is asked about** (_mine_, found in 11.1 from the providers' pages). A hosted search runs inside one provider request, so there is no moment between the model deciding to search and the search running at which the app could show the words and ask. To keep "ask before every search" with the exact words shown first, the model is offered an ordinary tool `web_search` (two arguments: the words, and why). When it calls it, main shows the question; after the person's yes, main makes a **separate small request** to the same provider with the hosted tool switched on and one search allowed, and hands what came back to the model as the tool's result (untrusted) and to the window as sources. The price of this: one more model request for each search, counted in the ledger. The other way (the hosted tool in the chat's own request, approved once for the whole reply) shows the words only after the search, so it does not meet "every tool call is shown in full" and is not used.
- **The data folder** (the owner's addition to 11.1). One guard in main decides, for every tool that takes a path, whether the path lies in the app's data folder (every spelling of it: other letter case, `..`, a junction or a link, a short name, the `\\?\` form, a share on this computer, a second name of the same file) and refuses it before anything is asked or run; a tool that searches or copies a whole folder is refused when that folder holds the data folder. No tool in this stage takes a path at all (searching needs none), so the test uses stand-in tools that read, write and list for real, and a negative control takes the block out and shows the test fail.
- **Not in this stage:** reading or writing the person's files; a browser the app drives; running commands (Stages 12 and 13); the model saving notes; "Always allow" for any tool; any package or network code in the app. No real API call, as always.

**Slices** (each with its own Node and window suites, negative controls, a decision entry, STEP-LOG and ROADMAP, as before):

- [x] (11.1, D-041) Tool registry and permission core in main: the tool definitions (a closed, checked, frozen shape; nothing is offered while a tool is off), the one place that decides (unknown tool, tool off, wrong arguments, a saved key in the arguments, a path in the data folder, a cap reached, the question, the record before the question and before the run, only a yes runs), the approval question in the system's box (the call in full, every value quoted and escaped), the reply's budget (5 steps; 60 seconds of working time, the time in the box not counted), deny by default; and, the owner's addition, the data-folder block with its test and negative control: 4,894 calls from eleven stand-in file tools in about forty spellings of every path of a scratch data folder, through junctions, a hard link, a `subst` drive and 8.3 names, all refused before any question, nothing read, listed or changed; the same calls with the block taken out all got through. Found in the providers' pages: the price (about one cent a search, both providers) and that a hosted search cannot be asked about search by search, so 11.3 runs it as a separate request after the yes. Nothing in the app calls the core yet (the built program is byte for byte the program it was). 313 checks under Node, 110 for the data-folder block, 24 in the window (dev and built), 109 negative controls; the regression's Node part, 34 of 34.
- [x] (11.2, D-041) The audit log: `audit/log.jsonl`, one line for each event of a tool call (refused, asked, answered, ran, result; every event names its call, a result names the sources that came back, never any page text), appended and read back from the disk, sealed like the chats when encryption is on and rewritten when it is turned on or off (a rewrite cut off by a crash is mended), rejecting any line it cannot keep (and then the core refuses the call before it asks or runs anything); the Tools page under the message box with the log (newest first, every outcome in words, sources as plain text, hostile words shown as text), "Export..." to a text file (never into the data folder) and "Delete all...", which is asked in the system's own box so that a page cannot wipe the record. 388 checks under Node, 43 in the window (dev and built), 80 negative controls; the older suites that list the page's functions or the encryption report were brought up to date.
- [x] (11.3, D-041) The provider loop: the model is offered the tools that are switched on (none is, until 11.4); when it asks for `web_search`, the core decides and asks in the system's box, and only on a yes a separate small request runs ONE hosted search (Anthropic `web_search_20250305`, OpenAI `web_search`, both through the real SDKs against the mocks) and its summary and pages go back to the model as text from outside; the model's turn is replayed unchanged (signatures, encrypted reasoning); every request and every search is a ledger record with the limits checked; steps and tool time capped (the clock stops while the model writes and while the person decides); Stop everything also closes an open question; `tools.json` (deny by default, kept like the notes, in the encryption flow). **Done and tested; not yet reachable: nothing in the app switches a tool on until 11.4.**
- [x] (11.4, D-041) The window for tools: the Tools page has the search's On/Off switch (ON asks in the system's own box, OFF does not) and the caps on one reply (a raise asks); the call stands in the reply where the model asked for it, in the audit log's own words; the pages come back under the reply, always, as buttons that ask before an address opens; the Stop button reads "Stop everything" once a tool is on; a reply with calls is saved as a version 6 chat (calls and pages' titles and addresses, never page text; checked strictly); the approval box names the provider. 110 checks under Node, 44 in the window (dev and built), 45 negative controls.
- [x] (11.5, D-041) Untrusted results: the rules for tools in the system prompt (only when a tool is offered), the pages under a reply labelled, nine hostile pages and a model that obeys them: asked again for each search, unknown tools and keys in words refused, the caps end it, nothing on the path of a tool can reach the person's things (import check), tools.json, notes, instructions and limits unchanged. 36 checks under Node, 13 in the window (dev and built), 11 negative controls.
- [x] (11.6, D-041) Costs and limits: the provider's fee for a search (one cent) is in the ledger line beside the tokens, in every sum, and reserved against the spending limits when the search request begins; a search the limits would refuse is not asked about (refused as `limit`); a failed search is not billed; the box and the Tools page say what it costs. "Ask first" is unchanged (it counts what a request sends). 30 checks under Node, 9 in the window (dev and built), 19 negative controls.
- [x] (11.7, D-041) Backups and encryption: encryption rewrites the audit log and tools.json with the chats, both ways (proved with the real files; sealed settings with a lost key mean every tool off); a backup carries chats with their tool calls (version 6) and, on purpose, NOT the audit log or the tool settings, so a file can never switch a tool on or write the log (a hostile backup is shown to change nothing). 20 checks under Node, 6 negative controls.
- [x] (11.8, D-041) The stage's threat note (nine threats and what stops each, five findings for the owner), the full regression (40 of 40 Node runs; 111 window, seed, scenario, Stage 4 and built-app runs, ten fixed or re-run after the first pass), the control gaps of 11.3 and 11.4 closed, then the merge.

**Questions for the owner** (each changes the plan; **answered 8 October 2026: all five picks kept**): (1) Ask before every search (my pick), or let the person allow searches for a chat? (2) Provider-hosted search only (my pick), or also a search the app runs itself? (3) Are 5 steps and 60 seconds per reply right (my pick)? (4) Keep the audit log for ever with a "Delete all" action (my pick), or for a set time? (5) Show sources always (my pick), or only when asked?

## Stage 12 - A code workspace: read and edit files in one folder (in progress)

- The owner picks **one folder**. The model can list and read files in it and **propose** changes as a diff; nothing is written until the
  owner approves each change, and the original is kept for undo. No commands are run in this stage.
- Safety: the folder is the boundary (paths resolved, symlinks and `..` refused, no hidden files like `.env` or `.git` internals read unless
  allowed one by one), size caps, every write logged and undoable, a dry-run view.

**The plan** (mine, written 8 October 2026 as `Frontier App Stage 12 plan.pdf`; **approved by the owner the same day: "all picks kept"**; every choice marked _mine_ may still be changed). It builds on Stage 11 and does not bypass it: the tool registry, the one permission core (`toolCore.ts`), the data-folder guard (its first real user: a path is judged against BOTH the workspace and the data folder), the audit log, the Tools page switches and caps, "Stop everything", the untrusted-text labels, and the system's message box with its one-question-at-a-time gate.

- **Three departures from the letter of Stage 11, decided knowingly.** (A) Reads are asked **once per reply**, not once per file: one reply that explores a project reads 10 to 30 files, the cap is 5 steps, and thirty boxes teach a person to click yes without reading. (B) A diff does not fit the box (2,000 characters, never shortened), so it is shown in full in a **Review window owned by main** (sandboxed, no Node, strict CSP, no navigation, no way for the chat page to script, read or click it) and **the yes is still the system's box**, which names the file, the counts and a fingerprint of the exact bytes to be written. (C) **The model has no "apply" tool**: it can only propose; the person starts the apply from the Review window, so a taken-over model cannot even make a write question appear.
- **The folder** (D1). Main opens the system's folder dialog; the page never supplies a path. Main resolves and judges it, then the system's box shows the real path before it is kept (`workspace.json`, a kept document: strict read, sealed with the chats, a damaged file means no workspace). Refused: a drive root, the user's folder itself and the app-data folders, Windows and Program Files, the data folder or a folder that holds it or lies inside it, a link or junction, a network location. One workspace for the whole app. Changing it asks again in the box; clearing it does not. It is checked again at every use.
- **The tools** (D2): `list_files(path)` (one level, at most 200 entries), `read_file(path, start_line, max_lines)` (UTF-8 text only), `propose_edit(path, find, replace)` (the text must occur exactly once), `propose_new_file(path, content)`. Paths are relative to the workspace; an absolute path is refused even when it points inside. **Create and edit only: no delete and no rename** in this stage. The Tools page shows one row, "Code workspace", one switch (three keys in `tools.json`); ON asks in the box, OFF does not.
- **Reads** (D3): the first read or list of a reply opens one box (the real workspace path, the provider that receives the text, the caps, what is excluded, the exact first call). Yes covers file reads and lists **for this reply only** and ends with the reply or Stop everything. Every read is still decided by the core in full, shown as a card in the chat (path and size, never content) and logged. Files in the one-by-one class are never covered. Proposals are inert and decided at apply.
- **Hidden and secret files** (D4), by name only (Node does not report the Windows Hidden attribute and the app starts no program). **Never** (refused, no question): `.git`, `.hg`, `.svn` and everything in them (_mine_, stricter than the roadmap), links of any kind, a file with two names, the data folder, `System Volume Information` and the recycle bin. **One by one** (its own box naming the file; nothing remembered, no allow-list): any name that begins with a dot and secret-looking names (`*.pem *.key *.pfx *.p12 *.ppk *.kdbx *.jks *.keystore`, `id_rsa*`, `id_ed25519*`, `id_ecdsa*`, `id_dsa*`, `credentials*`, `secrets*`, and `*.env`, _mine_). A file whose text holds a saved API key is refused. A proposal that changes a one-by-one file gets a red line; one for a file that runs commands when used later (`package.json`, `*.bat *.cmd *.ps1 *.vbs`, `.vscode\tasks.json`, `.github\workflows\`, `Makefile`) an amber one; a change that adds bidirectional-control or invisible characters ("Trojan Source") is refused at proposal.
- **The boundary** (D5). The data-folder guard first (block), then a workspace guard (containment): the path is resolved, every name below the workspace is looked at without following anything, and **a symlink, junction or reparse point anywhere on the way is refused** (Node reports a junction as a symbolic link, checked), and so is `..` that leaves, drive-relative and rooted paths, shares, devices, streams, `%VARIABLES%`, and a second name of a file. The class of a name is read off the REAL names (a short 8.3 name or another letter case cannot hide a dot). The tool gets only the real path the guards hand back. Not defended: a swap between check and use by another program (as in D-041); a write is also refused if the file changed since the diff the person saw.
- **Caps** (D6, _mine_): a file 256 KB (one read call returns at most 60,000 characters); 30 file calls and 200,000 characters returned in all per reply (the 5 tool steps stay for web search; raising either asks in the box); a proposal: find/replace 20,000 characters each, a new file 100,000, the result 256 KB, at most 10 per reply and 20 waiting; the undo store 1,000 changes or 200 MB (when full, applying is refused until the person clears old ones; nothing is dropped silently).
- **The Review window and the dry-run view** (D7). The whole unified diff (nothing left out), and the file as it would be, with counts, the line-ending style and BOM kept, and everything flagged; hidden and reversing characters shown as visible markers. "Ask to apply..." is enabled only after the diff has been scrolled to its end (main is told by the Review window itself); then the box asks: real path, new file or edit, +/- lines, resulting size, a 12-character fingerprint of the bytes to be written, any red or amber line, where the undo copy goes. The page's Changes list shows only titles and counts and an "Open Review window" button; it has no function that applies, approves or answers.
- **Undo** (D8, _mine_): a sealed journal, `workspace/changes.jsonl` in the app's data folder, **not in the workspace**, not in backups, not reachable by any tool (built on the audit log's machinery: appended, read back before the file is touched, one sealed line each, rewritten with the chats). Each line holds the whole original (or "new file") and the hashes before and after. **Undo** asks in the box and restores only if the file still equals what the change wrote. Order of an apply: the yes, the checks again, the undo copy written and read back, the write (a temporary file next to the target, then renamed; in place if the rename fails), read back and compared, the audit line; a failure after the file was touched restores it from the copy.
- **Cost, encryption, backups** (D9). File text enters later requests as tokens: the estimate, the ledger, the limits and the large-request question already count it (12.7 proves it with big files). `workspace.json`, the undo journal and the new audit kinds are sealed with the chats. Backups carry chats with their file-call notes and, on purpose, neither the workspace setting nor the undo journal. Diffs: our own small line-diff code, **no new package**.
- **Not in this stage:** deleting or renaming files; running anything (Stage 13); more than one workspace; a package or network code in the app; a real API call.

**Slices** (each with its own Node and window suites, negative controls, a decision entry (D-042), STEP-LOG and ROADMAP):

- [x] (12.1, D-042) The folder and the boundary, main only, nothing wired: `workspaceGuard.ts` (containment, links, the three classes), `workspace.ts` (the choice of the folder and `workspace.json`), `workspaceText.ts` (is it UTF-8 text), and a battery like 11.1's: 2,616 calls in about forty spellings against a scratch workspace and a scratch data folder with canaries (a folder outside, junctions out, back in and to the data folder, a chain, one that leads nowhere, hard links, a `subst` drive, 8.3 names, `\\?\`, streams, devices); all refused; the same battery with the boundary taken out got through. 262 checks under Node, 93 negative controls.
- [x] (12.2, D-042) Core changes: a workspace path and a long text as kinds of argument; a tool asked about by the reply (one box for the reply's file access, the calls after it recorded as "covered", a no kept for the rest of the reply, a hidden or secret-looking file asked about on its own); file calls with their own count (30) and total of text (200,000 characters) beside the 5 tool steps; eight new refusal codes and the "covered" answer in the record, the log's reader, the audit view and the chat's notes (a long text recorded by its length only). Proved with stand-in tools: 170 checks under Node, 84 negative controls; the Stage 11 Node and window suites clean on the changed core.
- [x] (12.3, D-042) The read tools and the window: `list_files` and `read_file` in the loop (one box for the reply, one for each hidden or secret-looking file, the names and the text labelled as text from outside, a file with a saved key never sent); the Tools page "Code workspace" section (the folder dialog opened by main, the box that names the folder, the switch that asks, Clear); the workspace service and `window.api.workspace` (four functions, none takes a path); **the hostile-file tests that 11.5 could not have** (six files that give orders and a model that obeys them: every order met a box or a guard). 124 checks under Node, 36 in the window (dev and built), 85 negative controls. (The caps are constants for now; making them settings that ask when raised is left for 12.7.)
- [x] (12.4, D-042) Proposals: `propose_edit` (the text to find occurs exactly once; line endings, byte-order mark and size kept) and `propose_new_file`; no tool applies; hidden and reversing characters in new text refused (23 of them); the line diff of our own (checked against the textbook method on 400 random pairs and against a patch applier on 300 random changes); the fingerprint of the exact bytes and the checksum of the file as it was; two flags (secret, runs commands); an in-memory store (20 waiting, 10 a reply). 99 checks under Node, 40 in the window (12.3's suite gained a section), 79 negative controls.
- [ ] (12.5) The Review window and the Changes list.
- [ ] (12.6) Apply and undo.
- [ ] (12.7) Cost, encryption and backups.
- [ ] (12.8) The stage's threat note, the full regression, the merge.

**Questions for the owner** (**answered 8 October 2026: "all picks kept"**): (1) one reading box per reply, or a box per file? (2) the diff in a main-owned Review window with the system's box as the yes, or small edits only inside the box? (3) apply is the person's action, no apply tool for the model? (4) create and edit only, no delete or rename? (5) `.git` internals never readable, or one by one? (6) dot-files and secret-looking names one by one, nothing remembered? (7) the caps above? (8) undo copies in a sealed journal in the data folder, outside the workspace and outside backups? (9) one workspace for the whole app? (10) our own small diff code, no new package?

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
