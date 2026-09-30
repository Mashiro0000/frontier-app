# STEP-LOG - how Frontier App was built

This file explains, in plain words, every command that was run to build Frontier App, one stage at
a time, and why. It is written for someone new to Electron and the command line.

| Stage        | What you get                                                                                                        | Status |
| ------------ | ------------------------------------------------------------------------------------------------------------------- | ------ |
| 0 - Shell    | `npm run dev` opens a window titled "Frontier App" that shows the words "Frontier App". Nothing else.               | done   |
| 1 - Chat UI  | The window is a chat. Type a message, press Enter, and an echo of it streams back. No AI model yet.                 | done   |
| 2 - Provider | A real model answers in the chat, using your own API key. Checked only against a mock so far: see "Things to know". | done   |

**To run it yourself** (from this folder):

```bash
npm install
npm run dev
```

The stages are explained in order: Stage 0, then Stage 1, then Stage 2.

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
- **Major version and support window** (Stage 2) - the first number of a version (the 44 in
  44.5.1). Electron fixes security problems only in its newest three major versions, so an old one
  slowly becomes unsafe even if nothing in your own code changed.
- **Security advisory** (Stage 2) - a public report of a flaw in a package: which versions have it
  and which versions fix it. `npm audit` compares your installed packages with the list.
- **postinstall** (Stage 2) - a command in `package.json` that npm runs by itself after a plain
  `npm install`. We use it to download the Electron program itself.
- **Build target** (Stage 2) - which version of Node or Chromium the build tool prepares the code
  for. A target that is too old makes it rewrite, or refuse, newer code for no reason.
- **Sandbox** (Stage 2) - a Chromium feature that runs the page in a process that may not touch
  files, programs or the network by itself. The preload is limited too: it may only load a short list
  of modules.
- **Context isolation** (Stage 2) - the preload's code and the page's code run in separate
  JavaScript worlds. Only what the preload deliberately hands over (`window.api`) crosses.
- **Negative control** (Stage 2) - running a check in a situation where it _should_ fail, to prove
  that it can. A check that passes whatever happens proves nothing.
- **Secure storage / safeStorage** (Stage 2) - the operating system's own place for secrets. On
  Windows it ties data to your Windows account (the feature is called DPAPI). Electron's
  `safeStorage` uses it to encrypt the API key before anything is written to disk.
- **EFS** (Stage 2) - Windows' per-folder file encryption. It is switched on for your `AppData`
  folders, and it made one obvious way of saving a file fail (Stage 2, slice 2.3).
- **User data folder** (Stage 2) - where an Electron app keeps its per-user files. For this app:
  `C:\Users\91995\AppData\Roaming\frontier-app`.
- **Scratch profile** (Stage 2) - a throwaway user data folder made for a test, so the test cannot
  touch your real one.
- **API key** (Stage 2) - a long secret that identifies your account to a service and lets it bill you.
  Anyone who has it can spend your money, which is why it is stored encrypted and never shown to the page.
- **SDK** (Stage 2) - a package from a service's own maker that does the fiddly parts of calling it
  (streaming, retrying, error types). Here: Anthropic's `@anthropic-ai/sdk`.
- **Prompt caching** (Stage 2) - the service remembers the start of a conversation it has already read
  and charges much less for reading it again. A chat resends everything every turn, so this matters.
- **Mock server** (Stage 2) - a stand-in for a real service, running on your own computer, that answers the
  way the real one is documented to. It lets the app be tested with no account, no money and no internet.

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

---

## Stage 2 - What was built

Running `npm run dev` now opens a chat with a real model, once you give it your own API key:

- **Settings** (a button in the header): paste your Anthropic API key. It is stored encrypted by your
  operating system and is never shown to the page again. You can remove it there.
- The header shows **which model answers** ("Claude Opus 5.5"), or a red **"No API key"** if none is
  saved. With no key, the empty chat offers an "Open Settings" link, and sending a message explains what
  to do without contacting anyone.
- **Replies stream in from Claude.** **Stop** cancels the reply and the network request behind it, and so
  does reloading or closing the window. Failures (a rejected key, no credit, rate limits, overload, a
  dropped connection, a reply cut off at the length limit, a declined request...) are each explained in a
  red note under the message, with any partial text kept.
- Under the hood: the app runs on **Electron 44** (it was 39, which no longer gets security fixes); the
  window is **sandboxed** and its bridge to the main program is a short list of named functions; the
  **main program** holds the key and makes the only network call; every message the page sends to it is
  checked twice.

It was built in five commits: 2.1 the Electron upgrade (D-003), 2.2 the sandbox (D-004), 2.3 settings and
key storage, 2.4 the provider and the reply path, and 2.5 these docs and the final checks.
**Nothing has been tried against the real Anthropic API yet** (see "Things to know", point 1).

## Stage 2 - Decisions settled before the first network call

You asked me to settle D-003 (which Electron version) and D-004 (the window sandbox) before any
network call, and to log the decisions here. Each one was settled, verified in the real window and
committed **before any code that talks to the network was written**. The full records are in
`docs/DECISIONS.md`; this is the short version.

### D-003 - Electron: upgraded from 39 to 44.5.1 (commit "Stage 2.1")

**Decision: upgrade.** `package.json` now asks for `electron ^44.5.1` (Node 24.21.0, Chromium 152)
and `@types/node ^24`. `npm audit` went from 2 high-severity findings to 0.

**Why:**

- Electron supports only its newest three major versions. 44 is the newest, so 42, 43 and 44 are
  supported. The last 39 release (39.8.10) is dated 2026-05-05, the day before 42.0.0 came out, so 39
  has had no fixes for about five months and will get none. (The date reasoning is mine: Electron's
  page states the three-version rule but has no table of dates.)
- The four Electron advisories `npm audit` lists are fixed only in 41.10.6 and later, 42.x, 43.x and
  44.x, never in 39. The fifth finding, `extract-zip`, disappeared because Electron 44's npm package
  replaced it with its own copy.
- **None of the four affects this app as configured.** They need untrusted content in iframes or
  popups, custom protocol handlers, or the `<webview>` tag, and the app uses none of those. That is
  why Stage 0 could wait. It is not a reason to stay: from this stage the app holds an API key and
  shows text written by a model, and an unsupported browser engine gets no fix for any _future_ flaw
  either.
- Electron's breaking-changes list for versions 40 to 44 touches nothing this app uses.

**Why 44.5.1 and not 42 or 43:** they are clean too, but they leave the support window sooner. 44
stays supported until 47 is released. 44.5.1 is also the version `npm audit` itself suggested.

**Two traps the upgrade set. Both are handled:**

1. **Electron no longer downloads itself during `npm install`** (a change in Electron 42). The build
   tool (electron-vite) reads the program's location from a file that only exists after that
   download, so a fresh `npm install && npm run dev` would fail with "Electron uninstall". Fix:
   `postinstall` now runs `install-electron` first. I tested it by deleting the downloaded program
   and running a plain `npm install`: it came back.
2. **electron-vite 5.0.0 (the newest release) only knows Electron up to 39.** For anything newer its
   code falls back to its _oldest_ table entry: it would compile for Node 16.17 and Chrome 108
   although Electron 44 runs Node 24.21 and Chromium 152. Fix: `electron.vite.config.ts` sets the
   targets by hand. I compared builds with and without it: **the output is byte-for-byte identical
   today**, so this is prevention, not the cure for a live bug. Without it, newer syntax I write in
   Stage 2 could be rejected with a baffling "not available in the configured target environment"
   error.

**Re-check rule:** at the start of each stage, run `npm audit` and check that the installed major is
still one of Electron's newest three.

**About the 151 MB download:** you told me to settle D-003, and D-003 itself said "upgrade Electron
before adding network features", so I treated the upgrade as in scope. The program comes from
Electron's own GitHub releases and is checked against checksums shipped inside the npm package. It is
cached in `C:\Users\91995\AppData\Local\electron\Cache`; the old 39 zip (130 MB) is still there and
safe to delete.

**Not tested:** macOS and Linux; packaging an installer (`npm run build:win` was not run; it is a
"Later" item in the roadmap). The advisories' fixed-version numbers come from their GitHub pages. I
read all four, but two of them (GHSA-gr2m and GHSA-9qh4) only through a summary.

### D-004 - Window sandbox: turned on (commit "Stage 2.2")

**Decision: `sandbox: true`.** The page now runs in Chromium's sandbox. `contextIsolation: true` and
`nodeIntegration: false` are written out too: they are Electron's defaults, but a security setting
that is written down is harder to switch off by accident. (The sandbox has been Electron's default
since version 20. The scaffold's `sandbox: false` was an opt-out, and this decision removes it.)

**What the question turned out to be.** Stage 0 wrote down "not tested whether the preload works with
the sandbox on". I tested it: **it does not.** With `sandbox: true` and the scaffold's preload, the
preload dies with `module not found: @electron-toolkit/preload`, because a sandboxed preload may only
load `electron`, `events`, `timers` and `url`. The failure is **silent**: the window looks normal, and
`window.electron` and `window.api` are just missing. Stage 2's IPC would have simply not existed, with
no crash to point at. So flipping the flag was never enough; the preload had to be rewritten.

**What changed:**

1. `src/main/index.ts`: the three settings above.
2. `src/preload/index.ts`: rewritten to use only `contextBridge`. It exposes `window.api`, empty for
   now. The scaffold's `window.electron` (Electron's whole `ipcRenderer`) is gone. With it, any script
   in the page could call any IPC channel, including the ones that will hold the API key. Stage 2
   adds narrow, named functions instead.
3. The `@electron-toolkit/preload` package is removed (nothing uses it any more): one dependency fewer.
4. New `src/main/security.ts` and two rules that use it:
   - **The window cannot navigate away from the app's own page.** The preload's API exists in
     whatever page the window shows, so a link that navigated away would hand that API to another
     site. Electron 44 has a `will-frame-navigate` event for exactly this.
   - **Only `http:` and `https:` links go to the operating system.** The scaffold passed any URL to
     `shell.openExternal`, so a `file:` or `ms-msdt:` address could start a program. No link in the
     app is clickable today (messages are plain text), so this is prevention for when Markdown arrives.

**Evidence (real windows, dev and built):**

- Electron's own report of the window settings, read from inside the main process: `sandbox: true`,
  `contextIsolation: true`, `nodeIntegration: false`, web security on, no `<webview>`.
- The preload loads; the page sees `window.api` (empty) and no `window.electron`, `require` or
  `process`; no console errors.
- **IPC works through the sandboxed preload**, which all of Stage 2 depends on. A temporary probe (an
  `invoke` round trip, and a push from main to the page) passed 6/6 in both windows, and main saw the
  true sender address. I restored the two files afterwards and checked it by hash.
- **The navigation lock blocks** `http://127.0.0.1:1/` (both windows) and `file:///C:/Windows/win.ini`
  (built app), and still allows the app's own page. A negative control (lock switched off) shows those
  same navigations _do_ happen without it: in the built app the window would happily load the local
  file.
- All of Stage 1's checks still pass with the sandbox on: 110 of 110 in dev, 53 of 53 in the built app.

**What I found that you should know:**

- **`about:blank` is not blocked.** With the lock on, a page can still navigate itself to `about:blank`
  (Electron's event does not see it). It is an empty page, and going anywhere from there is blocked
  (observed). But it does get `window.api`, so every IPC handler I write in main must also check who is
  calling, not rely on the lock. I will do that in slice 2.3.
- **The sandbox does not make model output safe.** It limits what a mistake can reach. Text is still
  shown as plain text, and D-009 still says to sanitise before any Markdown.
- I could not read `process.sandboxed` from outside the preload (`process` is not a global in that
  world), so the main-process report above is the proof, not that.

## Stage 2 - Step by step

### 1. Look around before changing anything

| Command                                                                                                                                                                | What it does / why                                                                                                                                                                                                                                                |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Reading `STEP-LOG.md`, `docs/ROADMAP.md`, `DECISIONS.md`, `ARCHITECTURE.md`, `IDEAS.md`, `package.json`, the build config, `src/main`, `src/preload` and the chat code | Just reading; you asked me to start with the log and the roadmap. The roadmap's Stage 2 is: one provider called from main, a settings screen with safe key storage, swap the echo for a reply over IPC, and settle D-003 and D-004 before the first network call. |
| `git ls-files`, `git status --short`                                                                                                                                   | Read-only. What git tracks, and confirmation that the folder was clean.                                                                                                                                                                                           |
| PowerShell `Get-CimInstance Win32_Process`, `Get-NetTCPConnection`                                                                                                     | Read-only. Checked that no Electron or dev server was left running and that the debug ports were free.                                                                                                                                                            |
| `npm run typecheck`, `npm run lint`, `npx prettier --check .`                                                                                                          | Baseline on the untouched Electron 39 tree. All clean, so any later failure would be mine.                                                                                                                                                                        |
| Copied Stage 1's check scripts (`cdp.mjs`, `run-with-app.mjs`, `verify-*.mjs`) from the earlier session's temporary folder into this session's                         | They were still there. I read the two core ones before running anything, because I would be executing them.                                                                                                                                                       |

### 2. Slice 2.1 - D-003: is the upgrade needed, and what would it break?

Read-only commands first: facts before the decision.

| Command                                                                                                                                       | What it does / why                                                                                                                                                                                        |
| --------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `node -e "console.log(require('electron/package.json').version)"`                                                                             | Installed Electron: 39.8.10, the last release of the 39 line.                                                                                                                                             |
| `npm view electron dist-tags`, `npm view electron versions`, `npm view electron time`                                                         | Asked the npm registry what exists and when it was published. Latest is 44.5.1 (2026-09-30); 44.0.0 came out 2026-08-25, 42.0.0 on 2026-05-06, 39.8.10 on 2026-05-05.                                     |
| `npm audit --json`, summarised with a small script                                                                                            | The 2 high findings again, now with their advisory numbers. All four Electron ones are fixed only in 41.10.6+, 42.x, 43.x and 44.x.                                                                       |
| `npm view electron@44.5.1 dependencies`, `npm view electron-vite version peerDependencies`, `npm view electron-builder version`, `npm ls ...` | Checked that Electron 44's own dependencies changed (the new extract-zip copy) and that our tools (electron-vite 5.0.0, electron-builder 26.15.3, @electron-toolkit/utils 4.0.0) are the newest releases. |
| Web pages read: Electron's release-timeline page, its breaking-changes page, and the four advisory pages on GitHub                            | The support rule, the list of breaking changes for 40 to 44, and what each advisory needs before it matters.                                                                                              |
| Reading electron-vite's source inside `node_modules`                                                                                          | This is where I found trap 2 (the fallback to Node 16 / Chrome 108).                                                                                                                                      |
| `npm pack electron@44.5.1` into the temporary folder, then `tar -xzf`, then reading its `index.js`, `install.js` and `cli.js`                 | Downloaded only the 200 kB npm package (not the program) and read how it finds and fetches the program. This is where I found trap 1.                                                                     |

### 3. Slice 2.1 - the upgrade

| Command                                                                                                               | What it does / why                                                                                                                                                                                                                                         |
| --------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Edited `package.json`: `postinstall` is now `install-electron && electron-builder install-app-deps`                   | Makes `npm install` fetch the Electron program (trap 1). Done before the upgrade.                                                                                                                                                                          |
| `npm install --save-dev "electron@^44.5.1" "@types/node@^24"`                                                         | The upgrade. Output: added 4, removed 7, changed 4 packages, "found 0 vulnerabilities". `@types/node` now matches the Node 24 inside Electron 44, so the editor knows the right functions.                                                                 |
| `cat node_modules/electron/path.txt`                                                                                  | **My mistake.** I expected the program to be downloaded already. It was not: npm runs a project's own `postinstall` only for a plain `npm install`, not when you name packages. "0 vulnerabilities" said nothing about the program, so I checked the file. |
| `npm run postinstall`                                                                                                 | Ran the download by hand: 151 MB from GitHub, checked against the checksums, unpacked (245 MB on disk).                                                                                                                                                    |
| `electron -v`, then `ELECTRON_RUN_AS_NODE=1 electron.exe -e "console.log(process.versions)"`                          | Asked the program itself what it is: Electron 44.5.1, Node 24.21.0, V8 15.2, Chromium 152.0.7977.130, x64. These feed the build targets.                                                                                                                   |
| `npm run typecheck`, `npm run lint`, `npx electron-vite build`                                                        | With the new Node types and the new Electron, all pass. This build was made before pinning the targets; I kept a copy of its `out/` folder.                                                                                                                |
| Edited `electron.vite.config.ts` (targets `node24.21` and `chrome152`), rebuilt, compared the two builds file by file | Trap 2. All five output files were identical.                                                                                                                                                                                                              |
| Deleted `node_modules/electron/dist` and `path.txt`, then a plain `npm install`                                       | Tested the fresh-clone path. The program came back: `path.txt` says `electron.exe`, `dist/version` says 44.5.1. (It came from the cache, so this step did not re-test the download itself; the `npm run postinstall` step above did.)                      |

### 4. Slice 2.1 - checking the real window on Electron 44

`run-with-app.mjs` starts the app, runs check scripts against the real window, then stops exactly the
program tree it started (`taskkill /PID <id> /T /F`).

| Command                                                                                                        | What it does / why                                                                                                                                                                                                                                                                                                                   |
| -------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `node run-with-app.mjs dev verify-1-1,verify-1-2,verify-1-3,verify-1-3-errors ...` (Stage 1's dev-mode checks) | `verify-1-1`: 17/17. `verify-1-3`: 42/42. `verify-1-3-errors`: 16/16. **`verify-1-2` did not finish**: it timed out waiting for exactly one message bubble after sending "Hello".                                                                                                                                                    |
| Read `verify-1-2.mjs` and Stage 1's notes                                                                      | **The script was out of date, not the app.** It was written at slice 1.2, when a send made one bubble. Since slice 1.3 a send also makes the reply's bubble, and the app refuses a second send while a reply streams. Stage 1's notes show it passing at 1.2; I had not re-run it after 1.3. I did not want to just assume that, so: |
| `node run-with-app.mjs dev verify-1-2b.mjs ...`                                                                | `verify-1-2b.mjs` is the same script adapted to the current UI: it counts only your bubbles, waits for each reply to finish before the next send, and adds two checks (a reply bubble appears; the echo of pasted HTML is literal text too). **35/35 passed on Electron 44.**                                                        |
| `npm run build`, then `node run-with-app.mjs preview verify-prod,verify-1-3 ...`                               | The **built** app, which loads from a file instead of the dev server. `verify-prod`: 11/11. `verify-1-3`: 42/42.                                                                                                                                                                                                                     |
| `npm audit`, `npx prettier --check .`                                                                          | `found 0 vulnerabilities`; formatting clean.                                                                                                                                                                                                                                                                                         |

So on Electron 44 the window passes every Stage 1 check: 17 + 35 + 42 + 16 in dev mode (110) and 11 + 42 in the built app (53).

| Command                    | What it does / why                                                                                                          |
| -------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `git add -A`, `git commit` | **Commit 1 of Stage 2:** "Stage 2.1: upgrade Electron 39 to 44.5.1 (settles D-003)". No app code in it touches the network. |

### 5. Slice 2.2 - D-004: does the preload survive the sandbox?

| Command                                                                                                                       | What it does / why                                                                                                                                                                                                                                                 |
| ----------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `cat out/preload/index.js`; `grep` for `window.electron`, `window.api`, `@electron-toolkit/preload` in `src`                  | Read-only. The built preload does `require("@electron-toolkit/preload")`. Nothing in the page uses `window.electron` or `window.api`.                                                                                                                              |
| `grep` in Electron's type file for `will-frame-navigate`, `sandbox`, `senderFrame`; Electron's sandbox documentation page     | Read-only. Checked those exist in Electron 44, and read exactly what a sandboxed preload may load (`electron`'s `contextBridge`, `ipcRenderer` and a few more, plus `events`, `timers`, `url`; no npm packages, no other files).                                   |
| Changed only `sandbox: false` to `true` in `src/main/index.ts`, then `node run-with-app.mjs dev probe-sandbox-before.mjs ...` | The "before" test: flip the flag, leave the scaffold's preload alone. Result: `Unable to load preload script` and `module not found: @electron-toolkit/preload` in the page console; `window.electron` and `window.api` both undefined. The window still rendered. |

### 6. Slice 2.2 - the changes

| Command                                                                                                      | What it does / why                                                                                                                                     |
| ------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| File edits: new `src/main/security.ts`; changed `src/main/index.ts`, `src/preload/index.ts` and `index.d.ts` | Everything under "What changed" in the D-004 section above. `security.ts` has no Electron imports, so its two functions can be tested with plain Node. |
| `npm uninstall @electron-toolkit/preload`                                                                    | Nothing uses it any more. (Named packages on the command line, so `postinstall` does not run: see step 3.)                                             |
| `npm run typecheck`, `npm run lint`, `npx electron-vite build`                                               | All pass. The built preload is 0.12 kB (it was 0.42 kB) and requires only `electron`.                                                                  |

### 7. Slice 2.2 - checking it, and the mistakes in my checks

I changed `run-with-app.mjs` (my copy) so it can also open Node's inspector on the **main** process
(`INSPECT_PORT`). That lets a check ask the running app what Electron itself thinks the window's
settings are, which is stronger proof than what the page can see.

`verify-2-2.mjs` has 43 checks: 24 on the two trust functions, run directly under Node, and 19 against
the real window. It went wrong three times before it was right. All three were flaws in my tests, not
in the app, and the second one is the kind that matters:

| Step                                                                                            | What happened                                                                                                                                                                                                                                                                                                                                                                                               |
| ----------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| First run, dev window                                                                           | 45 of 46. The failure: I tried to read `process.sandboxed` inside the preload's world, but `process` is not a global there. Dropped that check. The main-process report covers it.                                                                                                                                                                                                                          |
| **Negative control**, part 1: switch the lock off with a one-line edit and try to navigate away | **The control failed**: with no lock, navigating to a `file:` address still did not happen. Chromium itself refuses an `http:` page navigating to a `file:` address. So my earlier "blocked" check for that target proved nothing in dev. Good thing I asked whether the test could fail.                                                                                                                   |
| Negative control, part 2: three targets that never leave this computer, lock off, dev and built | Dev window: `about:blank` and a refused loopback address navigate away; the `file:` address does not. Built app: all three navigate, including `file:///C:/Windows/win.ini`. Then I restored the line (`grep` finds no leftover marker; `git diff` shows only the intended changes).                                                                                                                        |
| Lock restored, re-run                                                                           | **8 failures.** `about:blank` navigated even with the lock on, which left the page stranded there, so every later check ran in the wrong place. The `http://127.0.0.1:1/` attempts from `about:blank` did stay blocked. Fix: `about:blank` is now an informational observation, not a target, and every attempt starts from the app page. Then 43 of 43 in the dev window and 43 of 43 in the built app.    |
| Stage 1's suites, sandbox on                                                                    | Dev: 17 + 35 + 42 + 16 = 110 of 110. Built app: 11 + 42 = 53 of 53.                                                                                                                                                                                                                                                                                                                                         |
| **IPC probe** (temporary)                                                                       | Backed up `src/main/index.ts` and `src/preload/index.ts` (hashes noted). Added an `ipcMain.handle`, plus `ping` and `onPush` in the preload, all marked `PROBE-TEMP`. `probe-ipc.mjs`: 6 of 6 in the dev window, and 6 of 6 in a build made from the patched files. Then copied the backups back: the hashes match the pre-probe state, no `PROBE-TEMP` is left, and `out/` was rebuilt from the real code. |

No code in the app makes a network call yet. The only addresses I sent a window towards were
`127.0.0.1:1` (nothing listens there) and local files. (I did not monitor Electron's own background
traffic, so I am not claiming the process was silent, only that the app's code asked for nothing.)

| Command                                                             | What it does / why                                                                                                                                                                     |
| ------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npx prettier --write STEP-LOG.md docs`, `git add -A`, `git commit` | **Commit 2 of Stage 2:** "Stage 2.2: sandbox on, narrow preload, navigation lock (settles D-004)". After it, D-003 and D-004 are both settled, and still no code talks to the network. |

### 8. Slice 2.3 - the Settings screen and key storage (no network, no provider yet)

What was built: `src/shared/ipc.ts` (the list of everything that may cross between page and main)
and `src/shared/validate.ts` (a check of the key's shape); in main, `keyStore.ts` (saves, reads and
deletes the key, encrypted by the operating system) and `ipc.ts` (the message handlers, each behind a
guard that checks who is calling); in the preload, three named functions under `window.api`; in the
page, a Settings dialog (the browser's own `<dialog>` element, which traps keyboard focus and closes on
Escape by itself) and a "Settings" button in the header. The key is stored but nothing uses it yet.

| Command                                                                                                        | What it does / why                                                                                                                                                                                        |
| -------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Reading `@electron-toolkit/utils` and electron-vite's `startElectron`                                          | Read-only. `is.dev` means "not packaged": true for `npm run dev` **and** `npm run start`, false in an installer. And how extra arguments reach Electron (I needed that for test profiles; see problem 1). |
| File edits: the two shared files, `keyStore.ts`, `ipc.ts`, `index.ts`, the preload, both tsconfigs, the dialog | The tsconfigs now include `src/shared` (the architecture notes said to do this when types moved).                                                                                                         |
| `npm run typecheck`, `npx eslint src`, `npx electron-vite build`                                               | Passed. Lint had 2 formatting warnings; prettier fixed them. The built preload is still one file that requires only `electron`, with the channel names bundled inline, which is what the sandbox needs.   |
| `node contrast-2.mjs`                                                                                          | WCAG contrast for the new colours. I chose `#6e7a89` for the edges of the field and of secondary buttons: 3.64:1 against the dialog and 3.93:1 against the page, above the 3:1 bar. Every pair passed.    |
| `node run-with-app.mjs ... verify-2-3.mjs`, then `verify-2-3b.mjs`                                             | The checks; see the next section. `verify-2-3b.mjs` is a second launch of the same profile, to prove the key survives a real restart.                                                                     |
| `node measure-save.mjs` on three fresh profiles                                                                | How long "Save key" takes: 60, 63 and 61 ms.                                                                                                                                                              |
| Looked at the dialog screenshots                                                                               | The layout looks right: centred, dimmed background, visible focus ring, Save disabled until the entry is valid, "Remove key" appears after a save.                                                        |

### 9. Slice 2.3 - checking it, and what went wrong (two things)

`verify-2-3.mjs` has 64 checks: 19 on `checkApiKey` run straight under Node, and 45 against the real
window. The window checks cover: the dialog opens and closes (focus lands in the field, Escape closes
it, focus returns to the button, Tab never leaves the dialog); validation feedback; saving; what is on
disk (a JSON file whose key field is unreadable bytes: the key is not in it as text, nor as bytes, and
the bytes are longer than the key); what the page can learn (`getStatus` returns only `hasKey` and
`canStoreKey`, and the key appears nowhere in the page); bad input sent straight to the main process
(numbers, objects, `null`, a 2 MB string...) is refused; **calls from an `about:blank` page are rejected
by the main process and change nothing on disk**; the key survives a reload; Remove deletes the file.
`verify-2-3b.mjs` (5 checks) then starts the app again on the same profile and reads the key back.

**Problem 1: my first test run used your real profile.** I asked for a scratch profile through the
`ELECTRON_CLI_ARGS` environment variable. The electron-vite command overwrites that variable with its
own (empty) list, so my request was ignored and the app used `C:\Users\91995\AppData\Roaming\frontier-app`.
I noticed because the scratch folder was empty afterwards. What reached your folder: one file,
`credentials.json.tmp` (146 bytes), the encrypted form of a made-up 53-character test key. I checked its
structure without looking at any content (the two field names, Chromium's `v10` marker, and 84 bytes,
exactly what my test key would give), deleted it, and confirmed that no `credentials*` file remains. Your
`Local State` was not touched (last written at 01:30, and it already held the OS-protected key from
Stage 1). The only other residue is two tiny Chromium temp files from force-killing the app
(`Local State...tmp`, `Preferences...tmp`), the same harmless kind earlier stages left. The fix: my runner
now passes the profile as an Electron argument after a second `--` (the form `preview` already needed),
each launch writes its own log, and every test script calls a guard that **aborts before writing
anything unless the app has really created its profile in the scratch folder**.

**Problem 2: Save failed in your real profile, and only there.** My first guess was "slow first use".
Wrong: Save takes about 60 ms on fresh profiles. The real cause: **your `AppData` folders have Windows'
EFS folder encryption switched on** (PowerShell shows the attribute `Encrypted`). In such a folder
`rename` fails every time with EXDEV ("cross-device link"), even inside a single folder. I proved it
with a probe that used my own uniquely named files in your profile folder and removed them straight
after (0 left): 200 of 200 renames failed, while writing a file (new or overwriting) and copying one
both worked. My first version of the key store wrote a temp file and renamed it over the real one. That
worked in my scratch folders (under `%TEMP%`, which is not encrypted) and would have failed for you on
**every** Save with "The key could not be saved on this computer". Clean scratch runs could never have
shown it; the mistake in problem 1 is what exposed it. The fix: write the file in place, then read the
key back, and only say "Saved" if it decrypts to the same key. To test this for real, the final runs
use scratch profiles **inside your encrypted `AppData`** (named `frontier-app-test-scratch-*`, never the
real `frontier-app`, and deleted afterwards). See DECISIONS D-010.

| Result                               | Detail                                                                                                                                          |
| ------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| Dev window, EFS scratch profile      | 64 of 64, then 5 of 5 after a real restart: a new process decrypted the key saved by the previous one.                                          |
| Built app, EFS scratch profile       | 64 of 64, then 5 of 5. This is the one where the guard compares `file://` addresses, so it matters separately.                                  |
| Stage 1's suites with the new header | 110 of 110 in dev, 53 of 53 in the built app.                                                                                                   |
| After everything                     | The real profile holds no `credentials*` file and none of my probe files. The scratch folders are deleted. No Electron process is left running. |

One unrelated hiccup: a `python3` command I typed hung (on Windows, `python3` can be a Microsoft Store
stub). I stopped it with the task-stop tool; it had changed nothing.

| Command                 | What it does / why                                                                                                                                                                                                      |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `git add`, `git commit` | **Commit 3 of Stage 2:** "Stage 2.3: Settings screen and encrypted API-key storage". The Anthropic SDK, which I had already installed for the next slice, is deliberately left out of this commit: nothing uses it yet. |

### 10. Slice 2.4 - Claude as the provider, and the reply path over IPC

What was built: in main, `provider.ts` (the one provider: Anthropic's Claude, through Anthropic's SDK;
it imports nothing from Electron) and `chat.ts` (runs each reply: checks who is asking, reads the key,
calls the provider, sends the text back to the page as events, and cancels the request on Stop, on reload
and on closing the window); in the page, `ipcReply.ts` (the reply function that replaces the echo) and
`history.ts` (what the model is told about earlier turns); the preload gets `window.api.chat` with three
functions; the header badge now names the model (or warns "No API key"), and the empty chat invites you to
open Settings. `echoReply.ts` is deleted (it is in git history, Stage 1.3). The decisions, with reasons, are
D-012 (provider) and D-013 (history) in `docs/DECISIONS.md`; the short version:

- **Anthropic, because nothing else was in the project** (my grep found only a parked "Ollama" idea), and
  the model is `claude-opus-5-5`, the default in Anthropic's own guidance. **It is the pricier tier, and the
  bill goes to your account.** It is one constant (`MODEL` in `provider.ts`) if you want a cheaper one.
- **The SDK instead of hand-written network code**: a new runtime package, the only one added.
- **Left out on purpose: "refusal fallbacks"**, which the guidance suggests enabling by default. They are a
  beta feature I could not try without a real key, and they change billing.

| Command                                                                                   | What it does / why                                                                                                                                                                                                                                                                 |
| ----------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `grep` for other provider names in the project                                            | Anthropic's guidance for building with Claude asks for this first. Only `docs/IDEAS.md` matched (a parked Ollama idea), so nothing else is being worked on.                                                                                                                        |
| Read the guidance's pages on streaming and errors, and its model list                     | Model id, the thinking and effort rules for this model, "no prefill", and how streaming and errors look in TypeScript. **Its own pages disagree** on whether two messages from the same side in a row are allowed, so the app merges them itself (valid under both readings).      |
| `npm view @anthropic-ai/sdk ...`, then `npm install @anthropic-ai/sdk`                    | Footprint before installing: MIT licence, two small dependencies, 11 MB unpacked. Installed: 7 packages, `npm audit` still 0. (I did this while preparing slice 2.3 and kept its `package.json` change out of that commit; it is in this one.)                                     |
| Read the SDK's own source and type files in `node_modules`                                | How the client picks its credentials: anything left unset is read from the environment (`ANTHROPIC_AUTH_TOKEN`, `ANTHROPIC_BASE_URL`), which could make it send two credentials or send your key to another server. So the app sets both explicitly. Also the exact request types. |
| File edits (see "What was built")                                                         | `src/shared/ipc.ts` and `validate.ts` grew the chat messages and their checks (500 messages, 200 000 characters each, 600 000 in total, because the whole chat is sent again with every message).                                                                                  |
| `npm run typecheck`                                                                       | One error: I used the SDK's error class as a type, which needs its named export. Fixed.                                                                                                                                                                                            |
| `node provider-node-test.mjs` (runs `provider.ts` under plain Node against the mock)      | 51 checks. See below for what the mock is and what this covers.                                                                                                                                                                                                                    |
| `node probe-drop.mjs`                                                                     | A dropped connection mid-reply read as "Something went wrong: terminated". I printed the error's shape, found the SDK gives it no class of its own, and added a check for it. It now reads "The connection was interrupted while the reply was arriving...".                       |
| `node run-with-app.mjs ... setup-key.mjs, verify-1-1 ... verify-1-3-errors` with the mock | **Stage 1's whole UI suite, run through the real IPC, SDK and mock.** First run 108 of 110; see below.                                                                                                                                                                             |
| `node run-with-app.mjs ... verify-2-4.mjs`                                                | 71 new checks in the real window. First run 68 of 71; see below.                                                                                                                                                                                                                   |
| Negative controls, then `cp` the backup back and compare hashes                           | Three safeguards switched off one at a time; see below.                                                                                                                                                                                                                            |
| Built app: `npm run build`, then `verify-2-4`, `verify-prod`, `verify-1-3` with the mock  | 71 of 71, 11 of 11, 42 of 42.                                                                                                                                                                                                                                                      |
| WCAG contrast script for the new colours; looked at the screenshots                       | The "Open Settings" link is 5.79:1 and the "No API key" badge 7.41:1, both above the bars. The screens look right.                                                                                                                                                                 |
| `npx prettier --write`, `npm run typecheck`, `npm run lint`, `npm run build`, `npm audit` | All clean; `npm audit` still reports 0 vulnerabilities.                                                                                                                                                                                                                            |

### 11. Slice 2.4 - checking it, and the honest limit of the checking

**I never made a call to the real Anthropic API.** No key was available, and I did not ask you for one or
try to find one. Everything was checked against a **mock server** I wrote (`mock-anthropic.mjs`, in this
session's temporary folder, not in the project). It speaks Anthropic's streaming format, and it checks each
request the way the API is documented to: wrong model, a missing or second credential, consecutive roles,
an empty message, a last message from the assistant, removed parameters, a missing `effort` or
`cache_control`. A mistake in the request shape is therefore a loud 400 from the mock. It can also
misbehave on demand: 401, 403, 404, a credit-balance 400, 429, 500, 529, an error event in the middle of a
reply, a dropped connection, a reply cut at the length limit, a refusal, a full context window, an empty
reply, an overload that clears on the third try, a very slow reply, and a server that never answers. The
SDK parses the mock's events with its real parser, so the wire format is tested, but **the mock is my
reading of the API, and a real difference would not show up**. The first real message is the real test:
run `npm run dev`, open Settings, paste your key and send one.

What the 51 provider checks and the 71 window checks cover:

- **The request the app really sends**, read back from the mock: the key goes in `x-api-key` and nothing
  else; model, streaming, effort, caching and the output ceiling are as designed; no sampling settings, no
  `thinking` setting, no tools; the system prompt asks for plain text. **With hostile `ANTHROPIC_AUTH_TOKEN`,
  `ANTHROPIC_API_KEY` and `ANTHROPIC_BASE_URL` set in the environment, the request still went to the right
  place with the right key and no extra credential.**
- **History**: a second turn contains the first reply, in order; two messages from the person in a row are
  merged (D-013).
- **No key, no request**: with no key saved, sending a message explains what to do and **the mock saw zero
  requests**. The same after "Remove key".
- **Stop and reload cancel the network request**: after Stop, and after reloading the window mid-reply, the
  mock saw the connection close (8 ms after Stop, 66 ms after the reload), so an abandoned reply stops costing money.
- **Every failure, as the person reads it**: key rejected (with the request id), credit balance too low,
  rate limit, server error, overloaded, an error in the middle of a reply, a dropped connection, cut off at
  the length limit, declined, conversation too long, empty reply. Each is a red note under the message, the
  partial text is kept where there is some, and the input is ready again. **The key never appears in any
  message.**
- **An overload that clears by itself is invisible**: the mock answered "overloaded" twice and then
  succeeded; the SDK retried and the person just saw the reply (three requests).
- **The chat guard**: ten malformed requests sent straight from the page (wrong types, no messages, ends with
  the assistant, too long, too many...) were all refused and **none reached the API**: eight could be
  answered and got an error event, and two (not even an object, or an unusable id) were ignored without a
  reply. A chat request from an `about:blank` page was ignored too.
- **The key is not in the app's own log output, not in the page, not in local storage.**

| What went wrong, or was found                         | Detail                                                                                                                                                                                                                                                                                                                                                                                                     |
| ----------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Stage 1 suite, first run through the mock: 108 of 110 | Two checks still assumed the old echo (which only ever repeated your last message). With the new history rule, a message sent after a reply that ended with no text travels **together with the unanswered one**, and the mock echoes the whole thing. That is the designed behaviour (D-013), so I changed those two assertions to say so. Then 42 of 42 and 16 of 16.                                    |
| `verify-2-4`, first run: 68 of 71                     | The same merge, in my own test flow: a "no key" message was still in the conversation when I sent "hello". I reset the conversation after saving the key. Then 71 of 71. (My mock also took the first `[[mock:...]]` directive in a merged message; it now takes the newest.)                                                                                                                              |
| **Negative controls**                                 | I switched off, one edit each in `chat.ts`: the sender check on `chat:start`, the abort on cancel, and the abort on reload. **Exactly the matching checks failed** (Stop left the request open; reload left it open; the `about:blank` request reached the API), plus two that depend on them. So those checks can fail. I restored the file from a backup and compared hashes: identical, no marker left. |
| Stage 1's `verify-1-3-errors` needed a new target     | It used to swap the echo module inside the running window. It now wraps `ipcReply` the same way, so its 16 checks still test `useChat`'s failure handling.                                                                                                                                                                                                                                                 |

| Result                                       | Detail                                                                                                                                       |
| -------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| Provider module under Node, against the mock | 51 of 51.                                                                                                                                    |
| Dev window, through the mock                 | Stage 1's suites 17 + 35 + 42 + 16 = 110 of 110; `verify-2-4` 71 of 71.                                                                      |
| Built app, through the mock                  | `verify-2-4` 71 of 71; `verify-prod` 11 of 11; `verify-1-3` 42 of 42.                                                                        |
| Every test profile                           | A scratch profile inside your encrypted `AppData` (`frontier-app-test-scratch-*`), each verified in use by the guard and deleted afterwards. |

| Command                 | What it does / why                                                                                                                               |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `git add`, `git commit` | **Commit 4 of Stage 2:** "Stage 2.4: Claude as the provider, reply streaming over IPC". It includes the SDK in `package.json` and the lock file. |

### 12. Final checks

| Command                                                                                                | What it does / why                                                                                                                                                                                                                                                                                                                                |
| ------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `node run-with-app.mjs dev plain-check.mjs` (plain `npm run dev`, your real profile, no test settings) | A **read-only** startup check exactly as you would run it: no clicks, no typing, no saving, and the app cannot call the network without a key. 7 of 7: title, Electron 44.5.1, the "No API key" badge and hint, the Settings button, the exact `window.api` surface, no console errors. Your profile held no `credentials*` file before or after. |
| `npx prettier --check .`, `npm run typecheck`, `npm run lint`, `npm run build`, `npm audit`            | All clean. `npm audit`: 0 vulnerabilities (Stage 0 had 2 high).                                                                                                                                                                                                                                                                                   |
| `npx prettier --write STEP-LOG.md docs`, `git add`, `git commit`                                       | **Commit 5 of Stage 2:** "Stage 2.5: docs and STEP-LOG for Stage 2". After it, `git status` shows nothing uncommitted.                                                                                                                                                                                                                            |

## Stage 2 - Choices I made where things were unclear ("pick the simplest option")

- **Decisions first, as you asked.** D-003 and D-004 were settled, verified in the real windows, written into
  `docs/DECISIONS.md` and this log, and committed (2.1 and 2.2) before any provider code existed.
- **Electron 44.5.1, not an older supported one.** It is supported the longest and is what `npm audit`
  suggested. `^44.5.1` lets npm take new 44.x patches but not 45; moving to 45 is a decision for then.
- **I rewrote the preload rather than only flipping `sandbox`.** The scaffold's preload could not load in the
  sandbox, and it handed the page Electron's whole `ipcRenderer`. It now exposes a short list of named
  functions, and the package it depended on is removed.
- **Anthropic, with Claude Opus 5.5, through Anthropic's SDK.** You did not name a provider, so this is the
  most consequential choice I made for you: it decides who gets paid and how much. It is one constant
  (`MODEL`) and one module (`provider.ts`).
- **The key: one encrypted file, never sent back to the page.** Not a third-party keychain package (one more
  dependency to trust), and not an environment variable or a `.env` file (D-006).
- **Saving writes in place** and reads the key back before saying "Saved" (your encrypted `AppData`; D-010).
- **A guard on every message, plus validation in main.** The page cannot be fully trusted, and `about:blank`
  gets `window.api` too (D-011).
- **A plain-text system prompt.** Replies are shown as plain text, and Claude writes Markdown by default,
  which would appear as stray asterisks. Remove it when Markdown is rendered (D-009).
- **What the model is told: everything you saw, with neighbouring messages merged** (D-013), and a size cap,
  because the whole chat is resent each time.
- **Left out on purpose, each a possible next step:** refusal fallbacks, a cost display, a model picker,
  system-proxy support, saved conversations, and New chat and Retry buttons (see `docs/IDEAS.md`).
- **A test-only address override (`FRONTIER_API_BASE_URL`)** exists so the whole path can be tried against a
  fake server. It works only when running from source, never in an installed app, and it logs a warning (once) whenever it is in use.
- **No test framework, again** (D-007). The checks are throwaway scripts in this session's temporary folder.
- **Git:** one commit per slice on `main` (messages "Stage 2.1" to "Stage 2.5"), each ending with the
  "Co-Authored-By" line the tooling requires. Nothing was pushed; there is no remote.
- **Left as they were:** the `example.com` update address in `electron-builder.yml`, the default icons, and
  packaging (`npm run build:win` was not run).

## Stage 2 - Things to know (not problems, but worth your attention)

1. **I never called the real Anthropic API.** No key was available, and I did not ask you for one. Every check
   ran against a mock server I wrote, which speaks the documented format and checks the request shape
   strictly (section 11). It is my reading of the API, so a real difference would not show up. **The first real
   message is the real test:** run `npm run dev`, click Settings, paste your key, send something. If it
   fails, the red note says why and includes a request id. A wrong model name for your account reads "the
   model ... was not found (404)", an empty balance reads "credit balance is too low", a bad key reads "not
   accepted (401)". Tell me what it says and I will fix it.
2. **It costs money, on your account.** Claude Opus 5.5 was listed at about $4 per million tokens in and $20
   per million out when I chose it. The whole conversation is sent again with every message (the app asks for
   caching, which bills the repeated part far lower), so long chats cost more per message. One reply is
   capped at 16 000 tokens, and a conversation at about 150 000 tokens. **There is no cost display yet.** To
   use a cheaper model, change `MODEL` in `src/main/provider.ts`, but check that the new model accepts the
   request: some (Haiku 4.5, for one) reject the `effort` setting, so it is not always one line.
3. **Conversations are not saved, and there is no "New chat" button.** Closing the window ends the
   conversation; reopening starts a new one. (Both are on the roadmap's "Later" list and in `IDEAS.md`.)
4. **Stop closes the connection** (the mock saw it close 8 ms later). What Anthropic bills for a reply you
   stopped is their rule, not something I can see.
5. **Your `AppData` folders are EFS-encrypted**, so renaming a file in them fails. The key is saved in a way
   that copes (D-010). Any future feature that saves files there (conversation history is next) must do the
   same and be tested in an encrypted folder. I saved this as a note for future sessions too.
6. **The key store has a limit.** It protects a copy of the file on another computer or account. A program
   running as you on this computer can ask Windows to decrypt it, like a browser's saved passwords.
7. **Only Windows was tested.** On macOS the key goes to the Keychain, and on Linux the app refuses to save a
   key when there is no desktop keyring. Both are written but untested.
8. **The SDK does not use the Windows system proxy** (it uses Node's network stack, not Chromium's). Behind a
   proxy that would need a change.
9. **A stalled reply:** I tested Stop with a server that never answers and with one that streams slowly, but
   not with one that sends the start of a reply and then goes silent. Stop is the way out.
10. **Packaging is untested.** `npm run build:win` was not run. The SDK is in `dependencies`, so it would be
    shipped, but I have not seen it.
11. **`npm install` still prints "3 packages have install scripts not yet covered by allowScripts"** (esbuild
    twice and electron-winstaller). As in Stage 0, nothing is blocked so far.
12. **Git may print "LF will be replaced by CRLF" warnings.** Harmless, as before.
13. **Files outside the project.** Project files are only under `A:\frontier-app`. Elsewhere: Electron's
    download cache (`C:\Users\91995\AppData\Local\electron\Cache`) now holds the Electron 44 zip (151 MB)
    and the old 39 zip (130 MB, safe to delete); your app's data folder gained the usual caches plus a few
    tiny Chromium temp files from force-stopping test windows (`Local State...tmp`, `Preferences...tmp`,
    harmless); the test scratch profiles I made inside `AppData` were all deleted, and your real profile
    holds no `credentials*` file. The throwaway scripts and screenshots are in this session's temporary folder.
14. **The test scripts** are not in the project: the mock API server, the DevTools helper, the runner, and
    every `verify-*` script. Say the word and I will keep them in the project (for example under `tools/`).
    The mock server is the useful one: it lets you try the whole app with no account and no spending.
15. **Not checked:** a real screen reader, macOS and Linux, very long conversations (the longest I tried was
    about 22 exchanges, plus the refusal at the size cap), window zoom levels, and input-method editors with
    real replies.
16. **No secrets anywhere.** No API key, no `.env`, nothing pushed. The test keys were invented per run and are
    not recorded.
