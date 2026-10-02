export const PROFILE_MODES = Object.freeze([
    'one-way-source-to-target',
    'one-way-target-to-source',
    'two-way',
]);

export const CONFLICT_POLICIES = Object.freeze([
    'manual',
    'prefer-newer',
    'prefer-source',
    'prefer-target',
    'keep-both-when-possible',
]);

export const LOG_LEVELS = Object.freeze([
    'debug',
    'info',
    'warn',
    'error',
]);

export const PROFILE_STATUS_VALUES = Object.freeze([
    'idle',
    'watching',
    'syncing',
    'paused',
    'error',
    'conflict',
]);

export const PROFILE_MODE_LABELS = Object.freeze({
    'one-way-source-to-target': 'One-way',
    'one-way-target-to-source': 'Reverse',
    'two-way': 'Two-way',
});

export const CONFLICT_POLICY_LABELS = Object.freeze({
    manual: 'Manual',
    'prefer-newer': 'Prefer newer',
    'prefer-source': 'Prefer source',
    'prefer-target': 'Prefer target',
    'keep-both-when-possible': 'Keep both when possible',
});

export const DEFAULT_WATCH_INTERVAL_SECONDS = 10;
export const DEFAULT_PROFILE_NAME = 'New mirror profile';

export function createEntityId(prefix = 'item') {
    const timestamp = Date.now().toString(36);
    const random = Math.random().toString(36).slice(2, 10);
    return `${prefix}-${timestamp}-${random}`;
}

export function normalizeString(value, fallback = '') {
    if (typeof value !== 'string')
        return fallback;

    const trimmed = value.trim();
    return trimmed || fallback;
}

export function normalizeOptionalString(value) {
    if (typeof value !== 'string')
        return null;

    const trimmed = value.trim();
    return trimmed || null;
}

export function normalizeBoolean(value, fallback = false) {
    if (typeof value === 'boolean')
        return value;

    if (value === 'true')
        return true;

    if (value === 'false')
        return false;

    return fallback;
}

export function normalizeUnsignedInteger(value, fallback = DEFAULT_WATCH_INTERVAL_SECONDS, {
    min = 1,
    max = 86400,
} = {}) {
    const numeric = Number(value);
    if (!Number.isInteger(numeric))
        return fallback;

    return Math.max(min, Math.min(max, numeric));
}

export function normalizeProfileMode(value) {
    return PROFILE_MODES.includes(value)
        ? value
        : PROFILE_MODES[0];
}

export function normalizeConflictPolicy(value) {
    return CONFLICT_POLICIES.includes(value)
        ? value
        : CONFLICT_POLICIES[0];
}

export function normalizeLogLevel(value) {
    return LOG_LEVELS.includes(value)
        ? value
        : 'info';
}

export function normalizePath(value) {
    if (typeof value !== 'string')
        return '';

    const trimmed = value.trim();
    if (!trimmed)
        return '';

    if (trimmed.length > 1 && trimmed.endsWith('/'))
        return trimmed.replace(/\/+$/, '');

    return trimmed;
}

export function isOneWayMode(mode) {
    return mode === 'one-way-source-to-target' || mode === 'one-way-target-to-source';
}

export function isTwoWayMode(mode) {
    return mode === 'two-way';
}

export function normalizeProfileScalarFields(rawProfile = {}) {
    return {
        id: normalizeString(rawProfile.id, createEntityId('profile')),
        name: normalizeString(rawProfile.name, DEFAULT_PROFILE_NAME),
        enabled: normalizeBoolean(rawProfile.enabled, true),
        paused: normalizeBoolean(rawProfile.paused, false),
        sourcePath: normalizePath(rawProfile.sourcePath),
        targetPath: normalizePath(rawProfile.targetPath),
        mode: normalizeProfileMode(rawProfile.mode),
        watchMode: normalizeBoolean(rawProfile.watchMode, true),
        runAtLogin: normalizeBoolean(rawProfile.runAtLogin, true),
        conflictPolicy: normalizeConflictPolicy(rawProfile.conflictPolicy),
        deleteProtection: normalizeBoolean(rawProfile.deleteProtection, true),
        globalExcludesEnabled: normalizeBoolean(rawProfile.globalExcludesEnabled, true),
        excludeGitIgnored: normalizeBoolean(rawProfile.excludeGitIgnored, true),
        includeGitMetadata: normalizeBoolean(rawProfile.includeGitMetadata, false),
        excludeRules: Array.isArray(rawProfile.excludeRules) ? rawProfile.excludeRules : [],
    };
}

export function buildProfileValidationErrors(profile) {
    const errors = [];

    if (!profile.name)
        errors.push('Profile name is required.');

    if (!profile.sourcePath)
        errors.push('Source path is required.');

    if (!profile.targetPath)
        errors.push('Target path is required.');

    if (profile.sourcePath && profile.targetPath && profile.sourcePath === profile.targetPath) {
        errors.push('Source and target paths must be different.');
    }

    if (!PROFILE_MODES.includes(profile.mode))
        errors.push(`Unsupported profile mode: ${profile.mode}`);

    if (!CONFLICT_POLICIES.includes(profile.conflictPolicy))
        errors.push(`Unsupported conflict policy: ${profile.conflictPolicy}`);

    return errors;
}

export function normalizeHelperConfig(rawConfig = {}) {
    return {
        showIndicator: normalizeBoolean(rawConfig.showIndicator, true),
        showNotifications: normalizeBoolean(rawConfig.showNotifications, true),
        autoStartHelper: normalizeBoolean(rawConfig.autoStartHelper, true),
        watchIntervalSeconds: normalizeUnsignedInteger(
            rawConfig.watchIntervalSeconds,
            DEFAULT_WATCH_INTERVAL_SECONDS,
            {min: 5, max: 3600}
        ),
        logLevel: normalizeLogLevel(rawConfig.logLevel),
    };
}

export function summarizeMode(mode) {
    return PROFILE_MODE_LABELS[normalizeProfileMode(mode)] ?? 'Unknown';
}
