import {createEntityId} from './validation.js';

export const EXCLUDE_RULE_TYPES = Object.freeze([
    'name',
    'path',
    'glob',
]);

export const DEFAULT_DEVELOPMENT_EXCLUDE_PATTERNS = Object.freeze([
    '.git',
    '.svn',
    '.hg',
    '.vs',
    '.angular/cache',
    '.next',
    '.nuxt',
    '.parcel-cache',
    '.sass-cache',
    '.turbo',
    'bin',
    'obj',
    'node_modules',
    'out',
    'dist',
    'build',
    'coverage',
    'TestResults',
    '.pytest_cache',
    '__pycache__',
    '.cache',
    '.eslintcache',
    'tmp',
    'temp',
    '*.tmp',
    '*.swp',
    '*.swo',
    '*.bak',
    'Thumbs.db',
    '.DS_Store',
]);

function normalizeRulePattern(value) {
    if (typeof value !== 'string')
        return '';

    return value.trim();
}

export function inferExcludeRuleType(pattern) {
    if (typeof pattern !== 'string' || !pattern.trim())
        return 'name';

    if (/[*?\[]/.test(pattern))
        return 'glob';

    if (pattern.includes('/'))
        return 'path';

    return 'name';
}

export function normalizeExcludeRuleType(value, fallbackPattern = '') {
    if (EXCLUDE_RULE_TYPES.includes(value))
        return value;

    return inferExcludeRuleType(fallbackPattern);
}

export function normalizeExcludeRule(rule) {
    if (rule === null || rule === undefined)
        return null;

    const rawRule = typeof rule === 'string'
        ? {pattern: rule}
        : rule;
    const pattern = normalizeRulePattern(rawRule?.pattern ?? rawRule?.value ?? '');
    if (!pattern)
        return null;

    const type = normalizeExcludeRuleType(rawRule?.type, pattern);
    const id = typeof rawRule?.id === 'string' && rawRule.id.trim()
        ? rawRule.id.trim()
        : createEntityId('rule');

    return {
        id,
        type,
        pattern,
    };
}

export function normalizeExcludeRules(rules) {
    const normalized = [];
    const seen = new Set();

    for (const rawRule of Array.isArray(rules) ? rules : []) {
        const rule = normalizeExcludeRule(rawRule);
        if (!rule)
            continue;

        const dedupeKey = `${rule.type}\u0000${rule.pattern}`;
        if (seen.has(dedupeKey))
            continue;

        seen.add(dedupeKey);
        normalized.push(rule);
    }

    return normalized;
}

export function createDefaultExcludeRules() {
    return DEFAULT_DEVELOPMENT_EXCLUDE_PATTERNS
        .map(pattern => normalizeExcludeRule({type: inferExcludeRuleType(pattern), pattern}))
        .filter(Boolean);
}

export function parseExcludeRulesFromLines(text) {
    if (typeof text !== 'string' || !text.trim())
        return [];

    const rawRules = [];
    for (const rawLine of text.split(/\r?\n/u)) {
        const line = rawLine.trim();
        if (!line || line.startsWith('#'))
            continue;

        const match = line.match(/^(name|path|glob)\s*:\s*(.+)$/u);
        if (match) {
            rawRules.push({
                type: match[1],
                pattern: match[2],
            });
        } else {
            rawRules.push({pattern: line});
        }
    }

    return normalizeExcludeRules(rawRules);
}

export function formatExcludeRulesAsLines(rules) {
    return normalizeExcludeRules(rules)
        .map(rule => `${rule.type}:${rule.pattern}`)
        .join('\n');
}

export function isGitMetadataRule(rule) {
    if (!rule)
        return false;

    const normalizedPattern = rule.pattern.replace(/^\/+/, '');
    return normalizedPattern === '.git';
}

export function getEffectiveExcludeRules(profileRules, globalRules, {
    globalExcludesEnabled = true,
    includeGitMetadata = false,
    alwaysIncludedRules = [],
} = {}) {
    const merged = [
        ...(globalExcludesEnabled ? normalizeExcludeRules(globalRules) : []),
        ...normalizeExcludeRules(alwaysIncludedRules),
        ...normalizeExcludeRules(profileRules),
    ];

    return normalizeExcludeRules(
        includeGitMetadata
            ? merged.filter(rule => !isGitMetadataRule(rule))
            : merged
    );
}

export function toRsyncExcludePattern(rule) {
    if (!rule)
        return '';

    switch (rule.type) {
    case 'path':
        return `/${rule.pattern.replace(/^\/+/, '')}`;
    case 'glob':
        return rule.pattern;
    case 'name':
    default:
        return rule.pattern;
    }
}

export function toUnisonIgnoreSpec(rule) {
    if (!rule)
        return '';

    switch (rule.type) {
    case 'path':
        return `Path ${rule.pattern.replace(/^\/+/, '')}`;
    case 'glob':
        return rule.pattern.includes('/')
            ? `Path ${rule.pattern.replace(/^\/+/, '')}`
            : `Name ${rule.pattern}`;
    case 'name':
    default:
        return `Name ${rule.pattern}`;
    }
}
