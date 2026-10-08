# tools/ - the project's checks

The app has no test framework (D-007). It is checked by driving the real Electron window from outside (Chrome
DevTools protocol), against a fake provider API, plus plain-Node suites for the pure modules and negative controls
that prove each check can fail. Everything here is test tooling: it is not part of the app or its build, and prettier
and eslint skip this folder.

Windows only (it uses `cmd.exe`, `taskkill` and the real `%APPDATA%`, where your profile is EFS-encrypted).
Node 24 (built-in `fetch` and `WebSocket`, and it runs `.ts` files directly).

## Running

```
node tools/regress.mjs <tag> [node|window|seeds|scenarios|stage4|preview]...
```

No parts = all of them, about 75 minutes (73 on 5 October 2026 later, `t8b`, 93 runs, with the 8b suites in both the dev and the built app; 69 earlier that day, `t85`, 89 runs; 54 on 2 October, `t75`, 78 runs, before Stage 8's three suites in both the dev and the built app). Do not edit `src/` or `registry/` while it runs (dev launches build from the
tree), and keep the machine idle: `verify-4-3c` (quit with 60 queued saves) fails under extra CPU or disk load.

| Part        | What it runs                                                                        | About   |
| ----------- | ----------------------------------------------------------------------------------- | ------- |
| `node`      | Plain-Node suites: provider, registry, rankings, store, adapters, credential store, usage ledger, limits, the question before a large request, the backup file and restoring (8b; the last takes about 3 min with its EFS pass), encrypting the saved chats and the lost key (8b.3, 8b.4), the attachment store (9.1, with Electron's real image tools in an Electron that opens no window) | 5 min |
| `window`    | The window suites of Stages 1-3, 5, 6, 7.1 to 7.4, 7.6, 8.1 to 8.3 and 8b (backup, and since 8b.3 four launches on this PC's real secure storage, one of them with its key lost), each on its own scratch profile | 22 min |
| `seeds`     | One launch per damaged `preferences.json` (`make-seeds.mjs` makes them; 16 of them) | 7 min   |
| `scenarios` | The registry file deliberately broken in ten ways, restored after each (`run-scenario.mjs`) | 5 min   |
| `stage4`    | The history suites (`final-new.mjs`): crashes, damaged folders, injected disk faults | 5 min   |
| `preview`   | The BUILT app (`npx electron-vite build` first), the same suites again, Stage 4 included | 18 min  |

Everything a run produces goes to `tools/.out/` (not committed): `<label>.out.txt` per launch, `app-*.log`,
`regress-<tag>.txt` (the summary), `shots/`, the generated seed files.

Single pieces:

```
node tools/run53.mjs                      one launch of the key / Settings suite
node tools/run71.mjs [dev|preview]        the Effort menu (7.1): a fresh profile, a restart, and ten seeded preferences files
node tools/run74.mjs [dev|preview]        Instructions per chat (7.4): seeds conversation files of versions 1, 2, 3 and a damaged 3, then the window suite
node tools/run-one.mjs w76 dev setup-key.mjs,verify-7-6w.mjs USER_DATA_DIR=s76 MOCK_PORT=8790      the header-one-row and chat-bar suite (7.6)
node tools/run81.mjs [dev|preview]        the usage ledger (8.1): a fresh profile (verify-8-1w.mjs), a crash imitated in the ledger file, then a restart (verify-8-1b.mjs)
node tools/verify-8-1.mjs                 the usage ledger under plain Node (cost, the guess, the reader, the sums, the file, the registry's four prices)
node tools/run82.mjs [dev|preview]        the spending limits (8.2): a fresh profile with NO limits (verify-8-2w.mjs), a restart (verify-8-2b.mjs), then three launches with a limits.json that is half there, not JSON, or a folder (verify-8-2c.mjs)
node tools/verify-8-2.mjs                 the spending limits under plain Node (the check, what is typed, the file and its damage, the ledger's gate, the store, two source checks)
node tools/run83.mjs [dev|preview]        the question before a very large request (8.3): a fresh profile (verify-8-3w.mjs), a restart (verify-8-3b.mjs), then three launches with an ask-first.json that is not JSON, spells "Never" in capitals, or is a folder (verify-8-3c.mjs)
node tools/verify-8-3.mjs                 the question under plain Node (the estimate for all seven models, when it asks, what is typed, the file and its damage, the store, the waiting room's races, how the amounts are written, source checks)
node tools/run8b.mjs [dev|preview]        backing up and restoring chats (8b): seeds five chats and four backup files (whole, cut at 60%, one changed chat, a letter) OUTSIDE the profile, then verify-8b-w.mjs with the system dialogs replaced from the main inspector
node tools/run8b3.mjs [dev|preview] [launches=4]  encrypting the saved chats and the lost key (8b.3, 8b.4) on this PC's REAL secure storage: launch 1 (verify-8b3-w.mjs) turns it on, off and on, with the system's dialogs replaced from the main inspector; launch 2 a restart (verify-8b3-b.mjs); launch 3 (verify-8b3-c.mjs) after the profile's `Local State` was DELETED, which is a real reset profile: the app gets a different key; launch 4 (verify-8b3-d.mjs) with the original `Local State` put back
node tools/verify-8b-3.mjs                the encryption under plain Node (the envelope, the choice and every kind of damage to it, the store, crashes and disk faults in a conversion, the whole flow with a secure storage that can lose its key, source checks); QUICK=1 for the normal folder only (the controls)
node tools/verify-8b-1.mjs                the backup file under plain Node (its shape, a cut at every length, a changed byte at every place, caps, a 160 MB line, nine disk faults)
QUICK=1 node tools/verify-8b-2.mjs        restoring under plain Node (the store's add and inspect, the flow with fake dialogs, the token, a changed file, 1000 chats out and back); without QUICK it also runs in the EFS folder with the real 1000 (about 3 min)
node tools/verify-8b-wording.mjs          the sentences that carry a count agree with it (after 8b): the question before going back to plain files, two notices, and the restore preview panel rendered to text (esbuild and React's server renderer), at 0, 1 and 2 chats; the plural ones are exactly what they were
node tools/verify-9-1.mjs                 the attachment store (9.1) under plain Node: what a file is from its bytes, image headers, metadata taken out, PDFs and text, prepare() with stand-in image tools, readLocalFile, the folder (hash names, damage, disk faults, caps, hold/deleteUnused/sweep), sealed copies; QUICK=1 for the normal folder only (the controls)
node tools/run91.mjs                      the same store with Electron's REAL image tools (nativeImage): an Electron main script with no window (verify-9-1-images.cjs), the modules bundled by esbuild; the eight EXIF orientations, shrinking, PNG to JPEG, the same pixels after the metadata goes
node tools/verify-9-2.mjs                 getting files in (9.2) under plain Node: the attach service with a played dialog and a real store, the bytes check, discard, the words on a chip, source checks
node tools/run92.mjs [dev|preview]        getting files in, in the real window (verify-9-2w.mjs): makes the files OUTSIDE the profile, replaces the open dialog from main; the chips, caps, a real paste through the system clipboard, a real file drop, the bridge, the layout
node tools/verify-9-3.mjs                 sending and saving files (9.3) under plain Node: the request and saved-message checks, the chat file version 4 (version 3 byte for byte without files), a backup with files, attachmentRequest.ts (missing, damaged, unopened copies, blind models, the caps), both adapters through the mock and the golden of 70 requests, the registry at 0.5, encryption with files, the page's side as plain functions
node tools/run93.mjs [dev|preview]        sending and saving files in the real window: verify-9-3w.mjs (both providers, the saved file, History, a missing copy, deleting, encryption, the bridge, the layout), a RESTART (verify-9-3b.mjs: the start-up sweep) and, from source only, verify-9-3c.mjs with registry/models.json changed so that GPT-6 Luna reads neither images nor PDFs (always put back, checked by hash). RUN93_ONLY=w|wb|c runs some launches only (the controls). Run `npx electron-vite build` first for preview
node tools/verify-9-4.mjs                 what attached files are guessed to cost (9.4) under plain Node: the image, PDF and text rules, what a request's files count, the estimate with and without files, the limits' sentence, source checks
node tools/run94.mjs [dev|preview]        the same in the real window (verify-9-4w.mjs): the question before a large request for a 30-page PDF, a daily limit's refusal, the ledger's guess. Run `npx electron-vite build` first for preview
node tools/verify-9-5.mjs                 backups that hold the attached files (9.5) under plain Node: version 1 and 2 files, file lines read and checked, the store's adopt, the service (backup, look, restore, files put back), the words
node tools/run95.mjs [dev|preview]        the same in the real window (verify-9-5w.mjs): back up, delete, restore through History, the files put back and sent again; lost copies put back sealed. Run `npx electron-vite build` first for preview
node tools/capture-golden-9.mjs <out.json>   records what both adapters send for chats without files (hashes); --compare a.json b.json. tools/golden-9.json is the copy from before 9.3
node tools/verify-10-1.mjs                the system's question before the app may spend more (10.1) under plain Node: what counts as more, the words, the gate (one at a time, only a real yes, three seconds of quiet after a no), the flow with the 8.2 and 8.3 stores and a played answer, source checks
node tools/run101.mjs [dev|preview]       the same in the real window (verify-10-1w.mjs): a fresh profile with NO limits, the system's message box stood in for from the main inspector (lib10.mjs); the first-run question, Settings, the bridge, 420 and 280 px. Run `npx electron-vite build` first for preview
node tools/run-one.mjs real101 dev verify-10-1-real.mjs USER_DATA_DIR=s101real WIPE_USER_DATA=1   the REAL Windows message box once (real-dialogs.ps1: find, tdclick); takes no screenshot
node tools/verify-10-2.mjs                the instructions for every chat (10.2) under plain Node: the look for secrets, the kept file (D-016 write, damage, sealing, conversion), the service (the system's question, caps, a damaged file), the order of the prompt and the golden of 70 requests, the encryption flow, source checks
node tools/run102.mjs [dev|preview]       the same in the real window (verify-10-2w.mjs): the dialog's parts, the system's box stood in for from the main inspector, what each request carries, secrets, a damaged file, encryption on and off, 420 and 280 px. Run `npx electron-vite build` first for preview
node tools/verify-10-3.mjs                the memory store (10.3) under plain Node: a note's rules, memory.json read strictly, the service (the system's question, caps, secrets, deleting, off and on, one change at a time), what goes with a request, a damaged file and its two ways out, sealing, the export
node tools/verify-10-4.mjs                the notes in a request (10.4) under plain Node: the prompt in every combination, both adapters through the mock, the golden of 70 requests, the sentence for a key in a note, source checks (chat.ts, the handlers, the bridge, the export's dialog)
node tools/run104.mjs [dev|preview]       memory in the real window (verify-10-4w.mjs): the Memory page, the system's box and the save dialog stood in for from the main inspector, "Remember...", what each request carries, secrets, a damaged file, encryption, 420 and 280 px. Run `npx electron-vite build` first for preview
node tools/verify-10-5.mjs                projects (10.5) under plain Node: a project's rules, projects.json read strictly, the service (questions, files, deleting, a damaged file, sealing), the chat file version 5, a project's notes, source checks
node tools/run105.mjs [dev|preview]       projects in the real window (verify-10-5w.mjs): the Projects page, the system's box and open dialog stood in for from main, chats in a project, History by project, deleting, 420 and 280 px
node tools/verify-10-6.mjs                a project's parts in requests (10.6) under plain Node: the prompt order, the golden, the request check, the files notes, the page's Send block, source checks
node tools/run106.mjs [dev|preview]       the same in the real window (verify-10-6w.mjs): what a project chat's requests carry, the question, a key, a damaged file, a deleted project
node tools/verify-10-7.mjs                backups with projects and notes (10.7) under plain Node: version 3, the reader, the restore plan, the service with the real stores
node tools/run107.mjs [dev|preview]       the same in the real window (verify-10-7w.mjs): the backup, the look, the question, a no and a yes, a damaged projects.json
node tools/verify-11-1.mjs                the tool registry and the permission core (11.1) under plain Node: the definitions (a closed, checked, frozen shape), a call's arguments, the words of the question (a value cannot add a line), the reply's budget (steps; working time that stops while the person decides), and the core: deny by default, the record before the question and before the run, every answer, Stop everything, the caps, the result passed on as untrusted data, and source checks (exact imports; nothing else in the app reaches it yet)
node tools/verify-11-1-folder.mjs         NO TOOL CAN READ, WRITE OR LIST THE DATA FOLDER (11.1, the owner's addition) under plain Node, Windows only: eleven stand-in tools that do real file work, a scratch copy of the data folder with a canary in every file, a person who says yes to everything; every tool aimed at everything in the folder in about forty spellings, through junctions, a hard link, a `subst` drive and 8.3 names, and at the folders above it; all refused, nothing read, listed or changed. The same battery with the block taken out must get through (it is the suite's own negative control). About 10 s; makes and removes a `subst` drive and a temporary folder
node tools/run111.mjs [dev|preview]       the same in the real window (verify-11-1w.mjs): nothing new is reachable from the page (the bridge, main's message handlers), a request carries no tools, a model that asks for a tool (`[[mock:tool-use]]`) gets nothing. Run `npx electron-vite build` first for preview
node tools/make-specs111.mjs              writes the 11.1 negative controls (specs111: the registry, the question, the budget and the core; specs111f: the data-folder block; specs111w: the window); then `node tools/nc-all.mjs specs111f f111-block-removed ...`
node tools/verify-11-2.mjs                the audit log (11.2) under plain Node: what an event may hold (a line is refused for a field more or less, a hidden character, an address that is not plain https...), the file (appended and read back from the disk, a cut-off line never joined, only the newest part read, sealed like the chats), the rewrite when encryption is turned on or off (and the mending of one that was cut off), the service (calls put together, the view, the export, the deletion that asks in the system's box), the core writing into the real log, source checks
node tools/run112.mjs [dev|preview]       the same in the real window (verify-11-2w.mjs): the Tools button and page, a seeded log read as it stands (hostile words shown as text), Export and Delete all (the system's save dialog and message box stood in for from main), the bridge, encryption on and off, 420 and 280 px
node tools/make-specs112.mjs              writes the 11.2 negative controls (specs112: events, file, rewrite, service, core; specs112w: the window); then `node tools/nc-all.mjs specs112 ...`
node tools/verify-11-3.mjs                the provider loop (11.3) under plain Node: both adapters through their real SDKs against the played providers (the tool, the replay of the model's turn, the search request, pauses, failures), the search helpers, the reply's tools (a yes runs one search; a no, a busy box, a refusal, a cap in the middle of a turn, Stop in the box; the labelling of the result), `tools.json` (every kind of damage means all tools off), the loop of chat.ts with its ledger records and the usage it reports, source checks
node tools/run113.mjs [dev|preview]       the same in the real window (verify-11-3w.mjs): a search asked about in the system's box (stood in for from main) and run, a no, Stop everything while the box is open, the step and time caps, both providers, a tool switched off meanwhile, the saved chat and the audit log. Run `npx electron-vite build` first for preview
node tools/make-specs113.mjs              writes the 11.3 negative controls (specs113: adapters, search, runtime, settings, loop; specs113w: the window); then `node tools/nc-all.mjs specs113 ...`
node tools/run-one.mjs real92 dev verify-9-2-real.mjs USER_DATA_DIR=s92real FILES_DIR=<folder>   the REAL Windows open dialog once (real-dialogs.ps1: find, filetype, setname, ok); takes no screenshot (the dialog may open in a personal folder)
node_modules\electron\dist\electron.exe tools\make-fixtures-9.cjs --user-data-dir=<scratch>   remakes tools/fixtures9/ (a JPEG, PNGs, WebPs from Chromium's canvas, PDFs from Chromium's print); the suites read the committed copies
powershell -File tools\real-dialogs.ps1 -Op find     reads (setname, ok, tdclick, shot) the REAL Windows dialog of a test app started with a debug port, instead of replacing it from the main inspector (see the script's header)
node tools/run-one.mjs w81 dev setup-key.mjs,verify-8-1w.mjs USER_DATA_DIR=s81 MOCK_PORT=8790      just the first launch of the usage suite
node tools/run-scenario.mjs <scenario>    one registry scenario
node tools/nc-all.mjs specs guard-off     one negative control (spec folders: specs, specs4, specs4w)
node tools/with-load.mjs 8 tools/regress.mjs <tag> window      the same, with 8 busy CPU loops competing
node tools/real-call.mjs                  ONE tiny real call per provider (asks for the key; costs a fraction of a cent)
node tools/verify-12-1.mjs                the code workspace's boundary (12.1) under plain Node, Windows only: the workspace guard (containment beside the data-folder block; no link on the way, whole names, the three classes of name read off the real names), the choice of the folder, `workspace.json` and the test for UTF-8 text; 2,616 calls in about forty spellings at everything outside, in the data folder and behind links (all refused, no canary), the ordinary files in every spelling that works, and the same battery with the boundary taken out (must get through). About 12 s; makes and removes a `subst` drive and a temporary folder
node tools/make-specs121.mjs              writes the 12.1 negative controls (specs121: `node tools/nc-all.mjs specs121 <names...>`)
node tools/verify-12-2.mjs                the core and the workspace (12.2) under plain Node, Windows only: the registry's workspace-path and long-text kinds, the file calls' budget, the reply's one yes for file access (covered calls, a kept no, hidden files asked about one at a time), every refusal and its fixed sentence, the caps, the record and its strict reader, the audit view and the chat's notes, and source checks; stand-in tools that never write
node tools/make-specs122.mjs              writes the 12.2 negative controls (specs122: `node tools/nc-all.mjs specs122 <names...>`)
```

## Reading a result

`OK` / `BAD` per launch, then `passed/total`. A suite that DIES before it prints its summary line is reported as
`CRASHED <script> died after N passing checks: <first error line> | <state of the app>`. (Before this was added such a
suite showed as `0/0`, which looks like "no checks ran" and hid the reason: that is what happened to the 5.3 run on
2026-10-01.) A `CRASHED ... the page connection closed` means the window or the app went away while the suite was
running; `!! the app is GONE` means no `electron.exe` was left.

## Layout

| File                                   | What it is                                                                      |
| -------------------------------------- | ------------------------------------------------------------------------------- |
| `paths.mjs`                            | Repo, tools and output paths, derived from where the repo is                    |
| `cdp.mjs`, `lib3.mjs`, `lib4.mjs`      | The DevTools client and the helpers the window suites share                     |
| `run-with-app.mjs`, `drive.mjs`        | Start the app (dev or built) with a scratch profile, run suites, stop exactly that process tree |
| `mock-providers.mjs`                   | The fake provider API (Anthropic messages and model list; controls for hang, failure, paging) |
| `verify-*.mjs`, `setup-key.mjs`        | The suites. `verify-N-M` is slice N.M of the roadmap                            |
| `provider-*-test-5.mjs`, `shim-new.mjs`| Plain-Node suites for the provider layer                                        |
| `run4*.mjs`, `run53.mjs`, `run62.mjs`, `final-new.mjs` | Launchers that need two launches, a seeded folder, a damaged file or a crash in the middle |
| `nc*.mjs`, `specs*/`, `make-specs54.mjs` | Negative controls: sabotage one thing, run the suite, prove it fails, restore the file and prove it by hash |
| `check-specs.mjs`                      | Dry check that every negative-control spec still finds its sabotage text exactly once |
| `watch-windows.ps1`                    | Read-only watcher of the operating system's windows (what is in front of the test window, input, minimized), for finding out why a window went "hidden" |
| `real-dialogs.ps1`                     | Reads and answers the REAL save, open and message-box dialogs of a test app (UI Automation, and window messages to that dialog only) |
| `capture-golden-5.mjs`, `golden-*.json`| The recorded request bodies the Anthropic path must keep sending byte for byte  |
| `mock-files.mjs`                       | (9.3) Files in a request as the mock sees them: each provider's blocks or parts checked as its documentation says it refuses, and the `[[mock:files]]` reply (my reading of the docs, not the real APIs) |
| `mock-openai.mjs`                      | OpenAI's side of the mock: Responses API streaming and its model list (my reading of the docs and the SDK's types, not the real API) |
| `registry-good.json`                   | A fixed registry for the adapter suites (it is NOT the live one; update it when the schema changes) |
| `lib10.mjs`                            | (10.1) Stands in for the person at the system's message box from the main inspector: every question recorded with its options, answered from a queue (`installQuestions`), or yes to all for the older suites (`sayYesFromMain`) |

## Lost windows

Now and then (3 launches in about 250, on 2026-10-01) a test window was lost: the suite's connection to the page closed, sometimes with
the whole app gone, with nothing in the app's log. They were not reproducible, and the evidence points at something outside the app: the
real profile (`%APPDATA%\frontier-app`) shows an instance of the app that ran from 19:13:16 and shut down cleanly at 19:27:55, the
second a built-app launch lost its page, and `.claude/launch.json` (the Claude desktop app's own preview of the project) appeared at 19:13;
the other two losses came when the desktop app was used. It probably stops every Electron process of the project, the tests' included.
**Probable, not proven.** So: while `tools/regress.mjs` runs, do not start, stop or preview the app from the Claude desktop app, do not
interrupt the session, and do not click or close the test windows. `drive.mjs` runs a launch that lost its window once more and marks the
summary `RETRIED` (a real crash happens again and stays BAD); `NO_RETRY=1` turns the retry off. `nc-crash.mjs` has modes that lose the
window on purpose, to show both cases.

## Hidden windows (a different stall, same family)

On 2 October 2026 (`t75`, 2 launches of 78) a suite died with `!! slow mouse acknowledgement: 5046 ms ... window state: hidden, focus true`:
the test window's `document.visibilityState` was `hidden` although the launch passes `--disable-features=CalculateNativeWinOcclusion`, the window
was not minimized, and every click took 5 s and was sometimes dropped, so a Settings dialog "did not open" and the suite timed out (the restart
suite of the first one then failed because the first had not saved its key). The launches that followed were clean, and all three passed when
re-run on their own with `node tools/run-one.mjs r-23 dev verify-2-3.mjs USER_DATA_DIR=s5reg`, then the restart (`... r-23b dev verify-2-3b.mjs
USER_DATA_DIR=s5reg WIPE_USER_DATA=0`) and `... r-24 dev verify-2-4.mjs USER_DATA_DIR=s5reg MOCK_PORT=8790` (the environment `regress.mjs` gives
them). **The cause is not proven.** What was seen: the person was using the PC at the time (the Claude desktop app in front, input a few seconds old), but
`watch-windows.ps1`, started afterwards, then saw 30 moments of input and 3 times the test window behind the Claude window (maximized on a
1280 x 720 screen) with no stall in any of them. To get proof next time: start `powershell -NoProfile -File tools\watch-windows.ps1 -Tag <tag>`
before `node tools/regress.mjs <tag>` and read `tools/.out/watch-<tag>.log` around the stall (it names the windows that cover the test window).

A related case (`t76`, 2 October 2026): the built-app launch of `verify-5-3` died waiting for the 20 s Test-key timeout notice, while the watcher
logged three moments of keyboard or mouse input and the window was in front; the same launch passed on its own re-run, with no input logged. A key
press or a click in the test window can close the dialog a suite is waiting on, so **do not touch the keyboard or the mouse while a run goes**
(the log lines `INPUT` show when someone did). Also not proven.

## The test client brings a hidden window to the front (added in 8.1)

`cdp.mjs` now checks `document.visibilityState` before every click, key press and typing. If the page says "hidden" it calls `Page.bringToFront`,
waits up to 3 s for "visible" and prints `!! the window was hidden before an input (#n); Page.bringToFront made it visible after N ms` (or "did NOT
make it visible"), which the drivers count like the other `!!` lines. It does nothing when the page is visible. It was added on 2 October 2026
after three runs of the 8.1 window suite in which the test window sat behind the Claude desktop app and reported "hidden", every click took 5 s and a
Settings click was dropped (the watcher, `watch-windows.ps1`, showed the test window in the stacking order behind the Claude window, and input events
about every 2 s the whole time). A fourth run, with the window visible, passed 79 of 79 and did not need the guard, so **it is not proven to fix the
stall**; if a `!!` line of this kind appears, the line says whether it worked. (A `probe` run showed that `Page.bringToFront` does give a visible
window focus; it was not tried on a hidden one.)

## Rules learned the hard way

- **Limits in a scratch profile (8.2):** a profile with no `limits.json` is asked for its spending limits before anything else (a modal dialog), and main refuses every request until it
  has them. `run-with-app.mjs` therefore writes `{"version":1,"daily":"none","monthly":"none"}` into a scratch profile that has none, so the older suites test what they always did;
  `PRESEED_LIMITS=off` leaves the profile bare (the 8.2 suites), and an existing `limits.json` is never replaced. `setup-key.mjs` puts the first-run question off with Escape so that it can open Settings.
  This is the harness writing a file in a scratch profile, never a switch inside the app. The mock has `[[mock:heavy]]` (a million tokens in, a hundred thousand out: $6 at Opus's prices) to reach a limit.
- **A large request in a window suite (8.3):** the default amount ($0.50) asks above 40,000 tokens on Claude Fable 5.1, so a message of 150,000 characters (`bigText` in
  `verify-8-3w.mjs`: `[[mock:count]]` first, so the mock answers "Reply N" and does not echo it back) is a large request there and not on Opus 5.5. A chat can hold at most
  600,000 characters, so start a New chat between sections; `Input.insertText` puts the whole text in at once. While the question is open the composer shows Stop, not Send, so
  `H.waitReady()` waits for nothing: wait for `dialog.large-request` instead. `window.__ev` (a listener on `window.api.chat.onEvent`) records the events, `confirm` included. A
  clean `page.problems` is checked at the end of each launch: it caught a duplicate React key in 8.3.
- **Scratch profile:** every launch passes `--user-data-dir=<dir>` after a second `--`. `ELECTRON_CLI_ARGS` does NOT
  work for dev (the electron-vite CLI overwrites it and the app silently uses the REAL profile). Each window suite calls
  `assertScratchProfile()` before it writes anything.
- **Every "blocked" / "rejected" check needs a negative control** (`nc*.mjs`): two checks once passed with the
  protection removed.
- `electron-vite dev` writes `out/`. Rebuild (`npx electron-vite build`) before any run of the built app.
- A hidden or covered window acknowledges mouse input only after about 5 s; `run-with-app.mjs` passes the flags that
  prevent it, and `cdp.mjs` prints `!! slow mouse acknowledgement` if it happens anyway.
- `run-scenario.mjs` swaps `registry/models.json` for broken variants and puts it back. It keeps its own copy of the
  file (`tools/.out/registry-saved.json`) and **aborts instead of overwriting** if the project's file differs from
  that copy. If a killed run left a broken variant behind: `git checkout registry/models.json`.
- Windows locks a file while the app copies over it: helpers that read the app's files retry on `EBUSY`.
- **Read the app's data folder with Node, not with this PC's Python** (the `python` in the WindowsApps folder): it answered
  "file not found" for a file in a scratch profile's folder that `ls` and Node read fine (met on 2 October 2026, reading the usage ledger). It is
  probably that Python's virtualised view of %APPDATA%; that is not proven.
- Never edit `src/` while a regression runs, and never run two launches at once (they share ports 9222 and 9230).
- The launchers in `regress.mjs` (`run71.mjs`, `run72.mjs`, ...) have a 15-minute limit; `run71.mjs` alone makes a dozen launches and can take
  7 minutes or more. A launcher killed by its limit leaves its app running on port 9222, and then every later launch ends with "port 9222 still
  busy" (the summary shows `no summary`). Kill that app tree (the one with a scratch `--user-data-dir`, never anything else) and re-run.
- A negative control whose run ends with "no summary line" is not a detection: look at its FAIL lines, and run it once more on its own.
- Make a plain-Node suite fail with a FAIL line instead of dying (wrap each section in a guard that turns a throw into a failed check): a
  sabotage often makes a value undefined, and a crash cannot be told from "the sabotage was noticed" (`verify-7-4.mjs` does it).
- A check about text typed or pasted into a box must put the text in with `Input.insertText` (a real edit), not by setting `.value` from a script:
  an attribute such as `maxlength` only limits real edits, so a check that sets the value cannot see it removed or added.
- A reply is Markdown since 7.2 (its paragraphs are elements and a trailing space is not drawn), so a check that compares a reply on screen with
  the text saved in the file must not compare raw strings: `H4.screen()` (`lib4.mjs`) reads a reply as `innerText` and the person's own message as
  typed, and the saved side goes through `shown(role, content)` (the Stage 4 suites were ported to this in 7.5).
- Before a batch of negative controls run `node tools/check-specs.mjs` (no window, changes nothing): every spec's sabotage text must still occur
  exactly once in its file, or `nc.mjs` aborts and the control silently stops existing. Nine specs had gone stale unnoticed by the time of 7.4
  and were repaired. (It reports a spec as stale while a control is sabotaging that very file, so do not run it during a batch.)
- **Hash `src/` and `registry/` before and after a batch of negative controls** (a hash over every file in both, in the order of their paths). In 8.3 one control left `chat.ts` sabotaged with no
  message: its copy-back failed or never ran, and only the hash showed it. `nc.mjs` now retries the copy, proves each file by hash and prints `RESTORE FAILED`; `nc-all.mjs` prints
  `RESTORE NOT CONFIRMED` for a control that printed no "restored:" line. If either appears, copy the original back from `%TEMP%\frontier-negative-control\<label>-<file>.bak` before anything else runs.
- **A control that is caught at its very first check is worth running twice.** One window control "failed" at the first step of the suite for an unrelated reason (a flake), and a second run showed
  that the suite did not see its sabotage at all. A control can also be invisible for a good reason: when one protection stands behind another (the waiting room's abort listener, and `chat.ts`
  refusing to send after an abort), only a control that removes both can be seen from outside; the single one belongs to the plain-Node suite, which looks at the room itself.
- Make a window suite print its summary even when a step waits for something that never comes: catch the error at the top, record it as a failed check that says where
  (`the suite stopped before its end: ...`), and let the summary run. A control that breaks the flow then shows as a named detection, not as "no summary line" (`verify-8-3w.mjs`).
- **A slice that changes what the app emits or what a file says can make an older suite stale without anyone noticing, so the full regression is run at the end of every stage, and a BAD is read before it is believed.** In 8.5 two checks
  that no slice had re-run failed for that reason and nothing else: `verify-5-4` expected a reply's events to be `start`, text, `done` (8.1 added a `usage` event before `done`), and `verify-3-6` expected "reads 0.3" (the
  registry has been schema 0.4 since 8.1). The failing lines said so at once (`FAIL ... -> ["start","text",...,"usage","done"]`; `... reads 0.4`); the fix is in the test, after checking the decision (D-030) says the app is right.
  A check that names a version number or lists every event is the kind that goes stale: when it must, it should name what it means (`usage` just before `done`), as `verify-5-4` now does.

- **The system's dialogs cannot be driven from the page, and need no switch in the app (8b).** `verify-8b-w.mjs` replaces `dialog.showSaveDialog` and `showOpenDialog` in the main process through
  the inspector (`INSPECT_PORT`, as 7.2 did for `shell.openExternal`): every ask is recorded (modal or not, the options) and answered with a path the suite chose, or with "the person closed it". The code
  that calls them must look `dialog` up at the time of the call (`backupDialogs.ts` does), or a replacement made later is not seen. Backup files the suite points at live in `scratch('s8b-files')`, OUTSIDE the
  profile: a backup inside the data folder is refused on purpose.
- **A click lands where a button is ON SCREEN.** In a window narrow enough that the dialog scrolls (280 px), a footer button is below the fold and `page.click` aims at nothing: scroll it to the middle first (`reveal` in `verify-8b-w.mjs`).
- **Compare only what the app owns when you hash a profile.** Chromium keeps its own files in the profile and changes them all the time, so "the profile is unchanged" is checked on the conversations folder and the app's own files, not the whole folder.
- **This PC reaches `%APPDATA%` through a package folder for programs started by the Claude desktop app** (a path that exists resolves to `A:\WpSystem\...\LocalCache\Roaming\...`, one that does not yet exist stays as typed): found by `isInside` (D-034). A junction made
  for a test must point at the resolved target (`fs.realpath`), or it dangles.
- **A heredoc through this Bash tool halves backslashes** (a regex `\d` became `d`, a `\n` inside a JS string became a real line break and broke the file): write anything with a backslash with the Edit or Write tool, and read the result back.
- **`make-specs*.mjs` never deletes a spec it no longer writes**: rename a control and the old file stays and goes stale (`check-specs.mjs` says so). Remove it by hand.
- **After a refactor, run `node tools/check-specs.mjs` at once**: moving the save code into one function and adding two handlers that repeat the sender check made five older controls stale (found, and repaired, in 8b).
- **`QUICK=1` for a Node suite that is slow only because of its biggest block** (`verify-8b-2.mjs`: the normal folder only, and 40 chats instead of 1000): the controls use it; the regression runs the full one.
- **A real lost key is made by deleting the profile's `Local State` (8b.4), not by faking the secure storage.** `run8b3.mjs` keeps a copy of the scratch profile's `Local State` (where Chromium keeps the key that Electron's `safeStorage` uses), deletes it while the app is not
  running, and starts the app: on this PC the secure storage then WORKS (`canEncrypt` true) with a different key, `decryptString` throws on every blob made before, and the app's check catches it. Launch 4 puts the copy back: the old key returns and every sealed chat opens. This is
  a reset profile; "another Windows account" (DPAPI that cannot unwrap the key) was not made. The runner refuses to touch a profile whose path does not contain `frontier-app-test-scratch`.
- **A spec may carry `timeoutMs`** (`nc.mjs` and `nc-all.mjs` read it; the default is 280 s): the lost-key window controls make three launches (`run8b3.mjs dev 3`) and need about 700 s. Controls that show in the first launch use `run8b3.mjs dev 1`.
- **`H.clickRow` and `H.clickRowButton` scroll the row into view before they click (8b.3).** The History list scrolls when its rows and the notes under it do not fit, and a click by coordinates then lands on the note: a longer hint made six rows too many for a 634 px window and
  `verify-4-3a` clicked a paragraph instead of the last row (proved with `elementFromPoint`: the element at the row's centre was `P.history-hint`). It was the harness, not the app.
- **A suite that measures overflow must measure the thing it is about** (8b.3): the first version of the Settings narrow-window check measured the whole dialog, found a sideways scroll at 320 px, and my guess about its cause (the spending-limits form) was wrong; the cause was my own notice (a long
  backup path with no spaces). The check now measures its own section and the dialog's horizontal scrollbar separately, and prints what else is past the edge.
- **A chat's reply must say who wrote it** (a version 3 file whose reply has no `provider` and `model` is unreadable): a test that saves a chat through `store.save` builds its replies with `provider` and `model` (`reply()` in `verify-8b-3.mjs`), or the chat disappears from the list and the failure looks like a bug in the code under test.
- **Never put backticks in a double-quoted string in a Bash call** (a doc edit written as `node -e "..."` lost its text to command substitution): use the Edit or Write tool for anything with backticks, backslashes or many quotes.
- **Since 10.1 a suite that raises a limit, chooses "No limit" or "Never ask" must answer the system's message box from main** (D-039): give its launch an `INSPECT_PORT` and call `sayYesFromMain()` or `installQuestions()` (`lib10.mjs`) before the first such change. Without it a REAL box appears on the screen and the suite waits until its time runs out. The 8.2, 8.3 and 9.4 window suites and their negative-control specs do this. A stand-in that answers at once is faster than a person: a test of "one question at a time" must hold the answer (`hold`, `release`), or the calls run one after another, each with its own question.
- **A message box's buttons show in UI Automation as panes of class `CCPushButton`** (ids `CommandButton_100`, `_101`, ...), and the one with the focus says so (`real-dialogs.ps1 -Op find`, since 10.1). Press them with `-Op tdclick -Value 100` (and so on); `-Value 2` is the box's own cancel (Escape).
