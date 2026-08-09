import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

import {
    clampBrightness,
    clampByte,
    loadSelectionStateFromString,
    normalizeMatrixColor,
    normalizeMatrixDimensions,
    parseCustomModeLayouts,
    serializeCustomModeLayouts,
    serializeSelectionState,
} from './lib/selection-state.js';

export const RAZER_SERVICE = 'org.razer';
export const RAZER_MANAGER_PATH = '/org/razer';
export const RAZER_DAEMON_IFACE = 'razer.daemon';
export const RAZER_DEVICES_IFACE = 'razer.devices';
export const RAZER_DEVICE_MISC_IFACE = 'razer.device.misc';
export const RAZER_CHROMA_IFACE = 'razer.device.lighting.chroma';
export const RAZER_BRIGHTNESS_IFACE = 'razer.device.lighting.brightness';

export const WAVE_RIGHT = 0x01;
export const WAVE_LEFT = 0x02;
export const TARGET_KEYBOARD_USB_IDS = ['1532:0A24'];

const DBUS_SERVICE_PATH = '/org/freedesktop/DBus';
const DBUS_SERVICE_IFACE = 'org.freedesktop.DBus';
const DBUS_INTROSPECTABLE_IFACE = 'org.freedesktop.DBus.Introspectable';
const DEFAULT_TIMEOUT_MS = 5000;
const TARGET_KEYBOARD_NAME = 'BlackWidow V3 Tenkeyless';

const introspectionCache = new Map();

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
    return hash ? `serial-${hash.slice(-6)}` : '<unknown-device>';
}

function createDevicePath(serial) {
    return `${RAZER_MANAGER_PATH}/device/${serial}`;
}

export function loadSelectionState(settings) {
    return loadSelectionStateFromString(settings.get_string('last-preset'));
}

export function saveSelectionState(settings, selectionState) {
    settings.set_string('last-preset', serializeSelectionState(selectionState));
}

export function loadCustomModeLayouts(settings) {
    return parseCustomModeLayouts(settings.get_string('custom-mode-layouts'));
}

export function saveCustomModeLayouts(settings, modeLayouts) {
    settings.set_string('custom-mode-layouts', serializeCustomModeLayouts(modeLayouts));
}

async function hasNameOwner(name) {
    const result = await Gio.DBus.session.call(
        DBUS_SERVICE_IFACE,
        DBUS_SERVICE_PATH,
        DBUS_SERVICE_IFACE,
        'NameHasOwner',
        new GLib.Variant('(s)', [name]),
        new GLib.VariantType('(b)'),
        Gio.DBusCallFlags.NONE,
        DEFAULT_TIMEOUT_MS,
        null
    );

    return result.get_child_value(0).get_boolean();
}

async function introspectPath(path) {
    if (!introspectionCache.has(path)) {
        const introspectionPromise = _introspectPath(path).catch(error => {
            introspectionCache.delete(path);
            throw error;
        });
        introspectionCache.set(path, introspectionPromise);
    }

    return introspectionCache.get(path);
}

export function clearIntrospectionCache(path = null) {
    if (path) {
        introspectionCache.delete(path);
        return;
    }

    introspectionCache.clear();
}

async function _introspectPath(path) {
    const result = await Gio.DBus.session.call(
        RAZER_SERVICE,
        path,
        DBUS_INTROSPECTABLE_IFACE,
        'Introspect',
        null,
        new GLib.VariantType('(s)'),
        Gio.DBusCallFlags.NONE,
        DEFAULT_TIMEOUT_MS,
        null
    );

    const xml = result.get_child_value(0).get_string()[0];
    const nodeInfo = Gio.DBusNodeInfo.new_for_xml(xml);
    const interfaces = new Map();

    for (const ifaceInfo of nodeInfo.interfaces ?? []) {
        const methods = new Map();
        for (const methodInfo of ifaceInfo.methods ?? [])
            methods.set(methodInfo.name, methodInfo);

        interfaces.set(ifaceInfo.name, {info: ifaceInfo, methods});
    }

    return {xml, interfaces};
}

function getMethodMap(introspection, ifaceName) {
    return introspection.interfaces.get(ifaceName)?.methods ?? new Map();
}

function normalizeInput(signature, value) {
    switch (signature) {
    case 'y':
        return clampByte(value);
    case 'd':
        return clampBrightness(value);
    case 'b':
        return Boolean(value);
    case 's':
    case 'o':
        return String(value);
    case 'as':
    case 'ao':
        return Array.isArray(value) ? value.map(String) : [];
    case 'ay':
        return Array.isArray(value)
            ? value.map(clampByte)
            : Array.from(value ?? [], clampByte);
    default:
        return value;
    }
}

function buildParams(methodInfo, args) {
    const inputArgs = methodInfo?.in_args ?? [];
    if (inputArgs.length === 0)
        return null;

    if (inputArgs.length !== args.length)
        throw new Error(`Expected ${inputArgs.length} arguments but received ${args.length}`);

    const signatures = inputArgs.map(arg => arg.signature);
    const values = inputArgs.map((arg, index) => normalizeInput(arg.signature, args[index]));
    return new GLib.Variant(`(${signatures.join('')})`, values);
}

function unpackVariant(variant) {
    const type = variant.get_type_string();

    switch (type) {
    case 's':
    case 'o':
        return variant.get_string()[0];
    case 'b':
        return variant.get_boolean();
    case 'd':
        return variant.get_double();
    case 'i':
        return variant.get_int32();
    case 'u':
        return variant.get_uint32();
    case 'n':
        return variant.get_int16();
    case 'q':
        return variant.get_uint16();
    case 'y':
        return typeof variant.get_byte === 'function'
            ? variant.get_byte()
            : variant.get_uint32();
    default:
        break;
    }

    if (type.startsWith('a')) {
        const values = [];
        for (let i = 0; i < variant.n_children(); i++)
            values.push(unpackVariant(variant.get_child_value(i)));

        return values;
    }

    if (variant.n_children() > 0) {
        const values = [];
        for (let i = 0; i < variant.n_children(); i++)
            values.push(unpackVariant(variant.get_child_value(i)));

        return values;
    }

    return null;
}

function unpackReply(reply) {
    if (!reply || reply.n_children() === 0)
        return null;

    if (reply.n_children() === 1)
        return unpackVariant(reply.get_child_value(0));

    const values = [];
    for (let i = 0; i < reply.n_children(); i++)
        values.push(unpackVariant(reply.get_child_value(i)));

    return values;
}

async function callMethod(path, ifaceName, methodName, args = [], introspection = null) {
    const objectInfo = introspection ?? await introspectPath(path);
    const methodInfo = getMethodMap(objectInfo, ifaceName).get(methodName);

    if (!methodInfo)
        throw new Error(`${ifaceName}.${methodName} is not available on ${path}`);

    const reply = await Gio.DBus.session.call(
        RAZER_SERVICE,
        path,
        ifaceName,
        methodName,
        buildParams(methodInfo, args),
        null,
        Gio.DBusCallFlags.NONE,
        DEFAULT_TIMEOUT_MS,
        null
    );

    return unpackReply(reply);
}

function extractCapabilities(introspection) {
    const chromaMethods = getMethodMap(introspection, RAZER_CHROMA_IFACE);
    const brightnessMethods = getMethodMap(introspection, RAZER_BRIGHTNESS_IFACE);

    return {
        none: chromaMethods.has('setNone'),
        spectrum: chromaMethods.has('setSpectrum'),
        static: chromaMethods.has('setStatic'),
        wave: chromaMethods.has('setWave'),
        breathSingle: chromaMethods.has('setBreathSingle'),
        customMatrix: chromaMethods.has('setCustom') && chromaMethods.has('setKeyRow'),
        brightness: brightnessMethods.has('getBrightness') && brightnessMethods.has('setBrightness'),
    };
}

function classifyDeviceRole(name) {
    if (typeof name === 'string' && name.includes(TARGET_KEYBOARD_NAME))
        return 'keyboard';

    return 'other';
}

async function loadDevice(serial) {
    const path = createDevicePath(serial);
    const introspection = await introspectPath(path);
    const name = await callMethod(path, RAZER_DEVICE_MISC_IFACE, 'getDeviceName', [], introspection)
        .catch(() => serial);
    const type = await callMethod(path, RAZER_DEVICE_MISC_IFACE, 'getDeviceType', [], introspection)
        .catch(() => 'unknown');
    const firmwareVersion = await callMethod(path, RAZER_DEVICE_MISC_IFACE, 'getFirmware', [], introspection)
        .catch(() => null);
    const hasMatrix = await callMethod(path, RAZER_DEVICE_MISC_IFACE, 'hasMatrix', [], introspection)
        .catch(() => false);
    const matrixDimensions = hasMatrix
        ? normalizeMatrixDimensions(await callMethod(
            path,
            RAZER_DEVICE_MISC_IFACE,
            'getMatrixDimensions',
            [],
            introspection
        ).catch(() => null))
        : null;
    const keyboardLayout = await callMethod(path, RAZER_DEVICE_MISC_IFACE, 'getKeyboardLayout', [], introspection)
        .catch(() => null);
    const capabilities = extractCapabilities(introspection);

    let brightness = null;
    if (capabilities.brightness) {
        brightness = await callMethod(path, RAZER_BRIGHTNESS_IFACE, 'getBrightness', [], introspection)
            .catch(() => null);
    }

    return {
        serial,
        path,
        name,
        role: classifyDeviceRole(name),
        type,
        firmwareVersion,
        brightness,
        hasMatrix,
        matrixDimensions,
        keyboardLayout,
        capabilities,
        introspection,
    };
}

export async function discoverOpenRazerState() {
    const serviceAvailable = await hasNameOwner(RAZER_SERVICE).catch(() => false);

    if (!serviceAvailable) {
        clearIntrospectionCache();
        return {
            available: false,
            reason: 'OpenRazer was not found on the session bus. Install OpenRazer and ensure openrazer-daemon is running in your user session.',
            daemonVersion: null,
            devices: [],
            keyboard: null,
        };
    }

    const daemonVersion = await callMethod(RAZER_MANAGER_PATH, RAZER_DAEMON_IFACE, 'version')
        .catch(() => null);
    const rawDevices = await callMethod(RAZER_MANAGER_PATH, RAZER_DEVICES_IFACE, 'getDevices')
        .catch(error => {
            throw new Error(`Failed to enumerate Razer devices: ${error.message}`);
        });

    const serials = Array.isArray(rawDevices) ? rawDevices : [];
    const devices = [];
    for (const serial of serials) {
        try {
            devices.push(await loadDevice(serial));
        } catch (error) {
            clearIntrospectionCache(createDevicePath(serial));
            console.warn(`[RRC] Failed to load Razer device ${redactDeviceSerial(serial)}: ${error.message}`);
        }
    }

    devices.sort((left, right) => left.name.localeCompare(right.name));

    const keyboard = devices.find(device => device.role === 'keyboard') ?? null;

    return {
        available: true,
        reason: keyboard
            ? null
            : 'OpenRazer is running, but the Razer BlackWidow V3 Tenkeyless was not detected.',
        daemonVersion,
        devices,
        keyboard,
    };
}

async function callDeviceMethod(device, ifaceName, methodName, args = []) {
    if (!device)
        throw new Error('No device is available for this action.');

    return callMethod(device.path, ifaceName, methodName, args, device.introspection);
}

export async function applyNone(device) {
    return callDeviceMethod(device, RAZER_CHROMA_IFACE, 'setNone');
}

export async function applySpectrum(device) {
    return callDeviceMethod(device, RAZER_CHROMA_IFACE, 'setSpectrum');
}

export async function applyStatic(device, red, green, blue) {
    return callDeviceMethod(device, RAZER_CHROMA_IFACE, 'setStatic', [red, green, blue]);
}

export async function applyWave(device, direction) {
    return callDeviceMethod(device, RAZER_CHROMA_IFACE, 'setWave', [direction]);
}

export async function applyBreathSingle(device, red, green, blue) {
    return callDeviceMethod(device, RAZER_CHROMA_IFACE, 'setBreathSingle', [red, green, blue]);
}

export async function setBrightness(device, brightness) {
    return callDeviceMethod(device, RAZER_BRIGHTNESS_IFACE, 'setBrightness', [brightness]);
}

function buildCustomMatrixPayload(matrixFrame, rows, cols) {
    if (!Array.isArray(matrixFrame) || matrixFrame.length !== rows)
        throw new Error(`Expected ${rows} matrix rows but received ${matrixFrame?.length ?? 0}`);

    const payload = [];
    for (let rowIndex = 0; rowIndex < rows; rowIndex++) {
        const row = matrixFrame[rowIndex];
        if (!Array.isArray(row) || row.length !== cols)
            throw new Error(`Expected ${cols} columns in matrix row ${rowIndex} but received ${row?.length ?? 0}`);

        payload.push(rowIndex, 0, cols - 1);
        for (let colIndex = 0; colIndex < cols; colIndex++)
            payload.push(...normalizeMatrixColor(row[colIndex]));
    }

    return payload;
}

export async function applyCustomMatrix(device, matrixFrame) {
    if (!device)
        throw new Error('No device is available for this action.');

    if (!device.capabilities?.customMatrix)
        throw new Error('This device does not support custom matrix lighting.');

    const dimensions = normalizeMatrixDimensions(device.matrixDimensions);
    if (!dimensions)
        throw new Error('Matrix dimensions are unavailable for this device.');

    const [rows, cols] = dimensions;
    const payload = buildCustomMatrixPayload(matrixFrame, rows, cols);

    await callDeviceMethod(device, RAZER_CHROMA_IFACE, 'setKeyRow', [payload]);
    return callDeviceMethod(device, RAZER_CHROMA_IFACE, 'setCustom');
}

export function restartOpenRazerDaemon() {
    return new Promise((resolve, reject) => {
        try {
            const proc = Gio.Subprocess.new(
                ['systemctl', '--user', 'restart', 'openrazer-daemon'],
                Gio.SubprocessFlags.NONE);
            proc.wait_async(null, (_proc, res) => {
                try {
                    _proc.wait_check_finish(res);
                    clearIntrospectionCache();
                    console.log('[RRC] OpenRazer daemon restarted.');
                    resolve();
                } catch (error) {
                    reject(error);
                }
            });
        } catch (error) {
            reject(error);
        }
    });
}

export function isTargetKeyboardUsbPresent() {
    return new Promise(resolve => {
        const lsusbPath = GLib.find_program_in_path('lsusb');
        if (!lsusbPath) {
            resolve(false);
            return;
        }

        try {
            const proc = Gio.Subprocess.new(
                [lsusbPath],
                Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_PIPE);
            proc.communicate_utf8_async(null, null, (_proc, res) => {
                try {
                    const [, stdout] = _proc.communicate_utf8_finish(res);
                    const output = stdout?.toLowerCase() ?? '';
                    resolve(TARGET_KEYBOARD_USB_IDS.some(id =>
                        output.includes(id.toLowerCase())));
                } catch (error) {
                    console.warn(`[RRC] Failed to inspect USB devices: ${error.message}`);
                    resolve(false);
                }
            });
        } catch (error) {
            console.warn(`[RRC] Failed to start lsusb: ${error.message}`);
            resolve(false);
        }
    });
}
