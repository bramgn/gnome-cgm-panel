// config.js - SIMPLIFIED WORKING VERSION
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Secret from 'gi://Secret';

export class Config {
    constructor() {
        this.configDir = GLib.get_user_config_dir() + '/cgm-widget';
        this.configFile = this.configDir + '/config.json';
        this._config = this._loadConfig();
        
        // Define the schema once
        this._schema = new Secret.Schema(
            'org.gnome.shell.extensions.cgm-widget',
            Secret.SchemaFlags.NONE,
            {
                'service': Secret.SchemaAttributeType.STRING,
                'extension': Secret.SchemaAttributeType.STRING,
                'email': Secret.SchemaAttributeType.STRING
            }
        );
    }

    _loadConfig() {
        try {
            const file = Gio.File.new_for_path(this.configFile);
            if (!file.query_exists(null)) {
                this._createDefaultConfig();
                return this._getDefaultConfig();
            }

            const [success, contents] = file.load_contents(null);
            if (success) {
                const decoder = new TextDecoder('utf-8');
                const configText = decoder.decode(contents);
                const defaultConfig = this._getDefaultConfig();
                const userConfig = JSON.parse(configText);

                const mergedConfig = { ...defaultConfig, ...userConfig };

                // If units are in mmol/L, convert thresholds to mg/dL for internal use
                if (mergedConfig.units === 'mmol/L') {
                    mergedConfig.thresholds.low = Math.round(mergedConfig.thresholds.low * 18);
                    mergedConfig.thresholds.high = Math.round(mergedConfig.thresholds.high * 18);
                }

                // Deep merge for nested objects
                if (userConfig.thresholds) {
                    mergedConfig.thresholds = { ...defaultConfig.thresholds, ...mergedConfig.thresholds };
                }
                if (userConfig.notifications) {
                    mergedConfig.notifications = { ...defaultConfig.notifications, ...userConfig.notifications };
                }
                if (userConfig.colors) {
                    mergedConfig.colors = { ...defaultConfig.colors, ...userConfig.colors };
                }

                return { ...defaultConfig, ...mergedConfig };
            }
        } catch (error) {
            console.error('Error loading CGM config:', error);
        }

        return this._getDefaultConfig();
    }

    // config.js - Updated _getDefaultConfig() method
    _getDefaultConfig() {
        return {
            // Provider selection
            provider: "nightscout", // "nightscout" or "librelink"
            
            // Nightscout config
            nightscoutUrl: "",
            apiToken: "",
            
            // LibreLink config
            librelink: {
                email: "",
                region: "EU",
                patientId: ""
            },
            graphHours: 6,
            debug: false,
            units: "mg/dL", // "mg/dL" or "mmol/L"
            thresholds: { low: 70, high: 180 },
            notifications: { enabled: true, low: true, high: true },
            colors: { low: '#ff4444', high: '#ffaa00', normal: '#ffffff' },
            staleMinutes: 10,
            historyFetchInterval: 5
        };
    }

    _createDefaultConfig() {
        this._saveConfig(this._getDefaultConfig());
        console.log(`Created default CGM config at: ${this.configFile}`);
    }

    get(key) {
        if (this._config[key] !== undefined) {
            return this._config[key];
        }
        const defaultConfig = this._getDefaultConfig();
        return defaultConfig[key];
    }

    set(key, value) {
        this._config[key] = value;
        this._saveConfig(this._config);
    }

    // SIMPLIFIED PASSWORD MANAGEMENT
    async storeLibreLinkPassword(password) {
        try {
            console.log('Storing LibreLink password for:', this._config.librelink.email);
            
            const attributes = {
                'service': 'librelink',
                'extension': 'cgm-widget',
                'email': this._config.librelink.email
            };

            // Use the synchronous version which is more reliable
            const success = Secret.password_store_sync(
                this._schema,
                attributes,
                Secret.COLLECTION_DEFAULT,
                `LibreLink - ${this._config.librelink.email}`,
                password,
                null
            );
            
            console.log('Password store result:', success);
            return success;
            
        } catch (error) {
            console.error('Error storing LibreLink password:', error);
            return false;
        }
    }

    async getLibreLinkPassword() {
        try {
            const attributes = {
                'service': 'librelink',
                'extension': 'cgm-widget',
                'email': this._config.librelink.email
            };

            // Use the synchronous version
            const password = Secret.password_lookup_sync(
                this._schema,
                attributes,
                null
            );
            
            console.log('Password lookup result:', password ? 'Found' : 'Not found');
            return password;
            
        } catch (error) {
            console.error('Error retrieving LibreLink password:', error);
            return null;
        }
    }

    async clearLibreLinkPassword() {
        try {
            const attributes = {
                'service': 'librelink',
                'extension': 'cgm-widget',
                'email': this._config.librelink.email
            };

            const success = Secret.password_clear_sync(
                this._schema,
                attributes,
                null
            );
            
            console.log('Password clear result:', success);
            return success;
            
        } catch (error) {
            console.error('Error clearing LibreLink password:', error);
            return false;
        }
    }

    _saveConfig(configObject) {
        let configToSave = JSON.parse(JSON.stringify(configObject));

        if (configToSave.units === 'mmol/L') {
            configToSave.thresholds.low = (configToSave.thresholds.low / 18).toFixed(1);
            configToSave.thresholds.high = (configToSave.thresholds.high / 18).toFixed(1);
        }

        try {
            const dir = Gio.File.new_for_path(this.configDir);
            if (!dir.query_exists(null)) {
                dir.make_directory_with_parents(null);
            }

            const file = Gio.File.new_for_path(this.configFile);
            const configJson = JSON.stringify(configToSave, null, 2);
            file.replace_contents(configJson, null, false, 
                Gio.FileCreateFlags.PRIVATE, null);
                
        } catch (error) {
            console.error('Error saving CGM config:', error);
        }
    }

    reload() {
        this._config = this._loadConfig();
    }
}