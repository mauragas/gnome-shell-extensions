#!/usr/bin/env -S gjs -m

import System from 'system';

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

import {
    loadGlobalExcludes,
    loadProfiles,
    loadSettingsFromImportMeta,
    readUtf8File,
    saveGlobalExcludes,
    saveProfiles,
} from '../shared.js';
import {normalizeExcludeRules} from '../lib/exclude-rules.js';
import {
    normalizeProfiles,
    replaceProfile,
} from '../lib/profile-store.js';

function resolveManifestPath(manifestArgument) {
    if (!manifestArgument)
        return null;

    if (GLib.path_is_absolute(manifestArgument))
        return manifestArgument;

    return GLib.build_filenamev([GLib.get_current_dir(), manifestArgument]);
}

function loadManifest(manifestPath) {
    const raw = readUtf8File(manifestPath, '');
    if (!raw)
        throw new Error(`Manifest file is empty or unreadable: ${manifestPath}`);

    try {
        return JSON.parse(raw);
    } catch (error) {
        throw new Error(`Failed to parse ${manifestPath}: ${error.message}`);
    }
}

function main() {
    const replaceExisting = System.programArgs.includes('--replace');
    const manifestArgument = System.programArgs.find(argument => !argument.startsWith('--'));
    const manifestPath = resolveManifestPath(manifestArgument);

    if (!manifestPath) {
        throw new Error('Usage: gjs -m scripts/import-profile-manifest.js [--replace] <manifest.json>');
    }

    const manifest = loadManifest(manifestPath);
    const settings = loadSettingsFromImportMeta(import.meta.url);

    let profiles = replaceExisting
        ? []
        : loadProfiles(settings);

    for (const importedProfile of normalizeProfiles(manifest.profiles ?? []))
        profiles = replaceProfile(profiles, importedProfile);

    saveProfiles(settings, profiles);

    if (Array.isArray(manifest.globalExcludes)) {
        saveGlobalExcludes(settings, normalizeExcludeRules(manifest.globalExcludes));
    } else if (replaceExisting && !manifest.globalExcludes) {
        saveGlobalExcludes(settings, loadGlobalExcludes(settings));
    }

    print(`[FM] Imported ${manifest.profiles?.length ?? 0} profile(s) from ${manifestPath}`);
    print(`[FM] Replace existing: ${replaceExisting ? 'yes' : 'no'}`);
    print(`[FM] Saved profile count: ${profiles.length}`);
}

let exitCode = 0;

try {
    main();
} catch (error) {
    printerr(error?.stack ?? error?.message ?? String(error));
    exitCode = 1;
}

System.exit(exitCode);
