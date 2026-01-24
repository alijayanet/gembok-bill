// Version Check Module - Check for updates from GitHub
class VersionChecker {
    constructor() {
        this.currentVersion = null;
        this.latestVersion = null;
        this.hasUpdate = false;
        this.checkInterval = null;
        this.init();
    }

    async init() {
        // Load current version from API
        await this.loadCurrentVersion();
        
        // Auto-check for updates on page load (once per session)
        if (!sessionStorage.getItem('versionChecked')) {
            this.checkForUpdates();
            sessionStorage.setItem('versionChecked', 'true');
        }
    }

    async loadCurrentVersion() {
        try {
            const response = await fetch('/api/version/current-version');
            const data = await response.json();
            if (data.success) {
                this.currentVersion = data.version;
                this.displayCurrentVersion(data);
            }
        } catch (error) {
            console.error('Error loading current version:', error);
        }
    }

    displayCurrentVersion(data) {
        // Display version in sidebar version panel
        const versionElement = document.getElementById('appVersion');
        if (versionElement) {
            versionElement.innerHTML = `v${data.version} <span class="badge bg-secondary ms-1">Build ${data.buildNumber}</span>`;
        }
    }

    async checkForUpdates() {
        const checkButton = document.getElementById('checkUpdateBtn');
        const resultElement = document.getElementById('updateResult');

        // Show loading state
        if (checkButton) {
            checkButton.disabled = true;
            checkButton.innerHTML = '<span class="spinner-border spinner-border-sm me-2"></span>Checking...';
        }

        try {
            const response = await fetch('/api/version/check-update');
            const data = await response.json();

            if (data.success) {
                this.latestVersion = data.latestVersion;
                this.hasUpdate = data.hasUpdate;
                this.displayUpdateResult(data);
            } else {
                this.showError(data.message || 'Failed to check for updates');
            }
        } catch (error) {
            console.error('Error checking for updates:', error);
            this.showError('Failed to check for updates. Please try again.');
        } finally {
            // Reset button state
            if (checkButton) {
                checkButton.disabled = false;
                checkButton.innerHTML = '<i class="bi bi-cloud-arrow-down me-1"></i>Cek Update';
            }
        }
    }

    displayUpdateResult(data) {
        const resultElement = document.getElementById('updateResult');
        if (!resultElement) return;

        if (data.hasUpdate) {
            // Update available
            resultElement.innerHTML = `
                <div class="alert alert-info alert-dismissible fade show" role="alert" style="font-size: 11px; padding: 8px;">
                    <h6 class="alert-heading mb-1"><i class="bi bi-info-circle me-1"></i>Update Tersedia!</h6>
                    <hr class="my-1">
                    <p class="mb-1"><strong>Versi Saat Ini:</strong> v${data.currentVersion}</p>
                    <p class="mb-1"><strong>Versi Terbaru:</strong> v${data.latestVersion}</p>
                    <p class="mb-1"><strong>Tanggal:</strong> ${new Date(data.latestRelease.publishedAt).toLocaleDateString('id-ID')}</p>
                    <hr class="my-1">
                    <a href="${data.latestRelease.downloadUrl}" target="_blank" class="btn btn-primary btn-sm">
                        <i class="bi bi-download me-1"></i>Download
                    </a>
                    <button type="button" class="btn btn-secondary btn-sm ms-1" data-bs-dismiss="alert">
                        Tutup
                    </button>
                </div>
            `;
        } else {
            // No update available
            resultElement.innerHTML = `
                <div class="alert alert-success alert-dismissible fade show" role="alert" style="font-size: 11px; padding: 8px;">
                    <h6 class="alert-heading mb-1"><i class="bi bi-check-circle me-1"></i>Sudah Terbaru!</h6>
                    <p class="mb-0">Versi: <strong>v${data.currentVersion}</strong></p>
                    <button type="button" class="btn-close" data-bs-dismiss="alert"></button>
                </div>
            `;
        }
    }

    showError(message) {
        const resultElement = document.getElementById('updateResult');
        if (!resultElement) return;

        resultElement.innerHTML = `
            <div class="alert alert-danger alert-dismissible fade show" role="alert" style="font-size: 11px; padding: 8px;">
                <i class="bi bi-exclamation-triangle me-1"></i>${message}
                <button type="button" class="btn-close" data-bs-dismiss="alert"></button>
            </div>
        `;
    }
}

// Initialize version checker when DOM is ready
document.addEventListener('DOMContentLoaded', function() {
    // Initialize on all pages with sidebar
    window.versionChecker = new VersionChecker();

    // Attach click handler to check update button
    const checkButton = document.getElementById('checkUpdateBtn');
    if (checkButton) {
        checkButton.addEventListener('click', () => {
            window.versionChecker.checkForUpdates();
        });
    }
});
