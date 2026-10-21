// Plan building and Mutter-compatible validation.

import {
    ERROR_CODES,
    LAYOUT_MODE_PHYSICAL,
    PLAN_SCHEMA_VERSION,
    EPSILON,
} from './constants.js';
import {
    capabilitiesOf,
    rectSizeForMode,
    resolveMode,
    resolveScales,
} from './modes.js';
import {
    boundingBox,
    isConnected,
    primaryIndexFor,
    reachableFrom,
    rectanglesOverlap,
    rectFromEntry,
    reflow,
} from './geometry.js';
import {
    normalizeLayout,
    resolveIdentities,
} from './layout-schema.js';

// ── Validation ──────────────────────────────────────────────────────────────

function planError(code, message, monitors = []) {
    return {ok: false, code, message, monitors};
}

/**
 * Local mirror of Mutter's `meta_verify_logical_monitor_config_list()`.
 */
export function validatePlan(plan, caps) {
    const resolvedCaps = caps ?? capabilitiesOf({});
    const monitors = Array.isArray(plan?.monitors) ? plan.monitors : [];

    if (monitors.length === 0)
        return planError(ERROR_CODES.EMPTY_LAYOUT, 'Layout has no monitors');

    const rects = monitors.map(monitor => ({
        x: monitor.x,
        y: monitor.y,
        width: monitor.size.width,
        height: monitor.size.height,
    }));

    for (const rect of rects) {
        if (rect.width <= 0 || rect.height <= 0) {
            return planError(ERROR_CODES.MODE_SIZE_MISMATCH,
                'Monitor has no usable size');
        }
    }

    const primaryCount = monitors.filter(monitor => monitor.isPrimary).length;
    if (primaryCount === 0)
        return planError(ERROR_CODES.NO_PRIMARY, 'Layout is missing a primary monitor');
    if (primaryCount > 1) {
        return planError(ERROR_CODES.MULTIPLE_PRIMARY,
            'Layout contains multiple primary monitors');
    }

    const overlapping = [];
    for (let i = 0; i < rects.length; i++) {
        for (let j = i + 1; j < rects.length; j++) {
            if (rectanglesOverlap(rects[i], rects[j]))
                overlapping.push([monitors[i].connector, monitors[j].connector]);
        }
    }
    if (overlapping.length > 0) {
        return planError(ERROR_CODES.OVERLAP,
            'Logical monitors overlap',
            overlapping.flat());
    }

    if (!isConnected(rects)) {
        const seen = reachableFrom(rects);
        const isolated = monitors
            .filter((_monitor, index) => !seen.has(index))
            .map(monitor => monitor.connector);

        return planError(ERROR_CODES.NOT_ADJACENT,
            'Logical monitors not adjacent', isolated);
    }

    const {minX, minY, maxX, maxY} = boundingBox(rects);
    if (minX !== 0 || minY !== 0) {
        return planError(ERROR_CODES.OFFSET,
            'Logical monitor positions are offset');
    }

    if (resolvedCaps.layoutMode === LAYOUT_MODE_PHYSICAL) {
        for (const monitor of monitors) {
            if (Math.abs(monitor.scale - Math.round(monitor.scale)) > EPSILON) {
                return planError(ERROR_CODES.INVALID_SCALE,
                    'A fractional scale with physical layout mode not allowed',
                    [monitor.connector]);
            }
        }
    }

    if (resolvedCaps.globalScaleRequired) {
        const scale = monitors[0].scale;
        if (monitors.some(monitor => Math.abs(monitor.scale - scale) > EPSILON)) {
            return planError(ERROR_CODES.SCALE_MISMATCH,
                'Logical monitor scales must be identical');
        }
    }

    for (const monitor of monitors) {
        const expected = rectSizeForMode(monitor.mode, monitor.transform,
            monitor.scale, resolvedCaps.layoutMode);

        if (!expected) {
            return planError(ERROR_CODES.MODE_SIZE_MISMATCH,
                'Monitor mode is not usable',
                [monitor.connector]);
        }

        if (Math.abs(expected.width - monitor.size.width) > 1 ||
            Math.abs(expected.height - monitor.size.height) > 1) {
            return planError(ERROR_CODES.MODE_SIZE_MISMATCH,
                'Monitor mode size doesn\'t match scaled monitor layout',
                [monitor.connector]);
        }
    }

    if (resolvedCaps.maxScreenSize) {
        const {width, height} = resolvedCaps.maxScreenSize;
        if (maxX > width || maxY > height) {
            return planError(ERROR_CODES.EXCEEDS_SCREEN,
                `Layout ${maxX}x${maxY} exceeds the maximum screen size ${width}x${height}`);
        }
    }

    return {ok: true};
}

// ── Plan building ───────────────────────────────────────────────────────────

/**
 * Build a concrete, Mutter-valid monitor configuration for `layout` against
 * the current `state`.
 *
 * Returns either `{ok: true, plan, degraded, warnings}` or
 * `{ok: false, error: {code, message, monitors}}`.
 */
export function buildPlan(layout, state) {
    const normalized = normalizeLayout(layout);
    if (!normalized || normalized.monitors.length === 0) {
        return {
            ok: false,
            error: {
                code: ERROR_CODES.EMPTY_LAYOUT,
                message: 'Layout has no monitors',
                monitors: [],
            },
        };
    }

    const caps = capabilitiesOf(state);
    const {resolved, missing} = resolveIdentities(normalized, state);

    if (missing.length > 0) {
        const names = missing.map(monitor =>
            monitor.identity?.product ?? monitor.savedConnector ?? 'unknown monitor');
        return {
            ok: false,
            error: {
                code: ERROR_CODES.MONITOR_MISSING,
                message: `Not connected: ${names.join(', ')}`,
                monitors: missing.map(monitor => monitor.savedConnector),
            },
        };
    }

    const entries = [];
    const degraded = [];
    const warnings = [];

    for (let i = 0; i < normalized.monitors.length; i++) {
        const saved = normalized.monitors[i];
        const stateMonitor = resolved[i];

        if (!stateMonitor) {
            return {
                ok: false,
                error: {
                    code: ERROR_CODES.MONITOR_MISSING,
                    message: `Monitor ${saved.savedConnector ?? 'unknown'} is not connected`,
                    monitors: [saved.savedConnector],
                },
            };
        }

        const modeResult = resolveMode(saved, stateMonitor);
        if (!modeResult.mode) {
            return {
                ok: false,
                error: {
                    code: ERROR_CODES.MODE_UNAVAILABLE,
                    message: `No usable mode for ${stateMonitor.connector}`,
                    monitors: [stateMonitor.connector],
                },
            };
        }

        if (modeResult.degraded) {
            degraded.push({
                connector: stateMonitor.connector,
                reason: modeResult.reason,
                savedModeId: saved.savedModeId,
                modeId: modeResult.mode.id,
            });
        }

        entries.push({
            saved,
            state: stateMonitor,
            mode: modeResult.mode,
            modeDegraded: modeResult.degraded,
            size: null,
            scale: 1,
        });
    }

    const scaleDegraded = resolveScales(entries, caps);
    degraded.push(...scaleDegraded);

    for (const entry of entries) {
        entry.size = rectSizeForMode(
            entry.mode,
            entry.saved.transform,
            entry.scale,
            caps.layoutMode);

        if (!entry.size) {
            return {
                ok: false,
                error: {
                    code: ERROR_CODES.MODE_UNAVAILABLE,
                    message: `Mode ${entry.mode.id ?? 'unknown'} has no usable size ` +
                        `for ${entry.state.connector}`,
                    monitors: [entry.state.connector],
                },
            };
        }
    }

    const savedRects = entries.map(rectFromEntry);
    const primaryIndex = primaryIndexFor(entries, savedRects);
    const rects = reflow(entries, primaryIndex);

    const monitors = entries.map((entry, index) => ({
        connector: entry.state.connector,
        identity: {
            vendor: entry.state.vendor ?? entry.saved.identity?.vendor ?? null,
            product: entry.state.product ?? entry.saved.identity?.product ?? null,
            serial: entry.state.serial ?? entry.saved.identity?.serial ?? null,
        },
        mode: entry.mode.id,
        transform: entry.saved.transform,
        scale: entry.scale,
        x: rects[index].x,
        y: rects[index].y,
        size: {width: rects[index].width, height: rects[index].height},
        isPrimary: index === primaryIndex,
        isBuiltin: !!entry.state.isBuiltin,
    }));

    const plan = {
        schemaVersion: PLAN_SCHEMA_VERSION,
        layoutId: normalized.id,
        layoutName: normalized.name,
        monitors,
    };

    const validation = validatePlan(plan, caps);
    if (!validation.ok) {
        return {
            ok: false,
            error: {
                code: validation.code,
                message: validation.message,
                monitors: validation.monitors,
            },
        };
    }

    if (degraded.length > 0) {
        warnings.push('Some monitors were adjusted to fit this session');
    }

    // Mutter refuses to activate a built-in panel while the lid is closed, and
    // the panel is reported inactive in that state. Warn without blocking: the
    // layout still applies normally when the lid is open.
    if (entries.some(entry => entry.state.isBuiltin && !entry.state.active)) {
        warnings.push('The built-in display is currently disabled; ' +
            'it cannot be activated while the laptop lid is closed');
    }

    return {ok: true, plan, degraded, warnings};
}

/** Convert a plan to the D-Bus `ApplyMonitorsConfig` logical-monitor array. */
export function toLogicalMonitorTuples(plan) {
    return plan.monitors.map(monitor => [
        monitor.x,
        monitor.y,
        monitor.scale,
        monitor.transform,
        monitor.isPrimary,
        [[monitor.connector, monitor.mode, {}]],
    ]);
}

/**
 * True when the current state already matches the layout.
 * Compares resolved geometry, not saved coordinates, so a layout saved on
 * another session still matches when the effective arrangement is identical.
 */
export function layoutMatchesState(layout, state) {
    const result = buildPlan(layout, state);
    if (!result.ok)
        return false;

    const activeMonitors = (state?.monitors ?? []).filter(monitor => monitor.active);
    if (activeMonitors.length !== result.plan.monitors.length)
        return false;

    const caps = capabilitiesOf(state);

    for (const planned of result.plan.monitors) {
        const current = activeMonitors.find(monitor => monitor.connector === planned.connector);
        if (!current)
            return false;

        if (current.x !== planned.x || current.y !== planned.y)
            return false;
        if (current.transform !== planned.transform)
            return false;
        if (current.mode !== planned.mode)
            return false;
        if (Boolean(current.isPrimary) !== Boolean(planned.isPrimary))
            return false;
        if (Math.abs((current.scale || 1) - planned.scale) > EPSILON)
            return false;

        const currentSize = rectSizeForMode(
            current.mode, current.transform, current.scale, caps.layoutMode);

        if (!currentSize)
            return false;

        if (currentSize.width !== planned.size.width ||
            currentSize.height !== planned.size.height) {
            return false;
        }
    }

    return true;
}
