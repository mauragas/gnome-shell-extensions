// Pure helpers that turn a saved selection state into concrete lighting values.
// Kept free of gi:// imports so the GNOME Shell extension, the GJS boot-time
// restorer, and the Node unit tests can all share the same resolution logic.

import {buildCustomColorPreset} from './color-utils.js';
import {buildProgrammerModeMatrix} from './matrix-layout.js';
import {COLOR_PRESET_MAP, DEFAULT_CUSTOM_HUE, PROGRAMMER_MODE_PRESETS} from './presets.js';

export const DEFAULT_MATRIX_DIMENSIONS = [6, 18];
const FALLBACK_COLOR_ID = 'green';

function normalizeMatrixDimensions(value) {
    if (Array.isArray(value) && value.length >= 2) {
        const rows = Number(value[0]);
        const cols = Number(value[1]);
        if (Number.isInteger(rows) && Number.isInteger(cols) && rows > 0 && cols > 0)
            return [rows, cols];
    }

    return DEFAULT_MATRIX_DIMENSIONS;
}

function layoutMatchesDimensions(layout, dimensions) {
    if (!Number.isInteger(layout?.rows) || !Number.isInteger(layout?.cols))
        return true;

    return layout.rows === dimensions[0] && layout.cols === dimensions[1];
}

export function resolveSelectionColor(selectionState) {
    if (selectionState?.selectedColorId === 'custom')
        return buildCustomColorPreset(selectionState.customHue);

    return COLOR_PRESET_MAP.get(selectionState?.selectedColorId)
        ?? COLOR_PRESET_MAP.get(FALLBACK_COLOR_ID)
        ?? buildCustomColorPreset(DEFAULT_CUSTOM_HUE);
}

export function resolveModeLayoutFrame(modeId, customModeLayouts = {}, matrixDimensions = DEFAULT_MATRIX_DIMENSIONS) {
    if (!modeId)
        return null;

    const dimensions = normalizeMatrixDimensions(matrixDimensions);

    const storedLayout = customModeLayouts?.[modeId];
    if (storedLayout?.frame && layoutMatchesDimensions(storedLayout, dimensions))
        return storedLayout.frame;

    const modePreset = PROGRAMMER_MODE_PRESETS.find(preset => preset.id === modeId);
    if (!modePreset)
        return null;

    return buildProgrammerModeMatrix(modePreset, dimensions);
}

export function getBrightnessPercent(selectionState) {
    const match = /^brightness-(\d+)$/.exec(selectionState?.selectedBrightnessId ?? '');
    if (!match)
        return null;

    const percent = Number.parseInt(match[1], 10);
    if (Number.isNaN(percent))
        return null;

    return Math.max(0, Math.min(100, percent));
}
