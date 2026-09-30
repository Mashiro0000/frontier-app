# STEP-LOG - how Stage 0 was built

This file explains, in plain words, every command that was run to build Stage 0 of Frontier App,
and why. It is written for someone new to Electron and the command line.

**Result:** running `npm run dev` opens a window titled "Frontier App" that shows the words
"Frontier App". Nothing else. Stage 0 is done.

**To run it yourself** (from this folder):

```bash
npm install
npm run dev
```

## Words you will meet

- **Node.js / npm** - Node runs JavaScript outside a browser. npm is its package manager: it
  downloads code libraries ("packages") other people wrote.
- **Electron** - a toolkit that puts a web page inside a desktop window.
- **Vite / electron-vite** - a build tool. It turns our TypeScript + React code into something
  Electron can run, and reloads the window when you save a file.
- **Scaffold** - a generator that creates a starter project so you do not begin from nothing.
- **Git commit** - a saved snapshot of the project you can go back to.
- **Main / preload / renderer** - Electron's three pieces: the main program (talks to the
  operating system), the renderer (the web page you see), and the preload (a small safe bridge
  between them).

## Step by step

### 1. Look around before changing anything

| Command                                            | What it does / why                                                                                                              |
| -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `Get-ChildItem -Force A:\frontier-app`             | Listed the folder to see if it was empty. It was.                                                                               |
| `node --version`, `npm --version`, `git --version` | Checked the tools exist. Node v24.21.0, npm 11.19.0, git 2.55.0. electron-vite needs Node 20.19+ or 22.12+, so Node 24 is fine. |

### 2. Check the current electron-vite docs (as you asked)

I read https://electron-vite.org/guide/. It says the recommended way to start is
`npm create @quick-start/electron@latest`, with a `react-ts` template for React + TypeScript.

| Command                                                                                                                    | What it does / why                                                                                                                                                                   |
| -------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `npm view create-electron-vite version`, `npm view electron-vite version`, `npm view @quick-start/create-electron version` | Asked the npm registry for the latest version of each package, to confirm the docs matched reality. The scaffolder is `@quick-start/create-electron` 1.0.30; electron-vite is 5.0.0. |

### 3. Work out how to run the scaffolder without questions

You asked for unattended work, but the scaffolder normally asks questions.

| Command                                                            | What it does / why                                                                                                                                            |
| ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm create @quick-start/electron@latest -- --help`                | I hoped this would list the options. **It does not support `--help`**; it just started its question prompt and I ignored it. It created no files.             |
| `cat`/`grep` on the scaffolder's own `index.js` inside npm's cache | Read-only. The cache copy was downloaded by the command above. This showed that `--template <name>` picks the template and `--skip` turns every question off. |

It also showed a trap: with `--skip` the scaffolder **empties the target folder**, and naming the
target `.` would make the package name `.`, which is invalid. So I scaffolded into a sub-folder
and moved the files up (step 5). The folder was empty anyway, but this keeps the package name clean.

### 4. Start git

| Command                               | What it does / why                                                                                                              |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `git init -b main`                    | Turned this folder into a git repository with a branch called `main`. Local only; there is no remote, so nothing can be pushed. |
| `git config user.name` / `user.email` | Only **read** the existing identity so commits would work. It was already set on this computer; I did not change it.            |

### 5. Generate the project

| Command                                                                              | What it does / why                                                                                                   |
| ------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------- |
| `npm create @quick-start/electron@latest frontier-app -- --template react-ts --skip` | Generated the starter project into `frontier-app/`. `react-ts` = React + TypeScript. `--skip` = no questions.        |
| `mv frontier-app/* .` then `rmdir frontier-app`                                      | Moved everything up one level so the project lives directly in `A:\frontier-app`, then removed the empty sub-folder. |

The scaffold already created `src/main`, `src/preload` and `src/renderer`.

### 6. Install dependencies

| Command                                      | What it does / why                                                                                                                                                                                                                                                                                                 |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `npm install`                                | Downloaded all libraries listed in `package.json` into `node_modules/` (590 packages, about a minute). This also downloads the Electron program itself (about 100 MB) - that is the window engine.                                                                                                                 |
| `ls node_modules/electron/dist/electron.exe` | npm printed a warning that some install scripts were "not yet covered by allowScripts". I checked the Electron program really was downloaded. It was, so the warning did not block anything. A future npm version might be stricter; if `npm install` ever stops fetching Electron, that setting is where to look. |
| `npm audit`                                  | npm reported "2 high severity vulnerabilities". See "Things to know" below.                                                                                                                                                                                                                                        |

### 7. First test: does the stock scaffold open a window?

| Command / check                                                          | What it does / why                                                                                                                                    |
| ------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm run dev`                                                            | Started the app in development mode, in the background.                                                                                               |
| PowerShell `Get-Process electron` and a small Windows-API window listing | Asked Windows which windows the Electron process owns. After a few seconds there was one visible window (titled "Electron" - the scaffold's default). |
| `taskkill /PID <id> /T /F`                                               | Stopped the dev server and its window. Closes that one process tree only.                                                                             |
| `git add -A`, `git commit`                                               | **Commit 1:** "Stage 0.1: scaffold electron-vite React + TypeScript app". First I checked `.gitignore` keeps `node_modules/` and `out/` out of git.   |

I did not just trust the dev log saying "starting electron app". I checked Windows for a real window.

### 8. Make the window say "Frontier App"

I edited (no commands - just file edits):

- `src/renderer/src/App.tsx` - now just `<h1>Frontier App</h1>`.
- `src/renderer/src/assets/main.css` - tiny stylesheet that centres the heading.
- `src/renderer/index.html` - page title "Electron" -> "Frontier App" (this is also the window title).
- `src/main/index.ts` - removed the demo "ping" message; app id `com.electron` -> `com.frontier.app`.
- `package.json` - version `0.1.0`, real description, removed the `example.com` / electron-vite homepage placeholders.
- `electron-builder.yml` - app id and product name (used later when making an installer).
- Deleted the demo logo, background image and the version-badge component (`rm`), and created `src/shared/` with an empty `.gitkeep` file (git ignores empty folders, so the file makes it stick).

| Command                                                         | What it does / why                                                                                                                                                                                                                                                                   |
| --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `npm install --package-lock-only --ignore-scripts`              | Updated `package-lock.json` so its name/version match the new `package.json`. Did not reinstall anything.                                                                                                                                                                            |
| `npm run typecheck`                                             | TypeScript checks the code for mistakes without running it. Passed.                                                                                                                                                                                                                  |
| `npm run lint`                                                  | ESLint checks code style and common bugs. Passed.                                                                                                                                                                                                                                    |
| `npx prettier --check src electron.vite.config.ts package.json` | Checks formatting is consistent. Passed.                                                                                                                                                                                                                                             |
| `npm run dev -- --remoteDebuggingPort 9222`                     | Same dev command, plus a debug port so I could **ask the window what it shows** instead of guessing.                                                                                                                                                                                 |
| `node verify-window.mjs` (a throwaway script)                   | Connected to that port, read the page title and text, and took a screenshot. Result: title "Frontier App", text exactly "Frontier App", screenshot shows the heading centred on a dark background. The script lives in a temporary folder outside the project and is not part of it. |
| PowerShell `Get-Process` + `taskkill`                           | Confirmed Windows shows a window titled "Frontier App", then stopped the server.                                                                                                                                                                                                     |
| `git add -A`, `git commit`                                      | **Commit 2:** "Stage 0.2: empty window showing 'Frontier App'".                                                                                                                                                                                                                      |

### 9. Docs and registry

Created by file write:

- `docs/ARCHITECTURE.md`, `docs/ROADMAP.md`, `docs/IDEAS.md`, `docs/DECISIONS.md` - short v0.1 stubs.
- `registry/models.json` and `registry/rankings.json` - empty templates (a version number, a null
  date, and an empty list).

| Command                                              | What it does / why                                            |
| ---------------------------------------------------- | ------------------------------------------------------------- |
| `mkdir -p registry` and `cat > registry/... <<EOF`   | Made the folder and wrote the two JSON files.                 |
| `node -e "JSON.parse(...)"`                          | Checked both JSON files are valid.                            |
| `npx prettier --write docs registry`, then `--check` | Auto-formatted the new files to the project style.            |
| `git add -A`, `git commit`                           | **Commit 3:** "Stage 0.3: docs stubs and registry templates". |

### 10. Final checks

| Command                 | What it does / why                                                                                    |
| ----------------------- | ----------------------------------------------------------------------------------------------------- |
| `npm run build`         | Makes a production build into `out/`. Passed, so the app compiles outside dev mode too.               |
| `npm run dev` (plain)   | The exact command you asked me to verify. A window titled "Frontier App" appeared; then I stopped it. |
| `git status`            | Clean. Only `node_modules/`, `out/` and `.eslintcache` are ignored. No `.env` file exists.            |
| `git add`, `git commit` | **Commit 4:** this log.                                                                               |

## Choices I made where things were unclear ("pick the simplest option")

- **Scaffold into a sub-folder, then move up** instead of scaffolding into `.` - avoids the invalid
  package name and the folder-wipe behaviour (step 3).
- **`--skip` (no questions).** Result: no auto-updater, no download mirror. The scaffold still includes ESLint and Prettier config files.
- **Branch name `main`.** Not specified, so the common default.
- **Kept the scaffold's Electron 39** even though `npm audit` flags it (see below).
- **`src/shared/` holds only a `.gitkeep`** - you asked for the folder, not for code in it.
- **Author set to "Frontier App"** in `package.json` - the scaffold's `example.com` was a placeholder, and I did not want to guess at your name. Change it to whatever you like.
- **Roadmap and ideas are labelled "tentative"**. You gave no plan past Stage 0, so those are my suggestions, not decisions.
- **Commit messages end with a "Co-Authored-By" line** naming Claude, as the tooling for this session requires.

## Things to know (not problems, but worth your attention)

1. **`npm audit` reports 2 high-severity issues** in Electron 39 and its helper `extract-zip`.
   The suggested fix is a major upgrade to Electron 44 (`npm audit fix --force`), which could
   break things, so I did not do it. Stage 0 loads no web content, popups or webviews, which is
   what the flagged problems are about. Recorded as D-003 in `docs/DECISIONS.md`. Upgrade before
   the app starts loading remote content or calling the network.
2. **`sandbox: false`** is the scaffold's setting for the window. I did not test turning it on.
   Recorded as D-004; revisit before handling API keys.
3. **Left as the scaffold made them:** the default Electron icons in `build/` and `resources/`,
   the `publish` URL `https://example.com/auto-updates` in `electron-builder.yml` (unused until you build an installer with auto-update), and the `.vscode/` folder.
4. **Git may print "LF will be replaced by CRLF" warnings.** Harmless: Windows and git disagreeing about line endings.
5. **Nothing was pushed anywhere** and there are no API keys or `.env` files.
6. **Files outside the project.** I wrote no project files outside `A:\frontier-app`, but normal
   npm/Electron use leaves a few things elsewhere on your computer: npm's download cache (which
   also held the scaffolder, step 3), Electron's own download cache, the app's settings folder
   `C:\Users\91995\AppData\Roaming\frontier-app` (created the first time the window opened), and a
   throwaway verification script in this session's temporary folder. All are safe to delete.
