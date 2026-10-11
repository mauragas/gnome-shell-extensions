import {
    getEffectiveExcludeRules,
    toUnisonIgnoreSpec,
} from '../../lib/exclude-rules.js';
import {
    isTwoWayMode,
    normalizeConflictPolicy,
    normalizeProfileMode,
} from '../../lib/validation.js';

/**
 * Detect Unison archive-loading failures so the daemon can rebuild the archive
 * instead of failing the profile forever. Unison reports these as fatal errors
 * such as "End_of_file exception raised in loading archive (this indicates a
 * bug!)" or "input_value: bad object" when an archive file was truncated or
 * written concurrently by another Unison process.
 */
export function isUnisonArchiveCorruptionError(output) {
    const text = typeof output === 'string' ? output : '';
    if (!text)
        return false;

    return /loading archive \(this indicates a bug!\)/iu.test(text) ||
        /End_of_file exception/iu.test(text) ||
        /input_value: bad object/iu.test(text) ||
        /archive file .* (?:is )?(?:corrupt|not in the expected format)/iu.test(text);
}

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
    ignoreArchives = false,
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
        ...(ignoreArchives ? ['ignorearchives = true'] : []),
    ];

    for (const rule of effectiveExcludeRules)
        lines.push(`ignore = ${toUnisonIgnoreSpec(rule)}`);

    return lines.join('\n');
}

export function buildUnisonCommand(profile, {
    globalExcludes = [],
    extraExcludeRules = [],
    dryRun = false,
    ignoreArchives = false,
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

    if (ignoreArchives)
        argv.push('-ignorearchives');

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
            ignoreArchives,
        }),
    };
}
