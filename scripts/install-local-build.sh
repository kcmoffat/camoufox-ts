#!/usr/bin/env bash
# Install a custom Camoufox build into the local channel.
#
# Usage:
#   ./scripts/install-local-build.sh [artifact.zip] [version-build]
#
# If no artifact is given, uses the latest zip in dist/.
# If no version-build is given, extracts it from the zip filename.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(dirname "$SCRIPT_DIR")"

CACHE_DIR="${HOME}/Library/Caches/camoufox"
if [[ ! -d "${HOME}/Library/Caches" ]]; then
  CACHE_DIR="${XDG_CACHE_HOME:-${HOME}/.cache}/camoufox"
fi

BROWSERS_DIR="${CACHE_DIR}/browsers"
CONFIG_FILE="${CACHE_DIR}/config.json"

ARTIFACT="${1:-}"
if [[ -z "$ARTIFACT" ]]; then
  ARTIFACT="$(ls -t "$REPO_ROOT"/dist/camoufox-*.zip 2>/dev/null | head -1)"
  if [[ -z "$ARTIFACT" ]]; then
    echo "No artifact found in dist/. Pass the zip path as an argument."
    exit 1
  fi
  echo "Using latest artifact: $ARTIFACT"
fi

if [[ ! -f "$ARTIFACT" ]]; then
  echo "Artifact not found: $ARTIFACT"
  exit 1
fi

VERSION_BUILD="${2:-}"
if [[ -z "$VERSION_BUILD" ]]; then
  BASENAME="$(basename "$ARTIFACT")"
  VERSION_BUILD="${BASENAME#camoufox-}"
  VERSION_BUILD="${VERSION_BUILD%.zip}"
  VERSION_BUILD="${VERSION_BUILD%-mac.*}"
  VERSION_BUILD="${VERSION_BUILD%-linux.*}"
  VERSION_BUILD="${VERSION_BUILD%-win.*}"
fi

echo "Version: $VERSION_BUILD"

VERSION="$(echo "$VERSION_BUILD" | grep -oE '^[0-9]+\.[0-9]+\.[0-9]+')"
if [[ -z "$VERSION" ]]; then
  echo "Could not parse semver version from: $VERSION_BUILD"
  exit 1
fi
BUILD="${VERSION_BUILD#${VERSION}-}"

INSTALL_DIR="${BROWSERS_DIR}/local/${VERSION_BUILD}"

echo "Installing to: $INSTALL_DIR"

if [[ -d "$INSTALL_DIR" ]]; then
  echo "Removing existing installation..."
  rm -rf "$INSTALL_DIR"
fi

mkdir -p "$INSTALL_DIR"

TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

unzip -q "$ARTIFACT" -d "$TMP_DIR"

if [[ -d "$TMP_DIR/Camoufox.app" ]]; then
  mv "$TMP_DIR/Camoufox.app" "$INSTALL_DIR/Camoufox.app"
elif [[ -d "$TMP_DIR/Camoufox/Camoufox.app" ]]; then
  mv "$TMP_DIR/Camoufox/Camoufox.app" "$INSTALL_DIR/Camoufox.app"
else
  find "$TMP_DIR" -mindepth 1 -maxdepth 1 -exec mv {} "$INSTALL_DIR/" \;
fi

chmod -R 755 "$INSTALL_DIR"

cat > "$INSTALL_DIR/version.json" <<EOF
{
  "version": "$VERSION",
  "build": "$BUILD",
  "prerelease": false,
  "local_build": true
}
EOF

RELATIVE_PATH="browsers/local/${VERSION_BUILD}"

mkdir -p "$(dirname "$CONFIG_FILE")"

if [[ -f "$CONFIG_FILE" ]]; then
  node -e '
const fs = require("node:fs");
const configPath = process.argv[1];
const relativePath = process.argv[2];
const config = JSON.parse(fs.readFileSync(configPath, "utf8"));
config.active_version = relativePath;
fs.writeFileSync(configPath, JSON.stringify(config, null, 2) + "\n");
' "$CONFIG_FILE" "$RELATIVE_PATH"
else
  printf '{\n  "active_version": "%s"\n}\n' "$RELATIVE_PATH" > "$CONFIG_FILE"
fi

echo
echo "Installed: $INSTALL_DIR"
echo "Active:    $RELATIVE_PATH"
echo
echo "Done. Run 'camoufox list' to see installed versions."
