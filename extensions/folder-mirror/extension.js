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
    restartHelperService,
} from './shared.js';
import {
    buildSnapshot,
    deriveIndicatorState,
    parseSnapshot,
} from './lib/status-store.js';
import {buildProfileMenuActions, isProfileSyncing} from './lib/profile-actions.js';
import {summarizeMode} from './lib/validation.js';

const PANEL_MENU_ALIGNMENT = 0.5;
const SNAPSHOT_REFRESH_INTERVAL_MS = 30000;
const HELPER_RECOVERY_REFRESH_DELAY_MS = 1200;
const ACTION_REFRESH_DELAY_MS = 180;
const PROFILE_SYNC_ANIMATION_INTERVAL_MS = 180;

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
        this._helperRecoveryInFlight = false;
        this._delayedRefreshTimeoutId = 0;
        this._actionRefreshTimeoutId = 0;
        this._profileSyncAnimationFrame = 0;
        this._profileSyncAnimationTimeoutId = 0;
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
                if (!isOpen) {
                    this._stopProfileSyncAnimation();
                    return;
                }

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

        if (this._actionRefreshTimeoutId) {
            GLib.source_remove(this._actionRefreshTimeoutId);
            this._actionRefreshTimeoutId = 0;
        }

        if (this._delayedRefreshTimeoutId) {
            GLib.source_remove(this._delayedRefreshTimeoutId);
            this._delayedRefreshTimeoutId = 0;
        }

        this._stopProfileSyncAnimation();

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
        this._helperRecoveryInFlight = false;
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

        if (this._snapshot.helperState === 'running' || this._snapshot.helperState === 'starting') {
            this._helperRecoveryInFlight = false;
            return;
        }

        if (!this._settings?.get_boolean('auto-start-helper') || this._helperRecoveryInFlight)
            return;

        this._helperRecoveryInFlight = true;
        restartHelperService()
            .then(() => {
                this._scheduleDelayedSnapshotRefresh();
            })
            .catch(error => {
                this._helperRecoveryInFlight = false;
                console.error(`[FM] helper auto-recovery failed: ${error.message}`);
            });
    }

    _scheduleDelayedSnapshotRefresh(delayMs = HELPER_RECOVERY_REFRESH_DELAY_MS) {
        if (this._delayedRefreshTimeoutId) {
            GLib.source_remove(this._delayedRefreshTimeoutId);
            this._delayedRefreshTimeoutId = 0;
        }

        this._delayedRefreshTimeoutId = GLib.timeout_add(
            GLib.PRIORITY_DEFAULT,
            delayMs,
            () => {
                this._delayedRefreshTimeoutId = 0;
                this._refreshSnapshot().catch(error => {
                    this._helperRecoveryInFlight = false;
                    console.error(`[FM] delayed helper refresh failed: ${error.message}`);
                });
                return GLib.SOURCE_REMOVE;
            }
        );
    }

    _scheduleActionSnapshotRefresh(delayMs = ACTION_REFRESH_DELAY_MS) {
        if (this._actionRefreshTimeoutId) {
            GLib.source_remove(this._actionRefreshTimeoutId);
            this._actionRefreshTimeoutId = 0;
        }

        this._actionRefreshTimeoutId = GLib.timeout_add(
            GLib.PRIORITY_DEFAULT,
            delayMs,
            () => {
                this._actionRefreshTimeoutId = 0;
                this._refreshSnapshot().catch(error => {
                    console.error(`[FM] action refresh failed: ${error.message}`);
                });
                return GLib.SOURCE_REMOVE;
            }
        );
    }

    _hasSyncingProfiles() {
        return this._snapshot.profiles.some(profile => isProfileSyncing(profile));
    }

    _syncProfileSyncAnimationState() {
        const shouldAnimate = Boolean(this._indicator?.menu?.isOpen) && this._hasSyncingProfiles();
        if (!shouldAnimate) {
            this._stopProfileSyncAnimation();
            return;
        }

        if (this._profileSyncAnimationTimeoutId)
            return;

        this._profileSyncAnimationTimeoutId = GLib.timeout_add(
            GLib.PRIORITY_DEFAULT,
            PROFILE_SYNC_ANIMATION_INTERVAL_MS,
            () => {
                if (!this._indicator?.menu?.isOpen || !this._hasSyncingProfiles()) {
                    this._stopProfileSyncAnimation();
                    return GLib.SOURCE_REMOVE;
                }

                this._profileSyncAnimationFrame = (this._profileSyncAnimationFrame + 1) % 4;
                this._rebuildMenu();
                return GLib.SOURCE_CONTINUE;
            }
        );
    }

    _stopProfileSyncAnimation() {
        if (this._profileSyncAnimationTimeoutId) {
            GLib.source_remove(this._profileSyncAnimationTimeoutId);
            this._profileSyncAnimationTimeoutId = 0;
        }

        this._profileSyncAnimationFrame = 0;
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

        menu.addMenuItem(this._createGlobalActionsItem());

        if (this._snapshot.profiles.length > 0)
            menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

        if (this._snapshot.profiles.length === 0) {
            const emptyItem = new PopupMenu.PopupMenuItem('No profiles configured yet.', {reactive: false});
            emptyItem.setSensitive(false);
            menu.addMenuItem(emptyItem);
            this._syncProfileSyncAnimationState();
            return;
        }

        for (const profile of this._snapshot.profiles)
            menu.addMenuItem(this._createProfileItem(profile));

        this._syncProfileSyncAnimationState();
    }

    _createGlobalActionsItem() {
        const item = new PopupMenu.PopupBaseMenuItem({
            reactive: false,
            can_focus: false,
        });

        const layoutManager = new Clutter.GridLayout({
            orientation: Clutter.Orientation.VERTICAL,
            column_spacing: 8,
            row_spacing: 8,
        });
        layoutManager.column_homogeneous = true;

        const container = new St.Widget({
            layout_manager: layoutManager,
            x_expand: true,
            style_class: 'fm-global-actions',
        });
        item.add_child(container);

        const profileCount = this._snapshot.profiles.length;
        const pausedCount = this._snapshot.counts.paused;
        const activeCount = Math.max(0, profileCount - pausedCount);
        const errorCount = this._snapshot.counts.error;
        const canControlProfiles = profileCount > 0 && this._snapshot.helperState === 'running';
        const canResume = canControlProfiles && pausedCount > 0;
        const canPause = canControlProfiles && activeCount > 0;
        const runSubtitle = profileCount === 0
            ? 'No profiles'
            : `${this._snapshot.counts.healthy} healthy`;
        const pauseSubtitle = profileCount === 0
            ? 'No profiles'
            : pausedCount === profileCount
                ? 'All paused'
                : `${activeCount} active`;
        const resumeSubtitle = pausedCount > 0
            ? `${pausedCount} paused`
            : 'None paused';
        const profilesSubtitle = profileCount === 1
            ? '1 profile'
            : `${profileCount} profiles`;
        const logsSubtitle = errorCount > 0
            ? `${errorCount} need attention`
            : 'No errors';
        const helperSubtitle = buildHelperStateLabel(this._snapshot);
        const helperRunning = this._snapshot.helperState === 'running' || this._snapshot.helperState === 'starting';
        const helperActionLabel = helperRunning
            ? 'Restart'
            : 'Start helper';

        const actions = [
            this._createGlobalActionButton(
                'media-playback-start-symbolic',
                'Run all',
                runSubtitle,
                async () => {
                    await invokeHelperVoidMethod('RunAll');
                    this._notify('Triggered all enabled mirror profiles.');
                },
                {
                    enabled: canControlProfiles,
                }
            ),
            this._createGlobalActionButton(
                'media-playback-pause-symbolic',
                'Pause all',
                pauseSubtitle,
                async () => {
                    await invokeHelperVoidMethod('PauseAll');
                    this._notify('Paused all enabled mirror profiles.');
                },
                {
                    enabled: canPause,
                }
            ),
            this._createGlobalActionButton(
                'media-playback-start-symbolic',
                'Resume all',
                resumeSubtitle,
                async () => {
                    await invokeHelperVoidMethod('ResumeAll');
                    this._notify('Resumed mirror profiles.');
                },
                {
                    enabled: canResume,
                }
            ),
            this._createGlobalActionButton(
                'emblem-system-symbolic',
                'Preferences',
                profilesSubtitle,
                async () => {
                    this.openPreferences();
                },
                {}
            ),
            this._createGlobalActionButton(
                'text-x-log-symbolic',
                'Logs',
                logsSubtitle,
                async () => {
                    openPath(getLogDir());
                },
                {
                    warning: errorCount > 0,
                }
            ),
            this._createGlobalActionButton(
                'view-refresh-symbolic',
                helperActionLabel,
                helperSubtitle,
                async () => {
                    let usedSystemctlFallback = false;
                    try {
                        if (helperRunning)
                            await invokeHelperVoidMethod('RestartHelper');
                        else
                            throw new Error('Helper is not currently advertising its D-Bus name.');
                    } catch {
                        await restartHelperService();
                        usedSystemctlFallback = true;
                    }

                    this._notify(
                        usedSystemctlFallback
                            ? 'Requested helper service restart.'
                            : 'Requested helper restart.'
                    );
                    this._scheduleDelayedSnapshotRefresh();
                },
                {
                    warning: this._snapshot.helperState !== 'running',
                }
            ),
        ];

        actions.forEach((button, index) => {
            layoutManager.attach(button, index % 3, Math.floor(index / 3), 1, 1);
        });

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

    _createActionButton(iconName, label, action, options = {}) {
        const normalizedOptions = typeof options === 'string'
            ? {styleClass: options}
            : options;
        const {
            styleClass = 'fm-action-button',
            expand = false,
            centerContent = false,
            enabled = true,
        } = normalizedOptions;
        const button = new St.Button({
            style_class: styleClass,
            can_focus: enabled,
            reactive: enabled,
            track_hover: enabled,
            x_expand: expand,
        });
        button.opacity = enabled ? 255 : 150;
        const content = new St.BoxLayout({
            style_class: 'fm-action-content',
            x_expand: !centerContent,
            x_align: centerContent
                ? Clutter.ActorAlign.CENTER
                : Clutter.ActorAlign.FILL,
            y_align: Clutter.ActorAlign.CENTER,
        });
        content.add_child(new St.Icon({
            icon_name: iconName,
            style_class: 'popup-menu-icon',
        }));
        content.add_child(new St.Label({
            text: label,
            style_class: 'fm-action-label',
            x_expand: !centerContent,
            x_align: centerContent
                ? Clutter.ActorAlign.CENTER
                : Clutter.ActorAlign.FILL,
            y_align: Clutter.ActorAlign.CENTER,
        }));
        button.set_child(content);
        if (enabled) {
            button.connect('clicked', () => {
                Promise.resolve(action()).catch(error => {
                    this._notify(error.message, true);
                });
            });
        }
        return button;
    }

    _createGlobalActionButton(iconName, label, subtitle, action, {
        enabled = true,
        warning = false,
    } = {}) {
        const button = new St.Button({
            style_class: warning
                ? 'fm-global-action-button fm-global-action-button-warning'
                : 'fm-global-action-button',
            can_focus: enabled,
            reactive: enabled,
            track_hover: enabled,
            x_expand: true,
        });
        button.opacity = enabled ? 255 : 150;

        const content = new St.BoxLayout({
            vertical: true,
            x_expand: true,
            x_align: Clutter.ActorAlign.CENTER,
            y_align: Clutter.ActorAlign.CENTER,
            style_class: 'fm-global-action-content',
        });

        const titleRow = new St.BoxLayout({
            x_align: Clutter.ActorAlign.CENTER,
            y_align: Clutter.ActorAlign.CENTER,
            style_class: 'fm-global-action-title-row',
        });
        titleRow.add_child(new St.Icon({
            icon_name: iconName,
            style_class: 'popup-menu-icon',
        }));
        titleRow.add_child(new St.Label({
            text: label,
            style_class: 'fm-global-action-label',
            y_align: Clutter.ActorAlign.CENTER,
        }));
        content.add_child(titleRow);

        content.add_child(new St.Label({
            text: subtitle,
            style_class: 'fm-global-action-subtitle',
            x_align: Clutter.ActorAlign.CENTER,
            y_align: Clutter.ActorAlign.CENTER,
        }));

        button.set_child(content);
        if (enabled) {
            button.connect('clicked', () => {
                Promise.resolve(action()).catch(error => {
                    this._notify(error.message, true);
                });
            });
        }

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

    _createProfileMethodButton(profile, actionDefinition) {
        return this._createActionButton(
            actionDefinition.iconName,
            actionDefinition.label,
            async () => {
                await invokeHelperVoidMethod(
                    actionDefinition.methodName,
                    new GLib.Variant('(s)', [profile.id])
                );
                this._scheduleActionSnapshotRefresh();
                this._notify(actionDefinition.notification);
            },
            {
                enabled: actionDefinition.enabled !== false,
            }
        );
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

        const {syncAction, controlAction} = buildProfileMenuActions(profile, {
            syncAnimationFrame: this._profileSyncAnimationFrame,
        });
        actions.add_child(this._createProfileMethodButton(profile, syncAction));
        actions.add_child(this._createProfileMethodButton(profile, controlAction));

        if (profile.sourcePath)
            actions.add_child(this._createPathButton('Src', profile.sourcePath));
        if (profile.targetPath)
            actions.add_child(this._createPathButton('Dst', profile.targetPath));

        return item;
    }
}
