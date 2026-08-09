import {execFileSync} from 'node:child_process';
import {rmSync, mkdtempSync, writeFileSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const TEST_DIR = path.dirname(fileURLToPath(import.meta.url));
const DRIVER_PATH = path.join(TEST_DIR, 'live-driver.js');
const DEFAULT_TIMEOUT_MS = 20000;

function runJsonCommand(command, args, {timeout = DEFAULT_TIMEOUT_MS} = {}) {
    const stdout = execFileSync(command, args, {
        encoding: 'utf8',
        timeout,
        env: process.env,
    }).trim();

    if (!stdout)
        throw new Error(`${command} returned no output`);

    try {
        return JSON.parse(stdout);
    } catch (error) {
        throw new Error(`${command} returned invalid JSON: ${error.message}\n${stdout}`);
    }
}

function runGjsDriver(command, args = [], options = {}) {
    return runJsonCommand('gjs', ['-m', DRIVER_PATH, command, ...args], options);
}

export function detectLiveRazerEnvironment() {
    const openRazerState = runGjsDriver('discover-state');

    return {
        openRazerAvailable: openRazerState.available === true,
        reason: openRazerState.reason ?? null,
        keyboard: openRazerState.keyboard,
        state: openRazerState,
    };
}

export function captureRestoreSnapshot() {
    return runGjsDriver('capture-snapshot');
}

export function restoreFromSnapshot(snapshot) {
    const tempDir = mkdtempSync(path.join(os.tmpdir(), 'rrc-live-snapshot-'));
    const snapshotPath = path.join(tempDir, 'snapshot.json');
    writeFileSync(snapshotPath, JSON.stringify(snapshot), 'utf8');

    try {
        return runGjsDriver('restore-snapshot', [snapshotPath], {
            timeout: DEFAULT_TIMEOUT_MS * 2,
        });
    } finally {
        rmSync(tempDir, {recursive: true, force: true});
    }
}

export function pickAlternateBrightness(currentBrightness, candidates = [25, 50, 75, 100, 0]) {
    const normalizedCurrent = Number.isFinite(currentBrightness)
        ? Math.max(0, Math.min(100, Math.round(currentBrightness)))
        : null;

    for (const candidate of candidates) {
        const normalizedCandidate = Math.max(0, Math.min(100, Math.round(candidate)));
        if (normalizedCandidate !== normalizedCurrent)
            return normalizedCandidate;
    }

    return normalizedCurrent === 100 ? 50 : 100;
}

export function createLiveRazerHarness() {
    return {
        detectEnvironment: detectLiveRazerEnvironment,
        captureRestoreSnapshot,
        restoreFromSnapshot,
        getOpenRazerState() {
            return runGjsDriver('discover-state');
        },
        applyKeyboardStatic({red, green, blue}) {
            return runGjsDriver('keyboard-static', [
                String(red),
                String(green),
                String(blue),
            ]);
        },
        setKeyboardBrightness(percent) {
            return runGjsDriver('keyboard-brightness', [String(percent)]);
        },
        turnKeyboardLightsOff() {
            return runGjsDriver('keyboard-none');
        },
    };
}
