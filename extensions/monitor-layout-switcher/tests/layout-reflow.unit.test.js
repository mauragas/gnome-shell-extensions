import test from 'node:test';
import assert from 'node:assert/strict';

import {
    ERROR_CODES,
    buildPlan,
    validatePlan,
    normalizeLayout,
} from '../lib/display-plan.js';

import {
    mode,
    monitor,
    state,
    xorgPhysicalState,
    waylandLogicalState,
    allScreensLayout,
    leftLaptopLayout,
    threeExternalLayout,
} from './fixtures/display-fixtures.js';

function assertValidPlan(result, caps, label = '') {
    assert.equal(result.ok, true,
        `${label} failed: ${result.error?.code} ${result.error?.message}`);

    const validation = validatePlan(result.plan, caps);
    assert.equal(validation.ok, true,
        `${label} invalid: ${validation.code} ${validation.message}`);

    const primaries = result.plan.monitors.filter(item => item.isPrimary);
    assert.equal(primaries.length, 1, `${label} has ${primaries.length} primaries`);

    const connectors = result.plan.monitors.map(item => item.connector);
    assert.equal(new Set(connectors).size, connectors.length,
        `${label} resolved the same connector twice`);

    const minX = Math.min(...result.plan.monitors.map(item => item.x));
    const minY = Math.min(...result.plan.monitors.map(item => item.y));
    assert.equal(minX, 0, `${label} min x is ${minX}`);
    assert.equal(minY, 0, `${label} min y is ${minY}`);
}

test('exact replay preserves saved geometry when modes are available', () => {
    const result = buildPlan(leftLaptopLayout, waylandLogicalState);
    assertValidPlan(result, waylandLogicalState.capabilities, 'Left + Laptop');

    const byConnector = new Map(result.plan.monitors.map(item => [item.connector, item]));

    assert.deepEqual(
        {x: byConnector.get('DP-10').x, y: byConnector.get('DP-10').y},
        {x: 0, y: 0});
    assert.deepEqual(
        {x: byConnector.get('eDP-1').x, y: byConnector.get('eDP-1').y},
        {x: 345, y: 1440});
});

test('Xorg reflow of "All screens" restores adjacency after the mode grows', () => {
    const result = buildPlan(allScreensLayout, xorgPhysicalState);
    assertValidPlan(result, xorgPhysicalState.capabilities, 'All screens');

    const byConnector = new Map(result.plan.monitors.map(item => [item.connector, item]));

    // DP-10 -> DisplayPort-8, DP-8 -> DisplayPort-7, DP-7 -> DisplayPort-6,
    // eDP-1 -> eDP. DP-8 grows from 2880x1620 to 3840x2160, so the rotated
    // monitor to its right is pushed out by the difference.
    assert.equal(byConnector.get('DisplayPort-8').size.width, 2560);
    assert.equal(byConnector.get('DisplayPort-7').size.width, 3840);
    assert.deepEqual(
        {x: byConnector.get('DisplayPort-8').x, y: byConnector.get('DisplayPort-8').y},
        {x: 0, y: 203});
    assert.deepEqual(
        {x: byConnector.get('DisplayPort-7').x, y: byConnector.get('DisplayPort-7').y},
        {x: 2560, y: 600});
    assert.deepEqual(
        {x: byConnector.get('DisplayPort-6').x, y: byConnector.get('DisplayPort-6').y},
        {x: 6400, y: 0});
    assert.deepEqual(
        {x: byConnector.get('eDP').x, y: byConnector.get('eDP').y},
        {x: 640, y: 1643});
});

test('Xorg reflow of "3 external screens" stays overlap-free', () => {
    const result = buildPlan(threeExternalLayout, xorgPhysicalState);
    assertValidPlan(result, xorgPhysicalState.capabilities, '3 external screens');

    const byConnector = new Map(result.plan.monitors.map(item => [item.connector, item]));

    assert.deepEqual(
        {x: byConnector.get('DisplayPort-8').x, y: byConnector.get('DisplayPort-8').y},
        {x: 0, y: 701});
    assert.deepEqual(
        {x: byConnector.get('DisplayPort-7').x, y: byConnector.get('DisplayPort-7').y},
        {x: 2560, y: 515});
    assert.deepEqual(
        {x: byConnector.get('DisplayPort-6').x, y: byConnector.get('DisplayPort-6').y},
        {x: 6400, y: 0});
});

test('single-monitor layouts are placed at the origin', () => {
    const singleState = state({
        renderer: 'xrandr',
        layoutMode: 2,
        globalScaleRequired: true,
        monitors: [
            monitor({
                connector: 'HDMI-A-1',
                vendor: 'TST',
                product: 'TV',
                serial: 'S1',
                modes: [mode('1920x1080@60.000', [1])],
            }),
        ],
    });

    const layout = {
        monitors: [{
            connector: 'HDMI-A-1',
            model: 'TV',
            mode: '1920x1080@60.000',
            x: 500,
            y: 900,
            isPrimary: true,
        }],
    };

    const result = buildPlan(layout, singleState);
    assertValidPlan(result, singleState.capabilities, 'single monitor');

    assert.deepEqual(
        {x: result.plan.monitors[0].x, y: result.plan.monitors[0].y},
        {x: 0, y: 0});
});

test('saved negative offsets are normalised to the origin', () => {
    const negativeState = state({
        renderer: 'xrandr',
        layoutMode: 2,
        globalScaleRequired: true,
        monitors: [
            monitor({
                connector: 'DP-1',
                vendor: 'TST',
                product: 'A',
                serial: 'A1',
                modes: [mode('1920x1080@60.000', [1])],
                x: 0,
                y: 0,
                isPrimary: true,
            }),
            monitor({
                connector: 'DP-2',
                vendor: 'TST',
                product: 'B',
                serial: 'B1',
                modes: [mode('1920x1080@60.000', [1])],
                x: 1920,
                y: 0,
            }),
        ],
    });

    const layout = {
        monitors: [
            {
                connector: 'DP-1',
                model: 'A',
                mode: '1920x1080@60.000',
                x: -1920,
                y: -200,
                isPrimary: true,
            },
            {
                connector: 'DP-2',
                model: 'B',
                mode: '1920x1080@60.000',
                x: 0,
                y: -200,
            },
        ],
    };

    const result = buildPlan(layout, negativeState);
    assertValidPlan(result, negativeState.capabilities, 'negative offsets');
});

test('disconnected saved arrangements are repaired', () => {
    const gapState = state({
        renderer: 'xrandr',
        layoutMode: 2,
        globalScaleRequired: true,
        monitors: [
            monitor({
                connector: 'DP-1',
                vendor: 'TST',
                product: 'A',
                serial: 'A1',
                modes: [mode('1920x1080@60.000', [1])],
                isPrimary: true,
            }),
            monitor({
                connector: 'DP-2',
                vendor: 'TST',
                product: 'B',
                serial: 'B1',
                modes: [mode('1920x1080@60.000', [1])],
            }),
            monitor({
                connector: 'DP-3',
                vendor: 'TST',
                product: 'C',
                serial: 'C1',
                modes: [mode('1920x1080@60.000', [1])],
            }),
        ],
    });

    // A floating monitor with no shared edge.
    const layout = {
        monitors: [
            {
                connector: 'DP-1',
                model: 'A',
                mode: '1920x1080@60.000',
                x: 0,
                y: 0,
                isPrimary: true,
            },
            {
                connector: 'DP-2',
                model: 'B',
                mode: '1920x1080@60.000',
                x: 1920,
                y: 0,
            },
            {
                connector: 'DP-3',
                model: 'C',
                mode: '1920x1080@60.000',
                x: 6000,
                y: 4000,
            },
        ],
    };

    const result = buildPlan(layout, gapState);
    assertValidPlan(result, gapState.capabilities, 'disconnected layout');
});

test('layouts without a primary still produce exactly one primary', () => {
    const noPrimaryState = state({
        renderer: 'xrandr',
        layoutMode: 2,
        globalScaleRequired: true,
        monitors: [
            monitor({
                connector: 'DP-1',
                vendor: 'TST',
                product: 'A',
                serial: 'A1',
                modes: [mode('1920x1080@60.000', [1])],
            }),
            monitor({
                connector: 'DP-2',
                vendor: 'TST',
                product: 'B',
                serial: 'B1',
                modes: [mode('1920x1080@60.000', [1])],
            }),
        ],
    });

    const layout = {
        monitors: [
            {connector: 'DP-1', model: 'A', mode: '1920x1080@60.000', x: 0, y: 0},
            {connector: 'DP-2', model: 'B', mode: '1920x1080@60.000', x: 1920, y: 0},
        ],
    };

    const result = buildPlan(layout, noPrimaryState);
    assertValidPlan(result, noPrimaryState.capabilities, 'no saved primary');
});

test('missing monitors fail before any D-Bus call', () => {
    const emptyState = {
        ...xorgPhysicalState,
        monitors: [],
    };

    const result = buildPlan(allScreensLayout, emptyState);

    assert.equal(result.ok, false);
    assert.equal(result.error.code, ERROR_CODES.MONITOR_MISSING);
});

// ── Property-style reflow checks ────────────────────────────────────────────

function createRandom(seed) {
    let value = seed;

    return () => {
        value = (value * 1664525 + 1013904223) % 4294967296;
        return value / 4294967296;
    };
}

const MODE_POOL = [
    '1280x720@60.000',
    '1920x1080@60.000',
    '2560x1440@59.951',
    '3840x2160@59.997',
];

function buildRandomCase(random) {
    const count = 2 + Math.floor(random() * 3);
    const columns = 1 + Math.floor(random() * count);
    const monitors = [];
    const layoutMonitors = [];
    const sizes = [];

    for (let i = 0; i < count; i++) {
        const savedModeId = MODE_POOL[Math.floor(random() * MODE_POOL.length)];
        const parsed = normalizeLayout({
            monitors: [{connector: 'X', mode: savedModeId}],
        }).monitors[0].modeHint;

        const rotate = random() < 0.25;
        const width = rotate ? parsed.height : parsed.width;
        const height = rotate ? parsed.width : parsed.height;

        sizes.push({savedModeId, rotate, width, height});
    }

    const firstRowHeight = Math.max(...sizes.slice(0, columns).map(size => size.height));

    let firstRowX = 0;
    let secondRowX = 0;

    for (let i = 0; i < count; i++) {
        const {savedModeId, rotate, width, height} = sizes[i];
        const secondRow = i >= columns;
        const x = secondRow ? secondRowX : firstRowX;
        const y = secondRow ? firstRowHeight : 0;

        if (secondRow)
            secondRowX += width;
        else
            firstRowX += width;

        const connector = `DP-${i + 1}`;
        const product = `P${i}`;

        monitors.push(monitor({
            connector,
            vendor: 'TST',
            product,
            serial: `S${i}`,
            modes: MODE_POOL
                .filter(() => random() < 0.7)
                .map(id => mode(id, [1]))
                .concat([mode(savedModeId, [1])])
                .filter((item, index, list) =>
                    list.findIndex(other => other.id === item.id) === index),
            currentMode: savedModeId,
            transform: rotate ? 1 : 0,
            isPrimary: i === 0,
            x,
            y,
        }));

        layoutMonitors.push({
            connector,
            model: product,
            mode: savedModeId,
            transform: rotate ? 1 : 0,
            scale: 1,
            x,
            y,
            isPrimary: i === 0,
        });
    }

    return {
        state: state({
            renderer: 'xrandr',
            layoutMode: 2,
            globalScaleRequired: true,
            monitors,
        }),
        layout: {id: 'random', name: `Random ${count}`, monitors: layoutMonitors},
    };
}

test('reflow always produces a valid plan across randomised inputs', () => {
    const random = createRandom(20261021);

    for (let iteration = 0; iteration < 150; iteration++) {
        const {state: randomState, layout} = buildRandomCase(random);
        const result = buildPlan(layout, randomState);

        assertValidPlan(result, randomState.capabilities, `random case ${iteration}`);
    }
});

test('reflow survives when only a single small mode is available', () => {
    const limitedState = state({
        renderer: 'xrandr',
        layoutMode: 2,
        globalScaleRequired: true,
        monitors: [
            monitor({
                connector: 'DP-1',
                vendor: 'TST',
                product: 'A',
                serial: 'A1',
                modes: [mode('1280x720@60.000', [1])],
                isPrimary: true,
            }),
            monitor({
                connector: 'DP-2',
                vendor: 'TST',
                product: 'B',
                serial: 'B1',
                modes: [mode('1280x720@60.000', [1])],
            }),
            monitor({
                connector: 'DP-3',
                vendor: 'TST',
                product: 'C',
                serial: 'C1',
                modes: [mode('1280x720@60.000', [1])],
            }),
        ],
    });

    const layout = {
        monitors: [
            {connector: 'DP-1', model: 'A', mode: '3840x2160@59.997', x: 0, y: 0, isPrimary: true},
            {connector: 'DP-2', model: 'B', mode: '2560x1440@59.951', x: 3840, y: 0},
            {connector: 'DP-3', model: 'C', mode: '1920x1080@60.000', x: 6400, y: 0},
        ],
    };

    const result = buildPlan(layout, limitedState);
    assertValidPlan(result, limitedState.capabilities, 'limited modes');

    for (const planned of result.plan.monitors)
        assert.equal(planned.mode, '1280x720@60.000');
});
