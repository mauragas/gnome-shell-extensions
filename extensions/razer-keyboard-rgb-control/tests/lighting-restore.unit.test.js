import assert from 'node:assert/strict';
import test from 'node:test';

import {
    DEFAULT_MATRIX_DIMENSIONS,
    getBrightnessPercent,
    resolveModeLayoutFrame,
    resolveSelectionColor,
} from '../lib/lighting-restore.js';
import {buildCustomColorPreset} from '../lib/color-utils.js';
import {buildProgrammerModeMatrix} from '../lib/matrix-layout.js';
import {CUSTOM_MODE_LAYOUT_VERSION, COLOR_PRESET_MAP, PROGRAMMER_MODE_PRESETS} from '../lib/presets.js';

test('resolveSelectionColor resolves named presets', () => {
    const red = COLOR_PRESET_MAP.get('red');
    assert.deepEqual(resolveSelectionColor({selectedColorId: 'red'}), red);
});

test('resolveSelectionColor resolves custom hue via buildCustomColorPreset', () => {
    const resolved = resolveSelectionColor({selectedColorId: 'custom', customHue: 0.5});
    assert.deepEqual(resolved, buildCustomColorPreset(0.5));
});

test('resolveSelectionColor falls back to green for unknown ids', () => {
    assert.deepEqual(resolveSelectionColor({selectedColorId: 'nope'}), COLOR_PRESET_MAP.get('green'));
});

test('resolveModeLayoutFrame uses a stored layout that matches the dimensions', () => {
    const stored = {rows: 6, cols: 18, frame: [[[1, 2, 3]]]};
    const frame = resolveModeLayoutFrame('syntax-map', {'syntax-map': stored}, [6, 18]);
    assert.equal(frame, stored.frame);
});

test('resolveModeLayoutFrame falls back to the built preset when dimensions differ', () => {
    const stored = {rows: 4, cols: 4, frame: [[[1, 2, 3]]]};
    const modePreset = PROGRAMMER_MODE_PRESETS.find(preset => preset.id === 'syntax-map');
    const expected = buildProgrammerModeMatrix(modePreset, DEFAULT_MATRIX_DIMENSIONS);
    assert.deepEqual(resolveModeLayoutFrame('syntax-map', {'syntax-map': stored}, [6, 18]), expected);
});

test('resolveModeLayoutFrame returns null for unknown or missing modes', () => {
    assert.equal(resolveModeLayoutFrame(null, {}, [6, 18]), null);
    assert.equal(resolveModeLayoutFrame('does-not-exist', {}, [6, 18]), null);
});

test('resolveModeLayoutFrame builds a fresh layout from the debug-map baked-in frame', () => {
    const modePreset = PROGRAMMER_MODE_PRESETS.find(preset => preset.id === 'debug-map');
    assert.equal(modePreset.frame.length, 6);
    assert.equal(modePreset.frame[0].length, 18);
    assert.equal(typeof CUSTOM_MODE_LAYOUT_VERSION, 'number');
});

test('getBrightnessPercent parses brightness preset ids', () => {
    assert.equal(getBrightnessPercent({selectedBrightnessId: 'brightness-75'}), 75);
    assert.equal(getBrightnessPercent({selectedBrightnessId: 'brightness-0'}), 0);
    assert.equal(getBrightnessPercent({selectedBrightnessId: 'brightness-100'}), 100);
});

test('getBrightnessPercent clamps and returns null for invalid ids', () => {
    assert.equal(getBrightnessPercent({selectedBrightnessId: 'brightness-250'}), 100);
    assert.equal(getBrightnessPercent({selectedBrightnessId: 'static-red'}), null);
    assert.equal(getBrightnessPercent({}), null);
});
