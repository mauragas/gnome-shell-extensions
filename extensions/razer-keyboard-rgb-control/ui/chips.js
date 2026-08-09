import Clutter from 'gi://Clutter';
import St from 'gi://St';

import {
    buildColorChipStyle,
    getReadableTextColor,
} from '../lib/color-utils.js';

export function applyColorChipVisuals(button, label, color, isActive) {
    button.set_style(buildColorChipStyle(color, isActive));
    label.set_style(`color: ${getReadableTextColor(color)};`);
}

export function createTextChipButton(preset, isActive, onActivate) {
    const button = new St.Button({
        style_class: isActive
            ? 'rrc-chip-button rrc-chip-button-active'
            : 'rrc-chip-button',
        x_align: Clutter.ActorAlign.START,
        y_align: Clutter.ActorAlign.CENTER,
        can_focus: true,
    });

    button.set_child(new St.Label({
        text: preset.label,
        style_class: 'rrc-chip-label',
        x_align: Clutter.ActorAlign.CENTER,
        y_align: Clutter.ActorAlign.CENTER,
    }));
    button.connect('clicked', () => onActivate());

    return button;
}

export function createColorChipButton(colorPreset, isActive, onActivate) {
    const button = new St.Button({
        style_class: isActive
            ? 'rrc-color-chip-button rrc-color-chip-button-active'
            : 'rrc-color-chip-button',
        x_align: Clutter.ActorAlign.START,
        y_align: Clutter.ActorAlign.CENTER,
        can_focus: true,
    });

    const label = new St.Label({
        text: colorPreset.label,
        style_class: 'rrc-chip-label',
        x_align: Clutter.ActorAlign.CENTER,
        y_align: Clutter.ActorAlign.CENTER,
    });

    button.set_child(label);
    applyColorChipVisuals(button, label, colorPreset, isActive);
    button.connect('clicked', () => onActivate());

    return button;
}

export function createTextButton(label, styleClass, onActivate) {
    const button = new St.Button({
        style_class: styleClass,
        can_focus: true,
        x_align: Clutter.ActorAlign.CENTER,
        y_align: Clutter.ActorAlign.CENTER,
    });

    button.set_child(new St.Label({
        text: label,
        x_align: Clutter.ActorAlign.CENTER,
        y_align: Clutter.ActorAlign.CENTER,
    }));
    button.connect('clicked', () => onActivate());

    return button;
}
