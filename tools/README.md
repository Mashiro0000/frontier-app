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

No parts = all of them, about 40 minutes. Do not edit `src/` or `registry/` while it runs (dev launches build from the
tree), and keep the machine idle: `verify-4-3c` (quit with 60 queued saves) fails under extra CPU or disk load.

| Part        | What it runs                                                                        | About   |
| ----------- | ----------------------------------------------------------------------------------- | ------- |
| `node`      | Plain-Node suites: provider, registry, store, adapters, credential store            | 1.5 min |
| `window`    | The window suites of Stages 1-3 and 5.3, each on its own scratch profile            | 3 min   |
| `seeds`     | One launch per damaged `preferences.json` (`make-seeds.mjs` makes them)             | 4.5 min |
| `scenarios` | The registry file deliberately broken in ten ways, restored after each (`run-scenario.mjs`) | 3 min   |
| `stage4`    | The history suites (`final-new.mjs`): crashes, damaged folders, injected disk faults | long    |
| `preview`   | The BUILT app (`npx electron-vite build` first), the same suites again              | long    |

Everything a run produces goes to `tools/.out/` (not committed): `<label>.out.txt` per launch, `app-*.log`,
`regress-<tag>.txt` (the summary), `shots/`, the generated seed files.

Single pieces:

```
node tools/run53.mjs                      one launch of the key / Settings suite
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
| `run4*.mjs`, `run53.mjs`, `final-new.mjs` | Launchers that need two launches, a seeded folder or a crash in the middle  |
| `nc*.mjs`, `specs*/`, `make-specs54.mjs` | Negative controls: sabotage one thing, run the suite, prove it fails, restore the file and prove it by hash |
| `capture-golden-5.mjs`, `golden-*.json`| The recorded request bodies the Anthropic path must keep sending byte for byte  |
| `registry-good.json`                   | A fixed registry for the adapter suites (it is NOT the live one; update it when the schema changes) |
| `drafts/`                              | Suites written ahead of the code for slice 5.5 (OpenAI). **Never run**; they will need fixing. Move one into `tools/` when its slice is built |

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
