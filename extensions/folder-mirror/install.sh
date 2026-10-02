#!/bin/bash
# Install / update the Folder Mirror GNOME Shell extension.
# Creates a symlink from the GNOME extensions directory to this source folder
# and generates the user-session helper service.

set -euo pipefail

export PATH="/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin:${PATH:-}"

UUID="folder-mirror"
SRC_DIR="$(cd "$(dirname "$0")" && pwd)"
DEST_DIR="$HOME/.local/share/gnome-shell/extensions/$UUID"
SYSTEMD_USER_DIR="$HOME/.config/systemd/user"
SERVICE_UNIT_NAME="folder-mirror.service"
SERVICE_UNIT_PATH="$SYSTEMD_USER_DIR/$SERVICE_UNIT_NAME"

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

check_required_command() {
    local command_name="$1"
    local install_hint="$2"

    if ! command -v "$command_name" >/dev/null 2>&1; then
        echo "ERROR: required command '$command_name' is missing."
        echo "       $install_hint"
        exit 1
    fi
}

generate_service_unit() {
    local gjs_bin
    gjs_bin="$(command -v gjs 2>/dev/null || true)"
    if [[ -z "$gjs_bin" ]]; then
        echo "Warning: gjs is not installed; skipping helper service installation."
        return 0
    fi

    if ! command -v systemctl >/dev/null 2>&1; then
        echo "Warning: systemctl is not available; skipping helper service installation."
        return 0
    fi

    mkdir -p "$SYSTEMD_USER_DIR"

    cat > "$SERVICE_UNIT_PATH" <<EOF
[Unit]
Description=Folder Mirror GNOME Shell background helper
After=default.target graphical-session.target
PartOf=graphical-session.target

[Service]
Type=simple
WorkingDirectory=$SRC_DIR
ExecStart=$gjs_bin -m "$SRC_DIR/service/daemon.js"
SuccessExitStatus=75
Restart=always
RestartSec=3

[Install]
WantedBy=default.target
WantedBy=graphical-session.target
EOF

    echo "Installed helper unit: $SERVICE_UNIT_PATH"

    systemctl --user daemon-reload >/dev/null 2>&1 || true
    if systemctl --user enable "$SERVICE_UNIT_NAME" >/dev/null 2>&1; then
        echo "Enabled $SERVICE_UNIT_NAME"
    else
        echo "Warning: could not enable $SERVICE_UNIT_NAME in the current session."
    fi

    if systemctl --user restart "$SERVICE_UNIT_NAME" >/dev/null 2>&1; then
        echo "Started $SERVICE_UNIT_NAME"
    else
        echo "Warning: could not restart $SERVICE_UNIT_NAME in the current session."
        echo "         Run after login: systemctl --user restart $SERVICE_UNIT_NAME"
    fi
}

print_dependency_warning() {
    local command_name="$1"
    local reason="$2"

    if ! command -v "$command_name" >/dev/null 2>&1; then
        echo "Warning: '$command_name' is missing. $reason"
    fi
}

check_required_command "glib-compile-schemas" "Install GLib development/runtime tools that provide glib-compile-schemas."

mkdir -p "$(dirname "$DEST_DIR")"

disable_extension_variants_by_prefix "$UUID"

if [[ -e "$DEST_DIR" && ! -L "$DEST_DIR" ]]; then
    echo "ERROR: $DEST_DIR exists and is not a symlink — remove it first."
    exit 1
fi

ln -sfn "$SRC_DIR" "$DEST_DIR"
echo "Symlinked $DEST_DIR → $SRC_DIR"

if [[ -d "$SRC_DIR/schemas" ]]; then
    echo "Compiling GSettings schemas..."
    glib-compile-schemas "$SRC_DIR/schemas/"
    echo "Schemas compiled."
fi

generate_service_unit

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
    fi
fi

print_dependency_warning "gjs" "The background helper service needs it."
print_dependency_warning "systemctl" "The installer cannot manage the helper service without it."
print_dependency_warning "rsync" "One-way folder mirror profiles will stay unavailable until it is installed."
print_dependency_warning "unison" "Two-way sync profiles will stay unavailable until it is installed."

echo ""
echo "Restart GNOME Shell to load the extension:"
echo "  Wayland : log out and log back in, or test in a nested session:"
echo "           dbus-run-session -- gnome-shell --nested --wayland"
echo "  X11    : Alt+F2 → r → Enter"
echo ""
echo "Helper service:"
echo "  Status : systemctl --user status $SERVICE_UNIT_NAME"
echo "  Logs   : journalctl --user -u $SERVICE_UNIT_NAME"
echo "  Restart: systemctl --user restart $SERVICE_UNIT_NAME"
echo ""
echo "If the extension is still disabled after restarting GNOME Shell:"
echo "  gnome-extensions enable $UUID"
