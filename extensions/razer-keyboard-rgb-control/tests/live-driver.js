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
import {buildProgrammerModeMatrix} from '../lib/matrix-layout.js';
import {PROGRAMMER_MODE_PRESETS} from '../lib/presets.js';

const SCHEMA_ID = 'org.gnome.shell.extensions.razer-keyboard-rgb-control';
const KEYBOARD_DEFAULT_COLOR_ID = 'green';
const COLOR_PRESETS = new Map([
    ['red', {red: 255, green: 0, blue: 0}],
    ['orange', {red: 255, green: 128, blue: 0}],
    ['yellow', {red: 255, green: 214, blue: 10}],
    ['green', {red: 0, green: 255, blue: 0}],
    ['cyan', {red: 0, green: 224, blue: 255}],
    ['blue', {red: 0, green: 102, blue: 255}],
    ['purple', {red: 124, green: 92, blue: 255}],
    ['pink', {red: 255, green: 96, blue: 188}],
    ['white', {red: 255, green: 255, blue: 255}],
    ['slate', {red: 148, green: 163, blue: 184}],
]);
const KEYBOARD_EFFECT_SUPPORT = {
    spectrum: {
        isSupported: capabilities => Boolean(capabilities?.spectrum),
        reason: 'The detected keyboard backend does not report spectrum support.',
    },
    'wave-left': {
        isSupported: capabilities => Boolean(capabilities?.wave),
        reason: 'The detected keyboard backend does not report wave support.',
    },
    'wave-right': {
        isSupported: capabilities => Boolean(capabilities?.wave),
        reason: 'The detected keyboard backend does not report wave support.',
    },
    breathe: {
        isSupported: capabilities => Boolean(capabilities?.breathSingle),
        reason: 'The detected keyboard backend does not report single-color breathe support.',
    },
    off: {
        isSupported: capabilities => Boolean(capabilities?.none),
        reason: 'The detected keyboard backend does not report off support.',
    },
    default: {
        isSupported: capabilities => Boolean(capabilities?.static),
        reason: 'The detected keyboard backend does not report static color support.',
    },
};

const TEST_DIR = getCurrentModuleDir();
const EXTENSION_DIR = GLib.build_filenamev([TEST_DIR, '..']);
const SCHEMA_DIR = GLib.build_filenamev([EXTENSION_DIR, 'schemas']);

Gio._promisify(Gio.DBusConnection.prototype, 'call', 'call_finish');

function getCurrentModuleDir() {
    try {
        const file = Gio.File.new_for_uri(import.meta.url);
        return file.get_parent()?.get_path() ?? GLib.get_current_dir();
    } catch {
        return GLib.get_current_dir();
    }
}

function readJsonFile(path) {
    const [ok, contents] = Gio.File.new_for_path(path).load_contents(null);
    if (!ok)
        throw new Error(`Failed to read JSON file: ${path}`);

    return JSON.parse(new TextDecoder().decode(contents));
}

function hashIdentifier(value) {
    const text = typeof value === 'string' ? value.trim() : '';
    if (!text)
        return null;

    let hash = 2166136261;
    for (const char of text) {
        hash ^= char.codePointAt(0) ?? 0;
        hash = Math.imul(hash, 16777619);
    }

    return (hash >>> 0).toString(16).padStart(8, '0');
}

function redactDeviceSerial(serial) {
    const hash = hashIdentifier(serial);
    return hash ? `serial-${hash.slice(-6)}` : null;
}

function redactDevicePath(devicePath, serial) {
    if (typeof devicePath !== 'string' || !devicePath)
        return null;

    const redactedSerial = redactDeviceSerial(serial) ?? '<redacted>';
    return devicePath.replace(/\/device\/[^/]+$/, `/device/${redactedSerial}`);
}

function sanitizeCapabilities(capabilities) {
    if (!capabilities)
        return null;

    return {
        none: Boolean(capabilities.none),
        spectrum: Boolean(capabilities.spectrum),
        static: Boolean(capabilities.static),
        wave: Boolean(capabilities.wave),
        breathSingle: Boolean(capabilities.breathSingle),
        customMatrix: Boolean(capabilities.customMatrix),
        brightness: Boolean(capabilities.brightness),
    };
}

function sanitizeDevice(device) {
    if (!device)
        return null;

    return {
        serial: redactDeviceSerial(device.serial),
        path: redactDevicePath(device.path, device.serial),
        name: device.name ?? null,
        role: device.role ?? null,
        type: device.type ?? null,
        backend: device.backend ?? 'openrazer',
        brightness: typeof device.brightness === 'number'
            ? Math.round(device.brightness)
            : null,
        firmwareVersion: device.firmwareVersion ?? null,
        matrixDimensions: Array.isArray(device.matrixDimensions)
            ? device.matrixDimensions.slice(0, 2)
            : null,
        keyboardLayout: device.keyboardLayout ?? null,
        capabilities: sanitizeCapabilities(device.capabilities),
    };
}

function sanitizeState(state) {
    return {
        available: Boolean(state?.available),
        reason: state?.reason ?? null,
        daemonVersion: state?.daemonVersion ?? null,
        keyboard: sanitizeDevice(state?.keyboard ?? null),
        devices: (state?.devices ?? []).map(device => sanitizeDevice(device)),
    };
}

function getSettings() {
    if (!GLib.file_test(
        GLib.build_filenamev([SCHEMA_DIR, 'gschemas.compiled']),
        GLib.FileTest.EXISTS
    )) {
        return null;
    }

    const defaultSource = Gio.SettingsSchemaSource.get_default();
    const source = Gio.SettingsSchemaSource.new_from_directory(
        SCHEMA_DIR,
        defaultSource,
        false
    );
    const schema = source.lookup(SCHEMA_ID, false);
    if (!schema)
        return null;

    return new Gio.Settings({settings_schema: schema});
}

function loadPersistedStateSnapshot() {
    const settings = getSettings();
    if (!settings) {
        return {
            settingsAvailable: false,
            savedSelectionStatePresent: false,
            savedSelectionState: null,
            customModeLayouts: {},
        };
    }

    let rawSelectionState = '';
    try {
        rawSelectionState = settings.get_string('last-preset');
    } catch {
        rawSelectionState = '';
    }

    let savedSelectionState = null;
    if (rawSelectionState) {
        try {
            savedSelectionState = loadSelectionState(settings);
        } catch {
            savedSelectionState = null;
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
        savedSelectionStatePresent: Boolean(rawSelectionState),
        savedSelectionState,
        customModeLayouts,
    };
}

function clampUnit(value) {
    const numeric = Number(value);
    if (Number.isNaN(numeric))
        return 0;

    return Math.max(0, Math.min(1, numeric));
}

function hsvToRgb(hue, saturation = 1, value = 1) {
    const normalizedHue = clampUnit(hue);
    const chroma = value * saturation;
    const scaledHue = normalizedHue * 6;
    const x = chroma * (1 - Math.abs((scaledHue % 2) - 1));

    let red = 0;
    let green = 0;
    let blue = 0;

    if (scaledHue < 1) {
        red = chroma;
        green = x;
    } else if (scaledHue < 2) {
        red = x;
        green = chroma;
    } else if (scaledHue < 3) {
        green = chroma;
        blue = x;
    } else if (scaledHue < 4) {
        green = x;
        blue = chroma;
    } else if (scaledHue < 5) {
        red = x;
        blue = chroma;
    } else {
        red = chroma;
        blue = x;
    }

    const match = value - chroma;
    return {
        red: Math.round((red + match) * 255),
        green: Math.round((green + match) * 255),
        blue: Math.round((blue + match) * 255),
    };
}

function getColorPreset(colorId, customHue, fallbackId) {
    if (colorId === 'custom')
        return hsvToRgb(customHue ?? 0);

    return COLOR_PRESETS.get(colorId)
        ?? COLOR_PRESETS.get(fallbackId)
        ?? COLOR_PRESETS.get(KEYBOARD_DEFAULT_COLOR_ID);
}

function getKeyboardColorPreset(selectionState) {
    return getColorPreset(
        selectionState?.selectedColorId,
        selectionState?.customHue,
        KEYBOARD_DEFAULT_COLOR_ID
    );
}

function buildSupportResult(supported, reason) {
    return {
        ok: Boolean(supported),
        reason: supported ? null : reason,
    };
}

function getEffectSupportResult(effectId, capabilities, supportMap) {
    const support = supportMap[effectId] ?? supportMap.default;
    return buildSupportResult(
        support.isSupported(capabilities),
        support.reason
    );
}

function getModeLayoutFrame(modeId, customModeLayouts, matrixDimensions = [6, 18]) {
    const storedLayout = customModeLayouts?.[modeId];
    if (storedLayout?.frame)
        return storedLayout.frame;

    const modePreset = PROGRAMMER_MODE_PRESETS.find(preset => preset.id === modeId);
    if (!modePreset)
        return null;

    return buildProgrammerModeMatrix(modePreset, matrixDimensions);
}

function getKeyboardModeRestoreSupport(modeId, customModeLayouts, matrixDimensions) {
    const modeLayoutFrame = getModeLayoutFrame(modeId, customModeLayouts, matrixDimensions);
    if (modeLayoutFrame)
        return {ok: true, reason: null};

    return {
        ok: false,
        reason: `Keyboard mode ${modeId} has no stored or baked-in layout snapshot.`,
    };
}

function isKeyboardLightingRestorable(device, selectionState, customModeLayouts) {
    if (!device) {
        return {
            ok: false,
            reason: 'Keyboard is not currently detected.',
        };
    }

    if (!selectionState) {
        return {
            ok: false,
            reason: 'The extension has no saved keyboard selection state to restore.',
        };
    }

    if (selectionState.selectedModeId) {
        return getKeyboardModeRestoreSupport(
            selectionState.selectedModeId,
            customModeLayouts,
            device?.matrixDimensions
        );
    }

    return getEffectSupportResult(
        selectionState.selectedEffectId,
        device.capabilities,
        KEYBOARD_EFFECT_SUPPORT
    );
}

async function applyKeyboardLightingFromSelection(device, selectionState, customModeLayouts) {
    if (!device || !selectionState)
        return;

    if (selectionState.selectedModeId) {
        const modeLayoutFrame = getModeLayoutFrame(
            selectionState.selectedModeId,
            customModeLayouts,
            device.matrixDimensions
        );
        if (!modeLayoutFrame) {
            throw new Error(
                `Cannot restore keyboard mode ${selectionState.selectedModeId} without a stored or baked-in layout.`
            );
        }

        await applyCustomMatrix(device, modeLayoutFrame);
        return;
    }

    const color = getKeyboardColorPreset(selectionState);
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

function buildSnapshot(state, persistedState) {
    const keyboardLighting = isKeyboardLightingRestorable(
        state.keyboard,
        persistedState.savedSelectionState,
        persistedState.customModeLayouts
    );

    return {
        capturedAt: new Date().toISOString(),
        state,
        settingsAvailable: persistedState.settingsAvailable,
        savedSelectionStatePresent: persistedState.savedSelectionStatePresent,
        savedSelectionState: persistedState.savedSelectionState,
        customModeLayouts: persistedState.customModeLayouts,
        keyboardLightingRestorable: keyboardLighting.ok,
        keyboardLightingRestoreReason: keyboardLighting.reason,
    };
}

async function captureSnapshot() {
    const state = sanitizeState(await discoverOpenRazerState());
    const persistedState = loadPersistedStateSnapshot();
    return buildSnapshot(state, persistedState);
}

function shouldRestoreNumericValue(currentValue, targetValue) {
    return typeof targetValue === 'number' && currentValue !== targetValue;
}

async function runRestoreStep(errors, label, action) {
    try {
        await action();
    } catch (error) {
        errors.push(`${label}: ${error.message}`);
    }
}

function getNumericDeviceValue(device, key) {
    return typeof device?.[key] === 'number' ? device[key] : null;
}

async function restoreDeviceBrightness(errors, label, device, snapshotDevice) {
    const targetBrightness = snapshotDevice?.brightness;
    const currentBrightness = getNumericDeviceValue(device, 'brightness');
    if (!device?.capabilities?.brightness ||
        !shouldRestoreNumericValue(currentBrightness, targetBrightness)) {
        return;
    }

    await runRestoreStep(errors, label, () =>
        setBrightness(device, targetBrightness)
    );
}

async function restoreKeyboardState(snapshot, keyboard, errors) {
    if (!keyboard)
        return;

    if (snapshot.keyboardLightingRestorable && snapshot.savedSelectionState) {
        await runRestoreStep(errors, 'keyboard lighting', () =>
            applyKeyboardLightingFromSelection(
                keyboard,
                snapshot.savedSelectionState,
                snapshot.customModeLayouts
            )
        );
    }

    await restoreDeviceBrightness(
        errors,
        'keyboard brightness',
        keyboard,
        snapshot.state?.keyboard
    );
}

async function restoreSnapshot(snapshot) {
    const state = await discoverOpenRazerState();
    const errors = [];

    await restoreKeyboardState(snapshot, state.keyboard, errors);

    return {
        ok: errors.length === 0,
        errors,
        state: sanitizeState(await discoverOpenRazerState()),
    };
}

function emitJson(payload, exitCode = 0) {
    print(JSON.stringify(payload));
    return exitCode;
}

function parseIntegerArg(value, label) {
    const numeric = Number.parseInt(value, 10);
    if (Number.isNaN(numeric))
        throw new Error(`Invalid ${label}: ${value}`);

    return numeric;
}

async function getKeyboard() {
    const state = await discoverOpenRazerState();
    if (!state.keyboard)
        throw new Error('The Razer BlackWidow V3 Tenkeyless is not currently detected.');

    return state.keyboard;
}

async function runKeyboardAction(actionName, callback, details = null) {
    const device = await getKeyboard();
    const result = await callback(device);
    return {
        ok: true,
        action: actionName,
        details,
        result: result ?? null,
        state: sanitizeState(await discoverOpenRazerState()),
    };
}

async function main(argv) {
    const [command, ...args] = argv;
    if (!command)
        return emitJson({ok: false, error: 'Missing command.'}, 2);

    switch (command) {
    case 'discover-state':
        return emitJson(sanitizeState(await discoverOpenRazerState()));
    case 'capture-snapshot':
        return emitJson(await captureSnapshot());
    case 'restore-snapshot': {
        const snapshotPath = args[0];
        if (!snapshotPath)
            return emitJson({ok: false, error: 'Missing snapshot path.'}, 2);

        return emitJson(await restoreSnapshot(readJsonFile(snapshotPath)));
    }
    case 'keyboard-static': {
        const red = parseIntegerArg(args[0], 'red');
        const green = parseIntegerArg(args[1], 'green');
        const blue = parseIntegerArg(args[2], 'blue');
        return emitJson(await runKeyboardAction(
            'keyboard-static',
            device => applyStatic(device, red, green, blue),
            {red, green, blue}
        ));
    }
    case 'keyboard-brightness': {
        const percent = parseIntegerArg(args[0], 'brightness percent');
        return emitJson(await runKeyboardAction(
            'keyboard-brightness',
            device => setBrightness(device, percent),
            {percent}
        ));
    }
    case 'keyboard-none':
        return emitJson(await runKeyboardAction(
            'keyboard-none',
            device => applyNone(device)
        ));
    default:
        return emitJson({ok: false, error: `Unknown command: ${command}`}, 2);
    }
}

let exitCode = 0;

try {
    exitCode = await main(ARGV);
} catch (error) {
    printerr(error?.stack ?? error?.message ?? String(error));
    exitCode = 1;
}

System.exit(exitCode);
