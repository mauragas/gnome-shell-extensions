import assert from 'node:assert/strict';
import test from 'node:test';

import {
  KEYBOARD_EDITOR_KEY_GAP_PX,
  KEYBOARD_EDITOR_KEY_MAP,
  KEYBOARD_EDITOR_ROW_GAP_PX,
  KEYBOARD_EDITOR_ROW_HEIGHT_PX,
  KEYBOARD_EDITOR_ROWS,
  buildKeyboardEditorPreviewLayout,
  getKeyboardEditorKeyWidthPx,
  getLegacyKeyboardEditorKeyMapForVersion,
} from '../lib/keyboard-layout.js';

test('authoritative keyboard map keeps critical keys on their real matrix positions', () => {
  assert.deepEqual(KEYBOARD_EDITOR_KEY_MAP.get('esc').cells, [[0, 1]]);
  assert.deepEqual(KEYBOARD_EDITOR_KEY_MAP.get('digit-0').cells, [[1, 11]]);
  assert.deepEqual(KEYBOARD_EDITOR_KEY_MAP.get('enter').cells, [[3, 14]]);
  assert.deepEqual(KEYBOARD_EDITOR_KEY_MAP.get('m').cells, [[4, 9]]);
  assert.deepEqual(KEYBOARD_EDITOR_KEY_MAP.get('space').cells, [[5, 7]]);
});

test('legacy key maps remain available for saved-layout migration', () => {
  assert.deepEqual(getLegacyKeyboardEditorKeyMapForVersion(2).get('esc').cells, [[0, 0]]);
  assert.deepEqual(getLegacyKeyboardEditorKeyMapForVersion(3).get('f3').cells, [[0, 5]]);
});

test('preview layout reports stable keyboard geometry from the row definitions', () => {
  const preview = buildKeyboardEditorPreviewLayout();

  assert.equal(preview.rowLayouts.length, KEYBOARD_EDITOR_ROWS.length);
  assert.equal(
    preview.heightPx,
    KEYBOARD_EDITOR_ROWS.length * KEYBOARD_EDITOR_ROW_HEIGHT_PX +
      (KEYBOARD_EDITOR_ROWS.length - 1) * KEYBOARD_EDITOR_ROW_GAP_PX
  );
  assert.equal(preview.rowLayouts[0].keys[0].keyDef.id, 'esc');
  assert.equal(preview.rowLayouts[0].keys[0].x, 0);
  assert.equal(preview.rowLayouts[0].keys[0].widthPx, getKeyboardEditorKeyWidthPx(1));
  assert.ok(preview.rowLayouts[0].keys[1].x > getKeyboardEditorKeyWidthPx(1) + KEYBOARD_EDITOR_KEY_GAP_PX);
});
