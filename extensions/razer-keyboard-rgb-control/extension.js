import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import St from 'gi://St';

import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import * as Slider from 'resource:///org/gnome/shell/ui/slider.js';

import {
    RAZER_DEVICES_IFACE,
    RAZER_MANAGER_PATH,
    RAZER_SERVICE,
    WAVE_LEFT,
    WAVE_RIGHT,
    applyBreathSingle,
    applyCustomMatrix,
    applyNone,
    applySpectrum,
    applyStatic,
    applyWave,
    clearIntrospectionCache,
    discoverOpenRazerState,
    isTargetKeyboardUsbPresent,
    loadCustomModeLayouts,
    loadSelectionState,
    restartOpenRazerDaemon,
    saveCustomModeLayouts,
    saveSelectionState,
    setBrightness,
} from './shared.js';

import {didKeyboardBecomeAvailable} from './lib/backend-state.js';
import {
    getBrightnessPercent,
    resolveModeLayoutFrame,
    resolveSelectionColor,
} from './lib/lighting-restore.js';
import {
    buildCustomColorPreset,
    buildKeyboardEditorKeyStyle,
    clampUnit,
    rgbToHex,
} from './lib/color-utils.js';
import {
    KEYBOARD_EDITOR_KEY_MAP,
    KEYBOARD_EDITOR_ROW_HEIGHT_PX,
    KEYBOARD_EDITOR_ROWS,
    buildKeyboardEditorPreviewLayout,
} from './lib/keyboard-layout.js';
import {
    buildProgrammerModeMatrix,
    createModeLayout,
    migrateCustomModeLayouts,
    migrateModeLayoutToCurrentVersion,
    paintKeyCells,
    readKeyColorFromLayout,
} from './lib/matrix-layout.js';
import {
    CUSTOM_MODE_LAYOUT_VERSION,
    PRIMARY_COLOR_ROWS,
    PROGRAMMER_MODE_PRESETS,
} from './lib/presets.js';
import {
    applyColorChipVisuals,
    createColorChipButton,
    createTextButton,
    createTextChipButton,
} from './ui/chips.js';
import {
    getPreferredMonitorRect,
    getStage,
} from './ui/monitor-placement.js';

const EFFECT_PRESETS = [
    {
        id: 'spectrum',
        label: 'Spectrum',
        run: device => applySpectrum(device),
    },
    {
        id: 'wave-left',
        label: 'Wave ←',
        run: device => applyWave(device, WAVE_LEFT),
    },
    {
        id: 'wave-right',
        label: 'Wave →',
        run: device => applyWave(device, WAVE_RIGHT),
    },
    {
        id: 'breathe',
        label: 'Breathe',
        run: (device, color) => applyBreathSingle(device, color.red, color.green, color.blue),
    },
    {
        id: 'off',
        label: 'Off',
        run: device => applyNone(device),
    },
];

const BRIGHTNESS_PRESETS = [0, 25, 50, 75, 100].map(value => ({
    id: `brightness-${value}`,
    label: `${value}%`,
    brightness: value,
    run: device => setBrightness(device, value),
}));
const HOTPLUG_SIGNAL_REFRESH_DELAY_MS = 1200;
const KEYBOARD_ABSENT_POLL_INTERVAL_MS = 4000;
const KEYBOARD_USB_RECOVERY_GRACE_MS = 6000;
const OPENRAZER_RESTART_COOLDOWN_MS = 30000;
const STARTUP_RESTORE_RETRY_DELAY_MS = 2000;
const STARTUP_RESTORE_MAX_ATTEMPTS = 3;
const DBUS_SERVICE_PATH = '/org/freedesktop/DBus';
const DBUS_SERVICE_IFACE = 'org.freedesktop.DBus';
const LOGIN1_SERVICE = 'org.freedesktop.login1';
const LOGIN1_MANAGER_PATH = '/org/freedesktop/login1';
const LOGIN1_MANAGER_IFACE = 'org.freedesktop.login1.Manager';
const PANEL_MENU_ALIGNMENT = 0.5;
const SETTINGS_SCHEMA_ID = 'org.gnome.shell.extensions.razer-keyboard-rgb-control';
const LEGACY_SETTINGS_SCHEMA_ID = 'org.gnome.shell.extensions.razer-rgb-control';
const LEGACY_EXTENSION_UUID_PREFIX = 'razer-rgb-control';
const EXTENSION_TITLE = 'Razer Keyboard RGB Control';
const TEST_BRIDGE_OBJECT_PATH = '/org/gnome/Shell/Extensions/RazerRgbControl/TestBridge';
const TEST_BRIDGE_INTERFACE = 'org.gnome.Shell.Extensions.RazerRgbControl.TestBridge';
const TEST_BRIDGE_SENTINEL_BASENAME = 'rrc-ui-test-bridge.enabled';
const TEST_BRIDGE_MENU_TITLES = new Set([
        'Static colors',
        'Custom modes',
        'Custom color',
        'Effects',
        'Brightness',
]);
const TEST_BRIDGE_CONTROL_PAD_TITLES = new Set([
        'Static colors',
        'Custom modes',
        'Mode editor',
        'Custom color',
        'Effects',
        'Brightness',
]);
const TEST_BRIDGE_XML = `
<node>
    <interface name="${TEST_BRIDGE_INTERFACE}">
        <method name="Ping">
            <arg type="s" name="payload" direction="out"/>
        </method>
        <method name="GetBackendSnapshot">
            <arg type="s" name="payload" direction="out"/>
        </method>
        <method name="RefreshBackendState">
            <arg type="s" name="payload" direction="out"/>
        </method>
        <method name="OpenMenu">
            <arg type="s" name="payload" direction="out"/>
        </method>
        <method name="CloseMenu">
            <arg type="s" name="payload" direction="out"/>
        </method>
        <method name="OpenControlPad">
            <arg type="s" name="payload" direction="out"/>
        </method>
        <method name="CloseControlPad">
            <arg type="s" name="payload" direction="out"/>
        </method>
        <method name="GetUiSnapshot">
            <arg type="s" name="payload" direction="out"/>
        </method>
    </interface>
</node>`;

function buildBackendStateSignature(state) {
    return JSON.stringify({
        available: Boolean(state?.available),
        reason: state?.reason ?? '',
        daemonVersion: state?.daemonVersion ?? '',
        keyboard: state?.keyboard ? {
            serial: state.keyboard.serial,
            name: state.keyboard.name,
            brightness: typeof state.keyboard.brightness === 'number'
                ? Math.round(state.keyboard.brightness)
                : null,
            firmwareVersion: state.keyboard.firmwareVersion ?? '',
        } : null,
        devices: (state?.devices ?? []).map(device => ({
            serial: device.serial,
            name: device.name,
            type: device.type,
            brightness: typeof device.brightness === 'number'
                ? Math.round(device.brightness)
                : null,
        })),
    });
}

function getTestBridgeSentinelPath() {
    return GLib.build_filenamev([
        GLib.get_home_dir(),
        '.cache',
        TEST_BRIDGE_SENTINEL_BASENAME,
    ]);
}

function getTestBridgeSentinelDisplayPath() {
    return `~/.cache/${TEST_BRIDGE_SENTINEL_BASENAME}`;
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

function buildPublicBackendStateSignature(state) {
    return JSON.stringify({
        available: Boolean(state?.available),
        reason: state?.reason ?? '',
        daemonVersion: state?.daemonVersion ?? '',
        keyboard: state?.keyboard ? {
            serial: redactDeviceSerial(state.keyboard.serial),
            name: state.keyboard.name,
            brightness: typeof state.keyboard.brightness === 'number'
                ? Math.round(state.keyboard.brightness)
                : null,
            firmwareVersion: state.keyboard.firmwareVersion ?? '',
        } : null,
        devices: (state?.devices ?? []).map(device => ({
            serial: redactDeviceSerial(device.serial),
            name: device.name,
            type: device.type,
            brightness: typeof device.brightness === 'number'
                ? Math.round(device.brightness)
                : null,
        })),
    });
}

function findExtensionSchemaDirByPrefix(prefix) {
    const extensionsDir = GLib.build_filenamev([
        GLib.get_home_dir(),
        '.local',
        'share',
        'gnome-shell',
        'extensions',
    ]);

    let enumerator;
    try {
        enumerator = Gio.File.new_for_path(extensionsDir).enumerate_children(
            'standard::name',
            Gio.FileQueryInfoFlags.NONE,
            null
        );
    } catch (error) {
        console.warn(`[RRC] Failed to enumerate local GNOME Shell extensions: ${error.message}`);
        return null;
    }

    try {
        let info;
        while ((info = enumerator.next_file(null)) !== null) {
            const uuid = info.get_name();
            if (!uuid || !uuid.startsWith(prefix))
                continue;

            const schemaDir = GLib.build_filenamev([extensionsDir, uuid, 'schemas']);
            const compiledPath = GLib.build_filenamev([schemaDir, 'gschemas.compiled']);
            if (GLib.file_test(compiledPath, GLib.FileTest.EXISTS))
                return schemaDir;
        }
    } catch (error) {
        console.warn(`[RRC] Failed to inspect local GNOME Shell extensions: ${error.message}`);
    } finally {
        if (enumerator) {
            try {
                enumerator.close(null);
            } catch (_error) {
                // Ignore close failures.
            }
        }
    }

    return null;
}

function sanitizeTestBridgeDevice(device) {
    if (!device)
        return null;

    return {
        serial: redactDeviceSerial(device.serial),
        name: device.name ?? null,
        role: device.role ?? null,
        type: device.type ?? null,
        backend: device.backend ?? 'openrazer',
        brightness: typeof device.brightness === 'number'
            ? Math.round(device.brightness)
            : null,
        capabilities: device.capabilities ? {
            none: Boolean(device.capabilities.none),
            spectrum: Boolean(device.capabilities.spectrum),
            static: Boolean(device.capabilities.static),
            wave: Boolean(device.capabilities.wave),
            breathSingle: Boolean(device.capabilities.breathSingle),
            customMatrix: Boolean(device.capabilities.customMatrix),
            brightness: Boolean(device.capabilities.brightness),
        } : null,
    };
}

function buildTestBridgeBackendSnapshot(state, extensionUuid = null) {
    return {
        extensionUuid,
        signature: buildPublicBackendStateSignature(state),
        available: Boolean(state?.available),
        reason: state?.reason ?? null,
        daemonVersion: state?.daemonVersion ?? null,
        keyboard: sanitizeTestBridgeDevice(state?.keyboard ?? null),
        devices: (state?.devices ?? []).map(device => sanitizeTestBridgeDevice(device)),
    };
}

function collectActorLabelTexts(actor, texts = []) {
    if (!actor)
        return texts;

    if (typeof actor.text === 'string' && actor.text.trim())
        texts.push(actor.text.trim());

    for (const child of actor.get_children?.() ?? [])
        collectActorLabelTexts(child, texts);

    return texts;
}

function uniqueTextList(values) {
    return [...new Set((values ?? []).filter(Boolean))];
}

function encodeTestBridgePayload(payload) {
    return GLib.base64_encode(new TextEncoder().encode(JSON.stringify(payload)));
}

function getBrightnessPresetId(brightness) {
    if (typeof brightness !== 'number')
        return 'brightness-100';

    let closestPreset = BRIGHTNESS_PRESETS[0];
    let smallestDistance = Math.abs((closestPreset?.brightness ?? 100) - brightness);

    for (const preset of BRIGHTNESS_PRESETS.slice(1)) {
        const distance = Math.abs(preset.brightness - brightness);
        if (distance < smallestDistance) {
            closestPreset = preset;
            smallestDistance = distance;
        }
    }

    return closestPreset.id;
}

function cloneSelectionState(selectionState) {
    if (!selectionState)
        return null;

    return {...selectionState};
}

export default class RazerRgbControlPad extends Extension {
    enable() {
        this._settings = this.getSettings(SETTINGS_SCHEMA_ID);
        this._migrateLegacySettingsIfNeeded();
        this._backendState = this._buildUnavailableState('Loading Razer devices…');
        const savedSelectionRaw = this._settings.get_string('last-preset');
        this._selectionState = loadSelectionState(this._settings);
        const migratedCustomModeLayouts = migrateCustomModeLayouts(loadCustomModeLayouts(this._settings));
        this._customModeLayouts = migratedCustomModeLayouts.layouts;
        if (migratedCustomModeLayouts.changed)
            saveCustomModeLayouts(this._settings, this._customModeLayouts);
        this._editorSelectedKeyId = 'esc';
        this._lastError = null;
        this._actionInProgress = false;
        this._refreshSeq = 0;
        this._controlPad = null;
        this._controlPadModalGrab = null;
        this._dbusSignalIds = [];
        this._systemSignalIds = [];
        this._deferredRefreshTimeout = null;
        this._hasSavedLightingState = Boolean(savedSelectionRaw);
        this._startupRestoreState = savedSelectionRaw
            ? cloneSelectionState(this._selectionState)
            : null;
        this._startupRestorePending = Boolean(savedSelectionRaw);
        this._startupRestoreInFlight = false;
        this._startupRestoreRetryId = null;
        this._startupRestoreAttemptCount = 0;
        this._lateKeyboardMonitorId = null;
        this._keyboardUsbSeenAtUsec = 0;
        this._daemonRecoveryInFlight = false;
        this._lastDaemonRestartUsec = 0;
        this._shutdownActionInFlight = false;
        this._testBridge = null;

        this._indicator = new PanelMenu.Button(PANEL_MENU_ALIGNMENT, this.metadata.name, false);
        this._icon = new St.Icon({
            icon_name: 'input-keyboard-symbolic',
            style_class: 'system-status-icon',
        });
        this._indicator.add_child(this._icon);
        Main.panel.addToStatusArea(this.uuid, this._indicator);
        this._connectBackendSignals();
        this._connectSystemSignals();
        this._updateLateKeyboardMonitor();

        this._menuOpenStateChangedId = this._indicator.menu.connect(
            'open-state-changed',
            (_menu, isOpen) => {
                if (!isOpen)
                    return;

                this._refreshBackendState().catch(error =>
                    console.error(`[RRC] menu refresh failed: ${error.message}`));
            }
        );

        this._buildMenu();
        this._enableTestBridge();
        this._refreshBackendState().catch(error => {
            console.error(`[RRC] initial refresh failed: ${error.message}`);
            this._backendState = this._buildUnavailableState(error.message);
            this._updateLateKeyboardMonitor();
            this._buildMenu();
        });
    }

    disable() {
        this._destroyControlPad();
        this._disableTestBridge();

        if (this._deferredRefreshTimeout) {
            GLib.source_remove(this._deferredRefreshTimeout);
            this._deferredRefreshTimeout = null;
        }

        if (this._startupRestoreRetryId) {
            GLib.source_remove(this._startupRestoreRetryId);
            this._startupRestoreRetryId = null;
        }

        if (this._lateKeyboardMonitorId) {
            GLib.source_remove(this._lateKeyboardMonitorId);
            this._lateKeyboardMonitorId = null;
        }

        for (const id of this._dbusSignalIds)
            Gio.DBus.session.signal_unsubscribe(id);
        this._dbusSignalIds = [];

        for (const id of this._systemSignalIds)
            Gio.DBus.system.signal_unsubscribe(id);
        this._systemSignalIds = [];

        if (this._menuOpenStateChangedId && this._indicator?.menu) {
            this._indicator.menu.disconnect(this._menuOpenStateChangedId);
            this._menuOpenStateChangedId = null;
        }

        this._keyboardUsbSeenAtUsec = 0;
        this._daemonRecoveryInFlight = false;
        this._lastDaemonRestartUsec = 0;
        this._hasSavedLightingState = false;
        this._startupRestoreState = null;
        this._startupRestorePending = false;
        this._startupRestoreInFlight = false;
        this._startupRestoreAttemptCount = 0;
        this._shutdownActionInFlight = false;
        this._customModeLayouts = null;
        this._editorSelectedKeyId = null;
        this._settings = null;
        this._icon = null;
        this._indicator?.destroy();
        this._indicator = null;
    }

    _migrateLegacySettingsIfNeeded() {
        if (!this._settings)
            return;

        const legacySettings = this._getLegacySettings();
        if (!legacySettings)
            return;

        const migratedKeys = [];
        for (const key of ['last-preset', 'custom-mode-layouts']) {
            if (this._settings.get_string(key))
                continue;

            const legacyValue = legacySettings.get_string(key);
            if (!legacyValue)
                continue;

            this._settings.set_string(key, legacyValue);
            migratedKeys.push(key);
        }

        if (migratedKeys.length > 0) {
            console.log(
                `[RRC] Migrated legacy settings from ${LEGACY_SETTINGS_SCHEMA_ID}: ${migratedKeys.join(', ')}`
            );
        }
    }

    _getLegacySettings() {
        const legacySchemaDir = findExtensionSchemaDirByPrefix(LEGACY_EXTENSION_UUID_PREFIX);
        if (!legacySchemaDir)
            return null;

        const legacyCompiledSchemasPath = GLib.build_filenamev([
            legacySchemaDir,
            'gschemas.compiled',
        ]);
        if (!GLib.file_test(legacyCompiledSchemasPath, GLib.FileTest.EXISTS))
            return null;

        try {
            const defaultSource = Gio.SettingsSchemaSource.get_default();
            const source = Gio.SettingsSchemaSource.new_from_directory(
                legacySchemaDir,
                defaultSource,
                false
            );
            const schema = source.lookup(LEGACY_SETTINGS_SCHEMA_ID, false);
            if (!schema)
                return null;

            return new Gio.Settings({settings_schema: schema});
        } catch (error) {
            console.warn(`[RRC] Failed to load legacy settings: ${error.message}`);
            return null;
        }
    }

    _shouldEnableTestBridge() {
        return GLib.file_test(getTestBridgeSentinelPath(), GLib.FileTest.EXISTS);
    }

    _enableTestBridge() {
        if (this._testBridge)
            return;

        const bridgeObject = Gio.DBusExportedObject.wrapJSObject(TEST_BRIDGE_XML, {
            Ping: () => {
                const bridgeEnabled = this._shouldEnableTestBridge();
                return encodeTestBridgePayload({
                    ok: bridgeEnabled,
                    bridgeEnabled,
                    extensionUuid: this.uuid,
                });
            },
            GetBackendSnapshot: () => {
                if (!this._shouldEnableTestBridge())
                    return encodeTestBridgePayload(this._getDisabledTestBridgePayload());

                return encodeTestBridgePayload(
                    this._getTestBridgeBackendSnapshot()
                );
            },
            GetUiSnapshot: () => {
                if (!this._shouldEnableTestBridge())
                    return encodeTestBridgePayload(this._getDisabledTestBridgePayload());

                return encodeTestBridgePayload(
                    this._getTestBridgeUiSnapshot()
                );
            },
            OpenMenu: () => {
                if (!this._shouldEnableTestBridge())
                    return encodeTestBridgePayload(this._getDisabledTestBridgePayload());

                this._indicator?.menu?.open();
                return encodeTestBridgePayload(
                    this._getTestBridgeUiSnapshot()
                );
            },
            CloseMenu: () => {
                if (!this._shouldEnableTestBridge())
                    return encodeTestBridgePayload(this._getDisabledTestBridgePayload());

                this._indicator?.menu?.close();
                return encodeTestBridgePayload(
                    this._getTestBridgeUiSnapshot()
                );
            },
            OpenControlPad: () => {
                if (!this._shouldEnableTestBridge())
                    return encodeTestBridgePayload(this._getDisabledTestBridgePayload());

                this._buildControlPad();
                return encodeTestBridgePayload(
                    this._getTestBridgeUiSnapshot()
                );
            },
            CloseControlPad: () => {
                if (!this._shouldEnableTestBridge())
                    return encodeTestBridgePayload(this._getDisabledTestBridgePayload());

                this._destroyControlPad();
                return encodeTestBridgePayload(
                    this._getTestBridgeUiSnapshot()
                );
            },
            RefreshBackendStateAsync: (_params, invocation) => {
                if (!this._shouldEnableTestBridge()) {
                    invocation.return_value(new GLib.Variant('(s)', [
                        encodeTestBridgePayload(this._getDisabledTestBridgePayload()),
                    ]));
                    return;
                }

                this._refreshBackendState({forceUiRefresh: true})
                    .then(() => {
                        invocation.return_value(new GLib.Variant('(s)', [
                            encodeTestBridgePayload(
                                this._getTestBridgeBackendSnapshot()
                            ),
                        ]));
                    })
                    .catch(error => {
                        invocation.return_dbus_error(
                            `${TEST_BRIDGE_INTERFACE}.Error`,
                            error.message
                        );
                    });
            },
        });

        bridgeObject.export(Gio.DBus.session, TEST_BRIDGE_OBJECT_PATH);
        this._testBridge = bridgeObject;
    }

    _disableTestBridge() {
        if (!this._testBridge)
            return;

        try {
            this._testBridge.unexport();
        } catch (error) {
            console.error(`[RRC] Failed to unexport test bridge: ${error.message}`);
        }

        this._testBridge = null;
    }

    _getTestBridgeBackendSnapshot() {
        return buildTestBridgeBackendSnapshot(this._backendState, this.uuid);
    }

    _getDisabledTestBridgePayload() {
        return {
            ok: false,
            bridgeEnabled: false,
            extensionUuid: this.uuid,
            reason: `Create ${getTestBridgeSentinelDisplayPath()} and reload the extension to enable the UI test bridge.`,
        };
    }

    _getTestBridgeUiSnapshot() {
        const menuTexts = uniqueTextList(
            collectActorLabelTexts(this._indicator?.menu?.box ?? null)
        );
        const controlPadTexts = uniqueTextList(
            collectActorLabelTexts(this._controlPad)
        );
        const indicatorParent = this._indicator?.get_parent?.() ?? null;

        return {
            extensionUuid: this.uuid,
            indicatorPresent: Boolean(indicatorParent),
            indicatorVisible: this._indicator?.visible ?? false,
            indicatorParentType: indicatorParent?.constructor?.name ?? null,
            menuOpen: Boolean(this._indicator?.menu?.isOpen),
            controlPadOpen: Boolean(this._controlPad),
            controlPadHasModalGrab: Boolean(this._controlPadModalGrab),
            menuSectionTitles: menuTexts.filter(text => TEST_BRIDGE_MENU_TITLES.has(text)),
            controlPadSectionTitles: controlPadTexts.filter(text => TEST_BRIDGE_CONTROL_PAD_TITLES.has(text)),
            keyboardPresetSectionsVisible: Boolean(this._backendState.keyboard) &&
                menuTexts.includes('Static colors') &&
                menuTexts.includes('Brightness'),
            keyboardCardPresent: controlPadTexts.includes('Razer BlackWidow V3 Tenkeyless'),
            menuTexts,
            controlPadTexts,
            backend: this._getTestBridgeBackendSnapshot(),
        };
    }

    _buildUnavailableState(reason) {
        return {
            available: false,
            reason,
            daemonVersion: null,
            devices: [],
            keyboard: null,
        };
    }

    _getCurrentColorPreset() {
        return this._getColorPresetForSelectionState(this._selectionState);
    }

    _getColorPresetForSelectionState(selectionState = this._selectionState) {
        return resolveSelectionColor(selectionState);
    }

    _updateSelectionState(patch, {syncStartupRestore = true} = {}) {
        this._selectionState = {
            ...this._selectionState,
            ...patch,
        };

        if (syncStartupRestore && this._startupRestorePending && this._startupRestoreState) {
            this._startupRestoreState = {
                ...this._startupRestoreState,
                ...patch,
            };
        }

        saveSelectionState(this._settings, this._selectionState);
        this._hasSavedLightingState = true;
    }

    _shouldRunPresenceMonitor() {
        return !this._backendState.keyboard;
    }

    _getMatrixDimensions() {
        return this._backendState.keyboard?.matrixDimensions ?? [6, 18];
    }

    _getModePresetById(modeId) {
        return PROGRAMMER_MODE_PRESETS.find(preset => preset.id === modeId) ?? null;
    }

    _getEditorModePreset() {
        return this._getModePresetById(this._selectionState.selectedModeId)
            ?? PROGRAMMER_MODE_PRESETS[0];
    }

    _getEditorSelectedKey() {
        return KEYBOARD_EDITOR_KEY_MAP.get(this._editorSelectedKeyId)
            ?? KEYBOARD_EDITOR_ROWS[0][0];
    }

    _getDefaultModeLayout(modePreset, matrixDimensions = this._getMatrixDimensions()) {
        return createModeLayout(
            buildProgrammerModeMatrix(modePreset, matrixDimensions),
            matrixDimensions,
            CUSTOM_MODE_LAYOUT_VERSION
        );
    }

    _getModeLayout(modeId, matrixDimensions = this._getMatrixDimensions()) {
        const modePreset = this._getModePresetById(modeId) ?? PROGRAMMER_MODE_PRESETS[0];
        const storedLayout = this._customModeLayouts?.[modeId];
        if (storedLayout?.rows === matrixDimensions[0] &&
            storedLayout?.cols === matrixDimensions[1]) {
            const currentLayout = storedLayout.version === CUSTOM_MODE_LAYOUT_VERSION
                ? createModeLayout(
                    storedLayout.frame,
                    matrixDimensions,
                    CUSTOM_MODE_LAYOUT_VERSION
                )
                : migrateModeLayoutToCurrentVersion(storedLayout);

            if (currentLayout?.version === CUSTOM_MODE_LAYOUT_VERSION) {
                if (storedLayout.version !== CUSTOM_MODE_LAYOUT_VERSION)
                    this._saveModeLayout(modeId, currentLayout);

                return currentLayout;
            }
        }

        return this._getDefaultModeLayout(modePreset, matrixDimensions);
    }

    _saveModeLayout(modeId, modeLayout) {
        const nextLayouts = this._customModeLayouts
            ? {...this._customModeLayouts}
            : {};
        nextLayouts[modeId] = createModeLayout(
            modeLayout.frame,
            [modeLayout.rows, modeLayout.cols],
            CUSTOM_MODE_LAYOUT_VERSION
        );
        this._customModeLayouts = nextLayouts;
        saveCustomModeLayouts(this._settings, this._customModeLayouts);
    }

    _selectEditorKey(keyId) {
        this._editorSelectedKeyId = KEYBOARD_EDITOR_KEY_MAP.has(keyId)
            ? keyId
            : KEYBOARD_EDITOR_ROWS[0][0].id;

        if (this._controlPad)
            this._buildControlPad();
    }

    async _applyModeLayout(modePreset, modeLayout, actionLabel) {
        this._saveModeLayout(modePreset.id, modeLayout);

        if (!this._backendState.keyboard) {
            this._updateSelectionState({
                selectedEffectId: null,
                selectedModeId: modePreset.id,
            });
            this._buildMenu();
            if (this._controlPad)
                this._buildControlPad();
            return;
        }

        await this._runDeviceAction(
            this._backendState.keyboard,
            actionLabel,
            device => applyCustomMatrix(device, modeLayout.frame),
            {
                selectedEffectId: null,
                selectedModeId: modePreset.id,
            }
        );
    }

    async _paintSelectedEditorKey(color) {
        const modePreset = this._getEditorModePreset();
        const keyDef = this._getEditorSelectedKey();
        const modeLayout = this._getModeLayout(modePreset.id);
        paintKeyCells(modeLayout, keyDef, color);
        await this._applyModeLayout(modePreset, modeLayout, `${modePreset.label} ${keyDef.label}`);
    }

    async _resetEditorMode() {
        const modePreset = this._getEditorModePreset();
        const modeLayout = this._getDefaultModeLayout(modePreset);
        await this._applyModeLayout(modePreset, modeLayout, `${modePreset.label} reset`);
    }

    _connectBackendSignals() {
        this._dbusSignalIds = [
            Gio.DBus.session.signal_subscribe(
                RAZER_SERVICE,
                RAZER_DEVICES_IFACE,
                'device_added',
                RAZER_MANAGER_PATH,
                null,
                Gio.DBusSignalFlags.NONE,
                () => {
                    clearIntrospectionCache();
                    this._keyboardUsbSeenAtUsec = 0;
                    this._scheduleDeferredRefresh('device-added', HOTPLUG_SIGNAL_REFRESH_DELAY_MS);
                }
            )
            ,
            Gio.DBus.session.signal_subscribe(
                RAZER_SERVICE,
                RAZER_DEVICES_IFACE,
                'device_removed',
                RAZER_MANAGER_PATH,
                null,
                Gio.DBusSignalFlags.NONE,
                () => {
                    clearIntrospectionCache();
                    this._keyboardUsbSeenAtUsec = 0;
                    this._scheduleDeferredRefresh('device-removed', 250);
                }
            )
            ,
            Gio.DBus.session.signal_subscribe(
                DBUS_SERVICE_IFACE,
                DBUS_SERVICE_IFACE,
                'NameOwnerChanged',
                DBUS_SERVICE_PATH,
                RAZER_SERVICE,
                Gio.DBusSignalFlags.NONE,
                () => {
                    clearIntrospectionCache();
                    this._keyboardUsbSeenAtUsec = 0;
                    this._scheduleDeferredRefresh('owner-changed', HOTPLUG_SIGNAL_REFRESH_DELAY_MS);
                }
            )
        ];
    }

    _connectSystemSignals() {
        this._systemSignalIds = [
            Gio.DBus.system.signal_subscribe(
                LOGIN1_SERVICE,
                LOGIN1_MANAGER_IFACE,
                'PrepareForShutdown',
                LOGIN1_MANAGER_PATH,
                null,
                Gio.DBusSignalFlags.NONE,
                (_connection, _sender, _path, _iface, _signal, parameters) => {
                    const [isPreparing] = parameters.deepUnpack?.() ?? parameters.recursiveUnpack?.() ?? [];
                    if (!isPreparing)
                        return;

                    this._runShutdownActions('shutdown').catch(error =>
                        console.error(`[RRC] shutdown action failed: ${error.message}`));
                }
            ),
        ];
    }

    async _runShutdownActions(reason) {
        if (this._shutdownActionInFlight)
            return;

        this._shutdownActionInFlight = true;
        console.log(`[RRC] Running device shutdown actions for ${reason}`);

        try {
            const actions = [];
            const keyboard = this._backendState.keyboard;
            if (keyboard) {
                actions.push(
                    applyNone(keyboard).catch(error => {
                        console.warn(`[RRC] Failed to turn off keyboard lights during ${reason}: ${error.message}`);
                    })
                );
            }

            await Promise.all(actions);
        } finally {
            this._shutdownActionInFlight = false;
        }
    }

    _captureLightingRestoreStateIfNeeded() {
        if (this._startupRestoreState || !this._hasSavedLightingState)
            return;

        this._startupRestoreState = cloneSelectionState(this._selectionState);
    }

    _queueKeyboardLightingRestore() {
        if (!this._hasSavedLightingState)
            return;

        this._captureLightingRestoreStateIfNeeded();
        this._startupRestorePending = true;
        this._startupRestoreAttemptCount = 0;
        this._clearStartupRestoreRetry();
    }

    _clearStartupRestoreRetry() {
        if (!this._startupRestoreRetryId)
            return;

        GLib.source_remove(this._startupRestoreRetryId);
        this._startupRestoreRetryId = null;
    }

    _clearLightingRestoreStateIfIdle() {
        if (this._startupRestorePending || this._startupRestoreInFlight) {
            return;
        }

        this._startupRestoreState = null;
    }

    _markStartupRestoreComplete() {
        this._clearStartupRestoreRetry();
        this._startupRestorePending = false;
        this._startupRestoreInFlight = false;
        this._startupRestoreAttemptCount = 0;
        this._clearLightingRestoreStateIfIdle();
    }

    _scheduleStartupRestoreRetry() {
        if (!this._startupRestorePending ||
            this._startupRestoreRetryId ||
            this._startupRestoreAttemptCount >= STARTUP_RESTORE_MAX_ATTEMPTS ||
            !this._indicator) {
            return;
        }

        this._startupRestoreRetryId = GLib.timeout_add(
            GLib.PRIORITY_DEFAULT,
            STARTUP_RESTORE_RETRY_DELAY_MS,
            () => {
                this._startupRestoreRetryId = null;
                this._maybeRestoreKeyboardOnStartup().catch(error =>
                    console.error(`[RRC] keyboard lighting restore retry failed: ${error.message}`));
                return GLib.SOURCE_REMOVE;
            }
        );
    }

    async _applyKeyboardSelectionState(keyboard, selectionState = this._selectionState) {
        if (!keyboard)
            return;

        const matrixDimensions = keyboard.matrixDimensions ?? this._getMatrixDimensions();
        const modeFrame = resolveModeLayoutFrame(
            selectionState?.selectedModeId,
            this._customModeLayouts,
            matrixDimensions
        );

        if (modeFrame) {
            await applyCustomMatrix(keyboard, modeFrame);
        } else {
            const colorPreset = resolveSelectionColor(selectionState);
            switch (selectionState?.selectedEffectId) {
            case 'spectrum':
                await applySpectrum(keyboard);
                break;
            case 'wave-left':
                await applyWave(keyboard, WAVE_LEFT);
                break;
            case 'wave-right':
                await applyWave(keyboard, WAVE_RIGHT);
                break;
            case 'breathe':
                await applyBreathSingle(
                    keyboard,
                    colorPreset.red,
                    colorPreset.green,
                    colorPreset.blue
                );
                break;
            case 'off':
                await applyNone(keyboard);
                break;
            default:
                await applyStatic(
                    keyboard,
                    colorPreset.red,
                    colorPreset.green,
                    colorPreset.blue
                );
                break;
            }
        }

        const brightnessPercent = getBrightnessPercent(selectionState);
        if (brightnessPercent !== null)
            await setBrightness(keyboard, brightnessPercent);
    }

    async _maybeRestoreKeyboardOnStartup() {
        if (!this._startupRestorePending ||
            this._startupRestoreInFlight ||
            this._actionInProgress ||
            !this._indicator ||
            !this._backendState.keyboard) {
            return;
        }

        const restoreState = this._startupRestoreState ?? cloneSelectionState(this._selectionState);
        if (!restoreState) {
            this._markStartupRestoreComplete();
            return;
        }

        this._startupRestoreInFlight = true;
        this._clearStartupRestoreRetry();
        this._startupRestoreAttemptCount++;
        const attempt = this._startupRestoreAttemptCount;

        try {
            await this._applyKeyboardSelectionState(this._backendState.keyboard, restoreState);
            this._markStartupRestoreComplete();
            await this._refreshBackendState({forceUiRefresh: true});
        } catch (error) {
            console.warn(`[RRC] Keyboard lighting restore attempt ${attempt} failed: ${error.message}`);
            this._startupRestoreInFlight = false;

            if (attempt >= STARTUP_RESTORE_MAX_ATTEMPTS) {
                console.warn('[RRC] Giving up on automatic keyboard lighting restore for this session');
                this._markStartupRestoreComplete();
                return;
            }

            this._scheduleStartupRestoreRetry();
        } finally {
            if (this._startupRestorePending)
                this._startupRestoreInFlight = false;
        }
    }

    _scheduleDeferredRefresh(reason, delayMs = 0) {
        if (this._deferredRefreshTimeout) {
            GLib.source_remove(this._deferredRefreshTimeout);
            this._deferredRefreshTimeout = null;
        }

        if (delayMs <= 0) {
            this._refreshBackendState().catch(error =>
                console.error(`[RRC] ${reason} refresh failed: ${error.message}`));
            return;
        }

        this._deferredRefreshTimeout = GLib.timeout_add(
            GLib.PRIORITY_DEFAULT,
            delayMs,
            () => {
                this._deferredRefreshTimeout = null;
                this._refreshBackendState().catch(error =>
                    console.error(`[RRC] ${reason} refresh failed: ${error.message}`));
                return GLib.SOURCE_REMOVE;
            }
        );
    }

    _updateLateKeyboardMonitor() {
        const shouldMonitor = this._shouldRunPresenceMonitor();

        if (shouldMonitor && !this._lateKeyboardMonitorId) {
            this._lateKeyboardMonitorId = GLib.timeout_add(
                GLib.PRIORITY_DEFAULT,
                KEYBOARD_ABSENT_POLL_INTERVAL_MS,
                () => {
                    this._checkForLateKeyboard().catch(error =>
                        console.error(`[RRC] late keyboard check failed: ${error.message}`));
                    return GLib.SOURCE_CONTINUE;
                }
            );
            return;
        }

        if (!shouldMonitor && this._lateKeyboardMonitorId) {
            GLib.source_remove(this._lateKeyboardMonitorId);
            this._lateKeyboardMonitorId = null;
        }

        if (!shouldMonitor)
            this._keyboardUsbSeenAtUsec = 0;
    }

    async _checkForLateKeyboard() {
        if (this._actionInProgress || this._daemonRecoveryInFlight)
            return;

        await this._refreshBackendState();

        if (this._backendState.keyboard) {
            this._keyboardUsbSeenAtUsec = 0;
            return;
        }

        const keyboardUsbPresent = await isTargetKeyboardUsbPresent();
        if (!keyboardUsbPresent) {
            this._keyboardUsbSeenAtUsec = 0;
            return;
        }

        const now = GLib.get_monotonic_time();
        if (this._keyboardUsbSeenAtUsec === 0) {
            console.log('[RRC] Keyboard USB detected while OpenRazer has no keyboard yet — monitoring hotplug recovery');
            this._keyboardUsbSeenAtUsec = now;
            return;
        }

        const visibleForMs = Math.floor((now - this._keyboardUsbSeenAtUsec) / 1000);
        if (visibleForMs < KEYBOARD_USB_RECOVERY_GRACE_MS)
            return;

        const msSinceRestart = this._lastDaemonRestartUsec > 0
            ? Math.floor((now - this._lastDaemonRestartUsec) / 1000)
            : Number.POSITIVE_INFINITY;
        if (msSinceRestart < OPENRAZER_RESTART_COOLDOWN_MS)
            return;

        await this._recoverLateKeyboard();
    }

    async _recoverLateKeyboard() {
        if (this._daemonRecoveryInFlight)
            return;

        this._daemonRecoveryInFlight = true;
        this._lastDaemonRestartUsec = GLib.get_monotonic_time();
        clearIntrospectionCache();

        try {
            console.log('[RRC] Restarting openrazer-daemon because the keyboard is present over USB but not exposed on D-Bus');
            await restartOpenRazerDaemon();
            this._scheduleDeferredRefresh('daemon-restart', HOTPLUG_SIGNAL_REFRESH_DELAY_MS);
        } catch (error) {
            console.error(`[RRC] OpenRazer recovery restart failed: ${error.message}`);
        } finally {
            this._daemonRecoveryInFlight = false;
        }
    }

    async _refreshBackendState({forceUiRefresh = false} = {}) {
        const refreshSeq = ++this._refreshSeq;
        const previousState = this._backendState;
        const previousSignature = buildBackendStateSignature(previousState);

        let nextState;
        try {
            nextState = await discoverOpenRazerState();
        } catch (error) {
            nextState = this._buildUnavailableState(error.message);
        }

        if (refreshSeq !== this._refreshSeq || !this._indicator)
            return;

        const nextSignature = buildBackendStateSignature(nextState);
        const stateChanged = previousSignature !== nextSignature;
        const keyboardBecameAvailable = didKeyboardBecomeAvailable(previousState, nextState);
        this._backendState = nextState;

        if (keyboardBecameAvailable)
            this._queueKeyboardLightingRestore();

        if (nextState.keyboard &&
            typeof nextState.keyboard.brightness === 'number' &&
            !this._startupRestorePending &&
            !this._startupRestoreInFlight) {
            this._updateSelectionState({
                selectedBrightnessId: getBrightnessPresetId(nextState.keyboard.brightness),
            }, {syncStartupRestore: false});
        }

        this._updateLateKeyboardMonitor();

        if (!stateChanged && !forceUiRefresh) {
            this._maybeRestoreKeyboardOnStartup().catch(error =>
                console.error(`[RRC] keyboard lighting restore failed: ${error.message}`));
            return;
        }

        this._buildMenu();

        if (this._controlPad)
            this._buildControlPad();

        this._maybeRestoreKeyboardOnStartup().catch(error =>
            console.error(`[RRC] keyboard lighting restore failed: ${error.message}`));
    }

    _buildMenu() {
        if (!this._indicator)
            return;

        const menu = this._indicator.menu;
        menu.removeAll();
        menu.addMenuItem(this._createStatusMenuItem());

        if (this._backendState.keyboard) {
            menu.addMenuItem(this._createMenuSectionItem('Static colors', [
                this._createColorChipRow(PRIMARY_COLOR_ROWS[0]),
                this._createColorChipRow(PRIMARY_COLOR_ROWS[1]),
            ]));
            menu.addMenuItem(this._createMenuSectionItem('Custom modes', [
                this._createTextChipRow(PROGRAMMER_MODE_PRESETS, 'mode'),
            ]));
            menu.addMenuItem(this._createMenuSectionItem('Custom color', [
                this._createCustomColorRow(),
            ]));
            menu.addMenuItem(this._createMenuSectionItem('Effects', [
                this._createTextChipRow(EFFECT_PRESETS, 'effect'),
            ]));
            menu.addMenuItem(this._createMenuSectionItem('Brightness', [
                this._createTextChipRow(BRIGHTNESS_PRESETS, 'brightness'),
            ]));
        } else {
            const infoItem = new PopupMenu.PopupMenuItem(
                'Quick presets will appear when OpenRazer detects the keyboard.',
                {reactive: false}
            );
            infoItem.setSensitive(false);
            menu.addMenuItem(infoItem);
        }

        menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

        const openPadItem = new PopupMenu.PopupMenuItem('Open Control Pad…');
        openPadItem.connect('activate', () => {
            menu.close();
            this._buildControlPad();
        });
        menu.addMenuItem(openPadItem);

        const refreshItem = new PopupMenu.PopupMenuItem('Refresh Status');
        refreshItem.connect('activate', () => {
            this._refreshBackendState().catch(error => {
                this._lastError = error.message;
                this._buildMenu();
            });
        });
        menu.addMenuItem(refreshItem);
    }

    _createMenuSectionItem(title, contentActors) {
        const item = new PopupMenu.PopupBaseMenuItem({
            reactive: false,
            can_focus: false,
        });

        const section = new St.BoxLayout({
            vertical: true,
            x_expand: true,
            style_class: 'rrc-menu-section',
            style: 'spacing: 6px;',
        });
        item.add_child(section);

        section.add_child(new St.Label({
            text: title,
            style_class: 'rrc-section-title',
            x_align: Clutter.ActorAlign.START,
        }));

        for (const actor of contentActors)
            section.add_child(actor);

        return item;
    }

    _createStatusMenuItem() {
        const item = new PopupMenu.PopupBaseMenuItem({
            reactive: false,
            can_focus: false,
        });

        const box = new St.BoxLayout({
            vertical: true,
            x_expand: true,
            style_class: 'rrc-menu-status',
            style: 'spacing: 4px;',
        });
        item.add_child(box);

        box.add_child(new St.Label({
            text: EXTENSION_TITLE,
            style_class: 'rrc-status-title',
            x_align: Clutter.ActorAlign.START,
        }));

        box.add_child(new St.Label({
            text: this._getStatusSubtitle(),
            style_class: 'rrc-status-subtitle',
            x_align: Clutter.ActorAlign.START,
        }));

        const detail = this._getStatusDetail();
        if (detail) {
            box.add_child(new St.Label({
                text: detail,
                style_class: 'rrc-status-note',
                x_align: Clutter.ActorAlign.START,
            }));
        }

        if (this._actionInProgress) {
            box.add_child(new St.Label({
                text: 'Applying preset…',
                style_class: 'rrc-status-note',
                x_align: Clutter.ActorAlign.START,
            }));
        }

        if (this._lastError) {
            box.add_child(new St.Label({
                text: this._lastError,
                style_class: 'rrc-status-error',
                x_align: Clutter.ActorAlign.START,
            }));
        }

        return item;
    }

    _getStatusSubtitle() {
        const {available, daemonVersion, keyboard, reason} = this._backendState;

        if (keyboard) {
            const parts = [keyboard.name];
            if (daemonVersion)
                parts.push(`OpenRazer ${daemonVersion}`);
            if (typeof keyboard.brightness === 'number')
                parts.push(`Brightness ${Math.round(keyboard.brightness)}%`);

            return parts.join(' • ');
        }

        if (available)
            return reason ?? 'OpenRazer is ready, but the keyboard is not available.';

        return reason ?? 'OpenRazer is unavailable.';
    }

    _getStatusDetail() {
        if (this._backendState.keyboard) {
            const additionalDevices = this._backendState.devices
                .filter(device => device.serial !== this._backendState.keyboard.serial)
                .map(device => device.name);

            if (additionalDevices.length > 0)
                return `Also detected: ${additionalDevices.join(', ')}`;

            return 'Use the presets below or open the larger control pad for per-key programmer modes and custom hue.';
        }

        if (this._backendState.devices.length > 0)
            return `Detected devices: ${this._backendState.devices.map(device => device.name).join(', ')}`;

        return 'Install OpenRazer, join plugdev, and make sure openrazer-daemon is running.';
    }

    _createColorChipRow(presets) {
        const row = new St.BoxLayout({
            style_class: 'rrc-chip-row',
            x_expand: true,
            style: 'spacing: 8px;',
        });

        for (const preset of presets) {
            row.add_child(createColorChipButton(
                preset,
                this._selectionState.selectedColorId === preset.id,
                () => {
                    this._applyColorPreset(preset).catch(error =>
                        console.error(`[RRC] apply color failed: ${error.message}`));
                }
            ));
        }

        return row;
    }

    _createTextChipRow(presets, kind) {
        const row = new St.BoxLayout({
            style_class: 'rrc-chip-row',
            x_expand: true,
            style: 'spacing: 8px;',
        });

        for (const preset of presets) {
            let isActive = false;
            if (kind === 'effect')
                isActive = this._selectionState.selectedEffectId === preset.id;
            else if (kind === 'brightness')
                isActive = this._selectionState.selectedBrightnessId === preset.id;
            else if (kind === 'mode')
                isActive = this._selectionState.selectedModeId === preset.id;

            row.add_child(createTextChipButton(
                preset,
                isActive,
                () => {
                    let operation;
                    if (kind === 'effect')
                        operation = this._applyEffectPreset(preset);
                    else if (kind === 'brightness')
                        operation = this._applyBrightnessPreset(preset);
                    else
                        operation = this._applyModePreset(preset);
                    operation.catch(error =>
                        console.error(`[RRC] apply ${kind} failed: ${error.message}`));
                }
            ));
        }

        return row;
    }

    _createCustomColorRow() {
        const customColor = buildCustomColorPreset(this._selectionState.customHue);
        const row = new St.BoxLayout({
            style_class: 'rrc-custom-row',
            x_expand: true,
            style: 'spacing: 10px;',
        });

        const previewButton = new St.Button({
            style_class: this._selectionState.selectedColorId === 'custom'
                ? 'rrc-color-chip-button rrc-color-chip-button-active'
                : 'rrc-color-chip-button',
            x_align: Clutter.ActorAlign.START,
            y_align: Clutter.ActorAlign.CENTER,
            can_focus: true,
        });

        const previewLabel = new St.Label({
            text: customColor.label,
            style_class: 'rrc-chip-label',
            x_align: Clutter.ActorAlign.CENTER,
            y_align: Clutter.ActorAlign.CENTER,
        });
        previewButton.set_child(previewLabel);
        applyColorChipVisuals(
            previewButton,
            previewLabel,
            customColor,
            this._selectionState.selectedColorId === 'custom'
        );
        previewButton.connect('clicked', () => {
            this._applyCustomColor(this._selectionState.customHue).catch(error =>
                console.error(`[RRC] apply custom color failed: ${error.message}`));
        });
        row.add_child(previewButton);

        const sliderBin = new St.Bin({
            x_expand: true,
            style_class: 'rrc-custom-slider-bin',
        });

        const hueSlider = new Slider.Slider(this._selectionState.customHue);
        hueSlider.add_style_class_name('rrc-hue-slider');
        hueSlider.x_expand = true;
        sliderBin.set_child(hueSlider);
        row.add_child(sliderBin);

        const hexLabel = new St.Label({
            text: customColor.hex,
            style_class: 'rrc-custom-hex',
            x_align: Clutter.ActorAlign.END,
            y_align: Clutter.ActorAlign.CENTER,
        });
        row.add_child(hexLabel);

        const updateCustomPreview = hue => {
            const nextColor = buildCustomColorPreset(hue);
            const isSelected = this._selectionState.selectedColorId === 'custom';
            applyColorChipVisuals(previewButton, previewLabel, nextColor, isSelected);
            hexLabel.text = nextColor.hex;
        };

        hueSlider.connect('notify::value', slider => {
            const nextHue = clampUnit(slider.value);
            this._selectionState = {
                ...this._selectionState,
                customHue: nextHue,
            };
            updateCustomPreview(nextHue);
        });
        hueSlider.connect('drag-end', slider => {
            this._applyCustomColor(slider.value).catch(error =>
                console.error(`[RRC] apply custom color failed: ${error.message}`));
        });

        return row;
    }

    _createModeEditorRow(modePreset, presets) {
        const row = new St.BoxLayout({
            style_class: 'rrc-chip-row',
            x_expand: true,
            style: 'spacing: 8px;',
        });

        for (const preset of presets) {
            row.add_child(createColorChipButton(
                preset,
                false,
                () => {
                    this._paintSelectedEditorKey(preset).catch(error =>
                        console.error(`[RRC] paint editor key failed: ${error.message}`));
                }
            ));
        }

        return row;
    }

    _createModeEditorCustomColorRow() {
        const customColor = buildCustomColorPreset(this._selectionState.customHue);
        const row = new St.BoxLayout({
            style_class: 'rrc-custom-row',
            x_expand: true,
            style: 'spacing: 10px;',
        });

        const paintButton = new St.Button({
            style_class: 'rrc-color-chip-button',
            x_align: Clutter.ActorAlign.START,
            y_align: Clutter.ActorAlign.CENTER,
            can_focus: true,
        });

        const paintLabel = new St.Label({
            text: 'Paint',
            style_class: 'rrc-chip-label',
            x_align: Clutter.ActorAlign.CENTER,
            y_align: Clutter.ActorAlign.CENTER,
        });
        paintButton.set_child(paintLabel);
        applyColorChipVisuals(paintButton, paintLabel, customColor, false);
        paintButton.connect('clicked', () => {
            const currentCustomColor = buildCustomColorPreset(
                clampUnit(this._selectionState.customHue)
            );
            this._paintSelectedEditorKey(currentCustomColor).catch(error =>
                console.error(`[RRC] paint custom editor color failed: ${error.message}`));
        });
        row.add_child(paintButton);

        const sliderBin = new St.Bin({
            x_expand: true,
            style_class: 'rrc-custom-slider-bin',
        });

        const hueSlider = new Slider.Slider(this._selectionState.customHue);
        hueSlider.add_style_class_name('rrc-hue-slider');
        hueSlider.x_expand = true;
        sliderBin.set_child(hueSlider);
        row.add_child(sliderBin);

        const hexLabel = new St.Label({
            text: customColor.hex,
            style_class: 'rrc-custom-hex',
            x_align: Clutter.ActorAlign.END,
            y_align: Clutter.ActorAlign.CENTER,
        });
        row.add_child(hexLabel);

        const updatePreview = hue => {
            const nextColor = buildCustomColorPreset(hue);
            applyColorChipVisuals(paintButton, paintLabel, nextColor, false);
            hexLabel.text = nextColor.hex;
        };

        hueSlider.connect('notify::value', slider => {
            const nextHue = clampUnit(slider.value);
            this._selectionState = {
                ...this._selectionState,
                customHue: nextHue,
            };
            updatePreview(nextHue);
        });
        hueSlider.connect('drag-end', slider => {
            this._updateSelectionState({customHue: clampUnit(slider.value)});
        });

        return row;
    }

    _createVirtualKeyboardPreview(modeLayout) {
        const previewLayout = buildKeyboardEditorPreviewLayout();
        const frame = new St.Bin({
            style_class: 'rrc-virtual-keyboard',
            x_expand: true,
            x_align: Clutter.ActorAlign.START,
            y_align: Clutter.ActorAlign.START,
        });
        const keyboard = new St.Widget({
            layout_manager: new Clutter.FixedLayout(),
            width: Math.ceil(previewLayout.widthPx),
            height: Math.ceil(previewLayout.heightPx),
            x_align: Clutter.ActorAlign.START,
            y_align: Clutter.ActorAlign.START,
            x_expand: true,
        });
        frame.set_child(keyboard);

        for (const rowLayout of previewLayout.rowLayouts) {
            for (const {keyDef, x, y, widthPx} of rowLayout.keys) {
                const color = readKeyColorFromLayout(modeLayout, keyDef);
                const isSelected = this._editorSelectedKeyId === keyDef.id;
                const button = new St.Button({
                    style_class: isSelected
                        ? 'rrc-virtual-key rrc-virtual-key-selected'
                        : 'rrc-virtual-key',
                    can_focus: true,
                    x_align: Clutter.ActorAlign.START,
                    y_align: Clutter.ActorAlign.CENTER,
                });

                button.set_style(buildKeyboardEditorKeyStyle(color, isSelected, widthPx));
                button.set_position(x, y);
                button.set_size(widthPx, KEYBOARD_EDITOR_ROW_HEIGHT_PX);
                button.set_child(new St.Label({
                    text: keyDef.label,
                    style_class: 'rrc-virtual-key-label',
                    x_align: Clutter.ActorAlign.CENTER,
                    y_align: Clutter.ActorAlign.CENTER,
                }));
                button.connect('clicked', () => this._selectEditorKey(keyDef.id));
                keyboard.add_child(button);
            }
        }

        return frame;
    }

    _createModeEditorPanel() {
        const modePreset = this._getEditorModePreset();
        const modeLayout = this._getModeLayout(modePreset.id);
        const selectedKey = this._getEditorSelectedKey();
        const selectedColor = readKeyColorFromLayout(modeLayout, selectedKey);
        const panel = new St.BoxLayout({
            vertical: true,
            style_class: 'rrc-mode-editor',
            style: 'spacing: 8px;',
            x_expand: true,
        });

        panel.add_child(new St.Label({
            text: `Editing ${modePreset.label} • Selected ${selectedKey.label} ${rgbToHex(selectedColor.red, selectedColor.green, selectedColor.blue)}`,
            style_class: 'rrc-device-note',
            x_align: Clutter.ActorAlign.START,
        }));
        panel.add_child(this._createVirtualKeyboardPreview(modeLayout));
        panel.add_child(new St.Label({
            text: 'Click a key, then paint it with a swatch or the custom color slider below.',
            style_class: 'rrc-device-note',
            x_align: Clutter.ActorAlign.START,
        }));
        panel.add_child(this._createModeEditorRow(modePreset, PRIMARY_COLOR_ROWS[0]));
        panel.add_child(this._createModeEditorRow(modePreset, PRIMARY_COLOR_ROWS[1]));
        panel.add_child(this._createModeEditorCustomColorRow());

        const actions = new St.BoxLayout({
            style_class: 'rrc-actions-row',
            style: 'spacing: 10px;',
            x_align: Clutter.ActorAlign.START,
            x_expand: true,
        });
        actions.add_child(createTextButton(
            'Apply Mode',
            'rrc-footer-button',
            () => {
                this._applyModePreset(modePreset).catch(error =>
                    console.error(`[RRC] apply edited mode failed: ${error.message}`));
            }
        ));
        actions.add_child(createTextButton(
            'Reset Mode',
            'rrc-footer-button',
            () => {
                this._resetEditorMode().catch(error =>
                    console.error(`[RRC] reset mode failed: ${error.message}`));
            }
        ));
        panel.add_child(actions);

        return panel;
    }

    async _runDeviceAction(device, actionLabel, action, selectionPatch = null) {
        if (this._actionInProgress ||
            this._startupRestoreInFlight ||
            !device) {
            return;
        }

        this._actionInProgress = true;
        this._lastError = null;
        this._buildMenu();
        if (this._controlPad)
            this._buildControlPad();

        try {
            await action(device);

            if (selectionPatch)
                this._updateSelectionState(selectionPatch);
        } catch (error) {
            this._lastError = `Failed to apply ${actionLabel}: ${error.message}`;
            Main.notify(EXTENSION_TITLE, this._lastError);
        } finally {
            this._actionInProgress = false;
            await this._refreshBackendState({forceUiRefresh: true});
        }
    }

    async _applyColorPreset(colorPreset) {
        const shouldKeepBreathe = this._selectionState.selectedEffectId === 'breathe';
        const selectionPatch = {
            selectedColorId: colorPreset.id,
            selectedEffectId: shouldKeepBreathe ? 'breathe' : null,
            selectedModeId: null,
        };

        await this._runDeviceAction(
            this._backendState.keyboard,
            colorPreset.label,
            device => shouldKeepBreathe
                ? applyBreathSingle(device, colorPreset.red, colorPreset.green, colorPreset.blue)
                : applyStatic(device, colorPreset.red, colorPreset.green, colorPreset.blue),
            selectionPatch
        );
    }

    async _applyCustomColor(hue) {
        const nextHue = clampUnit(hue);
        const colorPreset = buildCustomColorPreset(nextHue);
        const shouldKeepBreathe = this._selectionState.selectedEffectId === 'breathe';
        const selectionPatch = {
            selectedColorId: 'custom',
            selectedEffectId: shouldKeepBreathe ? 'breathe' : null,
            selectedModeId: null,
            customHue: nextHue,
        };

        await this._runDeviceAction(
            this._backendState.keyboard,
            `${colorPreset.label} ${colorPreset.hex}`,
            device => shouldKeepBreathe
                ? applyBreathSingle(device, colorPreset.red, colorPreset.green, colorPreset.blue)
                : applyStatic(device, colorPreset.red, colorPreset.green, colorPreset.blue),
            selectionPatch
        );
    }

    async _applyEffectPreset(effectPreset) {
        const colorPreset = this._getCurrentColorPreset();
        await this._runDeviceAction(
            this._backendState.keyboard,
            effectPreset.label,
            device => effectPreset.run(device, colorPreset),
            {
                selectedEffectId: effectPreset.id,
                selectedModeId: null,
            }
        );
    }

    async _applyModePreset(modePreset) {
        const modeLayout = this._getModeLayout(modePreset.id);
        await this._runDeviceAction(
            this._backendState.keyboard,
            modePreset.label,
            device => applyCustomMatrix(device, modeLayout.frame),
            {
                selectedEffectId: null,
                selectedModeId: modePreset.id,
            }
        );
    }

    async _applyBrightnessPreset(preset) {
        await this._runDeviceAction(
            this._backendState.keyboard,
            preset.label,
            device => preset.run(device),
            {selectedBrightnessId: preset.id}
        );
    }

    _buildControlPad() {
        this._destroyControlPad();

        const stage = getStage();
        const stageWidth = stage?.width ?? 0;
        const stageHeight = stage?.height ?? 0;
        const monitor = getPreferredMonitorRect();

        const overlay = new St.Widget({
            reactive: true,
            can_focus: true,
            x: 0,
            y: 0,
            width: stageWidth,
            height: stageHeight,
        });

        const backdrop = new St.Widget({
            style_class: 'rrc-overlay-backdrop',
            reactive: true,
            x: 0,
            y: 0,
            width: stageWidth,
            height: stageHeight,
        });
        backdrop.connect('button-press-event', () => {
            this._destroyControlPad();
            return Clutter.EVENT_STOP;
        });
        overlay.add_child(backdrop);

        const monitorBin = new St.Widget({
            x: monitor.x,
            y: monitor.y,
            width: monitor.width,
            height: monitor.height,
            layout_manager: new Clutter.BinLayout(),
        });

        const panel = new St.BoxLayout({
            vertical: true,
            style_class: 'rrc-overlay-panel',
            style: 'spacing: 14px;',
            x_align: Clutter.ActorAlign.CENTER,
            y_align: Clutter.ActorAlign.CENTER,
        });
        monitorBin.add_child(panel);
        overlay.add_child(monitorBin);

        panel.add_child(new St.Label({
            text: EXTENSION_TITLE,
            style_class: 'rrc-overlay-title',
            x_align: Clutter.ActorAlign.CENTER,
        }));

        panel.add_child(new St.Label({
            text: this._getOverlaySubtitle(),
            style_class: 'rrc-overlay-subtitle',
            x_align: Clutter.ActorAlign.CENTER,
        }));

        const deviceGrid = new St.BoxLayout({
            style_class: 'rrc-device-grid',
            style: 'spacing: 14px;',
            x_align: Clutter.ActorAlign.CENTER,
            x_expand: true,
        });
        deviceGrid.add_child(this._createKeyboardCard());

        panel.add_child(deviceGrid);
        panel.add_child(this._createOverlayActions());

        this._controlPad = overlay;
        Main.uiGroup.add_child(overlay);

        const modalGrab = Main.pushModal(overlay);
        if (modalGrab === null || modalGrab === false) {
            console.error('[RRC] pushModal failed for control pad');
            this._destroyControlPad();
            Main.notify(EXTENSION_TITLE, 'Could not open the control pad.');
            return;
        }

        this._controlPadModalGrab = modalGrab;
        overlay.connect('key-press-event', (_actor, event) =>
            this._onControlPadKeyPressEvent(event));

        stage?.set_key_focus(overlay);
        overlay.grab_key_focus();
    }

    _getOverlaySubtitle() {
        if (this._backendState.keyboard)
            return 'Preset-based control for the BlackWidow V3 Tenkeyless';

        return 'The keyboard card updates automatically when OpenRazer detects the device';
    }

    _createKeyboardCard() {
        const keyboard = this._backendState.keyboard;
        const available = Boolean(keyboard);

        const card = new St.BoxLayout({
            vertical: true,
            style_class: available
                ? 'rrc-device-card'
                : 'rrc-device-card rrc-device-card-unavailable',
            style: 'spacing: 10px;',
        });

        card.add_child(new St.Label({
            text: 'Razer BlackWidow V3 Tenkeyless',
            style_class: 'rrc-device-title',
            x_align: Clutter.ActorAlign.START,
        }));

        card.add_child(new St.Label({
            text: available
                ? this._getKeyboardCardSubtitle(keyboard)
                : this._backendState.reason,
            style_class: 'rrc-device-subtitle',
            x_align: Clutter.ActorAlign.START,
        }));

        card.add_child(new St.Label({
            text: available ? 'Ready' : 'Unavailable',
            style_class: available
                ? 'rrc-card-status rrc-card-status-ok'
                : 'rrc-card-status rrc-card-status-warning',
            x_align: Clutter.ActorAlign.START,
        }));

        if (!available) {
            card.add_child(new St.Label({
                text: 'Quick RGB controls will unlock here once OpenRazer sees the keyboard.',
                style_class: 'rrc-device-note',
                x_align: Clutter.ActorAlign.START,
            }));
            return card;
        }

        card.add_child(this._createCardSection('Static colors', [
            this._createColorChipRow(PRIMARY_COLOR_ROWS[0]),
            this._createColorChipRow(PRIMARY_COLOR_ROWS[1]),
        ]));
        card.add_child(this._createCardSection('Custom modes', [
            this._createTextChipRow(PROGRAMMER_MODE_PRESETS, 'mode'),
        ]));
        card.add_child(this._createCardSection('Mode editor', [
            this._createModeEditorPanel(),
        ]));
        card.add_child(this._createCardSection('Custom color', [
            this._createCustomColorRow(),
        ]));
        card.add_child(this._createCardSection('Effects', [
            this._createTextChipRow(EFFECT_PRESETS, 'effect'),
        ]));
        card.add_child(this._createCardSection('Brightness', [
            this._createTextChipRow(BRIGHTNESS_PRESETS, 'brightness'),
        ]));

        return card;
    }

    _getKeyboardCardSubtitle(keyboard) {
        const parts = [];

        if (typeof keyboard.brightness === 'number')
            parts.push(`Brightness ${Math.round(keyboard.brightness)}%`);
        if (keyboard.firmwareVersion)
            parts.push(`FW ${keyboard.firmwareVersion}`);

        return parts.length > 0 ? parts.join(' • ') : 'Detected over OpenRazer';
    }

    _createCardSection(title, contentActors) {
        const section = new St.BoxLayout({
            vertical: true,
            style_class: 'rrc-card-section',
            style: 'spacing: 6px;',
        });

        section.add_child(new St.Label({
            text: title,
            style_class: 'rrc-section-title',
            x_align: Clutter.ActorAlign.START,
        }));

        for (const actor of contentActors)
            section.add_child(actor);

        return section;
    }

    _createOverlayActions() {
        const actions = new St.BoxLayout({
            style_class: 'rrc-actions-row',
            style: 'spacing: 10px;',
            x_align: Clutter.ActorAlign.CENTER,
            x_expand: true,
        });

        actions.add_child(createTextButton(
            'Refresh',
            'rrc-footer-button',
            () => {
                this._refreshBackendState().catch(error =>
                    console.error(`[RRC] overlay refresh failed: ${error.message}`));
            }
        ));

        actions.add_child(createTextButton(
            'Close',
            'rrc-footer-button',
            () => this._destroyControlPad()
        ));

        return actions;
    }

    _onControlPadKeyPressEvent(event) {
        if (!this._controlPad)
            return Clutter.EVENT_PROPAGATE;

        if (event.get_key_symbol() === Clutter.KEY_Escape) {
            this._destroyControlPad();
            return Clutter.EVENT_STOP;
        }

        return Clutter.EVENT_PROPAGATE;
    }

    _destroyControlPad() {
        const overlay = this._controlPad;

        if (this._controlPadModalGrab?.dismiss) {
            this._controlPadModalGrab.dismiss();
        } else if (overlay) {
            try {
                Main.popModal(overlay);
            } catch (error) {
                console.error(`[RRC] popModal failed: ${error.message}`);
            }
        }

        this._controlPadModalGrab = null;
        overlay?.destroy();
        this._controlPad = null;
    }
}
