# Plan: Windows tauri-driver E2E (local-only)

## Context

This is the last unfinished track from the UX-Confidence Initiative (Tracks
T5 / T2 / T1 / T4 already landed — see commits `a7e8482` / `dcdd099` /
`ab673c4` / `4ff4055` for the full sweep). T3 was deferred because it's
Windows-specific scaffolding and can only be exercised on a Windows machine.

**Goal:** one cross-stack smoke test exercising open-repo → select commits →
comment → reload against the real built binary on Windows, runnable on
demand. The intent is regression-on-release coverage for the IPC + UI seam,
not continuous coverage. macOS is **not supported by tauri-driver** because
WKWebView lacks a WebDriver endpoint, so this is Windows-only by necessity.

## Cadence (decided)

**Local-only — no CI workflow.** Runs on demand via `e2e/run-local.bat`
before cutting a release or after touching the IPC surface. PR-time
coverage stays on `check.sh fast` plus the unit-test layers added in
T1/T4. This drops about half a day of CI plumbing and avoids known
tauri-driver flake on `windows-latest` runners.

The trade-off: regressions only get caught when someone runs the script.
Mitigation is to make running it part of the release checklist, not an
optional nicety.

## Approach

- New `e2e/` directory with its **own** `package.json` (separate from the
  main one to avoid Vite/TypeScript config conflicts) using
  `webdriverio` pointed at `msedgedriver` + `tauri-driver`.
- One single test: boot the dev binary, call `open_repo` with a fixture
  path, drive selection via clicks/keyboard, type a comment, close,
  reopen, assert the comment persists.
- Fixture repo extracted from `e2e/fixtures/sample-repo.tar.gz` on test
  setup — committing a real `.git` directory has too many quirks (line
  endings, exec bits, hooks) and bloats the main repo.
- **Local Windows usage:** `e2e/run-local.bat` calls `vcvars64.bat`
  (matching the existing `run-dev.bat` pattern at the repo root) and
  runs the test against `npm run tauri dev`.
- Document in `README.md` under a "Pre-release checklist" section so it's
  not forgotten between releases.

## Gotchas

- WebDriver against Tauri is finicky around app boot timing. Use explicit
  wait-for-element guards, not fixed sleeps — sleep-based flakes are the
  #1 reason these suites get disabled and never come back.
- The fixture must use forward-slash paths internally; Windows path
  handling on the Rust side (`src-tauri/src/commands/git.rs` calls into
  `std::path::Path::join`) isn't tested today and could surprise.
- Keep it single-flow. Multi-flow E2E suites against tauri-driver become
  flake factories — one test that exercises the critical path beats five
  that fail intermittently.
- Local-only means regressions only get caught when someone runs it.
  Tie it to the release script: have `scripts/release.sh` print a
  reminder banner on Windows runs, or add a manual checkbox to the
  release checklist in README.md.

## Files

**New**

- `e2e/package.json` — separate npm tree pinning `webdriverio`,
  `@wdio/cli`, `@wdio/local-runner`, `@wdio/mocha-framework`,
  `tauri-driver`. Keep deps minimal.
- `e2e/wdio.conf.ts` — pointed at `msedgedriver` + `tauri-driver` with
  `path: '/'` and `port: 4444`.
- `e2e/specs/smoke.spec.ts` — the single open → comment → reload →
  assert-persisted test.
- `e2e/fixtures/sample-repo.tar.gz` — small repo (a few commits, mixed
  file types) extracted into a temp dir on test setup.
- `e2e/run-local.bat` — calls `vcvars64.bat`, then `npm install --prefix
  e2e`, then `npm run --prefix e2e test` against `npm run tauri dev`.

**Modified**

- `README.md` — add a **Pre-release checklist** section that includes
  running `e2e\run-local.bat` from a Windows shell before tagging a
  release.

## Verification

On a Windows machine:

1. `e2e\run-local.bat` boots the app, runs the smoke test, exits 0.
2. Touch a UI label that the smoke test asserts on (e.g., the "Start
   New Review" button text). Re-run; the test fails with a clean diff.
3. Add to the release flow: run before each `scripts/release.sh` to
   catch regressions before the artifact ships.

## Why this was deferred

The UX-Confidence Initiative landed T5/T2/T1/T4 as a stack from a Mac
dev machine. T3 needs Windows for both the development loop (write the
test, run it, iterate) and verification (the test only runs on
Windows). Picking it up on the Windows machine where it'll actually be
used is the right scope boundary.

When you're ready to tackle this, the test counts to beat are 61 Rust +
61 vitest = 122 unit tests as of `4ff4055` — anything you add here is
on top of that floor.
