import assert from 'node:assert/strict';
import test from 'node:test';

import {
    createDefaultExcludeRules,
    formatExcludeRulesAsLines,
    getEffectiveExcludeRules,
    normalizeExcludeRule,
    normalizeExcludeRules,
    parseExcludeRulesFromLines,
    toRsyncExcludePattern,
    toUnisonIgnoreSpec,
} from '../lib/exclude-rules.js';

test('normalizeExcludeRule infers rule types from plain patterns', () => {
    const gitRule = normalizeExcludeRule('.git');
    assert.equal(gitRule.type, 'name');
    assert.equal(gitRule.pattern, '.git');
    assert.match(gitRule.id, /^rule-/u);
    assert.equal(normalizeExcludeRule('src/generated').type, 'path');
    assert.equal(normalizeExcludeRule('*.tmp').type, 'glob');
});

test('normalizeExcludeRules removes duplicates while keeping order', () => {
    const rules = normalizeExcludeRules([
        {type: 'name', pattern: '.git'},
        {type: 'name', pattern: '.git'},
        {type: 'glob', pattern: '*.tmp'},
    ]);

    assert.equal(rules.length, 2);
    assert.equal(rules[0].pattern, '.git');
    assert.equal(rules[1].pattern, '*.tmp');
});

test('parseExcludeRulesFromLines and formatExcludeRulesAsLines round-trip meaningful rules', () => {
    const parsed = parseExcludeRulesFromLines(`
# comments are ignored
name:.git
path:src/generated
glob:*.tmp
plain-folder
`);

    assert.deepEqual(
        parsed.map(rule => ({type: rule.type, pattern: rule.pattern})),
        [
            {type: 'name', pattern: '.git'},
            {type: 'path', pattern: 'src/generated'},
            {type: 'glob', pattern: '*.tmp'},
            {type: 'name', pattern: 'plain-folder'},
        ]
    );

    assert.equal(
        formatExcludeRulesAsLines(parsed),
        'name:.git\npath:src/generated\nglob:*.tmp\nname:plain-folder'
    );
});

test('getEffectiveExcludeRules respects the includeGitMetadata override', () => {
    const effectiveWithoutGit = getEffectiveExcludeRules(
        [{type: 'glob', pattern: '*.tmp'}],
        [{type: 'name', pattern: '.git'}],
        {globalExcludesEnabled: true, includeGitMetadata: false}
    );
    const effectiveWithGit = getEffectiveExcludeRules(
        [{type: 'glob', pattern: '*.tmp'}],
        [{type: 'name', pattern: '.git'}],
        {globalExcludesEnabled: true, includeGitMetadata: true}
    );

    assert.equal(effectiveWithoutGit.length, 2);
    assert.equal(effectiveWithGit.length, 1);
    assert.equal(effectiveWithGit[0].pattern, '*.tmp');
});

test('rsync and unison mappings reflect the normalized rule semantics', () => {
    assert.equal(toRsyncExcludePattern({type: 'path', pattern: 'src/generated'}), '/src/generated');
    assert.equal(toUnisonIgnoreSpec({type: 'path', pattern: 'src/generated'}), 'Path src/generated');
    assert.equal(toUnisonIgnoreSpec({type: 'name', pattern: '.git'}), 'Name .git');
});

test('createDefaultExcludeRules returns the development defaults', () => {
    const defaults = createDefaultExcludeRules();
    assert.ok(defaults.length >= 10);
    assert.ok(defaults.some(rule => rule.pattern === '.git'));
    assert.ok(defaults.some(rule => rule.pattern === 'node_modules'));
});
