# Monitor Layout Switcher

A GNOME Shell extension that adds a **panel indicator** to the top bar for visually switching between saved multi-monitor layouts — similar to the Zorin OS window layout picker, but for monitor arrangements.

A native GNOME Shell extension built with GJS and the Mutter `DisplayConfig` DBus API.

This extension is stored in this repository at [`extensions/monitor-layout-switcher/`](.).

- Source: [github.com/mauragas/gnome-shell-extensions](https://github.com/mauragas/gnome-shell-extensions)
- Issue tracker: [github.com/mauragas/gnome-shell-extensions/issues](https://github.com/mauragas/gnome-shell-extensions/issues)
- License: [`../../LICENSE`](../../LICENSE)

## Features

- **Visual layout cards** in the panel popup showing miniature monitor arrangements
- **Save Current** — snapshot the active monitor configuration with one click
- **Layout builder/editor** — rename, reorder, and delete saved layouts via the preferences window
- **Keyboard layout switcher** — hold `Super`, tap `F7` to open a centered layout chooser, keep tapping `F7` to cycle through saved layouts, and release `Super` to apply the highlighted one
- Active layout highlighted with a blue border
- Automatic detection of the current layout state
- Reacts to monitor hotplug events (connect/disconnect)
- Layouts persisted in GSettings (survives reboots)
- **Works across Xorg and Wayland sessions** — layouts saved on one session are re-resolved for the capabilities of the other
- Per-layout compatibility badges (`Adjusted` / `Panel off` / `Unavailable`) in the popup, switcher, and preferences window

## How It Works

1. Click the display icon in the top bar
2. The popup shows visual thumbnails of each saved layout (monitor rectangles drawn to scale)
3. Click a card to apply that layout instantly via the Mutter DBus API
4. Use **Save Current** to capture your current monitor arrangement as a new layout
5. Use **Edit Layouts…** to open the preferences window for renaming, reordering, or deleting layouts
6. Hold `Super` and tap `F7` to open the centered chooser overlay
7. The chooser always shows the current saved layout first, followed by the remaining saved layouts in list order
8. Keep tapping `F7` (or use the arrow keys) to move through the available layouts
9. Release `Super` to apply the highlighted layout, press `Enter` to confirm immediately, or press `Escape` to cancel

## Requirements

- GNOME Shell 46+ on **Wayland or Xorg**
- `glib-compile-schemas` (usually included with `libglib2.0-dev` or `glib2-devel`)

### Supported sessions

| Session | Renderer      | Layout mode        | Scaling                                        |
| ------- | ------------- | ------------------ | ---------------------------------------------- |
| Wayland | `native`      | Logical            | Per-monitor, fractional scales allowed         |
| Xorg    | `xrandr`      | Physical (global)  | Single global scale, integer values only       |

A layout saved on Wayland may use fractional scales and virtual modes that Xorg
cannot reproduce (and vice versa). Instead of failing, the extension:

1. Identifies each monitor by EDID (`vendor`, `product`, `serial`), falling back
   to the saved connector name.
2. Re-resolves the saved resolution by mode id, then by size/refresh rate, then
   by the closest aspect ratio that supports the requested scale.
3. Clamps the scale to what the session supports (integer and uniform on Xorg).
4. Rebuilds the geometry so the result is overlap-free, edge-connected, and
   anchored at `(0, 0)` — the same checks Mutter performs.

If a monitor from the layout is not connected, or no usable mode exists, the
layout is reported as **Unavailable** instead of applying a broken configuration.

## Session limitations

- **Xorg** cannot use fractional scaling or per-monitor scales. Layouts saved on
  Wayland with e.g. 125 %/150 % scaling are applied at 100 % with adjusted
  resolutions, and the notification says so.
- **Xorg** has no virtual modes, so a layout saved at a fractional scale is
  restored at the nearest real mode with the same aspect ratio.
- Monitors are matched by EDID first. Two identical monitors without serial
  numbers are matched in connector order, so swapping their cables can swap
  their saved positions.
- Applying a layout is verified with `ApplyMonitorsConfig(VERIFY)` before the
  persistent apply, so a rejected layout never disturbs the current setup.

## Installation

```bash
# From this directory
./install.sh
```

The install script:

1. Creates a symlink from `~/.local/share/gnome-shell/extensions/` to this source folder
2. Compiles the GSettings schemas
3. Attempts to enable the renamed UUID immediately, or queues it for the next login if GNOME Shell has not discovered it yet

After installing, restart GNOME Shell and enable the extension:

```bash
# Wayland — log out / log in, or use a nested session for testing:
dbus-run-session gnome-shell --nested --wayland

# Enable
gnome-extensions enable monitor-layout-switcher
```

If you previously installed an older suffixed UUID variant, rerun
`./install.sh` so GNOME discovers the renamed extension UUID.

## Configuration

Layouts are saved automatically when you click **Save Current** in the popup. Each layout stores (`schemaVersion: 2`):

- Hardware identity: `vendor`, `product`, and `serial` from the monitor EDID
- The connector the layout was saved on (`savedConnector`) and whether the monitor is built in
- The saved mode id plus a `modeHint` (width/height/refresh rate) and the rendered `preferredSize`
- Transform (rotation), scale, and position (`x`, `y`) plus the primary monitor flag

Older schema v1 layouts (`connector`, `model`, `mode`, `x`, `y`) are migrated
automatically when they are loaded and rewritten in v2 form on the next save.

The extension also registers a default keyboard shortcut in GSettings:

- `toggle-last-two-layouts` → `Super` + `F7`

The GSettings key name remains `toggle-last-two-layouts` for backward compatibility, but it now opens the chooser instead of performing the old blind last-two toggle.

The chooser always places the current saved layout first, then keeps the rest in the same order shown in **Edit Layouts…**. If you want a different quick path after the current layout, reorder the saved layouts there.

You can manage saved layouts from the preferences window:

```bash
gnome-extensions prefs monitor-layout-switcher
```

## File Structure

| File                        | Purpose                                                          |
| --------------------------- | ---------------------------------------------------------------- |
| `extension.js`              | Main extension — panel button, visual cards                      |
| `prefs.js`                  | Preferences window — layout editor, session info                 |
| `shared.js`                 | Shared utilities (DBus constants, parsing, helpers)              |
| `lib/display-plan.js`       | Public planning API (re-exports the modules below)               |
| `lib/constants.js`          | Schema version, layout modes, error codes, tolerances            |
| `lib/modes.js`              | Mode parsing, mode selection, and scale resolution               |
| `lib/geometry.js`           | Preview rects, rectangle math, and reflow strategies             |
| `lib/layout-schema.js`      | Layout normalisation/migration and monitor identity matching     |
| `lib/plan.js`               | Plan building and Mutter-compatible validation                   |
| `lib/messages.js`           | User-facing status and error text                                |
| `stylesheet.css`            | Styles for visual layout cards                                   |
| `metadata.json`             | Extension metadata and GSettings schema ref                      |
| `package.json`              | `node --test` config (test-only; GNOME Shell ignores it)         |
| `schemas/*.gschema.xml`     | GSettings schema for persisting layouts                          |
| `schemas/gschemas.compiled` | Compiled schema binary (generated locally)                       |
| `install.sh`                | Symlink installer + schema compiler                              |
| `tests/`                    | `node --test` unit and fixture-driven tests                      |

`schemas/gschemas.compiled` is generated by `install.sh` and intentionally not committed.

The `lib/` modules have no GNOME imports, so the planning and validation logic
can be tested with plain Node.js:

```bash
# From this directory
npm test
```

## Troubleshooting

### `Logical monitors not adjacent`

Mutter rejects a configuration whose logical monitors do not touch edge to edge.
This used to happen when a layout was saved on Wayland (with fractional-scaling
virtual modes) and applied on Xorg, where the saved mode does not exist and the
rectangles grow. Current versions re-resolve the mode and reflow the geometry
before applying, so the error should no longer appear. If it does, the
notification now names the affected monitors and the layout stays unchanged.

### `Logical monitors overlap`

Same root cause as above; the reflow step removes overlaps by placing the
remaining monitors along the saved topology or in rows.

### A layout shows **Unavailable**

One of its monitors is not connected, or no connected mode can satisfy the saved
resolution. Hover the status label in the preferences window for the exact
reason.

## Debugging

```bash
# Watch GNOME Shell logs for extension output
journalctl -f -o cat /usr/bin/gnome-shell

# All messages from the extension are prefixed with [MLS]
journalctl -f -o cat /usr/bin/gnome-shell | grep MLS

# Inspect the raw Mutter display state
busctl --user call org.gnome.Mutter.DisplayConfig \
    /org/gnome/Mutter/DisplayConfig \
    org.gnome.Mutter.DisplayConfig GetCurrentState
```
