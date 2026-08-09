import {CUSTOM_MODE_LAYOUT_VERSION} from './presets.js';
import {
    KEYBOARD_EDITOR_KEY_MAP,
    getLegacyKeyboardEditorKeyMapForVersion,
} from './keyboard-layout.js';

function cloneColor(color) {
    if (Array.isArray(color)) {
        return {
            red: Number(color[0] ?? 0),
            green: Number(color[1] ?? 0),
            blue: Number(color[2] ?? 0),
        };
    }

    return {
        red: Number(color?.red ?? 0),
        green: Number(color?.green ?? 0),
        blue: Number(color?.blue ?? 0),
    };
}

export function createBlankMatrix(rows, cols) {
    return Array.from({length: rows}, () =>
        Array.from({length: cols}, () => ({red: 0, green: 0, blue: 0})));
}

export function paintCell(matrix, row, col, color) {
    if (row < 0 || row >= matrix.length)
        return;

    if (col < 0 || col >= matrix[row].length)
        return;

    matrix[row][col] = cloneColor(color);
}

export function paintCells(matrix, row, cols, color) {
    for (const col of cols)
        paintCell(matrix, row, col, color);
}

export function paintSegment(matrix, row, startCol, endCol, color) {
    if (row < 0 || row >= matrix.length)
        return;

    const clampedStart = Math.max(0, startCol);
    const clampedEnd = Math.min(matrix[row].length - 1, endCol);
    for (let col = clampedStart; col <= clampedEnd; col++)
        matrix[row][col] = cloneColor(color);
}

export function paintKeyById(matrix, keyId, color, keyMap = KEYBOARD_EDITOR_KEY_MAP) {
    const keyDef = keyMap.get(keyId);
    if (!keyDef)
        return;

    for (const [row, col] of keyDef.cells)
        paintCell(matrix, row, col, color);
}

export function paintKeysById(matrix, keyIds, color, keyMap = KEYBOARD_EDITOR_KEY_MAP) {
    for (const keyId of keyIds)
        paintKeyById(matrix, keyId, color, keyMap);
}

export function buildProgrammerModeMatrix(modePreset, matrixDimensions = [6, 18]) {
    const [rows, cols] = Array.isArray(matrixDimensions) && matrixDimensions.length >= 2
        ? matrixDimensions
        : [6, 18];

    if (Array.isArray(modePreset?.frame) &&
        modePreset.frame.length === rows &&
        modePreset.frame.every(row => Array.isArray(row) && row.length === cols)) {
        return cloneMatrixFrame(modePreset.frame);
    }

    const matrix = createBlankMatrix(rows, cols);
    const colors = modePreset.colors;

    paintKeyById(matrix, 'esc', colors.escape);
    paintKeysById(matrix, [
        'f1', 'f3', 'f4', 'f6', 'f7', 'f8', 'f9', 'f11', 'f12',
    ], colors.functionKeys);
    paintKeysById(matrix, ['f2', 'f10'], colors.functionPrimary);
    paintKeyById(matrix, 'f5', colors.functionSecondary);
    paintKeysById(matrix, ['print-screen', 'scroll-lock', 'pause'], colors.navigation);

    paintKeysById(matrix, ['grave', 'backspace'], colors.modifiers);
    paintKeysById(matrix, [
        'digit-1', 'digit-2', 'digit-3', 'digit-4', 'digit-5',
        'digit-6', 'digit-7', 'digit-8', 'digit-9', 'digit-0',
    ], colors.digits);
    paintKeysById(matrix, ['minus', 'equals'], colors.symbols);
    paintKeysById(matrix, ['insert', 'home', 'page-up'], colors.navigation);

    paintKeyById(matrix, 'tab', colors.modifiers);
    paintKeysById(matrix, ['q', 'w', 'e', 'r', 't', 'y', 'u', 'i', 'o', 'p'], colors.letters);
    paintKeysById(matrix, ['bracket-left', 'bracket-right', 'backslash'], colors.symbols);
    paintKeysById(matrix, ['delete', 'end', 'page-down'], colors.navigation);

    paintKeyById(matrix, 'caps-lock', colors.modifiers);
    paintKeysById(matrix, ['a', 's', 'd', 'f', 'g', 'h', 'j', 'k', 'l'], colors.letters);
    paintKeysById(matrix, ['semicolon', 'quote'], colors.symbols);
    paintKeyById(matrix, 'enter', colors.escape);

    paintKeysById(matrix, ['shift-left', 'shift-right'], colors.modifiers);
    paintKeysById(matrix, ['z', 'x', 'c', 'v', 'b', 'n', 'm'], colors.letters);
    paintKeysById(matrix, ['comma', 'period', 'slash'], colors.symbols);
    paintKeyById(matrix, 'arrow-up', colors.navigation);

    paintKeyById(matrix, 'win', colors.escape);
    paintKeysById(matrix, [
        'ctrl-left', 'alt-left', 'space', 'alt-right', 'fn', 'menu', 'ctrl-right',
    ], colors.modifiers);
    paintKeysById(matrix, ['arrow-left', 'arrow-down', 'arrow-right'], colors.navigation);

    return matrix;
}

export function cloneMatrixFrame(frame) {
    return frame.map(row => row.map(color => cloneColor(color)));
}

export function migrateModeLayoutToCurrentVersion(modeLayout) {
    if (!modeLayout)
        return null;

    if (modeLayout.version >= CUSTOM_MODE_LAYOUT_VERSION) {
        return createModeLayout(
            modeLayout.frame,
            [modeLayout.rows, modeLayout.cols],
            modeLayout.version
        );
    }

    const legacyKeyMap = getLegacyKeyboardEditorKeyMapForVersion(modeLayout.version ?? 1);
    const frame = createBlankMatrix(modeLayout.rows, modeLayout.cols);

    for (const [keyId, currentKeyDef] of KEYBOARD_EDITOR_KEY_MAP.entries()) {
        const legacyKeyDef = legacyKeyMap.get(keyId);
        if (!legacyKeyDef)
            continue;

        const color = readKeyColorFromLayout(modeLayout, legacyKeyDef);
        for (const [row, col] of currentKeyDef.cells)
            paintCell(frame, row, col, color);
    }

    return createModeLayout(frame, [modeLayout.rows, modeLayout.cols], CUSTOM_MODE_LAYOUT_VERSION);
}

export function migrateCustomModeLayouts(modeLayouts) {
    let changed = false;
    const nextLayouts = {};

    for (const [modeId, modeLayout] of Object.entries(modeLayouts ?? {})) {
        if (modeLayout?.version >= CUSTOM_MODE_LAYOUT_VERSION) {
            nextLayouts[modeId] = modeLayout;
            continue;
        }

        nextLayouts[modeId] = migrateModeLayoutToCurrentVersion(modeLayout);
        changed = true;
    }

    return {layouts: nextLayouts, changed};
}

export function createModeLayout(frame, matrixDimensions = [6, 18], version = CUSTOM_MODE_LAYOUT_VERSION) {
    const [rows, cols] = Array.isArray(matrixDimensions) && matrixDimensions.length >= 2
        ? matrixDimensions
        : [6, 18];

    return {
        version,
        rows,
        cols,
        frame: cloneMatrixFrame(frame),
    };
}

export function readKeyColorFromLayout(modeLayout, keyDef) {
    if (!modeLayout?.frame || !Array.isArray(keyDef?.cells) || keyDef.cells.length === 0)
        return {red: 0, green: 0, blue: 0};

    let red = 0;
    let green = 0;
    let blue = 0;
    let samples = 0;

    for (const [row, col] of keyDef.cells) {
        const color = modeLayout.frame?.[row]?.[col];
        if (!color)
            continue;

        red += Number(color.red ?? 0);
        green += Number(color.green ?? 0);
        blue += Number(color.blue ?? 0);
        samples++;
    }

    if (samples === 0)
        return {red: 0, green: 0, blue: 0};

    return {
        red: Math.round(red / samples),
        green: Math.round(green / samples),
        blue: Math.round(blue / samples),
    };
}

export function paintKeyCells(modeLayout, keyDef, color) {
    for (const [row, col] of keyDef.cells)
        paintCell(modeLayout.frame, row, col, color);
}
