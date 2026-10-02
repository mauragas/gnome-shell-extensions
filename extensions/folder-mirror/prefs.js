import Adw from 'gi://Adw';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Gtk from 'gi://Gtk';

import {ExtensionPreferences}
    from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

import {
    EXTENSION_TITLE,
    SETTINGS_SCHEMA_ID,
    SYSTEMD_UNIT_NAME,
    formatDependencySummary,
    formatProfileLocation,
    getHelperSnapshot,
    getStateRoot,
    invokeHelperStringMethod,
    invokeHelperVoidMethod,
    loadGlobalExcludes,
    loadHelperConfigFromSettings,
    loadProfiles,
    openPath,
    restartHelperService,
    saveGlobalExcludes,
    saveProfiles,
} from './shared.js';
import {
    createDefaultExcludeRules,
    formatExcludeRulesAsLines,
    parseExcludeRulesFromLines,
} from './lib/exclude-rules.js';
import {
    createProfileTemplate,
    duplicateProfile,
    normalizeProfiles,
    removeProfileFromList,
    replaceProfile,
} from './lib/profile-store.js';
import {
    CONFLICT_POLICIES,
    CONFLICT_POLICY_LABELS,
    PROFILE_MODES,
    PROFILE_MODE_LABELS,
    buildProfileValidationErrors,
} from './lib/validation.js';

Gio._promisify(Gio.Subprocess.prototype, 'communicate_utf8_async', 'communicate_utf8_finish');

function createStringDropdown(values, labelsByValue) {
    const labels = values.map(value => labelsByValue[value] ?? value);
    const dropdown = new Gtk.DropDown({
        model: Gtk.StringList.new(labels),
        valign: Gtk.Align.CENTER,
        hexpand: true,
    });
    dropdown._values = values;
    dropdown._labelsByValue = labelsByValue;
    return dropdown;
}

function setDropdownValue(dropdown, value) {
    const index = dropdown._values.indexOf(value);
    dropdown.set_selected(index >= 0 ? index : 0);
}

function getDropdownValue(dropdown) {
    return dropdown._values[dropdown.get_selected()] ?? dropdown._values[0];
}

function setTextViewText(textView, text) {
    textView.get_buffer().set_text(text, -1);
}

function getTextViewText(textView) {
    const buffer = textView.get_buffer();
    const [start, end] = buffer.get_bounds();
    return buffer.get_text(start, end, false);
}

function createDialog(parentWindow, title, body) {
    return new Adw.AlertDialog({
        heading: title,
        body,
        close_response: 'close',
    });
}

function configureCompactSwitch(widget) {
    widget.set_halign(Gtk.Align.START);
    widget.set_valign(Gtk.Align.CENTER);
    widget.set_hexpand(false);
    return widget;
}

export default class FolderMirrorPreferences extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        this._window = window;
        this._settings = this.getSettings(SETTINGS_SCHEMA_ID);
        this._profiles = loadProfiles(this._settings);
        this._globalExcludes = loadGlobalExcludes(this._settings);
        this._selectedProfileId = this._profiles[0]?.id ?? null;

        window.set_default_size(860, 760);

        this._buildProfilesPage(window);
        this._buildDefaultsPage(window);
        this._buildDiagnosticsPage(window);

        this._rebuildProfilesList();
        this._populateEditor();
        this._populateDefaults();
        this._refreshDiagnostics().catch(error => {
            console.error(`[FM prefs] diagnostics refresh failed: ${error.message}`);
        });
    }

    _buildProfilesPage(window) {
        const page = new Adw.PreferencesPage({
            title: 'Profiles',
            icon_name: 'folder-symbolic',
        });
        window.add(page);

        const listGroup = new Adw.PreferencesGroup({
            title: 'Mirror profiles',
            description: 'Create, duplicate, remove, and dry-run folder mirror definitions.',
        });
        page.add(listGroup);

        this._profilesListBox = new Gtk.ListBox({
            selection_mode: Gtk.SelectionMode.SINGLE,
            css_classes: ['boxed-list'],
        });
        this._profilesListBox.connect('row-selected', (_listBox, row) => {
            this._selectedProfileId = row?._profileId ?? null;
            this._populateEditor();
        });
        listGroup.add(this._profilesListBox);

        const buttonRow = new Gtk.Box({
            spacing: 8,
            margin_top: 6,
            margin_bottom: 4,
        });
        listGroup.add(buttonRow);

        this._addProfileButton = this._createTextButton('Add profile', () => this._addProfile());
        this._duplicateButton = this._createTextButton('Duplicate', () => this._duplicateSelectedProfile());
        this._removeButton = this._createTextButton('Remove', () => this._removeSelectedProfile());
        this._dryRunButton = this._createTextButton('Dry run', () => {
            this._runSelectedProfileDryRun().catch(error => {
                this._showMessage('Dry run failed', error.message);
            });
        });
        buttonRow.append(this._addProfileButton);
        buttonRow.append(this._duplicateButton);
        buttonRow.append(this._removeButton);
        buttonRow.append(this._dryRunButton);

        const editorGroup = new Adw.PreferencesGroup({
            title: 'Selected profile',
            description: 'Edit the selected profile and save the changes back to GSettings. The validation summary updates live while you type.',
        });
        page.add(editorGroup);

        const editorGrid = new Gtk.Grid({
            column_spacing: 12,
            row_spacing: 12,
            margin_top: 6,
            margin_bottom: 6,
            margin_start: 6,
            margin_end: 6,
            hexpand: true,
        });
        this._editorGrid = editorGrid;
        editorGroup.add(editorGrid);

        this._nameEntry = new Gtk.Entry({
            hexpand: true,
            placeholder_text: 'Example Container Mirror',
        });
        this._sourceEntry = new Gtk.Entry({
            hexpand: true,
            placeholder_text: '/path/to/source',
        });
        this._targetEntry = new Gtk.Entry({
            hexpand: true,
            placeholder_text: '/path/to/target',
        });
        this._modeDropdown = createStringDropdown(PROFILE_MODES, PROFILE_MODE_LABELS);
        this._conflictPolicyDropdown = createStringDropdown(CONFLICT_POLICIES, CONFLICT_POLICY_LABELS);
        this._enabledSwitch = configureCompactSwitch(new Gtk.Switch());
        this._watchModeSwitch = configureCompactSwitch(new Gtk.Switch());
        this._runAtLoginSwitch = configureCompactSwitch(new Gtk.Switch());
        this._deleteProtectionSwitch = configureCompactSwitch(new Gtk.Switch());
        this._includeGitMetadataSwitch = configureCompactSwitch(new Gtk.Switch());
        this._globalExcludesSwitch = configureCompactSwitch(new Gtk.Switch());
        this._excludeGitIgnoredSwitch = configureCompactSwitch(new Gtk.Switch());
        this._excludeRulesView = new Gtk.TextView({
            monospace: true,
            wrap_mode: Gtk.WrapMode.WORD_CHAR,
            top_margin: 8,
            bottom_margin: 8,
            left_margin: 8,
            right_margin: 8,
        });
        const excludeRulesScroller = new Gtk.ScrolledWindow({
            min_content_height: 168,
            hexpand: true,
            vexpand: false,
        });
        excludeRulesScroller.set_child(this._excludeRulesView);
        this._excludeRulesScroller = excludeRulesScroller;

        let row = 0;
        this._attachEditorRow(editorGrid, row++, 'Name', this._nameEntry);
        this._attachPathRow(editorGrid, row++, 'Source path', this._sourceEntry, 'Choose source folder');
        this._attachPathRow(editorGrid, row++, 'Target path', this._targetEntry, 'Choose target folder');
        this._attachEditorRow(editorGrid, row++, 'Mode', this._modeDropdown);
        this._attachEditorRow(editorGrid, row++, 'Conflict policy', this._conflictPolicyDropdown);
        this._attachEditorRow(editorGrid, row++, 'Enabled', this._enabledSwitch, Gtk.Align.CENTER, false);
        this._attachEditorRow(editorGrid, row++, 'Watch mode', this._watchModeSwitch, Gtk.Align.CENTER, false);
        this._attachEditorRow(editorGrid, row++, 'Run at login', this._runAtLoginSwitch, Gtk.Align.CENTER, false);
        this._attachEditorRow(editorGrid, row++, 'Delete protection', this._deleteProtectionSwitch, Gtk.Align.CENTER, false);
        this._attachEditorRow(editorGrid, row++, 'Exclude Git-ignored files', this._excludeGitIgnoredSwitch, Gtk.Align.CENTER, false);
        this._attachEditorRow(editorGrid, row++, 'Include Git metadata', this._includeGitMetadataSwitch, Gtk.Align.CENTER, false);
        this._attachEditorRow(editorGrid, row++, 'Use global excludes', this._globalExcludesSwitch, Gtk.Align.CENTER, false);
        this._attachEditorRow(editorGrid, row++, 'Exclude rules', excludeRulesScroller, Gtk.Align.START, true);

        this._validationLabel = new Gtk.Label({
            xalign: 0,
            wrap: true,
            css_classes: ['caption'],
        });
        editorGroup.add(this._validationLabel);

        const editorButtons = new Gtk.Box({
            spacing: 8,
            margin_top: 8,
            margin_bottom: 4,
            hexpand: true,
            homogeneous: true,
        });
        editorGroup.add(editorButtons);
        this._saveButton = this._createTextButton('Save changes', () => this._saveSelectedProfile());
        this._revertButton = this._createTextButton('Revert', () => this._populateEditor());
        this._saveButton.set_hexpand(true);
        this._revertButton.set_hexpand(true);
        editorButtons.append(this._saveButton);
        editorButtons.append(this._revertButton);

        this._editorWidgets = [
            this._nameEntry,
            this._sourceEntry,
            this._targetEntry,
            this._modeDropdown,
            this._conflictPolicyDropdown,
            this._enabledSwitch,
            this._watchModeSwitch,
            this._runAtLoginSwitch,
            this._deleteProtectionSwitch,
            this._excludeGitIgnoredSwitch,
            this._includeGitMetadataSwitch,
            this._globalExcludesSwitch,
            this._excludeRulesScroller,
            this._saveButton,
            this._revertButton,
        ];

        this._connectEditorSignals();
    }

    _buildDefaultsPage(window) {
        const page = new Adw.PreferencesPage({
            title: 'Defaults',
            icon_name: 'preferences-system-symbolic',
        });
        window.add(page);

        const helperGroup = new Adw.PreferencesGroup({
            title: 'Helper defaults',
        });
        page.add(helperGroup);

        this._showIndicatorSwitch = new Gtk.Switch({valign: Gtk.Align.CENTER});
        this._showNotificationsSwitch = new Gtk.Switch({valign: Gtk.Align.CENTER});
        this._autoStartHelperSwitch = new Gtk.Switch({valign: Gtk.Align.CENTER});
        this._watchIntervalSpin = Gtk.SpinButton.new_with_range(5, 3600, 1);
        this._watchIntervalSpin.set_valign(Gtk.Align.CENTER);
        this._logLevelDropdown = createStringDropdown(
            ['debug', 'info', 'warn', 'error'],
            {
                debug: 'Debug',
                info: 'Info',
                warn: 'Warn',
                error: 'Error',
            }
        );

        helperGroup.add(this._createActionRow('Show indicator', 'Display the top-bar panel entry.', this._showIndicatorSwitch));
        helperGroup.add(this._createActionRow('Show notifications', 'Allow the extension to show status notifications.', this._showNotificationsSwitch));
        helperGroup.add(this._createActionRow('Auto-start helper logic', 'Run watch-mode and run-at-login profiles automatically.', this._autoStartHelperSwitch));
        helperGroup.add(this._createActionRow('Watch interval', 'Fallback polling interval in seconds.', this._watchIntervalSpin));
        helperGroup.add(this._createActionRow('Log level', 'Background helper logging verbosity.', this._logLevelDropdown));

        const excludesGroup = new Adw.PreferencesGroup({
            title: 'Global exclude rules',
            description: 'One rule per line. Prefix a rule with name:, path:, or glob:.',
        });
        page.add(excludesGroup);

        this._globalExcludesView = new Gtk.TextView({
            monospace: true,
            wrap_mode: Gtk.WrapMode.WORD_CHAR,
            top_margin: 8,
            bottom_margin: 8,
            left_margin: 8,
            right_margin: 8,
        });
        const excludesScroller = new Gtk.ScrolledWindow({
            min_content_height: 220,
            hexpand: true,
            vexpand: true,
        });
        excludesScroller.set_child(this._globalExcludesView);
        excludesGroup.add(excludesScroller);

        const buttons = new Gtk.Box({
            spacing: 8,
            margin_top: 6,
            margin_bottom: 4,
            hexpand: true,
            homogeneous: true,
        });
        excludesGroup.add(buttons);
        const saveDefaultsButton = this._createTextButton('Save defaults', () => this._saveDefaults());
        const restoreDefaultsButton = this._createTextButton('Restore defaults', () => this._restoreDefaultGlobalExcludes());
        saveDefaultsButton.set_hexpand(true);
        restoreDefaultsButton.set_hexpand(true);
        buttons.append(saveDefaultsButton);
        buttons.append(restoreDefaultsButton);
    }

    _buildDiagnosticsPage(window) {
        const page = new Adw.PreferencesPage({
            title: 'Diagnostics',
            icon_name: 'utilities-terminal-symbolic',
        });
        window.add(page);

        const statusGroup = new Adw.PreferencesGroup({
            title: 'Helper status',
        });
        page.add(statusGroup);

        this._helperStateRow = this._createStaticInfoRow('State', 'Checking helper state…', {
            subtitleLines: 2,
        });
        this._helperSummaryRow = this._createStaticInfoRow('Summary', 'Collecting live helper summary…', {
            subtitleLines: 3,
        });
        this._dependenciesRow = this._createStaticInfoRow('Dependencies', 'Detecting runtime dependencies…', {
            subtitleLines: 8,
        });
        this._recentErrorsRow = this._createStaticInfoRow('Recent errors', 'No recent errors reported.', {
            subtitleLines: 6,
        });

        statusGroup.add(this._helperStateRow);
        statusGroup.add(this._helperSummaryRow);
        statusGroup.add(this._dependenciesRow);
        statusGroup.add(this._recentErrorsRow);

        const actionsGroup = new Adw.PreferencesGroup({
            title: 'Actions',
        });
        page.add(actionsGroup);

        const actions = new Gtk.Box({
            spacing: 8,
            margin_top: 6,
            margin_bottom: 4,
            hexpand: true,
            homogeneous: true,
        });
        actionsGroup.add(actions);
        const refreshButton = this._createTextButton('Refresh', () => {
            this._refreshDiagnostics().catch(error => this._showMessage('Diagnostics refresh failed', error.message));
        });
        const restartButton = this._createTextButton('Restart helper', () => {
            this._restartHelper().catch(error => this._showMessage('Restart failed', error.message));
        });
        const openStateDirButton = this._createTextButton('Open state directory', () => {
            openPath(getStateRoot());
        });
        for (const button of [refreshButton, restartButton, openStateDirButton]) {
            button.set_hexpand(true);
            actions.append(button);
        }
    }

    _createTextButton(label, action) {
        const button = new Gtk.Button({
            label,
            valign: Gtk.Align.CENTER,
        });
        button.connect('clicked', () => action());
        return button;
    }

    _createActionRow(title, subtitle, widget) {
        const row = new Adw.ActionRow({
            title,
            subtitle,
        });
        row.add_suffix(widget);
        row.activatable_widget = widget;
        return row;
    }

    _createStaticInfoRow(title, value, {
        subtitleLines = 4,
    } = {}) {
        const row = new Adw.ActionRow({
            title,
            subtitle: value,
            activatable: false,
        });
        row.subtitle_lines = subtitleLines;
        row.title_lines = 1;
        return row;
    }

    _attachEditorRow(grid, rowIndex, title, widget, valign = Gtk.Align.CENTER, shouldExpand = true) {
        const label = new Gtk.Label({
            label: title,
            xalign: 0,
            halign: Gtk.Align.START,
            valign,
        });
        grid.attach(label, 0, rowIndex, 1, 1);
        widget.set_valign?.(valign);
        if (shouldExpand)
            widget.set_hexpand?.(true);
        grid.attach(widget, 1, rowIndex, 1, 1);
    }

    _attachPathRow(grid, rowIndex, title, entry, dialogTitle) {
        const box = new Gtk.Box({spacing: 8, hexpand: true});
        box.append(entry);
        box.append(this._createTextButton('Browse…', () => {
            this._selectFolder(dialogTitle, entry);
        }));
        this._attachEditorRow(grid, rowIndex, title, box);
    }

    _selectFolder(title, entry) {
        if (typeof Gtk.FileDialog === 'function') {
            const dialog = new Gtk.FileDialog({title, modal: true});
            dialog.select_folder(this._window, null, (_dialog, result) => {
                try {
                    const folder = _dialog.select_folder_finish(result);
                    entry.set_text(folder.get_path() ?? '');
                } catch (error) {
                    if (!error.matches?.(Gtk.DialogError, Gtk.DialogError.DISMISSED))
                        console.error(`[FM prefs] folder selection failed: ${error.message}`);
                }
            });
            return;
        }

        const chooser = new Gtk.FileChooserNative({
            title,
            transient_for: this._window,
            modal: true,
            action: Gtk.FileChooserAction.SELECT_FOLDER,
            accept_label: 'Select',
            cancel_label: 'Cancel',
        });
        chooser.connect('response', (dialog, responseId) => {
            if (responseId === Gtk.ResponseType.ACCEPT) {
                const folder = dialog.get_file();
                entry.set_text(folder?.get_path?.() ?? '');
            }
            dialog.destroy();
        });
        chooser.show();
    }

    _connectEditorSignals() {
        const updateValidation = () => this._updateEditorValidationFromForm();

        this._nameEntry.connect('changed', updateValidation);
        this._sourceEntry.connect('changed', updateValidation);
        this._targetEntry.connect('changed', updateValidation);
        this._modeDropdown.connect('notify::selected', updateValidation);
        this._conflictPolicyDropdown.connect('notify::selected', updateValidation);
        this._enabledSwitch.connect('notify::active', updateValidation);
        this._watchModeSwitch.connect('notify::active', updateValidation);
        this._runAtLoginSwitch.connect('notify::active', updateValidation);
        this._deleteProtectionSwitch.connect('notify::active', updateValidation);
        this._excludeGitIgnoredSwitch.connect('notify::active', updateValidation);
        this._includeGitMetadataSwitch.connect('notify::active', updateValidation);
        this._globalExcludesSwitch.connect('notify::active', updateValidation);
        this._excludeRulesView.get_buffer().connect('changed', updateValidation);
    }

    _updateEditorValidationFromForm() {
        const selectedProfile = this._getSelectedProfile();
        if (!selectedProfile) {
            this._validationLabel.set_label('Create or select a profile to start editing.');
            return;
        }

        this._renderValidation(this._readProfileForm());
    }

    _setEditorSensitive(isSensitive) {
        for (const widget of this._editorWidgets ?? [])
            widget.set_sensitive?.(isSensitive);

        this._duplicateButton?.set_sensitive(isSensitive);
        this._removeButton?.set_sensitive(isSensitive);
        this._dryRunButton?.set_sensitive(isSensitive);
    }

    _rebuildProfilesList() {
        let child = this._profilesListBox.get_first_child();
        while (child) {
            const next = child.get_next_sibling();
            this._profilesListBox.remove(child);
            child = next;
        }

        this._profiles = normalizeProfiles(this._profiles);
        if (this._profiles.length === 0) {
            const emptyRow = new Adw.ActionRow({
                title: 'No mirror profiles yet',
                subtitle: 'Use Add profile to create one, then fill in the source and target folders below.',
                activatable: false,
            });
            emptyRow.set_sensitive(false);
            emptyRow._profileId = null;
            this._profilesListBox.append(emptyRow);
        }

        for (const profile of this._profiles) {
            const row = new Adw.ActionRow({
                title: profile.name,
                subtitle: `${PROFILE_MODE_LABELS[profile.mode]} • ${formatProfileLocation(profile)}`,
            });
            row._profileId = profile.id;
            if (profile.paused || !profile.enabled) {
                row.add_suffix(new Gtk.Label({
                    label: 'Paused',
                    css_classes: ['caption'],
                }));
            }
            this._profilesListBox.append(row);
        }

        if (this._selectedProfileId) {
            const selectedRow = [...this._iterateListRows(this._profilesListBox)]
                .find(row => row._profileId === this._selectedProfileId);
            if (selectedRow)
                this._profilesListBox.select_row(selectedRow);
        }

        this._setEditorSensitive(Boolean(this._getSelectedProfile()));
    }

    *_iterateListRows(listBox) {
        let child = listBox.get_first_child();
        while (child) {
            yield child;
            child = child.get_next_sibling();
        }
    }

    _getSelectedProfile() {
        if (!this._selectedProfileId)
            return null;

        return this._profiles.find(profile => profile.id === this._selectedProfileId) ?? null;
    }

    _populateEditor() {
        const profile = this._getSelectedProfile();
        if (!profile) {
            this._nameEntry.set_text('');
            this._sourceEntry.set_text('');
            this._targetEntry.set_text('');
            setDropdownValue(this._modeDropdown, PROFILE_MODES[0]);
            setDropdownValue(this._conflictPolicyDropdown, CONFLICT_POLICIES[0]);
            this._enabledSwitch.set_active(false);
            this._watchModeSwitch.set_active(false);
            this._runAtLoginSwitch.set_active(false);
            this._deleteProtectionSwitch.set_active(true);
            this._excludeGitIgnoredSwitch.set_active(true);
            this._includeGitMetadataSwitch.set_active(false);
            this._globalExcludesSwitch.set_active(true);
            setTextViewText(this._excludeRulesView, '');
            this._validationLabel.set_label('Create or select a profile to start editing.');
            this._setEditorSensitive(false);
            return;
        }

        this._setEditorSensitive(true);
        this._nameEntry.set_text(profile.name);
        this._sourceEntry.set_text(profile.sourcePath);
        this._targetEntry.set_text(profile.targetPath);
        setDropdownValue(this._modeDropdown, profile.mode);
        setDropdownValue(this._conflictPolicyDropdown, profile.conflictPolicy);
        this._enabledSwitch.set_active(profile.enabled);
        this._watchModeSwitch.set_active(profile.watchMode);
        this._runAtLoginSwitch.set_active(profile.runAtLogin);
        this._deleteProtectionSwitch.set_active(profile.deleteProtection);
        this._excludeGitIgnoredSwitch.set_active(profile.excludeGitIgnored);
        this._includeGitMetadataSwitch.set_active(profile.includeGitMetadata);
        this._globalExcludesSwitch.set_active(profile.globalExcludesEnabled);
        setTextViewText(this._excludeRulesView, formatExcludeRulesAsLines(profile.excludeRules));
        this._renderValidation(profile);
    }

    _populateDefaults() {
        const helperConfig = loadHelperConfigFromSettings(this._settings);
        this._showIndicatorSwitch.set_active(helperConfig.showIndicator);
        this._showNotificationsSwitch.set_active(helperConfig.showNotifications);
        this._autoStartHelperSwitch.set_active(helperConfig.autoStartHelper);
        this._watchIntervalSpin.set_value(helperConfig.watchIntervalSeconds);
        setDropdownValue(this._logLevelDropdown, helperConfig.logLevel);
        setTextViewText(this._globalExcludesView, formatExcludeRulesAsLines(this._globalExcludes));
    }

    _readProfileForm() {
        const selectedProfile = this._getSelectedProfile() ?? createProfileTemplate();
        return {
            ...selectedProfile,
            name: this._nameEntry.get_text(),
            sourcePath: this._sourceEntry.get_text(),
            targetPath: this._targetEntry.get_text(),
            mode: getDropdownValue(this._modeDropdown),
            conflictPolicy: getDropdownValue(this._conflictPolicyDropdown),
            enabled: this._enabledSwitch.get_active(),
            watchMode: this._watchModeSwitch.get_active(),
            runAtLogin: this._runAtLoginSwitch.get_active(),
            deleteProtection: this._deleteProtectionSwitch.get_active(),
            excludeGitIgnored: this._excludeGitIgnoredSwitch.get_active(),
            includeGitMetadata: this._includeGitMetadataSwitch.get_active(),
            globalExcludesEnabled: this._globalExcludesSwitch.get_active(),
            excludeRules: parseExcludeRulesFromLines(getTextViewText(this._excludeRulesView)),
        };
    }

    _renderValidation(profile) {
        const errors = buildProfileValidationErrors(profile);
        this._validationLabel.set_label(
            errors.length > 0
                ? `Validation: ${errors.join(' ')}`
                : 'Validation: profile looks ready to run.'
        );
    }

    _saveSelectedProfile() {
        const nextProfile = this._readProfileForm();
        const errors = buildProfileValidationErrors(nextProfile);
        if (errors.length > 0) {
            this._renderValidation(nextProfile);
            this._showMessage('Profile validation failed', errors.join(' '));
            return;
        }

        this._profiles = replaceProfile(this._profiles, nextProfile);
        saveProfiles(this._settings, this._profiles);
        this._rebuildProfilesList();
        this._selectedProfileId = nextProfile.id;
        this._populateEditor();
    }

    _addProfile() {
        const profile = createProfileTemplate();
        this._profiles = normalizeProfiles([...this._profiles, profile]);
        this._selectedProfileId = profile.id;
        saveProfiles(this._settings, this._profiles);
        this._rebuildProfilesList();
        this._populateEditor();
    }

    _duplicateSelectedProfile() {
        const selectedProfile = this._getSelectedProfile();
        if (!selectedProfile)
            return;

        this._profiles = duplicateProfile(this._profiles, selectedProfile.id);
        const duplicatedProfile = this._profiles[this._profiles.length - 1];
        this._selectedProfileId = duplicatedProfile.id;
        saveProfiles(this._settings, this._profiles);
        this._rebuildProfilesList();
        this._populateEditor();
    }

    _removeSelectedProfile() {
        const selectedProfile = this._getSelectedProfile();
        if (!selectedProfile)
            return;

        const dialog = createDialog(
            this._window,
            'Remove profile',
            `Remove “${selectedProfile.name}”? This keeps the mirrored folders on disk but deletes the saved profile definition.`
        );
        dialog.add_response('cancel', 'Cancel');
        dialog.add_response('remove', 'Remove');
        dialog.set_response_appearance('remove', Adw.ResponseAppearance.DESTRUCTIVE);
        dialog.connect('response', (_dialog, response) => {
            if (response !== 'remove')
                return;

            this._profiles = removeProfileFromList(this._profiles, selectedProfile.id);
            this._selectedProfileId = this._profiles[0]?.id ?? null;
            saveProfiles(this._settings, this._profiles);
            this._rebuildProfilesList();
            this._populateEditor();
        });
        dialog.present(this._window);
    }

    async _runSelectedProfileDryRun() {
        const editedProfile = this._readProfileForm();
        if (!editedProfile?.id)
            throw new Error('Select a profile first.');

        const errors = buildProfileValidationErrors(editedProfile);
        if (errors.length > 0)
            throw new Error(errors.join(' '));

        this._profiles = replaceProfile(this._profiles, editedProfile);
        saveProfiles(this._settings, this._profiles);
        this._selectedProfileId = editedProfile.id;
        this._rebuildProfilesList();
        this._populateEditor();

        const summary = await invokeHelperStringMethod(
            'RunProfileDryRun',
            new GLib.Variant('(s)', [editedProfile.id])
        );
        this._showMessage('Dry run output', summary);
        await this._refreshDiagnostics();
    }

    _saveDefaults() {
        saveGlobalExcludes(this._settings, parseExcludeRulesFromLines(getTextViewText(this._globalExcludesView)));
        this._globalExcludes = loadGlobalExcludes(this._settings);

        this._settings.set_boolean('show-indicator', this._showIndicatorSwitch.get_active());
        this._settings.set_boolean('show-notifications', this._showNotificationsSwitch.get_active());
        this._settings.set_boolean('auto-start-helper', this._autoStartHelperSwitch.get_active());
        this._settings.set_uint('watch-interval-seconds', this._watchIntervalSpin.get_value_as_int());
        this._settings.set_string('log-level', getDropdownValue(this._logLevelDropdown));

        this._showMessage('Defaults saved', 'Updated global excludes and helper defaults.');
    }

    _restoreDefaultGlobalExcludes() {
        setTextViewText(this._globalExcludesView, formatExcludeRulesAsLines(createDefaultExcludeRules()));
    }

    async _restartHelper() {
        try {
            await invokeHelperVoidMethod('RestartHelper');
        } catch (_error) {
            await restartHelperService();
        }

        await this._refreshDiagnostics();
        this._showMessage('Helper restart requested', `Requested a restart for ${SYSTEMD_UNIT_NAME}.`);
    }

    async _refreshDiagnostics() {
        const snapshot = await getHelperSnapshot();
        this._helperStateRow.subtitle = snapshot.helperState;
        this._helperSummaryRow.subtitle = (
            `${snapshot.counts.healthy} healthy • ${snapshot.counts.syncing} syncing • ${snapshot.counts.paused} paused • ${snapshot.counts.error} attention`
        );
        this._dependenciesRow.subtitle = formatDependencySummary(snapshot) || 'No dependency information reported yet.';
        this._recentErrorsRow.subtitle = snapshot.recentErrors.join('\n') || 'No recent errors reported.';
    }

    _showMessage(title, body) {
        const dialog = createDialog(this._window, title, body);
        dialog.add_response('close', 'Close');
        dialog.present(this._window);
    }
}
