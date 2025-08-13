// providers/NightscoutProvider.js
import Soup from 'gi://Soup';
import GLib from 'gi://GLib';
import { BaseProvider } from './BaseProvider.js';

const CONSTANTS = {
    API_PATH: '/api/v1/entries.json',
    INITIAL_HISTORY_FETCH_HOURS: 50,
    DEFAULT_CGM_INTERVAL: 1, // minutes
};

export class NightscoutProvider extends BaseProvider {
    constructor(config, log) {
        super(config, log);
        this.session = new Soup.Session({ 
            timeout: 15,
            max_conns: 10,
            max_conns_per_host: 5
        });
        this.cgmInterval = CONSTANTS.DEFAULT_CGM_INTERVAL;
    }

    isConfigured() {
        const nightscoutUrl = this.config.get('nightscoutUrl');
        const token = this.config.get('apiToken');
        return !!(nightscoutUrl && token);
    }

    getRequiredConfig() {
        return ['nightscoutUrl', 'apiToken'];
    }

    _getNormalizedUrl() {
        let nightscoutUrl = this.config.get('nightscoutUrl');
        if (!nightscoutUrl) return null;

        nightscoutUrl = nightscoutUrl.trim();
        if (nightscoutUrl.endsWith('/')) {
            nightscoutUrl = nightscoutUrl.slice(0, -1);
        }
        if (!nightscoutUrl.startsWith('http')) {
            nightscoutUrl = 'https://' + nightscoutUrl;
        }
        return nightscoutUrl;
    }

    _buildUrl(count = 1) {
        const nightscoutUrl = this._getNormalizedUrl();
        const token = this.config.get('apiToken');
        
        if (!nightscoutUrl || !token) return null;
        
        return `${nightscoutUrl}${CONSTANTS.API_PATH}?count=${count}&token=${token}`;
    }

    async fetchCurrent() {
        return new Promise((resolve, reject) => {
            const url = this._buildUrl(1);
            if (!url) {
                reject(new Error('Nightscout URL or token not configured'));
                return;
            }

            this.log(`Fetching current BG from: ${url}`);
            const message = Soup.Message.new('GET', url);
            
            this.session.send_and_read_async(message, GLib.PRIORITY_DEFAULT, null, (session, result) => {
                try {
                    const bytes = session.send_and_read_finish(result);
                    const decoder = new TextDecoder('utf-8');
                    const response = decoder.decode(bytes.get_data());
                    
                    if (!response || response.trim() === '') {
                        throw new Error('Empty response from server');
                    }
                    
                    const data = JSON.parse(response);
                    if (data && Array.isArray(data) && data.length > 0) {
                        this.log('Successfully fetched current BG data.');
                        resolve(data[0]);
                    } else {
                        throw new Error('No data in response');
                    }
                } catch (error) {
                    this.log(`Nightscout fetch error: ${error.message}`);
                    reject(error);
                }
            });
        });
    }

    async fetchHistory() {
        return new Promise((resolve, reject) => {
            // Calculate points needed based on detected interval
            const pointsToFetch = Math.ceil(CONSTANTS.INITIAL_HISTORY_FETCH_HOURS * 60 / this.cgmInterval * 1.2);
            const url = this._buildUrl(pointsToFetch);
            
            if (!url) {
                reject(new Error('Nightscout URL or token not configured'));
                return;
            }

            this.log(`Fetching history from: ${url}`);
            const message = Soup.Message.new('GET', url);
            
            this.session.send_and_read_async(message, GLib.PRIORITY_DEFAULT, null, (session, result) => {
                try {
                    const bytes = session.send_and_read_finish(result);
                    const decoder = new TextDecoder('utf-8');
                    const response = decoder.decode(bytes.get_data());
                    
                    if (!response || response.trim() === '') {
                        throw new Error('Empty response from server');
                    }
                    
                    const data = JSON.parse(response);
                    if (data && Array.isArray(data) && data.length > 0) {
                        this.log(`Successfully fetched ${data.length} history entries.`);
                        
                        // Update detected interval based on this data
                        this.cgmInterval = this._detectCGMInterval(data);
                        
                        resolve(data);
                    } else {
                        throw new Error('No data in response');
                    }
                } catch (error) {
                    this.log(`Nightscout history fetch error: ${error.message}`);
                    reject(error);
                }
            });
        });
    }

    _detectCGMInterval(entries) {
        if (entries && entries.length >= 5) {
            // Calculate intervals between readings (use more samples for better accuracy)
            let intervals = [];
            for (let i = 1; i < Math.min(20, entries.length); i++) {
                let timeDiff = new Date(entries[i-1].dateString) - 
                              new Date(entries[i].dateString);
                let minutesDiff = Math.abs(timeDiff / (1000 * 60));
                if (minutesDiff > 0.5 && minutesDiff < 30) { // Reasonable range
                    intervals.push(minutesDiff);
                }
            }
            
            if (intervals.length >= 3) {
                // Remove outliers (simple method: remove values more than 2 standard deviations away)
                const mean = intervals.reduce((a, b) => a + b) / intervals.length;
                const stdDev = Math.sqrt(intervals.reduce((sq, n) => sq + Math.pow(n - mean, 2), 0) / intervals.length);
                const filteredIntervals = intervals.filter(interval => Math.abs(interval - mean) <= 2 * stdDev);
                
                if (filteredIntervals.length >= 2) {
                    let avgInterval = filteredIntervals.reduce((a, b) => a + b) / filteredIntervals.length;
                    let detectedInterval = Math.round(avgInterval);
                    this.log(`Detected CGM interval: ${detectedInterval} minutes (from ${filteredIntervals.length}/${intervals.length} samples)`);
                    return detectedInterval;
                }
            }
        }
        
        this.log('Using default CGM interval: 1 minute');
        return CONSTANTS.DEFAULT_CGM_INTERVAL;
    }

    getCgmInterval() {
        return this.cgmInterval;
    }

    destroy() {
        if (this.session) {
            this.session.abort();
            this.session = null;
        }
    }
}
