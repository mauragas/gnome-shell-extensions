import * as Main from 'resource:///org/gnome/shell/ui/main.js';

export function getStage() {
    return globalThis.stage ?? globalThis.global?.stage ?? null;
}

function getPrimaryMonitorRect() {
    const stage = getStage();
    return Main.layoutManager.primaryMonitor ?? {
        x: 0,
        y: 0,
        width: stage?.width ?? 0,
        height: stage?.height ?? 0,
    };
}

function getPointerCoords() {
    try {
        const pointer = globalThis.global?.get_pointer?.();
        if (Array.isArray(pointer) && pointer.length >= 2)
            return {x: pointer[0], y: pointer[1]};
    } catch {
        // Fall back to the primary monitor when pointer lookup is unavailable.
    }

    return null;
}

function getMonitorContainingPoint(x, y) {
    for (const monitor of Main.layoutManager.monitors ?? []) {
        if (x >= monitor.x && x < monitor.x + monitor.width &&
            y >= monitor.y && y < monitor.y + monitor.height) {
            return monitor;
        }
    }

    return null;
}

export function getPreferredMonitorRect() {
    const pointer = getPointerCoords();
    if (pointer) {
        const pointerMonitor = getMonitorContainingPoint(pointer.x, pointer.y);
        if (pointerMonitor)
            return pointerMonitor;
    }

    return getPrimaryMonitorRect();
}
