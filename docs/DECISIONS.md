# Decisions (v0.1)

> Short log of choices and why. Newest at the bottom. Add a line when you change course.

## D-001 - Electron + Vite + React + TypeScript

Desktop app with web UI skills; TypeScript for safer refactors. Status: accepted.

## D-002 - Scaffold with `@quick-start/electron` (electron-vite), `react-ts` template

It is the scaffold recommended in the electron-vite docs (checked 2026-10-01). It gives a
standard main / preload / renderer layout. Prompts for ESLint/Prettier were skipped via `--skip`;
the template still ships ESLint and Prettier configs. Status: accepted.

## D-003 - Keep the scaffold's Electron 39

`npm audit` reports 2 high-severity issues in Electron 39 and its `extract-zip` helper. The only
fix offered is a major upgrade to Electron 44. Stage 0 loads no remote content, popups, webviews
or custom protocols, so the flagged features are unused. Status: accepted for Stage 0.
Revisit: upgrade Electron before adding network or web content features.

## D-004 - Keep `sandbox: false` from the scaffold for now

The scaffold ships the window with `sandbox: false`. It was not tested whether the preload works
with the sandbox on. Context isolation is on. Status: temporary.
Revisit: try `sandbox: true` before handling API keys or model output.

## D-005 - Registry is plain JSON files in the repo

`registry/models.json` and `registry/rankings.json` are easy to edit and diff. No database at v0.1.
Status: accepted.

## D-006 - No secrets in the repo

No API keys, no `.env` files, no pushing to a remote during Stage 0. Status: accepted.
