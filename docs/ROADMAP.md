# Roadmap (v0.1)

> Stub. Stages 0 and 1 are done; everything after them is a tentative outline, not a commitment.

## Stage 0 - Shell (done)

- [x] Electron + Vite + React + TypeScript scaffold (electron-vite, `react-ts` template)
- [x] Empty window showing "Frontier App"
- [x] `docs/` stubs, `registry/` templates, `src/{main,preload,renderer,shared}`

## Stage 1 - Chat UI (done)

- [x] Message list, input box, basic layout (header, scrolling list, input box at the bottom)
- [x] Fake/echo replies so the UI can be built before any provider exists. The echo streams word by
      word and can be stopped, because real providers do both
- [x] No new packages; `src/main` and `src/preload` untouched

## Stage 2 - First provider (tentative)

- One model provider called from the main process
- Settings screen and safe per-user storage for the API key
- Replace the renderer-side `echoReply` with a reply function that asks the main process over IPC.
  Same `ReplyFn` shape, so the chat components should not need to change (see D-008)
- Before the first network call: settle D-003 (Electron upgrade) and D-004 (`sandbox: true`)

## Stage 3 - Registry in use (tentative)

- Fill `registry/models.json`, load it at startup
- Model picker driven by the registry

## Later (tentative)

- Conversation history on disk
- More providers
- Use `registry/rankings.json` to suggest a model per task
- Packaged installer for Windows
