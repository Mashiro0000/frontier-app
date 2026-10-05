# Ideas (v0.1)

> Parking lot. Unvetted ideas live here so they do not clutter the roadmap. Nothing here is planned.

- Pick the best model for a message by itself (Stage 6 only shortlists models for a task the person names, and has no scores, D-023)
- Compare two models' answers side by side
- Support local models (for example through Ollama)
- Keyboard-first command palette
- Export a conversation to Markdown
- Syntax colours in code blocks (a package, or a small tokenizer of our own for a few languages; D-025)
- The parts of Markdown the reader leaves out: task lists, footnotes, setext headings, reference links, entities (D-025)
- A deny-by-default permission handler for the window, so the page can ask for nothing it does not use (it uses the clipboard write); Electron grants every request when none is set (D-025)
- Keep the old reply when one is regenerated, and the later messages when one is edited (versions of a reply or of a chat; D-026 replaces them)
- Ask before Regenerate replaces a reply (D-026 does not)
- Default instructions for every new chat (a setting), or instructions per model (D-027 keeps one text per chat, and a new chat starts without)
- Ask before Escape throws away a long unsaved draft in the Instructions box (D-027 does not), and a mark on a chat that came from outside the app
- Automated tests for `useChat` (needs a test runner; none is set up, see D-007)
- Show what a reply cost on a chat opened from History (8.1 shows it live only: it is not saved with the message, so a chat file stays version 3; saving it would be version 4, and one more step a build cannot take back, D-030)
- Stop a reply in the middle when its running cost would pass a limit (8.2 only checks before a request, so one reply can end over; D-031)
- A warning in the empty chat or the chat bar when a limit is nearly used (say 80%), and a limit that resets on a day the person chooses (billing day) instead of the 1st (D-031)
- "Don't ask again in this chat" on the question before a large request: in a long chat on a dear model every message after the first asks, because the whole conversation goes out again (D-032 asks every time, and says why)
- Show in the large-request question how much of today's and this month's limit would be left if the reply ran to its ceiling (D-032 shows the request's own most; the limits' sums are in Settings > Usage)
- Work out whether the provider's cache is probably still warm (the last reply in this chat ended under five minutes ago) and say so in the question, since a cached conversation costs far less than the "up to" figure (D-032 can only say it may be)
- Make raising a limit, or choosing "No limit" or "Never ask", need an answer that the page cannot give by itself (a question main asks in an operating system dialog, or a confirmation the page cannot send): today `settings.setLimits` and `settings.setAskFirst` need none, so a hostile page could lift every protection of Stage 8. Recommended before Stage 11 (D-033)
- Keep the app's data folder (the ledger, `limits.json`, `ask-first.json`) outside every folder a tool may read or write, and outside what Stage 10's memory or Stage 12's folder choice can name, before Stages 12 and 13 (D-033)
- Measure the input guess (bytes divided by 3) against a real tokenizer for text that tokenizes badly: long random strings, minified code, runs of digits (D-030, D-033)
- Compact the usage ledger (it only grows: two lines a request; older months could be rolled into one line each), and export it as a CSV (D-030)
- The pricing modifiers the ledger does not apply: Fast mode, the Batch API, data residency (1.1x), web search, and discounts or tax on an invoice (D-030)
- Server-side refusal fallbacks for the provider, once there is a real key to try them with (D-012)
- Use Chromium's network stack (`net.fetch`) for the provider calls, so a system proxy is honoured
- Trim or summarise old turns when a conversation gets long (D-013)
- Check `registry/models.json` before every build with the same validator the app uses (`src/shared/registry.ts`),
  so a typo cannot ship (D-014)
- Update the registry without a new release: a checked copy in the data folder, written in place (D-010, D-014)
- Remember an effort level per chat instead of per model, or let a message ask for one (D-024 keeps one level per model)
- Show what the thinking of a high effort level cost on its own (8.1 counts it, in the output, but no provider reports it apart; D-024, D-030)
- When a model answers "not found" (for example once Haiku 4.5 is retired), offer to switch to another
- Show the retirement date of a model in Settings (needs a field in the registry)
- Rename a saved conversation (the title is the first message; editing the file by hand already works)
- Search saved conversations, and group them by day
- A sidebar for History instead of a dialog (wide windows), keeping the dialog for narrow ones
- Export or copy a saved conversation as Markdown (the idea above, now with something to export from)
- "Delete all", and an option to clear conversations older than some age
- Encrypt saved conversations with the operating system's secure storage (D-016 says what it would cost)
- Run `tools/regress.mjs` automatically (a pre-release script or CI); today it is run by hand, about 55 minutes
- Gemini as the third provider (an adapter and a registry entry; the provider tables will not compile without them, D-018)
- Windows Credential Manager instead of safeStorage files for the keys (needs a native keyring package; D-020)
- Chat Completions as a fallback for OpenAI if the Responses API misbehaves (D-022)
- Image input and tools: the registry already records which models take them (D-019)
- Run `tools/regress.mjs` automatically before a release; today it is run by hand
