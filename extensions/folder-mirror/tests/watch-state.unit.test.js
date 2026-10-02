import assert from 'node:assert/strict';
import test from 'node:test';

import {
    SYNC_PULSE_DURATION_MS,
    computeWatchDelayMs,
    deriveRuntimeStatus,
    didSyncProduceVisibleChanges,
    updateWatchRunState,
} from '../lib/watch-state.js';

test('didSyncProduceVisibleChanges treats empty output as a no-op and real output as change activity', () => {
    assert.equal(didSyncProduceVisibleChanges({stdout: '', stderr: ''}), false);
    assert.equal(didSyncProduceVisibleChanges({stdout: 'updated file.txt', stderr: ''}), true);
});

test('computeWatchDelayMs backs off watch polling up to a capped interval', () => {
    assert.equal(computeWatchDelayMs(10, 0), 10_000);
    assert.equal(computeWatchDelayMs(10, 1), 20_000);
    assert.equal(computeWatchDelayMs(10, 2), 40_000);
    assert.equal(computeWatchDelayMs(10, 6), 300_000);
});

test('deriveRuntimeStatus keeps quiet watch profiles watching until a sync pulse is active', () => {
    const nowMs = 1000;
    assert.equal(deriveRuntimeStatus({watchMode: true, autoStartHelper: true, nowMs}), 'watching');
    assert.equal(deriveRuntimeStatus({watchMode: true, autoStartHelper: true, syncPulseUntil: nowMs + 1, nowMs}), 'syncing');
    assert.equal(deriveRuntimeStatus({paused: true, watchMode: true, nowMs}), 'paused');
});

test('updateWatchRunState resets or backs off based on whether a watch run changed files', () => {
    const noChange = updateWatchRunState({consecutiveNoChangeRuns: 1}, {
        trigger: 'watch',
        hadChanges: false,
        baseIntervalSeconds: 10,
        nowMs: 1000,
    });
    assert.equal(noChange.consecutiveNoChangeRuns, 2);
    assert.equal(noChange.nextWatchAt, 41_000);

    const changed = updateWatchRunState({consecutiveNoChangeRuns: 3}, {
        trigger: 'watch',
        hadChanges: true,
        baseIntervalSeconds: 10,
        nowMs: 1000,
    });
    assert.equal(changed.consecutiveNoChangeRuns, 0);
    assert.equal(changed.nextWatchAt, 11_000);
    assert.equal(changed.syncPulseUntil, 1000 + SYNC_PULSE_DURATION_MS);
});

test('updateWatchRunState does not leave a lingering sync pulse for non-watch triggers', () => {
    const manualRun = updateWatchRunState({consecutiveNoChangeRuns: 3, syncPulseUntil: 9999}, {
        trigger: 'manual',
        hadChanges: true,
        baseIntervalSeconds: 10,
        nowMs: 1000,
    });

    assert.equal(manualRun.consecutiveNoChangeRuns, 0);
    assert.equal(manualRun.nextWatchAt, 11_000);
    assert.equal(manualRun.syncPulseUntil, 0);
});
