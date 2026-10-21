// Mode and scale resolution for saved monitor layouts.

import {
    ASPECT_TOLERANCE,
    EPSILON,
    LAYOUT_MODE_LOGICAL,
    LAYOUT_MODE_PHYSICAL,
    RATE_TOLERANCE,
} from './constants.js';

// ── Mode helpers ────────────────────────────────────────────────────────────

export function parseModeId(modeId) {
    if (typeof modeId !== 'string')
        return null;

    const match = modeId.match(/^(\d+)x(\d+)@([\d.]+)$/);
    if (!match)
        return null;

    return {
        width: parseInt(match[1], 10),
        height: parseInt(match[2], 10),
        rate: parseFloat(match[3]),
    };
}

export function isRotatedTransform(transform) {
    return transform === 1 || transform === 3 || transform === 5 || transform === 7;
}

/**
 * Physical pixel size of a mode, with rotation applied.
 *
 * Returns `null` when the mode cannot be interpreted instead of inventing a
 * default size, so callers can report a real error rather than silently
 * laying out a monitor at a resolution it does not have.
 */
export function renderedModeSize(mode, transform = 0) {
    let width = null;
    let height = null;

    if (typeof mode === 'string') {
        const parsed = parseModeId(mode);
        if (parsed) {
            width = parsed.width;
            height = parsed.height;
        }
    } else if (mode && typeof mode === 'object') {
        width = mode.width ?? null;
        height = mode.height ?? null;
    }

    if (!Number.isFinite(width) || !Number.isFinite(height) ||
        width <= 0 || height <= 0) {
        return null;
    }

    if (isRotatedTransform(transform))
        [width, height] = [height, width];

    return {width, height};
}

/**
 * Logical size of a monitor, as Mutter lays it out.
 * In PHYSICAL layout mode the logical size equals the mode size and the scale
 * is not applied; in LOGICAL mode it is divided by the scale.
 *
 * Returns `null` when the mode has no usable size.
 */
export function rectSizeForMode(mode, transform, scale, layoutMode) {
    const rendered = renderedModeSize(mode, transform);
    if (!rendered)
        return null;

    const effectiveScale = layoutMode === LAYOUT_MODE_PHYSICAL ? 1 : (scale || 1);

    return {
        width: Math.round(rendered.width / effectiveScale),
        height: Math.round(rendered.height / effectiveScale),
    };
}

function modeListFor(stateMonitor) {
    const modes = Array.isArray(stateMonitor.modes) && stateMonitor.modes.length > 0
        ? stateMonitor.modes
        : (Array.isArray(stateMonitor.allModeIds)
            ? stateMonitor.allModeIds
            : (stateMonitor.mode ? [stateMonitor.mode] : []))
            .map(id => ({...parseModeId(id), id}));

    // Drop modes without a usable size so callers never plan against them.
    return modes.filter(mode =>
        Number.isFinite(mode.width) && Number.isFinite(mode.height) &&
        mode.width > 0 && mode.height > 0);
}

function findModeById(modes, modeId) {
    if (!modeId)
        return null;

    return modes.find(mode => mode.id === modeId) ?? null;
}

function findModeBySize(modes, width, height, rate) {
    const sameSize = modes.filter(mode => mode.width === width && mode.height === height);
    if (sameSize.length === 0)
        return null;

    if (Number.isFinite(rate)) {
        const exact = sameSize.find(mode => Math.abs(mode.rate - rate) <= RATE_TOLERANCE);
        if (exact)
            return exact;

        return sameSize
            .slice()
            .sort((a, b) => Math.abs(a.rate - rate) - Math.abs(b.rate - rate))[0];
    }

    return sameSize[0];
}

// Scale factors Mutter (or a fractional-scaling session) may have used to
// derive a virtual mode from a native one.
const KNOWN_SCALE_RATIOS = [1.2, 1.25, 4 / 3, 1.5, 5 / 3, 1.75, 2, 2.5, 3];

function isScaleUpRatio(ratio) {
    return ratio >= 1 && KNOWN_SCALE_RATIOS.some(known =>
        Math.abs(ratio - known) <= 0.01 * known);
}

/**
 * Pick a same-aspect mode when the saved size is unavailable.
 *
 * A saved size such as `2880x1620` is usually a fractional-scaling virtual
 * mode derived from `3840x2160`, so prefer the mode that restores the native
 * resolution over an arbitrarily smaller one. When no such ratio matches,
 * stay at or below the requested size to avoid growing the layout.
 */
function findModeByAspect(modes, width, height) {
    if (!width || !height)
        return null;

    const targetAspect = width / height;
    const targetArea = width * height;

    const candidates = modes.filter(mode => {
        if (!mode.width || !mode.height)
            return false;

        const aspect = mode.width / mode.height;
        return Math.abs(aspect - targetAspect) <= ASPECT_TOLERANCE * targetAspect;
    });

    if (candidates.length === 0)
        return null;

    const scaleUp = candidates.filter(mode => isScaleUpRatio(mode.width / width));
    const notLarger = candidates.filter(mode => mode.width * mode.height <= targetArea);
    const pool = scaleUp.length > 0
        ? scaleUp
        : (notLarger.length > 0 ? notLarger : candidates);

    return pool
        .slice()
        .sort((a, b) =>
            Math.abs(a.width * a.height - targetArea) -
            Math.abs(b.width * b.height - targetArea))[0];
}

/**
 * Pick a mode for a saved monitor.
 * Returns `{mode, degraded, reason}`; `mode` is `null` when nothing usable was
 * found. `reason` is `null` when the exact saved mode is available.
 */
export function resolveMode(savedMonitor, stateMonitor) {
    const modes = modeListFor(stateMonitor);
    if (modes.length === 0)
        return {mode: null, degraded: true, reason: 'no-modes'};

    const exactId = findModeById(modes, savedMonitor.savedModeId);
    if (exactId)
        return {mode: exactId, degraded: false, reason: null};

    const hint = savedMonitor.modeHint ?? parseModeId(savedMonitor.savedModeId);
    if (!hint) {
        const current = findModeById(modes, stateMonitor.mode) ?? modes[0];
        return {mode: current, degraded: true, reason: 'no-hint'};
    }

    const exactSize = findModeBySize(modes, hint.width, hint.height, hint.rate);
    if (exactSize) {
        const rateAdjusted = Math.abs(exactSize.rate - hint.rate) > RATE_TOLERANCE;
        return {
            mode: exactSize,
            degraded: rateAdjusted,
            reason: rateAdjusted ? 'rate-adjusted' : null,
        };
    }

    const aspectMatch = findModeByAspect(modes, hint.width, hint.height);
    if (aspectMatch)
        return {mode: aspectMatch, degraded: true, reason: 'size-adjusted'};

    const current = findModeById(modes, stateMonitor.mode) ?? modes[0];
    return {mode: current, degraded: true, reason: 'current-mode'};
}

// ── Scale resolution ────────────────────────────────────────────────────────

function supportsScale(mode, scale) {
    const supported = mode?.supportedScales;
    if (!Array.isArray(supported) || supported.length === 0)
        return true;

    return supported.some(value => Math.abs(value - scale) < EPSILON);
}

function nearestSupportedScale(mode, scale) {
    const supported = mode?.supportedScales;
    if (!Array.isArray(supported) || supported.length === 0)
        return scale;

    return supported
        .slice()
        .sort((a, b) => Math.abs(a - scale) - Math.abs(b - scale))[0];
}

export function capabilitiesOf(state) {
    const caps = state?.capabilities ?? {};

    return {
        renderer: caps.renderer ?? 'unknown',
        layoutMode: caps.layoutMode ?? LAYOUT_MODE_LOGICAL,
        globalScaleRequired: !!caps.globalScaleRequired,
        legacyUiScalingFactor: caps.legacyUiScalingFactor ?? 1,
        maxScreenSize: caps.maxScreenSize ?? null,
        supportsChangingLayoutMode: !!caps.supportsChangingLayoutMode,
        fractionalScaling: caps.fractionalScaling ??
            (caps.layoutMode !== LAYOUT_MODE_PHYSICAL && !caps.globalScaleRequired),
    };
}

/**
 * Scales supported by every monitor in the layout.
 *
 * Monitors that do not report a scale list are treated as unconstrained.
 * Returns `null` when no monitor constrains the scale, and an empty array when
 * the monitors share no common scale at all.
 */
function supportedScaleIntersection(entries) {
    const constrained = entries.filter(entry =>
        Array.isArray(entry.mode?.supportedScales) &&
        entry.mode.supportedScales.length > 0);

    if (constrained.length === 0)
        return null;

    let common = constrained[0].mode.supportedScales.slice();

    for (const entry of constrained.slice(1))
        common = common.filter(scale => supportsScale(entry.mode, scale));

    return common;
}

function chooseCommonScale(entries, preferred) {
    const candidates = supportedScaleIntersection(entries);

    // Nothing constrains the scale, so keep the saved one.
    if (candidates === null)
        return preferred;

    if (candidates.some(scale => Math.abs(scale - preferred) < EPSILON))
        return preferred;

    // Prefer 100 % when the saved scale is not available: it is the only
    // value every back-end understands and it never enlarges the layout.
    if (candidates.some(scale => Math.abs(scale - 1) < EPSILON))
        return 1;

    if (candidates.length > 0) {
        return candidates
            .slice()
            .sort((a, b) => Math.abs(a - preferred) - Math.abs(b - preferred))[0];
    }

    // No scale is shared by every monitor; Mutter will clamp it anyway, but
    // fall back to 100 % so the plan stays representable.
    return 1;
}

/**
 * Decide the scale for every resolved monitor.
 *
 * - PHYSICAL layout mode cannot express fractional scales, so scales collapse
 *   to a single value the whole layout supports.
 * - `global-scale-required` forces a single scale for the whole layout.
 * - Otherwise each monitor keeps its saved scale when the mode supports it.
 */
export function resolveScales(entries, caps) {
    const resolvedCaps = caps ?? capabilitiesOf({});
    const degraded = [];

    if (resolvedCaps.layoutMode === LAYOUT_MODE_PHYSICAL ||
        resolvedCaps.globalScaleRequired ||
        !resolvedCaps.fractionalScaling) {
        // Single scale for the whole layout.
        const savedPrimary = entries.find(entry => entry.saved.layout.isPrimary);
        const preferred = savedPrimary?.saved.scale ?? entries[0]?.saved.scale ?? 1;
        const commonScale = chooseCommonScale(entries, preferred);

        for (const entry of entries) {
            entry.scale = commonScale;
            if (Math.abs(entry.saved.scale - commonScale) > EPSILON) {
                degraded.push({
                    connector: entry.state.connector,
                    reason: 'scale-clamped',
                    savedScale: entry.saved.scale,
                    scale: commonScale,
                });
            }
        }

        return degraded;
    }

    for (const entry of entries) {
        let scale = entry.saved.scale || 1;

        if (!supportsScale(entry.mode, scale)) {
            const replacement = nearestSupportedScale(entry.mode, scale);
            degraded.push({
                connector: entry.state.connector,
                reason: 'scale-adjusted',
                savedScale: scale,
                scale: replacement,
            });
            scale = replacement;
        }

        entry.scale = scale;
    }

    return degraded;
}
