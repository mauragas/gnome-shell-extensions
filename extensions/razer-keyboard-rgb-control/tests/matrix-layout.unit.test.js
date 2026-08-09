import assert from 'node:assert/strict';
import test from 'node:test';

import {
  KEYBOARD_EDITOR_KEY_MAP,
  getLegacyKeyboardEditorKeyMapForVersion,
} from '../lib/keyboard-layout.js';
import {
  buildProgrammerModeMatrix,
  createBlankMatrix,
  createModeLayout,
  migrateModeLayoutToCurrentVersion,
  paintKeyById,
  readKeyColorFromLayout,
} from '../lib/matrix-layout.js';
import {
  CUSTOM_MODE_LAYOUT_VERSION,
  PROGRAMMER_MODE_PRESETS,
} from '../lib/presets.js';

const OFF = [0, 0, 0];
const DEBUG_ESC = [255, 36, 36];
const HOT_RED = [255, 0, 0];
const FUNCTION_CYAN = [0, 224, 255];
const NAV_CYAN = [32, 255, 232];
const DIGIT_YELLOW = [255, 214, 10];
const SYMBOL_PINK = [255, 92, 232];
const ACCENT_PINK = [255, 96, 188];
const LETTER_GREEN = [0, 255, 0];
const ORANGE = [255, 128, 0];
const WHITE = [255, 255, 255];
const BLUE = [0, 102, 255];

const EXPECTED_DEBUG_MAP_DEFAULT_FRAME = createModeLayout([
  [OFF, DEBUG_ESC, OFF, FUNCTION_CYAN, HOT_RED, FUNCTION_CYAN, FUNCTION_CYAN, HOT_RED, FUNCTION_CYAN, FUNCTION_CYAN, FUNCTION_CYAN, FUNCTION_CYAN, HOT_RED, FUNCTION_CYAN, FUNCTION_CYAN, ORANGE, NAV_CYAN, NAV_CYAN],
  [OFF, BLUE, DIGIT_YELLOW, DIGIT_YELLOW, DIGIT_YELLOW, DIGIT_YELLOW, DIGIT_YELLOW, DIGIT_YELLOW, DIGIT_YELLOW, DIGIT_YELLOW, DIGIT_YELLOW, DIGIT_YELLOW, ACCENT_PINK, ACCENT_PINK, HOT_RED, NAV_CYAN, FUNCTION_CYAN, BLUE],
  [OFF, HOT_RED, LETTER_GREEN, LETTER_GREEN, LETTER_GREEN, LETTER_GREEN, LETTER_GREEN, LETTER_GREEN, LETTER_GREEN, LETTER_GREEN, LETTER_GREEN, LETTER_GREEN, SYMBOL_PINK, SYMBOL_PINK, WHITE, HOT_RED, NAV_CYAN, BLUE],
  [OFF, BLUE, LETTER_GREEN, LETTER_GREEN, LETTER_GREEN, LETTER_GREEN, LETTER_GREEN, LETTER_GREEN, LETTER_GREEN, LETTER_GREEN, LETTER_GREEN, SYMBOL_PINK, SYMBOL_PINK, OFF, DEBUG_ESC, OFF, OFF, OFF],
  [OFF, BLUE, OFF, LETTER_GREEN, LETTER_GREEN, LETTER_GREEN, LETTER_GREEN, LETTER_GREEN, LETTER_GREEN, LETTER_GREEN, SYMBOL_PINK, SYMBOL_PINK, SYMBOL_PINK, OFF, BLUE, OFF, BLUE, OFF],
  [OFF, BLUE, HOT_RED, BLUE, OFF, OFF, OFF, LETTER_GREEN, OFF, OFF, OFF, BLUE, WHITE, BLUE, BLUE, ORANGE, BLUE, ORANGE],
]).frame;

test('createBlankMatrix returns independent RGB cells', () => {
  const matrix = createBlankMatrix(2, 2);
  matrix[0][0].red = 123;

  assert.deepEqual(matrix[0][1], {red: 0, green: 0, blue: 0});
  assert.deepEqual(matrix[1][0], {red: 0, green: 0, blue: 0});
});

test('buildProgrammerModeMatrix paints representative keys from the preset map', () => {
  const preset = PROGRAMMER_MODE_PRESETS[0];
  const matrix = buildProgrammerModeMatrix(preset);

  assert.deepEqual(matrix[0][1], preset.colors.escape);
  assert.deepEqual(matrix[1][11], preset.colors.digits);
  assert.deepEqual(matrix[3][14], preset.colors.escape);
  assert.deepEqual(matrix[5][7], preset.colors.modifiers);
});

test('buildProgrammerModeMatrix returns the baked-in Debug layout snapshot', () => {
  const preset = PROGRAMMER_MODE_PRESETS.find(modePreset => modePreset.id === 'debug-map');

  assert.ok(preset, 'expected debug-map preset to exist');
  assert.deepEqual(buildProgrammerModeMatrix(preset), EXPECTED_DEBUG_MAP_DEFAULT_FRAME);
});

test('migrateModeLayoutToCurrentVersion remaps legacy coordinates into the current key map', () => {
  const legacyKeyMap = getLegacyKeyboardEditorKeyMapForVersion(2);
  const legacyFrame = createBlankMatrix(6, 18);
  const escColor = {red: 255, green: 0, blue: 0};
  const f3Color = {red: 0, green: 0, blue: 255};

  paintKeyById(legacyFrame, 'esc', escColor, legacyKeyMap);
  paintKeyById(legacyFrame, 'f3', f3Color, legacyKeyMap);

  const migrated = migrateModeLayoutToCurrentVersion(createModeLayout(legacyFrame, [6, 18], 2));

  assert.equal(migrated.version, CUSTOM_MODE_LAYOUT_VERSION);
  assert.deepEqual(
    readKeyColorFromLayout(migrated, KEYBOARD_EDITOR_KEY_MAP.get('esc')),
    escColor
  );
  assert.deepEqual(
    readKeyColorFromLayout(migrated, KEYBOARD_EDITOR_KEY_MAP.get('f3')),
    f3Color
  );
});
