#!/usr/bin/env bash
# Install / update the Razer Keyboard RGB Control GNOME Shell extension.
# Creates a symlink from the GNOME extensions directory to this source folder.

set -euo pipefail

UUID="razer-keyboard-rgb-control"
SRC_DIR="$(cd "$(dirname "$0")" && pwd)"
DEST_DIR="$HOME/.local/share/gnome-shell/extensions/$UUID"
BACKUP_ROOT="$HOME/.local/share/gnome-shell/extension-backups/$UUID"
SYSTEMD_USER_DIR="$HOME/.config/systemd/user"
RESTORE_UNIT_NAME="razer-keyboard-rgb-restore.service"

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

install_boot_restore_service() {
    local gjs_bin
    gjs_bin="$(command -v gjs 2>/dev/null || true)"
    if [[ -z "$gjs_bin" ]]; then
        echo "Warning: gjs is not installed; skipping boot-time lighting restore setup."
        return 0
    fi

    if ! command -v systemctl >/dev/null 2>&1; then
        echo "Warning: systemctl is not available; skipping boot-time lighting restore setup."
        return 0
    fi

    local restore_script="$SRC_DIR/scripts/restore-boot.js"
    if [[ ! -f "$restore_script" ]]; then
        echo "Warning: $restore_script is missing; skipping boot-time lighting restore setup."
        return 0
    fi

    local unit_path="$SYSTEMD_USER_DIR/$RESTORE_UNIT_NAME"
    mkdir -p "$SYSTEMD_USER_DIR"

    cat > "$unit_path" <<EOF
[Unit]
Description=Restore Razer keyboard RGB lighting from the saved preset
After=openrazer-daemon.service
Wants=openrazer-daemon.service

[Service]
Type=oneshot
ExecStart=$gjs_bin -m "$restore_script"
RemainAfterExit=yes

[Install]
WantedBy=default.target
EOF

    echo "Installed boot-time lighting restore unit: $unit_path"

    # Enable user lingering so the user session (and openrazer-daemon) starts at
    # boot. That lets the restore unit run before the user logs in graphically.
    if command -v loginctl >/dev/null 2>&1; then
        if loginctl show-user "$USER" -p Linger 2>/dev/null | grep -q '^Linger=yes$'; then
            echo "User lingering is already enabled for $USER."
        elif loginctl enable-linger "$USER" >/dev/null 2>&1; then
            echo "Enabled user lingering for $USER (session starts at boot)."
        else
            echo "Warning: could not enable user lingering automatically."
            echo "         Run:  sudo loginctl enable-linger $USER"
        fi
    fi

    systemctl --user daemon-reload >/dev/null 2>&1 || true
    if systemctl --user enable "$RESTORE_UNIT_NAME" >/dev/null 2>&1; then
        echo "Enabled $RESTORE_UNIT_NAME (restores lighting at boot and next session start)."
    else
        echo "Warning: could not enable $RESTORE_UNIT_NAME in the current session."
        echo "         After logging into a GNOME session, run:"
        echo "           systemctl --user enable $RESTORE_UNIT_NAME"
    fi
}

mkdir -p "$(dirname "$DEST_DIR")"
mkdir -p "$BACKUP_ROOT"

if command -v gnome-extensions >/dev/null 2>&1; then
    if gnome-extensions disable "$UUID" >/dev/null 2>&1; then
        echo "Disabled existing GNOME Shell extension $UUID"
    fi
fi

disable_extension_variants_by_prefix "$UUID"
disable_extension_variants_by_prefix "razer-rgb-control"

if [[ -e "$DEST_DIR" && ! -L "$DEST_DIR" ]]; then
    BACKUP_DIR="$BACKUP_ROOT/$(date +%Y%m%d-%H%M%S)"
    mv "$DEST_DIR" "$BACKUP_DIR"
    echo "Moved existing extension directory to $BACKUP_DIR"
fi

ln -sfn "$SRC_DIR" "$DEST_DIR"
rm -f "$SRC_DIR"/*.shell-extension.zip
rm -rf "$SRC_DIR"/__pycache__

echo "Symlinked $DEST_DIR → $SRC_DIR"

mapfile -t previous_dirs < <(find_extension_dirs_by_prefix "$UUID")
if (( ${#previous_dirs[@]} > 0 )); then
    for previous_dir in "${previous_dirs[@]}"; do
        echo "Found previous extension files at $previous_dir"
    done
    echo "You can remove them after verifying the renamed extension UUID."
fi

mapfile -t legacy_dirs < <(find_extension_dirs_by_prefix "razer-rgb-control")
if (( ${#legacy_dirs[@]} > 0 )); then
    for legacy_dir in "${legacy_dirs[@]}"; do
        echo "Found legacy extension files at $legacy_dir"
    done
    echo "Keeping them in place so the renamed extension can migrate saved settings on first launch."
fi

if [[ -d "$SRC_DIR/schemas" ]]; then
    echo "Compiling GSettings schemas..."
    glib-compile-schemas "$SRC_DIR/schemas/"
    echo "Schemas compiled."
fi

install_boot_restore_service

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
    elif command -v gnome-extensions >/dev/null 2>&1; then
        echo "Warning: could not queue $UUID for automatic startup."
        echo "         Restart GNOME Shell, then run: gnome-extensions enable $UUID"
    else
        echo "Warning: gnome-extensions is not installed and automatic startup could not be queued."
        echo "         Enable $UUID manually after login if GNOME Shell does not start it automatically."
    fi
fi

if (( ${#previous_dirs[@]} > 0 )); then
    echo ""
    echo "After verifying the renamed extension, you can remove the previous directories:"
    for previous_dir in "${previous_dirs[@]}"; do
        echo "  $previous_dir"
    done
fi

if (( ${#legacy_dirs[@]} > 0 )); then
    echo ""
    echo "After verifying the renamed extension, you can remove the legacy directories:"
    for legacy_dir in "${legacy_dirs[@]}"; do
        echo "  $legacy_dir"
    done
fi

echo ""
echo "Restart GNOME Shell to load the extension:"
echo "  Wayland : log out and log back in, or test in a nested session:"
echo "           dbus-run-session -- gnome-shell --nested --wayland"
echo "  X11    : Alt+F2 → r → Enter"
echo ""
echo "Boot-time lighting restore (before login):"
echo "  Service : $RESTORE_UNIT_NAME"
echo "  Logs    : journalctl --user -u $RESTORE_UNIT_NAME"
echo "  Apply   : systemctl --user start $RESTORE_UNIT_NAME  (apply the saved preset now)"
echo ""
echo "If the extension is still disabled, enable it manually:"
echo "  gnome-extensions enable $UUID"
