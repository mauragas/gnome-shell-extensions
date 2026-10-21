// Pure, dependency-free monitor layout planning for Monitor Layout Switcher.
//
// Everything here operates on plain JavaScript objects so it can be unit
// tested with `node --test` without a running GNOME Shell session. GVariant
// parsing lives in `shared.js` and produces the shapes documented below.
//
// The implementation is split by concern:
//   constants.js      – schema version, layout modes, error codes, tolerances
//   modes.js          – mode parsing and scale resolution
//   geometry.js       – preview rects, rectangle math and reflow strategies
//   layout-schema.js  – normalisation/migration and monitor identity matching
//   plan.js           – plan building and Mutter-compatible validation
//   messages.js       – user-facing status and error text
//
// This module re-exports the public API so callers and tests have a single
// stable import path.
//
// ── State shape ─────────────────────────────────────────────────────────────
//   {
//     serial: number,
//     capabilities: {
//       renderer: 'xrandr' | 'native' | string,
//       layoutMode: 1 | 2,              // 1 = LOGICAL, 2 = PHYSICAL
//       globalScaleRequired: boolean,
//       legacyUiScalingFactor: number,
//       maxScreenSize: {width, height} | null,
//       supportsChangingLayoutMode: boolean,
//       fractionalScaling: boolean,
//     },
//     monitors: [{
//       connector, vendor, product, serial, isBuiltin,
//       mode, allModeIds,
//       modes: [{id, width, height, rate, scale, supportedScales}],
//       transform, scale, active, isPrimary, x, y,
//     }],
//   }
//
// ── Layout shape (schema v2) ────────────────────────────────────────────────
//   {
//     id, name, schemaVersion: 2,
//     monitors: [{
//       identity: {vendor, product, serial},
//       savedConnector, isBuiltin, transform, scale,
//       modeHint: {width, height, rate},
//       savedModeId,
//       preferredSize: {width, height},   // logical size, post-transform
//       layout: {x, y, isPrimary},
//     }],
//   }

export {
    COMPATIBILITY,
    ERROR_CODES,
    LAYOUT_MODE_LOGICAL,
    LAYOUT_MODE_PHYSICAL,
    PLAN_SCHEMA_VERSION,
} from './constants.js';

export {
    capabilitiesOf,
    isRotatedTransform,
    parseModeId,
    rectSizeForMode,
    renderedModeSize,
    resolveMode,
    resolveScales,
} from './modes.js';

export {
    fitPreviewRects,
    layoutPreviewRects,
    reflow,
    statePreviewRects,
} from './geometry.js';

export {
    connectorKey,
    connectorsLooselyMatch,
    createLayoutFromState,
    normalizeLayout,
    normalizeLayouts,
    resolveIdentities,
} from './layout-schema.js';

export {
    buildPlan,
    layoutMatchesState,
    toLogicalMonitorTuples,
    validatePlan,
} from './plan.js';

export {
    describeDegraded,
    describeLayoutCompatibility,
    explainDbusError,
    formatPlanError,
} from './messages.js';
