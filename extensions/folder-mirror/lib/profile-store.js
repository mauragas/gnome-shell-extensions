import {
    createDefaultExcludeRules,
    normalizeExcludeRules,
} from './exclude-rules.js';
import {
    DEFAULT_PROFILE_NAME,
    buildProfileValidationErrors,
    createEntityId,
    normalizeProfileScalarFields,
} from './validation.js';

function parseJsonArray(raw, fallback = []) {
    if (!raw)
        return [...fallback];

    try {
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed)
            ? parsed
            : [...fallback];
    } catch {
        return [...fallback];
    }
}

function createUniqueProfileName(existingNames, baseName) {
    const normalizedBaseName = baseName?.trim() || DEFAULT_PROFILE_NAME;
    if (!existingNames.has(normalizedBaseName))
        return normalizedBaseName;

    let counter = 2;
    while (existingNames.has(`${normalizedBaseName} ${counter}`))
        counter++;

    return `${normalizedBaseName} ${counter}`;
}

export function normalizeProfile(rawProfile, usedIds = new Set()) {
    const scalarFields = normalizeProfileScalarFields(rawProfile);
    const excludeRules = normalizeExcludeRules(scalarFields.excludeRules);
    let id = scalarFields.id;
    while (usedIds.has(id))
        id = createEntityId('profile');

    usedIds.add(id);

    return {
        ...scalarFields,
        id,
        excludeRules,
    };
}

export function normalizeProfiles(rawProfiles) {
    const usedIds = new Set();
    return (Array.isArray(rawProfiles) ? rawProfiles : [])
        .map(profile => normalizeProfile(profile, usedIds));
}

export function loadProfilesFromString(raw) {
    return normalizeProfiles(parseJsonArray(raw));
}

export function serializeProfiles(profiles) {
    return JSON.stringify(normalizeProfiles(profiles));
}

export function loadGlobalExcludesFromString(raw, {
    fallbackToDefaults = true,
} = {}) {
    if (!raw)
        return fallbackToDefaults
            ? createDefaultExcludeRules()
            : [];

    try {
        const parsed = JSON.parse(raw);
        return normalizeExcludeRules(Array.isArray(parsed) ? parsed : []);
    } catch {
        return fallbackToDefaults
            ? createDefaultExcludeRules()
            : [];
    }
}

export function serializeGlobalExcludes(rules) {
    return JSON.stringify(normalizeExcludeRules(rules));
}

export function createProfileTemplate(overrides = {}) {
    return normalizeProfile({
        id: createEntityId('profile'),
        name: DEFAULT_PROFILE_NAME,
        enabled: true,
        paused: false,
        sourcePath: '',
        targetPath: '',
        mode: 'one-way-source-to-target',
        watchMode: true,
        runAtLogin: true,
        conflictPolicy: 'manual',
        deleteProtection: true,
        globalExcludesEnabled: true,
        excludeGitIgnored: true,
        includeGitMetadata: false,
        excludeRules: [],
        ...overrides,
    });
}

export function findProfileById(profiles, profileId) {
    return normalizeProfiles(profiles).find(profile => profile.id === profileId) ?? null;
}

export function replaceProfile(profiles, nextProfile) {
    const normalizedProfiles = normalizeProfiles(profiles);
    const normalizedNextProfile = normalizeProfile(nextProfile, new Set());
    const profileIndex = normalizedProfiles.findIndex(profile => profile.id === normalizedNextProfile.id);

    if (profileIndex < 0)
        return normalizeProfiles([...normalizedProfiles, normalizedNextProfile]);

    normalizedProfiles.splice(profileIndex, 1, normalizedNextProfile);
    return normalizeProfiles(normalizedProfiles);
}

export function removeProfileFromList(profiles, profileId) {
    return normalizeProfiles(profiles)
        .filter(profile => profile.id !== profileId);
}

export function duplicateProfile(profiles, profileId) {
    const normalizedProfiles = normalizeProfiles(profiles);
    const sourceProfile = normalizedProfiles.find(profile => profile.id === profileId);
    if (!sourceProfile)
        return normalizedProfiles;

    const existingNames = new Set(normalizedProfiles.map(profile => profile.name));
    const duplicateName = createUniqueProfileName(existingNames, `${sourceProfile.name} Copy`);
    const duplicate = normalizeProfile({
        ...sourceProfile,
        id: createEntityId('profile'),
        name: duplicateName,
        paused: false,
    }, new Set(normalizedProfiles.map(profile => profile.id)));

    return normalizeProfiles([...normalizedProfiles, duplicate]);
}

export function setProfilePaused(profiles, profileId, paused) {
    return normalizeProfiles(profiles).map(profile =>
        profile.id === profileId
            ? normalizeProfile({...profile, paused: Boolean(paused)}, new Set())
            : profile
    );
}

export function validateProfiles(profiles) {
    return normalizeProfiles(profiles).map(profile => ({
        id: profile.id,
        errors: buildProfileValidationErrors(profile),
    }));
}
