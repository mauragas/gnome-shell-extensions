# GNOME Shell Extensions

Source repository for GNOME Shell extensions maintained by Karolis Mauragas.

- Repository: [github.com/mauragas/gnome-shell-extensions](https://github.com/mauragas/gnome-shell-extensions)
- Issues and feature requests: [github.com/mauragas/gnome-shell-extensions/issues](https://github.com/mauragas/gnome-shell-extensions/issues)
- Security reporting: [`SECURITY.md`](SECURITY.md)

## Repository layout

```text
extensions/
└── <extension-uuid>/
    ├── extension.js
    ├── metadata.json
    ├── stylesheet.css
    ├── README.md
    └── install.sh
```

Each extension lives in a directory named after its GNOME Shell UUID. That mirrors the path GNOME expects under `~/.local/share/gnome-shell/extensions/`, which keeps symlink-based local installs simple and avoids repo-specific glue.

Supporting files such as `prefs.js`, `shared.js`, `lib/`, `ui/`, `tests/`, and a local `package.json` can live alongside the runtime files when an extension needs them.

## Extensions in this repository

| Extension | UUID | GNOME Shell | Folder | Notes |
| --- | --- | --- | --- | --- |
| Monitor Layout Switcher | `monitor-layout-switcher` | 46–48 | `extensions/monitor-layout-switcher/` | Switch between saved multi-monitor layouts from the top bar |
| Razer Keyboard RGB Control | `razer-keyboard-rgb-control` | 46–48 | `extensions/razer-keyboard-rgb-control/` | OpenRazer-powered RGB presets and per-key control for the Razer BlackWidow V3 Tenkeyless |

Per-extension usage and troubleshooting notes live next to the source:

- [`extensions/monitor-layout-switcher/README.md`](extensions/monitor-layout-switcher/README.md)
- [`extensions/razer-keyboard-rgb-control/README.md`](extensions/razer-keyboard-rgb-control/README.md)

## Install an extension

From the extension directory you want to use:

```bash
cd extensions/monitor-layout-switcher
./install.sh
```

For the Razer keyboard extension:

```bash
cd extensions/razer-keyboard-rgb-control
./install.sh
```

The installer symlinks the extension into `~/.local/share/gnome-shell/extensions/<uuid>` and compiles its GSettings schema locally.

## Adding more extensions

- Create `extensions/<uuid>/` and keep the runtime files at that directory root.
- Put GSettings schemas in `schemas/`.
- Add supporting directories such as `lib/`, `ui/`, or `tests/` only when they are genuinely useful.
- Commit source files only; keep generated artifacts such as `schemas/gschemas.compiled` out of git.
- Include a local `README.md` and an `install.sh` (or equivalent) for each extension.
- Update this README when a new extension is added.

## Project policies

- License: [`LICENSE`](LICENSE)
- Support: [`SUPPORT.md`](SUPPORT.md)
- Security reporting: [`SECURITY.md`](SECURITY.md)
