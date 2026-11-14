// config.js - SIMPLIFIED WORKING VERSION
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Secret from 'gi://Secret';

Gio._promisify(Gio.File.prototype, 'load_contents_async', 'load_contents_finish');

export class Config {
    constructor() {
        this.configDir = GLib.get_user_config_dir() + '/cgm-widget';
        this.configFile = this.configDir + '/config.json';
        this._config = this._getDefaultConfig();
        
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

    /**
     * Reads config.json asynchronously. Must be awaited once after construction
     * (and again on reload) before get() returns user values.
     */
    async load() {
        this._config = await this._loadConfig();
    }

    async _loadConfig() {
        const defaultConfig = this._getDefaultConfig();
        try {
            const file = Gio.File.new_for_path(this.configFile);
            let contents;
            try {
                [contents] = await file.load_contents_async(null);
            } catch (e) {
                if (e.matches?.(Gio.IOErrorEnum, Gio.IOErrorEnum.NOT_FOUND)) {
                    this._createDefaultConfig();
                    return defaultConfig;
                }
                throw e;
            }

            const configText = new TextDecoder('utf-8').decode(contents);
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
        } catch (error) {
            this._error('Error loading CGM config:', error);
        }

        return defaultConfig;
    }

    _error(...args) {
        console.error('[CGM Widget]', ...args);
    }

    _log(...args) {
        if (this._config?.debug)
            console.log('[CGM Widget]', ...args);
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
        this._log(`Created default CGM config at: ${this.configFile}`);
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
            this._log('Storing LibreLink password');
            
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
            
            this._log('Password store result:', success);
            return success;
            
        } catch (error) {
            this._error('Error storing LibreLink password:', error);
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
            
            this._log('Password lookup result:', password ? 'Found' : 'Not found');
            return password;
            
        } catch (error) {
            this._error('Error retrieving LibreLink password:', error);
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
            
            this._log('Password clear result:', success);
            return success;
            
        } catch (error) {
            this._error('Error clearing LibreLink password:', error);
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
            this._error('Error saving CGM config:', error);
        }
    }

    async reload() {
        await this.load();
    }
}