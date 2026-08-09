#!/usr/bin/env bash
# Install / update the Monitor Layout Switcher GNOME Shell extension.
# Creates a symlink from the GNOME extensions directory to this source folder.

set -euo pipefail

UUID="monitor-layout-switcher"
SRC_DIR="$(cd "$(dirname "$0")" && pwd)"
DEST_DIR="$HOME/.local/share/gnome-shell/extensions/$UUID"

find_extension_dirs_by_prefix() {
    local prefix="$1"
    local extensions_root="$HOME/.local/share/gnome-shell/extensions"
    local candidate

    shopt -s nullglob
    for candidate in "$extensions_root"/"$prefix"*; do
        [[ "$candidate" == "$DEST_DIR" ]] && continue
        [[ -e "$candidate" || -L "$candidate" ]] || continue
        printf '%s\n' "$candidate"
    done
    shopt -u nullglob
}

disable_extension_variants_by_prefix() {
    local prefix="$1"
    local candidate uuid

    command -v gnome-extensions >/dev/null 2>&1 || return 0

    while IFS= read -r candidate; do
        [[ -n "$candidate" ]] || continue
        uuid="$(basename "$candidate")"
        if gnome-extensions disable "$uuid" >/dev/null 2>&1; then
            echo "Disabled previous GNOME Shell extension $uuid"
        fi
    done < <(find_extension_dirs_by_prefix "$prefix")
}

queue_extension_enable_on_next_login() {
    if ! command -v gsettings >/dev/null 2>&1; then
        return 1
    fi

    local current updated
    current="$(gsettings get org.gnome.shell enabled-extensions 2>/dev/null || true)"
    if [[ -z "$current" ]]; then
        return 1
    fi

    if [[ "$current" == *"'$UUID'"* ]]; then
        return 0
    fi

    if [[ "$current" == "@as []" || "$current" == "[]" ]]; then
        updated="['$UUID']"
    else
        current="${current#@as }"
        if [[ "$current" != \[*] ]]; then
            return 1
        fi

        updated="${current%]}"
        updated+=", '$UUID']"
    fi

    gsettings set org.gnome.shell enabled-extensions "$updated"
}

mkdir -p "$(dirname "$DEST_DIR")"

disable_extension_variants_by_prefix "$UUID"

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

LIVE_ENABLE_SUCCEEDED=false

if command -v gnome-extensions >/dev/null 2>&1; then
    if gnome-extensions enable "$UUID" >/dev/null 2>&1; then
        echo "Enabled GNOME Shell extension $UUID"
        LIVE_ENABLE_SUCCEEDED=true
    else
        echo "GNOME Shell has not discovered $UUID in the current session yet."
    fi
fi

if [[ "$LIVE_ENABLE_SUCCEEDED" != true ]]; then
    if queue_extension_enable_on_next_login; then
        echo "Queued $UUID to start automatically after the next GNOME Shell restart or login."
    fi
fi

mapfile -t previous_dirs < <(find_extension_dirs_by_prefix "$UUID")
if (( ${#previous_dirs[@]} > 0 )); then
    echo ""
    for previous_dir in "${previous_dirs[@]}"; do
        echo "Found previous extension directory at $previous_dir"
    done
    echo "You can remove it after verifying the renamed extension UUID."
fi

echo ""
echo "Restart GNOME Shell to load the extension:"
echo "  Wayland : log out and log back in, or test in a nested session:"
echo "            dbus-run-session gnome-shell --nested --wayland"
echo "  X11     : press Alt+F2 → type 'r' → Enter"
echo ""
echo "Then enable the extension:"
echo "  gnome-extensions enable $UUID"
