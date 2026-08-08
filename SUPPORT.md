# Support

This repository is the source home for GNOME Shell extensions maintained here.

## Getting help

- Open a GitHub issue for bugs, regressions, or feature requests: [github.com/mauragas/gnome-shell-extensions/issues](https://github.com/mauragas/gnome-shell-extensions/issues).
- Check the extension-specific README under `extensions/<uuid>/README.md` first for install and usage details.
- Include the following when reporting a problem:
  - GNOME Shell version
  - distribution and version
  - Wayland or X11
  - affected extension UUID
  - steps to reproduce
  - relevant logs from `journalctl -f -o cat /usr/bin/gnome-shell`

## Before opening an issue

- Confirm the problem still happens on the latest `main` branch.
- Re-run the extension's install/setup steps if the change touches schemas or metadata.
- When possible, test with only the affected extension enabled.

## Support scope

Support is best-effort for the current repository contents and the GNOME Shell versions explicitly listed by each extension.

For security-sensitive reports, use [`SECURITY.md`](SECURITY.md) instead of opening a public issue.
