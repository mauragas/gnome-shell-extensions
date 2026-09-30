#!/usr/bin/env -S gjs -m
// Headless lighting restorer for the Razer Keyboard RGB Control extension.
//
// Applies the currently saved selection state to the keyboard without a
// graphical GNOME Shell session. It is intended to be invoked by a systemd
// --user service (installed by install.sh) so the lighting comes back at boot,
// before the user logs in, as long as the user session lingers.
//
// Reuses the same device helpers and selection-state resolution as the
// extension so the restored lighting matches what the extension would apply.

import System from 'system';

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

import {
    WAVE_LEFT,
    WAVE_RIGHT,
    applyBreathSingle,
    applyCustomMatrix,
    applyNone,
    applySpectrum,
    applyStatic,
    applyWave,
    discoverOpenRazerState,
    loadCustomModeLayouts,
    loadSelectionState,
    setBrightness,
} from '../shared.js';
import {
    getBrightnessPercent,
    resolveModeLayoutFrame,
    resolveSelectionColor,
} from '../lib/lighting-restore.js';

const SCHEMA_ID = 'org.gnome.shell.extensions.razer-keyboard-rgb-control';
const KEYBOARD_WAIT_TIMEOUT_MS = 30000;
const KEYBOARD_WAIT_INTERVAL_MS = 2000;

Gio._promisify(Gio.DBusConnection.prototype, 'call', 'call_finish');

function getCurrentModuleDir() {
    try {
        const file = Gio.File.new_for_uri(import.meta.url);
        return file.get_parent()?.get_path() ?? GLib.get_current_dir();
    } catch {
        return GLib.get_current_dir();
    }
}

function getSettings() {
    const schemaDir = GLib.build_filenamev([getCurrentModuleDir(), '..', 'schemas']);

    if (!GLib.file_test(
        GLib.build_filenamev([schemaDir, 'gschemas.compiled']),
        GLib.FileTest.EXISTS
    )) {
        return null;
    }

    const defaultSource = Gio.SettingsSchemaSource.get_default();
    const source = Gio.SettingsSchemaSource.new_from_directory(schemaDir, defaultSource, false);
    const schema = source.lookup(SCHEMA_ID, false);
    if (!schema)
        return null;

    return new Gio.Settings({settings_schema: schema});
}

function loadSavedLighting() {
    const settings = getSettings();
    if (!settings) {
        return {
            settingsAvailable: false,
            hasSelection: false,
            selectionState: null,
            customModeLayouts: {},
        };
    }

    let rawSelection = '';
    try {
        rawSelection = settings.get_string('last-preset');
    } catch {
        rawSelection = '';
    }

    let selectionState = null;
    if (rawSelection) {
        try {
            selectionState = loadSelectionState(settings);
        } catch {
            selectionState = null;
        }
    }

    let customModeLayouts = {};
    try {
        customModeLayouts = loadCustomModeLayouts(settings);
    } catch {
        customModeLayouts = {};
    }

    return {
        settingsAvailable: true,
        hasSelection: Boolean(rawSelection) && Boolean(selectionState),
        selectionState,
        customModeLayouts,
    };
}

async function waitForKeyboard() {
    const deadline = GLib.get_monotonic_time() + KEYBOARD_WAIT_TIMEOUT_MS * 1000;

    for (;;) {
        const state = await discoverOpenRazerState().catch(() => null);
        if (state?.keyboard)
            return state.keyboard;

        if (GLib.get_monotonic_time() >= deadline)
            return null;

        await new Promise(resolve => {
            GLib.timeout_add(GLib.PRIORITY_DEFAULT, KEYBOARD_WAIT_INTERVAL_MS, () => {
                resolve();
                return GLib.SOURCE_REMOVE;
            });
        });
    }
}

async function applySelection(device, selectionState, customModeLayouts) {
    if (selectionState.selectedModeId) {
        const frame = resolveModeLayoutFrame(
            selectionState.selectedModeId,
            customModeLayouts,
            device.matrixDimensions
        );
        if (!frame)
            throw new Error(`No layout available for mode ${selectionState.selectedModeId}.`);

        await applyCustomMatrix(device, frame);
    } else {
        const color = resolveSelectionColor(selectionState);
        switch (selectionState.selectedEffectId) {
        case 'spectrum':
            await applySpectrum(device);
            break;
        case 'wave-left':
            await applyWave(device, WAVE_LEFT);
            break;
        case 'wave-right':
            await applyWave(device, WAVE_RIGHT);
            break;
        case 'breathe':
            await applyBreathSingle(device, color.red, color.green, color.blue);
            break;
        case 'off':
            await applyNone(device);
            break;
        default:
            await applyStatic(device, color.red, color.green, color.blue);
            break;
        }
    }

    const brightness = getBrightnessPercent(selectionState);
    if (brightness !== null && device.capabilities?.brightness)
        await setBrightness(device, brightness);
}

async function main() {
    const saved = loadSavedLighting();
    if (!saved.settingsAvailable) {
        print('[RRC] Saved settings schema is unavailable; nothing to restore.');
        return 0;
    }

    if (!saved.hasSelection) {
        print('[RRC] No saved keyboard lighting state; nothing to restore.');
        return 0;
    }

    const keyboard = await waitForKeyboard();
    if (!keyboard) {
        print('[RRC] Keyboard was not detected before the restore timeout.');
        return 1;
    }

    try {
        await applySelection(keyboard, saved.selectionState, saved.customModeLayouts);
    } catch (error) {
        printerr(`[RRC] Failed to restore keyboard lighting: ${error.message}`);
        return 1;
    }

    print('[RRC] Restored saved keyboard lighting.');
    return 0;
}

let exitCode = 1;

try {
    exitCode = await main();
} catch (error) {
    printerr(error?.stack ?? error?.message ?? String(error));
    exitCode = 1;
}

System.exit(exitCode);
