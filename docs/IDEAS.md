# Ideas (v0.1)

> Parking lot. Unvetted ideas live here so they do not clutter the roadmap. Nothing here is planned.

- Pick the best model for a message by itself (Stage 6 only shortlists models for a task the person names, and has no scores, D-023)
- Compare two models' answers side by side
- Support local models (for example through Ollama)
- Show running cost per conversation
- Keyboard-first command palette
- Export a conversation to Markdown
- Syntax colours in code blocks (a package, or a small tokenizer of our own for a few languages; D-025)
- The parts of Markdown the reader leaves out: task lists, footnotes, setext headings, reference links, entities (D-025)
- A deny-by-default permission handler for the window, so the page can ask for nothing it does not use (it uses the clipboard write); Electron grants every request when none is set (D-025)
- Keep the old reply when one is regenerated, and the later messages when one is edited (versions of a reply or of a chat; D-026 replaces them)
- Ask before Regenerate replaces a reply (D-026 does not)
- Automated tests for `useChat` (needs a test runner; none is set up, see D-007)
- Show what each reply cost (the API reports token counts with every reply)
- Server-side refusal fallbacks for the provider, once there is a real key to try them with (D-012)
- Use Chromium's network stack (`net.fetch`) for the provider calls, so a system proxy is honoured
- Trim or summarise old turns when a conversation gets long (D-013)
- Check `registry/models.json` before every build with the same validator the app uses (`src/shared/registry.ts`),
  so a typo cannot ship (D-014)
- Update the registry without a new release: a checked copy in the data folder, written in place (D-010, D-014)
- Remember an effort level per chat instead of per model, or let a message ask for one (D-024 keeps one level per model)
- Show what the extra thinking of a high effort level cost, once there is a cost display (D-024)
- When a model answers "not found" (for example once Haiku 4.5 is retired), offer to switch to another
- Show the retirement date of a model in Settings (needs a field in the registry)
- Rename a saved conversation (the title is the first message; editing the file by hand already works)
- Search saved conversations, and group them by day
- A sidebar for History instead of a dialog (wide windows), keeping the dialog for narrow ones
- Export or copy a saved conversation as Markdown (the idea above, now with something to export from)
- "Delete all", and an option to clear conversations older than some age
- Encrypt saved conversations with the operating system's secure storage (D-016 says what it would cost)
- Run `tools/regress.mjs` automatically (a pre-release script or CI); today it is run by hand, about 40 minutes
- Gemini as the third provider (an adapter and a registry entry; the provider tables will not compile without them, D-018)
- Windows Credential Manager instead of safeStorage files for the keys (needs a native keyring package; D-020)
- Chat Completions as a fallback for OpenAI if the Responses API misbehaves (D-022)
- Image input and tools: the registry already records which models take them (D-019)
- A cost display per reply (the usage is already read and logged, D-021; needs the prices of cached tokens too)
- Run `tools/regress.mjs` automatically before a release; today it is run by hand
