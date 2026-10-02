import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import St from 'gi://St';

import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';

import {
    DBUS_INTERFACE_NAME,
    DBUS_OBJECT_PATH,
    DBUS_SERVICE_NAME,
    EXTENSION_TITLE,
    PANEL_ICON_NAMES,
    SETTINGS_SCHEMA_ID,
    formatProfileLocation,
    getHelperSnapshot,
    getLogDir,
    invokeHelperVoidMethod,
    openPath,
} from './shared.js';
import {
    buildSnapshot,
    buildSnapshotSummary,
    deriveIndicatorState,
    parseSnapshot,
} from './lib/status-store.js';
import {summarizeMode} from './lib/validation.js';

const PANEL_MENU_ALIGNMENT = 0.5;
const SNAPSHOT_REFRESH_INTERVAL_MS = 30000;

function buildHelperStateLabel(snapshot) {
    switch (snapshot.helperState) {
    case 'running':
        return 'Helper running';
    case 'starting':
        return 'Helper starting';
    case 'error':
        return 'Helper error';
    case 'stopped':
    default:
        return 'Helper stopped';
    }
}

function buildStatusLabel(profile) {
    const statusLabel = profile.status.replace(/-/gu, ' ');
    return `${summarizeMode(profile.mode)} • ${statusLabel}`;
}

export default class FolderMirrorExtension extends Extension {
    enable() {
        this._settings = this.getSettings(SETTINGS_SCHEMA_ID);
        this._snapshot = buildSnapshot({helperState: 'starting'});
        this._indicator = new PanelMenu.Button(PANEL_MENU_ALIGNMENT, this.metadata.name, false);
        this._icon = new St.Icon({
            icon_name: PANEL_ICON_NAMES.idle,
            style_class: 'system-status-icon',
        });
        this._indicator.add_child(this._icon);
        Main.panel.addToStatusArea(this.uuid, this._indicator);

        this._menuOpenStateChangedId = this._indicator.menu.connect(
            'open-state-changed',
            (_menu, isOpen) => {
                if (!isOpen)
                    return;

                this._refreshSnapshot().catch(error => {
                    console.error(`[FM] menu refresh failed: ${error.message}`);
                });
            }
        );

        this._settingsChangedId = this._settings.connect('changed::show-indicator', () => {
            this._syncIndicatorVisibility();
        });

        this._snapshotSignalId = Gio.DBus.session.signal_subscribe(
            DBUS_SERVICE_NAME,
            DBUS_INTERFACE_NAME,
            'SnapshotChanged',
            DBUS_OBJECT_PATH,
            null,
            Gio.DBusSignalFlags.NONE,
            (_connection, _sender, _path, _iface, _signal, parameters) => {
                try {
                    const snapshotJson = parameters.get_child_value(0).get_string()[0];
                    this._snapshot = parseSnapshot(snapshotJson);
                    this._updateIndicator();
                    this._rebuildMenu();
                } catch (error) {
                    console.error(`[FM] failed to parse helper snapshot: ${error.message}`);
                }
            }
        );

        this._refreshTimeoutId = GLib.timeout_add(
            GLib.PRIORITY_DEFAULT,
            SNAPSHOT_REFRESH_INTERVAL_MS,
            () => {
                this._refreshSnapshot().catch(error => {
                    console.error(`[FM] periodic refresh failed: ${error.message}`);
                });
                return GLib.SOURCE_CONTINUE;
            }
        );

        this._syncIndicatorVisibility();
        this._rebuildMenu();
        this._refreshSnapshot().catch(error => {
            console.error(`[FM] initial refresh failed: ${error.message}`);
        });
    }

    disable() {
        if (this._refreshTimeoutId) {
            GLib.source_remove(this._refreshTimeoutId);
            this._refreshTimeoutId = 0;
        }

        if (this._snapshotSignalId) {
            Gio.DBus.session.signal_unsubscribe(this._snapshotSignalId);
            this._snapshotSignalId = 0;
        }

        if (this._settingsChangedId) {
            this._settings.disconnect(this._settingsChangedId);
            this._settingsChangedId = 0;
        }

        if (this._menuOpenStateChangedId && this._indicator?.menu) {
            this._indicator.menu.disconnect(this._menuOpenStateChangedId);
            this._menuOpenStateChangedId = 0;
        }

        this._indicator?.destroy();
        this._indicator = null;
        this._icon = null;
        this._settings = null;
    }

    _syncIndicatorVisibility() {
        if (!this._indicator)
            return;

        this._indicator.visible = this._settings.get_boolean('show-indicator');
    }

    _notify(message, isError = false) {
        if (!this._settings?.get_boolean('show-notifications'))
            return;

        Main.notify(EXTENSION_TITLE, message);
        if (isError)
            console.error(`[FM] ${message}`);
    }

    async _refreshSnapshot() {
        this._snapshot = await getHelperSnapshot();
        this._updateIndicator();
        this._rebuildMenu();
    }

    _updateIndicator() {
        if (!this._icon)
            return;

        const indicatorState = deriveIndicatorState(this._snapshot);
        this._icon.icon_name = PANEL_ICON_NAMES[indicatorState] ?? PANEL_ICON_NAMES.idle;
    }

    _rebuildMenu() {
        if (!this._indicator)
            return;

        const menu = this._indicator.menu;
        menu.removeAll();

        menu.addMenuItem(this._createHeaderItem());
        menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
        menu.addMenuItem(this._createSimpleActionItem('Run all now', async () => {
            await invokeHelperVoidMethod('RunAll');
            this._notify('Triggered all enabled mirror profiles.');
        }));
        menu.addMenuItem(this._createSimpleActionItem('Pause all', async () => {
            await invokeHelperVoidMethod('PauseAll');
            this._notify('Paused all enabled mirror profiles.');
        }));
        menu.addMenuItem(this._createSimpleActionItem('Resume all', async () => {
            await invokeHelperVoidMethod('ResumeAll');
            this._notify('Resumed mirror profiles.');
        }));
        menu.addMenuItem(this._createSimpleActionItem('Open Preferences', async () => {
            this.openPreferences();
        }));
        menu.addMenuItem(this._createSimpleActionItem('Open Logs', async () => {
            openPath(getLogDir());
        }));
        menu.addMenuItem(this._createSimpleActionItem('Restart Helper', async () => {
            await invokeHelperVoidMethod('RestartHelper');
            this._notify('Requested helper restart.');
        }));

        if (this._snapshot.profiles.length > 0)
            menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

        if (this._snapshot.profiles.length === 0) {
            const emptyItem = new PopupMenu.PopupMenuItem('No profiles configured yet.', {reactive: false});
            emptyItem.setSensitive(false);
            menu.addMenuItem(emptyItem);
            return;
        }

        for (const profile of this._snapshot.profiles)
            menu.addMenuItem(this._createProfileItem(profile));
    }

    _createHeaderItem() {
        const item = new PopupMenu.PopupBaseMenuItem({
            reactive: false,
            can_focus: false,
        });

        const box = new St.BoxLayout({
            vertical: true,
            x_expand: true,
            style_class: 'fm-summary-box',
        });
        item.add_child(box);

        box.add_child(new St.Label({
            text: EXTENSION_TITLE,
            style_class: 'fm-summary-title',
            x_align: Clutter.ActorAlign.START,
        }));

        box.add_child(new St.Label({
            text: buildHelperStateLabel(this._snapshot),
            style_class: 'fm-summary-subtitle',
            x_align: Clutter.ActorAlign.START,
        }));

        box.add_child(new St.Label({
            text: buildSnapshotSummary(this._snapshot),
            style_class: 'fm-summary-note',
            x_align: Clutter.ActorAlign.START,
        }));

        if (this._snapshot.recentErrors[0]) {
            box.add_child(new St.Label({
                text: this._snapshot.recentErrors[0],
                style_class: 'fm-summary-note fm-status-error',
                x_align: Clutter.ActorAlign.START,
            }));
        }

        return item;
    }

    _createSimpleActionItem(label, action) {
        const item = new PopupMenu.PopupMenuItem(label);
        item.connect('activate', () => {
            Promise.resolve(action()).catch(error => {
                this._notify(error.message, true);
            });
        });
        return item;
    }

    _createActionButton(iconName, label, action) {
        const button = new St.Button({
            style_class: 'fm-action-button',
            can_focus: true,
            reactive: true,
            track_hover: true,
        });
        const content = new St.BoxLayout({
            style_class: 'fm-action-content',
            y_align: Clutter.ActorAlign.CENTER,
        });
        content.add_child(new St.Icon({
            icon_name: iconName,
            style_class: 'popup-menu-icon',
        }));
        content.add_child(new St.Label({
            text: label,
            style_class: 'fm-action-label',
            y_align: Clutter.ActorAlign.CENTER,
        }));
        button.set_child(content);
        button.connect('clicked', () => {
            Promise.resolve(action()).catch(error => {
                this._notify(error.message, true);
            });
        });
        return button;
    }

    _createPathButton(label, path) {
        const button = new St.Button({
            style_class: 'fm-path-button',
            can_focus: true,
            reactive: true,
            track_hover: true,
        });
        button.set_child(new St.Label({
            text: label,
            y_align: Clutter.ActorAlign.CENTER,
        }));
        button.connect('clicked', () => {
            try {
                openPath(path);
            } catch (error) {
                this._notify(error.message, true);
            }
        });
        return button;
    }

    _createProfileItem(profile) {
        const item = new PopupMenu.PopupBaseMenuItem({
            reactive: false,
            can_focus: false,
        });

        const row = new St.BoxLayout({
            x_expand: true,
            style_class: 'fm-profile-row',
        });
        item.add_child(row);

        const textBox = new St.BoxLayout({
            vertical: true,
            x_expand: true,
            style_class: 'fm-profile-text',
        });
        row.add_child(textBox);

        textBox.add_child(new St.Label({
            text: profile.name,
            style_class: 'fm-profile-title',
            x_align: Clutter.ActorAlign.START,
        }));

        const statusClass = profile.status === 'error' || profile.status === 'conflict'
            ? 'fm-profile-subtitle fm-status-error'
            : profile.status === 'paused'
                ? 'fm-profile-subtitle fm-status-warning'
                : 'fm-profile-subtitle';
        textBox.add_child(new St.Label({
            text: buildStatusLabel(profile),
            style_class: statusClass,
            x_align: Clutter.ActorAlign.START,
        }));

        textBox.add_child(new St.Label({
            text: formatProfileLocation(profile),
            style_class: 'fm-profile-path',
            x_align: Clutter.ActorAlign.START,
        }));

        const actions = new St.BoxLayout({
            style_class: 'fm-profile-actions',
            x_align: Clutter.ActorAlign.END,
        });
        row.add_child(actions);

        actions.add_child(this._createActionButton(
            'media-playback-start-symbolic',
            'Run now',
            async () => {
                await invokeHelperVoidMethod('RunProfile', new GLib.Variant('(s)', [profile.id]));
                this._notify(`Triggered ${profile.name}.`);
            }
        ));

        if (profile.status === 'paused') {
            actions.add_child(this._createActionButton(
                'media-playback-start-symbolic',
                'Resume',
                async () => {
                    await invokeHelperVoidMethod('ResumeProfile', new GLib.Variant('(s)', [profile.id]));
                    this._notify(`Resumed ${profile.name}.`);
                }
            ));
        } else {
            actions.add_child(this._createActionButton(
                'media-playback-pause-symbolic',
                'Pause',
                async () => {
                    await invokeHelperVoidMethod('PauseProfile', new GLib.Variant('(s)', [profile.id]));
                    this._notify(`Paused ${profile.name}.`);
                }
            ));
        }

        if (profile.sourcePath)
            actions.add_child(this._createPathButton('Src', profile.sourcePath));
        if (profile.targetPath)
            actions.add_child(this._createPathButton('Dst', profile.targetPath));

        return item;
    }
}
