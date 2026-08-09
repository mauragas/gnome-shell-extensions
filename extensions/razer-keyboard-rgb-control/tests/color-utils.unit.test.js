import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildColorChipStyle,
  buildCustomColorPreset,
  buildKeyboardEditorKeyStyle,
  clampUnit,
  cssRgb,
  getReadableTextColor,
  hsvToRgb,
  rgbToHex,
} from '../lib/color-utils.js';
import {
  KEYBOARD_EDITOR_ROW_HEIGHT_PX,
  KEYBOARD_EDITOR_UNIT_PX,
} from '../lib/keyboard-layout.js';
import {DEFAULT_CUSTOM_HUE} from '../lib/presets.js';

test('clampUnit falls back to the default custom hue and bounds values', () => {
  assert.equal(clampUnit('not-a-number'), DEFAULT_CUSTOM_HUE);
  assert.equal(clampUnit(-1), 0);
  assert.equal(clampUnit(2), 1);
});

test('hsvToRgb and buildCustomColorPreset generate stable RGB and hex values', () => {
  assert.deepEqual(hsvToRgb(1 / 3), {red: 0, green: 255, blue: 0});
  assert.equal(rgbToHex(255, 214, 10), '#FFD60A');
  assert.equal(cssRgb(12, 34, 56), 'rgb(12, 34, 56)');

  const customColor = buildCustomColorPreset(1 / 3);
  assert.equal(customColor.id, 'custom');
  assert.equal(customColor.label, 'Custom');
  assert.equal(customColor.hex, '#00FF00');
  assert.deepEqual(
    {red: customColor.red, green: customColor.green, blue: customColor.blue},
    {red: 0, green: 255, blue: 0}
  );
});

test('style builders emit readable color and keyboard dimensions', () => {
  assert.equal(
    getReadableTextColor({red: 255, green: 255, blue: 255}),
    'rgba(18, 18, 24, 0.98)'
  );
  assert.equal(
    getReadableTextColor({red: 0, green: 0, blue: 0}),
    'rgba(255, 255, 255, 0.98)'
  );

  const chipStyle = buildColorChipStyle({red: 255, green: 0, blue: 0}, true);
  assert.match(chipStyle, /background-color: rgb\(255, 0, 0\);/);
  assert.match(chipStyle, /border: 2px solid rgba\(255, 255, 255, 0.98\);/);

  const keyStyle = buildKeyboardEditorKeyStyle(
    {red: 0, green: 255, blue: 0},
    true,
    KEYBOARD_EDITOR_UNIT_PX * 2
  );
  assert.match(keyStyle, new RegExp(`width: ${KEYBOARD_EDITOR_UNIT_PX * 2}px;`));
  assert.match(keyStyle, new RegExp(`height: ${KEYBOARD_EDITOR_ROW_HEIGHT_PX}px;`));
  assert.match(keyStyle, /background-color: rgb\(0, 255, 0\);/);
});
