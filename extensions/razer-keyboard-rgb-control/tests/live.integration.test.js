import assert from 'node:assert/strict';
import test from 'node:test';

import {
    captureRestoreSnapshot,
    createLiveRazerHarness,
    detectLiveRazerEnvironment,
    pickAlternateBrightness,
    restoreFromSnapshot,
} from './live-razer.js';

const runLiveDeviceTests = process.env.RRC_REAL_DEVICE_TESTS === '1';
let liveEnvironment = null;
let liveEnvironmentError = null;

if (runLiveDeviceTests) {
    try {
        liveEnvironment = detectLiveRazerEnvironment();
    } catch (error) {
        liveEnvironmentError = error;
    }
}

let baseSkipReason = '';
if (runLiveDeviceTests) {
    if (liveEnvironmentError)
        baseSkipReason = `Live Razer detection failed: ${liveEnvironmentError.message}`;
} else {
    baseSkipReason = 'Set RRC_REAL_DEVICE_TESTS=1 to run real-device Razer tests';
}

function getTestOptions(skipReason = '') {
    return skipReason
        ? {concurrency: false, skip: skipReason}
        : {concurrency: false};
}

function createRestoreGuard(t, snapshot) {
    let restored = false;
    t.after(() => {
        if (!restored)
            restoreFromSnapshot(snapshot);
    });

    return () => {
        const result = restoreFromSnapshot(snapshot);
        restored = true;
        return result;
    };
}

test('live preflight detects the attached BlackWidow keyboard',
    getTestOptions(baseSkipReason), t => {
        t.diagnostic(`Keyboard: ${liveEnvironment.keyboard?.name ?? 'missing'}`);

        assert.equal(liveEnvironment.openRazerAvailable, true);
        assert.equal(liveEnvironment.keyboard?.name, 'Razer BlackWidow V3 Tenkeyless');
    });

test('live keyboard brightness changes over OpenRazer and restores the previous brightness',
    getTestOptions(baseSkipReason), t => {
        const harness = createLiveRazerHarness();
        const snapshot = captureRestoreSnapshot();
        const restore = createRestoreGuard(t, snapshot);
        const before = harness.getOpenRazerState();
        const currentBrightness = before.keyboard?.brightness;
        if (typeof currentBrightness !== 'number')
            t.skip('Keyboard brightness is not readable on this backend');

        const targetBrightness = pickAlternateBrightness(currentBrightness, [25, 50, 75, 100, 0]);
        t.diagnostic(`Keyboard brightness: ${currentBrightness}% -> ${targetBrightness}%`);

        const action = harness.setKeyboardBrightness(targetBrightness);
        const after = harness.getOpenRazerState();

        assert.equal(action.ok, true);
        assert.equal(after.keyboard?.brightness, targetBrightness);

        restore();
        const restored = harness.getOpenRazerState();
        assert.equal(restored.keyboard?.brightness, snapshot.state.keyboard?.brightness);
    });

test('live keyboard lighting command succeeds and the saved lighting snapshot can be restored',
    getTestOptions(baseSkipReason), t => {
        const snapshot = captureRestoreSnapshot();
        if (!snapshot.keyboardLightingRestorable)
            t.skip(snapshot.keyboardLightingRestoreReason ?? 'Keyboard lighting is not safely restorable');

        const harness = createLiveRazerHarness();
        const restore = createRestoreGuard(t, snapshot);
        const before = harness.getOpenRazerState();
        const action = harness.applyKeyboardStatic({red: 255, green: 0, blue: 0});
        const after = harness.getOpenRazerState();

        assert.equal(action.ok, true);
        assert.equal(after.keyboard?.serial, before.keyboard?.serial);
        assert.equal(after.keyboard?.name, before.keyboard?.name);

        restore();
        const restored = harness.getOpenRazerState();
        assert.equal(restored.keyboard?.serial, snapshot.state.keyboard?.serial);
        assert.equal(restored.keyboard?.brightness, snapshot.state.keyboard?.brightness);
    });
