#!/bin/bash
# Builds dist/Anaico.app (and a zip of it) for macOS: a pinned Node, the app, its packages and the character creator at the pinned release,
# plus a small native launcher (it needs the Xcode command line tools for swiftc). Run it on a Mac:   scripts/build-mac-app.sh [--arch arm64|x64]
#
# The app is not signed with a developer certificate (that needs an Apple Developer account), only ad hoc, so the first launch on another
# Mac needs right-click -> Open (or System Settings -> Privacy & Security -> Open Anyway).
# It keeps the user's files in ~/Library/Application Support/Anaico, never inside the bundle (an update replaces the bundle).
set -euo pipefail

NODE_VERSION="22.23.3"   # an LTS release; the app needs 22.18 or newer (package.json engines)
ARCH="$(uname -m)"; [ "$ARCH" = "x86_64" ] && ARCH="x64"
while [ $# -gt 0 ]; do
  case "$1" in
    --arch) ARCH="$2"; shift 2 ;;
    *) echo "unknown option $1" >&2; exit 2 ;;
  esac
done
case "$ARCH" in arm64|x64) ;; *) echo "--arch is arm64 or x64" >&2; exit 2 ;; esac

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
VERSION="$(node -p "require('./package.json').version")"
CREATOR_URL="$(node -p "require('./package.json').creator.url")"
CREATOR_REF="$(node -p "require('./package.json').creator.ref")"
OUT="$ROOT/dist"
APP="$OUT/Anaico.app"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

echo "Building Anaico $VERSION for macOS $ARCH (Node $NODE_VERSION, creator $CREATOR_REF)"
rm -rf "$APP"
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources/app"
RES="$APP/Contents/Resources"

# 1. Node
NAME="node-v$NODE_VERSION-darwin-$ARCH"
curl -fsSL "https://nodejs.org/dist/v$NODE_VERSION/$NAME.tar.gz" -o "$WORK/node.tgz"
curl -fsSL "https://nodejs.org/dist/v$NODE_VERSION/SHASUMS256.txt" -o "$WORK/SHASUMS256.txt"
(cd "$WORK" && grep " $NAME.tar.gz\$" SHASUMS256.txt | sed "s| $NAME.tar.gz| node.tgz|" | shasum -a 256 -c -)
tar -xzf "$WORK/node.tgz" -C "$WORK" "$NAME/bin/node"
cp "$WORK/$NAME/bin/node" "$RES/node"
chmod 755 "$RES/node"

# 2. The app: only what runs (no tests, site, demo, trailer, docs, or the user's data/)
for item in src public packs bin persona.md persona-work.md emotions.json package.json package-lock.json LICENSE; do
  cp -R "$item" "$RES/app/"
done
(cd "$RES/app" && npm ci --omit=dev --ignore-scripts --no-audit --no-fund --loglevel=error)
rm -f "$RES/app/package-lock.json"

# 3. The character creator at the pinned release (its TypeScript; the app finds it through CREATOR_SRC)
git -c advice.detachedHead=false clone --quiet --depth 1 --branch "$CREATOR_REF" "$CREATOR_URL" "$RES/creator"
# Only its TypeScript is read at run time; the reference images and the Python tooling are most of its size.
find "$RES/creator" -mindepth 1 -maxdepth 1 ! -name ts ! -name LICENSE -exec rm -rf {} +

# 4. The native stub (quits cleanly, shows in the Dock), the start script it runs, and the bundle description
SWIFT_ARCH="$ARCH"; [ "$ARCH" = "x64" ] && SWIFT_ARCH="x86_64"
swiftc -O -target "$SWIFT_ARCH-apple-macos11" -o "$APP/Contents/MacOS/Anaico" "$ROOT/scripts/mac/main.swift" -framework Cocoa
cp "$ROOT/scripts/mac/start.sh" "$RES/start.sh"
chmod 755 "$RES/start.sh"
cat > "$APP/Contents/Info.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleName</key><string>Anaico</string>
  <key>CFBundleDisplayName</key><string>Anime AI Companion</string>
  <key>CFBundleIdentifier</key><string>io.github.rhedak.anaico</string>
  <key>CFBundleExecutable</key><string>Anaico</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleShortVersionString</key><string>$VERSION</string>
  <key>CFBundleVersion</key><string>$VERSION</string>
  <key>LSMinimumSystemVersion</key><string>11.0</string>
  <key>NSHighResolutionCapable</key><true/>
</dict>
</plist>
PLIST

# 5. Ad hoc signature (Apple Silicon refuses unsigned code) and a zip that keeps the bundle intact
codesign --force --deep --sign - "$APP" >/dev/null 2>&1 || echo "note: ad hoc signing failed; the app may need 'xattr -cr' on Apple Silicon"
ZIP="$OUT/Anaico-$VERSION-mac-$ARCH.zip"
rm -f "$ZIP"
ditto -c -k --keepParent "$APP" "$ZIP"
echo "Built $APP"
echo "Zip:  $ZIP ($(du -h "$ZIP" | cut -f1))"
