# ReadCode

A desktop app for reviewing code changes made by AI agents. Built with Tauri 2.x, React, TypeScript, and Rust.

Inspired by Sublime Merge (commit graph, multi-select commits) and VSCode (side-by-side diffs, inline editing).

## Features

- **DAG commit graph** with SVG lane rendering and branch labels
- **Merged diffs** across multiple commits + working tree
- **CodeMirror 6 MergeView** with side-by-side diff, syntax highlighting, expandable context
- **Review sessions** with comments, severity levels, and line range selection
- **Edit mode** (Cmd+E) to edit files directly in the diff viewer
- **Session persistence** to `.ai-review/sessions/*.json` for feeding back to AI agents
- **"Copy for AI" export** — one-click copy of session JSON to clipboard

## Plans and Session transcripts

See the [`plans/`](plans/) folder for design docs, todos, and session transcripts.

- [`plans/initial_plan/`](plans/initial_plan/) — original build plan (Phases 1–3)
  - [`plan.md`](plans/initial_plan/plan.md) — architecture and phase breakdown
  - [`todos.md`](plans/initial_plan/todos.md) — completed work and Phase 4 remaining tasks
  - [`sessions.md`](plans/initial_plan/sessions.md) — Claude Code session transcripts

- [`plans/auto-update/`](plans/auto-update/) — auto-update + release build infrastructure
  - [`plan.md`](plans/auto-update/plan.md) — updater plugin, signing, release scripts, GitHub Pages
  - [`todos.md`](plans/auto-update/todos.md) — implementation checklist
  - [`sessions.md`](plans/auto-update/sessions.md) — Claude Code session transcripts

## Development

```bash
# Install dependencies (required before typechecking — tsc resolves vitest/@testing-library types from node_modules)
npm install

# Enable the shared pre-commit hook (runs scripts/check.sh fast)
git config core.hooksPath hooks

# Run in development mode
npm run tauri dev

# Build for production
cargo tauri build
```

### Windows: use `run-dev.bat`

On Windows, run `run-dev.bat` instead of `npm run tauri dev` directly. It calls
`vcvars64.bat` to load the MSVC toolchain into the environment before invoking
Tauri. Two things break without it:

1. **`link.exe` not found / C++ build tools missing.** Rust on Windows uses the
   MSVC linker, which only exists on `PATH` inside a "Developer Command Prompt"
   shell. A plain terminal won't find it and `cargo` fails mid-build.
2. **Git Bash's GNU `link` shadows MSVC's `link.exe`.** If you run from Git Bash
   without `vcvars64`, coreutils' `link` wins the `PATH` lookup and cargo
   invokes the wrong binary, producing confusing `link: extra operand` errors.

The batch file loads `vcvars64.bat`, prepends `%USERPROFILE%\.cargo\bin` to
`PATH`, then runs `npm run tauri dev` — so cargo always sees the correct linker.

## Releasing a new version

Releases ship via two scripts: [`scripts/release.sh`](scripts/release.sh) builds
and uploads a per-platform artifact to a draft GitHub Release, and
[`scripts/finalize-release.sh`](scripts/finalize-release.sh) publishes the
release and updates the Tauri updater manifest.

### Prerequisites

- `gh` CLI installed and authenticated (`brew install gh` / `winget install GitHub.cli`)
- `~/.tauri/readcode.env` containing the Tauri updater signing key:
  ```
  TAURI_SIGNING_PRIVATE_KEY=<base64_key>
  TAURI_SIGNING_PRIVATE_KEY_PASSWORD=
  ```
  Generate a keypair once with `npm run tauri signer generate -- -w ~/.tauri/readcode.key`.
- On Mac, also add Apple codesigning + notarization credentials to that env file:
  ```
  APPLE_SIGNING_IDENTITY="Developer ID Application: Your Name (TEAMID)"
  APPLE_ID="your-apple-id@example.com"
  APPLE_PASSWORD="app-specific-password"
  APPLE_TEAM_ID="TEAMID"
  ```
- Rust target `aarch64-apple-darwin` on Mac: `rustup target add aarch64-apple-darwin`
- GitHub Pages enabled on `dsyang/readcode` (branch `gh-pages`, path `/`) — one-time setup

### Step 1 — Build & upload (run once per platform)

```bash
# On Mac — builds signed/notarized .dmg + updater tarball
./scripts/release.sh <version>

# On Windows Git Bash — builds the .msi
./scripts/release.sh <version>
```

Each invocation:

1. Runs the full test suite (`npm run test:all`).
2. Bumps the version in `package.json`, `src-tauri/tauri.conf.json`, and `src-tauri/Cargo.toml`.
3. Builds the platform bundle (Mac signs + notarizes via Apple, then staples).
4. Creates a draft GitHub Release `v<version>` on `dsyang/readcode` if it doesn't exist.
5. Uploads the installer, updater bundle, and `.sig` signature.

### Step 2 — Finalize (run once, after both platforms have uploaded)

```bash
./scripts/finalize-release.sh <version>
```

This:

1. Downloads the `.sig` blobs and asset names from the draft release.
2. Constructs `latest.json` (the Tauri updater manifest) with the inline
   signatures and the post-publish asset URLs.
3. Publishes the GitHub Release (drops the draft flag) **before** pushing the
   manifest — otherwise the URLs in `latest.json` 404 during the race window.
4. Pushes `latest.json` to the `gh-pages` branch, served at
   <https://dsyang.github.io/readcode/latest.json>.

Older clients see the update prompt on next launch.

### Mac-only or Windows-only releases

`finalize-release.sh` skips any platform missing its `.sig` and refuses to
publish an empty manifest. So you can ship a Mac-only or Windows-only release —
just expect a `Warning: No .msi.sig found` (or `.tar.gz.sig`) line, and existing
users on the unbuilt platform won't be offered an update.

### Commit the version bump

`release.sh` edits `package.json`, `tauri.conf.json`, and `src-tauri/Cargo.toml`
in place but doesn't commit. After a successful release, commit those bumps
(and the updated `Cargo.lock`) to `main` so the source tree matches the
shipped version.
