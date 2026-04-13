#!/usr/bin/env bash
# Finalize a release: build latest.json, push it to gh-pages, publish the GitHub Release.
# Run this once AFTER both Mac and Windows artifacts have been uploaded via release.sh.
#
# Usage: ./scripts/finalize-release.sh <version>
# Example: ./scripts/finalize-release.sh 0.2.0
#
# Prerequisites:
#   - gh CLI installed and authenticated
#   - Both .dmg and .msi artifacts already uploaded to the draft release
#   - GitHub Pages enabled on dsyang/readcode (branch: gh-pages)
#     One-time setup: gh api repos/dsyang/readcode/pages \
#       -X POST -f source[branch]=gh-pages -f source[path]=/

set -e

VERSION=$1
RELEASES_REPO="dsyang/readcode"

if [ -z "$VERSION" ]; then
  echo "Usage: ./scripts/finalize-release.sh <version>"
  echo "Example: ./scripts/finalize-release.sh 0.2.0"
  exit 1
fi

TAG="v$VERSION"
PUB_DATE=$(date -u +"%Y-%m-%dT%H:%M:%SZ")

echo "==> Fetching artifact signatures from $TAG..."

# Download .sig files — contents go inline into latest.json (Tauri requirement)
# Tauri signs the updater bundle (.tar.gz on Mac, .msi.zip on Windows), not the installer
MAC_SIG=$(gh release download "$TAG" --repo "$RELEASES_REPO" -p "*.tar.gz.sig" --output - 2>/dev/null || true)
WIN_SIG=$(gh release download "$TAG" --repo "$RELEASES_REPO" -p "*.msi.zip.sig" --output - 2>/dev/null || true)

if [ -z "$MAC_SIG" ]; then
  echo "Warning: No .tar.gz.sig found — darwin-aarch64 will be missing from latest.json"
fi
if [ -z "$WIN_SIG" ]; then
  echo "Warning: No .msi.zip.sig found — windows-x86_64 will be missing from latest.json"
fi

# Derive asset URLs from the release assets
# The updater downloads the .tar.gz (Mac) or .msi.zip (Windows), not the installer
MAC_ASSET=$(gh release view "$TAG" --repo "$RELEASES_REPO" --json assets \
  --jq '.assets[] | select(.name | endswith(".tar.gz")) | .url' 2>/dev/null || true)
WIN_ASSET=$(gh release view "$TAG" --repo "$RELEASES_REPO" --json assets \
  --jq '.assets[] | select(.name | endswith(".msi.zip")) | .url' 2>/dev/null || true)

echo "==> Building latest.json..."
LATEST_JSON=$(cat <<EOF
{
  "version": "$VERSION",
  "notes": "See the full release on GitHub.",
  "pub_date": "$PUB_DATE",
  "platforms": {
    "darwin-aarch64": {
      "url": "$MAC_ASSET",
      "signature": "$MAC_SIG"
    },
    "windows-x86_64": {
      "url": "$WIN_ASSET",
      "signature": "$WIN_SIG"
    }
  }
}
EOF
)

echo "$LATEST_JSON" > /tmp/readcode-latest.json
echo "==> latest.json preview:"
cat /tmp/readcode-latest.json
echo ""

echo "==> Pushing latest.json to gh-pages branch of $RELEASES_REPO..."
WORK_DIR=$(mktemp -d)
trap 'rm -rf "$WORK_DIR"' EXIT

# Clone or create the gh-pages branch
if git clone --branch gh-pages --depth 1 \
    "git@github.com:$RELEASES_REPO.git" "$WORK_DIR" 2>/dev/null; then
  echo "    Cloned existing gh-pages branch"
else
  git clone --depth 1 "git@github.com:$RELEASES_REPO.git" "$WORK_DIR"
  git -C "$WORK_DIR" checkout --orphan gh-pages
  git -C "$WORK_DIR" rm -rf . 2>/dev/null || true
  echo "    Created new gh-pages branch"
fi

cp /tmp/readcode-latest.json "$WORK_DIR/latest.json"
git -C "$WORK_DIR" add latest.json
git -C "$WORK_DIR" -c user.name="release-bot" -c user.email="release@readcode" \
  commit -m "update latest.json for $TAG"
git -C "$WORK_DIR" push origin gh-pages

echo "==> latest.json live at: https://dsyang.github.io/readcode/latest.json"
echo "    (GitHub Pages may take ~1 minute to propagate)"

echo "==> Publishing release $TAG on $RELEASES_REPO..."
gh release edit "$TAG" --repo "$RELEASES_REPO" --draft=false

echo ""
echo "Release $TAG is published!"
echo "Users on older versions will see the update prompt on next app launch."
