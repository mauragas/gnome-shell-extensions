import Adw from 'gi://Adw';
import Gtk from 'gi://Gtk';
import Gio from 'gi://Gio';

import {ExtensionPreferences}
    from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

import {
    DISPLAY_CONFIG_IFACE, DISPLAY_CONFIG_PATH, GET_STATE_REPLY_TYPE,
    renderedSize, variantLookup,
    loadLayouts, saveLayouts,
    parseLogicals, parseMonitors,
} from './shared.js';

function getCurrentConnectedMonitors() {
    try {
        const bus = Gio.bus_get_sync(Gio.BusType.SESSION, null);
        const result = bus.call_sync(
            DISPLAY_CONFIG_IFACE, DISPLAY_CONFIG_PATH, DISPLAY_CONFIG_IFACE,
            'GetCurrentState', null, GET_STATE_REPLY_TYPE,
            Gio.DBusCallFlags.NONE, -1, null
        );

        const monitorsVariant = result.get_child_value(1);
        const logicalsVariant = result.get_child_value(2);

        const connLogical = parseLogicals(logicalsVariant);
        const {monitors} = parseMonitors(monitorsVariant, connLogical);
        return monitors;
    } catch (e) {
        console.error(`[MLS prefs] getCurrentConnectedMonitors: ${e.message}`);
        return [];
    }
}


// ── Layout preview drawing area ──────────────────────────────────────────────
const PREVIEW_WIDTH = 280;
const PREVIEW_HEIGHT = 160;
const PREVIEW_PAD = 12;
const MONITOR_GAP = 3;

function drawLayoutPreview(da, cr, monitors) {
    if (!monitors || monitors.length === 0) return;

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
        return {x: mon.x, y: mon.y, w, h, isPrimary: mon.isPrimary,
            connector: mon.connector, model: mon.model};
    });

    const totalW = maxX - minX || 1;
    const totalH = maxY - minY || 1;
    const availW = PREVIEW_WIDTH - PREVIEW_PAD * 2;
    const availH = PREVIEW_HEIGHT - PREVIEW_PAD * 2;
    const scale = Math.min(availW / totalW, availH / totalH);

    const scaledW = totalW * scale;
    const scaledH = totalH * scale;
    const offsetX = PREVIEW_PAD + (availW - scaledW) / 2;
    const offsetY = PREVIEW_PAD + (availH - scaledH) / 2;

    for (const r of rects) {
        const rx = offsetX + (r.x - minX) * scale;
        const ry = offsetY + (r.y - minY) * scale;
        const rw = Math.max(r.w * scale - MONITOR_GAP, 8);
        const rh = Math.max(r.h * scale - MONITOR_GAP, 8);

        // Fill
        if (r.isPrimary)
            cr.setSourceRGBA(0.47, 0.68, 0.93, 0.85);
        else
            cr.setSourceRGBA(0.7, 0.7, 0.7, 0.65);

        roundedRect(cr, rx, ry, rw, rh, 3);
        cr.fill();

        // Border
        cr.setSourceRGBA(0.4, 0.4, 0.4, 0.9);
        roundedRect(cr, rx, ry, rw, rh, 3);
        cr.stroke();

        // Label (connector or model)
        cr.setSourceRGBA(0.15, 0.15, 0.15, 0.9);
        cr.setFontSize(9);
        const label = r.model || r.connector;
        const ext = cr.textExtents(label);
        if (ext.width < rw - 4) {
            cr.moveTo(rx + (rw - ext.width) / 2,
                ry + (rh + ext.height) / 2);
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
            if (selectedLayoutIdx >= 0 && selectedLayoutIdx < layouts.length)
                drawLayoutPreview(_da, cr, layouts[selectedLayoutIdx].monitors);
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
            for (let i = 0; i < layouts.length; i++) {
                const row = createLayoutRow(layouts[i], i, settings,
                    layouts, rebuildList, previewDa, window);
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
            const connectedMons = getCurrentConnectedMonitors();
            const activeMons = connectedMons.filter(m => m.active);
            if (activeMons.length === 0) return;

            const num = layouts.length + 1;
            const newLayout = {
                id: `layout-${Date.now()}`,
                name: `Layout ${num}`,
                monitors: activeMons.map(m => ({
                    connector: m.connector,
                    mode: m.mode,
                    transform: m.transform,
                    scale: m.scale,
                    x: m.x,
                    y: m.y,
                    isPrimary: m.isPrimary,
                    model: m.model,
                    isBuiltin: m.isBuiltin,
                })),
            };
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

function createLayoutRow(layout, index, settings, layouts,
    rebuildList, previewDa, window) {

    const monCount = layout.monitors ? layout.monitors.length : 0;
    const connectors = layout.monitors
        ? layout.monitors.map(m => m.connector).join(', ')
        : '';

    const row = new Adw.ActionRow({
        title: layout.name,
        subtitle: `${monCount} monitor${monCount !== 1 ? 's' : ''}: ${connectors}`,
    });

    // Rename button
    const renameBtn = new Gtk.Button({
        icon_name: 'document-edit-symbolic',
        valign: Gtk.Align.CENTER,
        css_classes: ['flat'],
        tooltip_text: 'Rename',
    });
    renameBtn.connect('clicked', () => {
        showRenameDialog(window, layout, settings, layouts, rebuildList);
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
        const filtered = all.filter(l => l.id !== layout.id);
        saveLayouts(settings, filtered);
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

function showRenameDialog(parentWindow, layout, settings, layouts, rebuildList) {
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
                const target = all.find(l => l.id === layout.id);
                if (target) {
                    target.name = newName;
                    saveLayouts(settings, all);
                    rebuildList();
                }
            }
        }
    });

    dialog.present(parentWindow);
}
