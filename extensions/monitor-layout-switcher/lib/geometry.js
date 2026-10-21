// Geometry, preview and reflow helpers for monitor layouts.
//
// The reflow strategies take an `entries` array shaped as
// `{saved, state, mode, size, scale}` where `saved.layout` holds the captured
// position and `size` is the resolved logical size on this session.

import {
    LAYOUT_MODE_LOGICAL,
    MAX_DEOVERLAP_ITERATIONS,
    SNAP_TOLERANCE_RATIO,
} from './constants.js';
import {rectSizeForMode} from './modes.js';

// ── Preview rects ───────────────────────────────────────────────────────────

/**
 * Rectangle list for drawing a saved layout, using the geometry that was
 * captured when the layout was saved. Keeps previews readable on sessions
 * that cannot reproduce the layout exactly.
 */
export function layoutPreviewRects(layout) {
    const monitors = Array.isArray(layout?.monitors) ? layout.monitors : [];

    return monitors.map(monitor => ({
        x: monitor.layout?.x ?? 0,
        y: monitor.layout?.y ?? 0,
        width: monitor.preferredSize?.width ?? 0,
        height: monitor.preferredSize?.height ?? 0,
        isPrimary: Boolean(monitor.layout?.isPrimary),
        label: monitor.identity?.product ?? monitor.savedConnector ?? null,
    }));
}

/**
 * Rectangle list for drawing the live configuration of a session.
 * Monitors whose mode cannot be interpreted are skipped instead of being
 * drawn with a fabricated size.
 */
export function statePreviewRects(state) {
    const layoutMode = state?.capabilities?.layoutMode ?? LAYOUT_MODE_LOGICAL;
    const monitors = Array.isArray(state?.monitors) ? state.monitors : [];

    return monitors
        .filter(monitor => monitor.active)
        .map(monitor => {
            const size = rectSizeForMode(monitor.mode, monitor.transform,
                monitor.scale, layoutMode);

            if (!size)
                return null;

            return {
                x: monitor.x,
                y: monitor.y,
                width: size.width,
                height: size.height,
                isPrimary: Boolean(monitor.isPrimary),
                label: monitor.model ?? monitor.product ?? monitor.connector,
            };
        })
        .filter(rect => rect !== null);
}

/**
 * Scale a rectangle list to fit an area of `areaWidth` x `areaHeight`.
 * Shared by the Shell (Clutter) and preferences (Cairo) preview renderers so
 * both draw the same picture.
 */
export function fitPreviewRects(rects, areaWidth, areaHeight, padding = 0) {
    if (!Array.isArray(rects) || rects.length === 0)
        return [];

    const minX = Math.min(...rects.map(rect => rect.x));
    const minY = Math.min(...rects.map(rect => rect.y));
    const maxX = Math.max(...rects.map(rect => rect.x + rect.width));
    const maxY = Math.max(...rects.map(rect => rect.y + rect.height));
    const totalWidth = Math.max(maxX - minX, 1);
    const totalHeight = Math.max(maxY - minY, 1);

    const availableWidth = Math.max(areaWidth - padding * 2, 1);
    const availableHeight = Math.max(areaHeight - padding * 2, 1);
    const scale = Math.min(availableWidth / totalWidth, availableHeight / totalHeight);

    const offsetX = padding + (availableWidth - totalWidth * scale) / 2;
    const offsetY = padding + (availableHeight - totalHeight * scale) / 2;

    return rects.map(rect => ({
        x: offsetX + (rect.x - minX) * scale,
        y: offsetY + (rect.y - minY) * scale,
        width: Math.max(rect.width * scale, 1),
        height: Math.max(rect.height * scale, 1),
        isPrimary: Boolean(rect.isPrimary),
        label: rect.label ?? null,
    }));
}

// ── Rectangle helpers ───────────────────────────────────────────────────────

export function rectFromEntry(entry) {
    return {
        x: entry.saved.layout.x,
        y: entry.saved.layout.y,
        width: entry.saved.preferredSize?.width ?? entry.size.width,
        height: entry.saved.preferredSize?.height ?? entry.size.height,
    };
}

export function rectanglesOverlap(a, b) {
    return a.x < b.x + b.width &&
        b.x < a.x + a.width &&
        a.y < b.y + b.height &&
        b.y < a.y + a.height;
}

export function rectanglesAdjacent(a, b) {
    const touchX = a.x + a.width === b.x || b.x + b.width === a.x;
    const touchY = a.y + a.height === b.y || b.y + b.height === a.y;
    const overlapX = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
    const overlapY = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);

    return (touchX && overlapY > 0) || (touchY && overlapX > 0);
}

function buildAdjacency(rects) {
    return rects.map((rect, i) =>
        rects
            .map((other, j) => (i !== j && rectanglesAdjacent(rect, other) ? j : -1))
            .filter(index => index >= 0));
}

export function reachableFrom(rects) {
    const adjacency = buildAdjacency(rects);
    const seen = new Set([0]);
    const queue = [0];

    while (queue.length > 0) {
        const current = queue.shift();
        for (const neighbor of adjacency[current]) {
            if (seen.has(neighbor))
                continue;

            seen.add(neighbor);
            queue.push(neighbor);
        }
    }

    return seen;
}

export function isConnected(rects) {
    if (rects.length <= 1)
        return true;

    return reachableFrom(rects).size === rects.length;
}

export function boundingBox(rects) {
    const minX = Math.min(...rects.map(rect => rect.x));
    const minY = Math.min(...rects.map(rect => rect.y));
    const maxX = Math.max(...rects.map(rect => rect.x + rect.width));
    const maxY = Math.max(...rects.map(rect => rect.y + rect.height));

    return {minX, minY, maxX, maxY, width: maxX - minX, height: maxY - minY};
}

function translateRect(rect, dx, dy) {
    return {...rect, x: rect.x + dx, y: rect.y + dy};
}

function normalizeOrigin(rects) {
    if (rects.length === 0)
        return rects;

    const {minX, minY} = boundingBox(rects);
    return rects.map(rect => translateRect(rect, -minX, -minY));
}

export function primaryIndexFor(entries, rects) {
    const savedPrimaryIndex = entries.findIndex(entry => entry.saved.layout.isPrimary);
    if (savedPrimaryIndex >= 0)
        return savedPrimaryIndex;

    // Fall back to the monitor closest to the centre of the saved layout.
    const savedBox = boundingBox(entries.map(rectFromEntry));
    const savedCentre = {
        x: savedBox.minX + savedBox.width / 2,
        y: savedBox.minY + savedBox.height / 2,
    };

    let bestIndex = 0;
    let bestDistance = Infinity;

    for (let i = 0; i < rects.length; i++) {
        const rect = rects[i];
        const distance = Math.hypot(
            (rect.x + rect.width / 2) - savedCentre.x,
            (rect.y + rect.height / 2) - savedCentre.y);

        if (distance < bestDistance) {
            bestDistance = distance;
            bestIndex = i;
        }
    }

    return bestIndex;
}

// ── Reflow strategies ───────────────────────────────────────────────────────

function exactPlacement(entries) {
    return entries.map((entry, index) => ({
        x: entry.saved.layout.x,
        y: entry.saved.layout.y,
        width: entry.size.width,
        height: entry.size.height,
        index,
    }));
}

/** Return a placement (Map or array) as an array indexed by monitor index. */
function placedToArray(placed, count) {
    const rects = new Array(count);

    if (Array.isArray(placed)) {
        for (let i = 0; i < count; i++)
            rects[i] = placed[i];
        return rects;
    }

    for (const rect of placed.values())
        rects[rect.index] = rect;

    return rects;
}

function clampPerpendicular(value, size, reference, referenceSize) {
    const minValue = reference - size + 1;
    const maxValue = reference + referenceSize - 1;

    if (maxValue < minValue)
        return reference;

    return Math.min(Math.max(value, minValue), maxValue);
}

/**
 * Breadth-first placement that walks the saved adjacency graph from the
 * primary monitor, snapping each neighbour against the edge it shared in the
 * saved layout.
 */
function bfsPlacement(entries, savedRects, primaryIndex) {
    const adjacency = buildAdjacency(savedRects);
    const placed = new Map();

    placed.set(primaryIndex, {
        x: 0,
        y: 0,
        width: entries[primaryIndex].size.width,
        height: entries[primaryIndex].size.height,
        index: primaryIndex,
    });

    const queue = [primaryIndex];

    while (queue.length > 0) {
        const currentIndex = queue.shift();
        const currentRect = placed.get(currentIndex);
        const savedCurrent = savedRects[currentIndex];

        for (const neighborIndex of adjacency[currentIndex]) {
            if (placed.has(neighborIndex))
                continue;

            const savedNeighbor = savedRects[neighborIndex];
            const size = entries[neighborIndex].size;
            const dx = (savedNeighbor.x + savedNeighbor.width / 2) -
                (savedCurrent.x + savedCurrent.width / 2);
            const dy = (savedNeighbor.y + savedNeighbor.height / 2) -
                (savedCurrent.y + savedCurrent.height / 2);

            let x;
            let y;

            if (Math.abs(dx) >= Math.abs(dy)) {
                x = dx >= 0 ? currentRect.x + currentRect.width : currentRect.x - size.width;
                y = clampPerpendicular(
                    currentRect.y + (savedNeighbor.y - savedCurrent.y),
                    size.height, currentRect.y, currentRect.height);
            } else {
                y = dy >= 0 ? currentRect.y + currentRect.height : currentRect.y - size.height;
                x = clampPerpendicular(
                    currentRect.x + (savedNeighbor.x - savedCurrent.x),
                    size.width, currentRect.x, currentRect.width);
            }

            placed.set(neighborIndex, {
                x,
                y,
                width: size.width,
                height: size.height,
                index: neighborIndex,
            });
            queue.push(neighborIndex);
        }
    }

    return placed;
}

/**
 * Push overlapping monitors away from the primary monitor.
 * `placed` is mutated and returned.
 */
function deoverlapPlacement(placed, primaryIndex, count) {
    const rects = placedToArray(placed, count);
    const primary = rects[primaryIndex] ?? rects[0];

    const distanceFromPrimary = rect =>
        Math.hypot(
            (rect.x + rect.width / 2) - (primary.x + primary.width / 2),
            (rect.y + rect.height / 2) - (primary.y + primary.height / 2));

    for (let iteration = 0; iteration < MAX_DEOVERLAP_ITERATIONS; iteration++) {
        let moved = false;

        for (let i = 0; i < rects.length && !moved; i++) {
            for (let j = i + 1; j < rects.length && !moved; j++) {
                if (!rectanglesOverlap(rects[i], rects[j]))
                    continue;

                const overlapX = Math.min(
                    rects[i].x + rects[i].width, rects[j].x + rects[j].width) -
                    Math.max(rects[i].x, rects[j].x);
                const overlapY = Math.min(
                    rects[i].y + rects[i].height, rects[j].y + rects[j].height) -
                    Math.max(rects[i].y, rects[j].y);

                let mover = distanceFromPrimary(rects[j]) >= distanceFromPrimary(rects[i])
                    ? rects[j]
                    : rects[i];
                let other = mover === rects[j] ? rects[i] : rects[j];

                // The primary monitor never moves; push the other one instead.
                if (mover.index === primaryIndex)
                    [mover, other] = [other, mover];

                if (overlapX <= overlapY) {
                    const direction = (mover.x + mover.width / 2) >=
                        (other.x + other.width / 2) ? 1 : -1;
                    mover.x += direction * (overlapX + 1);
                } else {
                    const direction = (mover.y + mover.height / 2) >=
                        (other.y + other.height / 2) ? 1 : -1;
                    mover.y += direction * (overlapY + 1);
                }

                moved = true;
            }
        }

        if (!moved)
            break;
    }

    return placed;
}

/**
 * Close small gaps between monitors that were adjacent in the saved layout,
 * without creating new overlaps.
 */
function snapPlacement(placed, savedRects) {
    const rects = placedToArray(placed, savedRects.length);
    const adjacency = buildAdjacency(savedRects);

    const tryMove = (rect, dx, dy) => {
        if (dx === 0 && dy === 0)
            return false;

        const candidate = translateRect(rect, dx, dy);
        const collides = rects.some(other =>
            other !== rect && rectanglesOverlap(candidate, other));

        if (collides)
            return false;

        rect.x = candidate.x;
        rect.y = candidate.y;
        return true;
    };

    for (let i = 0; i < savedRects.length; i++) {
        for (const neighborIndex of adjacency[i]) {
            const a = rects[i];
            const b = rects[neighborIndex];
            if (!a || !b || rectanglesAdjacent(a, b))
                continue;

            const savedA = savedRects[i];
            const savedB = savedRects[neighborIndex];
            const toleranceX = Math.max(1, Math.round(
                Math.min(a.width, b.width) * SNAP_TOLERANCE_RATIO));
            const toleranceY = Math.max(1, Math.round(
                Math.min(a.height, b.height) * SNAP_TOLERANCE_RATIO));

            // Horizontal neighbour in the saved layout.
            if (savedA.x + savedA.width === savedB.x) {
                const gap = b.x - (a.x + a.width);
                if (gap >= 0 && gap <= toleranceX)
                    tryMove(b, -gap, 0);
            } else if (savedB.x + savedB.width === savedA.x) {
                const gap = a.x - (b.x + b.width);
                if (gap >= 0 && gap <= toleranceX)
                    tryMove(a, -gap, 0);
            }

            // Vertical neighbour in the saved layout.
            if (savedA.y + savedA.height === savedB.y) {
                const gap = b.y - (a.y + a.height);
                if (gap >= 0 && gap <= toleranceY)
                    tryMove(b, 0, -gap);
            } else if (savedB.y + savedB.height === savedA.y) {
                const gap = a.y - (b.y + b.height);
                if (gap >= 0 && gap <= toleranceY)
                    tryMove(a, 0, -gap);
            }
        }
    }

    return placed;
}

/**
 * Deterministic row-based reflow.
 *
 * Monitors are grouped into rows by vertical overlap of their saved rectangles
 * (at least half of the smaller height). Rows are stacked, and monitors inside
 * a row are laid out left to right while preserving their relative vertical
 * offsets. The result is always overlap-free, fully adjacent and anchored at
 * the origin.
 */
function rowPlacement(entries, savedRects) {
    const order = entries
        .map((entry, index) => ({index, rect: savedRects[index]}))
        .sort((a, b) => (a.rect.y - b.rect.y) || (a.rect.x - b.rect.x));

    const rows = [];

    for (const item of order) {
        const row = rows[rows.length - 1];
        if (!row) {
            rows.push([item]);
            continue;
        }

        const sameRow = row.some(member => {
            const overlap = Math.min(
                member.rect.y + member.rect.height,
                item.rect.y + item.rect.height) -
                Math.max(member.rect.y, item.rect.y);
            const minHeight = Math.min(member.rect.height, item.rect.height);

            return overlap >= minHeight * 0.5;
        });

        if (sameRow)
            row.push(item);
        else
            rows.push([item]);
    }

    const placed = new Array(entries.length);
    let rowTop = 0;

    for (const row of rows) {
        row.sort((a, b) => (a.rect.x - b.rect.x) || (a.rect.y - b.rect.y));

        const savedTop = Math.min(...row.map(member => member.rect.y));
        let cursorX = 0;
        let rowHeight = 0;
        let previousRect = null;

        for (const member of row) {
            const size = entries[member.index].size;
            let y = rowTop + (member.rect.y - savedTop);

            if (previousRect) {
                y = clampPerpendicular(
                    y, size.height, previousRect.y, previousRect.height);
            }

            placed[member.index] = {
                x: cursorX,
                y,
                width: size.width,
                height: size.height,
                index: member.index,
            };

            previousRect = placed[member.index];
            cursorX += size.width;
            rowHeight = Math.max(rowHeight, (y - rowTop) + size.height);
        }

        rowTop += rowHeight;
    }

    return placed;
}

function stripPlacement(entries, primaryIndex) {
    const order = entries.map((entry, index) => index);
    const primaryPosition = order.indexOf(primaryIndex);

    if (primaryPosition > 0) {
        order.splice(primaryPosition, 1);
        order.unshift(primaryIndex);
    }

    const placed = new Array(entries.length);
    let cursorX = 0;

    for (const index of order) {
        const size = entries[index].size;
        placed[index] = {
            x: cursorX,
            y: 0,
            width: size.width,
            height: size.height,
            index,
        };
        cursorX += size.width;
    }

    return placed;
}

function placementToRects(placed, count) {
    const source = placedToArray(placed, count);

    return source.map((rect, index) => rect ? {
        x: rect.x,
        y: rect.y,
        width: rect.width,
        height: rect.height,
        index,
    } : null);
}

function isPlacementValid(rects) {
    if (rects.some(rect => !rect || !(rect.width > 0) || !(rect.height > 0)))
        return false;

    for (let i = 0; i < rects.length; i++) {
        for (let j = i + 1; j < rects.length; j++) {
            if (rectanglesOverlap(rects[i], rects[j]))
                return false;
        }
    }

    return isConnected(rects);
}

/**
 * Produce Mutter-valid rectangles for `entries`.
 * Strategies are tried from most to least faithful to the saved geometry.
 */
export function reflow(entries, primaryIndex) {
    const savedRects = entries.map(rectFromEntry);

    if (entries.length === 1) {
        return [{x: 0, y: 0, width: entries[0].size.width, height: entries[0].size.height}];
    }

    // 1. Exact replay keeps saved geometry untouched when it still validates.
    // The origin is normalised because Mutter rejects offset layouts, and a
    // layout saved on another session may start at a negative coordinate.
    const exact = placementToRects(exactPlacement(entries), entries.length);
    if (isPlacementValid(exact))
        return normalizeOrigin(exact);

    // 2. Topology-preserving placement. BFS can only cover the component that
    // contains the primary, so it is skipped for disconnected saved layouts.
    if (isConnected(savedRects)) {
        const bfs = bfsPlacement(entries, savedRects, primaryIndex);
        if (bfs.size === entries.length) {
            deoverlapPlacement(bfs, primaryIndex, entries.length);
            snapPlacement(bfs, savedRects);

            const bfsRects = placementToRects(bfs, entries.length);
            if (isPlacementValid(bfsRects))
                return normalizeOrigin(bfsRects);
        }
    }

    // 3. Row-based reflow.
    const rows = placementToRects(rowPlacement(entries, savedRects), entries.length);
    if (isPlacementValid(rows))
        return normalizeOrigin(rows);

    // 4. Linear strip: always valid.
    return normalizeOrigin(placementToRects(stripPlacement(entries, primaryIndex), entries.length));
}
