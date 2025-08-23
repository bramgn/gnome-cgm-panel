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
                                const glucose = formatGlucoseValue(data[0].sgv, config.get('units') || 'mmol/L');
                                const units = config.get('units') || 'mmol/L';
                                showToast(window, `✓ Connected! Latest: ${glucose} ${units}`);
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

        // LibreLink password
        const passwordRow = new Adw.PasswordEntryRow({
            title: _('LibreLink Password'),
            text: librelinkConfig.password || '',
        });
        passwordRow.connect('changed', () => {
            let currentConfig = config.get('librelink') || {};
            currentConfig.password = passwordRow.text;
            config.set('librelink', currentConfig);
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
            let currentConfig = config.get('librelink') || {};
            currentConfig.region = regions[regionRow.selected];
            config.set('librelink', currentConfig);
        });
        librelinkGroup.add(regionRow);

        // LibreLink test connection button
        const testLibreLinkConnection = (button) => {
            const librelinkCurrentConfig = config.get('librelink') || {};
            
            if (!librelinkCurrentConfig.email || !librelinkCurrentConfig.password) {
                showToast(window, 'Please enter LibreLink email and password first');
                return;
            }

            button.label = _('Testing...');
            button.sensitive = false;

            // Import the LibreLinkProvider for testing
            import('./providers/LibreLinkProvider.js').then(({ LibreLinkProvider }) => {
                const provider = new LibreLinkProvider(config, (message) => {
                    console.log(`[CGM LibreLink Test] ${message}`);
                });

                // Test the connection
                provider.fetchCurrent()
                    .then(data => {
                        if (data && data.sgv) {
                            const glucose = formatGlucoseValue(data.sgv, config.get('units') || 'mmol/L');
                            const units = config.get('units') || 'mmol/L';
                            const timestamp = new Date(data.dateString).toLocaleTimeString();
                            showToast(window, `✓ LibreLink Connected! Latest: ${glucose} ${units} at ${timestamp}`);
                        } else {
                            showToast(window, '✓ LibreLink Connected but no current data found');
                        }
                    })
                    .catch(error => {
                        console.error('LibreLink test error:', error);
                        showToast(window, `✗ LibreLink Failed: ${error.message}`);
                    })
                    .finally(() => {
                        button.label = _('Test LibreLink Connection');
                        button.sensitive = true;
                        provider.destroy();
                    });
                    
            }).catch(error => {
                console.error('Failed to import LibreLinkProvider:', error);
                showToast(window, '✗ Failed to load LibreLink provider');
                button.label = _('Test LibreLink Connection');
                button.sensitive = true;
            });
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

        // Glucose thresholds group
        const thresholdGroup = new Adw.PreferencesGroup({
            title: _('Glucose Thresholds'),
            description: _('Configure glucose level thresholds for color coding'),
        });
        page.add(thresholdGroup);

        const currentUnits = config.get('units') || 'mmol/L';
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

        // Function to update thresholds UI
        const updateThresholdsUI = (isMmol) => {
            const thresholds = config.get('thresholds');
            // Low threshold
            lowRow.subtitle = isMmol ? _('Values below this will be colored red (mmol/L)') : _('Values below this will be colored red (mg/dL)');
            lowRow.adjustment = new Gtk.Adjustment({
                lower: isMmol ? 2.0 : 36,
                upper: isMmol ? 6.0 : 108,
                step_increment: isMmol ? 0.1 : 1,
                page_increment: isMmol ? 0.5 : 9,
                value: convertThresholdForDisplay(thresholds.low, isMmol),
            });
            lowRow.digits = isMmol ? 1 : 0;

            // High threshold
            highRow.subtitle = isMmol ? _('Values above this will be colored orange (mmol/L)') : _('Values above this will be colored orange (mg/dL)');
            highRow.adjustment = new Gtk.Adjustment({
                lower: isMmol ? 6.0 : 108,
                upper: isMmol ? 15.0 : 270,
                step_increment: isMmol ? 0.1 : 1,
                page_increment: isMmol ? 0.5 : 9,
                value: convertThresholdForDisplay(thresholds.high, isMmol),
            });
            highRow.digits = isMmol ? 1 : 0;
        };

        // Connect threshold change events
        lowRow.connect('changed', () => {
            let thresholds = config.get('thresholds');
            thresholds.low = convertThresholdFromDisplay(lowRow.value, config.get('units') === 'mmol/L');
            config.set('thresholds', thresholds);
        });
        highRow.connect('changed', () => {
            let thresholds = config.get('thresholds');
            thresholds.high = convertThresholdFromDisplay(highRow.value, config.get('units') === 'mmol/L');
            config.set('thresholds', thresholds);
        });

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
            if (config.get('units') !== newUnits) {
                config.set('units', newUnits);
                updateThresholdsUI(newUnits === 'mmol/L');
            }
        });
        displayGroup.add(unitsRow);

        // Initial UI setup for thresholds
        updateThresholdsUI(isMmol);

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

function convertThresholdForDisplay(mmolValue, isMmol) {
    if (isMmol) {
        return mmolValue;
    } else {
        return Math.round(mmolValue * 18); // Convert mmol/L to mg/dL
    }
}

function convertThresholdFromDisplay(displayValue, isMmol) {
    if (isMmol) {
        return displayValue;
    } else {
        return displayValue / 18; // Convert mg/dL to mmol/L for storage
    }
}

function formatGlucoseValue(mgdlValue, units) {
    if (units === 'mmol/L') {
        return (mgdlValue / 18).toFixed(1);
    } else {
        return Math.round(mgdlValue).toString();
    }
}
