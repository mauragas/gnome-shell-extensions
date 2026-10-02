import {
    getEffectiveExcludeRules,
    toRsyncExcludePattern,
} from '../../lib/exclude-rules.js';
import {
    isOneWayMode,
    normalizeProfileMode,
} from '../../lib/validation.js';

function normalizeDirectorySyncPath(path) {
    return path.endsWith('/')
        ? path
        : `${path}/`;
}

export function resolveRsyncEndpoints(profile) {
    const mode = normalizeProfileMode(profile?.mode);
    if (!isOneWayMode(mode))
        throw new Error(`rsync only supports one-way profile modes, received ${mode}`);

    if (mode === 'one-way-target-to-source') {
        return {
            sourcePath: profile.targetPath,
            targetPath: profile.sourcePath,
        };
    }

    return {
        sourcePath: profile.sourcePath,
        targetPath: profile.targetPath,
    };
}

export function buildRsyncCommand(profile, {
    globalExcludes = [],
    extraExcludeRules = [],
    dryRun = false,
} = {}) {
    const {sourcePath, targetPath} = resolveRsyncEndpoints(profile);
    const effectiveExcludeRules = getEffectiveExcludeRules(
        profile.excludeRules,
        globalExcludes,
        {
            globalExcludesEnabled: profile.globalExcludesEnabled,
            includeGitMetadata: profile.includeGitMetadata,
            alwaysIncludedRules: extraExcludeRules,
        }
    );

    const argv = [
        'rsync',
        '-a',
        '--delete',
        '--delete-delay',
        '--human-readable',
        '--itemize-changes',
        '--partial',
    ];

    if (dryRun)
        argv.push('--dry-run');

    for (const rule of effectiveExcludeRules) {
        argv.push('--exclude', toRsyncExcludePattern(rule));
    }

    argv.push(
        normalizeDirectorySyncPath(sourcePath),
        normalizeDirectorySyncPath(targetPath)
    );

    return {
        argv,
        sourcePath,
        targetPath,
        effectiveExcludeRules,
        dryRun,
    };
}
