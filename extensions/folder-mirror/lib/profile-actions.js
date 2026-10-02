const SYNC_SPINNER_FRAMES = Object.freeze(['|', '/', '-', '\\']);

function normalizeProfileName(profile) {
    const profileName = typeof profile?.name === 'string'
        ? profile.name.trim()
        : '';

    return profileName || 'this profile';
}

export function isProfilePaused(profile = {}) {
    return profile.paused === true || profile.status === 'paused';
}

export function isProfileSyncing(profile = {}) {
    return profile.status === 'syncing';
}

function buildSyncProgressLabel(syncAnimationFrame = 0) {
    const normalizedFrame = Number.isInteger(syncAnimationFrame)
        ? Math.abs(syncAnimationFrame)
        : 0;
    const frame = SYNC_SPINNER_FRAMES[normalizedFrame % SYNC_SPINNER_FRAMES.length];
    return `Syncing ${frame}`;
}

export function buildProfileMenuActions(profile = {}, {
    syncAnimationFrame = 0,
} = {}) {
    const profileName = normalizeProfileName(profile);
    const syncInProgress = isProfileSyncing(profile);
    const controlAction = isProfilePaused(profile)
        ? {
            iconName: 'media-playback-start-symbolic',
            label: 'Resume',
            methodName: 'ResumeProfile',
            notification: `Resumed ${profileName}.`,
        }
        : {
            iconName: 'media-playback-pause-symbolic',
            label: 'Pause',
            methodName: 'PauseProfile',
            notification: `Paused ${profileName}.`,
        };

    return {
        syncAction: syncInProgress
            ? {
                iconName: 'emblem-synchronizing-symbolic',
                label: buildSyncProgressLabel(syncAnimationFrame),
                methodName: 'SyncProfile',
                notification: `Triggered a sync for ${profileName}.`,
                enabled: false,
            }
            : {
                iconName: 'view-refresh-symbolic',
                label: 'Sync now',
                methodName: 'SyncProfile',
                notification: `Triggered a sync for ${profileName}.`,
                enabled: true,
            },
        controlAction,
    };
}
