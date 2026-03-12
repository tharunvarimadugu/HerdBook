/* ============================================
   DAIRY FARM DASHBOARD - Main Application
   App initialization and core functionality
   ============================================ */

/**
 * Main Application Class
 */
class DairyFarmApp {
    constructor() {
        this.initialized = false;
        this.pendingEditPhotoFile = null;
        this.currentDashboardCowFilter = null;
    }

    /**
     * Initialize the application
     */
    async init() {
        console.log('🚀 Initializing Dairy Farm Dashboard...');
        console.log(`API Base URL: ${CONFIG.apiBase}`);
        console.log(`Health Check URL: ${CONFIG.healthCheckUrl}`);

        try {
            // Clear old local-only farm cache when backend-first mode is enabled.
            if (CONFIG.features?.localStorageEnabled === false) {
                try { localStorage.removeItem('farmsData'); } catch (err) { /* ignore */ }
            }

            // Initialize DOM cache
            DOMCache.init();

            // Setup tab navigation
            TabManager.setupNavigation();

            // Check API availability
            const apiOk = await APIManager.checkAvailability();
            console.log(`API Status: ${apiOk ? '✓ Connected' : '✗ Unavailable'}`);
            
            if (!apiOk) {
                NotificationManager.error(`Backend API unavailable at ${CONFIG.healthCheckUrl}. Open frontend from the same server IP and ensure backend runs on port 8000.`);
            } else {
                NotificationManager.info('✓ Connected to backend API');
            }

            // Load data
            await this.loadData();

            // Build index
            cowIndex.rebuild(AppState.cows);

            // Setup UI
            this.setupUI();
            this.setupEventListeners();

            // Initial render
            this.refreshUI();
            await this.syncDriveBackupStatus();
            await this.syncDriveBackups();
            this.handleDriveRedirectMessage();

            this.initialized = true;
            console.log('✓ Dashboard ready');

        } catch (err) {
            console.error('Initialization failed:', err);
            NotificationManager.error('Failed to initialize dashboard: ' + err.message);
        }
    }

    /**
     * Load data from API or storage
     */
    async loadData() {
        if (!AppState.apiAvailable) {
            AppState.cows = [];
            AppState.milkRecords = [];
            AppState.healthRecords = [];
            AppState.reproductionEvents = [];
            AppState.feedRecords = [];
            AppState.alerts = [];
            return;
        }

        // Try API first
        try {
            const requestDefs = [
                { key: 'cows', request: APIManager.herd.getCows() },
                { key: 'milk', request: APIManager.milk.getRecords() },
                { key: 'health', request: APIManager.health.getRecords() },
                { key: 'repro', request: APIManager.reproduction.getEvents() },
                { key: 'feed', request: APIManager.feed.getRecords() },
                { key: 'alerts', request: APIManager.health.getAlerts(false) }
            ];
            const results = await Promise.allSettled(requestDefs.map(d => d.request));
            let anyApiLoaded = false;

            results.forEach((result, idx) => {
                const key = requestDefs[idx].key;
                if (result.status !== 'fulfilled') {
                    console.warn(`API load failed for ${key}:`, result.reason);
                    return;
                }

                const payload = result.value;
                if (!payload?.success || !payload.data?.items) {
                    console.warn(`API load returned no data for ${key}`);
                    return;
                }

                anyApiLoaded = true;
                if (key === 'cows') {
                    AppState.cows = payload.data.items.map(c => DataNormalizer.cow(c));
                } else if (key === 'milk') {
                    AppState.milkRecords = payload.data.items.map(r => DataNormalizer.milkRecord(r));
                } else if (key === 'health') {
                    AppState.healthRecords = payload.data.items.map(r => DataNormalizer.healthRecord(r));
                } else if (key === 'repro') {
                    AppState.reproductionEvents = payload.data.items.map(r => DataNormalizer.reproductionEvent(r));
                } else if (key === 'feed') {
                    AppState.feedRecords = payload.data.items.map(r => DataNormalizer.feedRecord(r));
                } else if (key === 'alerts') {
                    AppState.alerts = payload.data.items;
                }
            });

            if (anyApiLoaded) {
                await APIManager.reproduction.checkAlerts();
                await this.syncAlertsFromApi(false);
                this.ensureReproductionWorkflows();
                this.applyPersistedWorkflowResponses();
            } else {
                throw new Error('All API datasets failed');
            }

            console.log(`✓ Loaded API data: cows=${AppState.cows.length}, milk=${AppState.milkRecords.length}, health=${AppState.healthRecords.length}, repro=${AppState.reproductionEvents.length}, feed=${AppState.feedRecords.length}, alerts=${AppState.alerts.length}`);
        } catch (err) {
            console.warn('API load failed:', err);
            NotificationManager.error('Failed to load backend data. Please check backend connectivity.');
        }
    }

    /**
     * Setup UI elements
     */
    setupUI() {
        // Set default dates
        Utils.setDefaultDates();

        // Setup dashboard vertical tabs
        this.setupDashboardTabs();
        this.setupDashboardCardFilters();

        // Setup modals
        ModalManager.setupOutsideClose('photoModal');
        ModalManager.setupOutsideClose('editCowModal');
        ModalManager.setupOutsideClose('filteredCowsModal');
        ModalManager.setupOutsideClose('lineageModal');
        ModalManager.setupOutsideClose('cowDashboardModal');
    }

    /**
     * Setup event listeners
     */
    setupEventListeners() {
        // Debounced milk input calculation
        const milkInputs = ['morningMilk', 'eveningMilk'];
        const updateMilkDebounced = Utils.debounce(() => this.updateMilkTotal());

        milkInputs.forEach(id => {
            const el = DOMCache.get(id);
            if (el) {
                el.addEventListener('input', updateMilkDebounced);
            }
        });

        // Photo drop zone
        this.setupPhotoDropZone();

        // Form submissions
        document.addEventListener('change', (e) => {
            if (e.target.id === 'breed') {
                this.handleBreedChange();
            } else if (e.target.id === 'reproEventType') {
                this.handleReproEventTypeChange();
            } else if (e.target.id === 'milkCowId') {
                this.updateMilkLactationHint();
            } else if (e.target.id === 'importDataFile') {
                this.handleImportFile(e);
            }
        });

        const driveButton = document.getElementById('driveButton');
        if (driveButton) {
            driveButton.addEventListener('click', () => this.connectGoogleDrive());
        }

        const driveBackupButton = document.getElementById('driveBackupButton');
        if (driveBackupButton) {
            driveBackupButton.addEventListener('click', () => this.createGoogleDriveBackup());
        }

        const driveDisconnectButton = document.getElementById('driveDisconnectButton');
        if (driveDisconnectButton) {
            driveDisconnectButton.addEventListener('click', () => this.disconnectGoogleDrive());
        }

    }

    /**
     * Setup photo drop zone
     */
    setupPhotoDropZone() {
        const dropZone = document.getElementById('photoDropZone');
        const fileInput = document.getElementById('photoInput');

        if (!dropZone || !fileInput) return;

        dropZone.addEventListener('click', () => fileInput.click());

        dropZone.addEventListener('dragover', (e) => {
            e.preventDefault();
            dropZone.classList.add('dragover');
        });

        dropZone.addEventListener('dragleave', () => {
            dropZone.classList.remove('dragover');
        });

        dropZone.addEventListener('drop', (e) => {
            e.preventDefault();
            dropZone.classList.remove('dragover');

            const files = e.dataTransfer.files;
            if (files.length > 0 && files[0].type.startsWith('image/')) {
                fileInput.files = files;
                this.handlePhotoSelect({ target: { files } });
            }
        });

        fileInput.addEventListener('change', (e) => this.handlePhotoSelect(e));
    }

    /**
     * Handle photo selection
     */
    handlePhotoSelect(e) {
        const file = e.target.files?.[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = (event) => {
            const preview = document.getElementById('photoPreview');
            if (preview) {
                preview.src = event.target.result;
                preview.style.display = 'block';
            }
        };
        reader.readAsDataURL(file);
    }

    /**
     * Update milk total
     */
    updateMilkTotal() {
        const morning = parseFloat(DOMCache.get('morningMilk')?.value) || 0;
        const evening = parseFloat(DOMCache.get('eveningMilk')?.value) || 0;
        const totalEl = DOMCache.get('totalMilk');
        if (totalEl) {
            totalEl.value = (morning + evening).toFixed(1);
        }
    }

    getCowCurrentLactationNumber(cow) {
        if (!cow) return 0;
        const explicit = parseInt(cow.current_lactation_number || 0, 10) || 0;
        if (explicit > 0) return explicit;

        const calvingCount = (AppState.reproductionEvents || []).filter(event =>
            String(event.cow_id) === String(cow.id) && event.type === 'calving'
        ).length;
        if (calvingCount > 0) return calvingCount;
        return ['milking', 'pregnant', 'dry'].includes(cow.status) ? 1 : 0;
    }

    getRecordLactationNumber(record, cow = null) {
        const explicit = parseInt(record?.lactation_number || 0, 10) || 0;
        if (explicit > 0) return explicit;
        return this.getCowCurrentLactationNumber(cow || cowIndex.get(record?.cow_id));
    }

    formatLactationLabel(lactationNumber) {
        const num = parseInt(lactationNumber || 0, 10) || 0;
        return num > 0 ? `L${num}` : 'Pre-lactation';
    }

    getLactationStartDate(cow, lactationNumber) {
        const target = parseInt(lactationNumber || 0, 10) || 0;
        if (!cow || target <= 0) {
            return cow?.current_lactation_start_date || null;
        }

        const calvings = (AppState.reproductionEvents || [])
            .filter(event => String(event.cow_id) === String(cow.id) && event.type === 'calving')
            .sort((a, b) => new Date(a.record_date) - new Date(b.record_date));

        const match = calvings[target - 1];
        return match?.record_date || (target === this.getCowCurrentLactationNumber(cow) ? cow.current_lactation_start_date : null);
    }

    getCowLactationSummaries(cowId, state = AppState) {
        const cow = (state.cows || []).find(item => String(item.id) === String(cowId));
        if (!cow) return [];

        const summaries = new Map();
        const ensureSummary = (lactationNumber) => {
            const key = parseInt(lactationNumber || 0, 10) || 0;
            if (!summaries.has(key)) {
                summaries.set(key, {
                    cow_id: cow.id,
                    cow_uid: cow.cow_uid,
                    cow_name: cow.name,
                    breed: cow.breed,
                    lactation_number: key,
                    lactation_label: this.formatLactationLabel(key),
                    start_date: this.getLactationStartDate(cow, key),
                    milk_records: 0,
                    total_milk: 0,
                    avg_daily_milk: 0,
                    health_records: 0,
                    reproduction_events: 0
                });
            }
            return summaries.get(key);
        };

        (state.milkRecords || [])
            .filter(record => String(record.cow_id) === String(cow.id))
            .forEach(record => {
                const summary = ensureSummary(this.getRecordLactationNumber(record, cow));
                summary.milk_records += 1;
                summary.total_milk += Number(record.total_milk || 0);
            });

        (state.healthRecords || [])
            .filter(record => String(record.cow_id) === String(cow.id))
            .forEach(record => {
                const summary = ensureSummary(this.getRecordLactationNumber(record, cow));
                summary.health_records += 1;
            });

        (state.reproductionEvents || [])
            .filter(record => String(record.cow_id) === String(cow.id))
            .forEach(record => {
                const summary = ensureSummary(this.getRecordLactationNumber(record, cow));
                summary.reproduction_events += 1;
                if (!summary.start_date && record.type === 'calving') {
                    summary.start_date = record.record_date;
                }
            });

        const currentLactation = this.getCowCurrentLactationNumber(cow);
        if (currentLactation > 0) {
            ensureSummary(currentLactation);
        }

        return Array.from(summaries.values())
            .map(summary => ({
                ...summary,
                avg_daily_milk: summary.milk_records > 0 ? summary.total_milk / summary.milk_records : 0
            }))
            .sort((a, b) => (a.lactation_number || 0) - (b.lactation_number || 0));
    }

    buildLactationDataset(state = AppState) {
        const rows = (state.cows || []).flatMap(cow => this.getCowLactationSummaries(cow.id, state));
        const totals = rows.reduce((acc, row) => {
            acc.lactations += 1;
            acc.milkRecords += row.milk_records;
            acc.totalMilk += row.total_milk;
            acc.healthRecords += row.health_records;
            acc.reproductionEvents += row.reproduction_events;
            return acc;
        }, {
            cows: (state.cows || []).length,
            lactations: 0,
            milkRecords: 0,
            totalMilk: 0,
            healthRecords: 0,
            reproductionEvents: 0
        });

        return { rows, totals };
    }

    updateMilkLactationHint() {
        const hintEl = document.getElementById('milkLactationHint');
        if (!hintEl) return;

        const cowId = document.getElementById('milkCowId')?.value;
        const cow = AppState.cows.find(item => String(item.id) === String(cowId));
        if (!cow) {
            hintEl.textContent = 'Lactation will be assigned automatically from the cow history.';
            return;
        }

        hintEl.textContent = `Milk will be saved under ${this.formatLactationLabel(this.getCowCurrentLactationNumber(cow))} for ${cow.name || cow.cow_uid}.`;
    }

    /**
     * Handle breed change
     */
    handleBreedChange() {
        const breedSelect = document.getElementById('breed');
        const customField = document.getElementById('customBreedField');
        const customInput = document.getElementById('customBreedName');

        if (breedSelect && customField) {
            if (breedSelect.value === 'custom') {
                customField.style.display = 'block';
                customInput?.focus();
            } else {
                customField.style.display = 'none';
                if (customInput) customInput.value = '';
            }
        }
    }

    /**
     * Handle reproduction event type change
     */
    handleReproEventTypeChange() {
        const eventType = document.getElementById('reproEventType')?.value;
        const dynamicFields = document.getElementById('reproDynamicFields');
        
        if (!dynamicFields) return;
        
        if (!eventType) {
            dynamicFields.style.display = 'none';
            return;
        }
        
        dynamicFields.style.display = 'block';
        
        // Hide all specific fields
        document.getElementById('reproHeatFields').style.display = 'none';
        document.getElementById('reproAIFields').style.display = 'none';
        document.getElementById('reproPregnancyFields').style.display = 'none';
        document.getElementById('reproCalvingFields').style.display = 'none';
        
        // Show relevant fields
        if (eventType === 'heat') document.getElementById('reproHeatFields').style.display = 'block';
        else if (eventType === 'ai') document.getElementById('reproAIFields').style.display = 'flex';
        else if (eventType === 'pregnancy') document.getElementById('reproPregnancyFields').style.display = 'block';
        else if (eventType === 'calving') document.getElementById('reproCalvingFields').style.display = 'block';
    }

    switchTab(tabName) {
        TabManager.switchTab(tabName);
    }

    showModal(modalId) {
        ModalManager.open(modalId);
    }

    hideModal(modalId) {
        ModalManager.close(modalId);
    }

    /**
     * Filter and switch to Herd Management tab
     * @param {string} filterType - 'all', 'milking', 'pregnant', 'alerts'
     */
    filterAndShowHerd(filterType) {
        this.currentHerdFilter = filterType;
        
        // Show herd tab
        this.switchTab('herd');
        
        // Render with the new filter
        this.renderHerd();
        
        // Update the select dropdown mapping if it exists
        const statusFilterDropdown = document.getElementById('herdStatusFilter');
        if (statusFilterDropdown) {
            statusFilterDropdown.value = filterType === 'alerts' ? 'all' : filterType;
        }
    }

    /**
     * Setup dashboard side-tab controls
     */
    setupDashboardTabs() {
        const tabButtons = document.querySelectorAll('#dashboard .dashboard-side-tab[data-dashboard-panel]');
        if (tabButtons.length === 0) return;

        tabButtons.forEach(btn => {
            btn.addEventListener('click', () => {
                const panelKey = btn.getAttribute('data-dashboard-panel');
                if (panelKey) this.switchDashboardPanel(panelKey, btn);
            });
        });

        // Ensure default panel state is always correct on init
        this.switchDashboardPanel('overview', tabButtons[0]);
    }

    /**
     * Setup click handlers for dashboard summary cards
     */
    setupDashboardCardFilters() {
        const cardMap = [
            { id: 'cardTotalCows', filter: 'all' },
            { id: 'cardMilkingCows', filter: 'milking' },
            { id: 'cardPregnantCows', filter: 'pregnant' },
            { id: 'cardHealthCows', filter: 'alerts' }
        ];

        cardMap.forEach(({ id, filter }) => {
            const card = document.getElementById(id);
            if (!card) return;
            card.style.cursor = 'pointer';
            card.addEventListener('click', () => this.showDashboardCowList(filter));
        });
    }

    /**
     * Switch vertical dashboard panels
     */
    switchDashboardPanel(panelKey, buttonEl = null) {
        const allPanels = document.querySelectorAll('#dashboard .dashboard-tab-panel');
        allPanels.forEach(panel => panel.classList.remove('active'));

        const targetPanel = document.getElementById(`dashboardPanel-${panelKey}`);
        if (targetPanel) {
            targetPanel.classList.add('active');
        }

        const allButtons = document.querySelectorAll('#dashboard .dashboard-side-tab');
        allButtons.forEach(btn => btn.classList.remove('active'));

        if (buttonEl) {
            buttonEl.classList.add('active');
        } else {
            const fallbackBtn = document.querySelector(`#dashboard .dashboard-side-tab[data-dashboard-panel="${panelKey}"]`);
            if (fallbackBtn) fallbackBtn.classList.add('active');
        }

        if (panelKey === 'alerts') {
            this.refreshAlertsPanel();
        }
    }

    async refreshAlertsPanel() {
        if (AppState.apiAvailable) {
            try {
                await APIManager.reproduction.checkAlerts();
                await this.syncAlertsFromApi(false);
            } catch (err) {
                console.warn('Failed to refresh alerts panel:', err);
            }
        }
        this.updateAlerts();
    }

    /**
     * Populate Mother Select Dropdowns
     */
    populateMotherDropdown() {
        const motherSelects = [
            document.getElementById('motherId'),
            // Add any other screens that might need a mother selector
        ];
        
        motherSelects.forEach(select => {
            if (!select) return;
            
            // Keep the default first option
            const defaultOption = select.options.length > 0 ? select.options[0].outerHTML : '<option value="">None / Unknown</option>';
            
            const options = AppState.cows
                .sort((a, b) => (a.name || a.cow_uid).localeCompare(b.name || b.cow_uid))
                .map(cow => `<option value="${cow.id}">${cow.name || cow.cow_uid} (${cow.cow_uid})</option>`);
                
            select.innerHTML = defaultOption + options.join('');
        });
    }

    /**
     * Refresh all UI displays
     */
    refreshUI() {
        this.updateDashboard();
        this.updateAllSelects();
        this.populateMotherDropdown();
        this.renderHerd();
        this.renderMilkTable();
        this.renderHealthTable();
        this.renderReproductionTable();
        this.renderFeedTable();
        this.updateMilkLactationHint();
        this.renderReportsVisualization();
        this.renderDriveBackupPanel();
        console.log('✓ UI refreshed');
    }

    setDriveMessage(message = '', tone = 'muted') {
        const el = document.getElementById('driveMessage');
        if (!el) return;
        const colors = {
            muted: '#7f8c8d',
            success: '#27ae60',
            error: '#c0392b',
            info: '#2980b9'
        };
        el.style.color = colors[tone] || colors.muted;
        el.textContent = message;
    }

    renderDriveBackupPanel() {
        const statusEl = document.getElementById('driveStatus');
        const backupsEl = document.getElementById('driveBackupsList');
        const driveButton = document.getElementById('driveButton');
        const backupButton = document.getElementById('driveBackupButton');
        const disconnectButton = document.getElementById('driveDisconnectButton');
        if (!statusEl || !backupsEl) return;

        const driveState = AppState.drive || {};
        if (!driveState.configured) {
            statusEl.textContent = 'Google Drive backup is not configured on this server yet. Add the Google OAuth environment variables first.';
            statusEl.style.background = '#fff7e6';
            statusEl.style.color = '#8a6d1d';
        } else if (!driveState.connected) {
            statusEl.textContent = 'Google Drive is ready to connect. Authorize one Google account for this server to enable backups.';
            statusEl.style.background = '#eef6ff';
            statusEl.style.color = '#1f4e79';
        } else {
            const email = driveState.connection?.google_email || 'connected account';
            const folder = driveState.connection?.drive_folder_name || 'Dairy Farm Backups';
            statusEl.textContent = `Connected as ${email}. Backups are stored in the "${folder}" Google Drive folder.`;
            statusEl.style.background = '#edf9f0';
            statusEl.style.color = '#21643a';
        }

        if (driveButton) driveButton.disabled = !driveState.configured;
        if (backupButton) backupButton.disabled = !driveState.configured || !driveState.connected;
        if (disconnectButton) disconnectButton.disabled = !driveState.connected;

        const backups = driveState.backups || [];
        if (backups.length === 0) {
            backupsEl.innerHTML = '<div style="color: #95a5a6;">No Google Drive backups yet.</div>';
            return;
        }

        backupsEl.innerHTML = backups.map(backup => {
            const created = backup.created_time ? new Date(backup.created_time).toLocaleString() : 'Unknown time';
            const size = backup.size_bytes ? `${(backup.size_bytes / 1024).toFixed(1)} KB` : 'Size unknown';
            const viewLink = backup.web_view_link
                ? `<a href="${backup.web_view_link}" target="_blank" rel="noopener noreferrer">Open in Drive</a>`
                : '';
            return `
                <div style="border: 1px solid #e1e7ec; border-radius: 8px; padding: 12px 14px; background: #fff;">
                    <div style="display: flex; justify-content: space-between; gap: 12px; flex-wrap: wrap; align-items: center;">
                        <div>
                            <div style="font-weight: 600; color: #2c3e50;">${backup.file_name}</div>
                            <div style="font-size: 13px; color: #7f8c8d;">${created} · ${size}</div>
                        </div>
                        <div style="display: flex; gap: 10px; align-items: center; flex-wrap: wrap;">
                            ${viewLink}
                            <button class="btn btn-secondary btn-small" type="button" onclick="app.restoreGoogleDriveBackup('${backup.drive_file_id}')">Restore</button>
                        </div>
                    </div>
                </div>
            `;
        }).join('');
    }

    async syncDriveBackupStatus() {
        if (!AppState.apiAvailable) return;
        try {
            const result = await APIManager.drive.getStatus();
            if (result.success) {
                AppState.drive = {
                    ...AppState.drive,
                    configured: !!result.data?.configured,
                    connected: !!result.data?.connected,
                    connection: result.data?.connection || null
                };
                this.renderDriveBackupPanel();
            }
        } catch (err) {
            console.warn('Failed to load Drive status:', err);
        }
    }

    async syncDriveBackups() {
        if (!AppState.apiAvailable) return;
        try {
            const result = await APIManager.drive.listBackups();
            if (result.success) {
                AppState.drive = {
                    ...AppState.drive,
                    backups: result.data?.items || []
                };
                this.renderDriveBackupPanel();
            }
        } catch (err) {
            console.warn('Failed to load Drive backups:', err);
        }
    }

    handleDriveRedirectMessage() {
        if (typeof window === 'undefined') return;
        const params = new URLSearchParams(window.location.search);
        const connected = params.get('drive_connected');
        const driveError = params.get('drive_error');
        if (connected === '1') {
            this.setDriveMessage('Google Drive connected successfully.', 'success');
        } else if (driveError) {
            this.setDriveMessage(decodeURIComponent(driveError), 'error');
        }
        if (connected || driveError) {
            params.delete('drive_connected');
            params.delete('drive_error');
            const query = params.toString();
            const nextUrl = `${window.location.pathname}${query ? `?${query}` : ''}${window.location.hash || ''}`;
            window.history.replaceState({}, document.title, nextUrl);
        }
    }

    connectGoogleDrive() {
        if (!AppState.drive?.configured) {
            this.setDriveMessage('Google Drive backup is not configured on this server.', 'error');
            return;
        }
        this.setDriveMessage('Opening Google sign-in...', 'info');
        window.location.href = APIManager.drive.getAuthUrl();
    }

    async createGoogleDriveBackup() {
        if (!AppState.apiAvailable) {
            NotificationManager.error('Backend unavailable. Google Drive backup requires backend access.');
            return;
        }
        this.setDriveMessage('Uploading backup to Google Drive...', 'info');
        const result = await APIManager.drive.createBackup();
        if (!result.success) {
            this.setDriveMessage(result.message || result.error || 'Failed to create backup', 'error');
            return;
        }
        await this.syncDriveBackupStatus();
        await this.syncDriveBackups();
        this.setDriveMessage('Backup uploaded to Google Drive.', 'success');
        NotificationManager.success('Google Drive backup completed');
    }

    async restoreGoogleDriveBackup(fileId) {
        if (!fileId) return;
        if (!confirm('Restore this Google Drive backup? This replaces the current database contents on the server.')) return;
        this.setDriveMessage('Restoring backup from Google Drive...', 'info');
        const result = await APIManager.drive.restoreBackup(fileId);
        if (!result.success) {
            this.setDriveMessage(result.message || result.error || 'Failed to restore backup', 'error');
            return;
        }
        await this.loadData();
        this.refreshUI();
        await this.syncDriveBackupStatus();
        await this.syncDriveBackups();
        this.setDriveMessage('Backup restored successfully.', 'success');
        NotificationManager.success('Google Drive backup restored');
    }

    async disconnectGoogleDrive() {
        if (!AppState.drive?.connected) return;
        if (!confirm('Disconnect Google Drive from this server? Existing backup files will stay in Drive.')) return;
        const result = await APIManager.drive.disconnect();
        if (!result.success) {
            this.setDriveMessage(result.message || result.error || 'Failed to disconnect Google Drive', 'error');
            return;
        }
        AppState.drive = {
            configured: AppState.drive.configured,
            connected: false,
            connection: null,
            backups: []
        };
        this.renderDriveBackupPanel();
        this.setDriveMessage('Google Drive disconnected.', 'success');
    }

    /**
     * Update dashboard metrics
     */
    updateDashboard() {
        const stats = StateManager.getStats();
        const today = new Date();
        const todayKey = this.getDateKey(today);
        const sevenDaysAgo = new Date(today);
        sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 6);
        const threeDaysAgo = new Date(today);
        threeDaysAgo.setDate(threeDaysAgo.getDate() - 2);
        const thirtyDaysAgo = new Date(today);
        thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 29);

        const milkRecords = AppState.milkRecords || [];
        const todayMilkRecords = milkRecords.filter(r => r.record_date === todayKey);
        const milkTodayTotal = todayMilkRecords.reduce((sum, r) => {
            const total = Number.isFinite(r.total_milk) ? r.total_milk : ((r.morning_milk || 0) + (r.evening_milk || 0));
            return sum + total;
        }, 0);

        const sevenDayMilkRecords = milkRecords.filter(r => {
            const d = new Date(r.record_date);
            return !Number.isNaN(d.getTime()) && d >= sevenDaysAgo && d <= today;
        });

        const milkByDay = new Map();
        sevenDayMilkRecords.forEach(r => {
            const key = r.record_date;
            const total = Number.isFinite(r.total_milk) ? r.total_milk : ((r.morning_milk || 0) + (r.evening_milk || 0));
            milkByDay.set(key, (milkByDay.get(key) || 0) + total);
        });

        const avgDailyMilk = milkByDay.size > 0
            ? Array.from(milkByDay.values()).reduce((a, b) => a + b, 0) / milkByDay.size
            : 0;
        const avgPerMilkingCow = stats.milkingCows > 0 ? milkTodayTotal / stats.milkingCows : 0;

        const recentHealthRecords = (AppState.healthRecords || []).filter(r => {
            const d = new Date(r.record_date);
            return !Number.isNaN(d.getTime()) && d >= sevenDaysAgo && d <= today;
        });

        const healthAlertsCount = AppState.alerts.length > 0 ? AppState.alerts.length : recentHealthRecords.length;

        // Summary cards
        this.setText('totalCows', stats.totalCows);
        this.setText('milkingCows', stats.milkingCows);
        this.setText('pregnantCows', stats.pregnantCows);
        this.setText('healthAlerts', healthAlertsCount);
        this.setText('milkToday', `${milkTodayTotal.toFixed(1)} L`);
        this.setText('milkRecordsToday', `${todayMilkRecords.length} records logged`);
        this.setText('milk7DayAvg', `${avgDailyMilk.toFixed(1)} L`);
        this.setText('avgPerCowToday', `${avgPerMilkingCow.toFixed(1)} L per milking cow`);

        // Herd status mix
        this.updateStatusMix(stats);

        // Top producers in last 7 days
        const productionByCow = new Map();
        sevenDayMilkRecords.forEach(r => {
            const total = Number.isFinite(r.total_milk) ? r.total_milk : ((r.morning_milk || 0) + (r.evening_milk || 0));
            productionByCow.set(r.cow_id, (productionByCow.get(r.cow_id) || 0) + total);
        });
        const topProducers = Array.from(productionByCow.entries())
            .sort((a, b) => b[1] - a[1])
            .slice(0, 5);
        const topProducersList = document.getElementById('topProducersList');
        if (topProducersList) {
            if (topProducers.length === 0) {
                topProducersList.innerHTML = '<p class="empty-state">No milk records available yet</p>';
            } else {
                topProducersList.innerHTML = topProducers.map(([cowId, liters], idx) => {
                    const cow = cowIndex.get(cowId);
                    return `<div class="list-item">
                        <span>${idx + 1}. ${cow?.name || 'Unknown'} (${cow?.cow_uid || '-'})</span>
                        <strong>${liters.toFixed(1)} L</strong>
                    </div>`;
                }).join('');
            }
        }

        // Care queue
        const milkedTodayCowIds = new Set(todayMilkRecords.map(r => r.cow_id));
        const missingMilkToday = AppState.cows
            .filter(c => c.status === 'milking' && !milkedTodayCowIds.has(c.id))
            .slice(0, 4)
            .map(c => ({
                type: 'milk',
                text: `${c.name || c.cow_uid} has no milk entry today`
            }));
        const urgentHealth = (AppState.healthRecords || [])
            .filter(r => {
                const d = new Date(r.record_date);
                return !Number.isNaN(d.getTime()) && d >= threeDaysAgo && d <= today;
            })
            .slice(-4)
            .reverse()
            .map(r => {
                const cow = cowIndex.get(r.cow_id);
                return {
                    type: 'health',
                    text: `${cow?.name || 'Unknown'}: ${r.symptom || 'Health issue'}`
                };
            });
        const staleRepro = AppState.cows
            .filter(c => c.status === 'pregnant')
            .filter(c => {
                const recent = (AppState.reproductionEvents || []).some(e => {
                    if (e.cow_id !== c.id) return false;
                    const d = new Date(e.record_date);
                    return !Number.isNaN(d.getTime()) && d >= thirtyDaysAgo && d <= today;
                });
                return !recent;
            })
            .slice(0, 3)
            .map(c => ({
                type: 'repro',
                text: `${c.name || c.cow_uid}: no recent reproduction update`
            }));
        const careQueue = [...missingMilkToday, ...urgentHealth, ...staleRepro].slice(0, 8);
        const careQueueList = document.getElementById('careQueueList');
        if (careQueueList) {
            if (careQueue.length === 0) {
                careQueueList.innerHTML = '<p class="empty-state">No pending care tasks</p>';
            } else {
                careQueueList.innerHTML = careQueue.map(item => `
                    <div class="list-item list-item-${item.type}">
                        <span>${item.text}</span>
                    </div>
                `).join('');
            }
        }

        // Recent activity timeline
        const activity = [
            ...(AppState.milkRecords || []).map(r => ({
                date: r.record_date,
                type: 'Milk',
                text: `${(cowIndex.get(r.cow_id)?.name || 'Unknown')}: ${(Number.isFinite(r.total_milk) ? r.total_milk : ((r.morning_milk || 0) + (r.evening_milk || 0))).toFixed(1)} L`
            })),
            ...(AppState.healthRecords || []).map(r => ({
                date: r.record_date,
                type: 'Health',
                text: `${(cowIndex.get(r.cow_id)?.name || 'Unknown')}: ${r.symptom || 'Issue recorded'}`
            })),
            ...(AppState.reproductionEvents || []).map(e => ({
                date: e.record_date,
                type: 'Repro',
                text: `${(cowIndex.get(e.cow_id)?.name || 'Unknown')}: ${e.type || 'Event'}`
            }))
        ]
            .filter(a => a.date)
            .sort((a, b) => new Date(b.date) - new Date(a.date))
            .slice(0, 10);

        const activityList = document.getElementById('dashboardActivityList');
        if (activityList) {
            if (activity.length === 0) {
                activityList.innerHTML = '<p class="empty-state">No recent activity</p>';
            } else {
                activityList.innerHTML = activity.map(a => `
                    <div class="list-item">
                        <span><strong>${a.type}</strong> · ${a.text}</span>
                        <small>${a.date}</small>
                    </div>
                `).join('');
            }
        }

        if (this.currentDashboardCowFilter) {
            this.renderDashboardCowList(this.currentDashboardCowFilter);
        }

        this.updateAlerts();
    }

    /**
     * Update alerts panel
     */
    updateAlerts() {
        const alertsList = document.getElementById('alertsList');
        if (!alertsList) return;
        const today = new Date();
        const sevenDaysAgo = new Date(today);
        sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 6);

        const backendAlerts = (AppState.alerts || [])
            .filter(a => !a.resolved_at)
            .slice(0, 8)
            .map(a => ({
                severity: a.severity || 'info',
                message: a.message || 'Alert',
                cow_id: a.cow_id,
                type: 'system',
                created_at: a.created_at || null,
                alert_type: a.alert_type || null,
                workflow_type: this.getWorkflowTypeFromAlertType(a.alert_type || '')
            }));

        const recentHealthAlerts = (AppState.healthRecords || [])
            .filter(r => {
                const d = new Date(r.record_date);
                return !Number.isNaN(d.getTime()) && d >= sevenDaysAgo && d <= today;
            })
            .slice(-6)
            .reverse()
            .map(r => ({
                severity: 'warning',
                message: `${r.symptom || 'Health issue'}${r.treatment ? ` - ${r.treatment}` : ''}`,
                cow_id: r.cow_id,
                type: 'health',
                created_at: r.record_date || null
            }));

        const seen = new Set();
        const computedAlerts = [...backendAlerts, ...recentHealthAlerts].filter(a => {
            const key = `${a.cow_id}|${a.message}`;
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
        });

        const workflowAlerts = AppState.apiAvailable ? [] : this.getReproductionWorkflowAlerts();
        const mergedAlerts = [...workflowAlerts, ...computedAlerts].slice(0, 10);

        if (mergedAlerts.length === 0) {
            const emptyHtml = '<p class="empty-state">No active alerts</p>';
            alertsList.innerHTML = emptyHtml;
            return;
        }

        const alertsHtml = mergedAlerts.map(alert => {
            const cow = cowIndex.get(alert.cow_id);
            const needsWorkflowActions = alert.actions || !!alert.workflow_type;
            const actionsHtml = needsWorkflowActions
                ? `<div class="alert-actions">
                        <button type="button" class="btn btn-success btn-small" onclick="app.resolveWorkflowAlert('${alert.cow_id}', '${alert.workflow_type}', 'yes')">Yes</button>
                        <button type="button" class="btn btn-danger btn-small" onclick="app.resolveWorkflowAlert('${alert.cow_id}', '${alert.workflow_type}', 'no')">No</button>
                   </div>`
                : '';
            return `<div class="alert-item ${alert.severity || 'info'}">
                <span><strong>${cow?.name || 'Unknown'}</strong> - ${alert.message}</span>
                ${actionsHtml}
            </div>`;
        }).join('');
        alertsList.innerHTML = alertsHtml;
    }

    async syncAlertsFromApi(unresolvedOnly = false) {
        if (!AppState.apiAvailable) return;
        try {
            const result = await APIManager.health.getAlerts(unresolvedOnly);
            if (result.success && result.data?.items) {
                AppState.alerts = result.data.items;
            }
        } catch (err) {
            console.warn('Failed to sync alerts from API:', err);
        }
    }

    getWorkflowTypeFromAlertType(alertType) {
        const workflowMap = {
            'workflow-pregnancy-check-3m': 'pregnancy_check_3m',
            'workflow-stop-milking-6m': 'stop_milking_6m',
            'workflow-dry-period-7m': 'dry_period_7m'
        };
        return workflowMap[alertType] || null;
    }

    getReproductionWorkflowAlerts() {
        this.ensureReproductionWorkflows();
        this.applyPersistedWorkflowResponses();
        const alerts = [];
        const today = new Date();
        const workflows = AppState.reproductionWorkflows || {};

        Object.entries(workflows).forEach(([cowId, flow]) => {
            if (!flow || !flow.ai_date) return;

            const aiDate = new Date(flow.ai_date);
            if (Number.isNaN(aiDate.getTime())) return;

            const month3 = this.addMonths(aiDate, 3);
            const month6 = this.addMonths(aiDate, 6);
            const month7 = this.addMonths(aiDate, 7);

            if (today >= month3 && !flow.pregnancy_confirmed) {
                alerts.push({
                    severity: 'warning',
                    message: 'AI follow-up: Is pregnancy confirmed after 3 months?',
                    cow_id: cowId,
                    type: 'workflow',
                    workflow_type: 'pregnancy_check_3m',
                    actions: true
                });
                return;
            }

            if (flow.pregnancy_confirmed === 'yes' && today >= month6 && !flow.stop_milking_confirmed) {
                alerts.push({
                    severity: 'warning',
                    message: 'Cow entered 6th pregnancy month. Stop milking this cow?',
                    cow_id: cowId,
                    type: 'workflow',
                    workflow_type: 'stop_milking_6m',
                    actions: true
                });
                return;
            }

            if (flow.pregnancy_confirmed === 'yes' && today >= month7 && !flow.dry_period_confirmed) {
                alerts.push({
                    severity: 'warning',
                    message: '7th month check: Is this cow in dry period from this month?',
                    cow_id: cowId,
                    type: 'workflow',
                    workflow_type: 'dry_period_7m',
                    actions: true
                });
            }
        });

        return alerts;
    }

    async resolveWorkflowAlert(cowId, workflowType, answer) {
        if (!AppState.apiAvailable) {
            NotificationManager.error('Backend unavailable. Reproduction feedback needs backend sync.');
            return;
        }

        const normalizedAnswer = answer === 'yes' ? 'yes' : 'no';

        try {
            const result = await APIManager.reproduction.submitWorkflowFeedback({
                cow_id: cowId,
                workflow_type: workflowType,
                answer: normalizedAnswer,
                response_date: this.getDateKey(new Date())
            });

            if (!result.success) {
                NotificationManager.error(result.message || result.error || 'Failed to save reproduction feedback');
                return;
            }

            const cow = AppState.cows.find(c => String(c.id) === String(cowId));
            if (cow && result.data?.cow_status) {
                cow.status = result.data.cow_status;
            }

            if (result.data?.event) {
                const savedEvent = DataNormalizer.reproductionEvent(result.data.event);
                const existingIdx = AppState.reproductionEvents.findIndex(e => String(e.id) === String(savedEvent.id));
                if (existingIdx >= 0) {
                    AppState.reproductionEvents[existingIdx] = savedEvent;
                } else {
                    AppState.reproductionEvents.push(savedEvent);
                }
            }

            await APIManager.reproduction.checkAlerts();
            await this.syncAlertsFromApi(false);
            this.ensureReproductionWorkflows();
            this.applyPersistedWorkflowResponses();
            this.updateAlerts();
            this.updateDashboard();
            this.renderHerd();
            this.renderReproductionTable();
            this.updateAllSelects();
            NotificationManager.success(`Saved response: ${normalizedAnswer.toUpperCase()}`);
        } catch (err) {
            console.warn('Failed to save workflow feedback:', err);
            NotificationManager.error(`Failed to save reproduction feedback: ${err.message}`);
        }
    }

    ensureReproductionWorkflows() {
        if (!AppState.reproductionWorkflows) AppState.reproductionWorkflows = {};
        let changed = false;

        const latestAIByCow = new Map();
        (AppState.reproductionEvents || [])
            .filter(e => e.type === 'ai' && e.cow_id && e.record_date)
            .forEach(e => {
                const current = latestAIByCow.get(e.cow_id);
                if (!current || new Date(e.record_date) > new Date(current.record_date)) {
                    latestAIByCow.set(e.cow_id, e);
                }
            });

        latestAIByCow.forEach((aiEvent, cowId) => {
            const existing = AppState.reproductionWorkflows[cowId];
            if (!existing || existing.ai_date !== aiEvent.record_date) {
                AppState.reproductionWorkflows[cowId] = {
                    ai_event_id: aiEvent.id,
                    ai_date: aiEvent.record_date,
                    pregnancy_confirmed: null,
                    pregnancy_confirmed_at: null,
                    stop_milking_confirmed: null,
                    stop_milking_confirmed_at: null,
                    dry_period_confirmed: null,
                    dry_period_confirmed_at: null
                };
                changed = true;
            }
        });

        if (changed) {
            StateManager.save();
        }
    }

    applyPersistedWorkflowResponses() {
        if (!AppState.reproductionWorkflows) AppState.reproductionWorkflows = {};
        const responseByType = {
            'workflow-pregnancy-check-3m': 'pregnancy_confirmed',
            'workflow-stop-milking-6m': 'stop_milking_confirmed',
            'workflow-dry-period-7m': 'dry_period_confirmed'
        };

        (AppState.alerts || []).forEach(alert => {
            const field = responseByType[alert.alert_type];
            if (!field) return;
            if (!alert.resolution_notes) return;
            const answer = String(alert.resolution_notes).toLowerCase() === 'yes' ? 'yes' : 'no';
            if (!AppState.reproductionWorkflows[alert.cow_id]) {
                AppState.reproductionWorkflows[alert.cow_id] = {
                    ai_event_id: null,
                    ai_date: null,
                    pregnancy_confirmed: null,
                    pregnancy_confirmed_at: null,
                    stop_milking_confirmed: null,
                    stop_milking_confirmed_at: null,
                    dry_period_confirmed: null,
                    dry_period_confirmed_at: null
                };
            }
            AppState.reproductionWorkflows[alert.cow_id][field] = answer;
            if (field === 'pregnancy_confirmed') {
                AppState.reproductionWorkflows[alert.cow_id].pregnancy_confirmed_at = alert.resolved_at || null;
            } else if (field === 'stop_milking_confirmed') {
                AppState.reproductionWorkflows[alert.cow_id].stop_milking_confirmed_at = alert.resolved_at || null;
            } else if (field === 'dry_period_confirmed') {
                AppState.reproductionWorkflows[alert.cow_id].dry_period_confirmed_at = alert.resolved_at || null;
            }
        });
    }

    addMonths(dateObj, months) {
        const d = new Date(dateObj);
        d.setMonth(d.getMonth() + months);
        return d;
    }

    setText(elementId, value) {
        const el = document.getElementById(elementId);
        if (el) el.textContent = value;
    }

    getDateKey(dateObj) {
        return dateObj.toISOString().split('T')[0];
    }

    updateStatusMix(stats) {
        const total = stats.totalCows || 0;
        const statusData = [
            { key: 'Milking', count: stats.milkingCows || 0, countId: 'statusMilkingCount', pctId: 'statusMilkingPct' },
            { key: 'Pregnant', count: stats.pregnantCows || 0, countId: 'statusPregnantCount', pctId: 'statusPregnantPct' },
            { key: 'Dry', count: stats.dryPeriodCows || 0, countId: 'statusDryCount', pctId: 'statusDryPct' },
            {
                key: 'Heifer',
                count: AppState.cows.filter(c => c.status === 'heifer').length,
                countId: 'statusHeiferCount',
                pctId: 'statusHeiferPct'
            }
        ];

        statusData.forEach(item => {
            this.setText(item.countId, item.count);
            const pctEl = document.getElementById(item.pctId);
            if (pctEl) {
                const pct = total > 0 ? (item.count / total) * 100 : 0;
                pctEl.style.width = `${pct.toFixed(1)}%`;
                pctEl.title = `${item.key}: ${pct.toFixed(1)}%`;
            }
        });
    }

    showDashboardCowList(filterType) {
        this.currentDashboardCowFilter = filterType;
        // Keep the list in overview panel where cards are visible
        this.switchDashboardPanel('overview');
        this.renderDashboardCowList(filterType);
    }

    hideDashboardCowList() {
        this.currentDashboardCowFilter = null;
        const panel = document.getElementById('dashboardCowListPanel');
        if (panel) panel.style.display = 'none';
    }

    renderDashboardCowList(filterType) {
        const panel = document.getElementById('dashboardCowListPanel');
        const titleEl = document.getElementById('dashboardCowListTitle');
        const listEl = document.getElementById('dashboardCowList');
        if (!panel || !titleEl || !listEl) return;

        let cows = AppState.cows;
        let title = 'Matching Cows';

        if (filterType === 'milking') {
            cows = AppState.cows.filter(c => c.status === 'milking');
            title = 'Milking Cows';
        } else if (filterType === 'pregnant') {
            cows = AppState.cows.filter(c => c.status === 'pregnant');
            title = 'Pregnant Cows';
        } else if (filterType === 'alerts' || filterType === 'health') {
            const alertCowIds = this.getAlertCowIds();
            cows = AppState.cows.filter(c => alertCowIds.has(String(c.id)));
            title = 'Cows With Alerts';
        } else {
            title = 'All Cows';
        }

        titleEl.textContent = `${title} (${cows.length})`;
        panel.style.display = 'block';
        panel.scrollIntoView({ behavior: 'smooth', block: 'start' });

        if (cows.length === 0) {
            listEl.innerHTML = '<p class="empty-state">No cows found for this filter</p>';
            return;
        }

        listEl.innerHTML = cows
            .sort((a, b) => {
                const nameA = String(a.name || a.cow_uid || a.id || '');
                const nameB = String(b.name || b.cow_uid || b.id || '');
                return nameA.localeCompare(nameB);
            })
            .map(cow => `
                <div class="list-item">
                    <span>
                        <strong>${cow.name || cow.cow_uid || 'Unnamed'}</strong>
                        (${cow.cow_uid || cow.id || '-'}) · ${cow.breed || '-'} · ${this.getCowStatusLabel(cow)}
                    </span>
                    <button type="button" class="btn btn-primary btn-small" onclick="app.openCowDashboard('${cow.id}')">View</button>
                </div>
            `).join('');
    }

    /**
     * Update all select dropdowns
     */
    updateAllSelects() {
        const options = '<option value="">Choose a cow...</option>' +
            AppState.cows.map(cow =>
                `<option value="${cow.id}">${cow.name} (${cow.cow_uid})</option>`
            ).join('');

        const milkingOptions = '<option value="">Choose a milking cow...</option>' +
            AppState.cows
                .filter(cow => cow.status === 'milking')
                .map(cow => `<option value="${cow.id}">${cow.name} (${cow.cow_uid})</option>`)
                .join('');

        const selectIds = ['milkCowId', 'healthCowId', 'repoCowId', 'aiCowId',
                          'pregnancyCowId', 'calvingCowId', 'feedCowId'];

        selectIds.forEach(id => {
            const select = DOMCache.get(id);
            if (select) {
                const currentValue = select.value;
                select.innerHTML = id === 'milkCowId' ? milkingOptions : options;
                select.value = currentValue;
            }
        });

        // Mother ID select (use cow_uid as value)
        const motherSelect = DOMCache.get('motherId');
        if (motherSelect) {
            const currentValue = motherSelect.value;
            const motherOptions = '<option value="">Unknown / Select Mother...</option>' +
                AppState.cows.map(cow =>
                    `<option value="${cow.cow_uid}">${cow.name} (${cow.cow_uid})</option>`
                ).join('');
            motherSelect.innerHTML = motherOptions;
            motherSelect.value = currentValue;
        }
    }

    /**
     * Render herd list
     */
    renderHerd() {
        const tbody = document.getElementById('herdTableBody');
        if (!tbody) return;

        let filteredCows = AppState.cows;
        
        // Apply dashboard filter state
        if (this.currentHerdFilter) {
            if (this.currentHerdFilter === 'milking') {
                filteredCows = AppState.cows.filter(c => c.status === 'milking');
            } else if (this.currentHerdFilter === 'pregnant') {
                filteredCows = AppState.cows.filter(c => c.status === 'pregnant');
            } else if (this.currentHerdFilter === 'alerts' || this.currentHerdFilter === 'health') {
                const alertCowIds = this.getAlertCowIds();
                filteredCows = AppState.cows.filter(c => alertCowIds.has(String(c.id)));
            }
        }

        if (filteredCows.length === 0) {
            tbody.innerHTML = '<tr><td colspan="6" style="text-align: center; color: #95a5a6;">No cows found matching the filter</td></tr>';
            return;
        }

        tbody.innerHTML = filteredCows.map(cow => `
            <tr onclick="app.openCowDashboard('${cow.id}')" style="cursor: pointer;">
                <td style="text-align: center;">
                    ${cow.photo_url ? 
                        `<img src="${cow.photo_url.startsWith('data:image') ? cow.photo_url : `${CONFIG.apiBase}/herd/cows/${cow.id}/photo?t=${Date.now()}`}" alt="Photo" style="width: 40px; height: 40px; border-radius: 50%; object-fit: cover;">` : 
                        `<div style="width: 40px; height: 40px; border-radius: 50%; background: #ecf0f1; display: flex; align-items: center; justify-content: center; font-size: 20px; margin: 0 auto;">🐄</div>`
                    }
                </td>
                <td>${cow.cow_uid}</td>
                <td><strong>${cow.name || '-'}</strong></td>
                <td>${cow.breed.charAt(0).toUpperCase() + cow.breed.slice(1)}</td>
                <td><span class="cow-status status-${this.getCowDisplayStatus(cow).replace('_', '-')}">${this.getCowStatusLabel(cow)}</span></td>
                <td>${Utils.calculateAge(cow.birth_date)}</td>
                <td>
                    <button type="button" class="btn btn-primary" onclick="event.stopPropagation(); app.openEditModal('${cow.id}')" style="padding: 4px 8px; font-size: 12px;">Edit</button>
                    <button type="button" class="btn btn-danger" onclick="event.stopPropagation(); app.removeCow('${cow.id}')" style="padding: 4px 8px; font-size: 12px; margin-left: 5px;">Delete</button>
                    ${CONFIG.ENABLE_PHOTO_UPLOAD ? `
                    <button type="button" class="btn btn-primary" onclick="event.stopPropagation(); document.getElementById('photoCowId').value='${cow.id}'; app.showModal('photoModal')" style="padding: 4px 8px; font-size: 12px;">📸</button>
                    ` : ''}
                </td>
            </tr>
        `).join('');
    }

    /**
     * Open edit modal
     */
    openEditModal(cowId) {
        const cow = AppState.cows.find(c => c.id === cowId);
        if (!cow) return;

        document.getElementById('editCowName').value = cow.name || '';
        document.getElementById('editCowStatus').value = cow.status || '';
        
        // Reset the file input and show preview if photo exists
        const photoInput = document.getElementById('editCowPhoto');
        if (photoInput) photoInput.value = '';
        this.pendingEditPhotoFile = null;
        const photoNameEl = document.getElementById('editCowPhotoName');
        if (photoNameEl) photoNameEl.textContent = 'No file chosen';
        
        const previewEl = document.getElementById('editCowPhotoPreview');
        if (previewEl) {
            if (cow.photo_url) {
                previewEl.src = cow.photo_url.startsWith('data:image') ? cow.photo_url : `${CONFIG.apiBase}/herd/cows/${cow.id}/photo?t=${Date.now()}`;
                previewEl.style.display = 'block';
            } else {
                previewEl.style.display = 'none';
                previewEl.src = '';
            }
        }

        this.currentEditingCowId = cowId;
        ModalManager.open('editCowModal');
    }

    /**
     * Preview photo when picked in edit modal
     */
    previewEditPhoto(input) {
        if (input.files && input.files[0]) {
            this.pendingEditPhotoFile = input.files[0];
            const photoNameEl = document.getElementById('editCowPhotoName');
            if (photoNameEl) photoNameEl.textContent = input.files[0].name;

            const reader = new FileReader();
            reader.onload = function(e) {
                const previewEl = document.getElementById('editCowPhotoPreview');
                if (previewEl) {
                    previewEl.src = e.target.result;
                    previewEl.style.display = 'block';
                }
            };
            reader.readAsDataURL(input.files[0]);
        }
    }

    /**
     * Open file picker for edit photo
     */
    openEditPhotoPicker() {
        const photoInput = document.getElementById('editCowPhoto');
        if (photoInput) {
            photoInput.click();
        }
    }

    /**
     * Upload photo selected in the edit modal for the currently editing cow
     */
    async uploadEditedCowPhoto(selectedPhotoFile = null) {
        if (!this.currentEditingCowId) {
            NotificationManager.error('No cow selected for editing');
            return false;
        }

        const photoInput = document.getElementById('editCowPhoto');
        const photoFile =
            selectedPhotoFile ||
            this.pendingEditPhotoFile ||
            (photoInput && photoInput.files ? photoInput.files[0] : null);

        if (!photoFile) {
            NotificationManager.info('Please choose a photo first');
            if (photoInput) {
                photoInput.addEventListener('change', () => {
                    const chosenFile = photoInput.files && photoInput.files[0] ? photoInput.files[0] : null;
                    if (chosenFile) {
                        this.uploadEditedCowPhoto(chosenFile);
                    }
                }, { once: true });
            }
            this.openEditPhotoPicker();
            return false;
        }

        const allowedExtensions = ['jpg', 'jpeg', 'png', 'webp', 'gif'];
        const fileName = (photoFile.name || '').toLowerCase();
        const ext = fileName.includes('.') ? fileName.split('.').pop() : '';
        if (!allowedExtensions.includes(ext)) {
            NotificationManager.error('Unsupported image format. Use JPG, PNG, WEBP, or GIF.');
            return false;
        }

        const cow = AppState.cows.find(c => c.id === this.currentEditingCowId);
        if (!cow) {
            NotificationManager.error('Cow not found');
            return false;
        }

        NotificationManager.info('Uploading photo...');
        const previousPhotoUrl = cow.photo_url;

        try {
            const dataUrl = await new Promise((resolve, reject) => {
                const reader = new FileReader();
                reader.onload = (e) => resolve(e.target.result);
                reader.onerror = (err) => reject(err);
                reader.readAsDataURL(photoFile);
            });

            // Update preview immediately in case upload takes time
            const previewEl = document.getElementById('editCowPhotoPreview');
            if (previewEl) {
                previewEl.src = dataUrl;
                previewEl.style.display = 'block';
            }

            if (!AppState.apiAvailable) {
                NotificationManager.error('Backend unavailable. Photo upload requires API connection.');
                return false;
            }

            const result = await APIManager.herd.uploadPhoto(cow.id, photoFile);
            if (result.success && result.data && result.data.photo_url) {
                cow.photo_url = `${result.data.photo_url}?t=${Date.now()}`;
                NotificationManager.success('Photo uploaded successfully');
            } else {
                cow.photo_url = previousPhotoUrl;
                NotificationManager.error(result.message || 'Photo upload failed on server');
                return false;
            }

            StateManager.save();
            this.renderHerd();

            // Clear file input so user can re-upload if needed
            if (photoInput) photoInput.value = '';
            this.pendingEditPhotoFile = null;
            const photoNameEl = document.getElementById('editCowPhotoName');
            if (photoNameEl) photoNameEl.textContent = 'No file chosen';
            return true;
        } catch (err) {
            console.error('Photo upload failed:', err);
            cow.photo_url = previousPhotoUrl;
            NotificationManager.error('Failed to upload photo');
            return false;
        }
    }

    /**
     * Save edited cow
     */
    async saveEditedCow() {
        if (!AppState.apiAvailable) {
            NotificationManager.error('Backend unavailable. Edit is disabled to keep data consistent across devices.');
            return;
        }
        if (!this.currentEditingCowId) {
            NotificationManager.error('No cow selected for editing');
            return;
        }

        const cowIndexToEdit = AppState.cows.findIndex(c => c.id === this.currentEditingCowId);
        if (cowIndexToEdit === -1) {
            NotificationManager.error('Cow not found');
            return;
        }

        const cow = AppState.cows[cowIndexToEdit];
        const newName = document.getElementById('editCowName').value.trim();
        const newStatus = document.getElementById('editCowStatus').value;
        const photoInput = document.getElementById('editCowPhoto');
        const photoFile = photoInput && photoInput.files ? photoInput.files[0] : null;

        if (!newName || !newStatus) {
            NotificationManager.error('Name and status are required');
            return;
        }

        NotificationManager.info('Saving cow details...');

        // Update basic details locally
        cow.name = newName;
        cow.status = newStatus;

        try {
            // Update via API
            const updateResult = await APIManager.herd.updateCow(cow.id, {
                name: newName,
                status: newStatus
            });
            if (!updateResult?.success) {
                NotificationManager.error(updateResult?.message || updateResult?.error || 'Failed to update cow');
                return;
            }
            console.log('✓ Cow basic details updated online');

            // Handle photo upload if a new photo was selected
            if (photoFile) {
                const photoUploaded = await this.uploadEditedCowPhoto(photoFile);
                if (!photoUploaded) {
                    return;
                }
            } else {
                console.log('ℹ No photo file selected');
            }

            // Finalize the save
            this._finalizeSaveEditedCow();
        } catch (error) {
            console.error('Error saving edited cow:', error);
            NotificationManager.error('Failed to save cow details: ' + error.message);
        }
    }

    _finalizeSaveEditedCow() {
        // Update index and exact state
        const cow = AppState.cows.find(c => c.id === this.currentEditingCowId);
        if (cow) {
             cowIndex.add(cow);
        }
        
        StateManager.save();
        this.renderHerd();
        this.updateAllSelects();

        ModalManager.close('editCowModal');
        NotificationManager.success('Cow updated successfully');
        this.currentEditingCowId = null;
    }

    /**
     * Open cow dashboard
     */
    openCowDashboard(cowId) {
        const cow = AppState.cows.find(c => c.id === cowId);
        if (!cow) {
            NotificationManager.error('Cow not found');
            return;
        }

        // Set photo
        const photoEl = document.getElementById('cowDashPhoto');
        const placeholderEl = document.getElementById('cowDashPhotoPlaceholder');
        if (cow.photo_url) {
            photoEl.src = cow.photo_url.startsWith('data:image') ? cow.photo_url : `${CONFIG.apiBase}/herd/cows/${cow.id}/photo?t=${Date.now()}`;
            photoEl.style.display = 'block';
            placeholderEl.style.display = 'none';
        } else {
            photoEl.style.display = 'none';
            placeholderEl.style.display = 'block';
        }

        // Set basic info
        document.getElementById('cowDashTitle').textContent = `📊 ${cow.name}'s Dashboard`;
        document.getElementById('cowDashName').textContent = cow.name;
        document.getElementById('cowDashUID').textContent = cow.cow_uid || 'N/A';
        document.getElementById('cowDashEarTag').textContent = cow.ear_tag || 'N/A';
        document.getElementById('cowDashBreed').textContent = cow.breed;
        document.getElementById('cowDashStatus').textContent = this.getCowStatusLabel(cow);
        document.getElementById('cowDashLactation').textContent = this.formatLactationLabel(this.getCowCurrentLactationNumber(cow));
        document.getElementById('cowDashAge').textContent = Utils.calculateAge(cow.birth_date);
        document.getElementById('cowDashBirthDate').textContent = cow.birth_date || 'N/A';
        document.getElementById('cowDashPurchaseDate').textContent = cow.purchase_date || 'Not recorded';

        // Load Milk Records for this cow
        const cowMilkRecords = AppState.milkRecords
            .filter(r => r.cow_id === cowId)
            .sort((a, b) => new Date(b.record_date) - new Date(a.record_date));
            
        const milkTbody = document.getElementById('cowDashMilkTableBody');
        if (cowMilkRecords.length === 0) {
            milkTbody.innerHTML = '<tr><td colspan="5" style="text-align: center; color: #95a5a6;">No milk records found</td></tr>';
        } else {
            milkTbody.innerHTML = cowMilkRecords.map(record => `
                <tr>
                    <td>${this.formatLactationLabel(this.getRecordLactationNumber(record, cow))}</td>
                    <td>${record.record_date}</td>
                    <td>${record.morning_milk}</td>
                    <td>${record.evening_milk}</td>
                    <td><strong>${record.morning_milk + record.evening_milk}</strong></td>
                </tr>
            `).join('');
        }

        // Load Health Alerts for this cow
        const cowHealthRecords = AppState.healthRecords
            .filter(a => a.cow_id === cowId)
            .sort((a, b) => new Date(b.record_date) - new Date(a.record_date));
            
        const healthTbody = document.getElementById('cowDashHealthTableBody');
        if (cowHealthRecords.length === 0) {
            healthTbody.innerHTML = '<tr><td colspan="4" style="text-align: center; color: #95a5a6;">No health alerts found</td></tr>';
        } else {
            healthTbody.innerHTML = cowHealthRecords.map(alert => `
                <tr>
                    <td>${this.formatLactationLabel(this.getRecordLactationNumber(alert, cow))}</td>
                    <td>${alert.record_date || '-'}</td>
                    <td>${alert.symptom || '-'}${alert.treatment ? ` - ${alert.treatment}` : ''}</td>
                    <td><span class="status-badge warning">Recorded</span></td>
                </tr>
            `).join('');
        }

        // Load Repro Events for this cow
        const cowReproEvents = AppState.reproductionEvents
            .filter(e => e.cow_id === cowId)
            .sort((a, b) => new Date(b.record_date) - new Date(a.record_date));
            
        const reproTbody = document.getElementById('cowDashReproTableBody');
        if (cowReproEvents.length === 0) {
            reproTbody.innerHTML = '<tr><td colspan="4" style="text-align: center; color: #95a5a6;">No reproduction events found</td></tr>';
        } else {
            reproTbody.innerHTML = cowReproEvents.map(event => `
                <tr>
                    <td>${this.formatLactationLabel(this.getRecordLactationNumber(event, cow))}</td>
                    <td>${event.record_date}</td>
                    <td>${event.type}</td>
                    <td>${Object.entries(event.details || {}).map(([k, v]) => `${k.replace('_', ' ')}: ${v}`).join(', ') || '-'}</td>
                </tr>
            `).join('');
        }

        // Show dasboard modal
        ModalManager.open('cowDashboardModal');
    }

    /**
     * Close cow dashboard
     */
    closeCowDashboard() {
        ModalManager.close('cowDashboardModal');
    }

    /**
     * Remove cow
     */
    async removeCow(cowId) {
        if (!confirm('Remove this cow? This cannot be undone.')) return;
        if (!AppState.apiAvailable) {
            NotificationManager.error('Backend unavailable. Delete is disabled to keep data consistent across devices.');
            return;
        }

        const deleteResult = await APIManager.herd.deleteCow(cowId);
        if (!deleteResult?.success) {
            NotificationManager.error(deleteResult?.message || deleteResult?.error || 'Failed to delete cow');
            return;
        }

        AppState.cows = AppState.cows.filter(c => c.id !== cowId);
        cowIndex.remove(cowId);

        StateManager.save();
        this.renderHerd();
        this.updateAllSelects();
        NotificationManager.success('Cow removed');
    }

    /**
     * Record milk production
     */
    async recordMilk() {
        if (!AppState.apiAvailable) {
            NotificationManager.error('Backend unavailable. Milk records are backend-only for cross-device sync.');
            return;
        }
        const cowId = document.getElementById('milkCowId').value;
        const date = document.getElementById('milkDate').value;
        const morning = parseFloat(document.getElementById('morningMilk').value) || 0;
        const evening = parseFloat(document.getElementById('eveningMilk').value) || 0;

        // Validation
        if (!cowId || !date) {
            NotificationManager.error('Please select cow and date');
            return;
        }

        if (morning < 0 || evening < 0) {
            NotificationManager.error('Milk amounts cannot be negative');
            return;
        }

        const cow = AppState.cows.find(c => c.id === cowId);
        if (!cow) {
            NotificationManager.error('Cow not found');
            return;
        }

        if (cow.status !== 'milking') {
            NotificationManager.error('Only cows in milking status can be selected here');
            return;
        }

        try {
            console.log('Recording milk to API:', { cow_id: cowId, record_date: date, morning_milk: morning, evening_milk: evening });
            const result = await APIManager.milk.recordProduction({
                cow_id: cowId,
                record_date: date,
                morning_milk: morning,
                evening_milk: evening,
                lactation_number: this.getCowCurrentLactationNumber(cow)
            });
            
            if (result.success) {
                if (result.data) {
                    const saved = DataNormalizer.milkRecord(result.data);
                    const idx = AppState.milkRecords.findIndex(r => r.id === saved.id);
                    if (idx >= 0) AppState.milkRecords[idx] = saved;
                    else AppState.milkRecords.push(saved);
                    StateManager.save();
                }
                NotificationManager.success(`✓ Milk recorded for ${cow.name}: ${morning + evening}L`);
                document.getElementById('morningMilk').value = '';
                document.getElementById('eveningMilk').value = '';
                document.getElementById('totalMilk').value = '';
                this.renderMilkTable();
                this.updateDashboard();
                return;
            }
            console.warn('API error:', result);
            NotificationManager.error(`API Error: ${result.message || result.error || 'Failed to record'}`);
            return;
        } catch (err) {
            console.error('API call failed:', err);
            NotificationManager.error(`Failed to save milk record: ${err.message}`);
            return;
        }
    }

    /**
     * Render milk production table
     */
    renderMilkTable() {
        const tbody = document.getElementById('milkTableBody');
        if (!tbody) return;

        if (AppState.milkRecords.length === 0) {
            tbody.innerHTML = '<tr><td colspan="6" style="text-align: center; color: #95a5a6;">No records yet</td></tr>';
            return;
        }

        tbody.innerHTML = AppState.milkRecords
            .sort((a, b) => new Date(b.record_date) - new Date(a.record_date))
            .slice(0, 50)
            .map(record => {
                const cow = cowIndex.get(record.cow_id);
                return `<tr>
                    <td><strong>${cow?.name || 'Unknown'}</strong></td>
                    <td>${this.formatLactationLabel(this.getRecordLactationNumber(record, cow))}</td>
                    <td>${record.record_date}</td>
                    <td>${record.morning_milk.toFixed(1)}</td>
                    <td>${record.evening_milk.toFixed(1)}</td>
                    <td><strong>${record.total_milk.toFixed(1)}</strong></td>
                </tr>`;
            }).join('');
    }

    /**
     * Record health issue
     */
    async recordHealth() {
        if (!AppState.apiAvailable) {
            NotificationManager.error('Backend unavailable. Health records are backend-only for cross-device sync.');
            return;
        }
        const cowId = document.getElementById('healthCowId').value;
        const date = document.getElementById('healthDate').value;
        const symptom = document.getElementById('symptom').value;
        const treatment = document.getElementById('treatment').value;
        const medicine = document.getElementById('medicine').value;

        // Validation
        if (!cowId || !date || !symptom || !treatment) {
            NotificationManager.error('Please fill all required fields');
            return;
        }

        const cow = AppState.cows.find(c => c.id === cowId);
        if (!cow) {
            NotificationManager.error('Cow not found');
            return;
        }

        let record = DataNormalizer.healthRecord({
            cow_id: cowId,
            record_date: date,
            symptom: symptom,
            treatment: treatment,
            medicine: medicine,
            lactation_number: this.getCowCurrentLactationNumber(cow)
        });

        try {
            const result = await APIManager.health.recordIssue({
                cow_id: cowId,
                issue_date: date,
                symptom: symptom,
                treatment: treatment,
                medicine_name: medicine,
                lactation_number: this.getCowCurrentLactationNumber(cow)
            });
            if (!result.success) {
                NotificationManager.error(result.error || 'Failed to record health issue');
                return;
            }
            if (result.data) {
                record = DataNormalizer.healthRecord(result.data);
            }
        } catch (err) {
            NotificationManager.error(`Failed to record health issue: ${err.message}`);
            return;
        }

        // Add to state
        AppState.healthRecords.push(record);

        // Persist to localStorage
        StateManager.save();
        await APIManager.reproduction.checkAlerts();
        await this.syncAlertsFromApi(false);

        // Clear form
        document.getElementById('healthCowId').value = '';
        document.getElementById('healthDate').value = '';
        document.getElementById('symptom').value = '';
        document.getElementById('treatment').value = '';
        document.getElementById('medicine').value = '';

        // Show success
        NotificationManager.success(`✓ Successfully recorded health issue for ${cow.name}`);

        // Refresh display
        this.renderHealthTable();
        this.updateDashboard();
    }

    /**
     * Render health records table
     */
    renderHealthTable() {
        const tbody = document.getElementById('healthTableBody');
        if (!tbody) return;

        if (AppState.healthRecords.length === 0) {
            tbody.innerHTML = '<tr><td colspan="6" style="text-align: center; color: #95a5a6;">No records yet</td></tr>';
            return;
        }

        tbody.innerHTML = AppState.healthRecords
            .sort((a, b) => new Date(b.record_date) - new Date(a.record_date))
            .slice(0, 50)
            .map(record => {
                const cow = cowIndex.get(record.cow_id);
                return `<tr>
                    <td><strong>${cow?.name || 'Unknown'}</strong></td>
                    <td>${this.formatLactationLabel(this.getRecordLactationNumber(record, cow))}</td>
                    <td>${record.record_date}</td>
                    <td>${record.symptom}</td>
                    <td>${record.treatment}</td>
                    <td>${record.medicine || '-'}</td>
                </tr>`;
            }).join('');
    }

    /**
     * Record reproduction event
     */
    async recordReproductionEvent() {
        if (!AppState.apiAvailable) {
            NotificationManager.error('Backend unavailable. Reproduction records are backend-only for cross-device sync.');
            return;
        }
        const cowId = document.getElementById('repoCowId').value;
        const date = document.getElementById('reproDate').value;
        const eventType = document.getElementById('reproEventType').value;

        // Validation
        if (!cowId || !date || !eventType) {
            NotificationManager.error('Please select cow, date, and event type');
            return;
        }

        const cow = AppState.cows.find(c => c.id === cowId);
        if (!cow) {
            NotificationManager.error('Cow not found');
            return;
        }

        let apiCall = null;
        let eventDetails = {};
        let savedEvent = null;
        
        // Handle specific event type data
        if (eventType === 'heat') {
            const heatSigns = document.getElementById('heatSigns').value;
            if (!heatSigns) {
                NotificationManager.error('Please enter heat signs');
                return;
            }
            eventDetails = { heat_signs: heatSigns };
            apiCall = APIManager.reproduction.recordHeatDetection({
                cow_id: cowId,
                event_date: date,
                heat_signs: heatSigns,
                lactation_number: this.getCowCurrentLactationNumber(cow)
            });
        } 
        else if (eventType === 'ai') {
            const semenType = document.getElementById('aiSemenType').value;
            const sireName = document.getElementById('aiSireName').value;
            if (!semenType || !sireName) {
                NotificationManager.error('Please provide semen type and sire name');
                return;
            }
            eventDetails = { semen_type: semenType, sire_name: sireName };
            apiCall = APIManager.reproduction.recordAI({
                cow_id: cowId,
                event_date: date,
                semen_type: semenType,
                sire_name: sireName,
                lactation_number: this.getCowCurrentLactationNumber(cow)
            });
        }
        else if (eventType === 'pregnancy') {
            const pregnancyStatus = document.getElementById('pregnancyStatus').value;
            eventDetails = { pregnancy_status: pregnancyStatus };
            apiCall = APIManager.reproduction.recordPregnancy({
                cow_id: cowId,
                event_date: date,
                pregnancy_status: pregnancyStatus,
                lactation_number: this.getCowCurrentLactationNumber(cow)
            });
        }
        else if (eventType === 'calving') {
            const calfGender = document.getElementById('calfGender').value;
            const calfBreed = document.getElementById('calfBreed').value;
            const calfName = document.getElementById('calfName').value.trim();
            if (!calfBreed) {
                NotificationManager.error('Please select calf breed');
                return;
            }
            eventDetails = { calf_gender: calfGender, calf_breed: calfBreed, calf_name: calfName || null };
            apiCall = APIManager.reproduction.recordCalving({
                cow_id: cowId,
                event_date: date,
                calf_gender: calfGender,
                lactation_number: this.getCowCurrentLactationNumber(cow) + 1
            });
        }

        // Save to API if available
        if (apiCall) {
            try {
                const result = await apiCall;
                if (!result.success) {
                    NotificationManager.error(result.message || result.error || 'Failed to record reproduction event');
                    return;
                }
                if (result.data) {
                    savedEvent = DataNormalizer.reproductionEvent(result.data);
                }
            } catch (err) {
                NotificationManager.error(`Failed to record reproduction event: ${err.message}`);
                return;
            }
        }

        // Create event for local state
        const event = savedEvent || DataNormalizer.reproductionEvent({
            cow_id: cowId,
            record_date: date,
            type: eventType,
            details: eventDetails,
            lactation_number: eventType === 'calving'
                ? this.getCowCurrentLactationNumber(cow) + 1
                : this.getCowCurrentLactationNumber(cow)
        });

        // Add to state
        AppState.reproductionEvents.push(event);

        // Initialize/refresh AI workflow tracking
        if (eventType === 'ai') {
            if (!AppState.reproductionWorkflows) AppState.reproductionWorkflows = {};
            AppState.reproductionWorkflows[cowId] = {
                ai_event_id: event.id,
                ai_date: date,
                pregnancy_confirmed: null,
                pregnancy_confirmed_at: null,
                stop_milking_confirmed: null,
                stop_milking_confirmed_at: null,
                dry_period_confirmed: null,
                dry_period_confirmed_at: null
            };
        }

        // Persist to localStorage
        StateManager.save();
        await this.syncAlertsFromApi(false);

        // If calving recorded, create calf entry in herd list
        if (eventType === 'calving') {
            const calfPhotoInput = document.getElementById('calfPhoto');
            const calfPhotoFile = calfPhotoInput && calfPhotoInput.files ? calfPhotoInput.files[0] : null;
            await this.createCalfFromCalving(cow, date, eventDetails, calfPhotoFile);
        }

        if (eventType === 'pregnancy') {
            if (eventDetails.pregnancy_status === 'confirmed') {
                cow.status = 'pregnant';
            } else if (eventDetails.pregnancy_status === 'not-confirmed' && cow.status === 'pregnant') {
                cow.status = 'milking';
            }
        } else if (eventType === 'calving') {
            cow.status = 'milking';
            cow.current_lactation_number = parseInt(event.lactation_number || 0, 10) || 1;
            cow.current_lactation_start_date = date;
        }

        // Clear forms
        document.getElementById('repoCowId').value = '';
        document.getElementById('reproDate').value = '';
        document.getElementById('reproEventType').value = '';
        document.getElementById('heatSigns').value = '';
        document.getElementById('aiSireName').value = '';
        const calfNameInput = document.getElementById('calfName');
        if (calfNameInput) calfNameInput.value = '';
        const calfBreedInput = document.getElementById('calfBreed');
        if (calfBreedInput) calfBreedInput.value = '';
        const calfPhotoInput = document.getElementById('calfPhoto');
        if (calfPhotoInput) calfPhotoInput.value = '';
        document.getElementById('reproDynamicFields').style.display = 'none';

        // Show success
        NotificationManager.success(`✓ Successfully recorded reproduction event for ${cow.name}`);

        // Refresh display
        this.renderReproductionTable();
        this.updateDashboard();
    }

    /**
     * Record feed usage
     */
    async recordFeed() {
        if (!AppState.apiAvailable) {
            NotificationManager.error('Backend unavailable. Feed records are backend-only for cross-device sync.');
            return;
        }
        const date = document.getElementById('feedDate').value;
        const feedType = document.getElementById('feedType').value;
        const quantity = parseFloat(document.getElementById('feedQuantity').value) || 0;
        const costPerUnit = parseFloat(document.getElementById('feedCost').value) || 0;

        if (!date || !feedType || quantity <= 0) {
            NotificationManager.error('Please enter feed date, type, and quantity');
            return;
        }

        const payload = {
            feed_date: date,
            feed_type: feedType,
            quantity: quantity,
            cost_per_unit: costPerUnit
        };

        try {
            const result = await APIManager.feed.recordFeed(payload);
            if (result.success && result.data) {
                const saved = DataNormalizer.feedRecord(result.data);
                const idx = AppState.feedRecords.findIndex(r => r.id === saved.id);
                if (idx >= 0) AppState.feedRecords[idx] = saved;
                else AppState.feedRecords.push(saved);
                StateManager.save();
                this.renderFeedTable();
                NotificationManager.success('Feed record saved');
                document.getElementById('feedQuantity').value = '';
                document.getElementById('feedCost').value = '';
                return;
            }
            NotificationManager.error(result.message || result.error || 'Failed to record feed');
            return;
        } catch (err) {
            NotificationManager.error(`Failed to record feed: ${err.message}`);
            return;
        }
    }

    renderFeedTable() {
        const tbody = document.getElementById('feedTableBody');
        if (!tbody) return;

        if (!AppState.feedRecords || AppState.feedRecords.length === 0) {
            tbody.innerHTML = '<tr><td colspan="4" style="text-align: center; color: #95a5a6;">No feed records yet</td></tr>';
            return;
        }

        tbody.innerHTML = AppState.feedRecords
            .slice()
            .sort((a, b) => new Date(b.feed_date) - new Date(a.feed_date))
            .slice(0, 100)
            .map(r => `
                <tr>
                    <td>${r.feed_date || '-'}</td>
                    <td>${r.feed_type || '-'}</td>
                    <td>${(r.quantity || 0).toFixed(1)}</td>
                    <td>${(r.total_cost || 0).toFixed(2)}</td>
                </tr>
            `).join('');
    }

    renderReportsVisualization(sourceState = AppState, sourceLabel = null) {
        const cardsEl = document.getElementById('reportsSummaryCards');
        const chartEl = document.getElementById('reportsLactationChart');
        const tableBody = document.getElementById('reportsLactationTableBody');
        const statusEl = document.getElementById('importStatus');
        if (!cardsEl || !chartEl || !tableBody) return;

        const dataset = this.buildLactationDataset(sourceState);
        const label = sourceLabel || AppState.importedDataMeta?.label || 'Live backend data';

        cardsEl.innerHTML = `
            <div class="summary-card info"><div class="label">Cows</div><div class="value">${dataset.totals.cows}</div><div class="trend">${label}</div></div>
            <div class="summary-card success"><div class="label">Lactations</div><div class="value">${dataset.totals.lactations}</div><div class="trend">Tracked groups</div></div>
            <div class="summary-card warning"><div class="label">Milk Records</div><div class="value">${dataset.totals.milkRecords}</div><div class="trend">${dataset.totals.totalMilk.toFixed(1)} L total</div></div>
            <div class="summary-card alert"><div class="label">Health & Repro</div><div class="value">${dataset.totals.healthRecords + dataset.totals.reproductionEvents}</div><div class="trend">${dataset.totals.healthRecords} health / ${dataset.totals.reproductionEvents} repro</div></div>
        `;

        if (statusEl) {
            statusEl.textContent = `${label} is visualized below${AppState.importedDataMeta?.fileName ? ` from ${AppState.importedDataMeta.fileName}` : ''}.`;
        }

        if (dataset.rows.length === 0) {
            chartEl.innerHTML = '<p class="empty-state">No lactation summary available yet</p>';
            tableBody.innerHTML = '<tr><td colspan="9" style="text-align: center; color: #95a5a6;">No lactation data yet</td></tr>';
            return;
        }

        const maxMilk = Math.max(...dataset.rows.map(row => row.total_milk), 1);
        chartEl.innerHTML = dataset.rows
            .slice()
            .sort((a, b) => b.total_milk - a.total_milk)
            .slice(0, 8)
            .map(row => `
                <div style="margin-bottom: 10px;">
                    <div style="display: flex; justify-content: space-between; gap: 12px; margin-bottom: 4px; font-size: 14px;">
                        <strong>${row.cow_name || row.cow_uid}</strong>
                        <span>${row.lactation_label} • ${row.total_milk.toFixed(1)} L</span>
                    </div>
                    <div style="height: 10px; background: #e8eef5; border-radius: 999px; overflow: hidden;">
                        <div style="height: 100%; width: ${(row.total_milk / maxMilk) * 100}%; background: linear-gradient(90deg, #2d6a4f, #74c69d);"></div>
                    </div>
                </div>
            `).join('');

        tableBody.innerHTML = dataset.rows
            .slice()
            .sort((a, b) => {
                const nameCompare = String(a.cow_name || a.cow_uid).localeCompare(String(b.cow_name || b.cow_uid));
                return nameCompare !== 0 ? nameCompare : (a.lactation_number || 0) - (b.lactation_number || 0);
            })
            .map(row => `
                <tr>
                    <td><strong>${row.cow_name || '-'}</strong></td>
                    <td>${row.cow_uid || '-'}</td>
                    <td>${row.lactation_label}</td>
                    <td>${row.start_date || '-'}</td>
                    <td>${row.milk_records}</td>
                    <td>${row.total_milk.toFixed(1)}</td>
                    <td>${row.avg_daily_milk.toFixed(1)}</td>
                    <td>${row.health_records}</td>
                    <td>${row.reproduction_events}</td>
                </tr>
            `).join('');
    }

    createExportPayload() {
        const dataset = this.buildLactationDataset();
        return {
            exported_at: new Date().toISOString(),
            version: '2.0.0',
            source: 'dairy-farm-lifecycle-management',
            data: {
                cows: AppState.cows,
                milkRecords: AppState.milkRecords,
                healthRecords: AppState.healthRecords,
                reproductionEvents: AppState.reproductionEvents,
                feedRecords: AppState.feedRecords,
                alerts: AppState.alerts,
                lactationSummary: dataset.rows
            }
        };
    }

    downloadTextFile(filename, content, mimeType) {
        const blob = new Blob([content], { type: mimeType });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = filename;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
    }

    exportJSON() {
        const payload = this.createExportPayload();
        this.downloadTextFile(
            `dairy-farm-export-${this.getDateKey(new Date())}.json`,
            JSON.stringify(payload, null, 2),
            'application/json'
        );
        AppState.importedDataMeta = { label: 'Live backend data', fileName: null };
        this.renderReportsVisualization();
        NotificationManager.success('JSON export downloaded');
    }

    exportCSV() {
        const dataset = this.buildLactationDataset();
        const headers = ['cow_name', 'cow_uid', 'breed', 'lactation_number', 'lactation_label', 'start_date', 'milk_records', 'total_milk_liters', 'avg_daily_milk_liters', 'health_records', 'reproduction_events'];
        const lines = [
            headers.join(','),
            ...dataset.rows.map(row => ([
                row.cow_name || '',
                row.cow_uid || '',
                row.breed || '',
                row.lactation_number || 0,
                row.lactation_label || '',
                row.start_date || '',
                row.milk_records || 0,
                row.total_milk.toFixed(1),
                row.avg_daily_milk.toFixed(1),
                row.health_records || 0,
                row.reproduction_events || 0
            ].map(value => `"${String(value).replace(/"/g, '""')}"`).join(',')))
        ];
        this.downloadTextFile(
            `dairy-farm-lactation-summary-${this.getDateKey(new Date())}.csv`,
            lines.join('\n'),
            'text/csv'
        );
        NotificationManager.success('CSV export downloaded');
    }

    async handleImportFile(event) {
        const file = event?.target?.files?.[0];
        if (!file) return;

        try {
            const content = await file.text();
            if (file.name.toLowerCase().endsWith('.json')) {
                this.importJsonData(content, file.name);
            } else if (file.name.toLowerCase().endsWith('.csv')) {
                this.importCsvData(content, file.name);
            } else {
                NotificationManager.error('Unsupported file type. Use JSON or CSV.');
            }
        } catch (err) {
            NotificationManager.error(`Failed to read file: ${err.message}`);
        } finally {
            event.target.value = '';
        }
    }

    importJsonData(rawJson, fileName = 'import.json') {
        const parsed = JSON.parse(rawJson);
        const payload = parsed.data || parsed;
        if (!payload.cows) {
            throw new Error('JSON file does not contain cows data');
        }

        AppState.cows = (payload.cows || []).map(item => DataNormalizer.cow(item));
        AppState.milkRecords = (payload.milkRecords || payload.milk_records || []).map(item => DataNormalizer.milkRecord(item));
        AppState.healthRecords = (payload.healthRecords || payload.health_records || []).map(item => DataNormalizer.healthRecord(item));
        AppState.reproductionEvents = (payload.reproductionEvents || payload.reproduction_events || []).map(item => DataNormalizer.reproductionEvent(item));
        AppState.feedRecords = (payload.feedRecords || payload.feed_records || []).map(item => DataNormalizer.feedRecord(item));
        AppState.alerts = payload.alerts || [];
        AppState.importedDataMeta = {
            label: 'Imported JSON data',
            fileName
        };
        cowIndex.rebuild(AppState.cows);
        this.refreshUI();
        NotificationManager.success(`Imported JSON data from ${fileName}`);
    }

    parseCsvLine(line) {
        const values = [];
        let current = '';
        let inQuotes = false;

        for (let i = 0; i < line.length; i += 1) {
            const char = line[i];
            const next = line[i + 1];

            if (char === '"' && inQuotes && next === '"') {
                current += '"';
                i += 1;
            } else if (char === '"') {
                inQuotes = !inQuotes;
            } else if (char === ',' && !inQuotes) {
                values.push(current);
                current = '';
            } else {
                current += char;
            }
        }

        values.push(current);
        return values;
    }

    importCsvData(rawCsv, fileName = 'import.csv') {
        const lines = rawCsv.split(/\r?\n/).filter(Boolean);
        if (lines.length < 2) {
            throw new Error('CSV file is empty');
        }

        const headers = this.parseCsvLine(lines[0]).map(value => value.trim());
        const rows = lines.slice(1).map(line => {
            const values = this.parseCsvLine(line);
            return headers.reduce((acc, header, idx) => {
                acc[header] = values[idx] || '';
                return acc;
            }, {});
        });

        const cows = [];
        const cowIdByUid = new Map();
        const milkRecords = [];
        rows.forEach((row, index) => {
            const cowUid = row.cow_uid || `CSV-${index + 1}`;
            let cowId = cowIdByUid.get(cowUid);
            if (!cowId) {
                cowId = `csv-cow-${cowIdByUid.size}-${cowUid}`;
                cowIdByUid.set(cowUid, cowId);
                cows.push(DataNormalizer.cow({
                    id: cowId,
                    cow_uid: cowUid,
                    name: row.cow_name || `Imported Cow ${index + 1}`,
                    breed: row.breed || 'mixed',
                    ear_tag: cowUid || `CSV-EAR-${index + 1}`,
                    birth_date: '2020-01-01',
                    status: 'milking',
                    current_lactation_number: parseInt(row.lactation_number || 0, 10) || 0,
                    current_lactation_start_date: row.start_date || null
                }));
            } else {
                const existingCow = cows.find(item => item.id === cowId);
                const lactationNumber = parseInt(row.lactation_number || 0, 10) || 0;
                if (existingCow && lactationNumber > (existingCow.current_lactation_number || 0)) {
                    existingCow.current_lactation_number = lactationNumber;
                    existingCow.current_lactation_start_date = row.start_date || existingCow.current_lactation_start_date;
                }
            }

            const milkCount = parseInt(row.milk_records || 0, 10) || 0;
            const totalMilk = parseFloat(row.total_milk_liters || row.total_milk || 0) || 0;
            for (let i = 0; i < milkCount; i += 1) {
                milkRecords.push(DataNormalizer.milkRecord({
                    id: `csv-milk-${index}-${i}`,
                    cow_id: cowId,
                    record_date: row.start_date || this.getDateKey(new Date()),
                    morning_milk: totalMilk / Math.max(milkCount, 1) / 2,
                    evening_milk: totalMilk / Math.max(milkCount, 1) / 2,
                    total_milk: totalMilk / Math.max(milkCount, 1),
                    lactation_number: parseInt(row.lactation_number || 0, 10) || 0
                }));
            }
        });

        AppState.cows = cows;
        AppState.milkRecords = milkRecords;
        AppState.healthRecords = [];
        AppState.reproductionEvents = [];
        AppState.feedRecords = [];
        AppState.alerts = [];
        AppState.importedDataMeta = {
            label: 'Imported CSV summary',
            fileName
        };
        cowIndex.rebuild(AppState.cows);
        this.refreshUI();
        NotificationManager.success(`Imported CSV summary from ${fileName}`);
    }

    clearAllData() {
        if (!confirm('Clear the in-browser data currently shown in the app?')) return;
        StateManager.clearAll();
        AppState.importedDataMeta = {
            label: 'Cleared local view',
            fileName: null
        };
        this.refreshUI();
        NotificationManager.success('Visible data cleared in this browser');
    }

    getCowAgeMonths(birthDate) {
        if (!birthDate) return 0;
        const birth = new Date(birthDate);
        const today = new Date();
        let months = (today.getFullYear() - birth.getFullYear()) * 12 + (today.getMonth() - birth.getMonth());
        if (today.getDate() < birth.getDate()) months -= 1;
        return Math.max(months, 0);
    }

    getCowDisplayStatus(cow) {
        if (!cow) return 'unknown';
        // Calves born from calving events are shown as calf until 18 months.
        if (cow.status === 'heifer' && cow.mother_id && this.getCowAgeMonths(cow.birth_date) < 18) {
            return 'calf';
        }
        return cow.status || 'unknown';
    }

    getAlertCowIds() {
        const alertCowIds = new Set(
            (AppState.alerts || [])
                .filter(a => !a.resolved_at)
                .map(a => String(a.cow_id))
        );

        const recentHealthCowIds = (AppState.healthRecords || [])
            .filter(r => {
                const d = new Date(r.record_date);
                if (Number.isNaN(d.getTime())) return false;
                const since = new Date();
                since.setDate(since.getDate() - 7);
                return d >= since;
            })
            .map(r => String(r.cow_id));

        recentHealthCowIds.forEach(cowId => alertCowIds.add(cowId));
        return alertCowIds;
    }

    getPregnancyDays(cowOrId) {
        const cowId = typeof cowOrId === 'string' ? cowOrId : cowOrId?.id;
        if (!cowId) return null;

        const relevantEvents = (AppState.reproductionEvents || [])
            .filter(event => String(event.cow_id) === String(cowId))
            .sort((a, b) => new Date(b.record_date) - new Date(a.record_date));

        const confirmedPregnancy = relevantEvents.find(event =>
            event.type === 'pregnancy-check' && event.details?.pregnancy_status === 'confirmed'
        );
        if (confirmedPregnancy) {
            const explicitDays = Number(confirmedPregnancy.details?.days_pregnant);
            if (Number.isFinite(explicitDays) && explicitDays >= 0) {
                const checkDate = new Date(confirmedPregnancy.record_date);
                const today = new Date();
                if (!Number.isNaN(checkDate.getTime())) {
                    const elapsedDays = Math.floor((today - checkDate) / (1000 * 60 * 60 * 24));
                    return Math.max(explicitDays + Math.max(elapsedDays, 0), explicitDays);
                }
                return explicitDays;
            }
        }

        const latestAI = relevantEvents.find(event => event.type === 'ai');
        if (!latestAI?.record_date) return null;

        const aiDate = new Date(latestAI.record_date);
        const today = new Date();
        if (Number.isNaN(aiDate.getTime())) return null;
        const diffDays = Math.floor((today - aiDate) / (1000 * 60 * 60 * 24));
        return diffDays >= 0 ? diffDays : null;
    }

    getCowStatusLabel(cow) {
        const status = this.getCowDisplayStatus(cow);
        const statusLabel = String(status || 'unknown').replace('_', ' ');
        if (status !== 'pregnant') return statusLabel;

        const pregnancyDays = this.getPregnancyDays(cow);
        if (!Number.isFinite(pregnancyDays)) return statusLabel;
        return `${statusLabel} • ${pregnancyDays} days`;
    }

    async createCalfFromCalving(motherCow, calvingDate, eventDetails = {}, calfPhotoFile = null) {
        if (!AppState.apiAvailable) {
            NotificationManager.error('Backend unavailable. Calf creation requires API connection.');
            return;
        }
        const calfGender = eventDetails.calf_gender || 'female';
        const calfName = eventDetails.calf_name || `Calf of ${motherCow.name || motherCow.cow_uid}`;
        const calfBirthDate = calvingDate;
        const calfBreed = eventDetails.calf_breed || motherCow.breed || 'mixed';

        let newCalf = null;
        const fallbackUid = `CALF-${new Date(calvingDate).toISOString().slice(2, 10).replace(/-/g, '')}-${Math.floor(Math.random() * 900 + 100)}`;
        const fallbackEarTag = `EAR-CALF-${Date.now()}`;
        try {
            let calfUid = fallbackUid;
            const uidResult = await APIManager.herd.generateUID(calfBreed, calfBirthDate);
            if (uidResult.success && uidResult.data?.cow_uid) {
                calfUid = uidResult.data.cow_uid;
            }

            const calfPayload = {
                cow_uid: calfUid,
                name: calfName,
                breed: calfBreed,
                birth_date: calfBirthDate,
                status: 'heifer',
                ear_tag: fallbackEarTag,
                purchase_date: calfBirthDate,
                mother_id: motherCow.id,
                current_lactation_number: 0,
                current_lactation_start_date: null
            };

            const addResult = await APIManager.herd.addCow(calfPayload);
            if (!addResult.success || !addResult.data) {
                NotificationManager.error(addResult.message || addResult.error || 'Failed to create calf record in backend');
                return;
            }

            newCalf = DataNormalizer.cow(addResult.data);

            if (calfPhotoFile) {
                try {
                    const uploadResult = await APIManager.herd.uploadPhoto(newCalf.id, calfPhotoFile);
                    if (uploadResult.success && uploadResult.data?.photo_url) {
                        newCalf.photo_url = `${uploadResult.data.photo_url}?t=${Date.now()}`;
                    }
                } catch (photoErr) {
                    console.warn('Calf photo upload failed:', photoErr);
                }
            }
        } catch (err) {
            NotificationManager.error(`Failed to create calf: ${err.message}`);
            return;
        }

        AppState.cows.push(newCalf);
        cowIndex.add(newCalf);
        StateManager.save();
        this.renderHerd();
        this.updateAllSelects();
        this.updateDashboard();

        NotificationManager.success(`Calf added to herd list: ${newCalf.name}`);
    }

    /**
     * Render reproduction records table
     */
    renderReproductionTable() {
        const tbody = document.getElementById('reproTableBody');
        if (!tbody) return;

        if (AppState.reproductionEvents.length === 0) {
            tbody.innerHTML = '<tr><td colspan="5" style="text-align: center; color: #95a5a6;">No events recorded</td></tr>';
            return;
        }

        tbody.innerHTML = AppState.reproductionEvents
            .sort((a, b) => new Date(b.record_date) - new Date(a.record_date))
            .slice(0, 50)
            .map(event => {
                const cow = cowIndex.get(event.cow_id);
                return `<tr>
                    <td><strong>${cow?.name || 'Unknown'}</strong></td>
                    <td>${this.formatLactationLabel(this.getRecordLactationNumber(event, cow))}</td>
                    <td>${event.type}</td>
                    <td>${event.record_date}</td>
                    <td>${event.details?.notes || '-'}</td>
                </tr>`;
            }).join('');
    }

    /**
     * Generate cow UID
     */
    async generateCowUID() {
        if (!AppState.apiAvailable) {
            NotificationManager.error('Backend unavailable. UID generation requires API connection.');
            return;
        }
        const breed = document.getElementById('breed').value;
        const birthDate = document.getElementById('birthDate').value;

        if (!breed || !birthDate) {
            NotificationManager.error('Please select breed and birth date first');
            return;
        }

        try {
            const result = await APIManager.herd.generateUID(breed, birthDate);
            if (result.success) {
                // API returns cow_uid
                const uid = result.data?.cow_uid || result.data?.uid;
                if (uid) {
                    document.getElementById('cowUID').value = uid;
                    NotificationManager.success('UID generated');
                } else {
                    NotificationManager.error('UID not returned from API');
                }
            } else {
                NotificationManager.error(result.message || result.error || 'Failed to generate UID from backend.');
            }
        } catch (err) {
            console.error('Error generating UID:', err);
            NotificationManager.error('Failed to generate UID');
        }
    }

    /**
     * Populates the mother dropdown with existing cows.
     */
    populateMotherDropdown() {
        const motherSelect = document.getElementById('motherId');
        if (!motherSelect) return;

        motherSelect.innerHTML = '<option value="">Select Mother (Optional)</option>'; // Default option

        AppState.cows.forEach(cow => {
            const option = document.createElement('option');
            option.value = cow.id;
            option.textContent = `${cow.name} (${cow.cow_uid})`;
            motherSelect.appendChild(option);
        });
    }

    /**
     * Add cow to herd
     */
    async addCow() {
        if (!AppState.apiAvailable) {
            NotificationManager.error('Backend unavailable. Add Cow is disabled to keep data consistent across devices.');
            return;
        }
        const name = document.getElementById('cowName').value;
        const uid = document.getElementById('cowUID').value;
        const breed = document.getElementById('breed').value;
        const customBreed = document.getElementById('customBreedName').value;
        const birthDate = document.getElementById('birthDate').value;
        const status = document.getElementById('cowStatus').value;
        const purchaseDate = document.getElementById('purchaseDate').value;
        const earTag = document.getElementById('earTag').value;
        const motherId = document.getElementById('motherId')?.value;
        const photoInput = document.getElementById('cowPhoto');
        const photoFile = photoInput && photoInput.files && photoInput.files.length > 0 ? photoInput.files[0] : null;

        // Validation
        if (!uid || !breed || !birthDate || !status) {
            NotificationManager.error('Please fill all required fields');
            return;
        }

        const finalBreed = breed === 'custom' ? customBreed : breed;
        if (!finalBreed) {
            NotificationManager.error('Please specify custom breed name');
            return;
        }

        const cowData = {
            cow_uid: uid,
            name: name,
            breed: finalBreed,
            birth_date: birthDate,
            status: status,
            ear_tag: earTag || `EAR-${Date.now()}`, // Use provided earTag or generate
            purchase_date: purchaseDate || new Date().toISOString().split('T')[0],
            mother_id: motherId || null,
            current_lactation_number: ['milking', 'pregnant', 'dry'].includes(status) ? 1 : 0,
            current_lactation_start_date: ['milking', 'pregnant', 'dry'].includes(status)
                ? (purchaseDate || new Date().toISOString().split('T')[0])
                : null
        };

        try {
            console.log('Adding cow to API:', cowData);
            const result = await APIManager.herd.addCow(cowData);

            if (result.success) {
                const cow = DataNormalizer.cow(result.data);
                AppState.cows.push(cow);
                cowIndex.add(cow);
                StateManager.save();

                // Handle photo upload if a file was selected
                if (photoFile) {
                    try {
                        NotificationManager.info('Uploading cow photo...');
                        const uploadResult = await APIManager.herd.uploadPhoto(cow.id, photoFile);
                        if (uploadResult.success && uploadResult.data && uploadResult.data.photo_url) {
                            cow.photo_url = `${uploadResult.data.photo_url}?t=${Date.now()}`;
                            StateManager.save();
                            NotificationManager.success(`Photo uploaded for ${name}`);
                        } else {
                            NotificationManager.warning(`Cow added, but photo upload failed: ${uploadResult.message}`);
                        }
                    } catch (err) {
                        console.error('Photo upload error:', err);
                        NotificationManager.warning('Cow added, but photo upload failed.');
                    }
                }

                // Clear form
                document.getElementById('cowName').value = '';
                document.getElementById('cowUID').value = '';
                document.getElementById('breed').value = '';
                document.getElementById('customBreedName').value = '';
                document.getElementById('birthDate').value = '';
                document.getElementById('cowStatus').value = '';
                document.getElementById('purchaseDate').value = '';
                document.getElementById('earTag').value = '';
                if (document.getElementById('motherId')) document.getElementById('motherId').value = '';
                if (document.getElementById('cowPhoto')) document.getElementById('cowPhoto').value = '';

                NotificationManager.success(`✓ ${name} added to herd successfully!`);
                this.renderHerd();
                this.updateAllSelects();
                this.populateMotherDropdown();
                return;
            }
            console.warn('API error:', result);
            NotificationManager.error(`Failed to add cow: ${result.message || result.error || 'Unknown error'}`);
            return;
        } catch (err) {
            console.error('API call error:', err);
            NotificationManager.error(`Failed to add cow: ${err.message}`);
            return;
        }
    }

    /**
     * Upload photo for cow
     */
    async uploadPhoto() {
        if (!AppState.apiAvailable) {
            NotificationManager.error('Backend unavailable. Photo upload is disabled to keep data consistent.');
            return;
        }
        const cowId = document.getElementById('photoCowId').value;
        const fileInput = document.getElementById('photoInput');
        const file = fileInput.files[0];

        if (!cowId || !file) {
            NotificationManager.error('Please select a photo');
            return;
        }

        const cow = AppState.cows.find(c => c.id === cowId);
        if (!cow) {
            NotificationManager.error('Cow not found');
            return;
        }

        try {
            const result = await APIManager.herd.uploadPhoto(cowId, file);
            if (!result.success || !result.data || !result.data.photo_url) {
                NotificationManager.error(result.message || result.error || 'Failed to upload photo');
                return;
            }
            cow.photo_url = `${result.data.photo_url}?t=${Date.now()}`;
            StateManager.save();
            this.renderHerd();
            NotificationManager.success('Photo uploaded successfully');

            // Clear input and close modal
            fileInput.value = '';
            const modal = document.getElementById('photoModal');
            if (modal) modal.style.display = 'none';
        } catch (error) {
            console.error('Error uploading photo:', error);
            NotificationManager.error('Failed to process photo');
        }
    }
}

// Create global app instance (exposed on window for inline handlers)
window.app = null;

// Initialize on DOM ready
document.addEventListener('DOMContentLoaded', async () => {
    window.app = new DairyFarmApp();
    await window.app.init();
});

// Export for use in modules
if (typeof module !== 'undefined' && module.exports) {
    module.exports = DairyFarmApp;
}
