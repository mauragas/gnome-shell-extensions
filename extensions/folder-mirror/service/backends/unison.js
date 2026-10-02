import {
    getEffectiveExcludeRules,
    toUnisonIgnoreSpec,
} from '../../lib/exclude-rules.js';
import {
    isTwoWayMode,
    normalizeConflictPolicy,
    normalizeProfileMode,
} from '../../lib/validation.js';

export function buildUnisonConflictArguments(profile) {
    const policy = normalizeConflictPolicy(profile?.conflictPolicy);

    switch (policy) {
    case 'prefer-newer':
        return ['-prefer', 'newer', '-copyonconflict'];
    case 'prefer-source':
        return ['-prefer', profile.sourcePath, '-copyonconflict'];
    case 'prefer-target':
        return ['-prefer', profile.targetPath, '-copyonconflict'];
    case 'keep-both-when-possible':
        return ['-copyonconflict'];
    case 'manual':
    default:
        return [];
    }
}

export function buildUnisonProfilePreview(profile, {
    globalExcludes = [],
    extraExcludeRules = [],
    dryRun = false,
} = {}) {
    const effectiveExcludeRules = getEffectiveExcludeRules(
        profile.excludeRules,
        globalExcludes,
        {
            globalExcludesEnabled: profile.globalExcludesEnabled,
            includeGitMetadata: profile.includeGitMetadata,
            alwaysIncludedRules: extraExcludeRules,
        }
    );

    const lines = [
        `root = ${profile.sourcePath}`,
        `root = ${profile.targetPath}`,
        'auto = true',
        'batch = true',
        'terse = true',
        ...(profile.deleteProtection === false ? ['confirmbigdel = false'] : []),
        ...(dryRun ? ['dryrun = true'] : []),
    ];

    for (const rule of effectiveExcludeRules)
        lines.push(`ignore = ${toUnisonIgnoreSpec(rule)}`);

    return lines.join('\n');
}

export function buildUnisonCommand(profile, {
    globalExcludes = [],
    extraExcludeRules = [],
    dryRun = false,
} = {}) {
    const mode = normalizeProfileMode(profile?.mode);
    if (!isTwoWayMode(mode))
        throw new Error(`unison only supports two-way profile modes, received ${mode}`);

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
        'unison',
        '-root',
        profile.sourcePath,
        '-root',
        profile.targetPath,
        '-ui',
        'text',
        '-auto',
        '-batch',
        '-terse',
        '-times',
    ];

    if (profile.deleteProtection === false)
        argv.push('-confirmbigdel=false');

    if (dryRun)
        argv.push('-dryrun');

    argv.push(...buildUnisonConflictArguments(profile));

    for (const rule of effectiveExcludeRules)
        argv.push('-ignore', toUnisonIgnoreSpec(rule));

    return {
        argv,
        effectiveExcludeRules,
        dryRun,
        profilePreview: buildUnisonProfilePreview(profile, {
            globalExcludes,
            extraExcludeRules,
            dryRun,
        }),
    };
}
