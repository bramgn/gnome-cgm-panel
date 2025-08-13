// providers/BaseProvider.js
export class BaseProvider {
    constructor(config, log) {
        this.config = config;
        this.log = log;
    }

    /**
     * Fetch the current/latest glucose reading
     * @returns {Promise<Object>} Latest reading in Nightscout format: {sgv, dateString}
     */
    async fetchCurrent() {
        throw new Error('fetchCurrent() must be implemented by provider');
    }

    /**
     * Fetch historical glucose data
     * @returns {Promise<Array>} Array of readings in Nightscout format: [{sgv, dateString}, ...]
     */
    async fetchHistory() {
        throw new Error('fetchHistory() must be implemented by provider');
    }

    /**
     * Check if the provider is properly configured
     * @returns {boolean} True if provider can be used
     */
    isConfigured() {
        throw new Error('isConfigured() must be implemented by provider');
    }

    /**
     * Get provider-specific configuration requirements
     * @returns {Array<string>} Array of required config keys
     */
    getRequiredConfig() {
        throw new Error('getRequiredConfig() must be implemented by provider');
    }

    /**
     * Transform provider-specific data to standard format
     * This is a helper method that providers can override if needed
     * @param {Object} rawData - Raw data from provider
     * @returns {Object} Standardized data
     */
    transformData(rawData) {
        // Default implementation assumes Nightscout format
        return rawData;
    }
}
