/* ============================================
   DAIRY FARM DASHBOARD - API MODULE
   Backend API communication
   ============================================ */

const APIManager = {
    // Default timeout for API calls (ms)
    defaultTimeout: 5000,

    /**
     * Fetch wrapper with timeout
     */
    async fetchWithTimeout(url, options = {}, timeout = null) {
        const controller = new AbortController();
        const signal = controller.signal;
        const timer = setTimeout(() => controller.abort(), timeout || this.defaultTimeout);

        try {
            const response = await fetch(url, { ...options, signal });
            return response;
        } finally {
            clearTimeout(timer);
        }
    },

    /**
     * Make API call with error handling
     * @param {string} endpoint - API endpoint
     * @param {string} method - HTTP method
     * @param {Object} payload - Request payload
     * @returns {Promise<Object>} API response
     */
    async call(endpoint, method = 'GET', payload = null) {
        if (!AppState.apiAvailable) {
            return { success: false, offline: true };
        }

        try {
            const opts = {
                method,
                headers: { 'Content-Type': 'application/json' }
            };

            if (payload) {
                opts.body = JSON.stringify(payload);
            }

            const response = await this.fetchWithTimeout(`${CONFIG.apiBase}${endpoint}`, opts);
            const data = await response.json();

            // If response is not ok, set success to false
            if (!response.ok) {
                data.success = false;
                console.warn(`API error (${endpoint}): ${response.status} - ${data.message || 'Unknown error'}`);
            }

            return data;
        } catch (err) {
            console.error(`API error (${endpoint}):`, err.message);
            return { success: false, error: err.message, offline: true };
        }
    },

    /**
     * Herd Management APIs
     */
    herd: {
        /**
         * Get all cows
         */
        async getCows() {
            return APIManager.call('/herd/cows?per_page=100');
        },

        /**
         * Get herd statistics
         */
        async getStats() {
            return APIManager.call('/herd/stats');
        },

        /**
         * Get breeds
         */
        async getBreeds() {
            return APIManager.call('/herd/breeds');
        },

        /**
         * Get statuses
         */
        async getStatuses() {
            return APIManager.call('/herd/statuses');
        },

        /**
         * Add new cow
         */
        async addCow(cowData) {
            return APIManager.call('/herd/cows', 'POST', cowData);
        },

        /**
         * Update cow
         */
        async updateCow(cowId, cowData) {
            return APIManager.call(`/herd/cows/${cowId}`, 'PUT', cowData);
        },

        /**
         * Delete cow
         */
        async deleteCow(cowId) {
            return APIManager.call(`/herd/cows/${cowId}`, 'DELETE');
        },

        /**
         * Generate cow UID
         */
        async generateUID(breed, birthDate) {
            return APIManager.call('/herd/generate-uid', 'POST', {
                breed,
                birth_date: birthDate
            });
        },

        /**
         * Upload cow photo
         */
        async uploadPhoto(cowId, photoFile) {
            const formData = new FormData();
            formData.append('photo', photoFile);
            
            try {
                const response = await fetch(
                    `${CONFIG.apiBase}/herd/cows/${cowId}/photo`,
                    {
                        method: 'POST',
                        body: formData
                    }
                );
                return await response.json();
            } catch (err) {
                console.error('Photo upload error:', err);
                return { success: false, error: err.message };
            }
        }
    },

    /**
     * Milk Production APIs
     */
    milk: {
        /**
         * Record milk production
         */
        async recordProduction(milkData) {
            return APIManager.call('/milk/records', 'POST', milkData);
        },

        /**
         * Get milk records
         */
        async getRecords(cowId = null) {
            const query = cowId ? `?cow_id=${cowId}&per_page=500` : '?per_page=500';
            return APIManager.call(`/milk/records${query}`);
        },

        /**
         * Update milk record
         */
        async updateRecord(recordId, milkData) {
            return APIManager.call(`/milk/records/${recordId}`, 'PUT', milkData);
        },

        /**
         * Get cow milk summary
         */
        async getCowSummary(cowId) {
            return APIManager.call(`/milk/cow/${cowId}/summary`);
        },

        /**
         * Get herd milk summary
         */
        async getHerdSummary() {
            return APIManager.call(`/milk/herd/summary`);
        },

        /**
         * Delete milk record
         */
        async deleteRecord(recordId) {
            return APIManager.call(`/milk/records/${recordId}`, 'DELETE');
        }
    },

    /**
     * Health Monitoring APIs
     */
    health: {
        /**
         * Record health issue
         */
        async recordIssue(healthData) {
            return APIManager.call('/health/records', 'POST', healthData);
        },

        /**
         * Get health records
         */
        async getRecords(cowId = null) {
            const query = cowId ? `?cow_id=${cowId}&per_page=500` : '?per_page=500';
            return APIManager.call(`/health/records${query}`);
        },

        /**
         * Update health record
         */
        async updateRecord(recordId, healthData) {
            return APIManager.call(`/health/records/${recordId}`, 'PUT', healthData);
        },

        /**
         * Get cow health history
         */
        async getCowHistory(cowId) {
            return APIManager.call(`/health/cow/${cowId}/history`);
        },

        /**
         * Get symptoms
         */
        async getSymptoms() {
            return APIManager.call('/health/symptoms');
        },

        /**
         * Delete health record
         */
        async deleteRecord(recordId) {
            return APIManager.call(`/health/records/${recordId}`, 'DELETE');
        },

        /**
         * Get alerts
         */
        async getAlerts(unresolvedOnly = false) {
            const query = unresolvedOnly ? '?unresolved_only=true&per_page=200' : '?per_page=200';
            return APIManager.call(`/health/alerts${query}`);
        },

        /**
         * Create alert
         */
        async createAlert(alertData) {
            return APIManager.call('/health/alerts', 'POST', alertData);
        },

        /**
         * Update/resolve alert
         */
        async updateAlert(alertId, alertData) {
            return APIManager.call(`/health/alerts/${alertId}`, 'PUT', alertData);
        }
    },

    /**
     * Reproduction APIs
     */
    reproduction: {
        /**
         * Record heat detection
         */
        async recordHeatDetection(heatData) {
            return APIManager.call('/reproduction/heat-detection', 'POST', heatData);
        },

        /**
         * Record artificial insemination
         */
        async recordAI(aiData) {
            return APIManager.call('/reproduction/ai', 'POST', aiData);
        },

        /**
         * Record pregnancy check
         */
        async recordPregnancy(pregnancyData) {
            return APIManager.call('/reproduction/pregnancy-check', 'POST', pregnancyData);
        },

        /**
         * Record calving
         */
        async recordCalving(calvingData) {
            return APIManager.call('/reproduction/calving', 'POST', calvingData);
        },

        /**
         * Save workflow feedback for reproduction alerts
         */
        async submitWorkflowFeedback(feedbackData) {
            return APIManager.call('/reproduction/workflow-feedback', 'POST', feedbackData);
        },

        /**
         * Get cow's reproduction cycle
         */
        async getCowCycle(cowId) {
            return APIManager.call(`/reproduction/cow/${cowId}/cycle`);
        },

        /**
         * Get all events
         */
        async getEvents(cowId = null) {
            const query = cowId ? `?cow_id=${cowId}&per_page=500` : '?per_page=500';
            return APIManager.call(`/reproduction/events${query}`);
        },

        /**
         * Check and create reproduction alerts (pregnancy review, stop milking)
         */
        async checkAlerts() {
            return APIManager.call('/reproduction/check-alerts', 'POST');
        }
    },

    /**
     * Feed Management APIs
     */
    feed: {
        /**
         * Record feed consumption
         */
        async recordFeed(feedData) {
            return APIManager.call('/feed/records', 'POST', feedData);
        },

        /**
         * Get feed records
         */
        async getRecords() {
            return APIManager.call('/feed/records?per_page=500');
        },

        /**
         * Update feed record
         */
        async updateRecord(recordId, feedData) {
            return APIManager.call(`/feed/records/${recordId}`, 'PUT', feedData);
        },

        /**
         * Get feed types
         */
        async getTypes() {
            return APIManager.call('/feed/types');
        },

        /**
         * Get feed statistics
         */
        async getStats() {
            return APIManager.call('/feed/stats');
        },

        /**
         * Delete feed record
         */
        async deleteRecord(recordId) {
            return APIManager.call(`/feed/records/${recordId}`, 'DELETE');
        }
    },

    /**
     * Google Drive backup APIs
     */
    drive: {
        async getStatus() {
            return APIManager.call('/drive/status');
        },

        async createBackup() {
            return APIManager.call('/drive/backup', 'POST', {});
        },

        async listBackups() {
            return APIManager.call('/drive/backups');
        },

        async restoreBackup(fileId) {
            return APIManager.call(`/drive/restore/${fileId}`, 'POST', {});
        },

        async disconnect() {
            return APIManager.call('/drive/disconnect', 'POST', {});
        },

        getAuthUrl() {
            return `${CONFIG.apiBase}/drive/auth/start`;
        }
    },

    /**
     * Check API availability
     */
    async checkAvailability() {
        try {
            const response = await this.fetchWithTimeout(CONFIG.healthCheckUrl, { method: 'GET' });
            AppState.apiAvailable = response.ok;
            console.log(`✓ API Health Check: ${response.ok ? 'Connected' : 'Failed'}`);
            return AppState.apiAvailable;
        } catch (err) {
            console.warn(`✗ API Health Check Failed: ${err.message}`);
            AppState.apiAvailable = false;
            return false;
        }
    }
};

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
    module.exports = APIManager;
}
