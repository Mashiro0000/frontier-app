# Ideas (v0.1)

> Parking lot. Unvetted ideas live here so they do not clutter the roadmap. Nothing here is planned.

- Auto-suggest the best model for a message using `registry/rankings.json`
- Compare two models' answers side by side
- Support local models (for example through Ollama)
- Show running cost per conversation
- Keyboard-first command palette
- Export a conversation to Markdown
- Render Markdown in replies (code blocks, lists), with a sanitising renderer (see D-009)
- Copy button on each message
- Retry / regenerate the last reply
- Automated tests for `useChat` (needs a test runner; none is set up, see D-007)
- Show what each reply cost (the API reports token counts with every reply)
- Server-side refusal fallbacks for the provider, once there is a real key to try them with (D-012)
- Use Chromium's network stack (`net.fetch`) for the provider calls, so a system proxy is honoured
- Keep the mock Anthropic server and the DevTools check scripts in the repo (for example under `tools/`) as
  the project's automated checks (see D-007)
- Trim or summarise old turns when a conversation gets long (D-013)
- Check `registry/models.json` before every build with the same validator the app uses (`src/shared/registry.ts`),
  so a typo cannot ship (D-014)
- Update the registry without a new release: a checked copy in the data folder, written in place (D-010, D-014)
- Name the model that wrote each reply, now that the model can change in the middle of a chat (D-015). History saved
  before this is added will not say; the page would need to be told by main which model answers (D-017)
- Let the person choose the effort level per model (the registry already holds one level per model)
- When a model answers "not found" (for example once Haiku 4.5 is retired), offer to switch to another
- Show the retirement date of a model in Settings (needs a field in the registry)
- Rename a saved conversation (the title is the first message; editing the file by hand already works)
- Search saved conversations, and group them by day
- A sidebar for History instead of a dialog (wide windows), keeping the dialog for narrow ones
- Export or copy a saved conversation as Markdown (the idea above, now with something to export from)
- "Delete all", and an option to clear conversations older than some age
- Encrypt saved conversations with the operating system's secure storage (D-016 says what it would cost)
- A Retry button on a failed reply (D-013); a saved conversation makes it more useful
- Keep the scripts that checked Stage 4 (the store suite, the window suites, the seeded and crash scenarios) with the
  rest of the verification tools if they are ever kept in the repository (see the `tools/` idea above)
