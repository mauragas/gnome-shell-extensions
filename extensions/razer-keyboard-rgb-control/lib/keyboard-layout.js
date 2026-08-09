function createKeyDef(id, label, cells, width = 1) {
    return {id, label, cells, width};
}

function createSpacerDef(width = 0.6) {
    return {id: null, spacer: true, width};
}

const KEYBOARD_NAV_CLUSTER_GAP = 0.5;

const LEGACY_V2_TOP_ROW_FUNCTION_KEY_COLUMNS = Object.freeze({
    f1: 1,
    f2: 2,
    f3: 3,
    f4: 4,
    f5: 6,
    f6: 7,
    f7: 8,
    f8: 9,
    f9: 11,
    f10: 12,
    f11: 13,
    f12: 14,
});

const LEGACY_V3_TOP_ROW_FUNCTION_KEY_COLUMNS = Object.freeze({
    f1: 3,
    f2: 4,
    f3: 5,
    f4: 6,
    f5: 7,
    f6: 8,
    f7: 9,
    f8: 10,
    f9: 11,
    f10: 12,
    f11: 13,
    f12: 14,
});

const ACTUAL_TOP_ROW_FUNCTION_KEY_COLUMNS = Object.freeze({
    f1: 3,
    f2: 4,
    f3: 5,
    f4: 6,
    f5: 7,
    f6: 8,
    f7: 9,
    f8: 10,
    f9: 11,
    f10: 12,
    f11: 13,
    f12: 14,
});

function buildLegacyKeyboardEditorRows(topRowFunctionKeyColumns) {
    return [
        [
            createKeyDef('esc', 'Esc', [[0, 0]], 1),
            createSpacerDef(0.75),
            createKeyDef('f1', 'F1', [[0, topRowFunctionKeyColumns.f1]]),
            createKeyDef('f2', 'F2', [[0, topRowFunctionKeyColumns.f2]]),
            createKeyDef('f3', 'F3', [[0, topRowFunctionKeyColumns.f3]]),
            createKeyDef('f4', 'F4', [[0, topRowFunctionKeyColumns.f4]]),
            createSpacerDef(0.5),
            createKeyDef('f5', 'F5', [[0, topRowFunctionKeyColumns.f5]]),
            createKeyDef('f6', 'F6', [[0, topRowFunctionKeyColumns.f6]]),
            createKeyDef('f7', 'F7', [[0, topRowFunctionKeyColumns.f7]]),
            createKeyDef('f8', 'F8', [[0, topRowFunctionKeyColumns.f8]]),
            createSpacerDef(0.5),
            createKeyDef('f9', 'F9', [[0, topRowFunctionKeyColumns.f9]]),
            createKeyDef('f10', 'F10', [[0, topRowFunctionKeyColumns.f10]]),
            createKeyDef('f11', 'F11', [[0, topRowFunctionKeyColumns.f11]]),
            createKeyDef('f12', 'F12', [[0, topRowFunctionKeyColumns.f12]]),
            createSpacerDef(0.75),
            createKeyDef('print-screen', 'prt sc', [[0, 15]]),
            createKeyDef('scroll-lock', 'scr lk', [[0, 16]]),
            createKeyDef('pause', 'pause', [[0, 17]]),
        ],
        [
            createKeyDef('grave', '`', [[1, 0]]),
            createKeyDef('digit-1', '1', [[1, 1]]),
            createKeyDef('digit-2', '2', [[1, 2]]),
            createKeyDef('digit-3', '3', [[1, 3]]),
            createKeyDef('digit-4', '4', [[1, 4]]),
            createKeyDef('digit-5', '5', [[1, 5]]),
            createKeyDef('digit-6', '6', [[1, 6]]),
            createKeyDef('digit-7', '7', [[1, 7]]),
            createKeyDef('digit-8', '8', [[1, 8]]),
            createKeyDef('digit-9', '9', [[1, 9]]),
            createKeyDef('digit-0', '0', [[1, 10]]),
            createKeyDef('minus', '-', [[1, 11]]),
            createKeyDef('equals', '=', [[1, 12]]),
            createKeyDef('backspace', 'Backspace', [[1, 13], [1, 14]], 2),
            createSpacerDef(KEYBOARD_NAV_CLUSTER_GAP),
            createKeyDef('insert', 'Ins', [[1, 15]]),
            createKeyDef('home', 'Home', [[1, 16]]),
            createKeyDef('page-up', 'PgUp', [[1, 17]]),
        ],
        [
            createKeyDef('tab', 'Tab', [[2, 0], [2, 1]], 1.5),
            createKeyDef('q', 'Q', [[2, 2]]),
            createKeyDef('w', 'W', [[2, 3]]),
            createKeyDef('e', 'E', [[2, 4]]),
            createKeyDef('r', 'R', [[2, 5]]),
            createKeyDef('t', 'T', [[2, 6]]),
            createKeyDef('y', 'Y', [[2, 7]]),
            createKeyDef('u', 'U', [[2, 8]]),
            createKeyDef('i', 'I', [[2, 9]]),
            createKeyDef('o', 'O', [[2, 10]]),
            createKeyDef('p', 'P', [[2, 11]]),
            createKeyDef('bracket-left', '[', [[2, 12]]),
            createKeyDef('bracket-right', ']', [[2, 13]]),
            createKeyDef('backslash', '\\', [[2, 14]], 1.5),
            createSpacerDef(KEYBOARD_NAV_CLUSTER_GAP),
            createKeyDef('delete', 'Del', [[2, 15]]),
            createKeyDef('end', 'End', [[2, 16]]),
            createKeyDef('page-down', 'PgDn', [[2, 17]]),
        ],
        [
            createKeyDef('caps-lock', 'Caps', [[3, 0], [3, 1]], 1.75),
            createKeyDef('a', 'A', [[3, 2]]),
            createKeyDef('s', 'S', [[3, 3]]),
            createKeyDef('d', 'D', [[3, 4]]),
            createKeyDef('f', 'F', [[3, 5]]),
            createKeyDef('g', 'G', [[3, 6]]),
            createKeyDef('h', 'H', [[3, 7]]),
            createKeyDef('j', 'J', [[3, 8]]),
            createKeyDef('k', 'K', [[3, 9]]),
            createKeyDef('l', 'L', [[3, 10]]),
            createKeyDef('semicolon', ';', [[3, 11]]),
            createKeyDef('quote', "'", [[3, 12]]),
            createKeyDef('enter', 'Enter', [[3, 13], [3, 14], [3, 15]], 2.25),
        ],
        [
            createKeyDef('shift-left', 'Shift', [[4, 0], [4, 1]], 2.25),
            createKeyDef('z', 'Z', [[4, 2]]),
            createKeyDef('x', 'X', [[4, 3]]),
            createKeyDef('c', 'C', [[4, 4]]),
            createKeyDef('v', 'V', [[4, 5]]),
            createKeyDef('b', 'B', [[4, 6]]),
            createKeyDef('n', 'N', [[4, 7]]),
            createKeyDef('m', 'M', [[4, 8]]),
            createKeyDef('comma', ',', [[4, 9]]),
            createKeyDef('period', '.', [[4, 10]]),
            createKeyDef('slash', '/', [[4, 11]]),
            createKeyDef('shift-right', 'Shift', [[4, 12], [4, 13], [4, 14]], 2.75),
            createSpacerDef(1.5),
            createKeyDef('arrow-up', '↑', [[4, 16]]),
        ],
        [
            createKeyDef('ctrl-left', 'Ctrl', [[5, 0]], 1.25),
            createKeyDef('win', 'Win', [[5, 1]], 1.25),
            createKeyDef('alt-left', 'Alt', [[5, 2]], 1.25),
            createKeyDef('space', 'Space', [[5, 3], [5, 4], [5, 5], [5, 6], [5, 7], [5, 8], [5, 9]], 6.25),
            createKeyDef('alt-right', 'Alt', [[5, 10]], 1.25),
            createKeyDef('fn', 'Fn', [[5, 11]], 1.25),
            createKeyDef('menu', 'Menu', [[5, 12]], 1.25),
            createKeyDef('ctrl-right', 'Ctrl', [[5, 13]], 1.25),
            createSpacerDef(KEYBOARD_NAV_CLUSTER_GAP),
            createKeyDef('arrow-left', '←', [[5, 15]]),
            createKeyDef('arrow-down', '↓', [[5, 16]]),
            createKeyDef('arrow-right', '→', [[5, 17]]),
        ],
    ];
}

const LEGACY_KEYBOARD_EDITOR_ROWS_V2 = buildLegacyKeyboardEditorRows(LEGACY_V2_TOP_ROW_FUNCTION_KEY_COLUMNS);
const LEGACY_KEYBOARD_EDITOR_ROWS_V3 = buildLegacyKeyboardEditorRows(LEGACY_V3_TOP_ROW_FUNCTION_KEY_COLUMNS);

export const KEYBOARD_EDITOR_ROWS = [
    [
        createKeyDef('esc', 'Esc', [[0, 1]], 1),
        createSpacerDef(0.75),
        createKeyDef('f1', 'F1', [[0, ACTUAL_TOP_ROW_FUNCTION_KEY_COLUMNS.f1]]),
        createKeyDef('f2', 'F2', [[0, ACTUAL_TOP_ROW_FUNCTION_KEY_COLUMNS.f2]]),
        createKeyDef('f3', 'F3', [[0, ACTUAL_TOP_ROW_FUNCTION_KEY_COLUMNS.f3]]),
        createKeyDef('f4', 'F4', [[0, ACTUAL_TOP_ROW_FUNCTION_KEY_COLUMNS.f4]]),
        createSpacerDef(0.5),
        createKeyDef('f5', 'F5', [[0, ACTUAL_TOP_ROW_FUNCTION_KEY_COLUMNS.f5]]),
        createKeyDef('f6', 'F6', [[0, ACTUAL_TOP_ROW_FUNCTION_KEY_COLUMNS.f6]]),
        createKeyDef('f7', 'F7', [[0, ACTUAL_TOP_ROW_FUNCTION_KEY_COLUMNS.f7]]),
        createKeyDef('f8', 'F8', [[0, ACTUAL_TOP_ROW_FUNCTION_KEY_COLUMNS.f8]]),
        createSpacerDef(0.5),
        createKeyDef('f9', 'F9', [[0, ACTUAL_TOP_ROW_FUNCTION_KEY_COLUMNS.f9]]),
        createKeyDef('f10', 'F10', [[0, ACTUAL_TOP_ROW_FUNCTION_KEY_COLUMNS.f10]]),
        createKeyDef('f11', 'F11', [[0, ACTUAL_TOP_ROW_FUNCTION_KEY_COLUMNS.f11]]),
        createKeyDef('f12', 'F12', [[0, ACTUAL_TOP_ROW_FUNCTION_KEY_COLUMNS.f12]]),
        createSpacerDef(0.75),
        createKeyDef('print-screen', 'prt sc', [[0, 15]]),
        createKeyDef('scroll-lock', 'scr lk', [[0, 16]]),
        createKeyDef('pause', 'pause', [[0, 17]]),
    ],
    [
        createKeyDef('grave', '`', [[1, 1]]),
        createKeyDef('digit-1', '1', [[1, 2]]),
        createKeyDef('digit-2', '2', [[1, 3]]),
        createKeyDef('digit-3', '3', [[1, 4]]),
        createKeyDef('digit-4', '4', [[1, 5]]),
        createKeyDef('digit-5', '5', [[1, 6]]),
        createKeyDef('digit-6', '6', [[1, 7]]),
        createKeyDef('digit-7', '7', [[1, 8]]),
        createKeyDef('digit-8', '8', [[1, 9]]),
        createKeyDef('digit-9', '9', [[1, 10]]),
        createKeyDef('digit-0', '0', [[1, 11]]),
        createKeyDef('minus', '-', [[1, 12]]),
        createKeyDef('equals', '=', [[1, 13]]),
        createKeyDef('backspace', 'Backspace', [[1, 14]], 2),
        createSpacerDef(KEYBOARD_NAV_CLUSTER_GAP),
        createKeyDef('insert', 'Ins', [[1, 15]]),
        createKeyDef('home', 'Home', [[1, 16]]),
        createKeyDef('page-up', 'PgUp', [[1, 17]]),
    ],
    [
        createKeyDef('tab', 'Tab', [[2, 1]], 1.5),
        createKeyDef('q', 'Q', [[2, 2]]),
        createKeyDef('w', 'W', [[2, 3]]),
        createKeyDef('e', 'E', [[2, 4]]),
        createKeyDef('r', 'R', [[2, 5]]),
        createKeyDef('t', 'T', [[2, 6]]),
        createKeyDef('y', 'Y', [[2, 7]]),
        createKeyDef('u', 'U', [[2, 8]]),
        createKeyDef('i', 'I', [[2, 9]]),
        createKeyDef('o', 'O', [[2, 10]]),
        createKeyDef('p', 'P', [[2, 11]]),
        createKeyDef('bracket-left', '[', [[2, 12]]),
        createKeyDef('bracket-right', ']', [[2, 13]]),
        createKeyDef('backslash', '\\', [[2, 14]], 1.5),
        createSpacerDef(KEYBOARD_NAV_CLUSTER_GAP),
        createKeyDef('delete', 'Del', [[2, 15]]),
        createKeyDef('end', 'End', [[2, 16]]),
        createKeyDef('page-down', 'PgDn', [[2, 17]]),
    ],
    [
        createKeyDef('caps-lock', 'Caps', [[3, 1]], 1.75),
        createKeyDef('a', 'A', [[3, 2]]),
        createKeyDef('s', 'S', [[3, 3]]),
        createKeyDef('d', 'D', [[3, 4]]),
        createKeyDef('f', 'F', [[3, 5]]),
        createKeyDef('g', 'G', [[3, 6]]),
        createKeyDef('h', 'H', [[3, 7]]),
        createKeyDef('j', 'J', [[3, 8]]),
        createKeyDef('k', 'K', [[3, 9]]),
        createKeyDef('l', 'L', [[3, 10]]),
        createKeyDef('semicolon', ';', [[3, 11]]),
        createKeyDef('quote', "'", [[3, 12]]),
        createKeyDef('enter', 'Enter', [[3, 14]], 2.25),
    ],
    [
        createKeyDef('shift-left', 'Shift', [[4, 1]], 2.25),
        createKeyDef('z', 'Z', [[4, 3]]),
        createKeyDef('x', 'X', [[4, 4]]),
        createKeyDef('c', 'C', [[4, 5]]),
        createKeyDef('v', 'V', [[4, 6]]),
        createKeyDef('b', 'B', [[4, 7]]),
        createKeyDef('n', 'N', [[4, 8]]),
        createKeyDef('m', 'M', [[4, 9]]),
        createKeyDef('comma', ',', [[4, 10]]),
        createKeyDef('period', '.', [[4, 11]]),
        createKeyDef('slash', '/', [[4, 12]]),
        createKeyDef('shift-right', 'Shift', [[4, 14]], 2.75),
        createSpacerDef(1.5),
        createKeyDef('arrow-up', '↑', [[4, 16]]),
    ],
    [
        createKeyDef('ctrl-left', 'Ctrl', [[5, 1]], 1.25),
        createKeyDef('win', 'Win', [[5, 2]], 1.25),
        createKeyDef('alt-left', 'Alt', [[5, 3]], 1.25),
        createKeyDef('space', 'Space', [[5, 7]], 6.25),
        createKeyDef('alt-right', 'Alt', [[5, 11]], 1.25),
        createKeyDef('fn', 'Fn', [[5, 12]], 1.25),
        createKeyDef('menu', 'Menu', [[5, 13]], 1.25),
        createKeyDef('ctrl-right', 'Ctrl', [[5, 14]], 1.25),
        createSpacerDef(KEYBOARD_NAV_CLUSTER_GAP),
        createKeyDef('arrow-left', '←', [[5, 15]]),
        createKeyDef('arrow-down', '↓', [[5, 16]]),
        createKeyDef('arrow-right', '→', [[5, 17]]),
    ],
];

function buildKeyboardEditorKeyMap(rows) {
    return new Map(
        rows
            .flat()
            .filter(keyDef => keyDef.id)
            .map(keyDef => [keyDef.id, keyDef])
    );
}

const LEGACY_KEYBOARD_EDITOR_KEY_MAP_V2 = buildKeyboardEditorKeyMap(LEGACY_KEYBOARD_EDITOR_ROWS_V2);
const LEGACY_KEYBOARD_EDITOR_KEY_MAP_V3 = buildKeyboardEditorKeyMap(LEGACY_KEYBOARD_EDITOR_ROWS_V3);

export const KEYBOARD_EDITOR_KEY_MAP = buildKeyboardEditorKeyMap(KEYBOARD_EDITOR_ROWS);
export const KEYBOARD_EDITOR_UNIT_PX = 30;
export const KEYBOARD_EDITOR_KEY_GAP_PX = 4;
export const KEYBOARD_EDITOR_ROW_HEIGHT_PX = 30;
export const KEYBOARD_EDITOR_ROW_GAP_PX = 6;
const KEYBOARD_EDITOR_PITCH_PX = KEYBOARD_EDITOR_UNIT_PX + KEYBOARD_EDITOR_KEY_GAP_PX;

export function getKeyboardEditorKeyWidthPx(widthUnits = 1) {
    const normalizedWidthUnits = Math.max(1, Number(widthUnits) || 1);
    return normalizedWidthUnits * KEYBOARD_EDITOR_UNIT_PX +
        (normalizedWidthUnits - 1) * KEYBOARD_EDITOR_KEY_GAP_PX;
}

function getKeyboardEditorAdvancePx(widthUnits = 1) {
    const normalizedWidthUnits = Math.max(0, Number(widthUnits) || 0);
    return normalizedWidthUnits * KEYBOARD_EDITOR_PITCH_PX;
}

export function buildKeyboardEditorPreviewLayout(rows = KEYBOARD_EDITOR_ROWS) {
    const rowLayouts = [];
    let keyboardWidthPx = 0;

    for (const [rowIndex, keyRow] of rows.entries()) {
        const y = rowIndex * (KEYBOARD_EDITOR_ROW_HEIGHT_PX + KEYBOARD_EDITOR_ROW_GAP_PX);
        let x = 0;
        const keys = [];

        for (const keyDef of keyRow) {
            const widthUnits = Number(keyDef.width ?? (keyDef.spacer ? 0 : 1));
            if (keyDef.spacer) {
                x += getKeyboardEditorAdvancePx(widthUnits);
                continue;
            }

            keys.push({
                keyDef,
                x,
                y,
                widthPx: getKeyboardEditorKeyWidthPx(widthUnits),
            });
            x += getKeyboardEditorAdvancePx(widthUnits);
        }

        const rowWidthPx = Math.max(0, x - KEYBOARD_EDITOR_KEY_GAP_PX);
        keyboardWidthPx = Math.max(keyboardWidthPx, rowWidthPx);
        rowLayouts.push({y, rowWidthPx, keys});
    }

    return {
        rowLayouts,
        widthPx: keyboardWidthPx,
        heightPx: rows.length * KEYBOARD_EDITOR_ROW_HEIGHT_PX +
            Math.max(0, rows.length - 1) * KEYBOARD_EDITOR_ROW_GAP_PX,
    };
}

export function getLegacyKeyboardEditorKeyMapForVersion(version) {
    return version >= 3
        ? LEGACY_KEYBOARD_EDITOR_KEY_MAP_V3
        : LEGACY_KEYBOARD_EDITOR_KEY_MAP_V2;
}
