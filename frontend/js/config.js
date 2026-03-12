/* ============================================
   DAIRY FARM DASHBOARD - CONFIGURATION
   Global constants and configuration settings
   ============================================ */

const RUNTIME_ORIGIN = (typeof window !== 'undefined' && window.location?.origin)
    ? window.location.origin
    : 'http://localhost:8000';

// API Configuration
const CONFIG = {
    apiBase: `${RUNTIME_ORIGIN}/api/v1`,
    healthCheckUrl: `${RUNTIME_ORIGIN}/health`,
    fallbackStorage: false,
    debounceDelay: 300,
    
    // Feature flags
    features: {
        apiEnabled: true,
        localStorageEnabled: false,
        googleDriveSync: true,
        offlineMode: false
    },
    
    // Default values
    defaults: {
        itemsPerPage: 100,
        dateFormat: 'YYYY-MM-DD',
        timeZone: 'UTC'
    },
    
    // Breed codes
    breedCodes: {
        'holstein': 'HF',
        'jersey': 'JR',
        'guernsey': 'GY',
        'ayrshire': 'AY',
        'brown_swiss': 'BS',
        'gir': 'GIR',
        'sahiwal': 'SH',
        'red_sindhi': 'RS',
        'local': 'LC',
        'mixed': 'MX',
        'custom': 'UNK'
    },
    
    // Status options
    statuses: {
        heifer: 'Heifer (not yet lactating)',
        milking: 'Milking',
        pregnant: 'Pregnant',
        dry: 'Dry Period',
        healer: 'Healer'
    },
    
    // Feed types
    feedTypes: {
        hay: 'Hay',
        silage: 'Silage',
        pasture: 'Pasture (grazing)',
        concentrate: 'Concentrate/Grain',
        supplement: 'Supplement',
        mineral: 'Mineral Block'
    },
    
    // Health symptoms
    symptoms: {
        fever: 'Fever',
        mastitis: 'Mastitis (udder inflammation)',
        lameness: 'Lameness',
        diarrhea: 'Diarrhea',
        'loss-appetite': 'Loss of Appetite',
        discharge: 'Abnormal Discharge',
        injury: 'Injury',
        other: 'Other'
    },
    
    // Treatment options
    treatments: {
        antibiotics: 'Antibiotics',
        rest: 'Rest & observation',
        'vet-visit': 'Veterinary visit needed',
        isolation: 'Isolation',
        'medicine-applied': 'Medicine applied'
    },
    
    // Heat signs
    heatSigns: {
        'standing-heat': 'Standing heat (allows mounting)',
        mounting: 'Mounting behavior',
        discharge: 'Vulva discharge',
        restless: 'Restlessness',
        swelling: 'Vulva swelling'
    },
    
    // Semen types
    semenTypes: {
        fresh: 'Fresh',
        frozen: 'Frozen'
    },
    
    // Colors
    colors: {
        primary: '#3498db',
        success: '#27ae60',
        warning: '#f39c12',
        danger: '#e74c3c',
        info: '#3498db'
    }
};

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
    module.exports = CONFIG;
}
