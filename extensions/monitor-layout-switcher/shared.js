import GLib from 'gi://GLib';
import Gio from 'gi://Gio';

import {
    LAYOUT_MODE_LOGICAL,
    LAYOUT_MODE_PHYSICAL,
    normalizeLayouts,
} from './lib/display-plan.js';

// ── DBus constants ───────────────────────────────────────────────────────────
export const DISPLAY_CONFIG_IFACE = 'org.gnome.Mutter.DisplayConfig';
export const DISPLAY_CONFIG_PATH = '/org/gnome/Mutter/DisplayConfig';
export const GET_STATE_REPLY_TYPE = new GLib.VariantType(
    '(ua((ssss)a(siiddada{sv})a{sv})a(iiduba(ssss)a{sv})a{sv})'
);

// ── ApplyMonitorsConfig method constants ─────────────────────────────────────
// 0 = VERIFY, 1 = TEMPORARY, 2 = PERSISTENT
export const APPLY_METHOD_VERIFY = 0;
export const APPLY_METHOD_TEMPORARY = 1;
export const APPLY_METHOD_PERSISTENT = 2;

// ── Utility ──────────────────────────────────────────────────────────────────
export function variantLookup(dictVariant, key) {
    for (let i = 0; i < dictVariant.n_children(); i++) {
        const entry = dictVariant.get_child_value(i);
        if (entry.get_child_value(0).get_string()[0] === key)
            return entry.get_child_value(1).get_variant();
    }
    return null;
}

// ── Settings helpers ─────────────────────────────────────────────────────────
/**
 * Read saved layouts, upgrading v1 entries to the canonical v2 shape.
 * Migration happens in memory; the first save writes v2 back.
 */
export function loadLayouts(settings) {
    const raw = settings.get_string('layouts');
    if (!raw) return [];
    try {
        const parsed = JSON.parse(raw);
        return normalizeLayouts(Array.isArray(parsed) ? parsed : []);
    } catch (e) {
        // Surface corruption instead of failing silently with an empty list.
        console.error(`[MLS] could not parse saved layouts: ${e.message}`);
        return [];
    }
}

export function saveLayouts(settings, layouts) {
    settings.set_string('layouts', JSON.stringify(normalizeLayouts(layouts)));
}

// ── Display properties from DBus ─────────────────────────────────────────────
/**
 * Parse the `a{sv}` properties child of `GetCurrentState`.
 *
 * These capabilities describe what the running back-end can express. Xorg is
 * always PHYSICAL + `global-scale-required` and therefore cannot use
 * fractional scaling, while Wayland with `scale-monitor-framebuffer` reports
 * LOGICAL layout mode.
 */
export function parseDisplayProperties(propertiesVariant) {
    const capabilities = {
        renderer: 'unknown',
        layoutMode: LAYOUT_MODE_LOGICAL,
        globalScaleRequired: false,
        legacyUiScalingFactor: 1,
        maxScreenSize: null,
        supportsChangingLayoutMode: false,
        fractionalScaling: true,
    };

    if (!propertiesVariant)
        return capabilities;

    const renderer = variantLookup(propertiesVariant, 'renderer');
    if (renderer !== null)
        capabilities.renderer = renderer.get_string()[0];

    const layoutMode = variantLookup(propertiesVariant, 'layout-mode');
    if (layoutMode !== null)
        capabilities.layoutMode = layoutMode.get_uint32();

    const globalScale = variantLookup(propertiesVariant, 'global-scale-required');
    if (globalScale !== null)
        capabilities.globalScaleRequired = globalScale.get_boolean();

    const uiScaling = variantLookup(propertiesVariant, 'legacy-ui-scaling-factor');
    if (uiScaling !== null)
        capabilities.legacyUiScalingFactor = uiScaling.get_int32();

    const supportsLayoutMode = variantLookup(propertiesVariant,
        'supports-changing-layout-mode');
    if (supportsLayoutMode !== null)
        capabilities.supportsChangingLayoutMode = supportsLayoutMode.get_boolean();

    const maxScreenSize = variantLookup(propertiesVariant, 'max-screen-size');
    if (maxScreenSize !== null) {
        capabilities.maxScreenSize = {
            width: maxScreenSize.get_child_value(0).get_int32(),
            height: maxScreenSize.get_child_value(1).get_int32(),
        };
    }

    capabilities.fractionalScaling =
        capabilities.layoutMode !== LAYOUT_MODE_PHYSICAL &&
        !capabilities.globalScaleRequired;

    return capabilities;
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

function parseModes(modesVariant) {
    const modes = [];

    for (let mi = 0; mi < modesVariant.n_children(); mi++) {
        const mode = modesVariant.get_child_value(mi);
        const id = mode.get_child_value(0).get_string()[0];
        const width = mode.get_child_value(1).get_int32();
        const height = mode.get_child_value(2).get_int32();
        const rate = mode.get_child_value(3).get_double();
        const preferredScale = mode.get_child_value(4).get_double();
        const supportedScalesVariant = mode.get_child_value(5);
        const properties = mode.get_child_value(6);

        const supportedScales = [];
        for (let si = 0; si < supportedScalesVariant.n_children(); si++)
            supportedScales.push(supportedScalesVariant.get_child_value(si).get_double());

        modes.push({
            id,
            width,
            height,
            rate,
            scale: preferredScale,
            supportedScales,
            isCurrent: variantLookup(properties, 'is-current')?.get_boolean() ?? false,
            isPreferred: variantLookup(properties, 'is-preferred')?.get_boolean() ?? false,
        });
    }

    return modes;
}

export function parseMonitors(monitorsVariant, connLogical) {
    const monitors = [];
    let activeExternals = 0;

    for (let i = 0; i < monitorsVariant.n_children(); i++) {
        const mon = monitorsVariant.get_child_value(i);
        const ident = mon.get_child_value(0);
        const modesVariant = mon.get_child_value(1);
        const mprops = mon.get_child_value(2);

        const connector = ident.get_child_value(0).get_string()[0];
        const vendor = ident.get_child_value(1).get_string()[0];
        const product = ident.get_child_value(2).get_string()[0];
        const serial = ident.get_child_value(3).get_string()[0];

        let isBuiltin = false;
        const builtinVal = variantLookup(mprops, 'is-builtin');
        if (builtinVal !== null)
            isBuiltin = builtinVal.get_boolean();

        const modes = parseModes(modesVariant);
        const allModeIds = modes.map(mode => mode.id);

        let currentMode = null, preferredMode = null;
        for (const mode of modes) {
            if (mode.isCurrent) currentMode = mode.id;
            if (mode.isPreferred) preferredMode = mode.id;
        }

        const bestMode = currentMode ?? preferredMode ?? allModeIds[0] ?? null;
        const inLogical = connLogical.has(connector);
        if (!isBuiltin && inLogical) activeExternals++;

        const logInfo = connLogical.get(connector);
        monitors.push({
            connector,
            vendor,
            product,
            // `model` is kept for backwards compatibility with older callers.
            model: product,
            serial,
            isBuiltin,
            mode: bestMode,
            transform: logInfo ? logInfo.transform : 0,
            scale: logInfo ? logInfo.scale : 1.0,
            active: inLogical,
            isPrimary: logInfo ? logInfo.isPrimary : false,
            x: logInfo ? logInfo.x : 0,
            y: logInfo ? logInfo.y : 0,
            allModeIds,
            modes,
        });
    }

    return {monitors, activeExternals};
}
