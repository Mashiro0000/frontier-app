# STEP-LOG - how Frontier App was built

This file explains, in plain words, every command that was run to build Frontier App, one stage at
a time, and why. It is written for someone new to Electron and the command line.

| Stage       | What you get                                                                                          | Status |
| ----------- | ----------------------------------------------------------------------------------------------------- | ------ |
| 0 - Shell   | `npm run dev` opens a window titled "Frontier App" that shows the words "Frontier App". Nothing else. | done   |
| 1 - Chat UI | The window is a chat. Type a message, press Enter, and an echo of it streams back. No AI model yet.   | done   |

**To run it yourself** (from this folder):

```bash
npm install
npm run dev
```

Stage 0 is explained first, then Stage 1.

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
- **Component** (Stage 1) - a piece of the screen written as a small function, such as the input
  box. The window is built by putting components inside each other.
- **State and hook** (Stage 1) - state is what a component remembers while the window is open, such
  as the list of messages. A hook is a function whose name starts with `use` that gives a component
  some memory or behaviour. `useChat` is ours.
- **Stream** (Stage 1) - data that arrives in small pieces over time instead of all at once. AI
  models send their answers this way, which is why replies seem to be typed.
- **Abort / AbortSignal** (Stage 1) - the standard way to tell a running job "stop now". The Stop
  button uses it.
- **IPC** (Stage 1) - "inter-process communication": the messages main and renderer send each other
  through the preload bridge. Stage 1 needs none. Stage 2 will.
- **DevTools protocol** (Stage 1) - a remote-control port built into Chromium, which Electron uses.
  A script can connect, read the page, press keys and take screenshots. I used it only to check
  the app; it is not part of the app.
- **Contrast ratio** (Stage 1) - how strongly a text colour stands out from its background. 4.5:1
  is the usual minimum for readable text.

## Stage 0 - Step by step

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

## Stage 0 - Choices I made where things were unclear ("pick the simplest option")

- **Scaffold into a sub-folder, then move up** instead of scaffolding into `.` - avoids the invalid
  package name and the folder-wipe behaviour (step 3).
- **`--skip` (no questions).** Result: no auto-updater, no download mirror. The scaffold still includes ESLint and Prettier config files.
- **Branch name `main`.** Not specified, so the common default.
- **Kept the scaffold's Electron 39** even though `npm audit` flags it (see below).
- **`src/shared/` holds only a `.gitkeep`** - you asked for the folder, not for code in it.
- **Author set to "Frontier App"** in `package.json` - the scaffold's `example.com` was a placeholder, and I did not want to guess at your name. Change it to whatever you like.
- **Roadmap and ideas are labelled "tentative"**. You gave no plan past Stage 0, so those are my suggestions, not decisions.
- **Commit messages end with a "Co-Authored-By" line** naming Claude, as the tooling for this session requires.

## Stage 0 - Things to know (not problems, but worth your attention)

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

---

## Stage 1 - What was built

Running `npm run dev` still opens the "Frontier App" window, but it is now a chat:

- **Header:** the app name and an "Echo mode" badge, a reminder that no AI model is connected.
- **Message list:** your messages are blue bubbles on the right, replies are grey bubbles on the
  left. It scrolls, and follows the newest text unless you scroll up to read older messages.
- **Input box** at the bottom: **Enter** sends, **Shift+Enter** starts a new line. It grows as you
  type, up to 200 pixels, then scrolls.
- **Fake replies:** after a short pause (three animated dots) the app streams back
  `Echo: <what you wrote>` word by word. While a reply arrives, **Send** becomes **Stop**, and Stop
  keeps whatever arrived so far.

All the new code is in `src/renderer/src/chat/` (7 files), plus `App.tsx` and `assets/main.css`.
**No packages were added, and `src/main` and `src/preload` were not touched**, so the chat cannot
reach the operating system or the network. `docs/ARCHITECTURE.md` has a table of the 7 files.

## Stage 1 - Step by step

I built it in three working slices and checked each in the real window before committing it. Then
I checked the production build and ran the final checks.

### 1. Look around before changing anything

| Command                                                                                                                | What it does / why                                                                                                                                                                                            |
| ---------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Reading `STEP-LOG.md`, `docs/ROADMAP.md`, `ARCHITECTURE.md`, `DECISIONS.md`, `IDEAS.md`, `package.json` and the source | Just reading; you asked me to start with the log and the roadmap. The roadmap's Stage 1 is "message list, input box, basic layout" and "fake/echo replies so the UI can be built before any provider exists". |
| `git ls-files`, `git log --oneline`, `git status --short`                                                              | Read-only. What git tracks, the 4 Stage 0 commits, and confirmation that the folder was clean.                                                                                                                |
| `cat` of the scaffold's shared TypeScript settings, `.prettierignore`, `.editorconfig`, `.gitignore`                   | Read-only. The rules new code must follow: strict TypeScript, unused variables are errors, 2-space indent, LF line endings.                                                                                   |
| PowerShell `Get-CimInstance Win32_Process` and `Get-NetTCPConnection`                                                  | Read-only. Checked that no dev server or Electron was already running and that the ports I wanted were free.                                                                                                  |
| `npm run typecheck`, `npm run lint`, `npx prettier --check .`                                                          | Baseline. All three passed before I changed anything, so any later failure would be mine.                                                                                                                     |

### 2. Slice 1.1 - the layout (nothing works yet)

File edits, no commands: `App.tsx` (header + chat area); new `chat/ChatView.tsx`,
`chat/MessageList.tsx` (only the "No model is connected yet" hint) and `chat/Composer.tsx` (the
input box; Send does nothing yet); and a rewritten `assets/main.css`. In the CSS I removed Stage 0's
"centre everything" rule and `user-select: none` (it would have stopped you selecting and copying
message text), added `color-scheme: dark` (so scrollbars are dark too), and made only the message
list scroll, never the whole window.

| Command                                                            | What it does / why                                                                                                                                                                                                                                                                                                                                                                                   |
| ------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npx prettier --write ...`, `npm run typecheck`, `npm run lint`    | Format the new files, then check types and style. I ran these after every slice and they were clean every time, so I do not repeat them below.                                                                                                                                                                                                                                                       |
| `Start-Process cmd /c "npm run dev -- --remoteDebuggingPort 9222"` | The same `npm run dev` as Stage 0, plus a debug port so a script can look at the real window. `Start-Process` also tells me the process ID, so I can stop exactly that program later and nothing else.                                                                                                                                                                                               |
| `node verify-1-1.mjs` (throwaway script, outside the project)      | Connected to the debug port and checked the real window: 17 checks. Header on top, input box at the very bottom, the page itself never scrolls, focus starts in the input box, Send is disabled until there is text, the box grows (36 px for one line, 108 px for four) and stops at 200 px, no sideways scrolling at 420 px wide, no console errors. All passed. I also looked at the screenshots. |
| `git add -A`, `git commit`                                         | **Commit 1:** "Stage 1.1: chat layout shell (header, message area, input box)".                                                                                                                                                                                                                                                                                                                      |

### 3. Slice 1.2 - sending messages

File edits: new `chat/types.ts` (what a message is), `chat/useChat.ts` (the hook: the list of
messages and `send`) and `chat/MessageBubble.tsx`; `MessageList.tsx` now draws the bubbles and keeps
the newest message in view unless you scrolled up; `Composer.tsx` now handles Enter and Shift+Enter.
An Enter that only confirms an input-method choice (for example when typing Japanese) is ignored.

| Command                    | What it does / why                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `node verify-1-2.mjs`      | 32 checks on the real window. Enter sends and keeps focus in the box; Shift+Enter adds a line; blank messages are not sent; outer spaces are trimmed; clicking Send works; a pasted `<img src=x onerror=...>` showed as plain text and did not run; a 600-character word wraps instead of spilling out; 20 messages scroll and the list follows the newest; a reader who scrolled up is not pulled down; a simulated input-method Enter does not send. All 32 passed on the second run (the first run failed for a reason unrelated to the code; see step 5). |
| `git add -A`, `git commit` | **Commit 2:** "Stage 1.2: send messages and show them in a scrolling list".                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |

### 4. Slice 1.3 - echo replies

File edits: new `chat/echoReply.ts`, the fake model. It waits 0.4 s, then streams
`Echo: <your message>` in pieces 30 ms apart, never more than 80 pieces, so even a huge message
takes about 3 s. `useChat.ts` now runs the whole cycle: your message and an empty reply appear, the
reply streams in, then it ends as done, stopped or failed. `MessageBubble.tsx` shows the dots while
waiting and a "Stopped" or error line when needed. `MessageList.tsx` tells screen readers the list
is busy during a reply. `Composer.tsx` gets the Stop button. `types.ts` gets `ReplyFn` (see D-008).
The CSS adds the dots, which stop pulsing if Windows is set to reduce motion.

One thing I caught while writing it: if Send and Stop were one button that changed its type, a
click on Stop could be treated by the browser as a click on Send and send whatever you had
half-typed. So they are two separate buttons (there is a comment in the code), and a check covers
exactly this case: type a draft during a reply, click Stop, and the draft must stay unsent.

| Command                      | What it does / why                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| ---------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `node verify-1-3.mjs`        | 42 checks: typing dots then the exact echo text, a reply takes a visible moment, spaces and line breaks are preserved, a 300-word reply arrives in pieces and finishes in under 4.5 s, Stop keeps the partial text and marks it "Stopped", Stop before any text, the draft-on-Stop case above, Enter during a reply does nothing, the list follows a tall reply, a reader who scrolled up is not pulled down mid-reply, sending again jumps to the bottom, the dots respect "reduce motion". All passed. |
| `node verify-1-3-errors.mjs` | 16 checks. The echo never fails, so to test failure handling this script swaps the echo for a failing one **inside the running window** (DevTools protocol), without changing any project file. It covered: failure before any text, failure halfway (partial text kept), an error that is not a normal Error, an empty reply, a provider that reports "aborted" after Stop (shown as Stopped, not as an error), and a provider that sends one more piece after Stop (ignored). All passed.              |
| `git add -A`, `git commit`   | **Commit 3:** "Stage 1.3: streaming echo replies with typing dots and a Stop button".                                                                                                                                                                                                                                                                                                                                                                                                                    |

### 5. How I checked the app, and what went wrong on the way

The project has no test framework (adding one is your call, see "Things to know"), so I checked the
app by driving the real Electron window from outside, as in Stage 0 but much more thoroughly. The
throwaway scripts live in this session's temporary folder, not in the project:

- `cdp.mjs` - a tiny client for the DevTools protocol (Node has `fetch` and `WebSocket` built in).
  It can run JavaScript in the page, type text, press Enter or Shift+Enter, click with the mouse
  and take screenshots. It also records any console error, warning or exception.
- `verify-*.mjs` - the checks above. Each prints PASS or FAIL per check.
- `run-with-app.mjs` - starts the app, runs check scripts against it, then stops the app with
  `taskkill /PID <id> /T /F`. `/T` stops the whole family of programs it started, and the ID is
  always the one it started itself, so nothing else is touched.

Two mistakes of mine, for the record:

1. **The app window vanished between my commands, twice.** Twice the dev app was no longer running
   when my next command needed it; the first 1.2 check failed with "no page found on port 9222". I
   looked for a cause: no Electron crash report, no Windows error entry, and Electron's data folder
   showed a normal shutdown. The app's own code has no way to quit except the window closing. So it
   was most likely the window being closed, or something tidying up between commands. I could not
   tell which. My fix: run each check as one command that starts the app, checks it and stops it, so
   the window exists for under a minute. It has not happened since. If you closed that window, it was
   not a crash.
2. **I gave `electron-vite preview` a flag only `dev` accepts.** `--remoteDebuggingPort` is rejected
   by `preview`, so the built app refused to start (exit code 1). That was my script, not the app.
   `preview` passes anything after a second `--` straight to Electron, so the working form is
   `npm run start -- --skipBuild -- --remote-debugging-port=9223`. (`npm run start` also rebuilds
   first, unless you add `--skipBuild`.)

### 6. The production build, and colours

| Command                                                        | What it does / why                                                                                                                                                                                                                                                                                                                                                                                                                             |
| -------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm run build`                                                | Type-check, then build all three parts into `out/`. Passed.                                                                                                                                                                                                                                                                                                                                                                                    |
| `grep` and `head` on the built JavaScript                      | The renderer file is 650 kB. I checked it is React's production build (no development-only strings). It is not minified; that is how the scaffold builds it and I did not change it.                                                                                                                                                                                                                                                           |
| `node contrast.mjs` (throwaway)                                | Calculated the contrast ratio of every text/background colour pair in the chat. 11 of 12 passed. The exception: the Send button's edge against the input box was 2.81:1, and I aim for 3:1 for button edges.                                                                                                                                                                                                                                   |
| `npm run build`, then the built app through `run-with-app.mjs` | Ran the **built** app, which loads from a file instead of the dev server, so things can differ. `verify-prod.mjs`: 11 checks. Loaded from `file://`, `crypto.randomUUID` works there, the security policy (CSP) in `index.html` produced no violations, the new CSS property `field-sizing` survived the build and the box still grows, and a send-and-echo round trip works. Then the 42 streaming checks again on the built app. All passed. |
| `git add -A`, `git commit`                                     | **Commit 4:** "Stage 1.4: lighten the accent colour so the Send button meets 3:1 contrast". I changed the accent from `#3b5bdb` to `#4263eb` (white text 4.98:1, button edge 3.19:1) and made the hover colour the darker `#3b5bdb` (5.67:1). The contrast script then passed 12 of 12.                                                                                                                                                        |

### 7. Final checks

| Command                                                                    | What it does / why                                                                                                                                                                                                                                                                                                                              |
| -------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm run dev` (plain, no debug port) and PowerShell `Get-Process electron` | The exact command you would run. Windows reported a window titled "Frontier App". I then stopped it with `taskkill /PID <id> /T /F`. A listing taken a moment later still showed three Electron programs; a second listing about a minute later showed none, so they had only been shutting down. No dev server or debug port was left running. |
| `npm run typecheck`, `npm run lint`, `npx prettier --check .`              | The repo-wide versions, run again after the docs were edited. All clean.                                                                                                                                                                                                                                                                        |
| `npm run build`                                                            | The production build on the final code. Passed.                                                                                                                                                                                                                                                                                                 |
| `node -e "JSON.parse(...)"` on the two `registry/` files                   | Checked they are still valid JSON. I did not touch them.                                                                                                                                                                                                                                                                                        |
| `npx prettier --write STEP-LOG.md docs`                                    | Formatted the docs and this log to the project style.                                                                                                                                                                                                                                                                                           |
| `git add -A`, `git commit`                                                 | **Commit 5:** "Stage 1.5: docs and STEP-LOG for Stage 1". After it, `git status` shows nothing uncommitted (only `node_modules/`, `out/` and `.eslintcache` are ignored).                                                                                                                                                                       |

## Stage 1 - Choices I made where things were unclear ("pick the simplest option")

- **The echo lives in the renderer behind a small contract (`ReplyFn`), with no IPC yet.** The
  contract is: the conversation and a stop signal go in, a stream of text comes out. That is what a
  real provider looks like, so Stage 2 swaps what is behind it. Doing IPC now would mean designing
  the message format before seeing a real provider's. It also means Stage 1 adds no new way for the
  page to reach main (D-008).
- **The fake streams, pauses and can be stopped.** The roadmap only says "fake/echo replies". A reply
  that appeared all at once would have let me skip the typing dots, the Stop button and the
  half-finished-message states, which are exactly what would need rebuilding when a real model is
  connected. It is the smallest fake that keeps the UI honest.
- **No new packages.** Plain React and one CSS file: no component library, state library, Markdown
  renderer or test framework (D-007). Fewer packages means less to keep safe in an app that will hold
  API keys.
- **Messages are plain text, not Markdown or HTML** (D-009). React escapes the text, so pasted HTML
  cannot run (checked). Real models answer in Markdown, so that comes later, with a sanitiser.
- **`src/shared/` stays empty.** Nothing crosses between main and renderer yet, so the message types
  live with the chat code. Moving them needs one extra step, written in `docs/ARCHITECTURE.md`.
- **Dark only.** I reused the scaffold's dark colours and added a few colour variables at the top of
  `main.css`. Text colours were measured against WCAG contrast rules, not just judged by eye.
- **Small behaviours I picked on purpose:**
  - Enter sends, Shift+Enter adds a line.
  - You can type the next message while a reply streams, but cannot send it until the reply ends.
  - Stop keeps the partial reply.
  - The list follows the newest text only if you are already at the bottom.
  - Message text can be selected and copied.
  - The "Echo mode" badge stays in the header so the fake reply cannot be mistaken for a model. The
    header's right side is also a natural place for a model picker in Stage 3.
- **Checked by driving the real app, not with a test framework** (D-007). See step 5.
- **Git:** one commit per slice on `main`, as in Stage 0 (messages "Stage 1.1" to "Stage 1.5"), each
  ending with the "Co-Authored-By" line the tooling requires. Nothing was pushed; there is no remote.
- **Left as they were:** Electron 39 and `sandbox: false` (D-003, D-004). Stage 1 still loads no web
  content and makes no network calls, so the reasons for keeping them are unchanged. Both must be
  settled before Stage 2's first network call.

## Stage 1 - Things to know (not problems, but worth your attention)

1. **There are no automated tests in the repo.** What I checked, all on Windows in the real window:
   everything listed in steps 2 to 6. What I did not check: a real screen reader (only that the
   labels and roles exist), a real input-method editor (only a simulation of one), macOS or Linux,
   very long conversations (I went up to about 20 messages plus a 40-line reply), or window zoom
   levels. The throwaway scripts are in this session's temporary folder; Windows will clear it
   eventually. Tell me if you want them kept in the project.
2. **Closing the window loses the conversation.** Nothing is saved to disk yet. That is on the
   roadmap under "Later".
3. **Before Stage 2:**
   - `useChat` hands the reply function the whole conversation, including stopped, failed and empty
     replies. The echo ignores most of it, but a real provider call should decide what to send (D-008).
   - `src/shared` is not in either `tsconfig` include list, so move it in when the types move.
   - Settle D-003 (Electron upgrade) and D-004 (`sandbox: true`) before the first network call.
4. **`npm run start` builds first, then runs the production build.** Handy for trying the
   production version. The build was checked (step 6).
5. **The input box grows using `field-sizing: content`**, a newer CSS feature. It works in the
   Chromium inside Electron 39 (checked: 36 px to 108 px). An old browser would show a fixed-height
   box, which does not matter here because Electron brings its own Chromium.
6. **The production JavaScript is not minified (650 kB).** That is the scaffold's default and is
   harmless for a desktop app that loads from disk. Worth a look when you make an installer.
7. **Git may again print "LF will be replaced by CRLF" warnings.** Harmless, as in Stage 0.
8. **Files outside the project.** I wrote no project files outside `A:\frontier-app`. Electron's
   settings folder (`C:\Users\91995\AppData\Roaming\frontier-app`) gained a few more cache files.
   The app window opened on your screen a handful of times while I was checking. The throwaway
   scripts and screenshots are in this session's temporary folder. All safe to delete.
9. **No secrets anywhere.** No API keys, no `.env`, nothing pushed.
