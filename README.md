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

The first time, click **Settings** and paste your own Anthropic API key. It is stored encrypted on
your computer. Replies are billed to your Anthropic account. The default model is Claude Opus 5.5; the menu in
the header chooses another (Claude Fable 5.1, Sonnet 5.5 or Haiku 4.5), and Settings shows what each one costs.
The list of models is `registry/models.json`: edit it, then restart `npm run dev` (or run `npm run dev -- --watch`
so it restarts by itself). See docs/DECISIONS.md D-012, D-014 and D-015.

Chats are saved on your computer as you go, one plain file each, in a `conversations` folder next to the app's
other data (the History dialog shows the path). They are not encrypted, unlike the API key. **New chat** starts an
empty chat; **History** opens a saved one or deletes it. See docs/DECISIONS.md D-016 and D-017.

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
