// Shared constants for the Monitor Layout Switcher planning modules.
//
// Kept dependency-free so every other module (and the tests) can import it
// without pulling in GNOME Shell or GI.

export const PLAN_SCHEMA_VERSION = 2;

export const LAYOUT_MODE_LOGICAL = 1;
export const LAYOUT_MODE_PHYSICAL = 2;

export const ERROR_CODES = {
    EMPTY_LAYOUT: 'EMPTY_LAYOUT',
    MONITOR_MISSING: 'MONITOR_MISSING',
    MODE_UNAVAILABLE: 'MODE_UNAVAILABLE',
    NO_PRIMARY: 'NO_PRIMARY',
    MULTIPLE_PRIMARY: 'MULTIPLE_PRIMARY',
    OVERLAP: 'OVERLAP',
    NOT_ADJACENT: 'NOT_ADJACENT',
    OFFSET: 'OFFSET',
    INVALID_SCALE: 'INVALID_SCALE',
    SCALE_MISMATCH: 'SCALE_MISMATCH',
    MODE_SIZE_MISMATCH: 'MODE_SIZE_MISMATCH',
    EXCEEDS_SCREEN: 'EXCEEDS_SCREEN',
};

export const COMPATIBILITY = {
    READY: 'ready',
    ADJUSTED: 'adjusted',
    WARNING: 'warning',
    UNAVAILABLE: 'unavailable',
    UNKNOWN: 'unknown',
};

// ── Numeric tolerances ──────────────────────────────────────────────────────

export const EPSILON = 1e-6;
export const RATE_TOLERANCE = 0.5;
export const ASPECT_TOLERANCE = 0.02;
export const MAX_DEOVERLAP_ITERATIONS = 64;
export const SNAP_TOLERANCE_RATIO = 0.25;
