import test from 'node:test';
import assert from 'node:assert/strict';

import {
    PLAN_SCHEMA_VERSION,
    LAYOUT_MODE_LOGICAL,
    LAYOUT_MODE_PHYSICAL,
    COMPATIBILITY,
    ERROR_CODES,
    parseModeId,
    renderedModeSize,
    rectSizeForMode,
    connectorsLooselyMatch,
    normalizeLayout,
    createLayoutFromState,
    resolveIdentities,
    resolveMode,
    resolveScales,
    buildPlan,
    validatePlan,
    toLogicalMonitorTuples,
    layoutMatchesState,
    layoutPreviewRects,
    statePreviewRects,
    fitPreviewRects,
    describeDegraded,
    describeLayoutCompatibility,
    formatPlanError,
    explainDbusError,
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
    savedLayouts,
} from './fixtures/display-fixtures.js';

test('parseModeId parses Mutter mode ids', () => {
    assert.deepEqual(parseModeId('2560x1440@59.951'),
        {width: 2560, height: 1440, rate: 59.951});
    assert.equal(parseModeId('not-a-mode'), null);
    assert.equal(parseModeId(undefined), null);
});

test('renderedModeSize rejects unusable modes instead of guessing', () => {
    assert.equal(renderedModeSize('not-a-mode'), null);
    assert.equal(renderedModeSize('0x1080@60.000'), null);
    assert.equal(renderedModeSize(null), null);
    assert.equal(renderedModeSize({id: 'x'}), null);
    assert.equal(rectSizeForMode('not-a-mode', 0, 1, LAYOUT_MODE_LOGICAL), null);
});

test('renderedModeSize applies every rotated transform', () => {
    assert.deepEqual(renderedModeSize('2560x1440@60.000', 0), {width: 2560, height: 1440});
    assert.deepEqual(renderedModeSize('2560x1440@60.000', 1), {width: 1440, height: 2560});
    assert.deepEqual(renderedModeSize('2560x1440@60.000', 3), {width: 1440, height: 2560});
    assert.deepEqual(renderedModeSize('2560x1440@60.000', 5), {width: 1440, height: 2560});
    assert.deepEqual(renderedModeSize('2560x1440@60.000', 7), {width: 1440, height: 2560});
    assert.deepEqual(renderedModeSize('2560x1440@60.000', 2), {width: 2560, height: 1440});
});

test('rectSizeForMode ignores scale in PHYSICAL layout mode', () => {
    assert.deepEqual(
        rectSizeForMode('3840x2160@60.000', 0, 2, LAYOUT_MODE_LOGICAL),
        {width: 1920, height: 1080});
    assert.deepEqual(
        rectSizeForMode('3840x2160@60.000', 0, 2, LAYOUT_MODE_PHYSICAL),
        {width: 3840, height: 2160});
});

test('connectorsLooselyMatch handles back-end naming differences', () => {
    assert.equal(connectorsLooselyMatch('DP-7', 'DisplayPort-7'), true);
    assert.equal(connectorsLooselyMatch('eDP-1', 'eDP'), true);
    assert.equal(connectorsLooselyMatch('HDMI-A-1', 'HDMI-1'), true);
    assert.equal(connectorsLooselyMatch('DVI-I-1', 'DVI-1'), true);
    assert.equal(connectorsLooselyMatch('DP-7', 'DP-8'), false);
    assert.equal(connectorsLooselyMatch('DP-7', 'eDP-1'), false);
    assert.equal(connectorsLooselyMatch(null, 'DP-7'), false);
});

test('normalizeLayout upgrades schema v1 layouts', () => {
    const normalized = normalizeLayout(allScreensLayout);
    const dell = normalized.monitors.find(item => item.savedConnector === 'DP-8');

    assert.equal(normalized.schemaVersion, PLAN_SCHEMA_VERSION);
    assert.deepEqual(dell.identity,
        {vendor: null, product: 'DELL U3219Q', serial: null});
    assert.deepEqual(dell.modeHint,
        {width: 2880, height: 1620, rate: 59.975});
    assert.deepEqual(dell.preferredSize, {width: 2880, height: 1620});
    assert.deepEqual(dell.layout, {x: 2560, y: 600, isPrimary: true});
});

test('normalizeLayout is idempotent', () => {
    const once = normalizeLayout(allScreensLayout);
    const twice = normalizeLayout(once);

    assert.deepEqual(twice, once);
});

test('normalizeLayout keeps rotated preferred sizes', () => {
    const normalized = normalizeLayout(allScreensLayout);
    const rotated = normalized.monitors.find(item => item.savedConnector === 'DP-7');

    assert.deepEqual(rotated.preferredSize, {width: 1440, height: 2560});
});

test('resolveIdentities prefers EDID identity over connector numbering', () => {
    const ambiguousState = state({
        renderer: 'xrandr',
        layoutMode: 2,
        globalScaleRequired: true,
        monitors: [
            monitor({
                connector: 'DP-7',
                vendor: 'LEN',
                product: 'P27q-20',
                serial: 'SN-P27Q-0001',
            }),
            monitor({
                connector: 'DisplayPort-7',
                vendor: 'DEL',
                product: 'DELL U3219Q',
                serial: 'SN-U3219Q-0001',
            }),
        ],
    });

    const layout = {
        monitors: [{
            connector: 'DP-7',
            vendor: 'LEN',
            product: 'P27q-20',
            serial: 'SN-P27Q-0001',
            mode: '1920x1080@60.000',
            x: 0,
            y: 0,
            isPrimary: true,
        }],
    };

    const {resolved, missing} = resolveIdentities(normalizeLayout(layout), ambiguousState);

    assert.equal(missing.length, 0);
    assert.equal(resolved[0].connector, 'DP-7');
});

test('resolveIdentities resolves renamed connectors by EDID', () => {
    const layout = {
        monitors: [{
            connector: 'DP-9',
            model: 'P27h-20',
            vendor: 'LEN',
            serial: 'SN-P27H-0001',
            mode: '2560x1440@59.951',
            x: 0,
            y: 0,
            isPrimary: true,
        }],
    };

    const {resolved, missing} = resolveIdentities(normalizeLayout(layout), xorgPhysicalState);

    assert.equal(missing.length, 0);
    assert.equal(resolved[0].connector, 'DisplayPort-8');
});

test('resolveIdentities disambiguates identical products by serial', () => {
    const twinState = state({
        renderer: 'xrandr',
        layoutMode: 2,
        globalScaleRequired: true,
        monitors: [
            monitor({
                connector: 'DP-1',
                vendor: 'LEN',
                product: 'P27h-20',
                serial: 'SERIAL-A',
            }),
            monitor({
                connector: 'DP-2',
                vendor: 'LEN',
                product: 'P27h-20',
                serial: 'SERIAL-B',
            }),
        ],
    });

    const layout = {
        monitors: [{
            connector: 'DP-9',
            vendor: 'LEN',
            product: 'P27h-20',
            serial: 'SERIAL-B',
            mode: '1920x1080@60.000',
            x: 0,
            y: 0,
            isPrimary: true,
        }],
    };

    const {resolved} = resolveIdentities(normalizeLayout(layout), twinState);

    assert.equal(resolved[0].connector, 'DP-2');
});

test('resolveIdentities reports missing monitors', () => {
    const layout = {
        monitors: [{
            connector: 'DP-99',
            vendor: 'XXX',
            product: 'NOPE',
            serial: 'NONE',
            mode: '1920x1080@60.000',
            x: 0,
            y: 0,
            isPrimary: true,
        }],
    };

    const {resolved, missing} = resolveIdentities(normalizeLayout(layout), xorgPhysicalState);

    assert.equal(resolved[0], null);
    assert.equal(missing.length, 1);
});

test('resolveIdentities matches identical monitors in connector order', () => {
    const twinState = state({
        renderer: 'xrandr',
        layoutMode: 2,
        globalScaleRequired: true,
        monitors: [
            monitor({
                connector: 'DP-4',
                vendor: 'LEN',
                product: 'P27h-20',
                serial: '0x00000000',
            }),
            monitor({
                connector: 'DP-3',
                vendor: 'LEN',
                product: 'P27h-20',
                serial: '0x00000000',
            }),
        ],
    });

    const layout = {
        monitors: [
            {connector: 'DP-1', model: 'P27h-20', mode: '1920x1080@60.000'},
            {connector: 'DP-2', model: 'P27h-20', mode: '1920x1080@60.000'},
        ],
    };

    const {resolved, missing} = resolveIdentities(normalizeLayout(layout), twinState);

    assert.equal(missing.length, 0);
    assert.deepEqual(resolved.map(item => item.connector), ['DP-3', 'DP-4']);
});

test('resolveMode prefers exact ids, then size, then aspect', () => {
    const stateMonitor = monitor({
        connector: 'DP-1',
        vendor: 'TST',
        product: 'T',
        serial: 'S',
        modes: [
            mode('3840x2160@59.997', [1, 2]),
            mode('2560x1440@59.951', [1, 2]),
        ],
        currentMode: '2560x1440@59.951',
    });

    const exact = resolveMode(
        {savedModeId: '2560x1440@59.951', modeHint: parseModeId('2560x1440@59.951')},
        stateMonitor);
    assert.equal(exact.mode.id, '2560x1440@59.951');
    assert.equal(exact.degraded, false);

    const resized = resolveMode(
        {savedModeId: '3200x1800@59.956', modeHint: parseModeId('3200x1800@59.956')},
        stateMonitor);
    assert.equal(resized.mode.id, '3840x2160@59.997');
    assert.equal(resized.degraded, true);
    assert.equal(resized.reason, 'size-adjusted');
});

test('resolveMode falls back to the current mode when nothing matches', () => {
    const stateMonitor = monitor({
        connector: 'DP-1',
        vendor: 'TST',
        product: 'T',
        serial: 'S',
        modes: [mode('1920x1080@60.000', [1])],
        currentMode: '1920x1080@60.000',
    });

    const result = resolveMode(
        {savedModeId: '1280x720@60.000', modeHint: parseModeId('1280x720@60.000')},
        stateMonitor);

    assert.equal(result.mode.id, '1920x1080@60.000');
    assert.equal(result.degraded, true);
});

test('resolveScales clamps fractional scales in PHYSICAL layout mode', () => {
    const entries = [
        {
            saved: {layout: {isPrimary: true}, scale: 1.5},
            state: {connector: 'DP-1'},
            mode: mode('3840x2160@60.000', [1, 2]),
        },
    ];

    const degraded = resolveScales(entries, xorgPhysicalState.capabilities);

    assert.equal(entries[0].scale, 1);
    assert.equal(degraded[0].reason, 'scale-clamped');
});

test('resolveScales keeps per-monitor scales in LOGICAL layout mode', () => {
    const entries = [
        {
            saved: {layout: {isPrimary: true}, scale: 1.5},
            state: {connector: 'DP-1'},
            mode: mode('3840x2160@60.000', [1, 1.5, 2]),
        },
        {
            saved: {layout: {isPrimary: false}, scale: 2},
            state: {connector: 'DP-2'},
            mode: mode('3840x2160@60.000', [1, 1.5, 2]),
        },
    ];

    const degraded = resolveScales(entries, waylandLogicalState.capabilities);

    assert.equal(entries[0].scale, 1.5);
    assert.equal(entries[1].scale, 2);
    assert.equal(degraded.length, 0);
});

test('resolveScales forces a single scale when global scale is required', () => {
    const entries = [
        {
            saved: {layout: {isPrimary: true}, scale: 2},
            state: {connector: 'DP-1'},
            mode: mode('3840x2160@60.000', [1, 2]),
        },
        {
            saved: {layout: {isPrimary: false}, scale: 1},
            state: {connector: 'DP-2'},
            mode: mode('3840x2160@60.000', [1, 2]),
        },
    ];

    const caps = {
        ...waylandLogicalState.capabilities,
        globalScaleRequired: true,
        fractionalScaling: false,
    };
    resolveScales(entries, caps);

    assert.equal(entries[0].scale, entries[1].scale);
});

test('resolveScales picks a scale every monitor supports', () => {
    const entries = [
        {
            saved: {layout: {isPrimary: true}, scale: 1},
            state: {connector: 'DP-1'},
            mode: mode('3840x2160@60.000', [1, 2]),
        },
        {
            saved: {layout: {isPrimary: false}, scale: 1},
            state: {connector: 'DP-2'},
            // 100 % is not available on this monitor.
            mode: mode('3840x2160@60.000', [2]),
        },
    ];

    const degraded = resolveScales(entries, xorgPhysicalState.capabilities);

    assert.equal(entries[0].scale, 2);
    assert.equal(entries[1].scale, 2);
    assert.equal(degraded.length, 2);
});

test('buildPlan produces a valid plan for every saved layout on Xorg', () => {
    for (const layout of savedLayouts) {
        const result = buildPlan(layout, xorgPhysicalState);

        assert.equal(result.ok, true,
            `${layout.name} failed: ${result.error?.code} ${result.error?.message}`);
        assert.equal(validatePlan(result.plan, xorgPhysicalState.capabilities).ok, true,
            `${layout.name} produced an invalid plan`);

        const primaryCount = result.plan.monitors.filter(item => item.isPrimary).length;
        assert.equal(primaryCount, 1, `${layout.name} has ${primaryCount} primaries`);
    }
});

test('buildPlan adjusts the scaled mode that caused the Xorg failure', () => {
    const result = buildPlan(allScreensLayout, xorgPhysicalState);
    assert.equal(result.ok, true);

    const dell = result.plan.monitors.find(item => item.connector === 'DisplayPort-7');

    // 2880x1620 is a Wayland fractional-scaling mode and does not exist on Xorg.
    assert.equal(dell.mode, '3840x2160@59.997');
    assert.equal(dell.size.width, 3840);
    assert.equal(dell.size.height, 2160);

    const reasons = result.degraded.map(item => item.reason);
    assert.ok(reasons.includes('size-adjusted'));
    assert.equal(describeDegraded(result.degraded), 'resolution adjusted');
});

test('buildPlan reproduces saved geometry exactly on the original session', () => {
    const result = buildPlan(allScreensLayout, waylandLogicalState);
    assert.equal(result.ok, true);

    const planned = new Map(result.plan.monitors.map(item => [item.connector, item]));

    assert.deepEqual(
        {x: planned.get('DP-10').x, y: planned.get('DP-10').y},
        {x: 0, y: 203});
    assert.deepEqual(
        {x: planned.get('DP-7').x, y: planned.get('DP-7').y},
        {x: 5440, y: 0});
    assert.deepEqual(
        {x: planned.get('DP-8').x, y: planned.get('DP-8').y},
        {x: 2560, y: 600});
    assert.deepEqual(
        {x: planned.get('eDP-1').x, y: planned.get('eDP-1').y},
        {x: 640, y: 1643});
});

test('buildPlan reports a disconnected monitor instead of guessing', () => {
    const partialState = {
        ...xorgPhysicalState,
        monitors: xorgPhysicalState.monitors.filter(item => item.connector !== 'DisplayPort-6'),
    };

    const result = buildPlan(allScreensLayout, partialState);

    assert.equal(result.ok, false);
    assert.equal(result.error.code, ERROR_CODES.MONITOR_MISSING);
});

test('validatePlan mirrors Mutter rejection codes', () => {
    const caps = xorgPhysicalState.capabilities;
    const base = {
        connector: 'DP-1',
        mode: '1920x1080@60.000',
        transform: 0,
        scale: 1,
        size: {width: 1920, height: 1080},
        isPrimary: true,
    };

    const noPrimary = validatePlan({monitors: [{...base, isPrimary: false}]}, caps);
    assert.equal(noPrimary.code, ERROR_CODES.NO_PRIMARY);

    const multiplePrimary = validatePlan({
        monitors: [
            {...base, x: 0, y: 0},
            {...base, connector: 'DP-2', x: 1920, y: 0},
        ],
    }, caps);
    assert.equal(multiplePrimary.code, ERROR_CODES.MULTIPLE_PRIMARY);

    const overlap = validatePlan({
        monitors: [
            {...base, x: 0, y: 0},
            {...base, connector: 'DP-2', isPrimary: false, x: 100, y: 100},
        ],
    }, caps);
    assert.equal(overlap.code, ERROR_CODES.OVERLAP);

    const notAdjacent = validatePlan({
        monitors: [
            {...base, x: 0, y: 0},
            {...base, connector: 'DP-2', isPrimary: false, x: 5000, y: 0},
        ],
    }, caps);
    assert.equal(notAdjacent.code, ERROR_CODES.NOT_ADJACENT);

    const offset = validatePlan({
        monitors: [
            {...base, x: 100, y: 100},
            {...base, connector: 'DP-2', isPrimary: false, x: 2020, y: 100},
        ],
    }, caps);
    assert.equal(offset.code, ERROR_CODES.OFFSET);

    const fractional = validatePlan({
        monitors: [{...base, x: 0, y: 0, scale: 1.5, size: {width: 1280, height: 720}}],
    }, caps);
    assert.equal(fractional.code, ERROR_CODES.INVALID_SCALE);

    const modeMismatch = validatePlan({
        monitors: [{...base, x: 0, y: 0, size: {width: 1280, height: 720}}],
    }, caps);
    assert.equal(modeMismatch.code, ERROR_CODES.MODE_SIZE_MISMATCH);
});

test('toLogicalMonitorTuples emits the D-Bus shape', () => {
    const result = buildPlan(leftLaptopLayout, xorgPhysicalState);
    const tuples = toLogicalMonitorTuples(result.plan);

    assert.equal(tuples.length, 2);
    assert.deepEqual(tuples[0].slice(0, 5), [
        result.plan.monitors[0].x,
        result.plan.monitors[0].y,
        result.plan.monitors[0].scale,
        result.plan.monitors[0].transform,
        result.plan.monitors[0].isPrimary,
    ]);
    assert.deepEqual(tuples[0][5], [[
        result.plan.monitors[0].connector,
        result.plan.monitors[0].mode,
        {},
    ]]);
});

test('layoutMatchesState compares resolved geometry, not saved coordinates', () => {
    assert.equal(layoutMatchesState(allScreensLayout, waylandLogicalState), true);

    const moved = {
        ...waylandLogicalState,
        monitors: waylandLogicalState.monitors.map(item =>
            item.connector === 'DP-8' ? {...item, x: item.x + 100} : item),
    };

    assert.equal(layoutMatchesState(allScreensLayout, moved), false);
});

test('layoutMatchesState is false when a monitor is not active', () => {
    assert.equal(layoutMatchesState(allScreensLayout, xorgPhysicalState), false);
});

test('layoutMatchesState is false when the primary monitor differs', () => {
    const differentPrimary = {
        ...waylandLogicalState,
        monitors: waylandLogicalState.monitors.map(item => ({
            ...item,
            isPrimary: item.connector === 'DP-7',
        })),
    };

    assert.equal(layoutMatchesState(allScreensLayout, differentPrimary), false);
});

test('layoutMatchesState is false when the refresh rate differs', () => {
    const differentRate = {
        ...waylandLogicalState,
        monitors: waylandLogicalState.monitors.map(item =>
            item.connector === 'DP-7'
                ? {...item, mode: '2560x1440@60.000'}
                : item),
    };

    assert.equal(layoutMatchesState(allScreensLayout, differentRate), false);
});

test('formatPlanError and explainDbusError produce actionable text', () => {
    assert.match(
        formatPlanError({code: ERROR_CODES.NOT_ADJACENT, monitors: ['DP-1']},
            'All screens'),
        /All screens: layout cannot be arranged without gaps/);

    const notAdjacent = 'GDBus.Error:org.freedesktop.DBus.Error.InvalidArgs: ' +
        'Logical monitors not adjacent';
    assert.match(explainDbusError(notAdjacent), /different resolutions/);

    const stale = 'GDBus.Error:org.freedesktop.DBus.Error.AccessDenied: ' +
        'The requested configuration is based on stale information';
    assert.match(explainDbusError(stale), /try again/);

    assert.equal(explainDbusError('boom'), 'boom');
});

test('layoutPreviewRects draws saved geometry and labels', () => {
    const layout = normalizeLayout(allScreensLayout);
    const rects = layoutPreviewRects(layout);

    assert.equal(rects.length, layout.monitors.length);
    assert.deepEqual(
        rects.map(rect => [rect.x, rect.y]),
        layout.monitors.map(monitor => [monitor.layout.x, monitor.layout.y]));
    assert.equal(rects.filter(rect => rect.isPrimary).length, 1);
    assert.ok(rects.every(rect => rect.width > 0 && rect.height > 0));
});

test('statePreviewRects only draws active monitors in physical pixels', () => {
    const rects = statePreviewRects(xorgPhysicalState);

    assert.equal(rects.length,
        xorgPhysicalState.monitors.filter(monitor => monitor.active).length);
    assert.ok(rects.every(rect => rect.width > 0 && rect.height > 0));
    assert.equal(rects.filter(rect => rect.isPrimary).length, 1);

    // LOGICAL mode divides by the monitor scale.
    const logical = statePreviewRects(waylandLogicalState);
    const source = waylandLogicalState.monitors
        .find(item => item.connector === 'DP-7');
    const drawn = logical.find(rect => rect.label === source.product);

    assert.equal(drawn.width,
        Math.round(renderedModeSize(source.mode, source.transform).width /
            (source.scale || 1)));
});

test('describeDegraded summarises the applied adjustments', () => {
    assert.equal(describeDegraded([]), '');
    assert.match(describeDegraded([{reason: 'size-adjusted'}]),
        /resolution adjusted/);
    assert.match(describeDegraded([{reason: 'scale-clamped'}]),
        /resolution adjusted/);
    assert.match(describeDegraded([{reason: 'anything-else'}]),
        /adjusted for this session/);
});

test('buildPlan warns when the layout needs a disabled built-in panel', () => {
    const withLaptop = normalizeLayout(leftLaptopLayout);
    const result = buildPlan(withLaptop, xorgPhysicalState);

    assert.equal(result.ok, true);
    assert.ok(result.warnings.some(text => /built-in display/.test(text)));
});

test('explainDbusError explains a closed laptop lid', () => {
    const message = 'GDBus.Error:org.freedesktop.DBus.Error.InvalidArgs: ' +
        'Refusing to activate a closed laptop panel';

    assert.match(explainDbusError(message), /lid is closed/);
});

test('createLayoutFromState snapshots the live configuration as schema v2', () => {
    const layout = createLayoutFromState(waylandLogicalState, {name: 'Snapshot'});

    assert.equal(layout.name, 'Snapshot');
    assert.equal(layout.schemaVersion, PLAN_SCHEMA_VERSION);
    assert.equal(layout.monitors.length,
        waylandLogicalState.monitors.filter(monitor => monitor.active).length);

    const saved = layout.monitors.find(monitor => monitor.savedConnector === 'DP-8');
    assert.deepEqual(saved.identity, {
        vendor: 'DEL',
        product: 'DELL U3219Q',
        serial: 'SN-U3219Q-0001',
    });
    assert.equal(saved.savedModeId, '2880x1620@59.975');
    assert.deepEqual(saved.modeHint, {width: 2880, height: 1620, rate: 59.975});
    assert.deepEqual(saved.layout, {x: 2560, y: 600, isPrimary: true});

    // A snapshot taken on the same session must replay without adjustments.
    const result = buildPlan(layout, waylandLogicalState);
    assert.equal(result.ok, true);
    assert.deepEqual(result.degraded, []);
});

test('createLayoutFromState round-trips through normalizeLayout', () => {
    const layout = createLayoutFromState(xorgPhysicalState, {id: 'x', name: 'X'});
    const normalized = normalizeLayout(layout);

    assert.deepEqual(normalized, normalizeLayout(normalized));
    assert.equal(normalized.monitors.length, 3);
    assert.ok(normalized.monitors.every(monitor =>
        monitor.preferredSize.width > 0 && monitor.preferredSize.height > 0));
});

test('createLayoutFromState generates unique ids', () => {
    const first = createLayoutFromState(waylandLogicalState, {name: 'A'});
    const second = createLayoutFromState(waylandLogicalState, {name: 'B'});

    assert.match(first.id, /^layout-/);
    assert.notEqual(first.id, second.id);
});

test('describeLayoutCompatibility reports a status for every outcome', () => {
    const ready = describeLayoutCompatibility(
        createLayoutFromState(waylandLogicalState, {name: 'Snapshot'}),
        waylandLogicalState);
    assert.equal(ready.status, COMPATIBILITY.READY);
    assert.deepEqual(ready.details, []);

    const adjusted = describeLayoutCompatibility(allScreensLayout, xorgPhysicalState);
    assert.equal(adjusted.status, COMPATIBILITY.ADJUSTED);
    assert.ok(adjusted.details.length > 0);

    const warning = describeLayoutCompatibility(leftLaptopLayout, xorgPhysicalState);
    assert.equal(warning.status, COMPATIBILITY.WARNING);
    assert.ok(warning.details.some(text => /built-in display/.test(text)));

    const unavailable = describeLayoutCompatibility(allScreensLayout,
        {...xorgPhysicalState, monitors: []});
    assert.equal(unavailable.status, COMPATIBILITY.UNAVAILABLE);
    assert.match(unavailable.details[0], /MONITOR_MISSING/);

    const unknown = describeLayoutCompatibility(allScreensLayout, null);
    assert.equal(unknown.status, COMPATIBILITY.UNKNOWN);
});

test('fitPreviewRects scales rectangles into the available area', () => {
    const rects = [
        {x: 0, y: 0, width: 1920, height: 1080, isPrimary: true, label: 'A'},
        {x: 1920, y: 0, width: 1920, height: 1080, isPrimary: false, label: 'B'},
    ];
    const fitted = fitPreviewRects(rects, 200, 100, 10);

    assert.equal(fitted.length, 2);
    assert.equal(fitted[0].label, 'A');
    assert.equal(fitted[0].isPrimary, true);
    // 3840x1080 fits the 180x80 content box at 180/3840 = 0.046875.
    assert.ok(Math.abs(fitted[0].width - 90) < 0.001);
    assert.ok(Math.abs(fitted[1].x - (fitted[0].x + 90)) < 0.001);
    assert.ok(fitted[0].x >= 10 && fitted[0].y >= 10);
    assert.ok(fitted[1].x + fitted[1].width <= 190.001);
    assert.ok(fitted[0].y + fitted[0].height <= 90.001);

    assert.deepEqual(fitPreviewRects([], 200, 100), []);
    assert.deepEqual(fitPreviewRects(null, 200, 100), []);
});

test('statePreviewRects tolerates a missing state', () => {
    assert.deepEqual(statePreviewRects(null), []);
    assert.deepEqual(statePreviewRects({}), []);
});

test('statePreviewRects skips monitors with unusable modes', () => {
    const brokenState = {
        ...waylandLogicalState,
        monitors: [
            ...waylandLogicalState.monitors,
            {
                connector: 'DP-99',
                active: true,
                mode: 'not-a-mode',
                transform: 0,
                scale: 1,
                x: 0,
                y: 0,
            },
        ],
    };

    const rects = statePreviewRects(brokenState);

    assert.equal(rects.length, waylandLogicalState.monitors.length);
    assert.ok(rects.every(rect => rect.width > 0 && rect.height > 0));
});

test('buildPlan reports a monitor whose modes are all unusable', () => {
    const brokenState = {
        ...xorgPhysicalState,
        monitors: xorgPhysicalState.monitors.map(monitor =>
            monitor.connector === 'DisplayPort-7'
                ? {
                    ...monitor,
                    mode: 'not-a-mode',
                    allModeIds: ['not-a-mode'],
                    modes: [{id: 'not-a-mode'}],
                }
                : monitor),
    };

    const result = buildPlan(allScreensLayout, brokenState);

    assert.equal(result.ok, false);
    assert.equal(result.error.code, ERROR_CODES.MODE_UNAVAILABLE);
});
