// providers/LibreLinkProvider.js
import Soup from 'gi://Soup';
import GLib from 'gi://GLib';
import { BaseProvider } from './BaseProvider.js';

const REGIONAL_URLS = {
    'EU': 'https://api-eu.libreview.io',
    'US': 'https://api.libreview.io',
    'DE': 'https://api-de.libreview.io',
    'FR': 'https://api-fr.libreview.io',
    'JP': 'https://api-jp.libreview.io',
    'AP': 'https://api-ap.libreview.io',
    'AU': 'https://api-au.libreview.io',
    'RU': 'https://api.libreview.ru',
};

const REQUIRED_HEADERS = {
    'User-Agent': 'Mozilla/5.0 (iPhone; CPU OS 17_4.1 like Mac OS X) AppleWebKit/536.26 (KHTML, like Gecko) Version/17.4.1 Mobile/10A5355d Safari/8536.25',
    'accept-encoding': 'gzip',
    'cache-control': 'no-cache',
    'connection': 'Keep-Alive',
    'content-type': 'application/json',
    'product': 'llu.ios',
    'version': '4.12.0',
};

export class LibreLinkProvider extends BaseProvider {
    constructor(config, log) {
        super(config, log);
        this.session = new Soup.Session({ 
            timeout: 15,
            max_conns: 10,
            max_conns_per_host: 5
        });
        this.authToken = null;
        this.tokenExpiry = null;
        this.patientId = null;
        this.accountId = null;
    }

    isConfigured() {
        const librelinkConfig = this.config.get('librelink');
        return !!(librelinkConfig && librelinkConfig.email && librelinkConfig.password);
    }

    getRequiredConfig() {
        return ['librelink.email', 'librelink.password'];
    }

    _getApiUrl() {
        const librelinkConfig = this.config.get('librelink');
        const region = librelinkConfig.region || 'EU';
        return REGIONAL_URLS[region] || REGIONAL_URLS['EU'];
    }

    _isTokenValid() {
        return this.authToken && this.tokenExpiry && new Date() < new Date(this.tokenExpiry);
    }

    async _login() {
        return new Promise((resolve, reject) => {
            const librelinkConfig = this.config.get('librelink');
            const apiUrl = this._getApiUrl();
            const url = `${apiUrl}/llu/auth/login`;
            
            this.log(`LibreLink login attempt:`);
            this.log(`- API URL: ${apiUrl}`);
            this.log(`- Region: ${librelinkConfig.region || 'EU'}`);
            this.log(`- Email: ${librelinkConfig.email ? `${librelinkConfig.email.substring(0, 3)}***` : 'NOT SET'}`);
            this.log(`- Password: ${librelinkConfig.password ? '[SET]' : 'NOT SET'}`);
            
            const loginData = {
                email: librelinkConfig.email,
                password: librelinkConfig.password
            };

            this.log(`Sending login request to: ${url}`);
            const message = Soup.Message.new('POST', url);
            
            // Set required headers
            Object.entries(REQUIRED_HEADERS).forEach(([key, value]) => {
                message.get_request_headers().append(key, value);
                this.log(`Header: ${key} = ${value}`);
            });

            const requestBody = JSON.stringify(loginData);
            message.set_request_body_from_bytes('application/json', 
                new GLib.Bytes(new TextEncoder().encode(requestBody)));

            this.session.send_and_read_async(message, GLib.PRIORITY_DEFAULT, null, (session, result) => {
                try {
                    const bytes = session.send_and_read_finish(result);
                    const decoder = new TextDecoder('utf-8');
                    const response = decoder.decode(bytes.get_data());
                    
                    // Get HTTP status
                    const status = message.get_status();
                    this.log(`HTTP Status: ${status}`);
                    this.log(`Response length: ${response ? response.length : 0} chars`);
                    
                    if (!response || response.trim() === '') {
                        throw new Error(`Empty response from LibreLink login (HTTP ${status})`);
                    }
                    
                    this.log(`Response preview: ${response.substring(0, 200)}...`);
                    
                    const data = JSON.parse(response);
                    this.log(`Parsed response status: ${data.status}`);
                    
                    if (data.status !== 0) {
                        this.log(`Login error details: ${JSON.stringify(data, null, 2)}`);
                        throw new Error(`Login failed: ${data.error?.description || data.error || 'Unknown error'}`);
                    }

                    if (!data.data || !data.data.authTicket) {
                        this.log(`Invalid response structure: ${JSON.stringify(data, null, 2)}`);
                        throw new Error('Invalid login response: no auth ticket');
                    }

                    this.authToken = data.data.authTicket.token;
                    this.tokenExpiry = new Date(data.data.authTicket.expires * 1000);
                    
                    const userId = data.data.user.id.toString();
                    this.accountId = GLib.compute_checksum_for_string(GLib.ChecksumType.SHA256, userId, -1);

                    this.log(`LibreLink login successful!`);
                    this.log(`Token length: ${this.authToken ? this.authToken.length : 0}`);
                    this.log(`Token expires: ${this.tokenExpiry}`);
                    resolve();
                    
                } catch (error) {
                    this.log(`LibreLink login error: ${error.message}`);
                    this.log(`Full error: ${error.stack}`);
                    reject(error);
                }
            });
        });
    }

    async _getPatientId() {
        return new Promise((resolve, reject) => {
            // If we already have a patient ID and it's configured, use it
            const librelinkConfig = this.config.get('librelink');
            if (librelinkConfig.patientId) {
                this.patientId = librelinkConfig.patientId;
                resolve(this.patientId);
                return;
            }

            const apiUrl = this._getApiUrl();
            const url = `${apiUrl}/llu/connections`;

            this.log(`Getting LibreLink connections: ${url}`);
            const message = Soup.Message.new('GET', url);
            
            // Set required headers including auth
            Object.entries(REQUIRED_HEADERS).forEach(([key, value]) => {
                message.get_request_headers().append(key, value);
            });
            message.get_request_headers().append('authorization', `Bearer ${this.authToken}`);
            message.get_request_headers().append('account-id', this.accountId);

            this.session.send_and_read_async(message, GLib.PRIORITY_DEFAULT, null, (session, result) => {
                try {
                    const bytes = session.send_and_read_finish(result);
                    const decoder = new TextDecoder('utf-8');
                    const response = decoder.decode(bytes.get_data());
                    
                    if (!response || response.trim() === '') {
                        throw new Error('Empty response from LibreLink connections');
                    }
                    
                    const data = JSON.parse(response);
                    
                    if (data.status !== 0) {
                        throw new Error(`Failed to get connections: ${data.error || 'Unknown error'}`);
                    }

                    if (!data.data || !Array.isArray(data.data) || data.data.length === 0) {
                        throw new Error('No connections found - ensure someone is sharing their data with you');
                    }

                    // Use the first patient
                    this.patientId = data.data[0].patientId;
                    
                    // Save patient ID to config for future use
                    const newConfig = this.config.get('librelink');
                    newConfig.patientId = this.patientId;
                    this.config.set('librelink', newConfig);
                    
                    this.log(`Found patient ID: ${this.patientId}`);
                    resolve(this.patientId);
                    
                } catch (error) {
                    this.log(`LibreLink connections error: ${error.message}`);
                    reject(error);
                }
            });
        });
    }

    async _ensureAuthenticated() {
        if (this._isTokenValid() && this.patientId) {
            return; // Already authenticated
        }

        // Login if needed
        if (!this._isTokenValid()) {
            await this._login();
        }

        // Get patient ID if needed
        if (!this.patientId) {
            await this._getPatientId();
        }
    }

    async _fetchGlucoseData() {
        return new Promise((resolve, reject) => {
            const apiUrl = this._getApiUrl();
            const url = `${apiUrl}/llu/connections/${this.patientId}/graph`;

            this.log(`Fetching LibreLink glucose data: ${url}`);
            const message = Soup.Message.new('GET', url);
            
            // Set required headers including auth
            Object.entries(REQUIRED_HEADERS).forEach(([key, value]) => {
                message.get_request_headers().append(key, value);
            });
            message.get_request_headers().append('authorization', `Bearer ${this.authToken}`);
            message.get_request_headers().append('account-id', this.accountId);

            this.session.send_and_read_async(message, GLib.PRIORITY_DEFAULT, null, (session, result) => {
                try {
                    const bytes = session.send_and_read_finish(result);
                    const decoder = new TextDecoder('utf-8');
                    const response = decoder.decode(bytes.get_data());
                    
                    if (!response || response.trim() === '') {
                        throw new Error('Empty response from LibreLink glucose data');
                    }
                    
                    const data = JSON.parse(response);
                    
                    if (data.status !== 0) {
                        throw new Error(`Failed to get glucose data: ${data.error || 'Unknown error'}`);
                    }

                    if (!data.data) {
                        throw new Error('No glucose data in response');
                    }

                    resolve(data.data);
                    
                } catch (error) {
                    this.log(`LibreLink glucose data error: ${error.message}`);
                    reject(error);
                }
            });
        });
    }

    async fetchCurrent() {
        await this._ensureAuthenticated();
        const data = await this._fetchGlucoseData();
        
        // Convert LibreLink current reading to Nightscout format
        if (data.connection && data.connection.glucoseMeasurement) {
            const reading = data.connection.glucoseMeasurement;
            return this._convertToNightscoutFormat(reading);
        }
        
        throw new Error('No current glucose measurement found');
    }

    async fetchHistory() {
        await this._ensureAuthenticated();
        const data = await this._fetchGlucoseData();
        
        // Convert LibreLink history to Nightscout format
        if (data.graphData && Array.isArray(data.graphData)) {
            return data.graphData.map(reading => this._convertToNightscoutFormat(reading));
        }
        
        throw new Error('No glucose history found');
    }

    _convertToNightscoutFormat(librelinkReading) {
        // Convert LibreLink format to Nightscout format
        return {
            sgv: librelinkReading.ValueInMgPerDl || librelinkReading.Value,
            dateString: librelinkReading.Timestamp,
            date: new Date(librelinkReading.Timestamp).getTime(),
            type: 'sgv',
            direction: this._convertTrendArrow(librelinkReading.TrendArrow)
        };
    }

    _convertTrendArrow(librelinkTrend) {
        // Convert LibreLink trend numbers to Nightscout direction strings
        // Based on LibreLink documentation: 1=rising, 2=stable, 3=falling
        switch (librelinkTrend) {
            case 1: return 'SingleUp';
            case 2: return 'Flat';
            case 3: return 'SingleDown';
            default: return 'NONE';
        }
    }

    getCgmInterval() {
        // LibreLink typically updates every 1 minute for Libre 3, 15 minutes for older versions
        // We could detect this from the data, but 1 minute is a safe default
        return 1;
    }

    destroy() {
        if (this.session) {
            this.session.abort();
            this.session = null;
        }
        this.authToken = null;
        this.tokenExpiry = null;
        this.patientId = null;
        this.accountId = null;
    }
}
