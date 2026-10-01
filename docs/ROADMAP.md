# Roadmap (v0.1)

> Stages 0 to 6 are done (v0.1, below). **The plan for Stages 7 to 18 is at the end of this file (v0.2)**; it is a plan the owner approves stage by
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
   delete; an option to encrypt them (Stage 8). Deleting something asks first.
10. **Few, vetted dependencies.** Each new package is justified in `docs/DECISIONS.md`, checked with `npm audit`, pinned, and preferably free of
    install scripts. Electron is kept current.
11. **Every stage ends with:** a short threat note in `docs/DECISIONS.md` (what could go wrong, what stops it, what is left), the full
    regression (`tools/`), and a list of what was NOT checked. I report what is proven and what is not.
12. **I stop and ask before:** adding a new kind of power (file write, command run, network from a tool, microphone), adding a dependency with
    install scripts, publishing or pushing anything, or touching your real profile or accounts.

## Stage 7 - Chat polish (not started)

- Markdown with code blocks, tables, lists; **copy** buttons; **regenerate**; **edit and resend**; a system prompt of your own per chat.
- An **Effort** control (a Faster to Smarter slider or menu, like the Claude desktop app's) next to the model menu. It offers only the levels
  the registry lists for the chosen model (`capabilities.effortLevels`), and is hidden for a model that takes none (Haiku 4.5). The choice is
  kept per model by the main process, which checks it against the registry again (as it does the model choice), and the default stays what
  `registry/models.json` says until the owner changes it.
- Safety: a sanitising renderer (D-009), no raw HTML, links are shown as text and open in the browser only after a click on an https address, no
  image or resource loads by itself, nothing can navigate or script the app window. Higher effort is billed as extra output (thinking), so the
  control says so, and Stage 8's spending limit must count it.

## Stage 8 - Usage, cost and spending limits, optional encrypted history (not started)

- Show tokens and cost per reply, chat and day; a **daily and monthly limit** that stops requests and says why; a confirmation before a
  reply that would be very large. An option to **encrypt saved chats** (key held with the OS protection as the API keys are).
- This is the safety foundation for everything that can loop or spend. Nothing in Stages 11 to 13 is built before it.

## Stage 9 - Images and files in (not started)

- Attach or paste images, PDFs and text or code files; the models that accept them get them; a preview of exactly what will be sent.
- Safety: type checked by content, size and count caps, no path tricks, files copied into the app's data folder (the original is never
  modified), a clear note that attachments go to the provider, EXIF and metadata shown or stripped, history size limits kept.

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
