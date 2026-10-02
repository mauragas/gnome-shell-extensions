import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

Gio._promisify(Gio.Subprocess.prototype, 'communicate_utf8_async', 'communicate_utf8_finish');

function uniqueExistingDirectoryPaths(paths) {
    const uniquePaths = [];
    const seen = new Set();

    for (const path of Array.isArray(paths) ? paths : []) {
        if (typeof path !== 'string' || !path.trim())
            continue;

        const normalizedPath = path.trim();
        if (seen.has(normalizedPath))
            continue;
        if (!GLib.file_test(normalizedPath, GLib.FileTest.IS_DIR))
            continue;

        seen.add(normalizedPath);
        uniquePaths.push(normalizedPath);
    }

    return uniquePaths;
}

function normalizeRelativePath(relativePath) {
    if (typeof relativePath !== 'string')
        return '';

    return relativePath
        .trim()
        .replace(/^\.\//u, '')
        .replace(/^\/+/, '')
        .replace(/\/+$/u, '');
}

function parseNullSeparatedPaths(text) {
    if (typeof text !== 'string' || !text)
        return [];

    return text
        .split('\u0000')
        .map(path => normalizeRelativePath(path))
        .filter(Boolean);
}

function parseLineSeparatedPaths(text) {
    if (typeof text !== 'string' || !text)
        return [];

    return text
        .split(/\r?\n/u)
        .map(path => normalizeRelativePath(path))
        .filter(Boolean);
}

function uniqueRelativePaths(paths) {
    const uniquePaths = [];
    const seen = new Set();

    for (const path of Array.isArray(paths) ? paths : []) {
        const normalizedPath = normalizeRelativePath(path);
        if (!normalizedPath || seen.has(normalizedPath))
            continue;

        seen.add(normalizedPath);
        uniquePaths.push(normalizedPath);
    }

    return uniquePaths;
}

async function runGitProcess(argv, {cwd = GLib.get_home_dir(), input = null} = {}) {
    const launcher = new Gio.SubprocessLauncher({
        flags: (input !== null
            ? Gio.SubprocessFlags.STDIN_PIPE
            : Gio.SubprocessFlags.NONE) |
            Gio.SubprocessFlags.STDOUT_PIPE |
            Gio.SubprocessFlags.STDERR_PIPE,
    });
    launcher.set_cwd(cwd);

    const process = launcher.spawnv(argv);
    const [, stdout, stderr] = await process.communicate_utf8_async(input, null);
    const exited = process.get_if_exited();
    const exitStatus = exited
        ? process.get_exit_status()
        : -1;

    return {
        ok: exited && exitStatus === 0,
        exitStatus,
        stdout: stdout ?? '',
        stderr: stderr ?? '',
    };
}

async function isGitWorkingTree(rootPath) {
    const result = await runGitProcess([
        'git',
        '-C',
        rootPath,
        'rev-parse',
        '--show-toplevel',
    ]);

    return result.ok;
}

async function listIgnoredRelativePathsFromReference(referenceRootPath) {
    const result = await runGitProcess([
        'git',
        '-C',
        referenceRootPath,
        'ls-files',
        '-z',
        '--others',
        '-i',
        '--exclude-standard',
        '--directory',
        '--no-empty-directory',
    ]);

    if (!result.ok)
        throw new Error(result.stderr.trim() || result.stdout.trim() || 'Failed to enumerate ignored files with git ls-files.');

    return uniqueRelativePaths(parseNullSeparatedPaths(result.stdout));
}

function enumerateDirectoryChildren(directoryPath) {
    const directory = Gio.File.new_for_path(directoryPath);
    const children = [];
    let enumerator = null;

    try {
        enumerator = directory.enumerate_children(
            'standard::name,standard::type',
            Gio.FileQueryInfoFlags.NONE,
            null
        );

        let info;
        while ((info = enumerator.next_file(null)) !== null) {
            children.push({
                name: info.get_name(),
                isDirectory: info.get_file_type() === Gio.FileType.DIRECTORY,
            });
        }
    } finally {
        enumerator?.close(null);
    }

    return children;
}

async function checkIgnoredRelativePaths(referenceRootPath, relativePaths) {
    if (!Array.isArray(relativePaths) || relativePaths.length === 0)
        return new Set();

    const result = await runGitProcess([
        'git',
        '-C',
        referenceRootPath,
        'check-ignore',
        '--stdin',
    ], {
        input: `${relativePaths.join('\n')}\n`,
    });

    if (!result.ok && result.exitStatus !== 1) {
        throw new Error(result.stderr.trim() || result.stdout.trim() || 'Failed to evaluate git ignore rules.');
    }

    return new Set(parseLineSeparatedPaths(result.stdout));
}

export async function resolveGitIgnoreReferenceRoot(candidatePaths) {
    for (const rootPath of uniqueExistingDirectoryPaths(candidatePaths)) {
        if (await isGitWorkingTree(rootPath))
            return rootPath;
    }

    return null;
}

export async function listIgnoredRelativePathsForTree(referenceRootPath, targetRootPath) {
    if (!referenceRootPath || !targetRootPath)
        return [];

    if (referenceRootPath === targetRootPath)
        return listIgnoredRelativePathsFromReference(referenceRootPath);

    const ignoredPaths = [];
    const stack = [''];

    while (stack.length > 0) {
        const parentRelativePath = stack.pop();
        const parentDirectoryPath = parentRelativePath
            ? GLib.build_filenamev([targetRootPath, ...parentRelativePath.split('/')])
            : targetRootPath;
        const children = enumerateDirectoryChildren(parentDirectoryPath);
        const probes = [];
        const childMetadata = [];

        for (const child of children) {
            if (child.name === '.git')
                continue;

            const relativePath = parentRelativePath
                ? `${parentRelativePath}/${child.name}`
                : child.name;
            const probePath = child.isDirectory
                ? `${relativePath}/`
                : relativePath;
            probes.push(probePath);
            childMetadata.push({
                relativePath,
                probePath,
                isDirectory: child.isDirectory,
            });
        }

        const ignoredProbeSet = await checkIgnoredRelativePaths(referenceRootPath, probes);
        for (const child of childMetadata) {
            const isIgnored = ignoredProbeSet.has(child.probePath) ||
                ignoredProbeSet.has(child.relativePath);
            if (isIgnored) {
                ignoredPaths.push(child.relativePath);
                continue;
            }

            if (child.isDirectory)
                stack.push(child.relativePath);
        }
    }

    return uniqueRelativePaths(ignoredPaths);
}

export function createGitIgnoredExcludeRules(relativePaths) {
    return uniqueRelativePaths(relativePaths).map(relativePath => ({
        type: 'path',
        pattern: relativePath,
    }));
}
