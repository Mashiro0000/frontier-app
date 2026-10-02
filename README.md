# frontier-app

An Electron application with React and TypeScript

## Recommended IDE Setup

- [VSCode](https://code.visualstudio.com/) + [ESLint](https://marketplace.visualstudio.com/items?itemName=dbaeumer.vscode-eslint) + [Prettier](https://marketplace.visualstudio.com/items?itemName=esbenp.prettier-vscode)

## Project Setup

### Install

```bash
$ npm install
```

The first install also downloads the Electron program itself (about 150 MB). Later installs reuse a
local cache.

### Development

```bash
$ npm run dev
```

The first time, click **Settings** and paste your own API key for the provider you want: Anthropic (Claude) or OpenAI
(GPT). There is one section per provider, each with **Save key**, **Test key** (a free call that asks the provider for its
models) and **Remove key**. A key is stored encrypted on your computer, and replies are billed to your account with that
provider. The default model is Claude Opus 5.5; the menu in the header chooses another (Claude Fable 5.1, Sonnet 5.5,
Haiku 4.5, or OpenAI's GPT-6 Astra, GPT-6.1 Sol and GPT-6 Luna), and Settings shows what each one costs. A chat can move
between providers: the whole conversation is sent to whichever model answers next. The **Task** menu next to the model
menu (chat, coding, writing, quick answer) marks the models the providers' own pages name for a task with "(suggested)";
it chooses nothing, and the list is `registry/rankings.json` (D-023). The **Effort** menu (Faster to Smarter) says how hard the chosen model
thinks before it answers: it offers the levels the registry lists for that model, remembers your choice per model, and is not shown for a
model that takes none (Haiku 4.5). A higher level is slower and billed as more output (D-024).
The list of models is `registry/models.json`: edit it, then restart `npm run dev` (or run `npm run dev -- --watch`
so it restarts by itself). See docs/DECISIONS.md D-012, D-014, D-015, D-020 and D-022.

Chats are saved on your computer as you go, one plain file each, in a `conversations` folder next to the app's
other data (the History dialog shows the path). They are not encrypted, unlike the API key. **New chat** starts an
empty chat; **History** opens a saved one or deletes it. Each reply records which model wrote it (D-021). See
docs/DECISIONS.md D-016 and D-017.

### Checks

The app has no test framework (D-007). `tools/` holds the check scripts that drive the real window against a fake
provider API, with their negative controls: `node tools/regress.mjs <tag>`, see `tools/README.md`.

### Build

```bash
# For windows
$ npm run build:win

# For macOS
$ npm run build:mac

# For Linux
$ npm run build:linux
```
