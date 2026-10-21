// User-facing status and error messages for monitor layouts.

import {
    COMPATIBILITY,
    ERROR_CODES,
} from './constants.js';
import {buildPlan} from './plan.js';

/**
 * Summarise how `layout` would apply on `state`.
 *
 * Returns `{status, label, details}`:
 *   - `status` is one of `COMPATIBILITY`
 *   - `label` is a short badge text shared by the popup, switcher and prefs
 *   - `details` is a list of reasons for tooltips
 */
export function describeLayoutCompatibility(layout, state) {
    if (!state)
        return {status: COMPATIBILITY.UNKNOWN, label: 'Unknown', details: []};

    const result = buildPlan(layout, state);
    if (!result.ok) {
        return {
            status: COMPATIBILITY.UNAVAILABLE,
            label: 'Unavailable',
            details: [`${result.error.code}: ${result.error.message}`],
        };
    }

    if (result.degraded.length > 0) {
        return {
            status: COMPATIBILITY.ADJUSTED,
            label: 'Adjusted',
            details: result.degraded.map(item => item.reason ?? 'adjusted'),
        };
    }

    if (result.warnings.length > 0) {
        return {
            status: COMPATIBILITY.WARNING,
            label: 'Panel off',
            details: result.warnings,
        };
    }

    return {status: COMPATIBILITY.READY, label: 'Ready', details: []};
}

export function describeDegraded(degraded = []) {
    if (!Array.isArray(degraded) || degraded.length === 0)
        return '';

    const reasons = new Set(degraded.map(item => item.reason));

    if (reasons.has('scale-clamped') || reasons.has('scale-adjusted'))
        return 'resolution adjusted for this session';

    if (reasons.has('size-adjusted') || reasons.has('rate-adjusted') ||
        reasons.has('current-mode') || reasons.has('no-hint')) {
        return 'resolution adjusted';
    }

    return 'adjusted for this session';
}

export function formatPlanError(error, layoutName = '') {
    const prefix = layoutName ? `${layoutName}: ` : '';

    switch (error?.code) {
    case ERROR_CODES.MONITOR_MISSING:
        return `${prefix}${error.message}`;
    case ERROR_CODES.MODE_UNAVAILABLE:
        return `${prefix}${error.message}`;
    case ERROR_CODES.NOT_ADJACENT:
        return `${prefix}layout cannot be arranged without gaps ` +
            `(${(error.monitors ?? []).join(', ')})`;
    case ERROR_CODES.OVERLAP:
        return `${prefix}layout would overlap monitors`;
    case ERROR_CODES.EXCEEDS_SCREEN:
        return `${prefix}${error.message}`;
    default:
        return `${prefix}${error?.message ?? 'layout cannot be applied'}`;
    }
}

/**
 * Turn a raw D-Bus error into an actionable message.
 * The D-Bus text describes the last check Mutter ran, which is often not the
 * real cause.
 */
export function explainDbusError(message = '') {
    const text = String(message);

    if (text.includes('Logical monitors not adjacent')) {
        return 'the monitor arrangement has gaps; the saved layout ' +
            'was probably created with different resolutions';
    }

    if (text.includes('Logical monitors overlap')) {
        return 'the monitor arrangement overlaps; the saved layout ' +
            'was probably created with different resolutions';
    }

    if (text.includes('stale information')) {
        return 'the display configuration changed while applying; try again';
    }

    if (text.includes('closed laptop panel')) {
        return 'the built-in display cannot be activated while the laptop ' +
            'lid is closed; open the lid or save a layout without it';
    }

    if (text.includes('Scale not supported by backend')) {
        return 'this session does not support the saved scaling factor';
    }

    return text;
}
