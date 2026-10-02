export const SYNC_PULSE_DURATION_MS = 3000;
export const MAX_WATCH_INTERVAL_SECONDS = 300;

export function didSyncProduceVisibleChanges(processResult) {
    const stdout = typeof processResult?.stdout === 'string'
        ? processResult.stdout.trim()
        : '';
    const stderr = typeof processResult?.stderr === 'string'
        ? processResult.stderr.trim()
        : '';

    return Boolean(stdout || stderr);
}

export function computeWatchDelayMs(baseIntervalSeconds, consecutiveNoChangeRuns = 0) {
    const baseMs = Math.max(1, Number(baseIntervalSeconds) || 1) * 1000;
    const multiplier = Math.min(2 ** Math.max(0, consecutiveNoChangeRuns), 32);
    return Math.min(baseMs * multiplier, MAX_WATCH_INTERVAL_SECONDS * 1000);
}

export function deriveRuntimeStatus({
    active = false,
    enabled = true,
    paused = false,
    watchMode = false,
    autoStartHelper = true,
    previousStatus = 'idle',
    syncPulseUntil = 0,
    nowMs = Date.now(),
} = {}) {
    if (!enabled || paused)
        return 'paused';

    if (active)
        return 'syncing';

    if (previousStatus === 'error' || previousStatus === 'conflict')
        return previousStatus;

    if (syncPulseUntil > nowMs)
        return 'syncing';

    if (watchMode && autoStartHelper)
        return 'watching';

    return 'idle';
}

export function updateWatchRunState(previousState = {}, {
    trigger = 'watch',
    hadChanges = false,
    baseIntervalSeconds = 10,
    nowMs = Date.now(),
} = {}) {
    const previousNoChangeRuns = Number.isInteger(previousState.consecutiveNoChangeRuns)
        ? previousState.consecutiveNoChangeRuns
        : 0;

    if (trigger !== 'watch') {
        return {
            consecutiveNoChangeRuns: 0,
            nextWatchAt: nowMs + baseIntervalSeconds * 1000,
            syncPulseUntil: 0,
        };
    }

    if (hadChanges) {
        return {
            consecutiveNoChangeRuns: 0,
            nextWatchAt: nowMs + baseIntervalSeconds * 1000,
            syncPulseUntil: nowMs + SYNC_PULSE_DURATION_MS,
        };
    }

    const consecutiveNoChangeRuns = previousNoChangeRuns + 1;
    return {
        consecutiveNoChangeRuns,
        nextWatchAt: nowMs + computeWatchDelayMs(baseIntervalSeconds, consecutiveNoChangeRuns),
        syncPulseUntil: previousState.syncPulseUntil ?? 0,
    };
}
