# Roadmap (v0.1)

> Stub. Stages 0 to 6 are done; everything after them is a tentative outline, not a commitment. Stage 4 was
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

## Later (tentative)

- A third provider (Gemini): a registry entry, an adapter, and its rows in the provider tables
- Rankings with real scores (and one suggested model per task), once a source compares these models on one scale
- Packaged installer for Windows
