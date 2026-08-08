import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import Clutter from 'gi://Clutter';
import Meta from 'gi://Meta';
import Shell from 'gi://Shell';
import St from 'gi://St';

import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';

import {
    DISPLAY_CONFIG_IFACE, DISPLAY_CONFIG_PATH, GET_STATE_REPLY_TYPE,
    APPLY_METHOD_PERSISTENT,
    renderedSize,
    loadLayouts, saveLayouts,
    parseLogicals, parseMonitors,
} from './shared.js';

// ── Visual constants ─────────────────────────────────────────────────────────
const CARD_WIDTH = 110;
const CARD_HEIGHT = 70;
const CURRENT_PREVIEW_WIDTH = 180;
const CURRENT_PREVIEW_HEIGHT = 100;
const PREVIEW_PADDING = 6;
const MONITOR_GAP = 2;
const RECENT_LAYOUTS_LIMIT = 2;
const TOGGLE_LAST_TWO_LAYOUTS_KEY = 'toggle-last-two-layouts';
const HISTORY_TRANSITION_TIMEOUT_US = 5 * 1000 * 1000;
const SWITCHER_CYCLE_DEDUP_WINDOW_US = 100 * 1000;
const SWITCHER_SUPER_RELEASE_POLL_MS = 50;
const SWITCHER_HINT_TEXT =
    'F7 / ← / → cycle • Shift+F7 / ↑ / ↓ reverse • release Super or Enter apply • Esc cancel';
const SUPER_MODIFIER_MASK =
    (Clutter.ModifierType.SUPER_MASK ?? 0) |
    (Clutter.ModifierType.MOD4_MASK ?? 0);
const PANEL_MENU_ALIGNMENT = 0.5;

// ── DBus: get current monitor state (async) ─────────────────────────────────
async function getCurrentState() {
    const result = await Gio.DBus.session.call(
        DISPLAY_CONFIG_IFACE, DISPLAY_CONFIG_PATH, DISPLAY_CONFIG_IFACE,
        'GetCurrentState', null, GET_STATE_REPLY_TYPE,
        Gio.DBusCallFlags.NONE, 5000, null);

    const serial = result.get_child_value(0).get_uint32();
    const monitorsVariant = result.get_child_value(1);
    const logicalsVariant = result.get_child_value(2);

    const connLogical = parseLogicals(logicalsVariant);
    const {monitors: monArray, activeExternals} =
        parseMonitors(monitorsVariant, connLogical);

    // extension.js uses a Map keyed by connector for quick lookups
    const monitors = new Map();
    for (const m of monArray)
        monitors.set(m.connector, m);

    return {serial, monitors, activeExternals};
}

// ── DBus: apply monitor config (async) ───────────────────────────────────────
async function applyConfig(serial, logicalMonitors) {
    const params = new GLib.Variant('(uua(iiduba(ssa{sv}))a{sv})', [
        serial,
        APPLY_METHOD_PERSISTENT,
        logicalMonitors,
        {},
    ]);
    await Gio.DBus.session.call(
        DISPLAY_CONFIG_IFACE, DISPLAY_CONFIG_PATH, DISPLAY_CONFIG_IFACE,
        'ApplyMonitorsConfig', params, null,
        Gio.DBusCallFlags.NONE, 5000, null);
}

function makeLogicalMonitor(x, y, scale, transform, isPrimary, connector, mode) {
    return [x, y, scale, transform, isPrimary, [[connector, mode, {}]]];
}

function estimatePreviewWidth(labelText) {
    return Math.max(CARD_WIDTH, Math.min(240, 18 + String(labelText).length * 7));
}

// ── Layout card widget ───────────────────────────────────────────────────────

function createLayoutCard(layoutDef, isActive, onActivate) {
    const card = new St.Button({
        style_class: isActive
            ? 'mls-layout-card mls-layout-card-active'
            : 'mls-layout-card',
        x_align: Clutter.ActorAlign.CENTER,
        y_align: Clutter.ActorAlign.CENTER,
    });

    const box = new St.BoxLayout({
        vertical: true,
        x_align: Clutter.ActorAlign.CENTER,
        style_class: 'mls-layout-card-inner',
    });
    card.set_child(box);

    // Approximate the label width without querying theme nodes before staging.
    const label = new St.Label({
        text: layoutDef.name,
        style_class: 'mls-layout-label',
        x_align: Clutter.ActorAlign.CENTER,
    });
    const previewWidth = estimatePreviewWidth(layoutDef.name);

    // Preview area for monitor rectangles, sized to fit the label
    const preview = new St.Widget({
        style_class: 'mls-preview-area',
        width: previewWidth,
        height: CARD_HEIGHT,
    });
    box.add_child(preview);

    if (layoutDef.monitors && layoutDef.monitors.length > 0)
        drawMonitorPreview(preview, layoutDef.monitors, previewWidth, CARD_HEIGHT);

    box.add_child(label);

    card.connect('clicked', () => onActivate());
    return card;
}

function drawMonitorPreview(container, monitors, areaW, areaH) {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    const rects = monitors.map(mon => {
        const raw = renderedSize(mon.mode, mon.transform);
        const s = mon.scale || 1;
        const w = Math.round(raw.w / s);
        const h = Math.round(raw.h / s);
        minX = Math.min(minX, mon.x);
        minY = Math.min(minY, mon.y);
        maxX = Math.max(maxX, mon.x + w);
        maxY = Math.max(maxY, mon.y + h);
        return {x: mon.x, y: mon.y, w, h, isPrimary: mon.isPrimary};
    });

    const totalW = maxX - minX || 1;
    const totalH = maxY - minY || 1;
    const availW = areaW - PREVIEW_PADDING * 2;
    const availH = areaH - PREVIEW_PADDING * 2;
    const scale = Math.min(availW / totalW, availH / totalH);

    const scaledW = totalW * scale;
    const scaledH = totalH * scale;
    const offsetX = PREVIEW_PADDING + (availW - scaledW) / 2;
    const offsetY = PREVIEW_PADDING + (availH - scaledH) / 2;

    for (const r of rects) {
        const rx = offsetX + (r.x - minX) * scale;
        const ry = offsetY + (r.y - minY) * scale;
        const rw = Math.max(r.w * scale - MONITOR_GAP, 4);
        const rh = Math.max(r.h * scale - MONITOR_GAP, 4);

        const rect = new St.Widget({
            style_class: r.isPrimary
                ? 'mls-monitor-rect mls-monitor-primary'
                : 'mls-monitor-rect',
            width: Math.round(rw),
            height: Math.round(rh),
        });
        rect.set_position(Math.round(rx), Math.round(ry));
        container.add_child(rect);
    }
}

// ── Saved-layout helpers ─────────────────────────────────────────────────────

// Resolve saved connector names to current connector names.
// Falls back to matching by model when connector names change (e.g. after reboot).
function resolveConnectors(layoutMonitors, stateMonitors) {
    const map = new Map();
    const claimed = new Set();

    // First pass: exact connector match
    for (const lm of layoutMonitors) {
        if (stateMonitors.has(lm.connector)) {
            map.set(lm.connector, lm.connector);
            claimed.add(lm.connector);
        }
    }

    // Second pass: match remaining by model
    for (const lm of layoutMonitors) {
        if (map.has(lm.connector)) continue;
        for (const [conn, cur] of stateMonitors) {
            if (claimed.has(conn)) continue;
            if (cur.model && cur.model === lm.model) {
                map.set(lm.connector, conn);
                claimed.add(conn);
                break;
            }
        }
    }

    return map;
}

function currentMonitorsFromState(state) {
    const monitors = [];
    for (const [, m] of state.monitors) {
        if (!m.active) continue;
        monitors.push({
            connector: m.connector,
            mode: m.mode,
            transform: m.transform,
            scale: m.scale,
            x: m.x,
            y: m.y,
            isPrimary: m.isPrimary,
            model: m.model,
            isBuiltin: m.isBuiltin,
        });
    }
    return monitors;
}

async function snapshotCurrentLayout(name) {
    const state = await getCurrentState();
    const monitors = currentMonitorsFromState(state);
    return {id: `layout-${Date.now()}`, name, monitors};
}

function matchesCurrentState(layout, state) {
    if (!Array.isArray(layout.monitors)) return false;
    const activeConns = new Set();
    for (const [conn, m] of state.monitors) {
        if (m.active) activeConns.add(conn);
    }
    if (layout.monitors.length !== activeConns.size) return false;

    const connMap = resolveConnectors(layout.monitors, state.monitors);
    for (const lm of layout.monitors) {
        const resolved = connMap.get(lm.connector);
        if (!resolved) return false;
        const cur = state.monitors.get(resolved);
        if (!cur?.active) return false;
        if (cur.x !== lm.x || cur.y !== lm.y) return false;
        if (cur.transform !== lm.transform) return false;
    }
    return true;
}

function findMatchingLayout(layouts, state) {
    for (const layout of layouts) {
        if (matchesCurrentState(layout, state))
            return layout;
    }

    return null;
}

function findLayoutIndex(layouts, targetLayout) {
    if (!targetLayout)
        return -1;

    return layouts.findIndex(layout =>
        layout === targetLayout ||
        (layout.id && targetLayout.id && layout.id === targetLayout.id)
    );
}

function orderSwitcherLayouts(layouts, matchedLayout) {
    const orderedLayouts = [...layouts];
    const matchedIndex = findLayoutIndex(orderedLayouts, matchedLayout);
    if (matchedIndex <= 0)
        return orderedLayouts;

    const [currentLayout] = orderedLayouts.splice(matchedIndex, 1);
    orderedLayouts.unshift(currentLayout);
    return orderedLayouts;
}

function cycleIndex(index, total, direction) {
    if (total <= 0)
        return -1;
    if (index < 0)
        return direction >= 0 ? 0 : total - 1;

    return (index + direction + total) % total;
}

function getCycleDirectionFromState(modifierState = 0) {
    return modifierState & Clutter.ModifierType.SHIFT_MASK ? -1 : 1;
}

function getInitialSwitcherIndex(layouts, matchedLayout, direction = 1) {
    if (layouts.length === 0)
        return -1;

    const currentIndex = findLayoutIndex(layouts, matchedLayout);
    if (currentIndex < 0)
        return direction >= 0 ? 0 : layouts.length - 1;

    return cycleIndex(currentIndex, layouts.length, direction);
}

function getPrimaryMonitorRect() {
    return Main.layoutManager.primaryMonitor ?? {
        x: 0,
        y: 0,
        width: global.stage.width,
        height: global.stage.height,
    };
}

function isForwardSwitcherKey(keysym, modifierState = 0) {
    if (keysym === Clutter.KEY_F7)
        return getCycleDirectionFromState(modifierState) > 0;

    return keysym === Clutter.KEY_Right || keysym === Clutter.KEY_Down;
}

function isBackwardSwitcherKey(keysym, modifierState = 0) {
    if (keysym === Clutter.KEY_F7)
        return getCycleDirectionFromState(modifierState) < 0;

    return keysym === Clutter.KEY_Left || keysym === Clutter.KEY_Up;
}

function isSuperKey(keysym) {
    return keysym === Clutter.KEY_Super_L || keysym === Clutter.KEY_Super_R;
}

function findFallbackToggleTarget(layouts, matchedLayout) {
    if (!matchedLayout)
        return null;

    for (const layout of layouts) {
        if (layout !== matchedLayout)
            return layout;
    }

    return null;
}

function normalizeMonitorState(mon) {
    return {
        connector: mon.connector ?? '',
        model: mon.model ?? '',
        mode: mon.mode ?? '',
        transform: mon.transform ?? 0,
        scale: mon.scale ?? 1,
        x: mon.x ?? 0,
        y: mon.y ?? 0,
        isPrimary: !!mon.isPrimary,
        isBuiltin: !!mon.isBuiltin,
    };
}

function monitorSortKey(mon) {
    return [
        mon.connector,
        mon.model,
        mon.mode,
        String(mon.transform),
        String(mon.scale),
        String(mon.x),
        String(mon.y),
        mon.isPrimary ? '1' : '0',
        mon.isBuiltin ? '1' : '0',
    ].join('\u0000');
}

function monitorStateSignature(monitors) {
    const normalized = monitors
        .map(normalizeMonitorState)
        .sort((a, b) => monitorSortKey(a).localeCompare(monitorSortKey(b)));

    return JSON.stringify(normalized);
}

function cloneMonitors(monitors) {
    return monitors.map(mon => ({...mon}));
}

function createHistoryEntry(name, monitors) {
    if (!Array.isArray(monitors) || monitors.length === 0)
        return null;

    return {
        signature: monitorStateSignature(monitors),
        name: name ?? 'Current Layout',
        monitors: cloneMonitors(monitors),
    };
}

function historyEntryFromState(state, matchedLayout = null) {
    return createHistoryEntry(
        matchedLayout?.name ?? 'Current Layout',
        currentMonitorsFromState(state)
    );
}

function resolveLayoutMonitors(layoutMonitors, stateMonitors) {
    const connMap = resolveConnectors(layoutMonitors, stateMonitors);
    const resolvedMonitors = [];

    for (const lm of layoutMonitors) {
        const resolved = connMap.get(lm.connector);
        if (!resolved)
            return {error: `Monitor ${lm.connector} not connected`};

        const curMon = stateMonitors.get(resolved);
        if (!curMon)
            return {error: `Monitor ${lm.connector} not available`};

        resolvedMonitors.push({
            connector: resolved,
            mode: curMon.allModeIds.includes(lm.mode) ? lm.mode : curMon.mode,
            transform: lm.transform,
            scale: lm.scale,
            x: lm.x,
            y: lm.y,
            isPrimary: lm.isPrimary,
            model: curMon.model,
            isBuiltin: curMon.isBuiltin,
        });
    }

    return {monitors: resolvedMonitors};
}

// ── Extension class ──────────────────────────────────────────────────────────
export default class MonitorLayoutSwitcher extends Extension {
    enable() {
        this._settings = this.getSettings(
            'org.gnome.shell.extensions.monitor-layout-switcher');
        this._recentLayouts = [];
        this._toggleBusy = false;
        this._keybindingRegistered = false;
        this._pendingHistoryTarget = null;
        this._switcherOverlay = null;
        this._switcherModalGrab = null;
        this._switcherSuperReleaseWatchId = 0;
        this._switcherGrid = null;
        this._switcherCards = [];
        this._switcherLayouts = [];
        this._switcherSelectedIndex = -1;
        this._switcherMatchedLayout = null;
        this._switcherSelectedLabel = null;
        this._switcherOpening = false;
        this._switcherApplyInProgress = false;
        this._switcherLastCycleUs = 0;

        this._registerKeybindings();

        this._indicator = new PanelMenu.Button(
            PANEL_MENU_ALIGNMENT,
            this.metadata.name,
            false
        );
        const icon = new St.Icon({
            icon_name: 'preferences-desktop-display-symbolic',
            style_class: 'system-status-icon',
        });
        this._indicator.add_child(icon);

        Main.panel.addToStatusArea(this.uuid, this._indicator);

        // Defer menu build so Mutter is ready
        this._startupTimeout = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 1500,
            () => {
                this._startupTimeout = null;
                this._buildMenu().catch(e =>
                    console.error(`[MLS] deferred buildMenu: ${e.message}`));
                return GLib.SOURCE_REMOVE;
            });

        this._monitorChangedId = Gio.DBus.session.signal_subscribe(
            DISPLAY_CONFIG_IFACE, DISPLAY_CONFIG_IFACE,
            'MonitorsChanged', DISPLAY_CONFIG_PATH, null,
            Gio.DBusSignalFlags.NONE, () => this._onMonitorsChanged()
        );

        this._settingsChangedId = this._settings.connect('changed::layouts',
            () => {
                if (this._switcherOverlay)
                    this._destroyLayoutSwitcher();

                this._buildMenu().catch(e =>
                    console.error(`[MLS] settings rebuild: ${e.message}`));
            });
    }

    disable() {
        this._destroyLayoutSwitcher();
        if (this._monitorChangedId !== undefined) {
            Gio.DBus.session.signal_unsubscribe(this._monitorChangedId);
            this._monitorChangedId = undefined;
        }
        if (this._settingsChangedId) {
            this._settings.disconnect(this._settingsChangedId);
            this._settingsChangedId = null;
        }
        if (this._startupTimeout) {
            GLib.source_remove(this._startupTimeout);
            this._startupTimeout = null;
        }
        if (this._changeTimeout) {
            GLib.source_remove(this._changeTimeout);
            this._changeTimeout = null;
        }
        if (this._keybindingRegistered) {
            Main.wm.removeKeybinding(TOGGLE_LAST_TWO_LAYOUTS_KEY);
            this._keybindingRegistered = false;
        }
        this._recentLayouts = [];
        this._pendingHistoryTarget = null;
        this._switcherOpening = false;
        this._switcherApplyInProgress = false;
        this._toggleBusy = false;
        this._settings = null;
        this._indicator?.destroy();
        this._indicator = null;
    }

    _registerKeybindings() {
        try {
            Main.wm.addKeybinding(
                TOGGLE_LAST_TWO_LAYOUTS_KEY,
                this._settings,
                Meta.KeyBindingFlags.IGNORE_AUTOREPEAT,
                Shell.ActionMode.NORMAL,
                () => {
                    this._handleLayoutSwitcherShortcut().catch(e =>
                        console.error(`[MLS] switcher shortcut failed: ${e.message}`));
                }
            );
            this._keybindingRegistered = true;
        } catch (e) {
            console.error(`[MLS] addKeybinding failed: ${e.message}`);
        }
    }

    _getShortcutCycleDirection() {
        try {
            const [, , modifiers] = global.get_pointer();
            return getCycleDirectionFromState(modifiers);
        } catch {
            return 1;
        }
    }

    async _handleLayoutSwitcherShortcut() {
        if (this._switcherApplyInProgress)
            return;

        const direction = this._getShortcutCycleDirection();
        if (this._switcherOverlay) {
            this._cycleLayoutSelection(direction);
            return;
        }

        await this._showLayoutSwitcher(direction);
    }

    async _showLayoutSwitcher(direction = 1) {
        if (this._switcherOpening || this._switcherOverlay || this._switcherApplyInProgress)
            return;

        this._switcherOpening = true;

        try {
            const layouts = loadLayouts(this._settings);
            if (layouts.length === 0) {
                Main.notify('Monitor Layout',
                    'Save at least one monitor layout before switching');
                return;
            }

            this._indicator?.menu?.close();

            let matchedLayout = null;
            try {
                const state = await getCurrentState();
                matchedLayout = findMatchingLayout(layouts, state);
                this._rememberLayoutState(state, matchedLayout);
            } catch (e) {
                console.error(`[MLS] switcher state lookup failed: ${e.message}`);
            }

            this._switcherLayouts = orderSwitcherLayouts(layouts, matchedLayout);
            this._switcherMatchedLayout = matchedLayout;
            this._switcherSelectedIndex = getInitialSwitcherIndex(
                this._switcherLayouts,
                matchedLayout,
                direction
            );
            this._switcherLastCycleUs = 0;
            this._buildLayoutSwitcher();
        } finally {
            this._switcherOpening = false;
        }
    }

    _buildLayoutSwitcher() {
        if (this._switcherOverlay)
            this._destroyLayoutSwitcher();

        const stageWidth = global.stage.width;
        const stageHeight = global.stage.height;
        const monitor = getPrimaryMonitorRect();

        const overlay = new St.Widget({
            reactive: true,
            can_focus: true,
            x: 0,
            y: 0,
            width: stageWidth,
            height: stageHeight,
        });

        const backdrop = new St.Widget({
            style_class: 'mls-switcher-backdrop',
            reactive: true,
            x: 0,
            y: 0,
            width: stageWidth,
            height: stageHeight,
        });
        backdrop.connect('button-press-event', () => {
            this._cancelLayoutSwitcher();
            return Clutter.EVENT_STOP;
        });
        overlay.add_child(backdrop);

        const monitorBin = new St.Widget({
            x: monitor.x,
            y: monitor.y,
            width: monitor.width,
            height: monitor.height,
            layout_manager: new Clutter.BinLayout(),
        });

        const panel = new St.BoxLayout({
            vertical: true,
            style_class: 'mls-switcher-panel',
            x_align: Clutter.ActorAlign.CENTER,
            y_align: Clutter.ActorAlign.CENTER,
        });
        monitorBin.add_child(panel);
        overlay.add_child(monitorBin);

        const header = new St.BoxLayout({
            vertical: true,
            style_class: 'mls-switcher-header',
            x_align: Clutter.ActorAlign.CENTER,
        });
        panel.add_child(header);

        header.add_child(new St.Label({
            text: 'Monitor layouts',
            style_class: 'mls-switcher-title',
            x_align: Clutter.ActorAlign.CENTER,
        }));

        header.add_child(new St.Label({
            text: this._switcherMatchedLayout
                ? `Current: ${this._switcherMatchedLayout.name}`
                : 'Current: Unsaved layout',
            style_class: 'mls-switcher-subtitle',
            x_align: Clutter.ActorAlign.CENTER,
        }));

        const selectedLabel = new St.Label({
            text: '',
            style_class: 'mls-switcher-selection',
            x_align: Clutter.ActorAlign.CENTER,
        });
        panel.add_child(selectedLabel);

        const grid = new St.BoxLayout({
            style_class: 'mls-layout-grid mls-switcher-grid',
            x_align: Clutter.ActorAlign.CENTER,
            x_expand: true,
        });
        panel.add_child(grid);

        panel.add_child(new St.Label({
            text: SWITCHER_HINT_TEXT,
            style_class: 'mls-switcher-hint',
            x_align: Clutter.ActorAlign.CENTER,
        }));

        this._switcherOverlay = overlay;
        this._switcherGrid = grid;
        this._switcherSelectedLabel = selectedLabel;
        this._switcherCards = [];

        Main.uiGroup.add_child(overlay);

        const modalGrab = Main.pushModal(overlay, {
            actionMode: Shell.ActionMode.NORMAL,
        });
        if (modalGrab === null || modalGrab === false) {
            console.error('[MLS] pushModal failed for layout switcher');
            this._destroyLayoutSwitcher();
            Main.notify('Monitor Layout', 'Could not open the layout switcher');
            return;
        }

        this._switcherModalGrab = modalGrab;
        overlay.connect('key-press-event', (_actor, event) =>
            this._onLayoutSwitcherKeyPressEvent(event));
        overlay.connect('key-release-event', (_actor, event) =>
            this._onLayoutSwitcherKeyReleaseEvent(event));

        global.stage.set_key_focus(overlay);
        overlay.grab_key_focus();
        this._startSwitcherSuperReleaseWatch();
        this._renderLayoutSwitcherSelection();
    }

    _startSwitcherSuperReleaseWatch() {
        if (this._switcherSuperReleaseWatchId)
            return;

        this._switcherSuperReleaseWatchId = GLib.timeout_add(
            GLib.PRIORITY_DEFAULT,
            SWITCHER_SUPER_RELEASE_POLL_MS,
            () => {
                if (!this._switcherOverlay || this._switcherApplyInProgress) {
                    this._switcherSuperReleaseWatchId = 0;
                    return GLib.SOURCE_REMOVE;
                }

                let modifiers = 0;
                try {
                    [, , modifiers] = global.get_pointer();
                } catch {
                    modifiers = 0;
                }

                if (SUPER_MODIFIER_MASK !== 0 &&
                    (modifiers & SUPER_MODIFIER_MASK) === 0) {
                    this._switcherSuperReleaseWatchId = 0;
                    this._confirmLayoutSwitcherSelection().catch(e =>
                        console.error(`[MLS] switcher confirm failed: ${e.message}`));
                    return GLib.SOURCE_REMOVE;
                }

                return GLib.SOURCE_CONTINUE;
            }
        );
    }

    _renderLayoutSwitcherSelection() {
        if (!this._switcherGrid)
            return;

        let child = this._switcherGrid.get_first_child();
        while (child) {
            const next = child.get_next_sibling();
            this._switcherGrid.remove_child(child);
            child = next;
        }

        const selectedLayout = this._switcherLayouts[this._switcherSelectedIndex] ?? null;
        const selectedIsCurrent = !!(
            selectedLayout &&
            this._switcherMatchedLayout?.id &&
            selectedLayout.id === this._switcherMatchedLayout.id
        );
        let selectedLabelText = 'No saved layouts available';
        if (selectedLayout) {
            selectedLabelText = selectedIsCurrent
                ? `Release Super to keep ${selectedLayout.name}`
                : `Release Super to switch to ${selectedLayout.name}`;
        }
        if (this._switcherSelectedLabel) {
            this._switcherSelectedLabel.text = selectedLabelText;
        }

        this._switcherCards = this._switcherLayouts.map((layout, index) => {
            const card = createLayoutCard(layout, index === this._switcherSelectedIndex,
                () => {
                    this._switcherSelectedIndex = index;
                    this._renderLayoutSwitcherSelection();
                    this._confirmLayoutSwitcherSelection().catch(e =>
                        console.error(`[MLS] switcher click apply failed: ${e.message}`));
                });
            this._switcherGrid.add_child(card);
            return card;
        });
    }

    _cycleLayoutSelection(direction, eventTimeUs = GLib.get_monotonic_time()) {
        if (!this._switcherOverlay || this._switcherLayouts.length === 0)
            return;
        if (eventTimeUs - this._switcherLastCycleUs < SWITCHER_CYCLE_DEDUP_WINDOW_US)
            return;

        this._switcherLastCycleUs = eventTimeUs;
        this._switcherSelectedIndex = cycleIndex(
            this._switcherSelectedIndex,
            this._switcherLayouts.length,
            direction
        );
        this._renderLayoutSwitcherSelection();
    }

    async _confirmLayoutSwitcherSelection() {
        if (this._switcherApplyInProgress)
            return;

        const targetLayout = this._switcherLayouts[this._switcherSelectedIndex] ?? null;
        const matchedLayout = this._switcherMatchedLayout;

        this._switcherApplyInProgress = true;
        this._destroyLayoutSwitcher();

        try {
            if (!targetLayout)
                return;
            if (matchedLayout?.id && targetLayout.id === matchedLayout.id)
                return;

            await this._applyLayout(targetLayout, {
                successMessage: `Switched to ${targetLayout.name}`,
            });
        } finally {
            this._switcherApplyInProgress = false;
        }
    }

    _cancelLayoutSwitcher() {
        if (!this._switcherOverlay || this._switcherApplyInProgress)
            return;

        this._destroyLayoutSwitcher();
    }

    _destroyLayoutSwitcher() {
        if (this._switcherSuperReleaseWatchId) {
            GLib.source_remove(this._switcherSuperReleaseWatchId);
            this._switcherSuperReleaseWatchId = 0;
        }

        const overlay = this._switcherOverlay;
        if (this._switcherModalGrab?.dismiss) {
            this._switcherModalGrab.dismiss();
        } else if (this._switcherModalGrab && overlay) {
            try {
                Main.popModal(overlay);
            } catch (e) {
                console.error(`[MLS] popModal failed: ${e.message}`);
            }
        }
        this._switcherModalGrab = null;

        overlay?.destroy();
        this._switcherOverlay = null;
        this._switcherGrid = null;
        this._switcherCards = [];
        this._switcherLayouts = [];
        this._switcherSelectedIndex = -1;
        this._switcherMatchedLayout = null;
        this._switcherSelectedLabel = null;
        this._switcherLastCycleUs = 0;
    }

    _onLayoutSwitcherKeyPressEvent(event) {
        if (!this._switcherOverlay)
            return Clutter.EVENT_PROPAGATE;

        const keysym = event.get_key_symbol();
        const modifierState = event.get_state();

        if (keysym === Clutter.KEY_Right || keysym === Clutter.KEY_Down) {
            this._cycleLayoutSelection(1);
            return Clutter.EVENT_STOP;
        }
        if (keysym === Clutter.KEY_Left || keysym === Clutter.KEY_Up) {
            this._cycleLayoutSelection(-1);
            return Clutter.EVENT_STOP;
        }
        if (keysym === Clutter.KEY_Return ||
            keysym === Clutter.KEY_KP_Enter ||
            keysym === Clutter.KEY_space) {
            this._confirmLayoutSwitcherSelection().catch(e =>
                console.error(`[MLS] switcher confirm failed: ${e.message}`));
            return Clutter.EVENT_STOP;
        }
        if (keysym === Clutter.KEY_Escape) {
            this._cancelLayoutSwitcher();
            return Clutter.EVENT_STOP;
        }
        if (isBackwardSwitcherKey(keysym, modifierState) ||
            isForwardSwitcherKey(keysym, modifierState)) {
            // F7 cycling is handled by the existing keybinding callback.
            return Clutter.EVENT_STOP;
        }

        return Clutter.EVENT_PROPAGATE;
    }

    _onLayoutSwitcherKeyReleaseEvent(event) {
        if (!this._switcherOverlay)
            return Clutter.EVENT_PROPAGATE;

        if (isSuperKey(event.get_key_symbol())) {
            this._confirmLayoutSwitcherSelection().catch(e =>
                console.error(`[MLS] switcher confirm failed: ${e.message}`));
            return Clutter.EVENT_STOP;
        }

        return Clutter.EVENT_PROPAGATE;
    }

    _updateRecentLayouts(primaryEntry, secondaryEntry = null) {
        const next = [];

        for (const entry of [primaryEntry, secondaryEntry, ...(this._recentLayouts ?? [])]) {
            if (!entry)
                continue;
            if (next.some(item => item.signature === entry.signature))
                continue;

            next.push(entry);
            if (next.length >= RECENT_LAYOUTS_LIMIT)
                break;
        }

        this._recentLayouts = next;
    }

    _setPendingHistoryTarget(entry) {
        this._pendingHistoryTarget = entry
            ? {
                entry,
                expiresAtUs: GLib.get_monotonic_time() + HISTORY_TRANSITION_TIMEOUT_US,
            }
            : null;
    }

    _rememberLayoutState(state, matchedLayout = null) {
        let entry = historyEntryFromState(state, matchedLayout);
        if (!entry)
            return null;

        const pending = this._pendingHistoryTarget;
        if (pending) {
            if (GLib.get_monotonic_time() > pending.expiresAtUs) {
                this._pendingHistoryTarget = null;
            } else if (entry.signature === pending.entry.signature) {
                entry = pending.entry;
                this._pendingHistoryTarget = null;
            } else {
                return entry;
            }
        }

        this._updateRecentLayouts(entry);

        return entry;
    }

    async _toggleLastTwoLayouts() {
        if (this._toggleBusy)
            return;

        this._toggleBusy = true;

        try {
            const state = await getCurrentState();
            const layouts = loadLayouts(this._settings);
            const matchedLayout = findMatchingLayout(
                layouts,
                state
            );
            const currentEntry = this._rememberLayoutState(state, matchedLayout);

            let target = currentEntry
                ? this._recentLayouts.find(entry =>
                    entry.signature !== currentEntry.signature)
                : null;
            if (!target)
                target = findFallbackToggleTarget(layouts, matchedLayout);

            if (!target) {
                Main.notify('Monitor Layout',
                    'Use two different monitor layouts before toggling');
                return;
            }

            const successMessage = target.name === 'Current Layout'
                ? 'Switched to previous monitor layout'
                : `Switched to ${target.name}`;
            await this._applyLayout(target, {
                successMessage,
                historyPreviousEntry: currentEntry,
            });
        } catch (e) {
            console.error(`[MLS] toggle failed: ${e.message}`);
            Main.notify('Monitor Layout', `Error: ${e.message}`);
        } finally {
            this._toggleBusy = false;
        }
    }

    async _buildMenu() {
        this._buildSeq = (this._buildSeq ?? 0) + 1;
        const seq = this._buildSeq;
        const menu = this._indicator.menu;
        menu.removeAll();

        const layouts = loadLayouts(this._settings);
        let currentState = null;
        try { currentState = await getCurrentState(); }
        catch (e) {
            console.error(`[MLS] getCurrentState failed: ${e.message}`);
        }

        // A newer _buildMenu was started while we awaited — abort this one
        if (seq !== this._buildSeq) return;

        // ── Current layout section (top) ─────────────────────────────────
        const currentMonitors = currentState
            ? currentMonitorsFromState(currentState) : [];

        // Find if current state matches a saved layout
        const matchedLayout = currentState
            ? findMatchingLayout(layouts, currentState)
            : null;
        if (currentState)
            this._rememberLayoutState(currentState, matchedLayout);

        const currentItem = new PopupMenu.PopupBaseMenuItem({
            reactive: false, can_focus: false,
        });
        const currentBox = new St.BoxLayout({
            vertical: true,
            x_align: Clutter.ActorAlign.CENTER,
            x_expand: true,
            style_class: 'mls-current-section',
        });
        currentItem.add_child(currentBox);

        // Header row: "Current" label + save button (if unsaved)
        const headerRow = new St.BoxLayout({
            x_align: Clutter.ActorAlign.CENTER,
            x_expand: true,
            style_class: 'mls-current-header',
        });
        currentBox.add_child(headerRow);

        const currentLabel = new St.Label({
            text: matchedLayout ? matchedLayout.name : 'Current Layout',
            style_class: matchedLayout
                ? 'mls-current-title' : 'mls-current-title mls-current-unsaved',
            x_expand: true,
            x_align: Clutter.ActorAlign.CENTER,
            y_align: Clutter.ActorAlign.CENTER,
        });
        headerRow.add_child(currentLabel);

        if (!matchedLayout) {
            const saveIcon = new St.Button({
                style_class: 'mls-save-btn',
                child: new St.Icon({
                    icon_name: 'document-save-symbolic',
                    icon_size: 16,
                }),
            });
            saveIcon.connect('clicked', () => {
                menu.close();
                this._saveCurrentLayout();
            });
            headerRow.add_child(saveIcon);
        }

        // Current layout preview (larger)
        const currentPreview = new St.Widget({
            style_class: 'mls-preview-area mls-current-preview',
            width: CURRENT_PREVIEW_WIDTH,
            height: CURRENT_PREVIEW_HEIGHT,
        });
        currentBox.add_child(currentPreview);

        if (currentMonitors.length > 0)
            drawMonitorPreview(currentPreview, currentMonitors,
                CURRENT_PREVIEW_WIDTH, CURRENT_PREVIEW_HEIGHT);

        menu.addMenuItem(currentItem);

        // ── Saved layouts section ────────────────────────────────────────
        const otherLayouts = layouts.filter(l => l !== matchedLayout);
        if (otherLayouts.length > 0) {
            menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

            const gridItem = new PopupMenu.PopupBaseMenuItem({
                reactive: false, can_focus: false,
            });
            const grid = new St.BoxLayout({
                style_class: 'mls-layout-grid',
                x_align: Clutter.ActorAlign.CENTER,
                x_expand: true,
            });
            gridItem.add_child(grid);

            for (const layout of otherLayouts) {
                const card = createLayoutCard(layout, false, () => {
                    this._applyLayout(layout);
                });
                grid.add_child(card);
            }
            menu.addMenuItem(gridItem);
        }

        // ── Bottom actions ───────────────────────────────────────────────
        menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

        const actionsItem = new PopupMenu.PopupBaseMenuItem({
            reactive: false, can_focus: false,
        });
        const actionsBox = new St.BoxLayout({
            style_class: 'mls-actions-row',
            x_align: Clutter.ActorAlign.CENTER,
            x_expand: true,
        });
        actionsItem.add_child(actionsBox);

        // Edit Layouts
        const editBtnBox = new St.BoxLayout();
        editBtnBox.add_child(new St.Icon({
            icon_name: 'document-edit-symbolic', icon_size: 16}));
        editBtnBox.add_child(new St.Label({text: ' Edit Layouts\u2026',
            y_align: Clutter.ActorAlign.CENTER}));
        const editBtn = new St.Button({
            style_class: 'mls-action-btn',
            child: editBtnBox,
        });
        editBtn.connect('clicked', () => {
            menu.close();
            this.openPreferences();
        });
        actionsBox.add_child(editBtn);

        menu.addMenuItem(actionsItem);
    }

    async _saveCurrentLayout() {
        try {
            const layouts = loadLayouts(this._settings);
            const num = layouts.length + 1;
            const layout = await snapshotCurrentLayout(`Layout ${num}`);
            layouts.push(layout);
            saveLayouts(this._settings, layouts);
            Main.notify('Monitor Layout', `Saved "${layout.name}"`);
        } catch (e) {
            console.error(`[MLS] save failed: ${e.message}`);
            Main.notify('Monitor Layout', `Error: ${e.message}`);
        }
    }

    async _applyLayout(layout, options = {}) {
        const {
            successMessage = layout.name,
            historyPreviousEntry = null,
        } = options;

        if (!Array.isArray(layout.monitors) || layout.monitors.length === 0) {
            Main.notify('Monitor Layout', 'Layout has no monitors');
            return false;
        }

        let historyBeforeTarget = [...(this._recentLayouts ?? [])];

        try {
            this._setPendingHistoryTarget(null);
            const state = await getCurrentState();
            const previousMatchedLayout = findMatchingLayout(
                loadLayouts(this._settings),
                state
            );
            const previousEntry = historyPreviousEntry
                ?? this._rememberLayoutState(state, previousMatchedLayout);
            historyBeforeTarget = [...(this._recentLayouts ?? [])];

            const resolvedLayout = resolveLayoutMonitors(
                layout.monitors,
                state.monitors
            );
            if (resolvedLayout.error) {
                Main.notify('Monitor Layout', resolvedLayout.error);
                return false;
            }

            const targetEntry = createHistoryEntry(
                layout.name ?? 'Current Layout',
                resolvedLayout.monitors
            );
            this._setPendingHistoryTarget(targetEntry);
            this._updateRecentLayouts(targetEntry, previousEntry);

            const logicals = resolvedLayout.monitors.map(lm =>
                makeLogicalMonitor(
                    lm.x, lm.y, lm.scale, lm.transform,
                    lm.isPrimary, lm.connector, lm.mode
                )
            );

            await applyConfig(state.serial, logicals);
            if (successMessage)
                Main.notify('Monitor Layout', successMessage);
            return true;
        } catch (e) {
            this._setPendingHistoryTarget(null);
            this._recentLayouts = historyBeforeTarget;
            console.error(`[MLS] apply failed: ${e.message}`);
            Main.notify('Monitor Layout', `Error: ${e.message}`);
            return false;
        }
    }

    _onMonitorsChanged() {
        if (this._switcherOverlay)
            this._destroyLayoutSwitcher();

        if (this._changeTimeout) {
            GLib.source_remove(this._changeTimeout);
            this._changeTimeout = null;
        }
        this._changeTimeout = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 500,
            () => {
                this._changeTimeout = null;
                this._buildMenu().catch(e =>
                    console.error(`[MLS] hotplug rebuild: ${e.message}`));
                return GLib.SOURCE_REMOVE;
            });
    }
}
