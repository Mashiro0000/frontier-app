# Roadmap (v0.1)

> Stub. Stage 0 is done; everything after it is a tentative outline, not a commitment.

## Stage 0 - Shell (done)

- [x] Electron + Vite + React + TypeScript scaffold (electron-vite, `react-ts` template)
- [x] Empty window showing "Frontier App"
- [x] `docs/` stubs, `registry/` templates, `src/{main,preload,renderer,shared}`

## Stage 1 - Chat UI (tentative)

- Message list, input box, basic layout
- Fake/echo replies so the UI can be built before any provider exists

## Stage 2 - First provider (tentative)

- One model provider called from the main process
- Settings screen and safe per-user storage for the API key

## Stage 3 - Registry in use (tentative)

- Fill `registry/models.json`, load it at startup
- Model picker driven by the registry

## Later (tentative)

- Conversation history on disk
- More providers
- Use `registry/rankings.json` to suggest a model per task
- Packaged installer for Windows
