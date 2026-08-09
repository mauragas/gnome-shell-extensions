import assert from 'node:assert/strict';
import test from 'node:test';

import {createUiBridgeHarness} from './live-ui.js';

const runUiTests = process.env.RRC_REAL_UI_TESTS === '1';
const baseSkipReason = runUiTests
    ? ''
    : 'Set RRC_REAL_UI_TESTS=1 to run current-session GNOME UI smoke tests';

function getTestOptions(reason = '') {
    return reason
        ? {concurrency: false, skip: reason}
        : {concurrency: false};
}

test('ui smoke bridge exposes the indicator and a backend snapshot for the current GNOME session',
    getTestOptions(baseSkipReason), async t => {
        const harness = createUiBridgeHarness();
        t.after(async () => harness.cleanup());

        const backend = await harness.refreshBackendState();
        const snapshot = await harness.getUiSnapshot();

        assert.equal(snapshot.indicatorPresent, true);
        assert.equal(snapshot.extensionUuid, 'razer-keyboard-rgb-control');
        assert.equal(snapshot.backend.available, true);
        assert.equal(backend.keyboard?.name, 'Razer BlackWidow V3 Tenkeyless');
    });

test('ui smoke bridge opens the menu and control pad, reports the keyboard UI, and closes cleanly',
    getTestOptions(baseSkipReason), async t => {
        const harness = createUiBridgeHarness();
        t.after(async () => harness.cleanup());

        await harness.refreshBackendState();

        const openMenuSnapshot = await harness.openMenu();
        assert.equal(openMenuSnapshot.menuOpen, true);
        assert.equal(openMenuSnapshot.keyboardPresetSectionsVisible, true);

        const openControlPadSnapshot = await harness.openControlPad();
        assert.equal(openControlPadSnapshot.controlPadOpen, true);
        assert.equal(openControlPadSnapshot.keyboardCardPresent, true);
        assert.equal(openControlPadSnapshot.controlPadHasModalGrab, true);

        const closedControlPadSnapshot = await harness.closeControlPad();
        assert.equal(closedControlPadSnapshot.controlPadOpen, false);
        assert.equal(closedControlPadSnapshot.controlPadHasModalGrab, false);

        const closedMenuSnapshot = await harness.closeMenu();
        assert.equal(closedMenuSnapshot.menuOpen, false);
    });
