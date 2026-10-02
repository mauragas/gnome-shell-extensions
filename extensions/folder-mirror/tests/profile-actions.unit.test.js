import assert from 'node:assert/strict';
import test from 'node:test';

import {buildProfileMenuActions, isProfilePaused, isProfileSyncing} from '../lib/profile-actions.js';

test('buildProfileMenuActions exposes Sync now plus Pause for active profiles', () => {
    const actions = buildProfileMenuActions({
        name: 'Exercises VM Mirror',
        status: 'watching',
        paused: false,
    });

    assert.equal(actions.syncAction.label, 'Sync now');
    assert.equal(actions.syncAction.iconName, 'view-refresh-symbolic');
    assert.equal(actions.syncAction.methodName, 'RunProfile');
    assert.match(actions.syncAction.notification, /Triggered a sync/u);

    assert.equal(actions.controlAction.label, 'Pause');
    assert.equal(actions.controlAction.iconName, 'media-playback-pause-symbolic');
    assert.equal(actions.controlAction.methodName, 'PauseProfile');
});

test('buildProfileMenuActions exposes Resume for paused profiles', () => {
    const actions = buildProfileMenuActions({
        name: 'Gym Planner VM Mirror',
        status: 'paused',
        paused: true,
    });

    assert.equal(actions.controlAction.label, 'Resume');
    assert.equal(actions.controlAction.iconName, 'media-playback-start-symbolic');
    assert.equal(actions.controlAction.methodName, 'ResumeProfile');
    assert.equal(actions.controlAction.notification, 'Resumed Gym Planner VM Mirror.');
});

test('buildProfileMenuActions shows disabled syncing feedback while a manual sync is in progress', () => {
    const actions = buildProfileMenuActions({
        name: 'Resolvio Container Mirror',
        status: 'syncing',
        paused: false,
    }, {
        syncAnimationFrame: 2,
    });

    assert.equal(actions.syncAction.label, 'Syncing -');
    assert.equal(actions.syncAction.iconName, 'emblem-synchronizing-symbolic');
    assert.equal(actions.syncAction.enabled, false);
    assert.equal(actions.controlAction.label, 'Pause');
});

test('buildProfileMenuActions keeps Resume available when a paused profile is finishing a sync', () => {
    const actions = buildProfileMenuActions({
        name: 'Queued Mirror',
        status: 'syncing',
        paused: true,
    }, {
        syncAnimationFrame: 1,
    });

    assert.equal(actions.syncAction.label, 'Syncing /');
    assert.equal(actions.controlAction.label, 'Resume');
});

test('isProfilePaused prefers the paused flag even if status has not caught up yet', () => {
    assert.equal(isProfilePaused({status: 'watching', paused: true}), true);
    assert.equal(isProfilePaused({status: 'paused', paused: false}), true);
    assert.equal(isProfilePaused({status: 'syncing', paused: false}), false);
});

test('isProfileSyncing only treats syncing status as active progress', () => {
    assert.equal(isProfileSyncing({status: 'syncing'}), true);
    assert.equal(isProfileSyncing({status: 'watching'}), false);
    assert.equal(isProfileSyncing({status: 'paused'}), false);
});
