import assert from 'node:assert/strict';
import test from 'node:test';

import {
    createProfileTemplate,
    duplicateProfile,
    loadGlobalExcludesFromString,
    loadProfilesFromString,
    removeProfileFromList,
    replaceProfile,
    serializeProfiles,
    setProfilePaused,
    validateProfiles,
} from '../lib/profile-store.js';

test('loadProfilesFromString normalizes paths, ids, and booleans', () => {
    const profiles = loadProfilesFromString(JSON.stringify([
        {
            id: 'demo',
            name: ' Demo ',
            enabled: 'true',
            sourcePath: '/tmp/source/',
            targetPath: '/tmp/target/',
            mode: 'two-way',
            excludeRules: ['.git'],
        },
    ]));

    assert.equal(profiles.length, 1);
    assert.equal(profiles[0].name, 'Demo');
    assert.equal(profiles[0].sourcePath, '/tmp/source');
    assert.equal(profiles[0].targetPath, '/tmp/target');
    assert.equal(profiles[0].excludeRules[0].pattern, '.git');
});

test('createProfileTemplate returns a valid editable profile shell', () => {
    const profile = createProfileTemplate({name: 'My Mirror'});
    assert.equal(profile.name, 'My Mirror');
    assert.equal(profile.enabled, true);
    assert.equal(profile.deleteProtection, true);
    assert.equal(Array.isArray(profile.excludeRules), true);
});

test('duplicateProfile clones the source profile with a distinct id and name', () => {
    const original = createProfileTemplate({id: 'alpha', name: 'Source'});
    const profiles = duplicateProfile([original], 'alpha');

    assert.equal(profiles.length, 2);
    assert.notEqual(profiles[0].id, profiles[1].id);
    assert.equal(profiles[1].name, 'Source Copy');
});

test('replaceProfile and removeProfileFromList update profile lists predictably', () => {
    const base = createProfileTemplate({id: 'alpha', name: 'A'});
    const replaced = replaceProfile([base], {...base, name: 'B'});
    assert.equal(replaced[0].name, 'B');

    const removed = removeProfileFromList(replaced, 'alpha');
    assert.equal(removed.length, 0);
});

test('setProfilePaused toggles the paused state without mutating other profiles', () => {
    const first = createProfileTemplate({id: 'alpha', name: 'A'});
    const second = createProfileTemplate({id: 'beta', name: 'B'});
    const updated = setProfilePaused([first, second], 'beta', true);

    assert.equal(updated[0].paused, false);
    assert.equal(updated[1].paused, true);
});

test('validateProfiles returns human-readable errors for invalid profiles', () => {
    const invalid = createProfileTemplate({
        id: 'alpha',
        name: 'Broken',
        sourcePath: '/tmp/shared',
        targetPath: '/tmp/shared',
    });
    const validation = validateProfiles([invalid]);

    assert.equal(validation.length, 1);
    assert.match(validation[0].errors[0], /different/u);
});

test('serializeProfiles round-trips normalized data', () => {
    const source = createProfileTemplate({
        id: 'alpha',
        name: 'Persisted',
        sourcePath: '/tmp/source',
        targetPath: '/tmp/target',
    });

    const roundTrip = loadProfilesFromString(serializeProfiles([source]));
    assert.equal(roundTrip[0].name, 'Persisted');
    assert.equal(roundTrip[0].sourcePath, '/tmp/source');
});

test('loadGlobalExcludesFromString falls back to the development defaults', () => {
    const rules = loadGlobalExcludesFromString('');
    assert.ok(rules.some(rule => rule.pattern === '.git'));
});
