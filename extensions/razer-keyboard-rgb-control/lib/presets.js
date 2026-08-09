function createRgb(red, green, blue) {
    return {red, green, blue};
}

function createPresetFrame(rows) {
    return rows.map(row => row.map(([red, green, blue]) => createRgb(red, green, blue)));
}

// Captured from the live `debug-map` custom mode so a fresh install still restores
// the preferred per-key layout even before custom-mode-layouts is saved again.
const DEBUG_MAP_DEFAULT_FRAME = createPresetFrame([
    [[0, 0, 0], [255, 36, 36], [0, 0, 0], [0, 224, 255], [255, 0, 0], [0, 224, 255], [0, 224, 255], [255, 0, 0], [0, 224, 255], [0, 224, 255], [0, 224, 255], [0, 224, 255], [255, 0, 0], [0, 224, 255], [0, 224, 255], [255, 128, 0], [32, 255, 232], [32, 255, 232]],
    [[0, 0, 0], [0, 102, 255], [255, 214, 10], [255, 214, 10], [255, 214, 10], [255, 214, 10], [255, 214, 10], [255, 214, 10], [255, 214, 10], [255, 214, 10], [255, 214, 10], [255, 214, 10], [255, 96, 188], [255, 96, 188], [255, 0, 0], [32, 255, 232], [0, 224, 255], [0, 102, 255]],
    [[0, 0, 0], [255, 0, 0], [0, 255, 0], [0, 255, 0], [0, 255, 0], [0, 255, 0], [0, 255, 0], [0, 255, 0], [0, 255, 0], [0, 255, 0], [0, 255, 0], [0, 255, 0], [255, 92, 232], [255, 92, 232], [255, 255, 255], [255, 0, 0], [32, 255, 232], [0, 102, 255]],
    [[0, 0, 0], [0, 102, 255], [0, 255, 0], [0, 255, 0], [0, 255, 0], [0, 255, 0], [0, 255, 0], [0, 255, 0], [0, 255, 0], [0, 255, 0], [0, 255, 0], [255, 92, 232], [255, 92, 232], [0, 0, 0], [255, 36, 36], [0, 0, 0], [0, 0, 0], [0, 0, 0]],
    [[0, 0, 0], [0, 102, 255], [0, 0, 0], [0, 255, 0], [0, 255, 0], [0, 255, 0], [0, 255, 0], [0, 255, 0], [0, 255, 0], [0, 255, 0], [255, 92, 232], [255, 92, 232], [255, 92, 232], [0, 0, 0], [0, 102, 255], [0, 0, 0], [0, 102, 255], [0, 0, 0]],
    [[0, 0, 0], [0, 102, 255], [255, 0, 0], [0, 102, 255], [0, 0, 0], [0, 0, 0], [0, 0, 0], [0, 255, 0], [0, 0, 0], [0, 0, 0], [0, 0, 0], [0, 102, 255], [255, 255, 255], [0, 102, 255], [0, 102, 255], [255, 128, 0], [0, 102, 255], [255, 128, 0]],
]);

export const PRIMARY_COLOR_ROWS = [
    [
        {id: 'red', label: 'Red', red: 255, green: 0, blue: 0},
        {id: 'orange', label: 'Orange', red: 255, green: 128, blue: 0},
        {id: 'yellow', label: 'Yellow', red: 255, green: 214, blue: 10},
        {id: 'green', label: 'Green', red: 0, green: 255, blue: 0},
        {id: 'cyan', label: 'Cyan', red: 0, green: 224, blue: 255},
    ],
    [
        {id: 'blue', label: 'Blue', red: 0, green: 102, blue: 255},
        {id: 'purple', label: 'Purple', red: 124, green: 92, blue: 255},
        {id: 'pink', label: 'Pink', red: 255, green: 96, blue: 188},
        {id: 'white', label: 'White', red: 255, green: 255, blue: 255},
        {id: 'slate', label: 'Slate', red: 148, green: 163, blue: 184},
    ],
];

export const PROGRAMMER_MODE_PRESETS = [
    {
        id: 'syntax-map',
        label: 'Syntax',
        colors: {
            escape: createRgb(255, 40, 40),
            functionKeys: createRgb(136, 214, 255),
            functionPrimary: createRgb(255, 246, 84),
            functionSecondary: createRgb(255, 164, 64),
            letters: createRgb(34, 255, 110),
            digits: createRgb(255, 232, 48),
            symbols: createRgb(64, 246, 255),
            modifiers: createRgb(214, 124, 255),
            navigation: createRgb(128, 244, 255),
        },
    },
    {
        id: 'debug-map',
        label: 'Debug',
        colors: {
            escape: createRgb(255, 36, 36),
            functionKeys: createRgb(0, 224, 255),
            functionPrimary: createRgb(255, 0, 0),
            functionSecondary: createRgb(255, 0, 0),
            letters: createRgb(0, 255, 0),
            digits: createRgb(255, 214, 10),
            symbols: createRgb(255, 92, 232),
            modifiers: createRgb(180, 96, 255),
            navigation: createRgb(32, 255, 232),
        },
        frame: DEBUG_MAP_DEFAULT_FRAME,
    },
    {
        id: 'flow-map',
        label: 'Flow',
        colors: {
            escape: createRgb(255, 54, 46),
            functionKeys: createRgb(156, 210, 255),
            functionPrimary: createRgb(92, 255, 238),
            functionSecondary: createRgb(255, 186, 82),
            letters: createRgb(72, 255, 136),
            digits: createRgb(255, 232, 84),
            symbols: createRgb(255, 204, 96),
            modifiers: createRgb(206, 138, 255),
            navigation: createRgb(220, 250, 255),
        },
    },
];

export const DEFAULT_CUSTOM_HUE = 1 / 3;
export const CUSTOM_MODE_LAYOUT_VERSION = 4;

export function flattenPresetRows(rows) {
    const presets = [];
    for (const row of rows)
        presets.push(...row);

    return presets;
}

export const ALL_COLOR_PRESETS = flattenPresetRows(PRIMARY_COLOR_ROWS);
export const COLOR_PRESET_MAP = new Map(ALL_COLOR_PRESETS.map(preset => [preset.id, preset]));
