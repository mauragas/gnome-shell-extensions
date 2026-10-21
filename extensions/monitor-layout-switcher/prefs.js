import Adw from 'gi://Adw';
import Gtk from 'gi://Gtk';
import Gio from 'gi://Gio';

import {ExtensionPreferences}
    from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

import {
    DISPLAY_CONFIG_IFACE, DISPLAY_CONFIG_PATH, GET_STATE_REPLY_TYPE,
    loadLayouts, saveLayouts,
    parseDisplayProperties, parseLogicals, parseMonitors,
} from './shared.js';

import {
    COMPATIBILITY,
    LAYOUT_MODE_PHYSICAL,
    createLayoutFromState,
    describeLayoutCompatibility,
    fitPreviewRects,
    layoutPreviewRects,
} from './lib/display-plan.js';

function readDisplayState() {
    try {
        const bus = Gio.bus_get_sync(Gio.BusType.SESSION, null);
        const result = bus.call_sync(
            DISPLAY_CONFIG_IFACE, DISPLAY_CONFIG_PATH, DISPLAY_CONFIG_IFACE,
            'GetCurrentState', null, GET_STATE_REPLY_TYPE,
            Gio.DBusCallFlags.NONE, -1, null
        );

        const connLogical = parseLogicals(result.get_child_value(2));
        const {monitors} =
            parseMonitors(result.get_child_value(1), connLogical);
        const capabilities = parseDisplayProperties(result.get_child_value(3));

        return {monitors, capabilities};
    } catch (e) {
        console.error(`[MLS prefs] readDisplayState: ${e.message}`);
        return null;
    }
}

function describeSession(capabilities) {
    if (!capabilities)
        return null;

    const renderer = capabilities.renderer === 'xrandr'
        ? 'X11 (Xorg)'
        : (capabilities.renderer === 'native'
            ? 'Wayland (native)'
            : (capabilities.renderer || 'Unknown'));

    return {
        renderer,
        scaling: capabilities.layoutMode === LAYOUT_MODE_PHYSICAL
            ? 'Global (physical layout)'
            : 'Per-monitor (logical layout)',
        fractional: capabilities.fractionalScaling ? 'Yes' : 'No',
        globalScale: capabilities.globalScaleRequired ? 'Yes' : 'No',
    };
}

// ── Layout preview drawing area ──────────────────────────────────────────────
const PREVIEW_WIDTH = 280;
const PREVIEW_HEIGHT = 160;
const PREVIEW_PAD = 12;
const MONITOR_GAP = 3;

function drawLayoutPreview(_da, cr, rects) {
    const prepared = fitPreviewRects(rects, PREVIEW_WIDTH, PREVIEW_HEIGHT, PREVIEW_PAD);

    for (const r of prepared) {
        const rw = Math.max(r.width - MONITOR_GAP, 8);
        const rh = Math.max(r.height - MONITOR_GAP, 8);

        // Fill
        if (r.isPrimary)
            cr.setSourceRGBA(0.47, 0.68, 0.93, 0.85);
        else
            cr.setSourceRGBA(0.7, 0.7, 0.7, 0.65);

        roundedRect(cr, r.x, r.y, rw, rh, 3);
        cr.fill();

        // Border
        cr.setSourceRGBA(0.4, 0.4, 0.4, 0.9);
        roundedRect(cr, r.x, r.y, rw, rh, 3);
        cr.stroke();

        // Label (model or connector)
        cr.setSourceRGBA(0.15, 0.15, 0.15, 0.9);
        cr.setFontSize(9);
        const label = r.label ?? '';
        const ext = cr.textExtents(label);
        if (ext.width < rw - 4) {
            cr.moveTo(r.x + (rw - ext.width) / 2,
                r.y + (rh + ext.height) / 2);
            cr.showText(label);
        }
    }
}

function roundedRect(cr, x, y, w, h, r) {
    cr.newSubPath();
    cr.arc(x + w - r, y + r, r, -Math.PI / 2, 0);
    cr.arc(x + w - r, y + h - r, r, 0, Math.PI / 2);
    cr.arc(x + r, y + h - r, r, Math.PI / 2, Math.PI);
    cr.arc(x + r, y + r, r, Math.PI, 3 * Math.PI / 2);
    cr.closePath();
}

// ── Preferences window ───────────────────────────────────────────────────────
export default class MonitorLayoutPreferences extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        const settings = this.getSettings(
            'org.gnome.shell.extensions.monitor-layout-switcher');

        window.set_default_size(500, 600);

        const page = new Adw.PreferencesPage({
            title: 'Layouts',
            icon_name: 'preferences-desktop-display-symbolic',
        });
        window.add(page);

        const displayState = readDisplayState();
        const session = describeSession(displayState?.capabilities);

        // ── Session group ────────────────────────────────────────────────
        const sessionGroup = new Adw.PreferencesGroup({
            title: 'Display Session',
            description: session
                ? 'Layouts are re-resolved for the capabilities of this session.'
                : 'Could not read the display configuration.',
        });
        page.add(sessionGroup);

        if (session) {
            const rows = [
                ['Renderer', session.renderer],
                ['Scaling', session.scaling],
                ['Fractional scaling', session.fractional],
                ['Global scale required', session.globalScale],
            ];
            for (const [title, value] of rows)
                sessionGroup.add(new Adw.ActionRow({title, subtitle: value}));
        }

        // ── Saved Layouts group ──────────────────────────────────────────
        const savedGroup = new Adw.PreferencesGroup({
            title: 'Saved Layouts',
            description: 'Click a layout to preview. Use the buttons to manage.',
        });
        page.add(savedGroup);

        // Preview drawing area
        const previewDa = new Gtk.DrawingArea({
            content_width: PREVIEW_WIDTH,
            content_height: PREVIEW_HEIGHT,
            halign: Gtk.Align.CENTER,
            margin_top: 8,
            margin_bottom: 8,
        });
        let selectedLayoutIdx = -1;
        const layouts = loadLayouts(settings);

        previewDa.set_draw_func((_da, cr) => {
            if (selectedLayoutIdx >= 0 && selectedLayoutIdx < layouts.length) {
                drawLayoutPreview(_da, cr,
                    layoutPreviewRects(layouts[selectedLayoutIdx]));
            }
        });
        savedGroup.add(previewDa);

        // Layout list
        const listBox = new Gtk.ListBox({
            selection_mode: Gtk.SelectionMode.SINGLE,
            css_classes: ['boxed-list'],
            margin_top: 4,
        });
        savedGroup.add(listBox);

        function rebuildList() {
            let child = listBox.get_first_child();
            while (child) {
                const next = child.get_next_sibling();
                listBox.remove(child);
                child = next;
            }
            layouts.length = 0;
            layouts.push(...loadLayouts(settings));
            // Re-read the session so compatibility badges reflect hotplug.
            const currentState = readDisplayState();
            for (let i = 0; i < layouts.length; i++) {
                const row = createLayoutRow(layouts[i], i, settings,
                    layouts, rebuildList, window, currentState);
                listBox.append(row);
            }
            if (layouts.length === 0) {
                selectedLayoutIdx = -1;
                previewDa.queue_draw();
            }
        }

        listBox.connect('row-selected', (_lb, row) => {
            if (!row) return;
            selectedLayoutIdx = row.get_index();
            previewDa.queue_draw();
        });

        rebuildList();
        if (layouts.length > 0) {
            selectedLayoutIdx = 0;
            listBox.select_row(listBox.get_row_at_index(0));
        }

        // ── Actions group ────────────────────────────────────────────────
        const actionsGroup = new Adw.PreferencesGroup({
            title: 'Actions',
        });
        page.add(actionsGroup);

        // Save current layout
        const saveRow = new Adw.ActionRow({
            title: 'Save Current Monitor Layout',
            subtitle: 'Snapshot the current monitor arrangement as a new layout',
            activatable: true,
        });
        saveRow.add_prefix(new Gtk.Image({
            icon_name: 'list-add-symbolic',
        }));
        saveRow.connect('activated', () => {
            const state = readDisplayState();
            if (!state || !state.monitors.some(monitor => monitor.active))
                return;

            const newLayout = createLayoutFromState(state, {
                name: `Layout ${layouts.length + 1}`,
            });
            const all = loadLayouts(settings);
            all.push(newLayout);
            saveLayouts(settings, all);
            rebuildList();
            selectedLayoutIdx = layouts.length - 1;
            listBox.select_row(listBox.get_row_at_index(selectedLayoutIdx));
        });
        actionsGroup.add(saveRow);
    }
}

function describeLayoutIdentity(layout) {
    const monitors = Array.isArray(layout.monitors) ? layout.monitors : [];

    return monitors.map(monitor => {
        const product = monitor.identity?.product;
        const connector = monitor.savedConnector ?? monitor.connector ?? '?';
        return product ? `${product} (${connector})` : connector;
    }).join(', ');
}

/**
 * Index of `layout` in the freshly loaded list.
 * Ids are preferred, but older or hand-edited layouts may have no id (or a
 * duplicated one), so fall back to the position the row was rendered at.
 */
function resolveLayoutIndex(layouts, layout, index) {
    if (layout?.id) {
        const byId = layouts.findIndex(item => item.id === layout.id);
        if (byId >= 0)
            return byId;
    }

    if (Number.isInteger(index) && index >= 0 && index < layouts.length)
        return index;

    return -1;
}

function describeLayoutStatus(layout, displayState) {
    const {status, label, details} =
        describeLayoutCompatibility(layout, displayState);

    switch (status) {
    case COMPATIBILITY.UNAVAILABLE:
        return {text: label, css: 'error', tooltip: details.join('\n')};
    case COMPATIBILITY.ADJUSTED:
        return {
            text: label,
            css: 'dim-label',
            tooltip: `Will be adjusted on this session: ${details.join(', ')}`,
        };
    case COMPATIBILITY.WARNING:
        return {text: label, css: 'dim-label', tooltip: details.join('\n')};
    case COMPATIBILITY.READY:
        return {text: label, css: 'success', tooltip: null};
    default:
        return {text: label, css: 'dim-label', tooltip: null};
    }
}

function createLayoutRow(layout, index, settings, layouts,
    rebuildList, window, displayState) {

    const monCount = layout.monitors ? layout.monitors.length : 0;
    const identity = describeLayoutIdentity(layout);

    const row = new Adw.ActionRow({
        title: layout.name,
        subtitle: `${monCount} monitor${monCount !== 1 ? 's' : ''}: ${identity}`,
    });

    const status = describeLayoutStatus(layout, displayState);
    const statusLabel = new Gtk.Label({
        label: status.text,
        valign: Gtk.Align.CENTER,
        css_classes: [status.css],
    });
    if (status.tooltip)
        statusLabel.set_tooltip_text(status.tooltip);
    row.add_suffix(statusLabel);

    // Rename button
    const renameBtn = new Gtk.Button({
        icon_name: 'document-edit-symbolic',
        valign: Gtk.Align.CENTER,
        css_classes: ['flat'],
        tooltip_text: 'Rename',
    });
    renameBtn.connect('clicked', () => {
        showRenameDialog(window, layout, index, settings, rebuildList);
    });
    row.add_suffix(renameBtn);

    // Delete button
    const deleteBtn = new Gtk.Button({
        icon_name: 'user-trash-symbolic',
        valign: Gtk.Align.CENTER,
        css_classes: ['destructive-action'],
        tooltip_text: 'Delete',
    });
    deleteBtn.connect('clicked', () => {
        const all = loadLayouts(settings);
        const targetIndex = resolveLayoutIndex(all, layout, index);
        if (targetIndex < 0)
            return;

        all.splice(targetIndex, 1);
        saveLayouts(settings, all);
        rebuildList();
    });
    row.add_suffix(deleteBtn);

    // Move up button
    if (index > 0) {
        const upBtn = new Gtk.Button({
            icon_name: 'go-up-symbolic',
            valign: Gtk.Align.CENTER,
            css_classes: ['flat'],
            tooltip_text: 'Move Up',
        });
        upBtn.connect('clicked', () => {
            const all = loadLayouts(settings);
            if (index > 0 && index < all.length) {
                [all[index - 1], all[index]] = [all[index], all[index - 1]];
                saveLayouts(settings, all);
                rebuildList();
            }
        });
        row.add_suffix(upBtn);
    }

    // Move down button
    if (index < layouts.length - 1) {
        const downBtn = new Gtk.Button({
            icon_name: 'go-down-symbolic',
            valign: Gtk.Align.CENTER,
            css_classes: ['flat'],
            tooltip_text: 'Move Down',
        });
        downBtn.connect('clicked', () => {
            const all = loadLayouts(settings);
            if (index >= 0 && index < all.length - 1) {
                [all[index], all[index + 1]] = [all[index + 1], all[index]];
                saveLayouts(settings, all);
                rebuildList();
            }
        });
        row.add_suffix(downBtn);
    }

    return row;
}

function showRenameDialog(parentWindow, layout, index, settings, rebuildList) {
    const dialog = new Adw.AlertDialog({
        heading: 'Rename Layout',
        body: 'Enter a new name for this layout.',
        close_response: 'cancel',
    });
    dialog.add_response('cancel', 'Cancel');
    dialog.add_response('rename', 'Rename');
    dialog.set_response_appearance('rename', Adw.ResponseAppearance.SUGGESTED);

    const entry = new Gtk.Entry({
        text: layout.name,
        activates_default: true,
        margin_start: 12,
        margin_end: 12,
    });
    dialog.set_extra_child(entry);
    dialog.set_default_response('rename');

    dialog.connect('response', (_dlg, response) => {
        if (response === 'rename') {
            const newName = entry.get_text().trim();
            if (newName) {
                const all = loadLayouts(settings);
                const targetIndex = resolveLayoutIndex(all, layout, index);
                if (targetIndex >= 0) {
                    all[targetIndex].name = newName;
                    saveLayouts(settings, all);
                    rebuildList();
                }
            }
        }
    });

    dialog.present(parentWindow);
}
