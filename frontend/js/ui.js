/* ============================================
   DAIRY FARM DASHBOARD - UI & FORMS MODULE
   UI interactions and form helpers
   ============================================ */

/**
 * Form Utilities
 */
const FormUtils = {
    /**
     * Get form data from fields
     * @param {Object} fieldMap - Map of fieldName -> elementId
     * @returns {Object} Form data
     */
    getFormData(fieldMap) {
        const data = {};
        Object.entries(fieldMap).forEach(([fieldName, elementId]) => {
            const el = document.getElementById(elementId);
            if (el) {
                const value = el.value?.trim() || '';
                data[fieldName] = value === '' ? null : value;
            }
        });
        return data;
    },

    /**
     * Validate required fields
     * @param {Object} data - Data object
     * @param {Array} requiredFields - Required field names
     * @returns {Object} Validation result
     */
    validate(data, requiredFields) {
        const missing = requiredFields.filter(field => !data[field]);
        return {
            valid: missing.length === 0,
            missing
        };
    },

    /**
     * Clear form fields
     * @param {Array} elementIds - Element IDs to clear
     */
    clearForm(elementIds) {
        elementIds.forEach(id => {
            const el = document.getElementById(id);
            if (el) el.value = '';
        });
    },

    /**
     * Get field value
     * @param {string} elementId - Element ID
     * @returns {string} Field value
     */
    getValue(elementId) {
        const el = document.getElementById(elementId);
        return el ? el.value : '';
    },

    /**
     * Set field value
     * @param {string} elementId - Element ID
     * @param {*} value - Value to set
     */
    setValue(elementId, value) {
        const el = document.getElementById(elementId);
        if (el) el.value = value;
    },

    /**
     * Populate select options
     * @param {string} selectId - Select element ID
     * @param {Array} options - Options array {label, value}
     * @param {string} currentValue - Current selected value
     */
    populateSelect(selectId, options, currentValue = '') {
        const select = document.getElementById(selectId);
        if (!select) return;

        select.innerHTML = '<option value="">Select...</option>' +
            options.map(opt =>
                `<option value="${opt.value}">${opt.label}</option>`
            ).join('');

        if (currentValue) select.value = currentValue;
    },

    /**
     * Enable/disable form fields
     * @param {Array} elementIds - Element IDs
     * @param {boolean} enabled - Enable or disable
     */
    toggleFields(elementIds, enabled = true) {
        elementIds.forEach(id => {
            const el = document.getElementById(id);
            if (el) el.disabled = !enabled;
        });
    },

    /**
     * Show form error
     * @param {string} fieldId - Field ID
     * @param {string} message - Error message
     */
    showError(fieldId, message) {
        const el = document.getElementById(fieldId);
        if (el) {
            el.classList.add('error');
            el.title = message;
        }
    },

    /**
     * Clear form errors
     * @param {Array} fieldIds - Field IDs
     */
    clearErrors(fieldIds) {
        fieldIds.forEach(id => {
            const el = document.getElementById(id);
            if (el) {
                el.classList.remove('error');
                el.title = '';
            }
        });
    }
};

/**
 * DOM Cache for performance
 */
const DOMCache = {
    // Initialize cache
    init() {
        const selectors = [
            // Herd form
            'cowName', 'cowUID', 'earTag', 'breed', 'customBreedName',
            'birthDate', 'purchaseDate', 'cowStatus', 'motherId',
            // Milk form
            'milkCowId', 'milkDate', 'morningMilk', 'eveningMilk', 'totalMilk',
            // Health form
            'healthCowId', 'healthDate', 'symptom', 'temperature',
            'treatment', 'medicine', 'vetContacted', 'healthDescription',
            // Reproduction form
            'repoCowId', 'heatDate', 'heatSigns',
            'aiCowId', 'aiDate', 'semenType', 'sireName', 'technician',
            'pregnancyCowId', 'pregnancyDate', 'calvingCowId', 'calvingActualDate',
            'calfGender', 'calfWeight',
            // Feed form
            'feedCowId', 'feedDate', 'feedType', 'feedQuantity', 'feedCost',
            // Tables
            'herdTableBody', 'milkTableBody', 'healthTableBody',
            'reproTableBody', 'feedTableBody'
        ];

        selectors.forEach(id => {
            const el = document.getElementById(id);
            if (el) this[id] = el;
        });
    },

    /**
     * Get cached element
     * @param {string} id - Element ID
     * @returns {HTMLElement} Element or null
     */
    get(id) {
        return this[id] || document.getElementById(id);
    }
};

/**
 * Modal Manager
 */
const ModalManager = {
    /**
     * Open modal
     * @param {string} modalId - Modal ID
     */
    open(modalId) {
        const modal = document.getElementById(modalId);
        if (modal) {
            modal.style.display = 'block';
            modal.classList.add('active');
        }
    },

    /**
     * Close modal
     * @param {string} modalId - Modal ID
     */
    close(modalId) {
        const modal = document.getElementById(modalId);
        if (modal) {
            modal.style.display = 'none';
            modal.classList.remove('active');
        }
    },

    /**
     * Toggle modal
     * @param {string} modalId - Modal ID
     */
    toggle(modalId) {
        const modal = document.getElementById(modalId);
        if (modal) {
            if (modal.style.display === 'none' || !modal.style.display) {
                this.open(modalId);
            } else {
                this.close(modalId);
            }
        }
    },

    /**
     * Setup close on outside click
     * @param {string} modalId - Modal ID
     */
    setupOutsideClose(modalId) {
        const modal = document.getElementById(modalId);
        if (!modal) return;

        window.addEventListener('click', (e) => {
            if (e.target === modal) {
                this.close(modalId);
            }
        });
    }
};

/**
 * Notification Manager
 */
const NotificationManager = {
    /**
     * Show notification
     * @param {string} message - Message to show
     * @param {string} type - Type (success, error, warning, info)
     * @param {number} duration - Duration in ms
     */
    show(message, type = 'info', duration = 3000) {
        console.log(`[${type.toUpperCase()}] ${message}`);
        
        // Create toast element
        const toast = document.createElement('div');
        toast.className = `toast-notification toast-${type}`;
        toast.textContent = message;
        toast.style.cssText = `
            position: fixed;
            top: 20px;
            right: 20px;
            padding: 15px 20px;
            background: ${this._getBackground(type)};
            color: white;
            border-radius: 4px;
            box-shadow: 0 4px 6px rgba(0,0,0,0.1);
            z-index: 10000;
            animation: slideIn 0.3s ease-out;
        `;
        
        document.body.appendChild(toast);
        
        // Auto-hide
        setTimeout(() => {
            toast.style.animation = 'slideOut 0.3s ease-out';
            setTimeout(() => toast.remove(), 300);
        }, duration);
    },

    _getBackground(type) {
        const colors = {
            success: '#27ae60',
            error: '#e74c3c',
            warning: '#f39c12',
            info: '#3498db'
        };
        return colors[type] || colors.info;
    },

    /**
     * Show success message
     */
    success(message) {
        this.show(message, 'success');
    },

    /**
     * Show error message
     */
    error(message) {
        this.show(message, 'error');
    },

    /**
     * Show warning message
     */
    warning(message) {
        this.show(message, 'warning');
    },

    /**
     * Show info message
     */
    info(message) {
        this.show(message, 'info');
    }
};

/**
 * Tab Manager
 */
const TabManager = {
    /**
     * Switch to tab
     * @param {string} tabName - Tab name
     */
    switchTab(tabName) {
        // Hide all tabs
        document.querySelectorAll('.tab-content').forEach(tab => {
            tab.classList.remove('active');
        });

        // Deactivate all nav tabs
        document.querySelectorAll('.nav-tab').forEach(tab => {
            tab.classList.remove('active');
        });

        // Show selected tab
        const tabEl = document.getElementById(tabName);
        if (tabEl) {
            tabEl.classList.add('active');
        }

        // Activate nav tab
        const navTab = document.querySelector(`.nav-tab[data-tab="${tabName}"]`);
        if (navTab) {
            navTab.classList.add('active');
        }
    },

    /**
     * Setup tab navigation
     */
    setupNavigation() {
        document.querySelectorAll('.nav-tab').forEach(tab => {
            tab.addEventListener('click', (e) => {
                // Use currentTarget to ensure clicks on child elements still work
                const tabName = e.currentTarget.dataset.tab;
                this.switchTab(tabName);
            });
        });
    }
};

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        FormUtils,
        DOMCache,
        ModalManager,
        NotificationManager,
        TabManager
    };
}
