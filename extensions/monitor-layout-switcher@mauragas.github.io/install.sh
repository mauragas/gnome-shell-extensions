#!/usr/bin/env bash
# Install / update the Monitor Layout Switcher GNOME Shell extension.
# Creates a symlink from the GNOME extensions directory to this source folder.

set -euo pipefail

UUID="monitor-layout-switcher@mauragas.github.io"
SRC_DIR="$(cd "$(dirname "$0")" && pwd)"
DEST_DIR="$HOME/.local/share/gnome-shell/extensions/$UUID"

mkdir -p "$(dirname "$DEST_DIR")"

if [[ -e "$DEST_DIR" && ! -L "$DEST_DIR" ]]; then
    echo "ERROR: $DEST_DIR exists and is not a symlink — remove it first."
    exit 1
fi

ln -sfn "$SRC_DIR" "$DEST_DIR"
echo "Symlinked $DEST_DIR → $SRC_DIR"

# Compile GSettings schemas
if [[ -d "$SRC_DIR/schemas" ]]; then
    echo "Compiling GSettings schemas..."
    glib-compile-schemas "$SRC_DIR/schemas/"
    echo "Schemas compiled."
fi

echo ""
echo "Restart GNOME Shell to load the extension:"
echo "  Wayland : log out and log back in, or test in a nested session:"
echo "            dbus-run-session gnome-shell --nested --wayland"
echo "  X11     : press Alt+F2 → type 'r' → Enter"
echo ""
echo "Then enable the extension:"
echo "  gnome-extensions enable $UUID"
