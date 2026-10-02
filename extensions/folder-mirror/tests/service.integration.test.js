import assert from 'node:assert/strict';
import test from 'node:test';

import {buildSnapshot, buildSnapshotSummary, deriveIndicatorState, parseSnapshot, serializeSnapshot} from '../lib/status-store.js';

test('service snapshot helpers round-trip snapshot state and derive indicator summaries', () => {
    const snapshot = buildSnapshot({
        helperState: 'running',
        dependencies: {
            rsync: true,
            unison: {available: false, path: null},
        },
        profiles: [
            {
                id: 'alpha',
                name: 'Alpha',
                status: 'watching',
            },
            {
                id: 'beta',
                name: 'Beta',
                status: 'syncing',
            },
        ],
        recentErrors: [],
    });

    const reparsed = parseSnapshot(serializeSnapshot(snapshot));

    assert.equal(reparsed.helperState, 'running');
    assert.equal(reparsed.counts.healthy, 1);
    assert.equal(reparsed.counts.syncing, 1);
    assert.equal(deriveIndicatorState(reparsed), 'syncing');
    assert.match(buildSnapshotSummary(reparsed), /1 healthy/u);
    assert.match(buildSnapshotSummary(reparsed), /1 syncing/u);
});
