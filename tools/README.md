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

No parts = all of them, about 55 minutes (54 on 2 October 2026, `t75`, 78 runs). Do not edit `src/` or `registry/` while it runs (dev launches build from the
tree), and keep the machine idle: `verify-4-3c` (quit with 60 queued saves) fails under extra CPU or disk load.

| Part        | What it runs                                                                        | About   |
| ----------- | ----------------------------------------------------------------------------------- | ------- |
| `node`      | Plain-Node suites: provider, registry, rankings, store, adapters, credential store  | 1.5 min |
| `window`    | The window suites of Stages 1-3, 5, 6 and 7.1 to 7.4 and 7.6, each on its own scratch profile | 18 min |
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
node tools/run-scenario.mjs <scenario>    one registry scenario
node tools/nc-all.mjs specs guard-off     one negative control (spec folders: specs, specs4, specs4w)
node tools/with-load.mjs 8 tools/regress.mjs <tag> window      the same, with 8 busy CPU loops competing
node tools/real-call.mjs                  ONE tiny real call per provider (asks for the key; costs a fraction of a cent)
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
| `capture-golden-5.mjs`, `golden-*.json`| The recorded request bodies the Anthropic path must keep sending byte for byte  |
| `mock-openai.mjs`                      | OpenAI's side of the mock: Responses API streaming and its model list (my reading of the docs and the SDK's types, not the real API) |
| `registry-good.json`                   | A fixed registry for the adapter suites (it is NOT the live one; update it when the schema changes) |

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

## Rules learned the hard way

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
