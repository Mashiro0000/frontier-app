# STEP-LOG - how Frontier App was built

This file explains, in plain words, every command that was run to build Frontier App, one stage at
a time, and why. It is written for someone new to Electron and the command line.

| Stage               | What you get                                                                                                                                                                                        | Status |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| 0 - Shell           | `npm run dev` opens a window titled "Frontier App" that shows the words "Frontier App". Nothing else.                                                                                               | done   |
| 1 - Chat UI         | The window is a chat. Type a message, press Enter, and an echo of it streams back. No AI model yet.                                                                                                 | done   |
| 2 - Provider        | A real model answers in the chat, using your own API key. Checked only against a mock so far: see "Things to know".                                                                                 | done   |
| 3 - Registry        | The list of models comes from `registry/models.json`, and a menu in the header chooses which Claude model answers. Still only checked against a mock.                                               | done   |
| 4 - History         | Chats are saved on your computer as you go. A New chat button starts an empty chat; a History dialog opens a saved one or deletes it. Still only checked against a mock.                            | done   |
| 5 - Second provider | OpenAI's GPT-6 models next to Claude, one key per provider, and every reply records which model wrote it. Only checked against mocks: the first real call is yours.                                 | done   |
| 6 - Suggestions     | A Task menu in the header (chat, coding, writing, quick answer) marks the models the providers' own pages name for it. It chooses nothing, and there are no scores: see "Stage 6 - Things to know". |

**To run it yourself** (from this folder):

```bash
npm install
npm run dev
```

The stages are explained in order: Stage 0, then Stage 1, then Stage 2, then Stage 3, then Stage 4, then Stage 5, then Stage 6.

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
- **Registry** (Stage 3) - a plain file listing the models the app knows about, with the facts the app needs
  about each: its name, how much it can read, what it costs, which settings it accepts.
- **Schema and schema version** (Stage 3) - the agreed shape of a data file. The version number tells the
  program which shape to expect; a file with another number is refused instead of half-understood.
- **Strict reading** (Stage 3) - checking data before using it, and refusing anything that is not exactly as
  expected. A typo in the registry then gives a clear message, not a wrong request to a paid service.
- **Embedding a file** (Stage 3) - the build tool copying a file's contents into the program, so the program
  never has to find the file when it runs.
- **Effort** (Stage 3) - a setting some Claude models accept that says how much to think and write. Others
  (Haiku 4.5) refuse any request that contains it.
- **Golden file** (Stage 3) - a saved copy of what the old code produced, used to prove that new code still
  produces exactly the same thing.
- **Race** (Stage 3) - two things happening at nearly the same moment, where the result depends on which one
  finishes first.

- **Conversation file** (Stage 4) - one saved chat, kept as a small text file whose name ends in `.json`. The
  app never keeps your chats anywhere else.
- **Autosave and snapshot** (Stage 4) - the app saves without being asked, each time something changes. It hands
  over a snapshot (the whole chat as it is right now) every time, not just what changed, so the last one sent is
  always the true one.
- **Throttle** (Stage 4) - doing something at most once in a while. While a reply streams in, the chat is saved at
  most once a second instead of for every word.
- **Torn write** (Stage 4) - a file that was cut off halfway through being written (a crash, a power cut), leaving
  half a file. Stage 4's saving is built so that a torn write can never pass for a whole one.
- **Fault injection** (Stage 4) - making a disk operation fail on purpose inside a test, to see that the program
  keeps your data and heals itself.
- **UUID** (Stage 4) - a long random label like `8f3eab10-8dd3-46fd-87f5-984fed22bc15` that is practically never
  repeated. Each chat's file is named after one.
- **Path traversal** (Stage 4) - an input like `../../secret` that tries to make a program touch a file outside
  the folder it was meant to stay in. Anything that becomes part of a file name is checked for this.
- **Modal dialog** (Stage 4) - a box that sits on top of the window and blocks everything behind it until it is
  closed (Settings and History are both).
- **Byte-order mark** (Stage 4) - an invisible character some editors put at the start of a text file.
- **Line endings** (Stage 4) - how a text file marks the end of a line: Windows tools often use two characters
  (CRLF), most other tools one (LF). A project that mixes them gets complaints from its formatting checkers.
- **Selector** (Stage 4) - a rule such as `dialog.settings` that picks elements on a page by their class names.
  Two parts of a page that share a class name can be mistaken for each other.
- **Provider** (Stage 5) - a company whose models the app can ask: Anthropic (Claude) and OpenAI (GPT). Each has its own API key.
- **Adapter** (Stage 5) - the one piece of code that knows how to talk to a provider. The rest of the app speaks one common
  language and never knows which provider it is talking to.
- **Responses API** (Stage 5) - OpenAI's current way of asking a model for an answer (it also has an older one, Chat Completions).
- **Reasoning effort** (Stage 5) - how long a model thinks before it answers: more is slower and costs more. Each model accepts its own levels.
- **Quota** (Stage 5) - a provider's name for "your account has no credit left, or reached its spending limit".
- **Version 2 file** (Stage 5) - the new shape of a saved chat, which also says which model wrote each reply. Old chats are read as if
  they were in the new shape and are only really converted the next time you add to them.
- **Golden record** (Stage 5) - a recording of exactly what the old code sent, kept so the new code can be shown to send the same,
  byte for byte, after a rewrite that was meant to change nothing.
- **Negative control** (Stage 5) - breaking one thing on purpose and checking that the check notices. A check that has never been seen to
  fail proves little.

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

---

## Stage 3 - What was built

Running `npm run dev` opens the same chat, with one new control in the header and one new section in Settings:

- **A model menu**, beside the Settings button. It lists the four Claude models in `registry/models.json`: Fable
  5.1, Opus 5.5, Sonnet 5.5 and Haiku 4.5. It starts on Opus 5.5, exactly as before, so nothing changes (or costs
  more) until you pick another. Your choice is remembered between launches. The menu greys out while a reply is
  arriving, because the model is fixed when a reply starts.
- **Settings has a "Model" section** for the chosen model: what it is for, how much conversation it can read, its
  list price per million tokens in and out, the date those prices were checked, and a reminder that changing
  the model in the middle of a chat sends the whole chat so far to the new model.
- **The registry is a real file now.** `registry/models.json` holds, for each model, its API name, label,
  description, size limits, prices and one request setting (`effort`). You edit the file and restart the app.
  It is checked strictly at startup. A typo leaves one entry out and says so in the app's log. A file that cannot
  be used at all shows "Models unavailable" in the header and makes replies explain why, instead of quietly
  using some hidden list.
- Under the hood: the provider builds each request from the chosen model's entry (the `effort` setting only for
  models that take it, which Haiku 4.5 does not; the reply limit lowered to the model's own if that is smaller).
  The main program keeps the choice and saves it in its own small file, `preferences.json`. The page can only
  pick a model the registry offers, and the main program checks that twice.
- **No new packages.** The default model's request is byte-for-byte what Stage 2 sent, checked against a copy
  taken before I changed anything.

It was built in four slices: 3.1 the registry file and its check, 3.2 the provider, 3.3 which model answers, 3.4
the menu and Settings. Slice 3.5 is these docs and the final checks. It is committed as
one commit (see "Things to know", point 1). **Nothing has been tried against the real Anthropic API**, and four models now
share that gap (point 2).

## Stage 3 - Decisions

The full records are D-014 and D-015 in `docs/DECISIONS.md`, and I corrected the older records Stage 3 made
out of date (D-012 still said "edit `MODEL` in `provider.ts`"). The short version:

### D-014 - The registry: plain JSON, embedded in the app, read strictly, never trusted with an address

- **What is in it:** facts about each model, plus the one setting the app picks for it. Policy stays in code (the
  16 000-token reply ceiling, caching, the plain-text system prompt, the API address), so nothing in the file can
  change where your key is sent.
- **Four models**, the current generation. Facts and prices were read on 2026-10-01 from Anthropic's live docs and
  matched the cached API reference. `effort` is set per model: Opus 5.5 `medium` (its own default, so its
  request is unchanged), Sonnet 5.5 `medium` (its default is `high`; Anthropic suggests `medium` for chat), Fable
  5.1 `high` (its default), Haiku 4.5 none (it rejects the setting).
- **Embedded in the build**, not read from disk at run time. No path to find, in development or in an installer
  (packaging has never been tried here). Invalid JSON stops the build; a typo drops one entry; a file that is
  unusable as a whole shows "Models unavailable". No fallback list.
- **Strict:** exactly the expected fields, so a misspelt field is reported as both missing and unknown. The
  default model is written down, not guessed, because it decides what you are billed.

### D-015 - Which model answers: main holds the choice, saves it in its own file, the page can only pick from the registry

- The main program is the source of truth, like the API key. `settings:set-model` goes through the same
  sender guard as every other message, and its input is checked twice.
- Saved in `preferences.json`, apart from the key file, written in place and read back (D-010) and tested in the
  EFS-encrypted `AppData`. A saved choice the registry no longer offers, or a file that is empty, corrupt or
  hostile, means the default, with one line in the log; the file is never rewritten just by reading it.
- The model is fixed when a reply starts. Changes are handled one at a time, in order (holding an arrow key on
  the menu fires one change per option passed, and side by side their saves crossed in my test).

## Stage 3 - Step by step

### 1. Look around before changing anything

| Command                                                                                                                                                                                                     | What it does / why                                                                                                                                                                                                                                                                                                                                                          |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Reading `STEP-LOG.md`, `docs/DECISIONS.md` and `docs/ROADMAP.md` first, as you asked, then `ARCHITECTURE.md`, `IDEAS.md`, `README.md`, `package.json`, the build config and all the code this stage touches | Just reading. The roadmap's Stage 3 was two lines: fill the registry and load it at startup, and a model picker driven by it. D-012 added the real requirement: turn the fixed model into a choice "with the settings each model takes".                                                                                                                                    |
| `git status`, `git log`; PowerShell checks for leftover Electron or Node processes and debug ports                                                                                                          | Read-only. A clean tree on `main`, and nothing left running from earlier work.                                                                                                                                                                                                                                                                                              |
| `npm audit`, `npm view electron dist-tags.latest`, the list of published Electron versions                                                                                                                  | D-003's rule: re-check at the start of every stage. 0 vulnerabilities. 44.5.1 is the newest release and the highest published major is 44, so 42 to 44 are supported and the installed 44 is safe for now.                                                                                                                                                                  |
| `npm run typecheck`, `npm run lint`, `npx prettier --check .`                                                                                                                                               | Baseline on the untouched tree. All clean, so any later failure would be mine.                                                                                                                                                                                                                                                                                              |
| Loaded Anthropic's API reference (the `claude-api` skill) and read its model, effort and prompt-caching pages                                                                                               | Which models exist, their ids, sizes and prices, and which accept `effort`. It is a cached copy (dated 2026-09-25), and the prices were about to go into a data file, so I did not stop there.                                                                                                                                                                              |
| Fetched three pages of Anthropic's live docs: models overview, effort, prompt caching                                                                                                                       | A cross-check. They agreed with the cached copy on every fact the registry uses. They added: Haiku 4.5's retirement is "not sooner than October 15, 2026"; Sonnet 5.5 and Fable 5.1 default to `high` effort and Opus 5.5 to `medium`; automatic caching works on all four, and a prompt too short to cache is not an error (Haiku 4.5 needs 4 096 tokens, the others 512). |
| Copied Stage 2's check scripts from an earlier session's temporary folder and read each one before running it                                                                                               | They are not in the project (see "Things to know"). I would be executing them, so I read them, and a scan for file and network side effects found only loopback addresses.                                                                                                                                                                                                  |

### 2. The baseline, and two broken checks of mine

Before changing any product file I ran every earlier check on the untouched tree, on scratch profiles inside your
encrypted `AppData`, so that a later failure would be known to be mine.

| Check                                                                          | Result                                                    |
| ------------------------------------------------------------------------------ | --------------------------------------------------------- |
| The provider module under plain Node, against the mock                         | 51 of 51.                                                 |
| Stage 1's four UI suites in the dev window, through the real IPC, SDK and mock | 17 + 35 + 42 + 16 = 110 of 110.                           |
| Stage 2.3's suite (settings, key storage, sender guard)                        | **Could not start**, then 62 of 64 once fixed. See below. |
| ...its restart check                                                           | 5 of 5.                                                   |
| Stage 2.4's suite (the chat path, every failure, the guards)                   | 71 of 71.                                                 |

**What was broken, and it was my checks, not the app.**

1. **Stage 2.3's suite died on its first line.** In slice 2.4, `validate.ts` began importing a value (`CHAT_LIMITS`)
   from `./ipc` without a file extension. Bundlers and TypeScript resolve that; Node's own loader does not, and
   that suite loads `validate.ts` straight under Node. Slice 2.4's final checks never re-ran the 2.3 suite, so
   nobody noticed. I wrote a small resolve hook for my test harness (it changes no project file), after which the
   suite ran.
2. **Two of its assertions were out of date** for the same reason: they expected `window.api` to have only
   `settings` and `getStatus` to return only `{ hasKey, canStoreKey }`. Slice 2.4 changed both on purpose.
   Nothing else in that suite failed. I updated those two assertions in my copy.

Two small things for the record. The tool that runs my commands twice refused a command because it mistook text
for a file to delete (a regular expression, then a quoted path); nothing ran either time, and I rewrote them.
And **I recorded a golden copy before writing any Stage 3 code**: the three request bodies the Stage 2 provider
sends (a single message, a conversation, and two messages from the person merged) and the exact wording of its
"model not found" message. Stage 3 has to leave the default model's request unchanged, and that can only be
proved against a copy taken beforehand.

### 3. Slice 3.1 - the registry file, its check and the loader

File edits: `registry/models.json` (the four models); new `src/shared/registry.ts` (the shape of the file,
`parseRegistry`, the strict check, and `toModelOption`, which says what the page may know about a model); new
`src/main/registry.ts` (imports the JSON, so the build embeds it, and checks it once); the shared contract in
`src/shared/ipc.ts` (`ModelOption`, a bigger `SettingsStatus`, `setModel`); `checkModelChoice` in
`src/shared/validate.ts`; and `tsconfig.node.json` now lists the JSON file. Nothing is wired into the app yet.

| Command                                                        | What it does / why                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| -------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `node verify-3-1.mjs` (my check script, plain Node, no window) | The real registry file plus every kind of damage: wrong versions, missing and misspelt fields, bad dates (including 30 February), numbers that are negative, fractional, `NaN` or too large, text with line breaks or a megabyte long, 100 000 entries, a `__proto__` key, duplicate ids, a default that does not exist, and the model-choice check against 16 kinds of bad input. **First run 157 of 159.** Both failures were flawed assertions of mine, below. |
| Fixed the two assertions, re-ran                               | The timing check wrapped the _building_ of a 100 000-entry input, which took longer than the refusal it was timing. The other wanted a problem message under 150 characters when the true bound is about 165 (a 500-character id is cut to 64 characters, then added to a message). Both now assert the real property. **159 of 159.**                                                                                                                            |

### 4. Slice 3.2 - the provider takes a registry entry

`provider.ts` no longer has `MODEL`, `MODEL_LABEL` or `PROVIDER_NAME`. `streamReply` takes the model's entry:
the request names that model, sends `output_config.effort` only when the entry has one, and caps `max_tokens` at
the lower of 16 000 and the model's own limit. The "model not found" message names the model that was asked and
adds "You can choose another model in the header." (There is a menu to choose from now.)

The mock API had to learn about several models. It used to demand `effort: "medium"`, which was a Stage 2 design
assertion and not an API rule. It now refuses what the docs say the real API refuses: `effort` on Haiku 4.5, a
level that does not exist, `max_tokens` above a model's maximum, and an unknown model (a 404). It is still my
reading of the docs, not the real API.

| Command                                                                 | What it does / why                                                                                                                                                                                                                                                                                                                                                                                                        |
| ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `node provider-node-test-3.mjs` (Stage 2's 51 checks, adapted, plus 42) | Against the real registry file. The default model's three request bodies must equal the golden copy **key order included**; all four models are accepted by the strict mock with exactly their own settings (Haiku carries no `output_config` at all); `max_tokens` follows a model's own limit; a retired model's 404 reads correctly. **93 of 93 on the first run.** A first-time pass proves little, so:               |
| Negative control A: send `effort` to every model again                  | One-line sabotage of `provider.ts`, run, restore from a backup, compare hashes. 5 checks failed, exactly where they should: Fable's level, Haiku's 400, Haiku carrying an `output_config`, and two that rely on `effort` following the registry. **The golden-copy check alone did not catch it**, because Opus's request is unchanged under that sabotage. The per-model checks are what protect the other three models. |
| Negative control B: ignore the model's own output limit                 | Exactly the two checks with a limit below 16 000 failed.                                                                                                                                                                                                                                                                                                                                                                  |

### 5. Slice 3.3 - which model answers

New `src/main/models.ts`: the person's saved choice, or the registry's default. `currentModel()` is what the chat
uses (read once per reply, when it starts), `chooseModel()` saves a choice, and `inOrder()` runs model changes one
at a time. `ipc.ts` gets the `settings:set-model` handler behind the same sender guard, and `getStatus` now
returns the model list and the current choice. `chat.ts` asks `currentModel()` after reading the key and tells
the person plainly if the registry could not be loaded. The preload gains one function, `setModel`.

Why `inOrder` exists. Holding an arrow key on a closed menu changes the choice once for every option it passes,
so several `setModel` calls can be in flight at once. Their saves can cross, and the answer that arrives last
may not describe the choice made last. I built the ordering before I had seen the problem; I then saw it (negative
control below): with the ordering switched off, quick changes produced "The choice could not be saved" errors.

### 6. Slice 3.4 - the menu and Settings

New `settings/ModelPicker.tsx` (the menu) and `settings/format.ts` (writes 1000000 as "1M" and 4 as "$4"). The
header badge that named the model is gone; the "No API key" badge stays. `App.tsx` now holds the conversation
(`useChat`) instead of `ChatView`, because the header has to know when a reply is arriving to lock the menu;
`ChatView` receives it as a prop. Settings gets a "Model" section. The CSS lets the header wrap in a narrow
window instead of overflowing.

| Command                                                     | What it does / why                                                                                                                                                                                                                                                                   |
| ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `npx prettier --write`, `npm run typecheck`, `npm run lint` | Clean. Prettier reformatted five files.                                                                                                                                                                                                                                              |
| `node contrast-3.mjs`                                       | WCAG contrast for the colours the menu uses: text on the page 12.81:1, on its hover fill 9.37:1, the border 3.93:1, the focus ring 5.79:1, the Settings text 11.98:1 and 5.76:1, all above the bars. The greyed-out state is 3.20:1 (informational: WCAG exempts disabled controls). |
| Looked at the screenshots                                   | The menu sits beside Settings as a matching pill. At 420 pixels the header wraps (title above, controls below). The menu is greyed out while a reply streams. The Settings dialog gets a divided "Model" section and now scrolls in the default window, because it is taller.        |

### 7. Checking it in the real window, and what went wrong

Same method as before: drive the real Electron window from outside through the DevTools protocol, through the real
IPC and SDK, against the mock API, on scratch profiles inside your EFS-encrypted `AppData` (named
`frontier-app-test-scratch-*`, each verified in use before it writes anything, all deleted afterwards). Four new window
suites (two more run under plain Node), and Stage 1 and 2's suites re-run with only the assertions that Stage 3 changed on purpose updated (the
model badge became a menu, `window.api` gained `setModel`, the status object grew).

| Suite (checks)                                          | What it covers                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `verify-3-4` (77), a fresh profile                      | The menu lists the registry's models in its order and starts on the default. The page is told nothing about how a model is called. Settings shows the right details and prices. The header fits at 420 and 320 pixels. Keyboard: Tab order, ArrowDown and ArrowUp. The choice is saved as exactly `{"version":1,"modelId":"..."}` with no temporary file. **25 bursts of six quick changes** all end with the menu, main and the file agreeing on the last. A chat with each of the four models sends exactly that model's settings. The menu locks while a reply arrives, and a model switch forced mid-reply does not affect it. A mid-chat switch sends the whole chat to the new model. 14 kinds of bad `setModel` input are refused, and a call from `about:blank` is rejected. |
| `verify-3-4b` (13), a second launch on the same profile | The choice survives a real restart; starting up and chatting leave the file's modification time untouched; removing the API key does not forget the model.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `verify-3-5` (9 each), 16 launches                      | A saved choice that is: valid; valid with extra fields; a retired model; the right id in the wrong letter case; `__proto__`; a path-traversal string; corrupt JSON; another version; no model; a number; an object; an empty file; a JSON array; `null`; a file starting with a byte-order mark; 5 MB of random bytes. In every case: the right model is shown, the window opens quickly, the file is byte-identical afterwards, a missing model is logged exactly once, and choosing from the menu replaces the bad file.                                                                                                                                                                                                                                                           |
| `verify-3-6` (10 to 14 each), 9 launches plus a build   | `registry/models.json` deliberately broken or changed, run through the real loader: wrong version; every entry misspelt; default missing; default itself broken; one broken entry; an unknown provider; entries reordered (the default is _not_ the first); a different default; a saved choice whose model is now broken. A file that is not valid JSON must stop the build with no window.                                                                                                                                                                                                                                                                                                                                                                                         |

**What went wrong, or was found, along the way:**

| What                                               | Detail                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| -------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `verify-3-4`, first run: 76 of 77                  | My bug. I collected the results of the 14 bad inputs in a plain object, and `out['__proto__'] = '...'` does not create a key; it silently sets the prototype. The `__proto__` case, the one I most wanted, was never recorded (13 results). All 13 recorded ones were refused. I switched to a list of pairs. **77 of 77.**                                                                                                                                                                                                                                                      |
| One scenario found a **weakness in the validator** | In the "every entry misspelt" scenario (`effort` written `effrot`) the log said only `field "effort" missing`, never mentioning `effrot`. My validator reported the first problem it found, and a renamed field is two problems at once. I changed it to report both (`field "effort" missing; unknown field "effrot"`) and added three checks to the Node suite (159 to 162). My first test had only covered an _added_ field, so it missed this.                                                                                                                               |
| A claim of mine that was **wrong**                 | I was about to write that editing `registry/models.json` while `npm run dev` runs restarts the app. I tested it: the dev server printed nothing and the app never changed. Electron-vite's hot reload is for the page only. I then tried its `--watch` flag, and the dev server printed "main process rebuilt" and "restarting electron app", and the window came back with the edited label. D-014 now says what is true: restart, or use `npm run dev -- --watch`.                                                                                                             |
| One **intermittent** failure, not reproduced       | In the first run of the 16 saved-choice launches, the byte-order-mark one failed "no temporary file left, no error badge", although the file content check beside it passed. Re-run three times: all passed; and again in the final full run. My likely cause, **not proven**: Chromium keeps its own `Preferences` file in the same folder and saves it through a temp file (`Preferences~RF….TMP`), which my loose file-name match could catch if the timing was unlucky. I tightened the check to my file's own name, and it now prints what it found if it ever fails again. |
| The tool refused two commands                      | It mistook text in my command for a file to delete (a regular expression, then a quoted path). Nothing ran either time. I rewrote them without `Remove-Item` near path-like text.                                                                                                                                                                                                                                                                                                                                                                                                |

**Negative controls for the window suite.** Seven one-line sabotages, each run against `verify-3-4`, each file
restored from a backup and compared by hash afterwards:

| Sabotage                                                 | What the suite said                                                                                                                                                                         |
| -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The sender guard switched off                            | 4 checks failed: `about:blank` was handed the model list and could change the saved choice.                                                                                                 |
| Only the first validation layer off (`checkModelChoice`) | 1 check failed, and only about the _wording_ of the refusal. Invalid ids were still refused and nothing was saved: the second layer, in `chooseModel`, held. So each layer alone is enough. |
| Both validation layers off                               | 5 checks failed: an invented model id was accepted and **saved**. Only now can bad input through.                                                                                           |
| The saved choice ignored                                 | The suite stopped at its first "wait until the choice changes" (25 checks had passed), because the selection never moved.                                                                   |
| Model changes run side by side (no ordering)             | 3 checks failed: the first burst of quick changes ended with a red "The choice could not be saved on this computer." badge. So the race is real and `inOrder` earns its place.              |
| The menu never locked                                    | Exactly 1 check failed: "while a reply is arriving the menu is disabled".                                                                                                                   |
| The chat always asks Haiku, whatever is chosen           | 9 checks failed.                                                                                                                                                                            |

### 8. The built app

| Command                                                                                 | What it does / why                                                                                                                                                                                                                                                                                                                 |
| --------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm run build`, then `grep` on `out/main/index.js` and `out/preload/index.js`          | Passed. The four model ids, the default id, the schema version and the date are inside the main program's file, so the registry really is embedded. Nothing in it reads `models.json` from disk or asks for the app's folder (the three matches are log and error text), and the sandboxed preload still requires only `electron`. |
| `verify-3-4` and `verify-3-4b` on the **built** app                                     | 77 of 77 and 13 of 13. This is the one that loads from a `file://` page, where the sender guard compares file addresses.                                                                                                                                                                                                           |
| `verify-prod`, `verify-1-3`, `verify-2-4`, `verify-2-3`, `verify-2-3b` on the built app | 11, 42, 71, 64 and 5, all passing.                                                                                                                                                                                                                                                                                                 |

### 9. Final checks

| Command                                                                                                    | What it does / why                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| ---------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npx prettier --check .`, `npm run typecheck`, `npm run lint`, `npm run build`, `npm audit`                | All clean; `npm audit` reports 0 vulnerabilities.                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| Every suite again on the final code                                                                        | Node: provider 93 of 93, registry and model-choice checks 162 of 162. Dev window: Stage 1 (110), 2.3 (64 and 5), 2.4 (71), 3.4 (77 and 13), the 16 saved-choice launches, the 9 registry scenarios and the invalid-JSON build. Built app: as in step 8.                                                                                                                                                                                                                             |
| `node run-with-app.mjs dev plain-check.mjs` (plain `npm run dev`, **your real profile**, no test settings) | A read-only startup check exactly as you would run it: no clicks, no typing, no saving, and no key, so the app cannot call the network. 8 of 8: title, Electron 44.5.1, the "No API key" badge and hint, the Settings button, the exact `window.api` surface including `setModel`, the model menu with its four models and the default selected, no console errors. Your profile held no `credentials*` or `preferences.json` before or after, so starting up writes nothing there. |
| Deleted the scratch profiles and my backups                                                                | Nine `frontier-app-test-scratch-*` folders inside `AppData` (never your real `frontier-app`) and the sabotage backups in the temporary folder. No Electron, mock or runner process was left running.                                                                                                                                                                                                                                                                                |
| `npx prettier --write STEP-LOG.md docs README.md`                                                          | Formatted the docs.                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `git add -A`, `git commit`                                                                                 | **The one commit of Stage 3**: "Stage 3: model registry in use, model menu in the header (D-014, D-015)". After it, `git status` shows nothing uncommitted (only `node_modules/`, `out/` and `.eslintcache` are ignored).                                                                                                                                                                                                                                                           |

## Stage 3 - Choices I made where things were unclear ("pick the simplest option")

- **Which models.** You did not say. I chose the four current Anthropic models, Fable 5.1, Opus 5.5, Sonnet 5.5
  and Haiku 4.5, which gives four real price and capability tiers. Older models are superseded, and Mythos is
  for approved Project Glasswing customers only. **The default stays Opus 5.5**, so nobody's bill changes by
  itself. Fable 5.1 is the most expensive ($10 and $50 per million tokens, two and a half times Opus). It is one
  click away in the menu, and Settings shows the price.
- **The registry is built into the app, not read from a file at run time.** It removes every question about
  where the file is in an installed app, which this project has never been able to test. The price: editing it
  needs a restart (or `npm run dev -- --watch`). Reading a user-editable copy from the data folder is a later
  step (`docs/IDEAS.md`).
- **Facts in the registry, policy in code.** The file says what a model _is_ (size, price, whether it takes
  `effort`) and which `effort` level to ask for. The reply ceiling, caching, the plain-text system prompt and
  the API address stay in code, so the file can never change where your key goes.
- **`effort` per model, from the docs' own recommendations**, not one value for all (Stage 2 hard-wired
  `medium`): Opus `medium`, Sonnet `medium`, Fable `high`, Haiku none. `xhigh` and `max` cannot be written in
  the file, because not every model that takes `effort` accepts them.
- **Haiku by its dated id** (`claude-haiku-4-5-20251001`), which Anthropic's docs list as its API id, not the
  alias. The alias moves; the facts I recorded belong to a snapshot.
- **Strict, with no fallback list.** A broken file is shown, not hidden. A typo drops one entry and names it in
  the log; a file unusable as a whole shows "Models unavailable".
- **The schema version went from "0.1" to "0.2".** "0.1" was an empty template; a file with models in it is a
  different shape, and the loader accepts exactly one version. `rankings.json` stays at "0.1".
- **The menu is in the header** (Stage 1's notes already called that its natural place), with the details in
  Settings. A second copy of the control in Settings would be two things to keep in step. To lock the menu during a
  reply, `useChat` moved up from `ChatView` into `App`: the usual way to share state between two parts of a screen.
- **The choice is kept by the main program**, in a file of its own, not in the page's storage: the page is the
  less trusted side, the dev server and the built app have different page storage, and main already keeps the key.
- **Left out on purpose, each a possible next step** (all in `docs/IDEAS.md`): naming the model that wrote each
  reply, switching automatically when a model is "not found", choosing the effort level, a cost display, a
  build-time check of the registry, and server-side refusal fallbacks (D-012, now for three more models).
- **No new packages, and one commit.** You asked for the working tree to be committed with one message, so slices
  3.1 to 3.5 are described in this log but are not separate commits (point 1 below).

## Stage 3 - Things to know (not problems, but worth your attention)

1. **Stage 3 is one commit, not one per slice.** Earlier stages ended with a commit per slice. This time you asked
   for the working tree to be committed with a single message, so slices 3.1 to 3.5 are described in this log but
   are not separate commits. Nothing was pushed; there is no remote.
2. **I still have never called the real Anthropic API**, and there are now four models in that position, not one.
   Every check ran against the mock, which is my reading of Anthropic's docs. Specific things only a real message
   can settle: Fable 5.1 requires the account to allow 30-day data retention (otherwise the API answers with a
   400, and the red note will show Anthropic's own words); the `effort` levels I chose for Sonnet 5.5 and Fable
   5.1 are my reading of the docs; a model your account cannot use reads as "not found (404)". **The first real
   message is still the real test**; try each model you care about once.
3. **Money.** The menu makes the expensive model one click away. The prices Settings shows are list prices per
   million tokens, as read on 2026-10-01; Anthropic can change them, and the file's date says how old they are.
   Cached reads cost less than the figures shown. One reply is still capped at 16 000 tokens for every model;
   with thinking on, a long answer from a model that thinks a lot may reach that cap more often (not observed:
   no real model was run).
4. **Haiku 4.5 may be retired soon.** Anthropic's page says "not sooner than October 15, 2026", two weeks after
   this was written. After it goes the app will say "The model claude-haiku-4-5-20251001 was not found for this
   account (404). You can choose another model in the header." To drop it, delete its entry in
   `registry/models.json`.
5. **Editing the registry.** Restart `npm run dev`, or run `npm run dev -- --watch` so it restarts by itself.
   `npm run dev` with a file that is not valid JSON prints the error (file and position) and exits **with code 0**
   and no window; the message is easy to miss.
6. **The Settings dialog now scrolls** in the default 900 by 670 window, because the Model section made it
   taller. Escape still closes it and the key field still has focus when it opens.
7. **Not checked:** opening the menu with the mouse and clicking an option (the open list is drawn by the system
   and DevTools cannot see or click it; I changed the choice with real arrow-key presses and with script
   events, which fire the same `change`); a real screen reader (only the menu's label); macOS and Linux;
   packaging (`npm run build:win` was not run; the registry being embedded means it adds no packaging risk of
   its own); very long conversations; window zoom levels.
8. **Two of my Stage 2 checks had gone stale and I only noticed because I re-ran everything first** (step 2): the
   2.3 suite had not been run since slice 2.4. These scripts live in a temporary folder and nothing re-runs them.
   That is the best evidence yet for the offer I made at the end of Stage 2: **say the word and I will keep them
   in the project (for example under `tools/`)**, with the mock server, the DevTools helper and a one-command
   runner. I had to rewrite or repair several of them again this stage.
9. **Everything in Stage 2's "Things to know" still applies** (your `AppData` is EFS-encrypted, so renaming a
   file in it fails and `preferences.json` is written in place; the key store's limits; only Windows was
   tested; packaging is untested; the SDK ignores the system proxy).
10. **Files outside the project.** Project files are only under `A:\frontier-app`. Elsewhere: I read three pages
    of Anthropic's public documentation and queried the npm registry (`npm audit`, `npm view`); I installed
    nothing and downloaded no files. The scratch profiles I made inside `AppData` are deleted, and your real
    profile holds no `credentials*` or `preferences.json`. The throwaway scripts, screenshots and logs are in this
    session's temporary folder.
11. **Git may print "LF will be replaced by CRLF" warnings.** Harmless, as before.
12. **No secrets anywhere.** No API key, no `.env`, nothing pushed. The test keys were invented per run and are
    not recorded.

## Stage 4 - What was built

Running `npm run dev` opens the same chat, with two new buttons in the header and one new dialog:

- **Your chats are saved as you go.** Nothing to press. The moment you send a message it is saved; while a reply
  streams in it is saved about once a second; when the reply finishes, is stopped or fails, it is saved again.
  Close the window in the middle of a reply and the next launch shows exactly the text that was on screen, marked
  "Stopped".
- **New chat** starts an empty chat. The old one stays saved. The app itself opens on an empty chat; yesterday's is
  one click away.
- **History** opens a dialog listing your saved chats, newest first: the first thing you wrote, when it was last
  saved, how many messages it has. Click one to open it and carry on (the model is sent the whole conversation, as
  always). **Delete** asks first ("Delete? Delete / Keep", with Keep selected) and then removes the file. With a long
  list, the list scrolls inside the dialog and Close stays in view.
- **It tells you where the files are and what that means.** One plain text file per chat in a `conversations` folder
  next to the app's other data (for you: `C:\Users\91995\AppData\Roaming\frontier-app\conversations`). They are
  **not encrypted**, unlike your API key; the dialog says so. Deleting a chat deletes its file.
- **If a save fails** (disk full, a folder the app may not write), a red **Not saved** button appears in the header
  with the reason in its tooltip; pressing it tries again, and so does your next message. Nothing is hidden and
  nothing blocks you.
- **A damaged file is never thrown away.** If a saved file cannot be read (a crash cut it off, or you edited it by
  hand and broke it), the app counts it, names it in its log, says "N saved files could not be read and was left as
  it is" in the dialog, and leaves it exactly as it is. A file that a crash left half-way through being replaced is
  recovered automatically from the complete copy the saving method keeps beside it.
- Under the hood: the page sends the whole conversation each time and the main program checks and writes it, one
  save at a time, in order. A save writes a complete new copy beside the old file, reads it back, copies it over
  the old file, reads that back, and only then deletes its own copy (no renaming, which fails in your encrypted
  `AppData`). Quitting waits (at most 5 seconds) for saves in progress. The title and dates are worked out by the
  main program, never taken from the page. The page can only ask to list, open, save and delete, through four
  messages that go through the same "is this really our window?" check as everything else.
- **No new packages.** `useChat` gained one function (`load`) and the input box one prop (so it can take the focus
  after New chat); `ReplyFn` and the other chat components are unchanged.

It was built in four slices: 4.1 the contract, the checks and the store (no window yet, tested under plain Node), 4.2
the main program's four handlers and the quit hold, 4.3 the page (autosave, buttons, dialog), 4.4 the window checks
and these docs. **It is not committed** (see "Things to know", point 1). **Nothing has been tried against the real
Anthropic API**, as before.

## Stage 4 - Decisions

The full records are D-016 and D-017 in `docs/DECISIONS.md`; I also corrected four older records Stage 4 made out of
date (D-007, D-010, D-011, D-013). The short version:

### D-016 - One plain JSON file per conversation, saved copy-then-delete, not encrypted

- **One file each, no index file**: nothing to keep in step, and a damaged file loses only itself. The list is read
  once, then kept in memory (1000 chats of 22 KB: 0.2 s in a normal folder, 0.9 s in your encrypted `AppData`).
- **Written in three steps** (a complete `.tmp` copy, read back; copied over the real file, read back; `.tmp`
  deleted) with one reading rule: a `.tmp` that parses wins, one that does not was cut off and is ignored. A
  half-written JSON file never parses, so a torn write cannot pass for a whole one.
- **Reading never writes, and nothing is deleted except by you.** The id (a lower-case UUID) becomes a file name,
  so it is checked twice. A file's size is looked at before it is read. Limits are above what chat itself will send,
  because a reply can push a chat past that and you must still be able to save what you were shown.
- **Plain text, and you are told.** Encrypting it would strand every chat after a Windows profile change; your
  `AppData` is already EFS-encrypted by Windows.
- **Quitting waits for saves** (5 seconds at most).

### D-017 - Who saves, when, and what you see

- **The page sends a snapshot, main checks and writes it** (the alternative would change the chat protocol, and
  could not save a failed reply with no text).
- **When:** your message at once; a streaming reply at most once a second; a finished, stopped or failed reply at
  once; a chat just opened from disk not at all; what is waiting when the window closes.
- **Opens on an empty chat; History is a dialog, not a sidebar; Delete asks first; a failed save shows a button.**
- **Left out on purpose:** naming the model that wrote each reply (it cannot be reconstructed later, so chats saved
  now will not have it), renaming, searching, exporting.

## Stage 4 - Step by step

### 1. Look around before changing anything

| Command                                                                                                                                                                   | What it does / why                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Reading `STEP-LOG.md`, `docs/DECISIONS.md` and `docs/ROADMAP.md` first, as you asked, then `ARCHITECTURE.md`, `IDEAS.md`, `README.md` and all the code this stage touches | Just reading. **The roadmap has no Stage 4**: it ends with a "Later" list that says it is tentative. I took the first item, conversation history on disk, because D-010 ("conversation history is the next one"), D-013 ("There is no New chat button yet") and the architecture notes ("Not built yet") all name it as the next piece of work. I wrote that interpretation into the roadmap. If you meant something else, this is the place to say so.                                                  |
| `git status`, `git log`, `git branch -vv`; PowerShell check for leftover Electron processes                                                                               | Read-only. `main` and `stage-3-registry` both point at Stage 3's commit, and the tree was clean. Nothing left running.                                                                                                                                                                                                                                                                                                                                                                                   |
| `npm audit`, `npm view electron dist-tags.latest`                                                                                                                         | D-003's rule, at the start of every stage. 0 vulnerabilities; 44.5.1 is the newest Electron, so the installed 44 is inside the three supported majors.                                                                                                                                                                                                                                                                                                                                                   |
| `npm run typecheck`, `npm run lint`, `npx prettier --check .`                                                                                                             | Baseline. Typecheck passed. **Prettier named 22 files and eslint printed 1451 warnings**, which Stage 3 had recorded as "all clean". See the next table.                                                                                                                                                                                                                                                                                                                                                 |
| `git ls-files --eol`, then removing the stray `\r` from 24 files and `git add` on exactly those files                                                                     | **Cause: line endings.** Your Git has `core.autocrlf=true`; when `main` was fast-forwarded to Stage 3's commit, Git re-wrote the files that changed with Windows line endings. The commit itself is fine. I stripped the `\r` (no content change: the blobs hash the same), confirmed prettier and eslint were clean, and refreshed Git's index (otherwise `git status` listed 24 files as modified for a reason only a timestamp could explain). Final state: `git status` clean. See "Things to know". |
| Copied Stage 3's check scripts from an earlier session's temporary folder and **read the core ones before running them**                                                  | They are not in the project. A scan for side effects found only loopback addresses and scratch profiles. I wrote a small driver (`drive.mjs`) that runs one launch per suite, each on a scratch profile inside your encrypted `AppData`.                                                                                                                                                                                                                                                                 |

### 2. The baseline, and what was wrong with it

Before changing any product file I ran every earlier check on the untouched tree, so that a later failure would be
known to be mine.

| Check                                                                            | Result                                                                     |
| -------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| Node: the provider module; the registry and model-choice checks                  | 93 of 93; 162 of 162                                                       |
| Dev window: Stage 1's four suites; 2.3 and its restart; 2.4; 3.4 and its restart | 110; 64 + 5; 71; 77 + 13. All passing (but see below: one needed a re-run) |
| Dev window: 17 saved-choice launches; 10 registry scenarios                      | 9 of 9 each; all ten as before                                             |
| Built app: `verify-prod` and Stage 1's chat suite; 2.4; 3.4                      | 53; 71; 77 (after the redo below)                                          |

**What went wrong, none of it in the app:**

| What                                                          | Detail                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| ------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The built-app baseline was **invalid**                        | `npm run build` type-checks first, and the new (not yet wired) files I had already written did not compile, so the build stopped and `out/` stayed as it was. And `out/` was not Stage 3's: `electron-vite dev` also writes `out/main`, so the last registry scenario had left its own bundle there (Haiku's entry broken, hence a menu with three models). I rebuilt with `npx electron-vite build` and redid those runs on a fresh build. **Note for later: before any built-app check, rebuild.**                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| One mistake of mine in the redo                               | I chained `setup-key` before `verify-2-4`, which wants a profile with no key. It failed its first three checks, correctly.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| **Six launches misbehaved, five of them at "click Settings"** | In the baseline `verify-2-3` once gave 62 of 64 ("the dialog is closed at first" and its focus check); later, with no wait between launches, Stage 1's chain failed two scroll-layout checks and the next `verify-2-3` timed out opening Settings; one registry scenario lost its Settings click in the middle of a run; two launches of the new suites lost it at startup; and two _built-app_ runs of new suites were hit as well (one hung until its timeout, one took 5 s to open a dialog). That is about 8 launches in some 250, roughly 1 in 30, and I could not make it happen on demand: three runs with the debug port freed first (clean), four back-to-back launches (clean), 150 rapid open/close cycles of Settings at five delays after Escape (0 misses), and a measurement of how long an old page survives a reload (about 10 ms, so not that). **What finally explained it:** in a failing launch the click landed on the right button, there was one navigation, and the page answered every query in under 6 ms, yet _the three mouse events took about 5 seconds to be acknowledged_. I then **minimised the window through the main process: `document.visibilityState` became "hidden", `Runtime.evaluate` still answered in 1 ms, and the mouse events were acknowledged after 5022 ms** (31 ms when visible). That is the exact signature, so the glitches were launches in which the app's window was hidden or covered by your other windows (it opens on your screen, and Windows may open it behind what you are working in). **Not proven:** that being covered (rather than minimised) does the same; a covering window of my own did not count as covering. The launcher now passes the flags that automation tools use against this (`--disable-features=CalculateNativeWinOcclusion`, `--disable-backgrounding-occluded-windows`, `--disable-renderer-backgrounding`), and any slow mouse acknowledgement now prints the window's state. With them, the two affected built-app suites re-ran clean. Nothing in the app was involved: the app was never slow to answer, and the product is not started with these flags. |
| A bug of mine that looked like the same thing                 | Once the History dialog existed, `setup-key` failed _every_ time: the page showed the Settings dialog **open**. My first version of the History dialog reused the `settings` class, so every old suite's `dialog.settings` matched the History dialog first. The harness's new snapshot made it obvious. The History dialog now has its own class names (D-017).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |

Two more small things for the record. The tool that runs my commands halves backslashes inside heredocs and once
rejected a long heredoc outright; files containing backslashes or long prose are now written with the file tools.
And the old suites needed two small changes, which are the only two things Stage 4 changes on purpose that they had
asserted: the Settings button is no longer the first `.header-button` in the header (New chat and History come
first), so the harness now picks it by its text; and `window.api` gained `history`, so three assertions about its shape
say so.

### 3. Slice 4.1 - the contract, the checks and the store (no window yet)

File edits: `src/shared/ipc.ts` (the history types, four channel names, `HISTORY_LIMITS`), `src/shared/validate.ts`
(`isConversationId`, `checkConversationId`, `checkSavedMessages`, `checkConversationSave`), and the new
`src/main/conversationStore.ts`, which imports nothing from Electron so that it can be tested under plain Node with any
folder. The old "Close and reopen the window to start a new one" in the too-long-to-send message now says "Start a new
chat."

| Command                                                                    | What it does / why                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| -------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `node verify-4-1.mjs` (plain Node, no window; **389 checks, run twice**)   | Every kind of bad id (upper case, traversal, device names, `__proto__`, a trailing newline, Unicode digits); every kind of bad conversation (wrong types, roles, statuses, sizes, a list of 50 million good messages served by a Proxy); the store itself in **a normal temp folder and in a scratch folder inside your encrypted `AppData`** (a probe prints that `rename` works in the first and fails with `EXDEV` in the second, so the second really is the hostile one); every crash state built by hand (a torn real file with a whole `.tmp`, a whole real file with a cut-off `.tmp`, 5 MB of random bytes, a file over the size limit, a byte-order mark, another version, a directory with a conversation's name); **faults injected into each step of a save** (a failing copy, a write cut off halfway, a read-back that differs, a `.tmp` that cannot be deleted, a folder that cannot be listed); 60 saves fired at once, a save-remove-save-load burst; the speed of a first look at 1000 chats. It took several rounds of fixing my own mistakes in the test before it was clean (a random UUID with no "0" to swap, a sum that tripped the per-message limit first, a title I expected not to change, a helper that could not read a directory); it is now 389 of 389, the count having grown as checks were added. |
| Negative controls: 22 one-line sabotages, one at a time                    | Each sabotage was applied to a backed-up copy of the product file, the suite run, the file restored and its hash compared with the original (every one: "ALL IDENTICAL to before"). **All 22 were caught**, each by the check that targets it: ignoring the `.tmp` fails 14 checks; writing in place instead of copy-then-delete fails 10 (the "cut off halfway, the OLD copy survives" ones); dropping the read-back fails 6; dropping the store's own id check fails all 16 hostile-id checks; reading that writes fails 12; and so on. Two sabotages (no ordering queue; a failed scan remembered) make the suite crash rather than fail a named check, which is also a detection.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| **Two of my checks passed with the protection removed**, so I rewrote them | "A list of 50 million items is refused at once" passed without the length check, because its first item was `undefined` and was refused instantly. It now uses good-looking messages through a Proxy and takes 0 ms against 1196 ms with the check removed. And "a file over the size limit is never read" only asserted that it was unreadable; it now records every file the store reads.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| The speed of the first look                                                | 1000 conversations of 22 KB each (22 MB): 0.2 s in a normal folder, 0.9 s in your encrypted `AppData`, then served from memory. This is why there is no index file.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |

### 4. Slice 4.2 - the main program

`src/main/ipc.ts` gets four handlers (`history:list`, `:load`, `:save`, `:remove`) behind the same sender guard as every
other message; each validates again, logs the real reason for a failure (which could name a path) and tells the page a
plain sentence. `registerIpc` now returns a function that resolves when the saves in progress are done, and
`src/main/index.ts` holds `before-quit` until then (at most 5 seconds) before quitting for real. The preload gains the
four functions of `window.api.history`, and nothing else.

### 5. Slice 4.3 - the page

New `src/renderer/src/history/`: `useHistory.ts` (autosave and the list), `HistoryDialog.tsx`, `convert.ts`, `format.ts`.
`useChat` gained `load`. The header gets **New chat** and **History** (off while a reply arrives, as the model menu is),
a **Not saved** button when a save fails, and the focus goes to the input box after New chat. The dialog is a native modal
`<dialog>` like Settings, with its own class names; the stylesheet shares the visual rules by selector lists. WCAG
contrast for every new colour pair was computed (`contrast-4.mjs`): all above AA, the lowest text pair 4.81 to 1 (the muted
date line on a hovered row).

### 6. Checking it in the real window, and what went wrong

Same method as before: the real Electron window driven from outside through the DevTools protocol, the real IPC, SDK and
mock API, on scratch profiles inside your encrypted `AppData` (named `frontier-app-test-scratch-*`, each verified in use
before it writes anything, all deleted afterwards). Eight new suites:

| Suite (checks)                          | What it covers                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `verify-4-2` (89), a fresh profile      | A fresh start writes nothing (no folder, no file) however long it sits. The first reply creates exactly one `<uuid>.json` in the documented shape, equal to what is on screen, with no `.tmp`. **A streaming reply is saved about once a second** (3 or more different lengths seen, 2 to 6 writes in 3.6 s) and **never with the status "streaming"**. The question is on disk within 700 ms; **a message sent right after a reply within 500 ms**. Stop, a reply that never comes, a 500 and a mid-stream error are all saved with their text and reason. New chat; the History dialog (rows, the open one marked, order); opening a chat shows exactly what was saved, with the right notes, and **writes nothing**; continuing it sends the model the whole saved conversation. Delete asks first, Keep and Escape cancel, confirming deletes the file and the row; deleting the open chat starts a new one. The buttons are disabled while a reply arrives. **Abuse**: 28 bad load/remove calls and 16 bad saves refused, nothing created or changed; the page cannot forge the title, the dates or the version; all four calls from `about:blank` rejected. Narrow windows at 420 and 320 pixels. |
| `verify-4-2b` (17), a second launch     | Everything survives a real restart; starting up changes no file (same bytes, same modification time); the app opens on an empty chat; a chat opened after the restart continues in the same file; **removing the API key leaves history untouched**.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `verify-4-3b` (9) and `verify-4-3d` (8) | **The window is closed in the middle of a reply** (from the main process). The file has the question and the partial reply, status stopped, **186 characters on screen and 186 saved: nothing lost.** The next launch lists it, shows the partial text with "Stopped", and lets the person carry on. Also re-checks D-004's window settings from the main process, because this stage changed the preload and `index.ts`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `verify-4-3c` (4)                       | **Quitting with a backlog**: 60 saves of a 1.4 MB conversation fired at once, then `app.quit()`. The file ends as the 60th save, whole, with no `.tmp`; the quit took 6 s.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `verify-4-3a` (32), a seeded folder     | Nine hand-made states in the folder before launch: good files, one saved by an older build with "streaming" in it, a crash during the copy (torn file plus whole `.tmp`: the `.tmp` wins), a crash during the first write (whole file plus cut-off `.tmp`: the file wins), a byte-order mark, three unreadable files, and files that are not conversations. Listed correctly; the dialog says "3 saved files could not be read and was left as it is"; **starting up and opening every chat changed no file**; the log names each unreadable file by id once, with no path. Carrying on from the recovered chat heals it (its `.tmp` disappears) and is the only file that changed. A file that goes bad or missing after it was listed: the dialog says so and the row goes.                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `verify-4-4` (24)                       | **150 chats** made through the IPC: the dialog opens in under 1.5 s, and at 900 by 670, 420 by 700 and 320 by 700 the heading and Close stay in view while the list scrolls inside; Tab from the first row reaches Close; Escape closes. (First version: Close ended up 9339 pixels down. Fixed.)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `verify-4-5` (19)                       | **Saves fail**: a disk fault is injected into the running app's main process. The "Not saved" button appears with a plain tooltip and the page never sees the disk error or the path in it (only the log does); the old file survives byte for byte; New chat and the dialog warn; pressing the button while the disk is still bad really tries again; after the disk recovers it saves everything and clears; the next message heals by itself; deleting a chat whose last save failed does not bring it back.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |

**Negative controls for the window suites: 16 sabotages**, applied one at a time with the same back-up, run, restore and
hash proof. **Fifteen were caught**, by the check that targets each (the sixteenth is described in the table below): the sender guard off (4 `about:blank` checks fail **and a save from
`about:blank` really wrote a file**); the first validation layer off (8); autosave off; the throttle off (33 writes in 3.6 s
instead of 6 or fewer); the leading-edge rule off (622 ms against the 500 allowed); a "streaming" status kept (3); an opened
chat saved again (2); delete without a question; no focus after New chat; the `pagehide` send off (some of the text on
screen missing from the file); **the quit hold off (the app quit with `save 6` of 60 on disk and a leftover `.tmp`)**; the
dialog layout off (Close at y = 9339); and, for the failure suite, deleting a failed chat bringing it back (the file is
there again), a stale badge, and the raw disk error reaching the page.

**What these controls and the checks themselves found, and what was fixed:**

| What                                                          | Detail                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| ------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **A message sent soon after a reply was not saved "at once"** | Found by reading my own throttle rule: it asked how long since the last save, so a message sent a moment after a reply finished waited out the rest of that second. I wrote the test first and it failed (622 ms); the fix saves whenever a reply begins; it passes, and the sabotage fails it again. D-017 would otherwise have claimed something untrue.                                                                                                                                                                                                                                     |
| **Deleting a chat whose last save had failed saved it again** | Found by review. Starting a new chat flushes what is waiting, so a chat deleted on purpose came back (and a stale "Not saved" badge stayed on screen for a chat that was gone). First test of it passed even with the bug, because the disk was still failing during the delete; I reordered it so the disk recovers first, after which the bug is caught. Fixed.                                                                                                                                                                                                                              |
| **With many chats, Close went off the bottom**                | The sabotage runs for other checks happened to create extra chats and failed "Close is reachable at 320 pixels", which showed the whole dialog scrolled. The list now scrolls inside the dialog and has its own suite.                                                                                                                                                                                                                                                                                                                                                                         |
| A few smaller things                                          | The hook's "was a reply running" bookkeeping sat after an early return (moved); a timer id outlived its timer (matters in development, where React runs effects twice); a comment said the input takes focus when a chat is opened from the dialog, which it does not (the dialog hands focus back to its own button); one line of `retrySave` was redundant, which a control showed, and was removed.                                                                                                                                                                                         |
| Mistakes in my checks (all in the harness, none in the app)   | A random UUID may contain no "0" to swap for a Unicode digit; a seed titled "notes" matched my "foreign files" pattern; a regex lost a backslash in a heredoc and became a group; I matched a conversation's first save instead of its last; my file reader raced with the app's own copy (Windows locks the file: it now retries); I `await`ed a call to a process that was quitting (it never answered); and Node refuses to let the main process exit while an inspector client is attached ("Waiting for the debugger to disconnect"), which deadlocked a run until its timeout killed it. |

### 7. The built app

| Command                                                                                                | What it does / why                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| ------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm run build`, then `grep` on `out/main/index.js` and `out/preload/index.js`                         | Exit 0 (the type-check included). The four `history:` channels are in the main program's file and in the preload's; the `before-quit` hold is there; the registry is still embedded; **the sandboxed preload still requires only `electron`**.                                                                                                                                                                                                                                                                                                      |
| The old suites on the **built** app (a `file://` page, where the sender guard compares file addresses) | `verify-prod` + Stage 1's chat suite 53 of 53, the 2.4 suite 71 of 71, the 3.4 suite 77 of 77.                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| The new suites on the built app                                                                        | `verify-4-2` 89, `verify-4-2b` 17, the close-the-window scenario 9 + 8, the quit with 60 saves queued 4, the seeded folder 32, the 150-chat dialog 24, the failing-disk suite 19: **all passing**. The seeded-folder and 150-chat runs needed a second go: in their first run the window was hidden (the 5-second mouse delay above: one hung until its timeout, one took 5089 ms to open a dialog), and they passed on the re-run with the launcher's new flags. This includes the `about:blank` calls and the hostile ids, from a `file://` page. |

### 8. Final checks

| Command                                                                                                                                      | What it does / why                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| -------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npx prettier --check .`, `npm run typecheck`, `npm run lint`, `npm run build`, `npm audit`                                                  | All clean; `npm audit` reports 0 vulnerabilities.                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| Every suite again on the final code                                                                                                          | Node: provider 93, registry and model-choice checks 162, **history 389**. Dev window: the whole Stage 1 to 3 set again (34 of 34 runs: the Stage 1 chain 110, 2.3 64 and 5, 2.4 71, 3.4 77 and 13, the 17 saved-choice launches, the 10 registry scenarios) and **all eight new suites** (89, 17, 9 + 8, 4, 32, 24, 19). Built app: as in step 7.                                                                                                                                                        |
| WCAG contrast (`contrast-4.mjs`)                                                                                                             | 21 pairs for the new colours: all pass AA. The lowest text pair is 4.81 to 1; disabled controls are 3.1 to 3.2 to 1, which WCAG exempts.                                                                                                                                                                                                                                                                                                                                                                 |
| Checked that the **registry file** was left as it was after the scenario runs, and that no Electron, mock or runner process was left running | `registry/models.json` identical to the saved good copy (by hash) and absent from `git status`; no leftover processes.                                                                                                                                                                                                                                                                                                                                                                                   |
| `node run-with-app.mjs dev plain-check.mjs` (plain `npm run dev`, **your real profile**, no test settings)                                   | A read-only startup check exactly as you would run it: no clicks, no typing, no saving, and no key, so the app cannot call the network. 8 of 8: title, Electron 44.5.1, the "No API key" badge and hint, the header buttons New chat, History and Settings, the exact `window.api` surface including `history`, the model menu with its four models, no console errors. Your profile held no `conversations`, `credentials*` or `preferences.json` before or after, so starting up writes nothing there. |
| Deleted the scratch profiles and temporary files                                                                                             | Twelve `frontier-app-test-scratch-*` folders inside `AppData` (never your real `frontier-app`) and a few files in the temporary folder. **Your real profile holds no `conversations` folder, `credentials.json` or `preferences.json`**: nothing from the tests touched it.                                                                                                                                                                                                                              |
| `npx prettier --write STEP-LOG.md docs README.md`                                                                                            | Formatted the docs. **Not committed** (see "Things to know", point 1).                                                                                                                                                                                                                                                                                                                                                                                                                                   |

## Stage 4 - Choices I made where things were unclear ("pick the simplest option")

- **What Stage 4 is.** You said "Stage 4 of the roadmap", and the roadmap has no Stage 4: only a tentative "Later" list.
  I chose conversation history because it is first on that list, and because D-010, D-013 and the architecture notes
  each call it the next piece of work. It is written into `docs/ROADMAP.md` so it is on record.
- **Files, not a database.** D-005 already chose plain files. A database such as SQLite would add a native package
  (one more thing to build, package and audit) for a feature that fits in a folder. One file per chat, no index file.
- **The page sends the whole conversation, main writes it.** The chat already lives in the page, and its protocol
  (D-008, D-013) is stable. Letting main assemble the chat from the reply events would have changed that protocol and
  could not have saved a failed reply that had no text.
- **Plain text, and you are told.** The key is encrypted because it is a secret; chats are your own data, and you may
  want to read, copy or delete them with ordinary tools. Encrypting them would also make them unreadable after a
  Windows profile change. The dialog says so, and names the folder.
- **The app opens on an empty chat**, not on the last one. It means nothing is written until you type, and it is how
  most chat apps behave. Reopening the last chat is one click.
- **History is a dialog, not a sidebar.** It reuses the Settings dialog's pattern, so the narrow-window layout from
  Stage 3 stayed as simple as it was. A sidebar is a bigger redesign.
- **Delete asks first and cannot be undone.** There is no trash for chats. A question with the safe answer selected
  seemed better than building an undo.
- **Titles are the first thing you wrote.** No renaming (editing the file by hand already works).
- **One save a second while a reply streams**, saved at once when you send, when the reply ends, and when the window
  closes; the quit waits up to 5 seconds. The numbers are my judgement: more often would write the whole chat many
  times for no benefit, less often would lose more text in a crash.
- **Limits** (`HISTORY_LIMITS`): 1000 chats, 2000 messages each, 1 500 000 characters, 10 MB a file. Above what chat
  sends, on purpose (D-016). I picked round numbers well beyond ordinary use.
- **Which model wrote a reply is not saved**, because the page does not know it and telling it would change the reply
  events. It cannot be added to old chats later, which is the one real cost of leaving it out (see point 6 below).
- **Left out on purpose, each a possible next step** (all in `docs/IDEAS.md`): naming the model per reply, renaming,
  searching, exporting, a sidebar, "Delete all", clearing old chats, encrypting history, a Retry button.
- **No new packages, and no commit.** Stages 0 to 2 ended with commits and Stage 3 with one commit at your request. This
  time you did not ask for one, so I made none (point 1 below).

## Stage 4 - Things to know (not problems, but worth your attention)

1. **Nothing is committed.** You are on `main` with the changes in the working tree (16 changed files and 5 new ones,
   listed by `git status`). I did not commit or create a branch because you did not ask. Say the word and I will make
   a branch (`stage-4-history`, as Stage 3 used) and commit, as one commit or one per slice.
2. **I still have never called the real Anthropic API.** Stage 4 does not change that: history works without it (a
   failed reply is saved too, as a message with its error). **The first real message is still the real test.**
3. **Your chats are plain text files**, in `C:\Users\91995\AppData\Roaming\frontier-app\conversations` once you have
   chatted (the History dialog shows the path). Nothing is encrypted by the app. Deleting a chat deletes its file;
   Windows or an SSD may keep traces. All my testing used scratch profiles in the same encrypted `AppData`, now
   deleted; your real profile folder holds no `conversations`, `credentials.json` or `preferences.json` (checked at the
   end of this stage).
4. **Line endings will bite again after your next merge.** Your Git (`core.autocrlf=true`, no `.gitattributes`) re-wrote
   the files Stage 3 changed with Windows line endings, and prettier and eslint then complained about 24 files. I
   fixed the working tree (no content change). A one-line `.gitattributes` (`* text=auto eol=lf`) would stop it for
   good; I did not add it because it is a project setting you did not ask for. Say the word.
5. **About 1 launch in 30 of my check scripts misbehaved, and I now know why: the app's window was hidden.** A hidden
   (or covered) window acknowledges mouse events only after about 5 seconds, while the page itself answers at once; I
   reproduced the exact signature by minimising the window (step 2). The app is not involved, and a person using it
   with the window in front is not affected. If you want to watch a test run, leave the window uncovered.
6. **Chats saved from now on do not record which model wrote each reply**, and that cannot be added to them later. If
   you expect to switch models often in one chat, say so and it moves up the list (IDEAS, D-017).
7. **Not checked:** macOS and Linux; packaging (`npm run build:win` was not run); a real screen reader (the dialog is
   a native `<dialog>` with labels and `aria-current`, not tried with one); **a real crash or power cut in the middle
   of a write** (the half-written states were built by hand and by injected disk faults, which have the same effect,
   but it is not the same thing); a disk that is really full; more than about 1000 chats or a chat of 10 MB; a chat
   near the 2000-message limit; window zoom levels.
8. **"Named in the log" is only useful in development.** Unreadable files and the real reason for a failed save go to
   the app's log, which today is the terminal running `npm run dev`. There is no log viewer in the app. The dialog
   and the badge say what happened in plain words; the details are in the terminal.
9. **Still open, now asked three times: keep the check scripts in the project** (for example under `tools/`)? There
   are roughly ninety of them now, about forty written for this stage, and this stage again relied on re-running the
   old ones first: three of its defects were found by them or by their own negative controls. They live only in this
   session's temporary folder. I will not add them without your word.
10. **Haiku 4.5 may be retired from 15 October 2026** ("not sooner than"), two weeks away; after that the app says the
    model was not found (404) and the fix is to delete its entry in `registry/models.json` (D-014).
11. **D-003's check, done at the start:** `npm audit` found 0 vulnerabilities and Electron 44.5.1 is the newest
    release. Nothing new was installed.
12. **Files outside the project.** Project files are only under `A:\frontier-app`. I wrote three notes to my own memory
    folder (the line-ending trap, the check-script traps, and this stage's state). The throwaway scripts, screenshots
    and logs are in this session's temporary folder. I installed nothing, downloaded nothing, and the only network
    use was `npm audit` and `npm view`.
13. **Everything in Stage 3's "Things to know" still applies** (your `AppData` is EFS-encrypted so files are written in
    place or copied, only Windows was tested, the SDK ignores the system proxy, and so on).

## Stage 5 - What was built

Running `npm run dev` opens the same chat, but it can now talk to two companies' models, and it remembers which one wrote what:

- **A second provider: OpenAI.** The model menu in the header lists seven models: the four Claude ones and three from OpenAI's
  GPT-6 family (GPT-6 Astra, GPT-6.1 Sol, GPT-6 Luna). Settings shows what each costs. Claude Opus 5.5 is still the default, so if you
  never add an OpenAI key nothing changes for you.
- **One key per provider.** Settings has a section for each provider: **Save key**, **Test key** (asks the provider for its list of
  models, which costs nothing, to learn whether it accepts the key) and **Remove key**. Each key is encrypted in its own file, tied to its
  provider, and a request to one provider never carries the other's key. If the model you picked belongs to a provider you have no key for,
  the header says "No API key" and names that provider.
- **One conversation, either provider.** Start a chat with Claude, switch to a GPT model in the middle, and switch back: the new model is
  sent the whole conversation as plain text, whoever wrote it. Above a reply the chat names the model that wrote it when it is the first
  reply or when the model changed (a chat that never changes model would repeat one name above every reply).
- **Your saved chats remember who answered.** Each reply in a saved chat records its provider and model. Chats saved by Stages 2 to 4 still
  open and are not touched when you open them; their replies are shown with no name (it cannot be worked out afterwards which Claude model
  wrote them), and a chat becomes the new format the next time you add to it.
- **Nothing is kept on OpenAI's side.** OpenAI keeps a copy of each response by default; this app asks it not to, because it sends the
  whole conversation each time and uses none of that.
- Under the hood: a provider layer (one **adapter** per provider, behind one interface), a registry that says what each model can do, the
  new package `openai` (OpenAI's own SDK), and a new folder, `tools/`, holding every check script that used to live in temporary folders.

It was built in six slices, each committed on its own: 5.1 the provider layer, with no change in behaviour; 5.2 what the registry says
about each model; 5.3 one key per provider and the Settings sections; 5.4 recording who answered; 5.5 OpenAI; 5.6 the documentation.
**Nothing has been tried against either real service.** See "Things to know", point 1.

## Stage 5 - Decisions

The full text of each is in `docs/DECISIONS.md`.

- **D-018** - one interface for every provider (list models, stream a reply, read the usage, explain an error), with Anthropic as its
  first adapter; the app's own rules (system prompt, reply ceiling, joining consecutive messages) are applied once, not per provider.
- **D-019** - the registry (schema 0.3) says what each model can do and which effort levels it accepts, as facts from the provider's own
  documentation; the app acts only on the ones it uses.
- **D-020** - one encrypted key file per provider, each tied to its provider; Settings with add, test and remove; Test key is a free call.
- **D-021** - every reply records which provider and model wrote it; the saved chat is version 2; a version 1 chat is read as version 2
  and never rewritten by reading.
- **D-022** - OpenAI is the second provider: the Responses API through OpenAI's own SDK, nothing kept on their side.

## Stage 5 - Step by step

### 1. Look around, and what in the request did not match the code

The request spoke of "refactoring all OpenAI calls", "columns" with a "migration", and "the OS keychain". The code had **no OpenAI
calls** (the only provider was Anthropic, so Anthropic became the first adapter and OpenAI the second); there is **no database** (chats are
files, so the "columns" are fields and the "migration" is a file version, D-021); and keys are kept with **Electron's safeStorage**, which
on Windows is the operating system's own encryption (DPAPI), kept per provider. You chose OpenAI as the second provider, said to keep
safeStorage, and said yes to keeping the check scripts in the repository.

### 2. Slice 5.1 - the provider layer, with no change in behaviour

Before touching anything I recorded exactly what the old code sent to Anthropic (request bodies, error sentences) and what the earlier
checks reported. After the refactor the same recording came out **byte for byte identical**, the earlier checks gave the same results, and
10 deliberate breakages of the new code were each caught. Only then was it committed.

### 3. Slices 5.2 and 5.3 - the registry, and one key per provider

The registry gained what each model can do and its own effort levels (a model that rejects the setting says so). The key store was split
into a part that runs under plain Node (tested in a normal folder and in your encrypted `AppData`, with disk faults injected: 174 checks,
12 deliberate breakages caught) and a thin Electron part. The old single key file is still read for Anthropic and removed the next time a
key is saved or removed.

### 4. A run that showed "0/0", and what was found

The first full run of the checks on slice 5.3 showed seven launches as "0/0". That did **not** mean no checks ran: the old driver read only
the "N/M checks passed" line, so any check script that died before printing it (an error, the window or the app going away) looked the
same. The driver now says `CRASHED ... died after N passing checks: <the first error line>`, and a lost window says so. The same launches
passed when repeated six times, so the app was not at fault. **Why the windows were lost was not known at the time**, and it happened twice
more later (a built-app launch 6 seconds after its window opened, and another 20 seconds in, each with nothing in the app's log). The best
evidence came at the end: the files of your real profile show that an instance of the app ran from 19:13:16 and shut down cleanly at
19:27:55, the same second one test window was lost, and a launch file for the app appeared in `.claude/` at 19:13: that instance looks like the
Claude desktop app's own preview of the project, which probably stops every Electron process of the project when it stops, the test's
included. The other two losses came at moments when you used the desktop app (a message, an interrupt). **This is a probable cause, not a
proven one.** The check driver now runs a launch that lost its window once more and says so in the summary (`RETRIED`), so it cannot hide a
real crash: a real crash happens again. Another harness fault, mine, was found by the same run: a note the runner printed started with
"!!", which the history checks count as a failure.

### 5. The check scripts move into the repository

About 110 files in `tools/`: the DevTools client, the app launcher, the mock provider server, the suites, the negative controls and the
regression driver, with a README. `node tools/regress.mjs <tag>` runs everything (about 45 minutes; nothing may touch `src/` while it
runs). Outputs go to `tools/.out/`, which is not committed. prettier and eslint skip the folder.

### 6. Slices 5.4 and 5.5

5.4 added a first event to every reply (`start`, naming the provider and model, sent before the key is looked up, so even a reply that
fails at once says which model was asked), version 2 of the saved file, and the names above replies. 5.5 added the OpenAI adapter, its three
models, a new kind of failure ("no credit left", because OpenAI answers 429 for that as well as for "too many requests"), a second
half to the mock server and a window suite that moves one conversation between the providers. Each new check was shown able to fail by
breaking the thing it protects: 11 + 10 breakages for 5.4, 13 + 8 for 5.5, all caught. Two that were **not** caught showed real gaps in
the checks (a rewrite during the startup scan was invisible to a check that took its "before" too late; a cap on a model listing was
never exercised), and were fixed; one (a pin on an admin key that the app's two calls never use) cannot be seen from outside and was dropped.

### 7. Final checks

The whole regression was run on the finished tree (`node tools/regress.mjs final`, 63 launches, about 25 minutes, on an idle machine) and
then every launch that was not clean was run again:

- **Plain Node, 7 suites, all clean:** provider 93, registry 228, history store 389, Anthropic adapter 91, credential store 174, the
  Stage 5.4 store suite 107, the OpenAI adapter 107.
- **The window suites** (Stage 1 chain 110, 2.3 64, 2.3b 5, 2.4 71, 3.4 77, 5.3 66, 5.4 47, 5.5 53, 3.4b 13): clean after the ports below, 9
  of 9 launches. **16 of 16** damaged-preferences launches, **10 of 10** registry scenarios, the Stage 4 history suites in dev and in the
  built app, and the built app's chat and Settings suites.
- **What was not clean the first time, and why.** Seven launches were my own checks assuming one provider or four models: the model count in
  `verify-3-4b`; five registry scenarios whose left-out entry is a Claude model while the three GPT models stay on offer; and a check in
  `verify-4-2` that looked at the folder in the few milliseconds between a save's file appearing and its temporary copy being deleted. All
  were ported and pass. **One launch was a lost window:** in the built app, 20 seconds into the Settings suite, the page's connection closed
  while the app itself was still running (three of its four Electron processes were left), with nothing in the app's log. The same suite
  passed 3 times in a row afterwards (66 checks each). Together with the "0/0" run and one earlier built-app launch, that is three lost
  windows in about 250 launches, probably caused from outside the app: see "Things to know", point 2.
- Before committing each slice: `npm run typecheck`, `npm run lint`, `npx prettier --check .`, and `npm run build`; the built app was run
  for 5.3, 5.4 and the final regression. `npm audit`: 0 vulnerabilities. Electron is still 44.5.1.

## Stage 5 - Choices I made where things were unclear ("pick the simplest option")

- **Responses API, not Chat Completions**, for OpenAI: OpenAI recommends it for new work. The SDK does the streaming and the errors.
- **The reasoning effort of every OpenAI model is "medium"**, which is the documented default for two of them; the documentation does not
  state Astra's, so it got the same.
- **The system prompt does not name a product for OpenAI** ("You are an AI assistant"): the app does not know what OpenAI's models call
  themselves, and a model told it is someone else answers oddly.
- **A chat's old replies show no model name**, rather than a guess. Reading an old file never rewrites it (D-016).
- **The usage of a reply is written to the app's log, not stored with the chat**: nothing needs it yet, and a cost display would need the
  prices of cached tokens too.
- **A model with a name the registry no longer knows is still readable** in a saved chat, shown by its id.
- **The window checks end the chat's random model bursts by choosing Opus**, because one check had depended on the old random sequence
  happening to end there.

## Stage 5 - Things to know (not problems, but worth your attention)

1. **No real call has been made, to either provider.** Everything was checked against mocks, and the OpenAI mock is _my reading of
   OpenAI's documentation and of the SDK's types_, not the real API. A real key cannot be typed for you. Your first real call is the true
   test: in Settings, **Save key**, **Test key**, then send a message with each provider. Things the mock could get wrong: the exact spelling
   of the model ids, the events of the stream, what a real "out of credit" error carries, and whether a restricted key may list models (Test
   key would then say 403 although the key works). `node tools/real-call.mjs` asks for a key (masked) and makes one tiny call per provider.
2. **Test windows were lost in a few launches, probably by something outside the app** (point 4 of "Step by step"). While the checks run,
   app windows appear on your screen, and starting or stopping the app from the Claude desktop app's preview, interrupting a session, or
   clicking or closing a test window can kill a launch. Please leave those alone while `tools/regress.mjs` runs. The checks now say
   exactly what happened instead of "0/0", and retry such a launch once, saying so.
3. **Claude Haiku 4.5 may be retired from 15 October 2026** ("not sooner than"). After that its replies fail with "not found (404)"; the
   fix is to delete its entry in `registry/models.json` (D-014).
4. **The OpenAI facts in the registry** (ids, prices, 1,050,000-token context, 128,000 output, effort levels) were read from OpenAI's pages on
   1 October 2026. Check them against your OpenAI account's own list the first time you use it.
5. **Not done:** Windows Credential Manager (you chose to keep safeStorage); Gemini (third, later); image input and tools (the registry
   already records which models take them); a packaged build (`npm run build:win` was not run); macOS and Linux.
6. **`npm install` printed a warning about install scripts it did not run** (for `esbuild`). The build, the checks and the app work; it only
   means npm now asks before running such scripts.
7. **Files outside the project.** Project files are only under `A:\frontier-app`. I wrote notes to my own memory folder. The scratch
   profiles the checks make (`frontier-app-test-scratch-*` in your `AppData\Roaming`) were deleted at the end; your real profile was not
   touched. Nothing was pushed (there is no remote). The only network use was reading OpenAI's pages and `npm install`, `npm view` and
   `npm audit`.
8. **Everything in the earlier stages' "Things to know" still applies** (your `AppData` is EFS-encrypted, so files are written in place or
   copied; only Windows was tested; the SDKs ignore the system proxy; line endings can come back as CRLF after a branch switch).

## Stage 6 - What was built

Running `npm run dev` shows one more menu in the header, **Task**, next to the model menu:

- **Say what you are doing.** Pick Chat, Coding, Writing or Quick answer (or "Any task", the start). The model menu then adds
  "(suggested)" to the models the providers' own documentation names for that task, among the models you can use now (it has to be on the
  list, and you need a key for its provider). Hover the Task menu to read what each page said, its address and the day it was read.
- **It never chooses for you.** Picking a task does not change the model, and nothing is saved. You pick from the model menu as before.
- **No scores, on purpose.** The plan said "a score per model and task". No page that was read gives a number that compares these models, so
  the file holds quoted statements instead (D-023). Where nothing says it, the page says "No suggestion for chat". That is the case for
  Chat, for Claude Fable 5.1, for GPT-6 Luna, and for Quick answer with OpenAI.
- Seven rows in all, each with its page and date. If the file is broken the app logs why and offers no suggestions; nothing else is affected.
- No new package. One new decision, **D-023**; the files are `registry/rankings.json`, `src/shared/rankings.ts`, `src/main/rankings.ts` and
  `src/renderer/src/settings/TaskPicker.tsx`.

## Stage 6 - Step by step

1. **Merged Stage 5** into `main` (a fast-forward), checked `prettier --check` and `npm run build` on `main`; fixed the preview port in
   `.claude/launch.json` (3000 to 5173, Vite's default).
2. **Haiku 4.5.** Anthropic's deprecation page (read 1 October 2026) lists it as active, "not sooner than October 15, 2026", with no notice
   sent. Nothing in the code depends on it: a saved choice for a model that left the registry falls back to the default (D-015), and a
   ranking row for a missing model is skipped (D-023).
3. **Looked for scores, found none** (see D-023), and wrote the rows only from pages that were read: Anthropic's "Choosing a model" and
   models overview, and OpenAI's model pages for GPT-6 Astra, GPT-6.1 Sol and GPT-6 Luna (the OpenAI announcement answered 403).
4. **Built it** in the order: the check and the function (`rankings.ts`), the embedded file, `getStatus` gaining `tasks` and `suggestions`,
   the two menus. The registry's check helpers were exported so they are not copied. Before the window work, the plain-Node suite
   `verify-6-1.mjs` (108 checks) was written and 10 deliberate breakages were each caught.
5. **Checked in the real window** (`verify-6-2.mjs` 27 checks, `verify-6-3.mjs` with the file damaged two ways), and 5 deliberate breakages of
   the app were each caught. The three older suites that listed the exact fields of `getStatus` were updated.

## Stage 6 - Choices I made where things were unclear ("pick the simplest option")

- **A shortlist, not one suggestion.** Without scores there is nothing to order by that is not a guess. The cheapest of those named is the
  obvious rule, but that decides what you are billed, so it was left to you.
- **The task is not saved** and a reload forgets it: it is a hint for the next choice, not a setting.
- **Two rows rest on a reading of the wording**: "content creation" (Sonnet 5.5) and "document creation" (GPT-6 Astra) as writing.
- **Suggestions need a saved key.** A model you cannot call yet is not offered; add the key and it appears.

## Stage 6 - Things to know (not problems, but worth your attention)

1. **The rows are the providers' own words, nothing more.** They say "this model is named for this task", not "this model is better than
   that one". Treat them as a starting list. When you have a source that compares models on one scale, D-023 says what to change.
2. **Your OpenAI test.** You told me a real call to GPT-6.1 Sol answered. I did not see that: it is your report, and Stage 5's note that no real
   call was made described what I had been able to do. Anthropic is still untried with a real key, as far as I know.
3. **Haiku 4.5 may be retired from 15 October 2026** at the earliest. If it is, delete its entry in `registry/models.json` and, if you like, its
   row in `registry/rankings.json`; nothing breaks if you leave the row.
4. **The GitHub push.** When it was checked (1 October 2026) the repository had no `origin` remote, so nothing had been pushed from this folder.
5. **Everything in the earlier stages' "Things to know" still applies.**

## Stage 7 - What was built (so far: slices 7.1 and 7.2)

Stage 7 is built in five slices, one commit each: 7.1 Effort, 7.2 Markdown, 7.3 Copy / Regenerate / Edit and resend, 7.4 Instructions per
chat, 7.5 the docs, the threat note and the full regression. This part describes what exists now.

**7.1 Effort (D-024).** Running `npm run dev` shows one more menu in the header, **Effort**, right after the model menu:

- It lists only the levels the registry gives the chosen model, from "faster" to "smarter", and marks the registry's own pick "(default)".
  Claude Haiku 4.5 takes no effort setting, so for it the menu is not shown at all.
- Your choice is kept **per model** in `preferences.json` (next to the model choice, which it never overwrites). The next reply asks the provider
  for exactly that level; until you choose, replies are byte-for-byte what they were in Stage 6.
- A higher level is slower and billed as more output (the thinking). The menu's tooltip says so, and says that the thinking counts against the
  16,000-token limit of a reply, so at the highest levels a reply can be cut off.
- The menu is locked while a reply is arriving: the level is fixed when a reply starts.
- The page cannot choose anything the registry does not list for that model. Main checks the model and the level when they arrive, again when
  it saves, and every time a reply starts.
- No new package. One new decision, **D-024** (with its threat note and what was not checked); new files `src/shared/effort.ts` and
  `src/renderer/src/settings/EffortPicker.tsx`.

**7.2 Markdown (D-025).** A reply is now drawn as Markdown instead of plain text:

- Headings, **bold**, _italic_, ~~strike-through~~, `inline code`, bulleted and numbered lists (nested), tables, block quotes, rules, and code
  blocks with the language above them and a **Copy** button that puts exactly the code on the clipboard when you click it. A reply written the
  old way (code indented by four spaces, hyphen lists) is drawn as code and lists too, so old chats look right.
- **It cannot make HTML.** The reader is the app's own (no package): it turns text into a small tree and the page makes only a fixed list of
  elements from it. Raw HTML in a reply, and images, are shown as the text they were written as; nothing is loaded and nothing runs.
- **A link asks first.** Only `[text](https://address)` is clickable. Clicking shows a window with the whole address and where it goes, and only
  **Open** sends it to your browser (**Cancel** has the focus; Escape cancels). Anything else (http, javascript:, an address with a password)
  stays plain text. The main process now lets only https addresses through to the browser.
- What you type is still shown exactly as typed. Replies and saved chats keep the Markdown as the model wrote it.
- The instruction the model gets changed: it is told the window renders Markdown (it used to be told to use plain text).
- No new package. One new decision, **D-025** (with its threat note and what was not checked); the files are in `src/renderer/src/markdown/`
  (`parse.ts`, `Markdown.tsx`, `CodeBlock.tsx`, `LinkConfirm.tsx`, `linkContext.ts`), plus small changes to the message bubble, the chat view,
  the style sheet, `src/main/security.ts` and the model's instruction (`src/main/providers/request.ts`).

## Stage 7 - Step by step

1. **Plan approved ("Go", 1 October 2026).** Own Markdown renderer with no package, Copy writes to the clipboard on a click, links open the
   browser only after a click and a confirmation, https only, Effort as a menu, Regenerate replaces the reply, the instructions of a chat go
   after the app's own rules.
2. **Slice 7.1 built and checked** on the branch `stage-7-chat-polish` (about 36 minutes): the plain-Node suite `verify-7-1.mjs`, the window
   suites `verify-7-1w/b/c.mjs` through `run71.mjs` (a fresh profile, a restart, ten seeded `preferences.json` files), 17 + 21 deliberate
   breakages (negative controls, `tools/specs71*`), and a byte comparison of the requests with a copy of `main`.
3. **The older suites were re-run on the new tree** (`node tools/regress.mjs t71 node window seeds scenarios`, 2 October 2026). 46 runs, 44 clean the first time. Two checks had gone stale because of this very slice and were updated, not the code: the adapter suite listed the fields of a request (now with `effort`), and `verify-3-4` expected Tab from the model menu to reach Settings (it now reaches the Effort menu first). Both pass on their own re-run (94/94 and 78/78). The Stage 4 history suites and the built-app (`preview`) runs are left for the end of Stage 7 (7.5).

4. **Slice 7.2 built and checked** (2 October 2026). The reader (`parse.ts`) was written first and checked on its own under Node before any window
   existed (`verify-7-2.mjs`, now 195 checks: the Markdown, 29 hostile texts, 6000 random texts, the elements React makes read back against a list
   of tags and attributes, the main process's link rule). That found three real faults before the window did: a tab after a list marker, a
   quadratic scan on `[[[[...` (the link scan was not charged to the work budget), and (while writing the Copy check) tabs inside code being turned
   into spaces. Then the window suite (`verify-7-2w.mjs` through `run72.mjs`, 53 checks) found two more: the bubble stretching past a narrow window
   when a table is wide, and the Copy click in my own test landing on the wrong block (a test fault). The mock got a `say` directive (the reply is
   the message's own text) and `say-chars` (two characters at a time).
5. **Negative controls:** 25 breakages under Node (22 caught; the 3 not caught are overlapping layers, see D-025) and 8 in the real window (all
   caught), `tools/specs72*`, each file proved restored by hash.
6. **The older suites were re-run** (`node tools/regress.mjs t72 node window scenarios`): 28 of 32 clean the first time. Four checks had gone stale
   because of this slice and were updated (they now read what a person sees in a reply, and the Stage 2 golden request compares everything but
   the system prompt); all pass again. The requests (42) were compared with the Stage 7.1 commit's: only the system prompt differs.
