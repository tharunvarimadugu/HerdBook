/* ============================================
   DAIRY FARM DASHBOARD - DATA & STATE
   Data structures and state management
   ============================================ */

// Global app state
const AppState = {
    cows: [],
    milkRecords: [],
    healthRecords: [],
    reproductionEvents: [],
    reproductionWorkflows: {},
    feedRecords: [],
    alerts: [],
    drive: {
        configured: false,
        connected: false,
        connection: null,
        backups: []
    },
    importedDataMeta: null,
    apiAvailable: false,
    initialized: false
};

/**
 * Cow Index for O(1) lookups
 */
class CowIndex {
    constructor(cows = []) {
        this.map = new Map();
        this.rebuild(cows);
    }
    
    rebuild(cows) {
        this.map.clear();
        cows.forEach(cow => this.map.set(cow.id, cow));
    }
    
    get(id) {
        return this.map.get(id);
    }
    
    add(cow) {
        this.map.set(cow.id, cow);
    }
    
    remove(id) {
        this.map.delete(id);
    }
    
    getAll() {
        return Array.from(this.map.values());
    }
    
    find(predicate) {
        for (let cow of this.map.values()) {
            if (predicate(cow)) return cow;
        }
        return null;
    }
}

let cowIndex = new CowIndex();

/**
 * Data Normalizer - Ensures consistent data format
 */
const DataNormalizer = {
    cow(apiCow) {
        return {
            id: apiCow.id,
            name: apiCow.name,
            breed: apiCow.breed,
            ear_tag: apiCow.ear_tag || `EAR-${Date.now()}`,
            cow_uid: apiCow.cow_uid,
            birth_date: apiCow.birth_date,
            purchase_date: apiCow.purchase_date || null,
            status: apiCow.status,
            mother_id: apiCow.mother_id || null,
            breed_sequence: apiCow.breed_sequence,
            photo_url: apiCow.photo_url || null,
            current_lactation_number: parseInt(apiCow.current_lactation_number || 0, 10) || 0,
            current_lactation_start_date: apiCow.current_lactation_start_date || null,
            created_at: apiCow.created_at
        };
    },
    
    milkRecord(data) {
        return {
            id: data.id || `milk-${Date.now()}`,
            cow_id: data.cow_id,
            record_date: data.record_date || data.date,
            morning_milk: parseFloat(data.morning_milk || 0),
            evening_milk: parseFloat(data.evening_milk || 0),
            total_milk: Number.isFinite(parseFloat(data.total_milk)) ? parseFloat(data.total_milk) : parseFloat((data.morning_milk || 0) + (data.evening_milk || 0)),
            lactation_number: parseInt(data.lactation_number || 0, 10) || 0
        };
    },
    
    healthRecord(data) {
        return {
            id: data.id || `health-${Date.now()}`,
            cow_id: data.cow_id,
            record_date: data.record_date || data.issue_date || data.date,
            symptom: data.symptom,
            treatment: data.treatment,
            medicine: data.medicine || data.medicine_name || null,
            vet_contacted: data.vet_contacted || data.veterinarian_contacted || false,
            temperature: data.temperature || null,
            description: data.description || '',
            lactation_number: parseInt(data.lactation_number || 0, 10) || 0
        };
    },
    
    reproductionEvent(data) {
        return {
            id: data.id || `repro-${Date.now()}`,
            cow_id: data.cow_id,
            type: data.type || data.event_type,
            record_date: data.record_date || data.event_date || data.date,
            details: data.details || {
                heat_signs: data.heat_signs,
                sire_name: data.sire_name,
                pregnancy_status: data.pregnancy_status,
                expected_calving_date: data.expected_calving_date || null,
                days_pregnant: data.days_pregnant ?? null,
                calf_gender: data.calf_gender,
                notes: data.notes || null
            },
            recorded_at: data.recorded_at || new Date().toISOString(),
            lactation_number: parseInt(data.lactation_number || 0, 10) || 0
        };
    },
    
    feedRecord(data) {
        return {
            id: data.id || `feed-${Date.now()}`,
            cow_id: data.cow_id || null,
            feed_date: data.feed_date || data.date,
            feed_type: data.feed_type,
            quantity: parseFloat(data.quantity || 0),
            cost_per_unit: data.cost_per_unit !== undefined && data.cost_per_unit !== null ? parseFloat(data.cost_per_unit) : 0,
            total_cost: data.total_cost !== undefined && data.total_cost !== null
                ? parseFloat(data.total_cost)
                : parseFloat((data.quantity || 0) * (data.cost_per_unit || 0))
        };
    }
};

/**
 * State Manager - Centralized state updates
 */
const StateManager = {
    /**
     * Save state to localStorage
     */
    save() {
        if (typeof CONFIG !== 'undefined' && CONFIG.features?.localStorageEnabled === false) {
            return;
        }
        try {
            localStorage.setItem('farmsData', JSON.stringify(AppState));
        } catch (err) {
            console.error('Failed to save state:', err);
        }
    },
    
    /**
     * Load state from localStorage
     */
    load() {
        if (typeof CONFIG !== 'undefined' && CONFIG.features?.localStorageEnabled === false) {
            return false;
        }
        try {
            const stored = localStorage.getItem('farmsData');
            if (stored) {
                const data = JSON.parse(stored);
                Object.assign(AppState, data);
                cowIndex.rebuild(AppState.cows);
                return true;
            }
        } catch (err) {
            console.error('Failed to load state:', err);
        }
        return false;
    },
    
    /**
     * Update state and persist
     */
    async updateState(changes = {}) {
        try {
            if (changes.saveToStorage !== false) {
                this.save();
            }
            
            if (changes.updateDisplay !== false) {
                this.refreshAllDisplays();
            }
        } catch (err) {
            console.error('State update failed:', err);
        }
    },
    
    /**
     * Refresh all display elements
     */
    refreshAllDisplays() {
        // To be implemented in UI module
        console.log('Display refresh needed');
    },
    
    /**
     * Clear all data
     */
    clearAll() {
        AppState.cows = [];
        AppState.milkRecords = [];
        AppState.healthRecords = [];
        AppState.reproductionEvents = [];
        AppState.reproductionWorkflows = {};
        AppState.feedRecords = [];
        AppState.alerts = [];
        cowIndex.rebuild([]);
        this.save();
    },
    
    /**
     * Get summary statistics
     */
    getStats() {
        return {
            totalCows: AppState.cows.length,
            milkingCows: AppState.cows.filter(c => c.status === 'milking').length,
            pregnantCows: AppState.cows.filter(c => c.status === 'pregnant').length,
            dryPeriodCows: AppState.cows.filter(c => c.status === 'dry').length,
            totalMilkRecords: AppState.milkRecords.length,
            totalHealthRecords: AppState.healthRecords.length,
            totalEvents: AppState.reproductionEvents.length,
            totalFeedRecords: AppState.feedRecords.length
        };
    }
};

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        AppState,
        CowIndex,
        DataNormalizer,
        StateManager,
        cowIndex
    };
}
