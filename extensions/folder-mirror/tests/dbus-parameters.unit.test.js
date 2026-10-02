import assert from 'node:assert/strict';
import test from 'node:test';

import {unpackDbusParameters} from '../lib/dbus-parameters.js';

test('unpackDbusParameters uses deepUnpack when a GVariant-like object is provided', () => {
    const parameters = {
        deepUnpack() {
            return ['alpha'];
        },
    };

    assert.deepEqual(unpackDbusParameters(parameters), ['alpha']);
});

test('unpackDbusParameters falls back to recursiveUnpack when deepUnpack is unavailable', () => {
    const parameters = {
        recursiveUnpack() {
            return ['beta'];
        },
    };

    assert.deepEqual(unpackDbusParameters(parameters), ['beta']);
});

test('unpackDbusParameters preserves already-unpacked arrays', () => {
    assert.deepEqual(unpackDbusParameters(['gamma']), ['gamma']);
});

test('unpackDbusParameters wraps scalar parameters for single-argument methods', () => {
    assert.deepEqual(unpackDbusParameters('delta'), ['delta']);
});

test('unpackDbusParameters returns an empty list for nullish parameters', () => {
    assert.deepEqual(unpackDbusParameters(null), []);
    assert.deepEqual(unpackDbusParameters(undefined), []);
});
