import assert from 'node:assert/strict';
import test from 'node:test';

import {buildRsyncCommand, resolveRsyncEndpoints} from '../service/backends/rsync.js';

const sampleProfile = {
    id: 'profile-1',
    name: 'One-way',
    sourcePath: '/tmp/source',
    targetPath: '/tmp/target',
    mode: 'one-way-source-to-target',
    globalExcludesEnabled: true,
    includeGitMetadata: false,
    excludeRules: [
        {type: 'glob', pattern: '*.tmp'},
    ],
};

test('resolveRsyncEndpoints keeps source->target mode unchanged', () => {
    assert.deepEqual(resolveRsyncEndpoints(sampleProfile), {
        sourcePath: '/tmp/source',
        targetPath: '/tmp/target',
    });
});

test('resolveRsyncEndpoints swaps endpoints for reverse mode', () => {
    assert.deepEqual(resolveRsyncEndpoints({
        ...sampleProfile,
        mode: 'one-way-target-to-source',
    }), {
        sourcePath: '/tmp/target',
        targetPath: '/tmp/source',
    });
});

test('buildRsyncCommand creates a deterministic argv with excludes and dry-run support', () => {
    const command = buildRsyncCommand(sampleProfile, {
        globalExcludes: [{type: 'name', pattern: '.git'}],
        dryRun: true,
    });

    assert.equal(command.argv[0], 'rsync');
    assert.ok(command.argv.includes('--dry-run'));
    assert.ok(command.argv.includes('--delete'));
    assert.ok(command.argv.includes('.git'));
    assert.ok(command.argv.includes('*.tmp'));
    assert.equal(command.argv.at(-2), '/tmp/source/');
    assert.equal(command.argv.at(-1), '/tmp/target/');
});

test('buildRsyncCommand keeps extra excludes even when normal global excludes are disabled', () => {
    const command = buildRsyncCommand({
        ...sampleProfile,
        globalExcludesEnabled: false,
    }, {
        globalExcludes: [{type: 'name', pattern: '.git'}],
        extraExcludeRules: [{type: 'path', pattern: 'node_modules'}],
    });

    assert.equal(command.argv.includes('.git'), false);
    assert.ok(command.argv.includes('/node_modules'));
});
