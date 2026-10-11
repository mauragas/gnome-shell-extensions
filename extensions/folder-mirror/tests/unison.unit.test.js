import assert from 'node:assert/strict';
import test from 'node:test';

import {
    buildUnisonCommand,
    buildUnisonConflictArguments,
    buildUnisonProfilePreview,
    isUnisonArchiveCorruptionError,
} from '../service/backends/unison.js';

const sampleProfile = {
    id: 'profile-1',
    name: 'Two-way',
    sourcePath: '/tmp/source',
    targetPath: '/tmp/target',
    mode: 'two-way',
    conflictPolicy: 'prefer-source',
    deleteProtection: true,
    globalExcludesEnabled: true,
    includeGitMetadata: false,
    excludeRules: [
        {type: 'glob', pattern: '*.tmp'},
    ],
};

test('buildUnisonConflictArguments maps conflict policies to deterministic CLI segments', () => {
    assert.deepEqual(buildUnisonConflictArguments(sampleProfile), [
        '-prefer',
        '/tmp/source',
        '-copyonconflict',
    ]);

    assert.deepEqual(buildUnisonConflictArguments({
        ...sampleProfile,
        conflictPolicy: 'keep-both-when-possible',
    }), ['-copyonconflict']);
});

test('buildUnisonCommand builds a usable argv and ignore list', () => {
    const command = buildUnisonCommand(sampleProfile, {
        globalExcludes: [{type: 'name', pattern: '.git'}],
        dryRun: true,
    });

    assert.equal(command.argv[0], 'unison');
    assert.deepEqual(command.argv.slice(0, 5), [
        'unison',
        '-root',
        '/tmp/source',
        '-root',
        '/tmp/target',
    ]);
    assert.ok(command.argv.includes('/tmp/source'));
    assert.ok(command.argv.includes('/tmp/target'));
    assert.ok(command.argv.includes('-dryrun'));
    assert.ok(command.argv.includes('-copyonconflict'));
    assert.ok(command.argv.includes('Name .git'));
    assert.ok(command.argv.includes('Name *.tmp'));
});

test('buildUnisonProfilePreview gives diagnostics-friendly output', () => {
    const preview = buildUnisonProfilePreview(sampleProfile, {
        globalExcludes: [{type: 'name', pattern: '.git'}],
    });

    assert.match(preview, /root = \/tmp\/source/u);
    assert.match(preview, /root = \/tmp\/target/u);
    assert.match(preview, /ignore = Name \.git/u);
});

test('buildUnisonCommand keeps extra excludes even when normal global excludes are disabled', () => {
    const command = buildUnisonCommand({
        ...sampleProfile,
        globalExcludesEnabled: false,
    }, {
        globalExcludes: [{type: 'name', pattern: '.git'}],
        extraExcludeRules: [{type: 'path', pattern: 'node_modules'}],
    });

    assert.equal(command.argv.includes('Name .git'), false);
    assert.ok(command.argv.includes('Path node_modules'));
});

test('buildUnisonCommand adds -ignorearchives when asked to rebuild a corrupt archive', () => {
    const defaultCommand = buildUnisonCommand(sampleProfile);
    assert.equal(defaultCommand.argv.includes('-ignorearchives'), false);

    const recoveryCommand = buildUnisonCommand(sampleProfile, {ignoreArchives: true});
    assert.ok(recoveryCommand.argv.includes('-ignorearchives'));
    assert.match(recoveryCommand.profilePreview, /ignorearchives = true/u);
});

test('isUnisonArchiveCorruptionError detects unison archive loading failures', () => {
    assert.equal(isUnisonArchiveCorruptionError(
        'Fatal error: End_of_file exception raised in loading archive (this indicates a bug!)'
    ), true);
    assert.equal(isUnisonArchiveCorruptionError(
        'Uncaught exception input_value: bad object'
    ), true);
    assert.equal(isUnisonArchiveCorruptionError(
        'The archive file /home/user/.unison/ar1234 is corrupt'
    ), true);
    assert.equal(isUnisonArchiveCorruptionError(''), false);
    assert.equal(isUnisonArchiveCorruptionError(null), false);
    assert.equal(isUnisonArchiveCorruptionError('Synchronization complete at 12:00:00'), false);
});
