/* ============================================
   DAIRY FARM DASHBOARD - UTILITIES
   Helper functions and utility methods
   ============================================ */

const Utils = {
    /**
     * Calculate age in years and months
     * @param {string} birthDate - ISO date string
     * @returns {string} Formatted age
     */
    calculateAge(birthDate) {
        if (!birthDate) return 'N/A';
        const birth = new Date(birthDate);
        const today = new Date();
        
        let years = today.getFullYear() - birth.getFullYear();
        let months = today.getMonth() - birth.getMonth();
        
        if (today.getDate() < birth.getDate()) {
            months--;
        }
        
        if (months < 0) {
            years--;
            months += 12;
        }
        
        if (years === 0) {
            return months + ' mo';
        } else if (months === 0) {
            return years + ' yr' + (years > 1 ? 's' : '');
        } else {
            return years + ' yr' + (years > 1 ? 's' : '') + ' ' + months + ' mo';
        }
    },

    /**
     * Debounce function execution
     * @param {Function} fn - Function to debounce
     * @param {number} delay - Delay in ms
     * @returns {Function} Debounced function
     */
    debounce(fn, delay = CONFIG.debounceDelay) {
        let timeoutId;
        return function(...args) {
            clearTimeout(timeoutId);
            timeoutId = setTimeout(() => fn.apply(this, args), delay);
        };
    },

    /**
     * Format date to ISO string (YYYY-MM-DD)
     * @param {Date} date - Date to format
     * @returns {string} Formatted date
     */
    formatDate(date = new Date()) {
        return date.toISOString().split('T')[0];
    },

    /**
     * Parse ISO date string to Date object
     * @param {string} dateStr - Date string
     * @returns {Date} Date object
     */
    parseDate(dateStr) {
        return new Date(dateStr);
    },

    /**
     * Set all date inputs to today's date
     */
    setDefaultDates() {
        const today = this.formatDate();
        document.querySelectorAll('input[type="date"]').forEach(input => {
            if (!input.value) input.value = today;
        });
    },

    /**
     * Generate unique ID
     * @param {string} prefix - ID prefix
     * @returns {string} Unique ID
     */
    generateId(prefix = 'id') {
        return `${prefix}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    },

    /**
     * Format currency
     * @param {number} amount - Amount to format
     * @param {string} currency - Currency code
     * @returns {string} Formatted amount
     */
    formatCurrency(amount, currency = '₹') {
        return `${currency} ${amount.toFixed(2)}`;
    },

    /**
     * Format number with 1 decimal place
     * @param {number} num - Number to format
     * @returns {string} Formatted number
     */
    formatNumber(num) {
        return Number(num).toFixed(1);
    },

    /**
     * Safely get nested object property
     * @param {Object} obj - Object to search
     * @param {string} path - Property path (e.g., 'a.b.c')
     * @param {*} defaultValue - Default value if not found
     * @returns {*} Property value or default
     */
    getNestedValue(obj, path, defaultValue = null) {
        const keys = path.split('.');
        let result = obj;
        for (let key of keys) {
            result = result?.[key];
        }
        return result ?? defaultValue;
    },

    /**
     * Clone object deeply
     * @param {Object} obj - Object to clone
     * @returns {Object} Cloned object
     */
    deepClone(obj) {
        return JSON.parse(JSON.stringify(obj));
    },

    /**
     * Show alert notification
     * @param {string} message - Alert message
     * @param {string} type - Alert type (success, error, warning, info)
     */
    showAlert(message, type = 'info') {
        alert(message); // Simple implementation, can be enhanced
    },

    /**
     * Validate email
     * @param {string} email - Email to validate
     * @returns {boolean} Is valid email
     */
    isValidEmail(email) {
        const re = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        return re.test(email);
    },

    /**
     * Validate date string
     * @param {string} dateStr - Date string
     * @returns {boolean} Is valid date
     */
    isValidDate(dateStr) {
        const date = new Date(dateStr);
        return date instanceof Date && !isNaN(date);
    },

    /**
     * Truncate string
     * @param {string} str - String to truncate
     * @param {number} length - Max length
     * @returns {string} Truncated string
     */
    truncate(str, length = 50) {
        return str.length > length ? str.substring(0, length) + '...' : str;
    },

    /**
     * Scroll element into view
     * @param {HTMLElement} element - Element to scroll to
     * @param {boolean} smooth - Use smooth scroll
     */
    scrollIntoView(element, smooth = true) {
        if (element) {
            element.scrollIntoView({ behavior: smooth ? 'smooth' : 'auto' });
        }
    }
};

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
    module.exports = Utils;
}
