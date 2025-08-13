// extension.js
import { Extension } from 'resource:///org/gnome/shell/extensions/extension.js';
import { NightscoutProvider } from './providers/NightscoutProvider.js';
import { LibreLinkProvider } from './providers/LibreLinkProvider.js';
import GObject from 'gi://GObject';
import St from 'gi://St';
import Clutter from 'gi://Clutter';
import Soup from 'gi://Soup';
import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';

import { CGMGraph } from './cgmGraph.js';
import { Config } from './config.js';
import { Cache } from './cache.js';

const CONSTANTS = {
    RETRY_MAX: 3,
    FETCH_INTERVAL_MIN: 30, // seconds
    DEFAULT_CGM_INTERVAL: 1, // minutes
    INITIAL_HISTORY_FETCH_HOURS: 50,
    PANEL_LABEL_PREFIX: 'BS: ',
    TREND_ARROWS: {
        RAPID_RISE: '↗↗',
        MODERATE_RISE: '↗',
        STABLE: '→',
        MODERATE_FALL: '↘',
        RAPID_FALL: '↘↘',
        VERY_RAPID_FALL: '↓',
    },
    TREND_THRESHOLDS: { // In mg/dL per minute
        RAPID_RISE: 2.5,
        MODERATE_RISE: 1.2,
        STABLE: 0.6,
        MODERATE_FALL: -1.2,
        RAPID_FALL: -2.5,
    },
    API_PATH: '/api/v1/entries.json',
};

// Create a panel button with popup
const MyExtension = GObject.registerClass(
class MyExtension extends PanelMenu.Button {
    _init() {
        super._init(0.0, 'Nightscout CGM');
        
        // Initialize state
        this._isDestroyed = false;
        this._fetchInProgress = false;
        this._historyFetchInProgress = false;
        this._retryCount = 0;
        this._lastFetchTime = 0;
        this._lastNotifiedState = null; // To prevent notification spam
        
        // Load config and cache
        this._config = new Config();
        this._cache = new Cache();
        
        // Setup logger
        this._log = () => {}; // Default to no-op
        
        // Monitor config file for changes
        this._setupConfigMonitor();
        
        // Initialize configuration values
        this._initializeConfig();
        
        // Create UI elements
        this._createPanelButton();
        this._createProvider();
        this._initializeDataState();
        this._createGraph();
        this._createPopupContent();
        
        // Set up event handlers
        this._setupEventHandlers();
        
        // Start data fetching
        this._initializeFetching();
    }

    _log(message) {
        if (this._debugEnabled) {
            console.log(`[CGM Widget] ${message}`);
        }
    }

    _switchTimeWindow(hours) {
        if (this._graphHours === hours || this._isDestroyed) return;
        
        this._log(`Switching graph time window to ${hours} hours`);
        
        this._graphHours = hours;
        
        // Update button styles
        Object.keys(this._timeButtons).forEach(buttonHours => {
            let button = this._timeButtons[buttonHours];
            if (button && !this._isDestroyed) {
                let isActive = parseInt(buttonHours) === hours;
                button.style = `
                    padding: 4px 8px; 
                    margin: 2px; 
                    border-radius: 4px; 
                    font-size: 11px;
                    ${isActive ? 
                        'background-color: #0066cc; color: white;' : 
                        'background-color: #333; color: #ccc; border: 1px solid #555;'}
                `;
            }
        });
        
        // Update graph settings
        this._graph.setGraphHours(hours);
        
        // Reprocess history for the new window
        this._reprocessHistory();
    }

    _setupConfigMonitor() {
        this._monitor = null;
        const configDir = Gio.File.new_for_path(this._config.configDir);
        if (configDir.query_exists(null)) {
            this._monitor = configDir.monitor(Gio.FileMonitorFlags.NONE, null);
            this._monitor.connect('changed', (monitor, file, otherFile, eventType) => {
                if (file.get_basename() === 'config.json' && 
                   (eventType === Gio.FileMonitorEvent.CHANGED || eventType === Gio.FileMonitorEvent.CREATED)) {
                    this._log('Config file changed, reloading...');
                    // Debounce config reloads
                    if (this._configReloadTimeout) {
                        GLib.Source.remove(this._configReloadTimeout);
                    }
                    this._configReloadTimeout = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 1, () => {
                        this._reloadConfig();
                        this._configReloadTimeout = null;
                        return GLib.SOURCE_REMOVE;
                    });
                }
            });
        }
    }
    
    _initializeConfig() {
        this._debugEnabled = this._config.get('debug');
        this._log('Initializing config...');

        // Nightscout config from file
        this._nightscoutUrl = this._config.get('nightscoutUrl');
        this._token = this._config.get('apiToken');
        this._units = this._config.get('units') || 'mmol/L';
        this._graphHours = this._config.get('graphHours') || 6;
        this._cgmInterval = CONSTANTS.DEFAULT_CGM_INTERVAL;
        this._historyFetchInterval = this._config.get('historyFetchInterval') || 10;
        this._intervalDetected = false;
        
        // Validate and clean up Nightscout URL
        if (this._nightscoutUrl) {
            this._nightscoutUrl = this._nightscoutUrl.trim();
            if (this._nightscoutUrl.endsWith('/')) {
                this._nightscoutUrl = this._nightscoutUrl.slice(0, -1);
            }
            if (!this._nightscoutUrl.startsWith('http')) {
                this._nightscoutUrl = 'https://' + this._nightscoutUrl;
            }
        }
    }
    
    _hasEnoughDataForTimeWindow(hours) {
        if (!this._rawHistoryEntries || this._rawHistoryEntries.length === 0) {
            return false;
        }
        // Check the actual time span of our data
        const entries = this._rawHistoryEntries;
        const newestTime = new Date(entries[0].dateString || entries[0].date);
        const oldestTime = new Date(entries[entries.length - 1].dateString || entries[entries.length - 1].date);
        const dataSpanHours = (newestTime - oldestTime) / (1000 * 60 * 60);
        
        console.log(`Data span check: have ${dataSpanHours.toFixed(1)}h of data, need ${hours}h`);
        
        // We have enough if our data spans at least the requested hours + small buffer
        return dataSpanHours >= (hours * 0.9); // 90% of requested time is sufficient
    }
      
    _createPanelButton() {
        this._label = new St.Label({
            text: `${CONSTANTS.PANEL_LABEL_PREFIX}--`,
            style_class: 'system-status-icon',
            y_align: Clutter.ActorAlign.CENTER
        });
        this.add_child(this._label);
    }
    
    _createProvider() {
        const providerType = this._config.get('provider') || 'nightscout';
        
        this._log(`Creating provider: ${providerType}`);
        
        switch (providerType) {
            case 'nightscout':
                this._provider = new NightscoutProvider(this._config, this._log.bind(this));
                break;
            case 'librelink':
                this._provider = new LibreLinkProvider(this._config, this._log.bind(this));
                break;
            default:
                this._log(`Unknown provider: ${providerType}, falling back to Nightscout`);
                this._provider = new NightscoutProvider(this._config, this._log.bind(this));
                break;
        }
    }

    _initializeDataState() {
        this._currentBG = null;
        this._lastUpdate = null;
        this._historyData = [];
        this._rawHistoryEntries = [];
        this._inMemoryCache = {}; // For short-term caching between fetches
    }
    
    _createGraph() {
        let thresholds = this._config.get('thresholds');
        let colors = this._config.get('colors');
        
        // Convert thresholds to user's units for the graph
        if (this._units === 'mg/dL') {
            thresholds = {
                low: thresholds.low * 18,
                high: thresholds.high * 18,
            };
        }
        
        this._graph = new CGMGraph(320, 180, thresholds, this._graphHours, colors, this._log.bind(this));
    }
    
    _setupEventHandlers() {
        // Handle popup open/close
        this.menu.connect('open-state-changed', (menu, open) => {
            if (open && !this._isDestroyed) {
                // Refresh data when popup opens if it's been a while
                const now = Date.now();
                const timeSinceLastFetch = (now - this._lastFetchTime) / 1000;
                
                if (timeSinceLastFetch > 300) { // 5 minutes
                    this._log('Refreshing data on popup open (stale data)');
                    this._fetchBG();
                    this._fetchHistory();
                }
            }
        });
    }
    
    _initializeFetching() {
        // Load from disk cache first
        const cachedData = this._cache.load();
        if (cachedData) {
            this._log('Loaded data from disk cache.');
            if (cachedData.lastReading) {
                this._updateBG(cachedData.lastReading);
            }
            if (cachedData.history) {
                this._updateHistory(cachedData.history);
            }
        }

        // Initial data fetch with small delay
        GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 2, () => {
            if (!this._isDestroyed) {
                this._fetchBG();
                this._fetchHistory();
                this._startTimer();
            }
            return GLib.SOURCE_REMOVE;
        });
    }
    
    _hasRecentHistoryCache() {
        const now = new Date().getTime();
        const CACHE_VALIDITY_MS = this._historyFetchInterval * 60 * 1000;
        return this._historyCache.data && (now - this._historyCache.timestamp < CACHE_VALIDITY_MS);
    }
    
   
    _reloadConfig() {
        if (this._isDestroyed) return;
        this._log('Reloading configuration...');
        
        const oldUrl = this._nightscoutUrl;
        const oldToken = this._token;
        const oldProvider = this._config.get('provider') || 'nightscout';
        
        this._config.reload();
        this._debugEnabled = this._config.get('debug');
        this._initializeConfig();
        
        const newProvider = this._config.get('provider') || 'nightscout';
        const providerChanged = (oldProvider !== newProvider);
        const urlOrCredentialsChanged = (oldUrl !== this._nightscoutUrl || oldToken !== this._token);
        
        // If provider changed, destroy old one and create new one
        if (providerChanged) {
            this._log(`Provider changed from ${oldProvider} to ${newProvider}`);
            if (this._provider) {
                this._provider.destroy();
            }
            this._createProvider();
            // Clear all cached data when switching providers
            this._inMemoryCache = {};
            this._rawHistoryEntries = [];
            this._historyData = [];
            this._fetchBG();
            this._fetchHistory();
        } else if (urlOrCredentialsChanged) {
            // Same logic as before for URL/credential changes
            this._log('URL or credentials changed, clearing cache and re-fetching...');
            this._inMemoryCache = {};
            this._fetchBG();
            this._fetchHistory();
        }
        
        // Rest of your existing _reloadConfig code...
    }

    _startTimer() {
        if (this._isDestroyed) return;
        
        this._timer = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 60, () => {
            if (this._isDestroyed) return GLib.SOURCE_REMOVE;
            
            const now = Date.now();
            if (!this._fetchInProgress && (now - this._lastFetchTime) / 1000 >= CONSTANTS.FETCH_INTERVAL_MIN) {
                this._fetchBG();
            }
            
            this._updateColors();
            return GLib.SOURCE_CONTINUE;
        });
        
        this._historyTimer = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, this._historyFetchInterval * 60, () => {
            if (this._isDestroyed) return GLib.SOURCE_REMOVE;
            
            if (!this._historyFetchInProgress) {
                this._fetchHistory();
            }
            return GLib.SOURCE_CONTINUE;
        });
    }
    
    _fetchBG() {
        if (this._isDestroyed || this._fetchInProgress || !this._provider.isConfigured()) {
            if (!this._provider.isConfigured()) {
                this._label.set_text(`${CONSTANTS.PANEL_LABEL_PREFIX}No Config`);
                this._setLabelColor('gray');
            }
            return;
        }
        
        this._fetchInProgress = true;
        this._lastFetchTime = Date.now();
        
        this._provider.fetchCurrent()
            .then(data => {
                if (this._isDestroyed) return;
                this._log('Successfully fetched BG data.');
                this._updateBG(data);
                this._retryCount = 0;
            })
            .catch(error => {
                if (this._isDestroyed) return;
                this._log(`BG fetch error: ${error.message}`);
                this._handleFetchError('BG', error);
            })
            .finally(() => {
                this._fetchInProgress = false;
            });
    }
    
    _handleFetchError(type, error) {
        this._retryCount++;
        
        if (this._retryCount <= CONSTANTS.RETRY_MAX) {
            this._log(`${type} fetch failed (attempt ${this._retryCount}/${CONSTANTS.RETRY_MAX}), will retry...`);
            
            const retryDelay = Math.min(30, Math.pow(2, this._retryCount - 1) * 5);
            GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, retryDelay, () => {
                if (!this._isDestroyed) {
                    if (type === 'BG') this._fetchBG();
                    else if (type === 'History') this._fetchHistory();
                }
                return GLib.SOURCE_REMOVE;
            });
        } else {
            this._log(`${type} fetch failed after ${CONSTANTS.RETRY_MAX} attempts, giving up for now.`);
            if (!this._currentBG && type === 'BG') {
                this._label.set_text(`${CONSTANTS.PANEL_LABEL_PREFIX}ERR`);
                this._setLabelColor('gray');
            }
            GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 300, () => { this._retryCount = 0; return GLib.SOURCE_REMOVE; });
        }
    }

    _fetchHistory() {
        if (this._isDestroyed || this._historyFetchInProgress || !this._provider.isConfigured()) return;

        const now = new Date().getTime();
        const CACHE_VALIDITY_MS = this._historyFetchInterval * 60 * 1000;

        if (this._inMemoryCache.history && (now - this._inMemoryCache.timestamp < CACHE_VALIDITY_MS)) {
            this._log(`Using in-memory history cache (${this._inMemoryCache.history.length} entries).`);
            this._updateHistory(this._inMemoryCache.history);
            return;
        }

        this._historyFetchInProgress = true;
        
        this._provider.fetchHistory()
            .then(data => {
                if (this._isDestroyed) return;
                this._log(`Successfully fetched ${data.length} history entries.`);
                this._inMemoryCache = { history: data, timestamp: now };
                this._updateHistory(data);
            })
            .catch(error => {
                if (this._isDestroyed) return;
                this._log(`History fetch error: ${error.message}`);
                this._handleFetchError('History', error);
            })
            .finally(() => {
                this._historyFetchInProgress = false;
            });
    }
    _reprocessHistory() {
        if (!this._rawHistoryEntries || this._rawHistoryEntries.length === 0) {
            this._graph.setData([]);
            return;
        }
        
        const now = new Date();
        const startTime = new Date(now.getTime() - (this._graphHours * 60 * 60 * 1000));

        const filteredEntries = this._rawHistoryEntries.filter(entry => {
            const entryTime = new Date(entry.dateString || entry.date);
            return entryTime >= startTime && entryTime <= now && entry.sgv != null;
        });

        this._historyData = filteredEntries
            .map(entry => {
                try {
                    let value = (this._units === 'mmol/L') ? parseFloat((entry.sgv / 18).toFixed(1)) : entry.sgv;
                    let time = new Date(entry.dateString || entry.date);
                    if (isNaN(value) || value <= 0 || isNaN(time.getTime())) return null;
                    return { time: time, value: value };
                } catch (error) {
                    this._log(`Error processing history entry: ${error.message}`);
                    return null;
                }
            })
            .filter(entry => entry !== null);
        
        this._log(`Processed ${this._historyData.length} valid history entries for ${this._graphHours}h window`);
        this._graph.setData(this._historyData);
        this._updateTimeInRange();
    }
    
    _updateHistory(entries) {
        if (!entries || !Array.isArray(entries)) {
            this._log('Invalid history data received');
            return;
        }
        
        this._rawHistoryEntries = entries;
        this._cgmInterval = this._provider.getCgmInterval();
        
        // Save to on-disk cache
        const cachedData = this._cache.load() || {};
        cachedData.history = entries;
        this._cache.save(cachedData);

        this._reprocessHistory();
    }
    
    _updateBG(entry) {
        if (!entry || typeof entry.sgv !== 'number' || entry.sgv <= 0) {
            this._log('Invalid BG entry received');
            return;
        }
        
        const oldBG = this._currentBG;
        this._currentBG = (entry.sgv / 18).toFixed(1); // Always store as mmol/L
        this._lastUpdate = new Date(entry.dateString || entry.date);
        
        if (isNaN(this._lastUpdate.getTime())) this._lastUpdate = new Date();
        
        // Save to on-disk cache
        const cachedData = this._cache.load() || {};
        cachedData.lastReading = entry;
        this._cache.save(cachedData);

        this._updateBGDisplay();
        this._updateColors();
        this._checkAlerts(oldBG, this._currentBG);
    }
    
    _updateBGDisplay() {
        if (!this._currentBG) return;
        
        let displayValue = this._getDisplayValue();
        let trendArrow = this._calculateTrend();
        
        this._label.set_text(`${CONSTANTS.PANEL_LABEL_PREFIX}${displayValue}${trendArrow ? ' ' + trendArrow : ''}`);
        
        if (this._bgLabel) {
            this._bgLabel.set_text(`${displayValue} ${this._units}${trendArrow ? ' ' + trendArrow : ''}`);
        }
        if (this._timeLabel && this._lastUpdate) {
            this._timeLabel.set_text(`Updated: ${this._lastUpdate.toLocaleTimeString([], { hourCycle: 'h23' })}`);
        }
    }
    
    _getDisplayValue() {
        if (!this._currentBG) return '--';
        return (this._units === 'mg/dL') ? Math.round(parseFloat(this._currentBG) * 18).toString() : this._currentBG;
    }
    
    _updateColors() {
        if (!this._currentBG || !this._lastUpdate) {
            this._setLabelColor('gray');
            return;
        }
        
        let now = new Date();
        let minutesOld = (now - this._lastUpdate) / (1000 * 60);
        let staleLimit = this._config.get('staleMinutes') || 15;
        
        if (minutesOld > staleLimit) {
            this._setLabelColor('gray');
            return;
        }
        
        let bg = parseFloat(this._currentBG);
        let thresholds = this._config.get('thresholds');
        let colors = this._config.get('colors');
        
        if (bg < thresholds.low) this._setLabelColor(colors.low);
        else if (bg > thresholds.high) this._setLabelColor(colors.high);
        else this._setLabelColor(colors.normal);
    }
    
    _calculateTrend() {
        if (!this._rawHistoryEntries || this._rawHistoryEntries.length < 2) return '';
        
        let recent = this._rawHistoryEntries.slice(0, 6)
            .filter(e => e.sgv != null && !isNaN(e.sgv))
            .sort((a, b) => new Date(b.dateString || b.date) - new Date(a.dateString || a.date));
        
        if (recent.length < 2) return '';
        
        let newest = recent[0];
        let older = recent[Math.min(3, recent.length - 1)];
        
        let timeDiffMinutes = (new Date(newest.dateString) - new Date(older.dateString)) / (1000 * 60);
        if (timeDiffMinutes <= 0 || timeDiffMinutes > 60) return '';
        
        let valueDiff = newest.sgv - older.sgv;
        let changePerMinute = valueDiff / timeDiffMinutes;
        
        if (changePerMinute >= CONSTANTS.TREND_THRESHOLDS.RAPID_RISE) return CONSTANTS.TREND_ARROWS.RAPID_RISE;
        if (changePerMinute >= CONSTANTS.TREND_THRESHOLDS.MODERATE_RISE) return CONSTANTS.TREND_ARROWS.MODERATE_RISE;
        if (changePerMinute >= CONSTANTS.TREND_THRESHOLDS.STABLE) return CONSTANTS.TREND_ARROWS.STABLE;
        if (changePerMinute >= CONSTANTS.TREND_THRESHOLDS.MODERATE_FALL) return CONSTANTS.TREND_ARROWS.MODERATE_FALL;
        if (changePerMinute >= CONSTANTS.TREND_THRESHOLDS.RAPID_FALL) return CONSTANTS.TREND_ARROWS.RAPID_FALL;
        return CONSTANTS.TREND_ARROWS.VERY_RAPID_FALL;
    }

    _setLabelColor(color) {
        if (this._label && !this._isDestroyed) {
            this._label.set_style(`color: ${color};`);
        }
    }

    _checkAlerts(oldBG, newBG) {
        const notifications = this._config.get('notifications');
        if (!notifications.enabled) return;

        const thresholds = this._config.get('thresholds');
        const bg = parseFloat(newBG);
        let currentState = 'normal';
        let message = '';

        if (bg < thresholds.low) {
            currentState = 'low';
            if (notifications.low) message = `Low Glucose: ${this._getDisplayValue()} ${this._units}`;
        } else if (bg > thresholds.high) {
            currentState = 'high';
            if (notifications.high) message = `High Glucose: ${this._getDisplayValue()} ${this._units}`;
        }

        // Send notification only when state changes to low/high
        if (message && currentState !== this._lastNotifiedState) {
            this._sendNotification(message);
            this._lastNotifiedState = currentState;
        } else if (currentState === 'normal') {
            this._lastNotifiedState = 'normal'; // Reset when back in range
        }
    }

    _sendNotification(message) {
        this._log(`Sending notification: "${message}"`);
        Main.notify('CGM Widget', message);
    }

    _updateTimeInRange() {
        if (!this._historyData || this._historyData.length === 0 || !this._tirLabel) return;

        const thresholds = this._config.get('thresholds');
        const total = this._historyData.length;
        const inRange = this._historyData.filter(d => d.value >= thresholds.low && d.value <= thresholds.high).length;
        
        const percentage = total > 0 ? Math.round((inRange / total) * 100) : 0;
        this._tirLabel.set_text(`Time in Range: ${percentage}%`);
    }
    
    destroy() {
        this._log('Destroying CGM extension...');
        this._isDestroyed = true;
        
        if (this._timer) GLib.Source.remove(this._timer);
        if (this._historyTimer) GLib.Source.remove(this._historyTimer);
        if (this._configReloadTimeout) GLib.Source.remove(this._configReloadTimeout);
        if (this._monitor) this._monitor.cancel();
        if (this._session) this._session.abort();
        
        this._timer = null;
        this._historyTimer = null;
        this._configReloadTimeout = null;
        this._monitor = null;
        this._session = null;
        this._graph = null;
        this._config = null;
        this._cache = null;
        
        if (this._provider) this._provider.destroy();
        this._provider = null;

        super.destroy();
    }
    
    _createPopupContent() {
        let graphItem = new PopupMenu.PopupBaseMenuItem({ reactive: false, can_focus: false });
        graphItem.add_child(this._graph.getWidget());
        this.menu.addMenuItem(graphItem);
        
        let buttonBox = new St.BoxLayout({ style_class: 'time-window-buttons', style: 'spacing: 8px; margin: 8px;' });
        this._timeButtons = {};
        [3, 6, 12, 24, 48].forEach(hours => {
            let button = new St.Button({
                label: `${hours}h`,
                style_class: 'time-window-button',
                style: `padding: 4px 8px; margin: 2px; border-radius: 4px; font-size: 11px; ${this._graphHours === hours ? 'background-color: #0066cc; color: white;' : 'background-color: #333; color: #ccc; border: 1px solid #555;'}`,
                reactive: true, can_focus: true, track_hover: true
            });
            button.connect('clicked', () => this._switchTimeWindow(hours));
            this._timeButtons[hours] = button;
            buttonBox.add_child(button);
        });
        const buttonBoxItem = new PopupMenu.PopupBaseMenuItem({ reactive: false });
        buttonBoxItem.add_child(buttonBox);
        this.menu.addMenuItem(buttonBoxItem);
        
        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
        
        this._bgLabel = new St.Label({ text: `-- ${this._units}`, style: 'font-size: 18px; font-weight: bold; text-align: center;' });
        const bgLabelItem = new PopupMenu.PopupBaseMenuItem({ reactive: false });
        bgLabelItem.add_child(this._bgLabel);
        this.menu.addMenuItem(bgLabelItem);
        
        this._timeLabel = new St.Label({ text: 'Never updated', style: 'font-size: 12px; color: #888; text-align: center;' });
        const timeLabelItem = new PopupMenu.PopupBaseMenuItem({ reactive: false });
        timeLabelItem.add_child(this._timeLabel);
        this.menu.addMenuItem(timeLabelItem);

        this._tirLabel = new St.Label({ text: 'Time in Range: --%', style: 'font-size: 12px; color: #888; text-align: center;' });
        const tirLabelItem = new PopupMenu.PopupBaseMenuItem({ reactive: false });
        tirLabelItem.add_child(this._tirLabel);
        this.menu.addMenuItem(tirLabelItem);
        
        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
    }
});

// Extension lifecycle
export default class CGMWidgetExtension extends Extension {
    constructor(metadata) {
        super(metadata);
    }

    enable() {
        try {
            console.log('Enabling CGM extension...');
            this.extension = new MyExtension();
            this.extension.extension = this; // Pass the extension object
            Main.panel.addToStatusArea('nightscout-cgm', this.extension);
            console.log('CGM extension enabled successfully');
        } catch (error) {
            console.error(`Failed to enable CGM extension: ${error.message}`);
            console.error(error.stack);
        }
    }
    
    disable() {
        try {
            console.log('Disabling CGM extension...');
            if (this.extension) {
                // Set the destroyed flag immediately
                this.extension._isDestroyed = true;
                
                // Remove from status area IMMEDIATELY - this is critical
                Main.panel.statusArea['nightscout-cgm'] = null;
                
                // Now do the cleanup
                this.extension.destroy();
                this.extension = null;
            }
            console.log('CGM extension disabled successfully');
        } catch (error) {
            console.error(`Error disabling CGM extension: ${error.message}`);
            // Force cleanup even if there was an error
            try {
                Main.panel.statusArea['nightscout-cgm'] = null;
            } catch (e) {}
            this.extension = null;
        }
    }
}
