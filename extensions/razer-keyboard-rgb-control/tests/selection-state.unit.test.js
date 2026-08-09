import assert from 'node:assert/strict';
import test from 'node:test';

import {
    DEFAULT_SELECTION_STATE,
    loadSelectionStateFromString,
    parseCustomModeLayouts,
    serializeCustomModeLayouts,
    serializeSelectionState,
} from '../lib/selection-state.js';

test('loadSelectionStateFromString returns defaults for empty input and normalizes legacy values', () => {
    assert.equal(loadSelectionStateFromString('').selectedColorId, DEFAULT_SELECTION_STATE.selectedColorId);

    const legacy = loadSelectionStateFromString('breath-green');
    assert.equal(legacy.selectedColorId, 'green');
    assert.equal(legacy.selectedEffectId, 'breathe');
});

test('serializeSelectionState ignores retired fields while preserving keyboard selections', () => {
    const serialized = serializeSelectionState({
        selectedColorId: 'custom',
        customHue: 2,
        legacyAccentId: 'cyan',
        legacyModeFlag: 'auto',
    });
    const roundTripped = loadSelectionStateFromString(serialized);

    assert.equal(roundTripped.selectedColorId, 'custom');
    assert.equal(roundTripped.customHue, 1);
    assert.equal('legacyAccentId' in roundTripped, false);
    assert.equal('legacyModeFlag' in roundTripped, false);
});

test('loadSelectionStateFromString ignores unknown legacy properties in stored JSON', () => {
    const state = loadSelectionStateFromString(JSON.stringify({
        selectedColorId: 'blue',
        selectedBrightnessId: 'brightness-50',
        legacyEnabled: false,
        legacyLevel: 80,
        legacyProfile: {
            low: 50,
            high: 90,
        },
    }));

    assert.deepEqual(state, {
        ...DEFAULT_SELECTION_STATE,
        selectedColorId: 'blue',
        selectedBrightnessId: 'brightness-50',
    });
});

test('parseCustomModeLayouts and serializeCustomModeLayouts normalize invalid frames', () => {
    const parsed = parseCustomModeLayouts(JSON.stringify({
        syntax: {
            version: '2',
            rows: 2,
            cols: 3,
            frame: [
                [
                    {red: 300, green: -2, blue: 4},
                    [5, 6, 7],
                ],
            ],
        },
    }));

    assert.deepEqual(parsed.syntax, {
        version: 2,
        rows: 2,
        cols: 3,
        frame: [
            [
                [255, 0, 4],
                [5, 6, 7],
                [0, 0, 0],
            ],
            [
                [0, 0, 0],
                [0, 0, 0],
                [0, 0, 0],
            ],
        ],
    });

    assert.equal(
        serializeCustomModeLayouts(parsed),
        JSON.stringify({
            syntax: parsed.syntax,
        })
    );
});
