import {DEFAULT_CUSTOM_HUE} from './presets.js';

export const DEFAULT_SELECTION_STATE = Object.freeze({
    selectedColorId: 'green',
    selectedEffectId: null,
    selectedModeId: null,
    selectedBrightnessId: 'brightness-100',
    customHue: DEFAULT_CUSTOM_HUE,
});

export function clampByte(value) {
    const numeric = Number(value);
    if (Number.isNaN(numeric))
        return 0;

    return Math.max(0, Math.min(255, Math.round(numeric)));
}

export function clampBrightness(value) {
    const numeric = Number(value);
    if (Number.isNaN(numeric))
        return 0;

    return Math.max(0, Math.min(100, numeric));
}

export function clampPercent(value, fallback = 0) {
    const numeric = Number(value);
    if (Number.isNaN(numeric))
        return fallback;

    return Math.max(0, Math.min(100, Math.round(numeric)));
}

function clampUnit(value) {
    const numeric = Number(value);
    if (Number.isNaN(numeric))
        return DEFAULT_SELECTION_STATE.customHue;

    return Math.max(0, Math.min(1, numeric));
}

export function normalizeMatrixDimensions(value) {
    if (!Array.isArray(value) || value.length < 2)
        return null;

    const rows = Number(value[0]);
    const cols = Number(value[1]);
    if (!Number.isInteger(rows) || !Number.isInteger(cols) || rows <= 0 || cols <= 0)
        return null;

    return [rows, cols];
}

export function normalizeMatrixColor(color) {
    if (Array.isArray(color) && color.length >= 3)
        return color.slice(0, 3).map(clampByte);

    if (typeof color === 'object' && color !== null) {
        return [
            clampByte(color.red),
            clampByte(color.green),
            clampByte(color.blue),
        ];
    }

    return [0, 0, 0];
}

export function normalizeSelectionState(value) {
    const selectedColorId = typeof value?.selectedColorId === 'string' && value.selectedColorId
        ? value.selectedColorId
        : DEFAULT_SELECTION_STATE.selectedColorId;
    const selectedEffectId = typeof value?.selectedEffectId === 'string' && value.selectedEffectId
        ? value.selectedEffectId
        : null;
    const selectedModeId = typeof value?.selectedModeId === 'string' && value.selectedModeId
        ? value.selectedModeId
        : null;
    const selectedBrightnessId = typeof value?.selectedBrightnessId === 'string' && value.selectedBrightnessId
        ? value.selectedBrightnessId
        : DEFAULT_SELECTION_STATE.selectedBrightnessId;

    return {
        selectedColorId,
        selectedEffectId,
        selectedModeId,
        selectedBrightnessId,
        customHue: clampUnit(value?.customHue ?? DEFAULT_SELECTION_STATE.customHue),
    };
}

export function parseLegacySelectionState(raw) {
    switch (raw) {
    case 'static-red':
        return {selectedColorId: 'red'};
    case 'static-green':
        return {selectedColorId: 'green'};
    case 'static-blue':
        return {selectedColorId: 'blue'};
    case 'static-white':
        return {selectedColorId: 'white'};
    case 'breath-green':
        return {
            selectedColorId: 'green',
            selectedEffectId: 'breathe',
        };
    case 'spectrum':
    case 'wave-left':
    case 'wave-right':
    case 'off':
        return {selectedEffectId: raw};
    default:
        break;
    }

    if (typeof raw === 'string' && raw.startsWith('brightness-'))
        return {selectedBrightnessId: raw};

    return {};
}

export function loadSelectionStateFromString(raw) {
    if (!raw)
        return {...DEFAULT_SELECTION_STATE};

    try {
        const parsed = JSON.parse(raw);
        return normalizeSelectionState(parsed);
    } catch {
        return normalizeSelectionState(parseLegacySelectionState(raw));
    }
}

export function serializeSelectionState(selectionState) {
    return JSON.stringify(normalizeSelectionState(selectionState));
}

export function normalizeStoredModeLayout(modeLayout, fallbackRows = 6, fallbackCols = 18) {
    const rows = Number(modeLayout?.rows);
    const cols = Number(modeLayout?.cols);
    const version = Number(modeLayout?.version ?? 1);
    const normalizedRows = Number.isInteger(rows) && rows > 0 ? rows : fallbackRows;
    const normalizedCols = Number.isInteger(cols) && cols > 0 ? cols : fallbackCols;
    const frame = [];

    for (let rowIndex = 0; rowIndex < normalizedRows; rowIndex++) {
        const sourceRow = Array.isArray(modeLayout?.frame?.[rowIndex])
            ? modeLayout.frame[rowIndex]
            : [];
        const row = [];
        for (let colIndex = 0; colIndex < normalizedCols; colIndex++)
            row.push(normalizeMatrixColor(sourceRow[colIndex]));

        frame.push(row);
    }

    return {
        version: Number.isInteger(version) && version > 0 ? version : 1,
        rows: normalizedRows,
        cols: normalizedCols,
        frame,
    };
}

export function parseCustomModeLayouts(raw) {
    if (!raw)
        return {};

    try {
        const parsed = JSON.parse(raw);
        const entries = {};
        for (const [modeId, modeLayout] of Object.entries(parsed ?? {}))
            entries[modeId] = normalizeStoredModeLayout(modeLayout);

        return entries;
    } catch {
        return {};
    }
}

export function serializeCustomModeLayouts(modeLayouts) {
    const normalizedEntries = {};
    for (const [modeId, modeLayout] of Object.entries(modeLayouts ?? {})) {
        const normalized = normalizeStoredModeLayout(modeLayout);
        normalizedEntries[modeId] = {
            version: normalized.version,
            rows: normalized.rows,
            cols: normalized.cols,
            frame: normalized.frame,
        };
    }

    return JSON.stringify(normalizedEntries);
}
