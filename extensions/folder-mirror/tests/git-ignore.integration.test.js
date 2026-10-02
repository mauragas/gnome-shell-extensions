import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdtempSync, mkdirSync, rmSync, writeFileSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

const gitAvailable = spawnSync('git', ['--version'], {
    encoding: 'utf8',
}).status === 0;

test('git can evaluate ignored mirror paths against source-repo rules', {
    skip: gitAvailable ? undefined : 'git is not available in PATH',
}, () => {
    const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'folder-mirror-gitignore-'));
    const repoRoot = path.join(tempRoot, 'repo');
    const mirrorRoot = path.join(tempRoot, 'mirror');

    try {
        mkdirSync(path.join(repoRoot, 'sub'), {recursive: true});
        mkdirSync(path.join(mirrorRoot, 'node_modules', 'pkg'), {recursive: true});
        mkdirSync(path.join(mirrorRoot, 'sub'), {recursive: true});
        writeFileSync(path.join(repoRoot, '.gitignore'), 'node_modules\n*.tmp\n');
        writeFileSync(path.join(repoRoot, 'sub', 'tracked.txt'), 'tracked\n');
        writeFileSync(path.join(mirrorRoot, 'node_modules', 'pkg', 'index.js'), 'console.log(1);\n');
        writeFileSync(path.join(mirrorRoot, 'sub', 'cache.tmp'), 'tmp\n');
        writeFileSync(path.join(mirrorRoot, 'sub', 'keep.txt'), 'keep\n');

        const initResult = spawnSync('git', ['init', '-q', repoRoot], {
            encoding: 'utf8',
        });
        assert.equal(initResult.status, 0, initResult.stderr || initResult.stdout);

        const checkResult = spawnSync(
            'git',
            ['-C', repoRoot, 'check-ignore', '--stdin'],
            {
                encoding: 'utf8',
                input: [
                    'node_modules/pkg/index.js',
                    'sub/cache.tmp',
                    'sub/keep.txt',
                    '',
                ].join('\n'),
            }
        );

        assert.equal(checkResult.status, 0, checkResult.stderr || checkResult.stdout);
        assert.deepEqual(
            checkResult.stdout.trim().split(/\r?\n/u),
            ['node_modules/pkg/index.js', 'sub/cache.tmp']
        );
    } finally {
        rmSync(tempRoot, {recursive: true, force: true});
    }
});
