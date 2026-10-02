#!/usr/bin/env -S gjs -m

import System from 'system';

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import GLibUnix from 'gi://GLibUnix';

import {
    DBUS_ERROR_NAME,
    DBUS_INTERFACE_NAME,
    DBUS_OBJECT_PATH,
    DBUS_SERVICE_NAME,
    SERVICE_DBUS_XML,
    appendUtf8File,
    detectDependencies,
    ensureDirectory,
    getCacheRoot,
    getLogFilePath,
    loadGlobalExcludes,
    loadHelperConfigFromSettings,
    loadProfiles,
    loadSettingsFromImportMeta,
    saveProfiles,
    saveSnapshotToDisk,
} from '../shared.js';
import {
    buildSnapshot,
    serializeSnapshot,
} from '../lib/status-store.js';
import {unpackDbusParameters} from '../lib/dbus-parameters.js';
import {
    findProfileById,
    normalizeProfiles,
} from '../lib/profile-store.js';
import {
    buildProfileValidationErrors,
    isOneWayMode,
    isTwoWayMode,
} from '../lib/validation.js';
import {
    deriveRuntimeStatus,
    didSyncProduceVisibleChanges,
    updateWatchRunState,
} from '../lib/watch-state.js';
import {buildRsyncCommand, resolveRsyncEndpoints} from './backends/rsync.js';
import {
    createGitIgnoredExcludeRules,
    listIgnoredRelativePathsForTree,
    resolveGitIgnoreReferenceRoot,
} from './gitignore-resolver.js';
import {buildUnisonCommand} from './backends/unison.js';

Gio._promisify(Gio.Subprocess.prototype, 'communicate_utf8_async', 'communicate_utf8_finish');

const WATCH_POLL_INTERVAL_MS = 1000;
const MAX_RECENT_ERRORS = 10;
const LOG_LEVEL_PRIORITIES = Object.freeze({
    debug: 10,
    info: 20,
    warn: 30,
    error: 40,
});

function quoteArg(arg) {
    if (/^[a-zA-Z0-9_./:-]+$/u.test(arg))
        return arg;

    return `'${String(arg).replace(/'/gu, `'"'"'`)}'`;
}

class FolderMirrorDaemon {
    constructor(settings, mainLoop) {
        this._settings = settings;
        this._mainLoop = mainLoop;
        this._profiles = [];
        this._globalExcludes = [];
        this._config = loadHelperConfigFromSettings(settings);
        this._runtimeProfiles = new Map();
        this._activeRuns = new Set();
        this._recentErrors = [];
        this._startedAt = new Date().toISOString();
        this._helperState = 'starting';
        this._snapshotJson = serializeSnapshot(buildSnapshot({
            helperState: this._helperState,
            startedAt: this._startedAt,
        }));
        this._watchTimerId = 0;
        this._watchPollInFlight = false;
        this._settingsChangedId = 0;
        this._dbusObject = null;
        this._ownedNameId = 0;
        this._signalSourceIds = [];
        this._startupIdleId = 0;
        this._startupTriggeredProfiles = new Set();
        this._unisonDryRunSupported = null;
        this._exitCode = 0;
    }

    async start() {
        ensureDirectory(getCacheRoot());
        ensureDirectory(GLib.path_get_dirname(getLogFilePath()));

        this._settingsChangedId = this._settings.connect('changed', () => {
            this._reloadFromSettings();
            this._publishSnapshot();
        });

        this._reloadFromSettings();
        this._exportDbus();
        this._installSignalHandlers();
        this._startWatchLoop();

        this._helperState = 'running';
        this._publishSnapshot();
        this._startupIdleId = GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
            this._startupIdleId = 0;
            this._scheduleStartupProfiles();
            return GLib.SOURCE_REMOVE;
        });
    }

    stop(exitCode = 0) {
        this._exitCode = exitCode;

        if (this._watchTimerId) {
            GLib.source_remove(this._watchTimerId);
            this._watchTimerId = 0;
        }

        if (this._startupIdleId) {
            GLib.source_remove(this._startupIdleId);
            this._startupIdleId = 0;
        }

        for (const sourceId of this._signalSourceIds) {
            GLib.source_remove(sourceId);
        }
        this._signalSourceIds = [];

        if (this._settingsChangedId) {
            this._settings.disconnect(this._settingsChangedId);
            this._settingsChangedId = 0;
        }

        if (this._dbusObject) {
            try {
                this._dbusObject.unexport();
            } catch (error) {
                this._log('warn', `Failed to unexport the D-Bus object: ${error.message}`);
            }
            this._dbusObject = null;
        }

        if (this._ownedNameId) {
            Gio.bus_unown_name(this._ownedNameId);
            this._ownedNameId = 0;
        }

        if (exitCode === 0) {
            this._helperState = 'stopped';
            this._publishSnapshot();
        }

        this._mainLoop.quit();
    }

    _installSignalHandlers() {
        for (const signalNumber of [2, 15]) {
            const sourceId = GLibUnix.signal_add_full(GLib.PRIORITY_DEFAULT, signalNumber, () => {
                this._log('info', `Received signal ${signalNumber}; stopping the helper.`);
                this.stop(0);
                return GLib.SOURCE_REMOVE;
            });
            this._signalSourceIds.push(sourceId);
        }
    }

    _shouldLog(level) {
        const threshold = LOG_LEVEL_PRIORITIES[this._config.logLevel] ?? LOG_LEVEL_PRIORITIES.info;
        const priority = LOG_LEVEL_PRIORITIES[level] ?? LOG_LEVEL_PRIORITIES.info;
        return priority >= threshold;
    }

    _log(level, message) {
        const normalizedLevel = LOG_LEVEL_PRIORITIES[level] !== undefined
            ? level
            : 'info';
        const formattedMessage = `[FM] [${normalizedLevel.toUpperCase()}] ${message}`;

        if (this._shouldLog(normalizedLevel)) {
            if (normalizedLevel === 'error')
                printerr(formattedMessage);
            else
                print(formattedMessage);

            try {
                appendUtf8File(getLogFilePath(), `${new Date().toISOString()} ${formattedMessage}\n`);
            } catch (_error) {
                // Avoid cascading errors while logging.
            }
        }
    }

    _rememberError(message) {
        if (!message)
            return;

        this._recentErrors.unshift(message);
        this._recentErrors = this._recentErrors.slice(0, MAX_RECENT_ERRORS);
    }

    _publishSnapshot() {
        const dependencies = detectDependencies();
        const snapshot = buildSnapshot({
            helperState: this._helperState,
            startedAt: this._startedAt,
            dependencies,
            recentErrors: this._recentErrors,
            profiles: [...this._runtimeProfiles.values()].map(entry => ({
                id: entry.id,
                name: entry.name,
                mode: entry.mode,
                sourcePath: entry.sourcePath,
                targetPath: entry.targetPath,
                status: entry.status,
                enabled: entry.enabled,
                paused: entry.paused,
                watchMode: entry.watchMode,
                lastRunAt: entry.lastRunAt,
                lastSuccessfulSyncAt: entry.lastSuccessfulSyncAt,
                lastError: entry.lastError,
                lastConflictSummary: entry.lastConflictSummary,
            })),
        });

        this._snapshotJson = serializeSnapshot(snapshot);
        saveSnapshotToDisk(snapshot);

        if (this._dbusObject) {
            this._dbusObject.emit_signal(
                'SnapshotChanged',
                new GLib.Variant('(s)', [this._snapshotJson])
            );
        }
    }

    _reloadFromSettings() {
        this._profiles = loadProfiles(this._settings);
        this._globalExcludes = loadGlobalExcludes(this._settings);
        this._config = loadHelperConfigFromSettings(this._settings);
        this._syncRuntimeProfiles();
    }

    _deriveRestingStatus(profile, runtimeEntry) {
        return deriveRuntimeStatus({
            active: this._activeRuns.has(profile.id) && Boolean(runtimeEntry?.showSyncWhileRunning),
            enabled: profile.enabled,
            paused: profile.paused,
            watchMode: profile.watchMode,
            autoStartHelper: this._config.autoStartHelper,
            previousStatus: runtimeEntry?.status ?? 'idle',
            syncPulseUntil: runtimeEntry?.syncPulseUntil ?? 0,
        });
    }

    _syncRuntimeProfiles() {
        const nextRuntimeProfiles = new Map();

        for (const profile of this._profiles) {
            const previousEntry = this._runtimeProfiles.get(profile.id);
            const status = this._activeRuns.has(profile.id)
                ? 'syncing'
                : this._deriveRestingStatus(profile, previousEntry);
            const nextEntry = {
                id: profile.id,
                name: profile.name,
                mode: profile.mode,
                sourcePath: profile.sourcePath,
                targetPath: profile.targetPath,
                enabled: profile.enabled,
                paused: profile.paused,
                watchMode: profile.watchMode,
                status,
                lastRunAt: previousEntry?.lastRunAt ?? null,
                lastSuccessfulSyncAt: previousEntry?.lastSuccessfulSyncAt ?? null,
                lastError: previousEntry?.lastError ?? null,
                lastConflictSummary: previousEntry?.lastConflictSummary ?? null,
                nextWatchAt: previousEntry?.nextWatchAt ?? 0,
                consecutiveNoChangeRuns: previousEntry?.consecutiveNoChangeRuns ?? 0,
                syncPulseUntil: previousEntry?.syncPulseUntil ?? 0,
                showSyncWhileRunning: previousEntry?.showSyncWhileRunning ?? false,
            };
            nextRuntimeProfiles.set(profile.id, nextEntry);
        }

        this._runtimeProfiles = nextRuntimeProfiles;
    }

    _refreshRuntimeStatuses() {
        let didChange = false;

        for (const profile of this._profiles) {
            const runtimeEntry = this._runtimeProfiles.get(profile.id);
            if (!runtimeEntry)
                continue;

            const nextStatus = this._deriveRestingStatus(profile, runtimeEntry);
            if (runtimeEntry.status !== nextStatus) {
                runtimeEntry.status = nextStatus;
                didChange = true;
            }
        }

        return didChange;
    }

    _getProfileRuntimeEntry(profileId) {
        return this._runtimeProfiles.get(profileId) ?? null;
    }

    _getProfileOrThrow(profileId, profiles = this._profiles) {
        const profile = findProfileById(profiles, profileId);
        if (!profile)
            throw new Error(`Unknown profile id: ${profileId}`);

        return profile;
    }

    _assertProfileCanStartRun(profileId) {
        const profile = this._getProfileOrThrow(profileId);
        if (this._activeRuns.has(profileId)) {
            throw new Error(`A sync is already in progress for ${profile.name}.`);
        }

        return profile;
    }

    _returnVoidInvocation(invocation) {
        invocation.return_value(new GLib.Variant('()', []));
    }

    _recordDetachedActionFailure(error, context) {
        if (error?._folderMirrorLogged)
            return;

        const message = error?.message ?? String(error);
        const composedMessage = context
            ? `${context}: ${message}`
            : message;
        this._rememberError(composedMessage);
        this._log('error', composedMessage);
        this._publishSnapshot();
    }

    _scheduleStartupProfiles() {
        if (!this._config.autoStartHelper)
            return;

        for (const profile of this._profiles) {
            if (!profile.enabled || profile.paused || !profile.runAtLogin)
                continue;

            if (this._startupTriggeredProfiles.has(profile.id))
                continue;

            this._startupTriggeredProfiles.add(profile.id);
            this._invokeProfileRun(profile.id, {
                dryRun: false,
                trigger: 'startup',
            }).catch(error => {
                if (!error?._folderMirrorLogged)
                    this._log('error', `Startup run failed for ${profile.name}: ${error.message}`);
            });
        }
    }

    _startWatchLoop() {
        if (this._watchTimerId)
            return;

        this._watchTimerId = GLib.timeout_add(
            GLib.PRIORITY_DEFAULT,
            WATCH_POLL_INTERVAL_MS,
            () => {
                this._pollWatchProfiles().catch(error => {
                    this._rememberError(error.message);
                    this._log('error', `Watch loop error: ${error.message}`);
                    this._publishSnapshot();
                });
                return GLib.SOURCE_CONTINUE;
            }
        );
    }

    async _pollWatchProfiles() {
        const didStatusChangeBeforePolling = this._refreshRuntimeStatuses();
        if (this._watchPollInFlight || !this._config.autoStartHelper) {
            if (didStatusChangeBeforePolling)
                this._publishSnapshot();
            return;
        }

        this._watchPollInFlight = true;
        try {
            const now = Date.now();
            for (const profile of this._profiles) {
                if (!profile.enabled || profile.paused || !profile.watchMode)
                    continue;

                if (this._activeRuns.has(profile.id))
                    continue;

                const runtimeEntry = this._getProfileRuntimeEntry(profile.id);
                const nextWatchAt = runtimeEntry?.nextWatchAt ?? 0;
                if (nextWatchAt > now)
                    continue;

                if (runtimeEntry)
                    runtimeEntry.nextWatchAt = now + this._config.watchIntervalSeconds * 1000;

                this._invokeProfileRun(profile.id, {
                    dryRun: false,
                    trigger: 'watch',
                }).catch(error => {
                    if (!error?._folderMirrorLogged)
                        this._log('error', `Watch run failed for ${profile.name}: ${error.message}`);
                });
            }
        } finally {
            this._watchPollInFlight = false;
            if (didStatusChangeBeforePolling)
                this._publishSnapshot();
        }
    }

    _exportDbus() {
        const implementation = {
            GetSnapshot: () => this._snapshotJson,
            RunProfileAsync: (parameters, invocation) => {
                try {
                    const [profileId] = unpackDbusParameters(parameters);
                    const profile = this._assertProfileCanStartRun(profileId);
                    this._returnVoidInvocation(invocation);
                    this._invokeProfileRun(profileId, {
                        dryRun: false,
                        trigger: 'manual',
                    }).catch(error => {
                        this._recordDetachedActionFailure(
                            error,
                            `Manual sync failed for ${profile.name}`
                        );
                    });
                } catch (error) {
                    invocation.return_dbus_error(DBUS_ERROR_NAME, error.message);
                }
            },
            RunProfileDryRunAsync: (parameters, invocation) => {
                const [profileId] = unpackDbusParameters(parameters);
                this._invokeProfileRun(profileId, {
                    dryRun: true,
                    trigger: 'manual-dry-run',
                })
                    .then(result => {
                        invocation.return_value(new GLib.Variant('(s)', [
                            result.summary,
                        ]));
                    })
                    .catch(error => {
                        invocation.return_dbus_error(DBUS_ERROR_NAME, error.message);
                    });
            },
            PauseProfileAsync: (parameters, invocation) => {
                try {
                    const [profileId] = unpackDbusParameters(parameters);
                    this._setProfilePausedState(profileId, true);
                    this._returnVoidInvocation(invocation);
                } catch (error) {
                    invocation.return_dbus_error(DBUS_ERROR_NAME, error.message);
                }
            },
            ResumeProfileAsync: (parameters, invocation) => {
                try {
                    const [profileId] = unpackDbusParameters(parameters);
                    this._setProfilePausedState(profileId, false);
                    this._returnVoidInvocation(invocation);
                } catch (error) {
                    invocation.return_dbus_error(DBUS_ERROR_NAME, error.message);
                }
            },
            RunAllAsync: (_parameters, invocation) => {
                this._returnVoidInvocation(invocation);
                this._runAllProfiles({dryRun: false})
                    .catch(error => {
                        this._recordDetachedActionFailure(error, 'Run-all sync failed');
                    });
            },
            PauseAllAsync: (_parameters, invocation) => {
                try {
                    this._setAllProfilesPausedState(true);
                    this._returnVoidInvocation(invocation);
                } catch (error) {
                    invocation.return_dbus_error(DBUS_ERROR_NAME, error.message);
                }
            },
            ResumeAllAsync: (_parameters, invocation) => {
                try {
                    this._setAllProfilesPausedState(false);
                    this._returnVoidInvocation(invocation);
                } catch (error) {
                    invocation.return_dbus_error(DBUS_ERROR_NAME, error.message);
                }
            },
            RestartHelperAsync: (_parameters, invocation) => {
                this._returnVoidInvocation(invocation);
                GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
                    this._log('warn', 'Restart requested over D-Bus.');
                    this.stop(75);
                    return GLib.SOURCE_REMOVE;
                });
            },
        };

        this._dbusObject = Gio.DBusExportedObject.wrapJSObject(SERVICE_DBUS_XML, implementation);
        this._dbusObject.export(Gio.DBus.session, DBUS_OBJECT_PATH);
        this._ownedNameId = Gio.bus_own_name_on_connection(
            Gio.DBus.session,
            DBUS_SERVICE_NAME,
            Gio.BusNameOwnerFlags.REPLACE,
            null,
            null
        );
    }

    async _runAllProfiles({dryRun = false} = {}) {
        const runnableProfiles = this._profiles.filter(profile => profile.enabled && !profile.paused);
        const failures = [];

        for (const profile of runnableProfiles) {
            try {
                await this._invokeProfileRun(profile.id, {
                    dryRun,
                    trigger: 'run-all',
                });
            } catch (error) {
                failures.push(`${profile.name}: ${error.message}`);
            }
        }

        if (failures.length > 0)
            throw new Error(failures.join('\n'));
    }

    _setAllProfilesPausedState(paused) {
        const nextProfiles = normalizeProfiles(loadProfiles(this._settings).map(profile => ({
            ...profile,
            paused: profile.enabled ? paused : profile.paused,
        })));
        saveProfiles(this._settings, nextProfiles);
        this._reloadFromSettings();
        this._publishSnapshot();
    }

    _setProfilePausedState(profileId, paused) {
        const currentProfiles = loadProfiles(this._settings);
        this._getProfileOrThrow(profileId, currentProfiles);

        const nextProfiles = normalizeProfiles(currentProfiles.map(profile =>
            profile.id === profileId
                ? {
                    ...profile,
                    enabled: paused ? profile.enabled : true,
                    paused,
                }
                : profile
        ));
        saveProfiles(this._settings, nextProfiles);
        this._reloadFromSettings();
        this._publishSnapshot();
    }

    _trimOutput(text, limit = 6000) {
        const normalizedText = typeof text === 'string'
            ? text.trim()
            : '';
        if (!normalizedText)
            return '';

        return normalizedText.length > limit
            ? `${normalizedText.slice(0, limit)}…`
            : normalizedText;
    }

    _buildDryRunSummary(profile, result) {
        const output = this._trimOutput(`${result.stdout}\n${result.stderr}`);
        if (!output)
            return `Dry run completed successfully for ${profile.name}.`;

        return output;
    }

    _detectConflictSummary(processResult) {
        const combinedOutput = `${processResult.stdout ?? ''}\n${processResult.stderr ?? ''}`;
        const conflictMatch = combinedOutput.match(/conflict[^\n]*/iu) ??
            combinedOutput.match(/conflicting[^\n]*/iu);
        return conflictMatch
            ? conflictMatch[0].trim()
            : null;
    }

    _formatCommand(command) {
        return command.argv.map(quoteArg).join(' ');
    }

    async _ensureMirrorPaths(profile) {
        const validationErrors = buildProfileValidationErrors(profile);
        if (validationErrors.length > 0)
            throw new Error(validationErrors.join(' '));

        if (!GLib.file_test(profile.sourcePath, GLib.FileTest.IS_DIR)) {
            throw new Error(`Source path does not exist or is not a directory: ${profile.sourcePath}`);
        }

        if (isOneWayMode(profile.mode)) {
            const {targetPath} = resolveRsyncEndpoints(profile);
            if (!GLib.file_test(targetPath, GLib.FileTest.IS_DIR)) {
                ensureDirectory(targetPath);
            }
        } else if (isTwoWayMode(profile.mode) && !GLib.file_test(profile.targetPath, GLib.FileTest.IS_DIR)) {
            ensureDirectory(profile.targetPath);
        }
    }

    _countDirectoryEntries(path) {
        const directory = Gio.File.new_for_path(path);
        let enumerator = null;
        let count = 0;

        try {
            enumerator = directory.enumerate_children(
                'standard::name',
                Gio.FileQueryInfoFlags.NONE,
                null
            );
            while (enumerator.next_file(null) !== null)
                count++;
        } finally {
            enumerator?.close(null);
        }

        return count;
    }

    async _enforceDeleteProtection(profile) {
        if (!profile.deleteProtection || !isOneWayMode(profile.mode))
            return;

        const {sourcePath, targetPath} = resolveRsyncEndpoints(profile);
        const sourceEntryCount = this._countDirectoryEntries(sourcePath);
        const targetEntryCount = GLib.file_test(targetPath, GLib.FileTest.IS_DIR)
            ? this._countDirectoryEntries(targetPath)
            : 0;

        if (sourceEntryCount === 0 && targetEntryCount > 0) {
            throw new Error(
                `Delete protection refused to mirror an empty source into a non-empty target for ${profile.name}.`
            );
        }
    }

    _getDependenciesForProfile(profile) {
        const dependencies = detectDependencies();
        const requiredBinary = isTwoWayMode(profile.mode)
            ? 'unison'
            : 'rsync';

        if (profile.excludeGitIgnored && !dependencies.git?.available) {
            throw new Error(`Git is required to resolve .gitignore exclusions for ${profile.name}.`);
        }

        if (!dependencies[requiredBinary]?.available) {
            throw new Error(`Required dependency is missing for ${profile.name}: ${requiredBinary}`);
        }
    }

    _buildCommand(profile, {dryRun = false, extraExcludeRules = []} = {}) {
        if (isTwoWayMode(profile.mode)) {
            return buildUnisonCommand(profile, {
                globalExcludes: this._globalExcludes,
                extraExcludeRules,
                dryRun,
            });
        }

        return buildRsyncCommand(profile, {
            globalExcludes: this._globalExcludes,
            extraExcludeRules,
            dryRun,
        });
    }

    async _runProcess(command) {
        const launcher = new Gio.SubprocessLauncher({
            flags: Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_PIPE,
        });
        launcher.set_cwd(GLib.get_home_dir());

        const process = launcher.spawnv(command.argv);
        const [, stdout, stderr] = await process.communicate_utf8_async(null, null);
        const exited = process.get_if_exited();
        const exitStatus = exited
            ? process.get_exit_status()
            : -1;
        return {
            ok: exited && exitStatus === 0,
            exitStatus,
            stdout: stdout ?? '',
            stderr: stderr ?? '',
        };
    }

    async _supportsUnisonDryRun() {
        if (this._unisonDryRunSupported !== null)
            return this._unisonDryRunSupported;

        try {
            const result = await this._runProcess({argv: ['unison', '-help']});
            const helpText = `${result.stdout}\n${result.stderr}`;
            this._unisonDryRunSupported = /-dryrun\b/u.test(helpText);
        } catch (error) {
            this._log('warn', `Could not detect Unison dry-run support: ${error.message}`);
            this._unisonDryRunSupported = false;
        }

        return this._unisonDryRunSupported;
    }

    async _buildTwoWayPreflightSummary(profile, extraExcludeRules = []) {
        const previewCommand = buildUnisonCommand(profile, {
            globalExcludes: this._globalExcludes,
            extraExcludeRules,
            dryRun: false,
        });

        const summaryLines = [
            `Validated ${profile.name}.`,
            '',
            'The installed Unison build on this machine does not advertise -dryrun,',
            'so Folder Mirror performed a safe preflight preview without touching',
            'either replica.',
            '',
            'Generated Unison profile preview:',
            previewCommand.profilePreview,
            '',
            'Command used for real runs:',
            this._formatCommand(previewCommand),
        ];

        return summaryLines.join('\n');
    }

    async _resolveGitIgnoredExcludeRules(profile) {
        if (!profile.excludeGitIgnored)
            return [];

        const referenceRootPath = await resolveGitIgnoreReferenceRoot([
            profile.sourcePath,
            profile.targetPath,
        ]);
        if (!referenceRootPath)
            return [];

        const rootsToInspect = isTwoWayMode(profile.mode)
            ? [profile.sourcePath, profile.targetPath]
            : [resolveRsyncEndpoints(profile).sourcePath];
        const ignoredRelativePaths = new Set();

        for (const rootPath of rootsToInspect) {
            const ignoredPathsForRoot = await listIgnoredRelativePathsForTree(
                referenceRootPath,
                rootPath
            );
            for (const relativePath of ignoredPathsForRoot)
                ignoredRelativePaths.add(relativePath);
        }

        return createGitIgnoredExcludeRules([...ignoredRelativePaths]);
    }

    async _invokeProfileRun(profileId, {dryRun = false, trigger = 'manual'} = {}) {
        const profile = this._assertProfileCanStartRun(profileId);

        const runtimeEntry = this._getProfileRuntimeEntry(profileId);
        this._activeRuns.add(profileId);
        if (runtimeEntry) {
            runtimeEntry.showSyncWhileRunning = trigger !== 'watch';
            runtimeEntry.status = runtimeEntry.showSyncWhileRunning
                ? 'syncing'
                : this._deriveRestingStatus(profile, runtimeEntry);
            runtimeEntry.lastRunAt = new Date().toISOString();
            runtimeEntry.lastError = null;
            runtimeEntry.lastConflictSummary = null;
        }
        this._publishSnapshot();

        try {
            this._getDependenciesForProfile(profile);
            await this._ensureMirrorPaths(profile);
            await this._enforceDeleteProtection(profile);
            const gitIgnoredExcludeRules = await this._resolveGitIgnoredExcludeRules(profile);

            if (dryRun && isTwoWayMode(profile.mode) && !await this._supportsUnisonDryRun()) {
                if (runtimeEntry) {
                    runtimeEntry.lastError = null;
                    runtimeEntry.lastConflictSummary = null;
                    runtimeEntry.status = this._deriveRestingStatus(profile, runtimeEntry);
                }

                const summary = await this._buildTwoWayPreflightSummary(
                    profile,
                    gitIgnoredExcludeRules
                );
                this._log('info', `Completed preflight preview for ${profile.name}.`);
                return {
                    ok: true,
                    exitStatus: 0,
                    stdout: '',
                    stderr: '',
                    summary,
                };
            }

            const command = this._buildCommand(profile, {
                dryRun,
                extraExcludeRules: gitIgnoredExcludeRules,
            });
            if (command.profilePreview)
                this._log('debug', `${profile.name} profile preview:\n${command.profilePreview}`);
            if (trigger === 'watch')
                this._log('debug', `Checking watch sync for ${profile.name}: ${this._formatCommand(command)}`);
            else
                this._log('info', `Running ${trigger} sync for ${profile.name}: ${this._formatCommand(command)}`);

            const processResult = await this._runProcess(command);
            const conflictSummary = this._detectConflictSummary(processResult);
            const finishedAt = new Date().toISOString();
            const hadVisibleChanges = didSyncProduceVisibleChanges(processResult);

            if (runtimeEntry) {
                runtimeEntry.lastRunAt = finishedAt;
                runtimeEntry.lastConflictSummary = conflictSummary;
            }

            if (!processResult.ok) {
                const failureMessage = this._trimOutput(processResult.stderr || processResult.stdout) ||
                    `${profile.name} exited with status ${processResult.exitStatus}.`;
                if (runtimeEntry) {
                    runtimeEntry.status = conflictSummary ? 'conflict' : 'error';
                    runtimeEntry.lastError = failureMessage;
                }
                this._rememberError(`${profile.name}: ${failureMessage}`);
                this._log('error', `${profile.name} failed: ${failureMessage}`);
                throw new Error(failureMessage);
            }

            if (runtimeEntry) {
                runtimeEntry.lastError = null;
                if (!dryRun)
                    runtimeEntry.lastSuccessfulSyncAt = finishedAt;
                if (!dryRun) {
                    const watchState = updateWatchRunState(runtimeEntry, {
                        trigger,
                        hadChanges: hadVisibleChanges,
                        baseIntervalSeconds: this._config.watchIntervalSeconds,
                    });
                    runtimeEntry.consecutiveNoChangeRuns = watchState.consecutiveNoChangeRuns;
                    runtimeEntry.nextWatchAt = watchState.nextWatchAt;
                    runtimeEntry.syncPulseUntil = watchState.syncPulseUntil;
                }
                runtimeEntry.showSyncWhileRunning = false;
                runtimeEntry.status = conflictSummary
                    ? 'conflict'
                    : deriveRuntimeStatus({
                        enabled: profile.enabled,
                        paused: profile.paused,
                        watchMode: profile.watchMode,
                        autoStartHelper: this._config.autoStartHelper,
                        previousStatus: 'idle',
                        syncPulseUntil: runtimeEntry.syncPulseUntil ?? 0,
                    });
            }

            const dryRunSummary = this._buildDryRunSummary(profile, processResult);
            if (dryRun) {
                this._log('info', `Dry run completed for ${profile.name}.`);
            } else if (trigger === 'watch') {
                if (hadVisibleChanges)
                    this._log('info', `Applied watched changes for ${profile.name}.`);
                else
                    this._log('debug', `No watched changes detected for ${profile.name}.`);
            } else {
                this._log('info', `Sync completed for ${profile.name}.`);
            }

            return {
                ...processResult,
                summary: dryRunSummary,
            };
        } catch (error) {
            const failureMessage = error?.message ?? String(error);
            if (runtimeEntry) {
                runtimeEntry.lastRunAt = runtimeEntry.lastRunAt ?? new Date().toISOString();
                runtimeEntry.lastError = failureMessage;
                runtimeEntry.showSyncWhileRunning = false;
                runtimeEntry.consecutiveNoChangeRuns = 0;
                runtimeEntry.nextWatchAt = Date.now() + this._config.watchIntervalSeconds * 1000;
                runtimeEntry.status = 'error';
            }

            this._rememberError(`${profile.name}: ${failureMessage}`);
            this._log('error', `${profile.name} failed: ${failureMessage}`);
            error._folderMirrorLogged = true;
            throw error;
        } finally {
            this._activeRuns.delete(profileId);
            if (runtimeEntry && runtimeEntry.status === 'syncing')
                runtimeEntry.status = this._deriveRestingStatus(profile, runtimeEntry);
            this._publishSnapshot();
        }
    }

    get exitCode() {
        return this._exitCode;
    }
}

let exitCode = 1;
let daemon = null;

try {
    const settings = loadSettingsFromImportMeta(import.meta.url);
    const mainLoop = new GLib.MainLoop(null, false);
    daemon = new FolderMirrorDaemon(settings, mainLoop);
    await daemon.start();
    mainLoop.run();
    exitCode = daemon.exitCode;
} catch (error) {
    printerr(error?.stack ?? error?.message ?? String(error));
    exitCode = 1;
} finally {
    if (daemon && daemon.exitCode === 0)
        daemon._log('info', 'Folder Mirror helper stopped.');
}

System.exit(exitCode);
