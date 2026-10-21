// Saved-layout schema: normalisation, migration and monitor identity matching.

import {
    LAYOUT_MODE_LOGICAL,
    PLAN_SCHEMA_VERSION,
} from './constants.js';
import {parseModeId, rectSizeForMode} from './modes.js';

// ── Layout normalisation / migration ────────────────────────────────────────

function identityFrom(raw = {}) {
    const vendor = raw.vendor ?? null;
    const product = raw.product ?? raw.model ?? null;
    const serial = raw.serial ?? null;

    return {vendor, product, serial};
}

function preferredSizeFrom(raw) {
    if (raw.preferredSize?.width && raw.preferredSize?.height)
        return {width: raw.preferredSize.width, height: raw.preferredSize.height};

    const hint = raw.modeHint ?? parseModeId(raw.savedModeId ?? raw.mode);
    if (!hint)
        return null;

    return rectSizeForMode(hint, raw.transform ?? 0, raw.scale ?? 1,
        LAYOUT_MODE_LOGICAL);
}

function normalizeMonitor(raw = {}) {
    const transform = raw.transform ?? 0;
    const scale = raw.scale ?? 1;
    const modeHint = raw.modeHint ?? parseModeId(raw.savedModeId ?? raw.mode);
    const layout = raw.layout ?? {
        x: raw.x ?? 0,
        y: raw.y ?? 0,
        isPrimary: !!raw.isPrimary,
    };

    const monitor = {
        identity: identityFrom(raw.identity ?? raw),
        savedConnector: raw.savedConnector ?? raw.connector ?? null,
        isBuiltin: raw.isBuiltin ?? false,
        transform,
        scale,
        modeHint: modeHint
            ? {width: modeHint.width, height: modeHint.height, rate: modeHint.rate}
            : null,
        savedModeId: raw.savedModeId ?? raw.mode ?? null,
        layout: {
            x: layout.x ?? 0,
            y: layout.y ?? 0,
            isPrimary: !!layout.isPrimary,
        },
        preferredSize: null,
    };

    monitor.preferredSize = preferredSizeFrom(monitor);

    return monitor;
}

/**
 * Upgrade any layout (v1 or v2) to the canonical in-memory schema.
 * Safe to call repeatedly.
 */
export function normalizeLayout(layout) {
    if (!layout || !Array.isArray(layout.monitors))
        return null;

    return {
        id: layout.id ?? null,
        name: layout.name ?? 'Layout',
        schemaVersion: PLAN_SCHEMA_VERSION,
        monitors: layout.monitors.map(normalizeMonitor),
    };
}

export function normalizeLayouts(layouts) {
    if (!Array.isArray(layouts))
        return [];

    return layouts
        .map(normalizeLayout)
        .filter(layout => layout !== null);
}

/**
 * Unique-enough layout id.
 * `Date.now()` alone collides when two layouts are saved in the same
 * millisecond, so a random suffix is appended.
 */
function createLayoutId() {
    const random = Math.random().toString(36).slice(2, 8).padEnd(6, '0');
    return `layout-${Date.now().toString(36)}-${random}`;
}

/**
 * Snapshot the live configuration of `state` as a schema v2 layout.
 * Shared by the Shell extension and the preferences window so both write the
 * same shape.
 */
export function createLayoutFromState(state, {id, name} = {}) {
    const layoutMode = state?.capabilities?.layoutMode ?? LAYOUT_MODE_LOGICAL;
    const monitors = Array.isArray(state?.monitors) ? state.monitors : [];

    return {
        id: id ?? createLayoutId(),
        name: name ?? 'Layout',
        schemaVersion: PLAN_SCHEMA_VERSION,
        monitors: monitors
            .filter(monitor => monitor.active)
            .map(monitor => ({
                identity: {
                    vendor: monitor.vendor ?? null,
                    product: monitor.product ?? monitor.model ?? null,
                    serial: monitor.serial ?? null,
                },
                savedConnector: monitor.connector,
                isBuiltin: Boolean(monitor.isBuiltin),
                transform: monitor.transform,
                scale: monitor.scale,
                modeHint: parseModeId(monitor.mode),
                savedModeId: monitor.mode,
                preferredSize: rectSizeForMode(monitor.mode, monitor.transform,
                    monitor.scale, layoutMode),
                layout: {
                    x: monitor.x,
                    y: monitor.y,
                    isPrimary: Boolean(monitor.isPrimary),
                },
            })),
    };
}

// ── Identity matching ───────────────────────────────────────────────────────

function normalizeText(value) {
    return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

function isCompleteIdentity(identity) {
    return !!(normalizeText(identity?.vendor) &&
        normalizeText(identity?.product) &&
        normalizeText(identity?.serial));
}

function identityMatches(saved, stateMonitor) {
    const savedVendor = normalizeText(saved.vendor);
    const savedProduct = normalizeText(saved.product);
    const savedSerial = normalizeText(saved.serial);

    if (savedVendor && savedVendor !== normalizeText(stateMonitor.vendor))
        return false;
    if (savedProduct && savedProduct !== normalizeText(stateMonitor.product))
        return false;
    if (savedSerial && savedSerial !== normalizeText(stateMonitor.serial))
        return false;

    return true;
}

/**
 * True when the saved monitor could plausibly be this candidate.
 * Used to guard the weaker connector-name tiers: a matching connector must
 * not silently move a saved `P27q-20` onto a `DELL U3219Q`.
 */
function productCompatible(saved, candidate) {
    const savedProduct = normalizeText(saved.identity?.product);
    const candidateProduct = normalizeText(candidate.product);

    if (!savedProduct || !candidateProduct)
        return true;

    return savedProduct === candidateProduct;
}

/**
 * Grouping key for the same-model fallback.
 * Serial numbers are intentionally excluded so a replaced unit of the same
 * model can still be resolved, while built-in panels never match externals.
 */
function modelKey(raw) {
    const product = normalizeText(
        raw?.identity?.product ?? raw?.product ?? raw?.model);

    if (!product)
        return null;

    return `${Boolean(raw?.isBuiltin)}|${product}`;
}

function vendorCompatible(saved, candidate) {
    const savedVendor = normalizeText(saved.identity?.vendor ?? saved.vendor);
    const candidateVendor = normalizeText(candidate.vendor);

    return !savedVendor || !candidateVendor || savedVendor === candidateVendor;
}

// Connector type names differ between the Xorg and Wayland back-ends.
// Hyphens are stripped before the lookup so `HDMI-A` and `DVI-I` collapse onto
// the same base type as `HDMI` and `DVI`.
const CONNECTOR_TYPE_ALIASES = {
    displayport: 'dp',
    hdmi: 'hdmi',
    hdmia: 'hdmi',
    hdmib: 'hdmi',
    edp: 'edp',
    dvi: 'dvi',
    dvid: 'dvi',
    dvia: 'dvi',
    dvii: 'dvi',
    vga: 'vga',
    usbc: 'usbc',
    virtual: 'virtual',
    dsi: 'dsi',
};

/** Split a connector name into `{type, index}` for fuzzy comparison. */
export function connectorKey(connector) {
    if (typeof connector !== 'string' || connector.length === 0)
        return null;

    const match = connector.match(/^([A-Za-z-]+?)-?(\d+)?$/);
    if (!match)
        return null;

    const type = match[1].toLowerCase().replace(/-/g, '');
    const index = match[2] === undefined ? null : parseInt(match[2], 10);

    return {type: CONNECTOR_TYPE_ALIASES[type] ?? type, index};
}

/**
 * True when two connector names refer to the same port on the same type.
 * An index mismatch is allowed when one side omits the index (`eDP` vs `eDP-1`).
 */
export function connectorsLooselyMatch(a, b) {
    const keyA = connectorKey(a);
    const keyB = connectorKey(b);

    if (!keyA || !keyB || keyA.type !== keyB.type)
        return false;

    if (keyA.index === null || keyB.index === null)
        return true;

    return keyA.index === keyB.index;
}

/**
 * Resolve every saved monitor to a connected state monitor.
 *
 * Tiers, strongest first:
 *   1. full EDID identity (vendor + product + serial)
 *   2. vendor + product + built-in flag, when unambiguous
 *   3. product + built-in flag, when unambiguous
 *   4. exact saved connector name (product-compatible)
 *   5. loosely matching connector (`DP-7` / `DisplayPort-7`, `eDP-1` / `eDP`)
 *   6. same model + built-in flag, in connector order (identical monitors)
 *
 * Returns `{resolved, missing}` where `resolved[i]` is the state monitor for
 * `layout.monitors[i]` or `null`.
 */
export function resolveIdentities(layout, state) {
    const savedMonitors = Array.isArray(layout?.monitors) ? layout.monitors : [];
    const candidates = Array.isArray(state?.monitors) ? state.monitors : [];
    const claimed = new Set();
    const resolved = new Array(savedMonitors.length).fill(null);

    const available = () => candidates.filter(c => !claimed.has(c.connector));

    const take = (index, candidate) => {
        resolved[index] = candidate;
        claimed.add(candidate.connector);
    };

    // Tier 1: full EDID identity.
    for (let i = 0; i < savedMonitors.length; i++) {
        const identity = savedMonitors[i].identity ?? {};
        if (!isCompleteIdentity(identity))
            continue;

        const matches = available().filter(c => identityMatches(identity, c));
        if (matches.length === 1)
            take(i, matches[0]);
    }

    // Tier 2: vendor + product (+ built-in flag), unambiguous.
    for (let i = 0; i < savedMonitors.length; i++) {
        if (resolved[i])
            continue;

        const identity = savedMonitors[i].identity ?? {};
        if (!normalizeText(identity.vendor) || !normalizeText(identity.product))
            continue;

        const matches = available().filter(c =>
            identityMatches(identity, c) &&
            !!c.isBuiltin === !!savedMonitors[i].isBuiltin);

        if (matches.length === 1)
            take(i, matches[0]);
    }

    // Tier 3: product (+ built-in flag), unambiguous.
    // This is the tier that upgrades schema v1 layouts, which only stored the
    // EDID product name as `model`.
    for (let i = 0; i < savedMonitors.length; i++) {
        if (resolved[i])
            continue;

        const product = normalizeText(savedMonitors[i].identity?.product);
        if (!product)
            continue;

        const matches = available().filter(c =>
            normalizeText(c.product) === product &&
            !!c.isBuiltin === !!savedMonitors[i].isBuiltin);

        if (matches.length === 1)
            take(i, matches[0]);
    }

    // Tier 4: exact connector, as long as the product does not contradict it.
    for (let i = 0; i < savedMonitors.length; i++) {
        if (resolved[i])
            continue;

        const connector = savedMonitors[i].savedConnector;
        if (!connector)
            continue;

        const match = available().find(c =>
            c.connector === connector && productCompatible(savedMonitors[i], c));
        if (match)
            take(i, match);
    }

    // Tier 5: loosely matching connector (`DP-7` / `DisplayPort-7`,
    // `eDP-1` / `eDP`), unambiguous and product-compatible.
    for (let i = 0; i < savedMonitors.length; i++) {
        if (resolved[i])
            continue;

        const connector = savedMonitors[i].savedConnector;
        if (!connector)
            continue;

        const matches = available().filter(c =>
            connectorsLooselyMatch(connector, c.connector) &&
            productCompatible(savedMonitors[i], c));
        if (matches.length === 1)
            take(i, matches[0]);
    }

    // Tier 6: deterministic same-model fallback for monitors that expose no
    // usable serial, or that were replaced with the same model. Sorting by
    // connector keeps the mapping stable across sessions.
    const unresolvedModels = new Map();

    for (let i = 0; i < savedMonitors.length; i++) {
        if (resolved[i])
            continue;

        const key = modelKey(savedMonitors[i]);
        if (!key)
            continue;

        if (!unresolvedModels.has(key))
            unresolvedModels.set(key, []);
        unresolvedModels.get(key).push(i);
    }

    for (const [key, savedIndexes] of unresolvedModels) {
        const candidatesForModel = available()
            .filter(candidate => modelKey(candidate) === key)
            .sort((a, b) => String(a.connector)
                .localeCompare(String(b.connector), undefined, {numeric: true}));

        const assignment = [];
        const used = new Set();

        for (const savedIndex of savedIndexes) {
            const candidate = candidatesForModel.find(item =>
                !used.has(item.connector) &&
                vendorCompatible(savedMonitors[savedIndex], item));

            if (!candidate)
                break;

            used.add(candidate.connector);
            assignment.push([savedIndex, candidate]);
        }

        if (assignment.length !== savedIndexes.length)
            continue;

        for (const [savedIndex, candidate] of assignment)
            take(savedIndex, candidate);
    }

    const missing = [];
    for (let i = 0; i < savedMonitors.length; i++) {
        if (!resolved[i])
            missing.push(savedMonitors[i]);
    }

    return {resolved, missing};
}
