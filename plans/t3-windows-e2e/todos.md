# Todos — T3 Windows E2E

## Setup (Windows machine)

- [ ] Install `msedgedriver` matching the local Edge WebView2 version
- [ ] Install `tauri-driver` (`cargo install tauri-driver`)
- [ ] Confirm `vcvars64.bat` is on PATH (already required by `run-dev.bat`)

## Scaffolding

- [ ] Create `e2e/package.json` with `webdriverio`, `@wdio/cli`,
      `@wdio/local-runner`, `@wdio/mocha-framework`, `tauri-driver` deps
- [ ] Create `e2e/wdio.conf.ts` pointed at `msedgedriver` + `tauri-driver`
- [ ] Create `e2e/fixtures/sample-repo.tar.gz` (a few commits, mixed file
      types, forward-slash paths)

## Test

- [ ] Write `e2e/specs/smoke.spec.ts`:
  - Boot the dev binary
  - Extract `sample-repo.tar.gz` to a temp dir
  - Call `open_repo` with the temp path
  - Drive commit selection via clicks/keyboard
  - Type a comment, save
  - Close + reopen the app
  - Assert the comment persists
- [ ] Use explicit wait-for-element guards — no fixed `sleep()` calls
- [ ] Verify forward-slash paths don't break the Rust path-join in
      `src-tauri/src/commands/git.rs`

## Local usage

- [ ] Create `e2e/run-local.bat` mirroring `run-dev.bat`'s `vcvars64.bat`
      pattern; runs `npm install --prefix e2e` then `npm run --prefix e2e
      test` against `npm run tauri dev`
- [ ] Verify the script exits 0 on a clean run

## Documentation

- [ ] Add a **Pre-release checklist** section to `README.md` listing
      `e2e\run-local.bat` as a required step before tagging
- [ ] Optional: have `scripts/release.sh` print a reminder banner when
      run on Windows (`uname -s` returns `MINGW*` or `MSYS_NT*`)

## Verification

- [ ] First run on a Windows machine passes
- [ ] Sanity-check failure mode: change a UI label the test asserts on
      and confirm the test fails with a useful diff
