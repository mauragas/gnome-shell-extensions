import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

import {
    loadGlobalExcludesFromString,
    loadProfilesFromString,
    serializeGlobalExcludes,
    serializeProfiles,
} from './lib/profile-store.js';
import {
    buildSnapshot,
    parseSnapshot,
    serializeSnapshot,
} from './lib/status-store.js';
import {
    DEFAULT_WATCH_INTERVAL_SECONDS,
    normalizeHelperConfig,
} from './lib/validation.js';

Gio._promisify(Gio.DBusConnection.prototype, 'call', 'call_finish');
Gio._promisify(Gio.Subprocess.prototype, 'communicate_utf8_async', 'communicate_utf8_finish');

export const SETTINGS_SCHEMA_ID = 'org.gnome.shell.extensions.folder-mirror';
export const EXTENSION_TITLE = 'Folder Mirror';
export const SYSTEMD_UNIT_NAME = 'folder-mirror.service';
export const DBUS_SERVICE_NAME = 'org.gnome.Shell.Extensions.FolderMirror';
export const DBUS_OBJECT_PATH = '/org/gnome/Shell/Extensions/FolderMirror';
export const DBUS_INTERFACE_NAME = 'org.gnome.Shell.Extensions.FolderMirror';
export const DBUS_ERROR_NAME = `${DBUS_INTERFACE_NAME}.Error`;
export const STATUS_FILE_NAME = 'status.json';
export const LOG_FILE_NAME = 'daemon.log';

export const PANEL_ICON_NAMES = Object.freeze({
    idle: 'folder-symbolic',
    syncing: 'emblem-synchronizing-symbolic',
    paused: 'media-playback-pause-symbolic',
    error: 'dialog-warning-symbolic',
    stopped: 'system-run-symbolic',
});

export const SERVICE_DBUS_XML = `
<node>
    <interface name="${DBUS_INTERFACE_NAME}">
        <method name="GetSnapshot">
            <arg type="s" name="snapshotJson" direction="out"/>
        </method>
        <method name="SyncProfile">
            <arg type="s" name="profileId" direction="in"/>
        </method>
        <method name="RunProfile">
            <arg type="s" name="profileId" direction="in"/>
        </method>
        <method name="SyncProfileDryRun">
            <arg type="s" name="profileId" direction="in"/>
            <arg type="s" name="summary" direction="out"/>
        </method>
        <method name="RunProfileDryRun">
            <arg type="s" name="profileId" direction="in"/>
            <arg type="s" name="summary" direction="out"/>
        </method>
        <method name="PauseProfile">
            <arg type="s" name="profileId" direction="in"/>
        </method>
        <method name="ResumeProfile">
            <arg type="s" name="profileId" direction="in"/>
        </method>
        <method name="SyncAll"/>
        <method name="RunAll"/>
        <method name="PauseAll"/>
        <method name="ResumeAll"/>
        <method name="RestartHelper"/>
        <signal name="SnapshotChanged">
            <arg type="s" name="snapshotJson"/>
        </signal>
    </interface>
</node>`;

const HELPER_METHOD_FALLBACKS = Object.freeze({
    SyncProfile: 'RunProfile',
    SyncProfileDryRun: 'RunProfileDryRun',
    SyncAll: 'RunAll',
});

const textDecoder = new TextDecoder();
const textEncoder = new TextEncoder();

function getPathFromImportMeta(importMetaUrl) {
    try {
        return Gio.File.new_for_uri(importMetaUrl).get_path() ?? GLib.get_current_dir();
    } catch {
        return GLib.get_current_dir();
    }
}

export function getExtensionRootFromImportMeta(importMetaUrl) {
    const modulePath = getPathFromImportMeta(importMetaUrl);
    let candidate = GLib.path_get_dirname(modulePath);

    for (let index = 0; index < 5; index++) {
        const metadataPath = GLib.build_filenamev([candidate, 'metadata.json']);
        const schemaDir = GLib.build_filenamev([candidate, 'schemas']);
        if (GLib.file_test(metadataPath, GLib.FileTest.EXISTS) ||
            GLib.file_test(schemaDir, GLib.FileTest.IS_DIR)) {
            return candidate;
        }

        const parent = GLib.path_get_dirname(candidate);
        if (!parent || parent === candidate)
            break;

        candidate = parent;
    }

    return GLib.path_get_dirname(modulePath);
}

export function getSchemaDirFromImportMeta(importMetaUrl) {
    return GLib.build_filenamev([
        getExtensionRootFromImportMeta(importMetaUrl),
        'schemas',
    ]);
}

export function getStateRoot() {
    return GLib.build_filenamev([
        GLib.get_home_dir(),
        '.local',
        'state',
        'folder-mirror',
    ]);
}

export function getLogDir() {
    return GLib.build_filenamev([getStateRoot(), 'logs']);
}

export function getLogFilePath() {
    return GLib.build_filenamev([getLogDir(), LOG_FILE_NAME]);
}

export function getCacheRoot() {
    return GLib.build_filenamev([
        GLib.get_home_dir(),
        '.cache',
        'folder-mirror',
    ]);
}

export function getStatusFilePath() {
    return GLib.build_filenamev([getStateRoot(), STATUS_FILE_NAME]);
}

export function ensureDirectory(path) {
    GLib.mkdir_with_parents(path, 0o755);
}

export function readUtf8File(path, fallback = '') {
    try {
        const [ok, bytes] = GLib.file_get_contents(path);
        return ok
            ? textDecoder.decode(bytes)
            : fallback;
    } catch {
        return fallback;
    }
}

export function writeUtf8File(path, contents) {
    ensureDirectory(GLib.path_get_dirname(path));
    GLib.file_set_contents(path, contents);
}

export function appendUtf8File(path, contents) {
    ensureDirectory(GLib.path_get_dirname(path));
    const file = Gio.File.new_for_path(path);
    let outputStream = null;

    try {
        outputStream = GLib.file_test(path, GLib.FileTest.EXISTS)
            ? file.append_to(Gio.FileCreateFlags.NONE, null)
            : file.create(Gio.FileCreateFlags.NONE, null);
        outputStream.write_all(textEncoder.encode(contents), null);
    } finally {
        outputStream?.close(null);
    }
}

export function loadSettingsFromImportMeta(importMetaUrl) {
    const schemaDir = getSchemaDirFromImportMeta(importMetaUrl);
    const compiledPath = GLib.build_filenamev([schemaDir, 'gschemas.compiled']);

    if (GLib.file_test(compiledPath, GLib.FileTest.EXISTS)) {
        const defaultSource = Gio.SettingsSchemaSource.get_default();
        const schemaSource = Gio.SettingsSchemaSource.new_from_directory(
            schemaDir,
            defaultSource,
            false
        );
        const schema = schemaSource.lookup(SETTINGS_SCHEMA_ID, false);
        if (schema)
            return new Gio.Settings({settings_schema: schema});
    }

    return new Gio.Settings({schema_id: SETTINGS_SCHEMA_ID});
}

export function loadProfiles(settings) {
    return loadProfilesFromString(settings.get_string('profiles-json'));
}

export function saveProfiles(settings, profiles) {
    settings.set_string('profiles-json', serializeProfiles(profiles));
}

export function loadGlobalExcludes(settings) {
    return loadGlobalExcludesFromString(settings.get_string('global-excludes-json'));
}

export function saveGlobalExcludes(settings, rules) {
    settings.set_string('global-excludes-json', serializeGlobalExcludes(rules));
}

export function loadHelperConfigFromSettings(settings) {
    return normalizeHelperConfig({
        showIndicator: settings.get_boolean('show-indicator'),
        showNotifications: settings.get_boolean('show-notifications'),
        autoStartHelper: settings.get_boolean('auto-start-helper'),
        watchIntervalSeconds: settings.get_uint('watch-interval-seconds') || DEFAULT_WATCH_INTERVAL_SECONDS,
        logLevel: settings.get_string('log-level'),
    });
}

export function detectDependency(commandName) {
    const path = GLib.find_program_in_path(commandName);
    return {
        available: Boolean(path),
        path: path ?? null,
    };
}

export function detectDependencies(commandNames = ['gjs', 'git', 'glib-compile-schemas', 'systemctl', 'rsync', 'unison']) {
    return Object.fromEntries(commandNames.map(commandName => [
        commandName,
        detectDependency(commandName),
    ]));
}

export function saveSnapshotToDisk(snapshot) {
    writeUtf8File(getStatusFilePath(), serializeSnapshot(snapshot));
}

export function loadSnapshotFromDisk() {
    const raw = readUtf8File(getStatusFilePath(), '');
    return parseSnapshot(raw);
}

export function formatProfileLocation(profile) {
    const sourcePath = profile?.sourcePath || 'missing source';
    const targetPath = profile?.targetPath || 'missing target';
    return `${sourcePath} → ${targetPath}`;
}

export function formatDependencySummary(snapshot) {
    const dependencies = snapshot?.dependencies ?? {};
    return Object.entries(dependencies)
        .map(([dependencyName, dependencyState]) =>
            `${dependencyName}: ${dependencyState.available ? 'available' : 'missing'}`)
        .join('\n');
}

export function openPath(path) {
    const uri = Gio.File.new_for_path(path).get_uri();
    return Gio.AppInfo.launch_default_for_uri(uri, null);
}

export async function callHelperMethod(methodName, parameters = null, replyType = null, timeoutMs = 4000) {
    return Gio.DBus.session.call(
        DBUS_SERVICE_NAME,
        DBUS_OBJECT_PATH,
        DBUS_INTERFACE_NAME,
        methodName,
        parameters,
        replyType,
        Gio.DBusCallFlags.NONE,
        timeoutMs,
        null
    );
}

function isUnknownHelperMethodError(error) {
    const message = error?.message ?? '';
    return /UnknownMethod|No such method/iu.test(message);
}

async function callHelperMethodWithFallback(methodName, parameters = null, replyType = null, timeoutMs = 4000) {
    try {
        return await callHelperMethod(methodName, parameters, replyType, timeoutMs);
    } catch (error) {
        const legacyMethodName = HELPER_METHOD_FALLBACKS[methodName];
        if (!legacyMethodName || !isUnknownHelperMethodError(error))
            throw error;

        return callHelperMethod(legacyMethodName, parameters, replyType, timeoutMs);
    }
}

export async function getHelperSnapshot(timeoutMs = 1500) {
    try {
        const result = await callHelperMethod(
            'GetSnapshot',
            null,
            new GLib.VariantType('(s)'),
            timeoutMs
        );
        const snapshotJson = result.get_child_value(0).get_string()[0];
        return parseSnapshot(snapshotJson);
    } catch {
        return loadSnapshotFromDisk();
    }
}

export async function invokeHelperVoidMethod(methodName, parameters = null, timeoutMs = 4000) {
    await callHelperMethodWithFallback(methodName, parameters, null, timeoutMs);
}

export async function invokeHelperStringMethod(methodName, parameters = null, timeoutMs = 4000) {
    const result = await callHelperMethodWithFallback(
        methodName,
        parameters,
        new GLib.VariantType('(s)'),
        timeoutMs
    );
    return result.get_child_value(0).get_string()[0];
}

export async function runUserSystemctl(systemctlArgs) {
    const systemctlPath = GLib.find_program_in_path('systemctl') ?? '/usr/bin/systemctl';
    if (!GLib.file_test(systemctlPath, GLib.FileTest.EXISTS))
        throw new Error('systemctl is not available on this machine.');

    const process = Gio.Subprocess.new(
        [systemctlPath, '--user', ...systemctlArgs],
        Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_PIPE
    );
    const [, stdout, stderr] = await process.communicate_utf8_async(null, null);
    const exitCode = process.get_if_exited()
        ? process.get_exit_status()
        : -1;

    if (exitCode !== 0) {
        throw new Error(
            (stderr || stdout || `systemctl --user ${systemctlArgs.join(' ')} failed`).trim()
        );
    }

    return {
        stdout: stdout ?? '',
        stderr: stderr ?? '',
    };
}

export async function restartHelperService() {
    return runUserSystemctl(['restart', SYSTEMD_UNIT_NAME]);
}

export function createStoppedSnapshot(reason = null) {
    return buildSnapshot({
        helperState: 'stopped',
        recentErrors: reason ? [reason] : [],
    });
}
