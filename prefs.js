// prefs.js
import Adw from 'gi://Adw';
import Gtk from 'gi://Gtk';
import Gdk from 'gi://Gdk';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Soup from 'gi://Soup';

import {ExtensionPreferences, gettext as _} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

import { Config } from './config.js';

export default class CGMPreferences extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        this._window = window;
        // Create settings schema (we'll manage our own config file)
        this._config = new Config();

        // Create the main page
        const page = new Adw.PreferencesPage({
            title: _('CGM Widget Settings'),
            icon_name: 'applications-system-symbolic',
        });
        window.add(page);

        // Provider selection group
        const providerGroup = new Adw.PreferencesGroup({
            title: _('Data Provider'),
            description: _('Choose your CGM data source'),
        });
        page.add(providerGroup);

        // Provider selection dropdown
        const providerRow = new Adw.ComboRow({
            title: _('CGM Provider'),
            subtitle: _('Select your continuous glucose monitor data source'),
        });

        const providerModel = new Gtk.StringList();
        providerModel.append('Nightscout');
        providerModel.append('FreeStyle LibreLink');
        providerRow.model = providerModel;

        // Set current selection
        const currentProvider = this._config.get('provider') || 'nightscout';
        providerRow.selected = currentProvider === 'nightscout' ? 0 : 1;

        providerRow.connect('notify::selected', () => {
            const newProvider = providerRow.selected === 0 ? 'nightscout' : 'librelink';
            this._config.set('provider', newProvider);
            this._updateProviderVisibility(newProvider);
        });

        providerGroup.add(providerRow);

        // Nightscout connection group
        const connectionGroup = new Adw.PreferencesGroup({
            title: _('Nightscout Connection'),
            description: _('Configure your Nightscout server connection'),
        });
        page.add(connectionGroup);

        // Store reference for visibility control
        this._nightscoutGroup = connectionGroup;

        // Nightscout URL
        const urlRow = new Adw.EntryRow({
            title: _('Nightscout URL'),
            text: this._config.get('nightscoutUrl') || '',
        });
        urlRow.connect('changed', () => {
            this._config.set('nightscoutUrl', urlRow.text);
        });
        connectionGroup.add(urlRow);

        // API Token
        const tokenRow = new Adw.PasswordEntryRow({
            title: _('API Token'),
            text: this._config.get('apiToken') || '',
        });
        tokenRow.connect('changed', () => {
            this._config.set('apiToken', tokenRow.text);
        });
        connectionGroup.add(tokenRow);

        // Test connection button
        const testButton = new Gtk.Button({
            label: _('Test Connection'),
            css_classes: ['suggested-action'],
        });
        testButton.connect('clicked', () => {
            this._testConnection(testButton);
        });
        
        const testRow = new Adw.ActionRow({
            title: _('Test Nightscout Connection'),
            subtitle: _('Verify your settings work correctly'),
        });
        testRow.add_suffix(testButton);
        connectionGroup.add(testRow);

        // LibreLink connection group
        const librelinkGroup = new Adw.PreferencesGroup({
            title: _('FreeStyle LibreLink Connection'),
            description: _('Configure your LibreLink account for FreeStyle Libre'),
        });
        page.add(librelinkGroup);

        // Store reference for visibility control  
        this._librelinkGroup = librelinkGroup;

        // LibreLink email
        const librelinkConfig = this._config.get('librelink') || {};
        const emailRow = new Adw.EntryRow({
            title: _('LibreLink Email'),
            text: librelinkConfig.email || '',
        });
        emailRow.connect('changed', () => {
            let config = this._config.get('librelink') || {};
            config.email = emailRow.text;
            this._config.set('librelink', config);
        });
        librelinkGroup.add(emailRow);

        // LibreLink password
        const passwordRow = new Adw.PasswordEntryRow({
            title: _('LibreLink Password'),
            text: librelinkConfig.password || '',
        });
        passwordRow.connect('changed', () => {
            let config = this._config.get('librelink') || {};
            config.password = passwordRow.text;
            this._config.set('librelink', config);
        });
        librelinkGroup.add(passwordRow);

        // LibreLink region
        const regionRow = new Adw.ComboRow({
            title: _('Region'),
            subtitle: _('Select your LibreLink server region'),
        });

        const regionModel = new Gtk.StringList();
        regionModel.append('Europe (EU)');
        regionModel.append('United States (US)');
        regionModel.append('Germany (DE)');
        regionModel.append('France (FR)');
        regionModel.append('Japan (JP)');
        regionModel.append('Asia Pacific (AP)');
        regionModel.append('Australia (AU)');
        regionModel.append('Russia (RU)');
        regionRow.model = regionModel;

        // Set current region selection
        const regionMap = { 'EU': 0, 'US': 1, 'DE': 2, 'FR': 3, 'JP': 4, 'AP': 5, 'AU': 6, 'RU': 7 };
        const currentRegion = librelinkConfig.region || 'EU';
        regionRow.selected = regionMap[currentRegion] || 0;

        regionRow.connect('notify::selected', () => {
            const regions = ['EU', 'US', 'DE', 'FR', 'JP', 'AP', 'AU', 'RU'];
            let config = this._config.get('librelink') || {};
            config.region = regions[regionRow.selected];
            this._config.set('librelink', config);
        });
        librelinkGroup.add(regionRow);

        // LibreLink test connection button
        const librelinkTestButton = new Gtk.Button({
            label: _('Test LibreLink Connection'),
            css_classes: ['suggested-action'],
        });
        librelinkTestButton.connect('clicked', () => {
            this._testLibreLinkConnection(librelinkTestButton);
        });

        const librelinkTestRow = new Adw.ActionRow({
            title: _('Test LibreLink Connection'),
            subtitle: _('Verify your LibreLink credentials work correctly'),
        });
        librelinkTestRow.add_suffix(librelinkTestButton);
        librelinkGroup.add(librelinkTestRow);

        // Glucose thresholds group
        const thresholdGroup = new Adw.PreferencesGroup({
            title: _('Glucose Thresholds'),
            description: _('Configure glucose level thresholds for color coding'),
        });
        page.add(thresholdGroup);

        const currentUnits = this._config.get('units') || 'mmol/L';
        const isMmol = currentUnits === 'mmol/L';

        // Low threshold
        const lowRow = new Adw.SpinRow({
            title: _('Low Threshold'),
        });
        thresholdGroup.add(lowRow);

        // High threshold
        const highRow = new Adw.SpinRow({
            title: _('High Threshold'),
        });
        thresholdGroup.add(highRow);

        // Display settings group
        const displayGroup = new Adw.PreferencesGroup({
            title: _('Display Settings'),
            description: _('Configure how data is displayed'),
        });
        page.add(displayGroup);

        // Units selection
        const unitsRow = new Adw.ComboRow({
            title: _('Glucose Units'),
            subtitle: _('Choose between mmol/L and mg/dL'),
        });
        
        const unitsModel = new Gtk.StringList();
        unitsModel.append('mmol/L');
        unitsModel.append('mg/dL');
        unitsRow.model = unitsModel;
        unitsRow.selected = isMmol ? 0 : 1;
        
        unitsRow.connect('notify::selected', () => {
            const newUnits = unitsRow.selected === 0 ? 'mmol/L' : 'mg/dL';
            if (this._config.get('units') !== newUnits) {
                this._config.set('units', newUnits);
                this._updateThresholdsUI(newUnits === 'mmol/L');
            }
        });
        displayGroup.add(unitsRow);

        // Connect change events after unitsRow is set up
        lowRow.connect('changed', () => {
            let thresholds = this._config.get('thresholds');
            thresholds.low = this._convertThresholdFromDisplay(lowRow.value, this._config.get('units') === 'mmol/L');
            this._config.set('thresholds', thresholds);
        });
        highRow.connect('changed', () => {
            let thresholds = this._config.get('thresholds');
            thresholds.high = this._convertThresholdFromDisplay(highRow.value, this._config.get('units') === 'mmol/L');
            this._config.set('thresholds', thresholds);
        });

        // Initial UI setup for thresholds
        this._lowRow = lowRow;
        this._highRow = highRow;
        this._updateThresholdsUI(isMmol);

        // Graph time window
        const timeWindowRow = new Adw.ComboRow({
            title: _('Graph Time Window'),
            subtitle: _('How much history to show in the graph'),
        });
        
        const timeWindowModel = new Gtk.StringList();
        timeWindowModel.append('3 hours');
        timeWindowModel.append('6 hours');
        timeWindowModel.append('12 hours');
        timeWindowModel.append('24 hours');
        timeWindowRow.model = timeWindowModel;
        
        // Set current selection
        const currentWindow = this._config.get('graphHours') || 6;
        const windowIndex = [3, 6, 12, 24].indexOf(currentWindow);
        timeWindowRow.selected = windowIndex >= 0 ? windowIndex : 1; // Default to 6 hours
        
        timeWindowRow.connect('notify::selected', () => {
            const hours = [3, 6, 12, 24][timeWindowRow.selected];
            this._config.set('graphHours', hours);
        });
        displayGroup.add(timeWindowRow);

        // Stale data timeout
        const staleRow = new Adw.SpinRow({
            title: _('Stale Data Timeout'),
            subtitle: _('Minutes after which data is considered stale (displayed in gray)'),
            adjustment: new Gtk.Adjustment({
                lower: 1,
                upper: 60,
                step_increment: 1,
                page_increment: 5,
                value: this._config.get('staleMinutes') || 10,
            }),
            digits: 0,
        });
        staleRow.connect('changed', () => {
            this._config.set('staleMinutes', staleRow.value);
        });
        displayGroup.add(staleRow);

        // Notifications group
        const notificationGroup = new Adw.PreferencesGroup({
            title: _('Notifications'),
            description: _('Configure system notifications for glucose alerts'),
        });
        page.add(notificationGroup);

        const notifications = this._config.get('notifications');

        const enableNotificationsRow = new Adw.SwitchRow({
            title: _('Enable Notifications'),
            subtitle: _('Show a system notification for glucose alerts'),
            active: notifications.enabled,
        });
        enableNotificationsRow.connect('notify::active', (widget) => {
            let current = this._config.get('notifications');
            current.enabled = widget.active;
            this._config.set('notifications', current);
        });
        notificationGroup.add(enableNotificationsRow);

        const lowNotificationRow = new Adw.SwitchRow({
            title: _('Low Glucose Alert'),
            active: notifications.low,
        });
        lowNotificationRow.connect('notify::active', (widget) => {
            let current = this._config.get('notifications');
            current.low = widget.active;
            this._config.set('notifications', current);
        });
        notificationGroup.add(lowNotificationRow);

        const highNotificationRow = new Adw.SwitchRow({
            title: _('High Glucose Alert'),
            active: notifications.high,
        });
        highNotificationRow.connect('notify::active', (widget) => {
            let current = this._config.get('notifications');
            current.high = widget.active;
            this._config.set('notifications', current);
        });
        notificationGroup.add(highNotificationRow);

        // Appearance group
        const appearanceGroup = new Adw.PreferencesGroup({
            title: _('Appearance'),
            description: _('Customize the look of the widget and graph'),
        });
        page.add(appearanceGroup);

        appearanceGroup.add(this._createColorRow(_('Low Color'), 'low'));
        appearanceGroup.add(this._createColorRow(_('High Color'), 'high'));
        appearanceGroup.add(this._createColorRow(_('Normal Color'), 'normal'));

        // Debugging group
        const debugGroup = new Adw.PreferencesGroup({
            title: _('Debugging'),
        });
        page.add(debugGroup);

        const debugRow = new Adw.SwitchRow({
            title: _('Enable Debug Logging'),
            subtitle: _('Logs detailed information to the system log. Requires a restart of the extension.'),
            active: this._config.get('debug'),
        });
        debugRow.connect('notify::active', (widget) => {
            this._config.set('debug', widget.active);
        });
        debugGroup.add(debugRow);

        // Set initial visibility based on current provider
        this._updateProviderVisibility(currentProvider);
    }

    _updateProviderVisibility(provider) {
        if (this._nightscoutGroup && this._librelinkGroup) {
            this._nightscoutGroup.visible = provider === 'nightscout';
            this._librelinkGroup.visible = provider === 'librelink';
        }
    }

    _testLibreLinkConnection(button) {
        const librelinkConfig = this._config.get('librelink') || {};
        
        if (!librelinkConfig.email || !librelinkConfig.password) {
            this._showToast('Please enter LibreLink email and password first');
            return;
        }

        button.label = _('Testing...');
        button.sensitive = false;

        // Import the LibreLinkProvider for testing
        import('./providers/LibreLinkProvider.js').then(({ LibreLinkProvider }) => {
            const provider = new LibreLinkProvider(this._config, (message) => {
                console.log(`[CGM LibreLink Test] ${message}`);
            });

            // Test the connection
            provider.fetchCurrent()
                .then(data => {
                    if (data && data.sgv) {
                        const glucose = this._formatGlucoseValue(data.sgv);
                        const units = this._config.get('units') || 'mmol/L';
                        const timestamp = new Date(data.dateString).toLocaleTimeString();
                        this._showToast(`✓ LibreLink Connected! Latest: ${glucose} ${units} at ${timestamp}`);
                    } else {
                        this._showToast('✓ LibreLink Connected but no current data found');
                    }
                })
                .catch(error => {
                    console.error('LibreLink test error:', error);
                    this._showToast(`✗ LibreLink Failed: ${error.message}`);
                })
                .finally(() => {
                    button.label = _('Test LibreLink Connection');
                    button.sensitive = true;
                    provider.destroy();
                });
                
        }).catch(error => {
            console.error('Failed to import LibreLinkProvider:', error);
            this._showToast('✗ Failed to load LibreLink provider');
            button.label = _('Test LibreLink Connection');
            button.sensitive = true;
        });
    }

    _createColorRow(title, key) {
        const colors = this._config.get('colors');
        const gdkColor = new Gdk.RGBA();
        gdkColor.parse(colors[key]);

        const colorRow = new Adw.ActionRow({ title: title });

        const colorButton = new Gtk.ColorButton({
            rgba: gdkColor,
            use_alpha: true,
        });

        colorRow.add_suffix(colorButton);
        colorRow.activatable_widget = colorButton;

        colorButton.connect('color-set', () => {
            const newColors = this._config.get('colors');
            newColors[key] = colorButton.get_rgba().to_string();
            this._config.set('colors', newColors);
        });

        return colorRow;
    }

    _updateThresholdsUI(isMmol) {
        const thresholds = this._config.get('thresholds');
        // Low threshold
        this._lowRow.subtitle = isMmol ? _('Values below this will be colored red (mmol/L)') : _('Values below this will be colored red (mg/dL)');
        this._lowRow.adjustment = new Gtk.Adjustment({
            lower: isMmol ? 2.0 : 36,
            upper: isMmol ? 6.0 : 108,
            step_increment: isMmol ? 0.1 : 1,
            page_increment: isMmol ? 0.5 : 9,
            value: this._convertThresholdForDisplay(thresholds.low, isMmol),
        });
        this._lowRow.digits = isMmol ? 1 : 0;

        // High threshold
        this._highRow.subtitle = isMmol ? _('Values above this will be colored orange (mmol/L)') : _('Values above this will be colored orange (mg/dL)');
        this._highRow.adjustment = new Gtk.Adjustment({
            lower: isMmol ? 6.0 : 108,
            upper: isMmol ? 15.0 : 270,
            step_increment: isMmol ? 0.1 : 1,
            page_increment: isMmol ? 0.5 : 9,
            value: this._convertThresholdForDisplay(thresholds.high, isMmol),
        });
        this._highRow.digits = isMmol ? 1 : 0;
    }

    _testConnection(button) {
        let nightscoutUrl = this._config.get('nightscoutUrl');
        const apiToken = this._config.get('apiToken');

        if (!nightscoutUrl || !apiToken) {
            this._showToast('Please enter URL and API token first');
            return;
        }

        // Normalize URL (remove trailing slash)
        nightscoutUrl = nightscoutUrl.endsWith('/') ? nightscoutUrl.slice(0, -1) : nightscoutUrl;

        const url = `${nightscoutUrl}/api/v1/entries.json?count=1&token=${apiToken}`;
        
        button.label = _('Testing...');
        button.sensitive = false;

        const session = new Soup.Session({ timeout: 10 });
        const message = Soup.Message.new('GET', url);
        
        if (!message) {
            this._showToast('Could not create Soup message. Check URL format.');
            button.label = _('Test Connection');
            button.sensitive = true;
            return;
        }

        session.send_and_read_async(message, GLib.PRIORITY_DEFAULT, null, (session, result) => {
            try {
                const bytes = session.send_and_read_finish(result);
                const status = message.get_status();
                
                if (status === 200) {
                    const decoder = new TextDecoder('utf-8');
                    const response = decoder.decode(bytes.get_data());
                    
                    try {
                        const data = JSON.parse(response);
                        if (data && data.length > 0) {
                            const glucose = this._formatGlucoseValue(data[0].sgv);
                            const units = this._config.get('units') || 'mmol/L';
                            this._showToast(`✓ Connected! Latest: ${glucose} ${units}`);
                        } else {
                            this._showToast('⚠ Connected but no data found');
                        }
                    } catch (parseError) {
                        this._showToast('✗ Invalid response format');
                    }
                } else {
                    this._showToast(`✗ Failed: HTTP ${status}`);
                }
            } catch (error) {
                this._showToast(`✗ Connection failed: ${error.message}`);
            } finally {
                // Always reset button state
                button.label = _('Test Connection');
                button.sensitive = true;
            }
        });
    }

    _showToast(message) {
        const toast = new Adw.Toast({
            title: message,
            timeout: 3,
        });
        this._window.add_toast(toast);
    }

    _convertThresholdForDisplay(mmolValue, isMmol) {
        if (isMmol) {
            return mmolValue;
        } else {
            return Math.round(mmolValue * 18); // Convert mmol/L to mg/dL
        }
    }

    _convertThresholdFromDisplay(displayValue, isMmol) {
        if (isMmol) {
            return displayValue;
        } else {
            return displayValue / 18; // Convert mg/dL to mmol/L for storage
        }
    }

    _formatGlucoseValue(mgdlValue) {
        const units = this._config.get('units') || 'mmol/L';
        if (units === 'mmol/L') {
            return (mgdlValue / 18).toFixed(1);
        } else {
            return Math.round(mgdlValue).toString();
        }
    }
}
