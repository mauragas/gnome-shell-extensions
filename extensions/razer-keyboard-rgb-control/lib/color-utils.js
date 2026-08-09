import {DEFAULT_CUSTOM_HUE} from './presets.js';
import {
    KEYBOARD_EDITOR_ROW_HEIGHT_PX,
    KEYBOARD_EDITOR_UNIT_PX,
} from './keyboard-layout.js';

export function clampUnit(value) {
    const numeric = Number(value);
    if (Number.isNaN(numeric))
        return DEFAULT_CUSTOM_HUE;

    return Math.max(0, Math.min(1, numeric));
}

export function hsvToRgb(hue, saturation = 1, value = 1) {
    const normalizedHue = clampUnit(hue);
    const chroma = value * saturation;
    const scaledHue = normalizedHue * 6;
    const x = chroma * (1 - Math.abs((scaledHue % 2) - 1));

    let red = 0;
    let green = 0;
    let blue = 0;

    if (scaledHue < 1) {
        red = chroma;
        green = x;
    } else if (scaledHue < 2) {
        red = x;
        green = chroma;
    } else if (scaledHue < 3) {
        green = chroma;
        blue = x;
    } else if (scaledHue < 4) {
        green = x;
        blue = chroma;
    } else if (scaledHue < 5) {
        red = x;
        blue = chroma;
    } else {
        red = chroma;
        blue = x;
    }

    const match = value - chroma;
    return {
        red: Math.round((red + match) * 255),
        green: Math.round((green + match) * 255),
        blue: Math.round((blue + match) * 255),
    };
}

export function rgbToHex(red, green, blue) {
    return `#${[red, green, blue].map(value => value.toString(16).padStart(2, '0')).join('').toUpperCase()}`;
}

export function cssRgb(red, green, blue) {
    return `rgb(${red}, ${green}, ${blue})`;
}

export function getReadableTextColor(color) {
    const luminance = (0.299 * color.red + 0.587 * color.green + 0.114 * color.blue) / 255;
    return luminance >= 0.7
        ? 'rgba(18, 18, 24, 0.98)'
        : 'rgba(255, 255, 255, 0.98)';
}

export function buildColorChipStyle(color, isActive) {
    const borderColor = isActive
        ? 'rgba(255, 255, 255, 0.98)'
        : 'rgba(255, 255, 255, 0.18)';
    const ring = isActive
        ? 'box-shadow: 0 0 0 1px rgba(255, 255, 255, 0.16);'
        : '';

    return [
        `background-color: ${cssRgb(color.red, color.green, color.blue)};`,
        `border: 2px solid ${borderColor};`,
        `color: ${getReadableTextColor(color)};`,
        ring,
    ].join(' ');
}

export function buildKeyboardEditorKeyStyle(color, isSelected, widthPx = KEYBOARD_EDITOR_UNIT_PX) {
    const keyWidth = Math.max(
        KEYBOARD_EDITOR_UNIT_PX,
        Number(widthPx) || KEYBOARD_EDITOR_UNIT_PX
    );
    const borderColor = isSelected
        ? 'rgba(255, 255, 255, 0.96)'
        : 'rgba(255, 255, 255, 0.14)';
    const shadow = isSelected
        ? 'box-shadow: 0 0 0 1px rgba(255, 255, 255, 0.16);'
        : '';

    return [
        `width: ${keyWidth}px;`,
        `min-width: ${keyWidth}px;`,
        `max-width: ${keyWidth}px;`,
        `height: ${KEYBOARD_EDITOR_ROW_HEIGHT_PX}px;`,
        `min-height: ${KEYBOARD_EDITOR_ROW_HEIGHT_PX}px;`,
        `max-height: ${KEYBOARD_EDITOR_ROW_HEIGHT_PX}px;`,
        'padding: 4px 5px;',
        'border-radius: 8px;',
        `background-color: ${cssRgb(color.red, color.green, color.blue)};`,
        `border: 2px solid ${borderColor};`,
        `color: ${getReadableTextColor(color)};`,
        shadow,
    ].join(' ');
}

export function buildCustomColorPreset(hue) {
    const rgb = hsvToRgb(hue);
    return {
        id: 'custom',
        label: 'Custom',
        red: rgb.red,
        green: rgb.green,
        blue: rgb.blue,
        hex: rgbToHex(rgb.red, rgb.green, rgb.blue),
    };
}
