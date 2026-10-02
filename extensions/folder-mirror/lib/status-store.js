const PROFILE_STATUSES = new Set([
    'idle',
    'watching',
    'syncing',
    'paused',
    'error',
    'conflict',
]);

const HELPER_STATES = new Set([
    'starting',
    'running',
    'stopped',
    'error',
]);

function normalizeTimestamp(value) {
    if (typeof value !== 'string' || !value.trim())
        return null;

    return value.trim();
}

function normalizeDependencyValue(value) {
    if (typeof value === 'boolean') {
        return {
            available: value,
            path: null,
        };
    }

    return {
        available: Boolean(value?.available),
        path: typeof value?.path === 'string' && value.path.trim()
            ? value.path.trim()
            : null,
    };
}

function normalizeRecentErrors(errors) {
    return (Array.isArray(errors) ? errors : [])
        .map(error => {
            if (typeof error === 'string')
                return error.trim();

            return typeof error?.message === 'string'
                ? error.message.trim()
                : '';
        })
        .filter(Boolean)
        .slice(-10)
        .reverse();
}

export function normalizeRuntimeProfileEntry(entry = {}) {
    const status = PROFILE_STATUSES.has(entry.status)
        ? entry.status
        : 'idle';

    return {
        id: typeof entry.id === 'string' ? entry.id : '',
        name: typeof entry.name === 'string' ? entry.name : 'Unnamed profile',
        mode: typeof entry.mode === 'string' ? entry.mode : 'one-way-source-to-target',
        sourcePath: typeof entry.sourcePath === 'string' ? entry.sourcePath : '',
        targetPath: typeof entry.targetPath === 'string' ? entry.targetPath : '',
        status,
        enabled: entry.enabled !== false,
        paused: Boolean(entry.paused),
        watchMode: Boolean(entry.watchMode),
        lastRunAt: normalizeTimestamp(entry.lastRunAt),
        lastSuccessfulSyncAt: normalizeTimestamp(entry.lastSuccessfulSyncAt),
        lastError: typeof entry.lastError === 'string' && entry.lastError.trim()
            ? entry.lastError.trim()
            : null,
        lastConflictSummary: typeof entry.lastConflictSummary === 'string' && entry.lastConflictSummary.trim()
            ? entry.lastConflictSummary.trim()
            : null,
    };
}

export function summarizeProfileStatuses(profileEntries) {
    const counts = {
        total: 0,
        healthy: 0,
        syncing: 0,
        paused: 0,
        error: 0,
        conflict: 0,
    };

    for (const entry of Array.isArray(profileEntries) ? profileEntries : []) {
        const normalizedEntry = normalizeRuntimeProfileEntry(entry);
        counts.total++;

        switch (normalizedEntry.status) {
        case 'idle':
        case 'watching':
            counts.healthy++;
            break;
        case 'syncing':
            counts.syncing++;
            break;
        case 'paused':
            counts.paused++;
            break;
        case 'conflict':
            counts.conflict++;
            counts.error++;
            break;
        case 'error':
            counts.error++;
            break;
        default:
            break;
        }
    }

    return counts;
}

export function buildSnapshot({
    helperState = 'starting',
    startedAt = null,
    updatedAt = new Date().toISOString(),
    dependencies = {},
    profiles = [],
    recentErrors = [],
} = {}) {
    const normalizedProfiles = (Array.isArray(profiles) ? profiles : [])
        .map(normalizeRuntimeProfileEntry)
        .sort((left, right) => left.name.localeCompare(right.name));
    const counts = summarizeProfileStatuses(normalizedProfiles);

    const normalizedDependencies = Object.fromEntries(
        Object.entries(dependencies ?? {})
            .map(([dependencyName, dependencyValue]) => [
                dependencyName,
                normalizeDependencyValue(dependencyValue),
            ])
    );

    const normalizedHelperState = HELPER_STATES.has(helperState)
        ? helperState
        : 'error';

    return {
        version: 1,
        helperState: normalizedHelperState,
        helperRunning: normalizedHelperState === 'running' || normalizedHelperState === 'starting',
        startedAt: normalizeTimestamp(startedAt),
        updatedAt: normalizeTimestamp(updatedAt) ?? new Date().toISOString(),
        dependencies: normalizedDependencies,
        counts,
        recentErrors: normalizeRecentErrors(recentErrors),
        profiles: normalizedProfiles,
    };
}

export function normalizeSnapshot(snapshot = {}) {
    return buildSnapshot(snapshot);
}

export function parseSnapshot(raw) {
    if (!raw)
        return buildSnapshot({helperState: 'stopped'});

    try {
        return normalizeSnapshot(JSON.parse(raw));
    } catch {
        return buildSnapshot({
            helperState: 'error',
            recentErrors: ['Failed to parse the helper snapshot.'],
        });
    }
}

export function serializeSnapshot(snapshot) {
    return JSON.stringify(normalizeSnapshot(snapshot), null, 2);
}

export function deriveIndicatorState(snapshot) {
    const normalizedSnapshot = normalizeSnapshot(snapshot);
    if (normalizedSnapshot.helperState === 'error')
        return 'error';

    if (normalizedSnapshot.helperState === 'stopped')
        return 'stopped';

    if (normalizedSnapshot.counts.error > 0 || normalizedSnapshot.counts.conflict > 0)
        return 'error';

    if (normalizedSnapshot.counts.syncing > 0)
        return 'syncing';

    if (normalizedSnapshot.counts.total > 0 && normalizedSnapshot.counts.paused === normalizedSnapshot.counts.total)
        return 'paused';

    return 'idle';
}

export function buildSnapshotSummary(snapshot) {
    const normalizedSnapshot = normalizeSnapshot(snapshot);
    if (normalizedSnapshot.helperState === 'stopped')
        return 'Helper stopped';

    if (normalizedSnapshot.helperState === 'error')
        return 'Helper error';

    const summaryBits = [];
    if (normalizedSnapshot.counts.healthy > 0)
        summaryBits.push(`${normalizedSnapshot.counts.healthy} healthy`);
    if (normalizedSnapshot.counts.syncing > 0)
        summaryBits.push(`${normalizedSnapshot.counts.syncing} syncing`);
    if (normalizedSnapshot.counts.paused > 0)
        summaryBits.push(`${normalizedSnapshot.counts.paused} paused`);
    if (normalizedSnapshot.counts.error > 0)
        summaryBits.push(`${normalizedSnapshot.counts.error} attention`);

    return summaryBits.length > 0
        ? summaryBits.join(' • ')
        : 'No profiles configured';
}
