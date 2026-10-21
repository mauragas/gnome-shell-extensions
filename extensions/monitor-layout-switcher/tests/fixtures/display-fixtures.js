// Fixtures and builders for Monitor Layout Switcher tests.
// These mirror the shapes produced by shared.js / lib/display-plan.js and are
// plain objects so tests run without GI.

import {
    LAYOUT_MODE_LOGICAL,
    LAYOUT_MODE_PHYSICAL,
} from '../../lib/display-plan.js';

export function mode(id, supportedScales = [1]) {
    const match = id.match(/^(\d+)x(\d+)@([\d.]+)$/);
    if (!match)
        throw new Error(`Invalid mode id: ${id}`);

    return {
        id,
        width: Number(match[1]),
        height: Number(match[2]),
        rate: Number(match[3]),
        scale: supportedScales[0] ?? 1,
        supportedScales,
    };
}

export function monitor({
    connector,
    vendor,
    product,
    serial,
    isBuiltin = false,
    modes = [mode('1920x1080@60.000')],
    currentMode = modes[0]?.id,
    transform = 0,
    scale = 1,
    active = true,
    isPrimary = false,
    x = 0,
    y = 0,
}) {
    return {
        connector,
        vendor,
        product,
        model: product,
        serial,
        isBuiltin,
        mode: currentMode,
        allModeIds: modes.map(item => item.id),
        modes,
        transform,
        scale,
        active,
        isPrimary,
        x,
        y,
    };
}

export function state({renderer, layoutMode, globalScaleRequired, monitors}) {
    return {
        serial: 1,
        capabilities: {
            renderer,
            layoutMode,
            globalScaleRequired,
            legacyUiScalingFactor: 1,
            maxScreenSize: renderer === 'xrandr' ? {width: 16384, height: 16384} : null,
            supportsChangingLayoutMode: layoutMode !== LAYOUT_MODE_PHYSICAL,
            fractionalScaling: layoutMode !== LAYOUT_MODE_PHYSICAL &&
                !globalScaleRequired,
        },
        monitors,
    };
}

// ── Xorg / Xrandr, modelled on a typical multi-monitor session ───────────────
// Serial numbers are synthetic so the fixtures do not embed real hardware IDs.
export const xorgPhysicalState = state({
    renderer: 'xrandr',
    layoutMode: LAYOUT_MODE_PHYSICAL,
    globalScaleRequired: true,
    monitors: [
        monitor({
            connector: 'DisplayPort-6',
            vendor: 'LEN',
            product: 'P27q-20',
            serial: 'SN-P27Q-0001',
            modes: [
                mode('2560x1440@59.951', [1, 2, 3]),
                mode('1920x1200@59.950', [1, 2]),
                mode('1920x1080@60.000', [1, 2]),
            ],
            transform: 1,
            x: 6400,
            y: 0,
        }),
        monitor({
            connector: 'DisplayPort-7',
            vendor: 'DEL',
            product: 'DELL U3219Q',
            serial: 'SN-U3219Q-0001',
            modes: [
                mode('3840x2160@59.997', [1, 2, 3, 4]),
                mode('2560x1440@59.951', [1, 2, 3]),
                mode('1920x1080@60.000', [1, 2]),
            ],
            x: 2560,
            y: 177,
            isPrimary: true,
        }),
        monitor({
            connector: 'DisplayPort-8',
            vendor: 'LEN',
            product: 'P27h-20',
            serial: 'SN-P27H-0001',
            modes: [
                mode('2560x1440@59.951', [1, 2, 3]),
                mode('1920x1200@59.950', [1, 2]),
            ],
            x: 0,
            y: 439,
        }),
        monitor({
            connector: 'eDP',
            vendor: 'LEN',
            product: '0x403d',
            serial: '0x00000000',
            isBuiltin: true,
            modes: [
                mode('1920x1200@60.003', [1, 2]),
                mode('1920x1080@60.003', [1, 2]),
            ],
            active: false,
        }),
    ],
});

// ── Wayland / native, with fractional-scaling virtual modes ─────────────────
export const waylandLogicalState = state({
    renderer: 'native',
    layoutMode: LAYOUT_MODE_LOGICAL,
    globalScaleRequired: false,
    monitors: [
        monitor({
            connector: 'DP-7',
            vendor: 'LEN',
            product: 'P27q-20',
            serial: 'SN-P27Q-0001',
            modes: [mode('2560x1440@59.951', [1, 1.5, 2])],
            transform: 1,
            x: 5440,
            y: 0,
        }),
        monitor({
            connector: 'DP-8',
            vendor: 'DEL',
            product: 'DELL U3219Q',
            serial: 'SN-U3219Q-0001',
            modes: [
                mode('2880x1620@59.975', [1, 1.25, 1.5]),
                mode('3840x2160@59.997', [1, 2]),
                mode('3200x1800@59.956', [1, 1.2]),
            ],
            currentMode: '2880x1620@59.975',
            x: 2560,
            y: 600,
            isPrimary: true,
        }),
        monitor({
            connector: 'DP-10',
            vendor: 'LEN',
            product: 'P27h-20',
            serial: 'SN-P27H-0001',
            modes: [mode('2560x1440@59.951', [1, 1.5, 2])],
            x: 0,
            y: 203,
        }),
        monitor({
            connector: 'eDP-1',
            vendor: 'LEN',
            product: '0x403d',
            serial: '0x00000000',
            isBuiltin: true,
            modes: [mode('1920x1200@60.003', [1, 2])],
            x: 640,
            y: 1643,
        }),
    ],
});

// ── Layouts saved under Wayland (schema v1) ─────────────────────────────────
export const allScreensLayout = {
    id: 'layout-all-screens',
    name: 'All screens',
    monitors: [
        {
            connector: 'DP-10',
            mode: '2560x1440@59.951',
            transform: 0,
            scale: 1,
            x: 0,
            y: 203,
            isPrimary: false,
            model: 'P27h-20',
            isBuiltin: false,
        },
        {
            connector: 'DP-7',
            mode: '2560x1440@59.951',
            transform: 1,
            scale: 1,
            x: 5440,
            y: 0,
            isPrimary: false,
            model: 'P27q-20',
            isBuiltin: false,
        },
        {
            connector: 'DP-8',
            mode: '2880x1620@59.975',
            transform: 0,
            scale: 1,
            x: 2560,
            y: 600,
            isPrimary: true,
            model: 'DELL U3219Q',
            isBuiltin: false,
        },
        {
            connector: 'eDP-1',
            mode: '1920x1200@60.003',
            transform: 0,
            scale: 1,
            x: 640,
            y: 1643,
            isPrimary: false,
            model: '0x403d',
            isBuiltin: true,
        },
    ],
};

export const leftLaptopLayout = {
    id: 'layout-left-laptop',
    name: 'Left + Laptop',
    monitors: [
        {
            connector: 'DP-10',
            mode: '2560x1440@59.951',
            transform: 0,
            scale: 1,
            x: 0,
            y: 0,
            isPrimary: false,
            model: 'P27h-20',
            isBuiltin: false,
        },
        {
            connector: 'eDP-1',
            mode: '1920x1200@60.003',
            transform: 0,
            scale: 1,
            x: 345,
            y: 1440,
            isPrimary: true,
            model: '0x403d',
            isBuiltin: true,
        },
    ],
};

export const threeExternalLayout = {
    id: 'layout-three-external',
    name: '3 external screens',
    monitors: [
        {
            connector: 'DP-7',
            mode: '2560x1440@59.951',
            transform: 1,
            scale: 1,
            x: 5760,
            y: 0,
            isPrimary: false,
            model: 'P27q-20',
            isBuiltin: false,
        },
        {
            connector: 'DP-8',
            mode: '3200x1800@59.956',
            transform: 0,
            scale: 1,
            x: 2560,
            y: 515,
            isPrimary: true,
            model: 'DELL U3219Q',
            isBuiltin: false,
        },
        {
            connector: 'DP-9',
            mode: '2560x1440@59.951',
            transform: 0,
            scale: 1,
            x: 0,
            y: 701,
            isPrimary: false,
            model: 'P27h-20',
            isBuiltin: false,
        },
    ],
};

export const savedLayouts = [
    allScreensLayout,
    leftLaptopLayout,
    threeExternalLayout,
];
