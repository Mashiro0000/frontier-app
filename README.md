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
your computer. Replies are billed to your Anthropic account (the default model is Claude Opus 5.5;
see docs/DECISIONS.md D-012).

### Build

```bash
# For windows
$ npm run build:win

# For macOS
$ npm run build:mac

# For Linux
$ npm run build:linux
```
