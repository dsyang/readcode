#!/usr/bin/env bash
# Build and upload a platform-specific release artifact.
# Run this on Mac (for .dmg) and on Windows Git Bash (for .msi).
# After both platforms have uploaded, run finalize-release.sh.
#
# Usage: ./scripts/release.sh <version>
# Example: ./scripts/release.sh 0.2.0
#
# Prerequisites:
#   - gh CLI installed and authenticated (brew install gh / winget install GitHub.cli)
#   - ~/.tauri/readcode.env containing:
#       TAURI_SIGNING_PRIVATE_KEY=<base64_key>
#       TAURI_SIGNING_PRIVATE_KEY_PASSWORD=
#     And on Mac, for codesigning + notarization:
#       APPLE_SIGNING_IDENTITY="Developer ID Application: Your Name (TEAMID)"
#       APPLE_ID="your-apple-id@example.com"
#       APPLE_PASSWORD="app-specific-password"   # appleid.apple.com → Sign-In and Security → App-Specific Passwords
#       APPLE_TEAM_ID="TEAMID"
#   - Rust target aarch64-apple-darwin installed on Mac:
#       rustup target add aarch64-apple-darwin

set -e

VERSION=$1
RELEASES_REPO="dsyang/readcode"

if [ -z "$VERSION" ]; then
  echo "Usage: ./scripts/release.sh <version>"
  echo "Example: ./scripts/release.sh 0.2.0"
  exit 1
fi

# Load signing key from local env file
ENV_FILE="$HOME/.tauri/readcode.env"
if [ ! -f "$ENV_FILE" ]; then
  echo "Error: $ENV_FILE not found."
  echo "Create it with:"
  echo "  TAURI_SIGNING_PRIVATE_KEY=<base64_key>"
  echo "  TAURI_SIGNING_PRIVATE_KEY_PASSWORD="
  echo "Generate a keypair with: npm run tauri signer generate -- -w ~/.tauri/readcode.key"
  exit 1
fi
source "$ENV_FILE"

PLATFORM=$(uname -s)
TAG="v$VERSION"

echo "==> Bumping version to $VERSION..."
npm version "$VERSION" --no-git-tag-version --allow-same-version

# Update tauri.conf.json version
jq ".version = \"$VERSION\"" src-tauri/tauri.conf.json > /tmp/_tauri.conf.json \
  && mv /tmp/_tauri.conf.json src-tauri/tauri.conf.json

# Update src-tauri/Cargo.toml version (first occurrence = the [package] version)
awk -v ver="$VERSION" '/^version = "/ && !done { sub(/^version = ".*"/, "version = \"" ver "\""); done=1 } 1' \
  src-tauri/Cargo.toml > /tmp/_Cargo.toml && mv /tmp/_Cargo.toml src-tauri/Cargo.toml

echo "==> Building release for $PLATFORM..."
if [[ "$PLATFORM" == "Darwin" ]]; then
  npm run tauri build -- --target aarch64-apple-darwin
  INSTALLER=$(find "target/aarch64-apple-darwin/release/bundle/dmg" -name "*.dmg" | head -1)
  UPDATER=$(find "target/aarch64-apple-darwin/release/bundle/macos" -name "*.tar.gz" | head -1)
else
  # Windows via Git Bash — builds x86_64 MSI
  npm run tauri build
  INSTALLER=$(find "target/release/bundle/msi" -name "*.msi" ! -name "*.sig" | head -1)
  UPDATER="$INSTALLER"
fi

if [ -z "$INSTALLER" ]; then
  echo "Error: No installer artifact found"
  exit 1
fi
SIGFILE="${UPDATER}.sig"
echo "==> Built installer: $INSTALLER"
echo "==> Built updater:   $UPDATER"
echo "==> Signature:       $SIGFILE"

echo "==> Creating draft release $TAG on $RELEASES_REPO (if not exists)..."
gh release create "$TAG" \
  --repo "$RELEASES_REPO" \
  --title "ReadCode $TAG" \
  --draft \
  --notes "" \
  2>/dev/null || echo "    (release already exists, continuing)"

echo "==> Uploading artifacts..."
gh release upload "$TAG" \
  --repo "$RELEASES_REPO" \
  "$INSTALLER" "$UPDATER" "$SIGFILE" \
  --clobber

echo ""
echo "Done! Artifact uploaded to $RELEASES_REPO @ $TAG"
echo "Run './scripts/finalize-release.sh $VERSION' after BOTH platforms have uploaded."
