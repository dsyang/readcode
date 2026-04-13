# Plan: Auto-Update + Release Build Infrastructure for ReadCode

## Context

ReadCode is a Tauri 2.x desktop app (Rust + React/TypeScript) at v0.1.0 with no CI/CD,
no auto-update mechanism, and no release pipeline. Version strings are hardcoded in 3 places.
The goal is to add auto-update functionality using Tauri's official updater plugin and a
**local release script** (runnable on Mac or WSL) — no GitHub Actions required.

**What gets updated**: Tauri auto-update replaces the entire app bundle (Rust binary + compiled
React/JS frontend together). It installs a new `.msi` / `.app` — not a hot-reload of JS only.

**Target platforms**: M1/M2 Mac (`aarch64-apple-darwin`) + Windows x86_64.
Each developer runs the release script from their own machine to contribute that platform's artifact.

---

## Architecture Overview

- **Update delivery**: Installer binaries hosted on a **separate public GitHub repo** (`dsyang/readcode-releases`); `latest.json` manifest served via **GitHub Pages** on that same repo at `https://dsyang.github.io/readcode-releases/latest.json` — updated by committing to the `gh-pages` branch on each release
- **Update plugin**: `tauri-plugin-updater` (Tauri 2.x official)
- **Release process**: Local script — Mac builds macOS artifact, Windows (Git Bash) builds Windows artifact; both upload to the same GitHub Release; then Gist is updated
- **Signing**: Ed25519 keypair — private key in a local `.env.release` file (gitignored), pubkey in tauri.conf.json
- **UX**: Silent startup check → unobtrusive toolbar indicator if update available → user-initiated install

## On Cross-Compilation

**Short answer: not possible for full installers.**

- `.msi` requires WiX Toolset, which **only runs on Windows** — cannot be produced from Mac or WSL
- `.dmg`/`.app` requires Apple SDKs — cannot be produced from Windows or Linux
- WSL counts as Linux and cannot produce Windows MSI bundles
- **NSIS** (alternative Windows installer format) *can* be cross-compiled from Mac via `cargo-xwin`, but Tauri marks this as "highly experimental"

**Practical workflow**: run `release.sh` on Mac for the macOS artifact, run it again on Windows (Git Bash) for the Windows artifact. Both upload to the same draft GitHub Release.

---

## User & Developer Experience

### End User Experience

1. User installs the app normally — downloads and runs the `.msi` (Windows) or `.dmg` (Mac) from GitHub Releases
2. App launches as usual with no change to normal behavior
3. **On every startup**, the app silently checks the Gist URL in the background — no spinner, no blocking, user notices nothing
4. **If no update available**: nothing happens at all
5. **If a newer version exists**: a small indicator appears in the toolbar (e.g. "Update available v0.2.0" button/badge)
6. User clicks the button → installer downloads in the background
7. Once downloaded, the app relaunches automatically into the new version — no browser, no manual download, no re-running an installer wizard
8. The full Rust binary + React frontend are replaced as one unit

### Developer Release Workflow (after implementation)

1. Make and commit code changes on the feature branch, merge to main (private `dsyang/readcode`)
2. **On Mac**: `./scripts/release.sh 0.2.0` — bumps version strings, builds signed `.dmg` for aarch64, creates a draft release on the **public** `dsyang/readcode-releases` repo, uploads the artifact
3. **On Windows (Git Bash)**: `./scripts/release.sh 0.2.0` — builds signed `.msi` for x64, uploads to the same draft release
4. **Either machine**: `./scripts/finalize-release.sh 0.2.0` — reads `.sig` contents from both artifacts, commits `latest.json` to `gh-pages` on `dsyang/readcode-releases`, un-drafts the public release
5. `git commit -am "chore: bump to 0.2.0" && git tag v0.2.0 && git push origin main --tags` (private source repo)
6. Running instances of the old app will see the new version on next startup and show the update badge

---

## Implementation Steps

### Step 1: Generate Signing Keypair (one-time, local)

```bash
npm run tauri signer generate -- -w ~/.tauri/readcode.key
```

- Outputs a private key file and a base64 pubkey string
- Copy the pubkey into `tauri.conf.json` (committed to repo)
- Create `~/.tauri/readcode.env` (or `.env.release`, gitignored) with:
  ```
  TAURI_SIGNING_PRIVATE_KEY=<base64_private_key>
  TAURI_SIGNING_PRIVATE_KEY_PASSWORD=
  ```
- Share the private key securely with anyone who needs to cut releases

---

### Step 2: Add Plugin Dependencies

**`src-tauri/Cargo.toml`** — add to `[dependencies]`:
```toml
tauri-plugin-updater = "2"
tauri-plugin-process = "2"
```

**`package.json`** — add to `dependencies`:
```json
"@tauri-apps/plugin-updater": "^2",
"@tauri-apps/plugin-process": "^2"
```

---

### Step 3: Register Plugins in Rust

**`src-tauri/src/lib.rs`** — add to the `tauri::Builder` chain:
```rust
.plugin(tauri_plugin_updater::Builder::new().build())
.plugin(tauri_plugin_process::init())
```

---

### Step 4: Configure Tauri Updater

The `latest.json` manifest will be served from **GitHub Pages** on the public releases repo.

**One-time setup**: Enable GitHub Pages on `dsyang/readcode-releases`:
- Go to the repo Settings → Pages → Source: Deploy from branch → branch: `gh-pages`, folder: `/ (root)`
- Or via CLI: `gh api repos/dsyang/readcode-releases/pages -X POST -f source[branch]=gh-pages -f source[path]=/`

Once enabled, `https://dsyang.github.io/readcode-releases/latest.json` is the stable endpoint — it never changes, only the file content is updated on each release.

**`src-tauri/tauri.conf.json`** — add `plugins.updater` and update `bundle`:
```json
{
  "bundle": {
    "createUpdaterArtifacts": true
  },
  "plugins": {
    "updater": {
      "pubkey": "<YOUR_BASE64_PUBKEY_HERE>",
      "endpoints": [
        "https://dsyang.github.io/readcode-releases/latest.json"
      ]
    }
  }
}
```

---

### Step 5: Frontend — Update Check Hook + UI

**New file: `src/hooks/useUpdater.ts`**
```typescript
import { check } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import { useState, useEffect } from "react";

export function useUpdater() {
  const [updateAvailable, setUpdateAvailable] = useState(false);
  const [updateVersion, setUpdateVersion] = useState<string | null>(null);
  const [installing, setInstalling] = useState(false);

  useEffect(() => {
    check().then((update) => {
      if (update?.available) {
        setUpdateAvailable(true);
        setUpdateVersion(update.version);
      }
    }).catch(() => {}); // silently ignore network errors on startup
  }, []);

  const installUpdate = async () => {
    const update = await check();
    if (!update?.available) return;
    setInstalling(true);
    await update.downloadAndInstall();
    await relaunch();
  };

  return { updateAvailable, updateVersion, installing, installUpdate };
}
```

**`src/components/layout/Toolbar.tsx`** — add update indicator:
- Import `useUpdater` hook
- If `updateAvailable`, show a small "Update available (vX.Y.Z)" button/badge
- Clicking it calls `installUpdate()`
- While `installing`, show a spinner/disabled state

---

### Step 6: Local Release Script

The release process requires two machines (Mac for macOS artifact, Windows for Windows artifact).
Both contribute artifacts to the same GitHub Release on the **public releases repo** (`dsyang/readcode-releases`).
`gh` CLI is required on both machines, authenticated to your GitHub account.

**One-time setup**: Create the public releases repo:
```bash
gh repo create dsyang/readcode-releases --public --description "ReadCode releases"
```

**`scripts/release.sh`** — runs on Mac OR Windows (Git Bash):
```bash
#!/usr/bin/env bash
set -e

VERSION=$1
RELEASES_REPO="dsyang/readcode-releases"
if [ -z "$VERSION" ]; then
  echo "Usage: ./scripts/release.sh 0.2.0"
  exit 1
fi

# Load signing key
source ~/.tauri/readcode.env  # TAURI_SIGNING_PRIVATE_KEY + TAURI_SIGNING_PRIVATE_KEY_PASSWORD

PLATFORM=$(uname -s)
TAG="v$VERSION"

echo "==> Bumping version to $VERSION..."
npm version "$VERSION" --no-git-tag-version --allow-same-version
jq ".version = \"$VERSION\"" src-tauri/tauri.conf.json > /tmp/tauri.conf.json && mv /tmp/tauri.conf.json src-tauri/tauri.conf.json
if [[ "$PLATFORM" == "Darwin" ]]; then
  sed -i '' "s/^version = \".*\"/version = \"$VERSION\"/" src-tauri/Cargo.toml
else
  sed -i "s/^version = \".*\"/version = \"$VERSION\"/" src-tauri/Cargo.toml
fi

echo "==> Building release..."
if [[ "$PLATFORM" == "Darwin" ]]; then
  npm run tauri build -- --target aarch64-apple-darwin
  ARTIFACT_DIR="src-tauri/target/aarch64-apple-darwin/release/bundle"
  ARTIFACT=$(find "$ARTIFACT_DIR/dmg" -name "*.dmg" | head -1)
else
  # Windows — Git Bash
  npm run tauri build
  ARTIFACT_DIR="src-tauri/target/release/bundle"
  ARTIFACT=$(find "$ARTIFACT_DIR/msi" -name "*.msi" | head -1)
fi
SIGFILE="${ARTIFACT}.sig"

echo "==> Creating/updating draft release $TAG on $RELEASES_REPO..."
gh release create "$TAG" --repo "$RELEASES_REPO" --title "ReadCode $TAG" --draft --notes "" 2>/dev/null || true

echo "==> Uploading artifacts..."
gh release upload "$TAG" --repo "$RELEASES_REPO" "$ARTIFACT" "$SIGFILE" --clobber

echo "==> Done! Run 'scripts/finalize-release.sh $VERSION <gist-id>' after BOTH platforms have uploaded."
```

**`scripts/finalize-release.sh`** — run once after both Mac and Windows artifacts are uploaded:
```bash
#!/usr/bin/env bash
set -e

VERSION=$1
RELEASES_REPO="dsyang/readcode-releases"
if [ -z "$VERSION" ]; then
  echo "Usage: ./scripts/finalize-release.sh 0.2.0"
  exit 1
fi

TAG="v$VERSION"
PUB_DATE=$(date -u +"%Y-%m-%dT%H:%M:%SZ")

# Pull .sig contents inline (Tauri requires the signature content, not a URL to it)
MAC_URL="https://github.com/$RELEASES_REPO/releases/download/$TAG/ReadCode_${VERSION}_aarch64.dmg"
WIN_URL="https://github.com/$RELEASES_REPO/releases/download/$TAG/ReadCode_${VERSION}_x64_en-US.msi"
MAC_SIG=$(gh release download "$TAG" --repo "$RELEASES_REPO" -p "*.dmg.sig" --output - 2>/dev/null || echo "MISSING")
WIN_SIG=$(gh release download "$TAG" --repo "$RELEASES_REPO" -p "*.msi.sig" --output - 2>/dev/null || echo "MISSING")

cat > /tmp/latest.json <<EOF
{
  "version": "$VERSION",
  "notes": "See release notes on GitHub.",
  "pub_date": "$PUB_DATE",
  "platforms": {
    "darwin-aarch64": {
      "url": "$MAC_URL",
      "signature": "$MAC_SIG"
    },
    "windows-x86_64": {
      "url": "$WIN_URL",
      "signature": "$WIN_SIG"
    }
  }
}
EOF

# Push latest.json to gh-pages branch of the public releases repo
WORK_DIR=$(mktemp -d)
git clone --branch gh-pages "https://github.com/$RELEASES_REPO.git" "$WORK_DIR" 2>/dev/null || \
  (git clone "https://github.com/$RELEASES_REPO.git" "$WORK_DIR" && git -C "$WORK_DIR" checkout --orphan gh-pages && git -C "$WORK_DIR" rm -rf .)
cp /tmp/latest.json "$WORK_DIR/latest.json"
git -C "$WORK_DIR" add latest.json
git -C "$WORK_DIR" commit -m "update latest.json for $TAG"
git -C "$WORK_DIR" push origin gh-pages
rm -rf "$WORK_DIR"
echo "==> latest.json published to GitHub Pages for v$VERSION!"

# Publish the GitHub Release on the public repo (remove draft)
gh release edit "$TAG" --repo "$RELEASES_REPO" --draft=false
echo "==> Release $TAG published on $RELEASES_REPO!"
```

**Workflow summary:**
1. On Mac: `./scripts/release.sh 0.2.0` → builds `.dmg` + `.sig`, uploads to draft release on `dsyang/readcode-releases`
2. On Windows (Git Bash): `./scripts/release.sh 0.2.0` → builds `.msi` + `.sig`, uploads to same draft release
3. Either machine: `./scripts/finalize-release.sh 0.2.0` → pushes `latest.json` to `gh-pages`, publishes the release
4. `git commit -am "chore: bump to 0.2.0" && git tag v0.2.0 && git push origin main --tags` (on the private source repo)

---

## Critical Files to Modify

| File | Change |
|------|--------|
| `src-tauri/Cargo.toml` | Add `tauri-plugin-updater` and `tauri-plugin-process` deps |
| `package.json` | Add `@tauri-apps/plugin-updater` and `@tauri-apps/plugin-process` |
| `src-tauri/src/lib.rs` | Register both new plugins |
| `src-tauri/tauri.conf.json` | Add `plugins.updater` config + pubkey + `createUpdaterArtifacts: true` |
| `src/components/layout/Toolbar.tsx` | Add update available UI |

## New Files to Create

| File | Purpose |
|------|---------|
| `src/hooks/useUpdater.ts` | Update check + install hook |
| `scripts/release.sh` | Per-platform build + upload script |
| `scripts/finalize-release.sh` | Generates `latest.json` and publishes the release |

---

## Verification

1. **Local sanity check**: `npm run tauri dev` — app should launch without errors after plugin registration
2. **Signing test**: Run `source ~/.tauri/readcode.env && cargo tauri build --target aarch64-apple-darwin` — verify `.sig` files appear next to the `.dmg`
3. **Update flow test (local)**: Build 0.1.0, temporarily point `endpoints` at a local file server serving a `latest.json` pointing at 0.2.0, verify the 0.1.0 app detects it and the update UI appears
4. **End-to-end**: Run full release script for both platforms, finalize, install 0.1.0 build, verify running app detects 0.2.0 on startup

---

## Notes / Caveats

- **No cross-compilation**: `.msi` can only be built on Windows (WiX is Windows-only). `.dmg` can only be built on macOS. WSL counts as Linux and cannot produce Windows MSI. Run the script natively on each platform.
- **Git Bash on Windows**: The `release.sh` bash script works fine in Git Bash. `gh` CLI must be installed (`winget install GitHub.cli`).
- **macOS Gatekeeper**: Without an Apple Developer certificate, users right-click → Open the first time. Fine for internal/trusted users; notarization can be added later.
- **GitHub Pages setup**: Enable Pages on `dsyang/readcode-releases` (Settings → Pages → branch: `gh-pages`). The URL `https://dsyang.github.io/readcode-releases/latest.json` is permanent — only the file content changes each release.
- **`signature` field**: Must contain the raw content of the `.sig` file inline — not a URL to it. The `finalize-release.sh` script handles this automatically via `gh release download`.
- **Artifact filenames**: The exact `.dmg` and `.msi` filenames depend on what Tauri generates. Inspect your first build's `bundle/` output and adjust the `MAC_URL`/`WIN_URL` lines in `finalize-release.sh` if needed.
- **`gh` CLI**: Required on all machines running the scripts. Install: `brew install gh` (Mac) or `winget install GitHub.cli` (Windows).
