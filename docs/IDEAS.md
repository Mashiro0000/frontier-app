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
- A "New chat" button (today, closing the window is the only way to start over)
- Show what each reply cost (the API reports token counts with every reply)
- Server-side refusal fallbacks for the provider, once there is a real key to try them with (D-012)
- Use Chromium's network stack (`net.fetch`) for the provider calls, so a system proxy is honoured
- Keep the mock Anthropic server and the DevTools check scripts in the repo (for example under `tools/`) as
  the project's automated checks (see D-007)
- Trim or summarise old turns when a conversation gets long (D-013)
