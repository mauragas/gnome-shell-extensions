import {execFileSync} from 'node:child_process';
import {mkdirSync, rmSync, writeFileSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const EXTENSION_UUID = 'razer-keyboard-rgb-control';
const BRIDGE_DESTINATION = 'org.gnome.Shell';
const BRIDGE_OBJECT_PATH = '/org/gnome/Shell/Extensions/RazerRgbControl/TestBridge';
const BRIDGE_INTERFACE = 'org.gnome.Shell.Extensions.RazerRgbControl.TestBridge';
const BRIDGE_SENTINEL_PATH = path.join(
    os.homedir(),
    '.cache',
    'rrc-ui-test-bridge.enabled'
);
const DEFAULT_TIMEOUT_MS = 20000;

function runCommand(command, args, {timeout = DEFAULT_TIMEOUT_MS} = {}) {
    return execFileSync(command, args, {
        encoding: 'utf8',
        timeout,
        env: process.env,
    }).trim();
}

function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function getExtensionInfo() {
    return runCommand('gnome-extensions', ['info', EXTENSION_UUID]);
}

function isExtensionActive() {
    const info = getExtensionInfo();
    const enabled = info.match(/^\s*Enabled:\s+(Yes|No)$/m)?.[1];
    const state = info.match(/^\s*State:\s+(.+)$/m)?.[1]?.trim();
    return enabled === 'Yes' && state === 'ACTIVE';
}

function reloadExtension() {
    try {
        runCommand('gnome-extensions', ['disable', EXTENSION_UUID]);
    } catch {
        // Disabling a not-currently-enabled extension is fine here.
    }

    runCommand('gnome-extensions', ['enable', EXTENSION_UUID]);
}

function extractVariantString(output) {
    const trimmed = output.trim();
    if (!trimmed.startsWith('(') || !trimmed.endsWith(')'))
        throw new Error(`Unexpected gdbus output: ${output}`);

    const tupleBody = trimmed.slice(1, -1).replace(/,\s*$/, '');
    const quote = tupleBody[0];
    if (quote !== '\'' && quote !== '"')
        throw new Error(`Expected a quoted bridge payload, got: ${output}`);

    const lastQuote = tupleBody.lastIndexOf(quote);
    if (lastQuote <= 0)
        throw new Error(`Could not parse bridge payload: ${output}`);

    return tupleBody.slice(1, lastQuote);
}

function decodeBridgePayload(output) {
    const encoded = extractVariantString(output);
    const jsonText = Buffer.from(encoded, 'base64').toString('utf8');
    return JSON.parse(jsonText);
}

function callBridge(method, args = [], {timeout = DEFAULT_TIMEOUT_MS} = {}) {
    const output = runCommand(
        'gdbus',
        [
            'call',
            '--session',
            '--dest', BRIDGE_DESTINATION,
            '--object-path', BRIDGE_OBJECT_PATH,
            '--method', `${BRIDGE_INTERFACE}.${method}`,
            ...args.map(String),
        ],
        {timeout}
    );

    return decodeBridgePayload(output);
}

async function waitForBridge() {
    let lastError = null;
    for (let attempt = 0; attempt < 20; attempt++) {
        try {
            const payload = callBridge('Ping');
            if (payload?.ok === true)
                return;
        } catch (error) {
            lastError = error;
        }

        await delay(250);
    }

    throw new Error(
        `Timed out waiting for the RRC test bridge to appear: ${lastError?.message ?? 'unknown error'}`
    );
}

export function createUiBridgeHarness() {
    let bridgeReady = false;
    let extensionWasActive = false;

    async function ensureBridge() {
        if (bridgeReady)
            return;

        extensionWasActive = isExtensionActive();
        if (!extensionWasActive) {
            throw new Error(
                `${EXTENSION_UUID} is not active in the current GNOME session. Install and enable the extension before running UI smoke tests.`
            );
        }

        mkdirSync(path.dirname(BRIDGE_SENTINEL_PATH), {recursive: true});
        writeFileSync(BRIDGE_SENTINEL_PATH, 'enabled\n', 'utf8');
        reloadExtension();
        await waitForBridge();
        bridgeReady = true;
    }

    return {
        async ping() {
            await ensureBridge();
            return callBridge('Ping');
        },
        async refreshBackendState() {
            await ensureBridge();
            return callBridge('RefreshBackendState', [], {
                timeout: DEFAULT_TIMEOUT_MS * 2,
            });
        },
        async getBackendSnapshot() {
            await ensureBridge();
            return callBridge('GetBackendSnapshot');
        },
        async openMenu() {
            await ensureBridge();
            callBridge('OpenMenu');
            await delay(150);
            return this.getUiSnapshot();
        },
        async closeMenu() {
            await ensureBridge();
            callBridge('CloseMenu');
            await delay(150);
            return this.getUiSnapshot();
        },
        async openControlPad() {
            await ensureBridge();
            callBridge('OpenControlPad', [], {
                timeout: DEFAULT_TIMEOUT_MS * 2,
            });
            await delay(150);
            return this.getUiSnapshot();
        },
        async closeControlPad() {
            await ensureBridge();
            callBridge('CloseControlPad');
            await delay(150);
            return this.getUiSnapshot();
        },
        async getUiSnapshot() {
            await ensureBridge();
            return callBridge('GetUiSnapshot');
        },
        async cleanup() {
            try {
                if (bridgeReady) {
                    try {
                        callBridge('CloseControlPad');
                    } catch {
                        // Ignore teardown errors while cleaning up.
                    }

                    try {
                        callBridge('CloseMenu');
                    } catch {
                        // Ignore teardown errors while cleaning up.
                    }
                }
            } finally {
                rmSync(BRIDGE_SENTINEL_PATH, {force: true});

                if (extensionWasActive) {
                    try {
                        reloadExtension();
                    } catch {
                        // Best-effort bridge teardown.
                    }
                }

                bridgeReady = false;
            }
        },
    };
}
