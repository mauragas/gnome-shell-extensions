import GLib from 'gi://GLib';
import Gio from 'gi://Gio';

// ── DBus constants ───────────────────────────────────────────────────────────
export const DISPLAY_CONFIG_IFACE = 'org.gnome.Mutter.DisplayConfig';
export const DISPLAY_CONFIG_PATH = '/org/gnome/Mutter/DisplayConfig';
export const GET_STATE_REPLY_TYPE = new GLib.VariantType(
    '(ua((ssss)a(siiddada{sv})a{sv})a(iiduba(ssss)a{sv})a{sv})'
);

// ── ApplyMonitorsConfig method constants ─────────────────────────────────────
// 0 = VERIFY, 1 = TEMPORARY, 2 = PERSISTENT
export const APPLY_METHOD_PERSISTENT = 2;

// ── Utility ──────────────────────────────────────────────────────────────────
export function renderedSize(modeStr, transform) {
    const m = modeStr.match(/^(\d+)x(\d+)@/);
    let w = m ? parseInt(m[1], 10) : 1920;
    let h = m ? parseInt(m[2], 10) : 1080;
    if (transform === 1 || transform === 3)
        [w, h] = [h, w];
    return {w, h};
}

export function variantLookup(dictVariant, key) {
    for (let i = 0; i < dictVariant.n_children(); i++) {
        const entry = dictVariant.get_child_value(i);
        if (entry.get_child_value(0).get_string()[0] === key)
            return entry.get_child_value(1).get_variant();
    }
    return null;
}

// ── Settings helpers ─────────────────────────────────────────────────────────
export function loadLayouts(settings) {
    const raw = settings.get_string('layouts');
    if (!raw) return [];
    try {
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? parsed : [];
    } catch { return []; }
}

export function saveLayouts(settings, layouts) {
    settings.set_string('layouts', JSON.stringify(layouts));
}

// ── Monitor parsing from DBus variant ────────────────────────────────────────
export function parseLogicals(logicalsVariant) {
    const connLogical = new Map();
    for (let i = 0; i < logicalsVariant.n_children(); i++) {
        const lm = logicalsVariant.get_child_value(i);
        const x = lm.get_child_value(0).get_int32();
        const y = lm.get_child_value(1).get_int32();
        const scale = lm.get_child_value(2).get_double();
        const transform = lm.get_child_value(3).get_uint32();
        const isPrimary = lm.get_child_value(4).get_boolean();
        const assignedMons = lm.get_child_value(5);
        for (let j = 0; j < assignedMons.n_children(); j++) {
            const conn = assignedMons.get_child_value(j)
                .get_child_value(0).get_string()[0];
            connLogical.set(conn, {x, y, scale, transform, isPrimary});
        }
    }
    return connLogical;
}

export function parseMonitors(monitorsVariant, connLogical) {
    const monitors = [];
    let activeExternals = 0;

    for (let i = 0; i < monitorsVariant.n_children(); i++) {
        const mon = monitorsVariant.get_child_value(i);
        const ident = mon.get_child_value(0);
        const modes = mon.get_child_value(1);
        const mprops = mon.get_child_value(2);

        const connector = ident.get_child_value(0).get_string()[0];
        const vendor = ident.get_child_value(1).get_string()[0];
        const model = ident.get_child_value(2).get_string()[0];

        let isBuiltin = false;
        const builtinVal = variantLookup(mprops, 'is-builtin');
        if (builtinVal !== null)
            isBuiltin = builtinVal.get_boolean();

        let currentMode = null, preferredMode = null;
        const allModeIds = [];
        for (let mi = 0; mi < modes.n_children(); mi++) {
            const mode = modes.get_child_value(mi);
            const modeId = mode.get_child_value(0).get_string()[0];
            allModeIds.push(modeId);
            const mp = mode.get_child_value(6);
            const ic = variantLookup(mp, 'is-current');
            const ip = variantLookup(mp, 'is-preferred');
            if (ic && ic.get_boolean()) currentMode = modeId;
            if (ip && ip.get_boolean()) preferredMode = modeId;
        }

        const bestMode = currentMode ?? preferredMode ?? allModeIds[0];
        const inLogical = connLogical.has(connector);
        if (!isBuiltin && inLogical) activeExternals++;

        const logInfo = connLogical.get(connector);
        monitors.push({
            connector, vendor, model, isBuiltin,
            mode: bestMode,
            transform: logInfo ? logInfo.transform : 0,
            scale: logInfo ? logInfo.scale : 1.0,
            active: inLogical,
            isPrimary: logInfo ? logInfo.isPrimary : false,
            x: logInfo ? logInfo.x : 0,
            y: logInfo ? logInfo.y : 0,
            allModeIds,
        });
    }

    return {monitors, activeExternals};
}
