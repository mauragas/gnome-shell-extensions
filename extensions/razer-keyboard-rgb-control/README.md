# Razer Keyboard RGB Control

`Razer Keyboard RGB Control` is a GNOME Shell extension for the `Razer BlackWidow V3 Tenkeyless` using `OpenRazer`.

This extension is stored in this repository at [`extensions/razer-keyboard-rgb-control/`](.).

- Source: [github.com/mauragas/gnome-shell-extensions](https://github.com/mauragas/gnome-shell-extensions)
- Issue tracker: [github.com/mauragas/gnome-shell-extensions/issues](https://github.com/mauragas/gnome-shell-extensions/issues)
- License: [`../../LICENSE`](../../LICENSE)

## Features

- Top-bar presets for static colors, custom hue, effects, and brightness
- A larger control-pad overlay with programmer modes and a per-key mode editor
- Saved keyboard lighting restore after login, reconnect, or extension reload
- Background recovery when the keyboard is present on USB but missing from the `OpenRazer` session D-Bus state
- A GNOME-session test bridge for live UI smoke checks

## Requirements

- GNOME Shell `46`, `47`, or `48`
- `OpenRazer` installed and `openrazer-daemon` running in the user session
- The current user added to `plugdev`
- A `Razer BlackWidow V3 Tenkeyless`

## Prepare `OpenRazer`

Before installing the extension, set up `OpenRazer` for your current user.

1. Install `OpenRazer` by following the distro-specific instructions on the
   [official download page](https://openrazer.github.io/#download).
   `OpenRazer` uses an out-of-tree DKMS driver, so make sure the matching kernel
   headers package is installed for your current kernel.
2. Add your user to `plugdev`:

   ```bash
   sudo gpasswd -a "$USER" plugdev
   ```

3. Reboot the computer, or at least log out and back in, so the new group
   membership and driver permissions take effect. If the driver still fails to
   load, check whether Secure Boot is blocking unsigned kernel modules.
4. Start the daemon in your user session and verify that it is running:

   ```bash
   systemctl --user enable --now openrazer-daemon
   systemctl --user status openrazer-daemon --no-pager
   ```

5. Optional sanity checks:

   ```bash
   groups
   lsusb | grep -i razer
   ```

## Install

1. Run the installer from this directory:

   ```bash
   ./install.sh
   ```

   If you previously installed an older suffixed `razer-keyboard-rgb-control`
   UUID variant, the installer disables that previous variant so GNOME can pick
   up the renamed extension. If you previously installed an older
   `razer-rgb-control` variant, the installer also disables that legacy variant
   and leaves its old files in place so the renamed extension can migrate saved
   presets on first launch. If the current GNOME Shell session has not
   discovered the renamed UUID yet, the installer also queues
   `razer-keyboard-rgb-control` in `org.gnome.shell enabled-extensions` so it
   starts automatically after the next shell restart or login. If an older
   copied install already exists under
   `~/.local/share/gnome-shell/extensions/`, the installer moves it into a
   timestamped backup and replaces it with a symlink to this source directory.

2. Restart GNOME Shell:
   - Wayland: log out and log back in
   - X11: press `Alt+F2`, type `r`, then press `Enter`

3. If the extension is still disabled after restarting GNOME Shell, enable it manually:

   ```bash
   gnome-extensions enable razer-keyboard-rgb-control
   ```

## Verify manually

1. Open the panel indicator.
2. Confirm the menu shows `Static colors`, `Custom modes`, `Custom color`, `Effects`, and `Brightness`.
3. Apply a static color and brightness preset.
4. Open `Control Pad…` and confirm the larger keyboard card appears.
5. Edit a programmer mode, press `Apply Mode`, then `Reset Mode`.
6. Reconnect the keyboard and confirm the last saved lighting state comes back.

## Automated checks

Run the checks from this extension directory.

```bash
bash -n ./install.sh
```

If `node` and `npm` are available, you can also run:

```bash
npm test
npm run test:live
npm run test:ui-live
```

The `test:live` and `test:ui-live` suites require real hardware plus a running
GNOME Shell session.

If you only need a direct GJS state check:

```bash
gjs -m tests/live-driver.js discover-state
```

The live helper JSON intentionally redacts device serials and D-Bus object paths
so shared logs and snapshots do not expose local hardware identifiers.

## Troubleshooting

### The keyboard does not appear in the extension

- Check that `openrazer-daemon` is running in the user session.
- Confirm the keyboard is visible in `lsusb`.
- Make sure your user is in `plugdev`.
- Open the menu and use `Refresh Status`.

### The extension is installed but not visible

- Re-run `./install.sh`.
- Restart GNOME Shell.
- If `gnome-extensions info razer-keyboard-rgb-control`
   says the extension does not exist yet, restart GNOME Shell once so it can
   discover the renamed extension directory. The installer queues the UUID for
   the next login when this discovery delay happens, so once GNOME Shell sees
   the extension it should start automatically.
- Check the extension state:

  ```bash
   gnome-extensions info razer-keyboard-rgb-control
  ```

### The keyboard is on USB but missing from `OpenRazer`

The extension polls for a missing keyboard and can restart `openrazer-daemon` when the device is visible on USB but not exposed on the session bus yet. If recovery still fails, restart the daemon manually and reopen the menu.

## File overview

- `extension.js` — GNOME Shell runtime, menu, overlay, and restore behavior
- `lib/` — backend state, color math, keyboard layout, and preset helpers
- `ui/` — reusable GNOME Shell UI helpers for chips and monitor placement
- `shared.js` — `OpenRazer` discovery and lighting helpers
- `package.json` — local Node-based test entry points
- `install.sh` — local install, migration, and schema compilation flow
- `schemas/org.gnome.shell.extensions.razer-keyboard-rgb-control.gschema.xml` — GSettings schema for saved lighting state and custom layouts
- `tests/live-driver.js` — GJS live-state helper for direct verification
- `tests/live.integration.test.js` — real-device keyboard checks
- `tests/ui.live.integration.test.js` — GNOME UI smoke checks

`schemas/gschemas.compiled` is generated locally by `./install.sh` and is intentionally not committed.
