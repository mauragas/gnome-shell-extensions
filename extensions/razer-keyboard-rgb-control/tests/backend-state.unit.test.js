import assert from 'node:assert/strict';
import test from 'node:test';

import {didKeyboardBecomeAvailable} from '../lib/backend-state.js';

test('didKeyboardBecomeAvailable only reports new or replaced keyboards', () => {
    assert.equal(didKeyboardBecomeAvailable({}, {}), false);
    assert.equal(didKeyboardBecomeAvailable({}, {
        keyboard: {serial: 'keyboard-1'},
    }), true);
    assert.equal(didKeyboardBecomeAvailable({
        keyboard: {serial: 'keyboard-1'},
    }, {
        keyboard: {serial: 'keyboard-1'},
    }), false);
    assert.equal(didKeyboardBecomeAvailable({
        keyboard: {serial: 'keyboard-1'},
    }, {
        keyboard: {serial: 'keyboard-2'},
    }), true);
});
