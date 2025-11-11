// prefs.js - SECURE VERSION
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
        // Make all objects local to this function to avoid storing them as instance properties
        const config = new Config();
        let testSession = null; // Track session for cleanup
        
        // Setup cleanup on window close
        window.connect('close-request', () => {
            // Clean up any active sessions
            if (testSession) {
                testSession.abort();
                testSession = null;
            }
            return false; // Allow window to close
        });

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
        const currentProvider = config.get('provider') || 'nightscout';
        providerRow.selected = currentProvider === 'nightscout' ? 0 : 1;

        // Nightscout connection group
        const nightscoutGroup = new Adw.PreferencesGroup({
            title: _('Nightscout Connection'),
            description: _('Configure your Nightscout server connection'),
        });
        page.add(nightscoutGroup);

        // LibreLink connection group
        const librelinkGroup = new Adw.PreferencesGroup({
            title: _('FreeStyle LibreLink Connection'),
            description: _('Configure your LibreLink account for FreeStyle Libre'),
        });
        page.add(librelinkGroup);

        // Function to update provider visibility
        const updateProviderVisibility = (provider) => {
            nightscoutGroup.visible = provider === 'nightscout';
            librelinkGroup.visible = provider === 'librelink';
        };

        providerRow.connect('notify::selected', () => {
            const newProvider = providerRow.selected === 0 ? 'nightscout' : 'librelink';
            config.set('provider', newProvider);
            updateProviderVisibility(newProvider);
        });

        providerGroup.add(providerRow);

        // Nightscout URL
        const urlRow = new Adw.EntryRow({
            title: _('Nightscout URL'),
            text: config.get('nightscoutUrl') || '',
        });
        urlRow.connect('changed', () => {
            config.set('nightscoutUrl', urlRow.text);
        });
        nightscoutGroup.add(urlRow);

        // API Token
        const tokenRow = new Adw.PasswordEntryRow({
            title: _('API Token'),
            text: config.get('apiToken') || '',
        });
        tokenRow.connect('changed', () => {
            config.set('apiToken', tokenRow.text);
        });
        nightscoutGroup.add(tokenRow);

        // Test connection button
        const testConnection = (button) => {
            let nightscoutUrl = config.get('nightscoutUrl');
            const apiToken = config.get('apiToken');

            if (!nightscoutUrl || !apiToken) {
                showToast(window, 'Please enter URL and API token first');
                return;
            }

            // Normalize URL (remove trailing slash)
            nightscoutUrl = nightscoutUrl.endsWith('/') ? nightscoutUrl.slice(0, -1) : nightscoutUrl;

            const url = `${nightscoutUrl}/api/v1/entries.json?count=1&token=${apiToken}`;
            
            button.label = _('Testing...');
            button.sensitive = false;

            // Create session for this test
            testSession = new Soup.Session({ timeout: 10 });
            const message = Soup.Message.new('GET', url);
            
            if (!message) {
                showToast(window, 'Could not create Soup message. Check URL format.');
                button.label = _('Test Connection');
                button.sensitive = true;
                testSession = null;
                return;
            }

            testSession.send_and_read_async(message, GLib.PRIORITY_DEFAULT, null, (session, result) => {
                try {
                    const bytes = session.send_and_read_finish(result);
                    const status = message.get_status();
                    
                    if (status === 200) {
                        const decoder = new TextDecoder('utf-8');
                        const response = decoder.decode(bytes.get_data());
                        
                        try {
                            const data = JSON.parse(response);
                            if (data && data.length > 0) {
                                const glucose = Math.round(data[0].sgv).toString();
                                const units = config.get('units') || 'mg/dL';
                                let displayGlucose = glucose;
                                if (units === 'mmol/L') {
                                    displayGlucose = (glucose / 18).toFixed(1);
                                }
                                showToast(window, `✓ Connected! Latest: ${displayGlucose} ${units}`);
                            } else {
                                showToast(window, '⚠ Connected but no data found');
                            }
                        } catch (parseError) {
                            showToast(window, '✗ Invalid response format');
                        }
                    } else {
                        showToast(window, `✗ Failed: HTTP ${status}`);
                    }
                } catch (error) {
                    showToast(window, `✗ Connection failed: ${error.message}`);
                } finally {
                    // Always reset button state and cleanup session
                    button.label = _('Test Connection');
                    button.sensitive = true;
                    if (testSession) {
                        testSession.abort();
                        testSession = null;
                    }
                }
            });
        };

        const testButton = new Gtk.Button({
            label: _('Test Connection'),
            css_classes: ['suggested-action'],
        });
        testButton.connect('clicked', () => {
            testConnection(testButton);
        });
        
        const testRow = new Adw.ActionRow({
            title: _('Test Nightscout Connection'),
            subtitle: _('Verify your settings work correctly'),
        });
        testRow.add_suffix(testButton);
        nightscoutGroup.add(testRow);

        // LibreLink email
        const librelinkConfig = config.get('librelink') || {};
        const emailRow = new Adw.EntryRow({
            title: _('LibreLink Email'),
            text: librelinkConfig.email || '',
        });
        emailRow.connect('changed', () => {
            let currentConfig = config.get('librelink') || {};
            currentConfig.email = emailRow.text;
            config.set('librelink', currentConfig);
        });
        librelinkGroup.add(emailRow);

        // LibreLink password - CHANGED: Don't load from config, use placeholder
        const passwordRow = new Adw.PasswordEntryRow({
            title: librelinkConfig.password ? '••••••••' : 'Enter password',
        });
        // We don't connect changed event here anymore - password is handled separately
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
            let currentConfig = config.get('librelink') || {};
            currentConfig.region = regions[regionRow.selected];
            config.set('librelink', currentConfig);
        });
        librelinkGroup.add(regionRow);

        // LibreLink test connection button - UPDATED for secure password handling
        const testLibreLinkConnection = async (button) => {
            const librelinkCurrentConfig = config.get('librelink') || {};
            
            if (!librelinkCurrentConfig.email) {
                showToast(window, 'Please enter LibreLink email first');
                return;
            }

            if (!passwordRow.text) {
                showToast(window, 'Please enter LibreLink password first');
                return;
            }

            button.label = _('Testing...');
            button.sensitive = false;

            try {
                // Store password securely in keyring first
                const storeSuccess = await config.storeLibreLinkPassword(passwordRow.text);
                if (!storeSuccess) {
                    throw new Error('Failed to store password securely');
                }

                // Import the LibreLinkProvider for testing
                const { LibreLinkProvider } = await import('./providers/LibreLinkProvider.js');
                const provider = new LibreLinkProvider(config, (message) => {
                    console.log(`[CGM LibreLink Test] ${message}`);
                });

                // Test the connection
                try {
                    const data = await provider.fetchCurrent();
                    if (data && data.sgv) {
                        const glucose = Math.round(data.sgv).toString();
                        const units = config.get('units') || 'mg/dL';
                        let displayGlucose = glucose;
                        if (units === 'mmol/L') {
                            displayGlucose = (glucose / 18).toFixed(1);
                        }
                        const timestamp = new Date(data.dateString).toLocaleTimeString();
                        showToast(window, `✓ LibreLink Connected! Latest: ${displayGlucose} ${units} at ${timestamp}`);
                    } else {
                        showToast(window, '✓ LibreLink Connected but no current data found');
                    }
                } catch (fetchError) {
                    console.error('LibreLink test error:', fetchError);
                    showToast(window, `✗ LibreLink Failed: ${fetchError.message}`);
                } finally {
                    provider.destroy();
                }
            } catch (error) {
                console.error('Failed to test LibreLink connection:', error);
                showToast(window, `✗ LibreLink Failed: ${error.message}`);
            } finally {
                button.label = _('Test LibreLink Connection');
                button.sensitive = true;
                // Clear the password field for security
                passwordRow.text = '';
            }
        };

        const librelinkTestButton = new Gtk.Button({
            label: _('Test LibreLink Connection'),
            css_classes: ['suggested-action'],
        });
        librelinkTestButton.connect('clicked', () => {
            testLibreLinkConnection(librelinkTestButton);
        });

        const librelinkTestRow = new Adw.ActionRow({
            title: _('Test LibreLink Connection'),
            subtitle: _('Verify your LibreLink credentials work correctly'),
        });
        librelinkTestRow.add_suffix(librelinkTestButton);
        librelinkGroup.add(librelinkTestRow);

        // Add a button to clear stored LibreLink credentials
        const clearCredentialsButton = new Gtk.Button({
            label: _('Clear Stored Credentials'),
            css_classes: ['destructive-action'],
        });
        clearCredentialsButton.connect('clicked', async () => {
            try {
                const success = await config.clearLibreLinkPassword();
                if (success) {
                    showToast(window, '✓ LibreLink credentials cleared from keyring');
                    passwordRow.title = 'Enter password';
                } else {
                    showToast(window, '✗ Failed to clear credentials');
                }
            } catch (error) {
                showToast(window, `✗ Error clearing credentials: ${error.message}`);
            }
        });

        const clearCredentialsRow = new Adw.ActionRow({
            title: _('Clear Stored Password'),
            subtitle: _('Remove your LibreLink password from secure storage'),
        });
        clearCredentialsRow.add_suffix(clearCredentialsButton);
        librelinkGroup.add(clearCredentialsRow);

        // [Rest of the file remains the same - glucose thresholds, display settings, etc.]
        // Glucose thresholds group
        const thresholdGroup = new Adw.PreferencesGroup({
            title: _('Glucose Thresholds'),
        });
        page.add(thresholdGroup);

        const thresholds = config.get('thresholds');

        // Low threshold
        const lowRow = new Adw.SpinRow({
            title: _('Low Threshold'),
            digits: 1,
        });
        thresholdGroup.add(lowRow);

        // High threshold
        const highRow = new Adw.SpinRow({
            title: _('High Threshold'),
            digits: 1,
        });
        thresholdGroup.add(highRow);

        // Display settings group
        const displayGroup = new Adw.PreferencesGroup({
            title: _('Display Settings'),
            description: _('Configure how data is displayed'),
        });
        page.add(displayGroup);

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
        const currentWindow = config.get('graphHours') || 6;
        const windowIndex = [3, 6, 12, 24].indexOf(currentWindow);
        timeWindowRow.selected = windowIndex >= 0 ? windowIndex : 1; // Default to 6 hours
        
        timeWindowRow.connect('notify::selected', () => {
            const hours = [3, 6, 12, 24][timeWindowRow.selected];
            config.set('graphHours', hours);
        });
        displayGroup.add(timeWindowRow);

        // Units selection
        const unitsRow = new Adw.ComboRow({
            title: _('Glucose Units'),
            subtitle: _('Choose the unit for displaying glucose values'),
        });

        const unitsModel = new Gtk.StringList();
        unitsModel.append('mg/dL');
        unitsModel.append('mmol/L');
        unitsRow.model = unitsModel;

        const currentUnits = config.get('units') || 'mg/dL';
        unitsRow.selected = currentUnits === 'mg/dL' ? 0 : 1;

        displayGroup.add(unitsRow);

        const updateThresholdsUI = (units) => {
            const isMmol = units === 'mmol/L';
            const conversionFactor = 18;

            let lowValue, highValue;
            if (isMmol) {
                lowValue = (config.get('thresholds').low / conversionFactor).toFixed(1);
                highValue = (config.get('thresholds').high / conversionFactor).toFixed(1);
            } else {
                lowValue = config.get('thresholds').low;
                highValue = config.get('thresholds').high;
            }
            
            lowRow.subtitle = _(`Values below this will be colored red (${units})`);
            lowRow.adjustment = new Gtk.Adjustment({
                lower: isMmol ? 2.0 : 36,
                upper: isMmol ? 6.0 : 108,
                step_increment: isMmol ? 0.1 : 1,
                page_increment: isMmol ? 0.5 : 9,
                value: lowValue,
            });
            lowRow.digits = isMmol ? 1 : 0;

            highRow.subtitle = _(`Values above this will be colored orange (${units})`);
            highRow.adjustment = new Gtk.Adjustment({
                lower: isMmol ? 6.0 : 108,
                upper: isMmol ? 15.0 : 270,
                step_increment: isMmol ? 0.1 : 1,
                page_increment: isMmol ? 0.5 : 9,
                value: highValue,
            });
            highRow.digits = isMmol ? 1 : 0;

            thresholdGroup.description = _(`Configure glucose level thresholds for color coding (${units})`);
        };
        
        unitsRow.connect('notify::selected', () => {
            const newUnits = unitsRow.selected === 0 ? 'mg/dL' : 'mmol/L';
            config.set('units', newUnits);

            // When changing units, reset thresholds to default values
            const isMmol = newUnits === 'mmol/L';
            let thresholds = config.get('thresholds');
            if (isMmol) {
                thresholds.low = 72; // 4.0 mmol/L
                thresholds.high = 180; // 10.0 mmol/L
            } else {
                thresholds.low = 70;
                thresholds.high = 180;
            }
            config.set('thresholds', thresholds);

            updateThresholdsUI(newUnits);
        });

        // Initial UI setup
        updateThresholdsUI(currentUnits);

        // Connect threshold change events
        lowRow.connect('changed', () => {
            let thresholds = config.get('thresholds');
            const isMmol = config.get('units') === 'mmol/L';
            thresholds.low = isMmol ? Math.round(lowRow.value * 18) : lowRow.value;
            config.set('thresholds', thresholds);
        });
        highRow.connect('changed', () => {
            let thresholds = config.get('thresholds');
            const isMmol = config.get('units') === 'mmol/L';
            thresholds.high = isMmol ? Math.round(highRow.value * 18) : highRow.value;
            config.set('thresholds', thresholds);
        });

        // Stale data timeout
        const staleRow = new Adw.SpinRow({
            title: _('Stale Data Timeout'),
            subtitle: _('Minutes after which data is considered stale (displayed in gray)'),
            adjustment: new Gtk.Adjustment({
                lower: 1,
                upper: 60,
                step_increment: 1,
                page_increment: 5,
                value: config.get('staleMinutes') || 10,
            }),
            digits: 0,
        });
        staleRow.connect('changed', () => {
            config.set('staleMinutes', staleRow.value);
        });
        displayGroup.add(staleRow);

        // Notifications group
        const notificationGroup = new Adw.PreferencesGroup({
            title: _('Notifications'),
            description: _('Configure system notifications for glucose alerts'),
        });
        page.add(notificationGroup);

        const notifications = config.get('notifications');

        const enableNotificationsRow = new Adw.SwitchRow({
            title: _('Enable Notifications'),
            subtitle: _('Show a system notification for glucose alerts'),
            active: notifications.enabled,
        });
        enableNotificationsRow.connect('notify::active', (widget) => {
            let current = config.get('notifications');
            current.enabled = widget.active;
            config.set('notifications', current);
        });
        notificationGroup.add(enableNotificationsRow);

        const lowNotificationRow = new Adw.SwitchRow({
            title: _('Low Glucose Alert'),
            active: notifications.low,
        });
        lowNotificationRow.connect('notify::active', (widget) => {
            let current = config.get('notifications');
            current.low = widget.active;
            config.set('notifications', current);
        });
        notificationGroup.add(lowNotificationRow);

        const highNotificationRow = new Adw.SwitchRow({
            title: _('High Glucose Alert'),
            active: notifications.high,
        });
        highNotificationRow.connect('notify::active', (widget) => {
            let current = config.get('notifications');
            current.high = widget.active;
            config.set('notifications', current);
        });
        notificationGroup.add(highNotificationRow);

        // Appearance group
        const appearanceGroup = new Adw.PreferencesGroup({
            title: _('Appearance'),
            description: _('Customize the look of the widget and graph'),
        });
        page.add(appearanceGroup);

        // Color row creation function
        const createColorRow = (title, key) => {
            const colors = config.get('colors');
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
                const newColors = config.get('colors');
                newColors[key] = colorButton.get_rgba().to_string();
                config.set('colors', newColors);
            });

            return colorRow;
        };

        appearanceGroup.add(createColorRow(_('Low Color'), 'low'));
        appearanceGroup.add(createColorRow(_('High Color'), 'high'));
        appearanceGroup.add(createColorRow(_('Normal Color'), 'normal'));

        // Debugging group
        const debugGroup = new Adw.PreferencesGroup({
            title: _('Debugging'),
        });
        page.add(debugGroup);

        const debugRow = new Adw.SwitchRow({
            title: _('Enable Debug Logging'),
            subtitle: _('Logs detailed information to the system log. Requires a restart of the extension.'),
            active: config.get('debug'),
        });
        debugRow.connect('notify::active', (widget) => {
            config.set('debug', widget.active);
        });
        debugGroup.add(debugRow);

        // Set initial visibility based on current provider
        updateProviderVisibility(currentProvider);
    }
}

// Helper functions (moved outside class to be local to module)
function showToast(window, message) {
    const toast = new Adw.Toast({
        title: message,
        timeout: 3,
    });
    window.add_toast(toast);
}