/**
 * Admin Mobile Billing JavaScript
 * Handles mobile interactions and enhancements for admin billing interface
 */

/**
 * Mobile Mapping Functions
 */
class MobileMappingManager {
    constructor() {
        this.map = null;
        this.layers = {
            customers: null,
            onus: null,
            odps: null,
            cables: null
        };
        this.layersVisible = {
            customers: true,
            onus: true,
            odps: true,
            cables: true
        };
        this.isFullscreen = false;
    }

    init() {
        if (window.__adminMobileMapInited) return;
        window.__adminMobileMapInited = true;

        this.initializeMap();
        this.loadMapData();
        this.updateStats();
        this.bindEvents();
    }

    initializeMap() {
        const container = document.getElementById('networkMap');
        if (!container || !window.L || this.map) return;

        // Default center (Jakarta)
        this.map = L.map(container);
        this.map.setView([-6.2088, 106.8456], 13);
        
        // Add tile layer
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
            attribution: '© OpenStreetMap contributors'
        }).addTo(this.map);

        // Initialize layers
        this.layers.customers = L.layerGroup().addTo(this.map);
        this.layers.onus = L.layerGroup().addTo(this.map);
        this.layers.odps = L.layerGroup().addTo(this.map);
        this.layers.cables = L.layerGroup().addTo(this.map);
    }

    loadMapData() {
        this.loadCustomers();
        this.loadONUs();
        this.loadODPs();
        this.loadCables();
    }

    loadCustomers() {
        // Sample customer data - in real app, this would come from API
        const customers = [
            { id: 1, name: 'John Doe', lat: -6.2088, lng: 106.8456, status: 'active' },
            { id: 2, name: 'Jane Smith', lat: -6.2100, lng: 106.8500, status: 'active' },
            { id: 3, name: 'Bob Johnson', lat: -6.2050, lng: 106.8400, status: 'suspended' }
        ];

        customers.forEach(customer => {
            const marker = L.circleMarker([customer.lat, customer.lng], {
                radius: 8,
                fillColor: customer.status === 'active' ? '#28a745' : '#dc3545',
                color: 'white',
                weight: 2,
                opacity: 1,
                fillOpacity: 0.8,
                className: 'mobile-customer-marker'
            }).bindPopup(`
                <div class="text-center">
                    <h6>${customer.name}</h6>
                    <p class="mb-1">Status: <span class="badge bg-${customer.status === 'active' ? 'success' : 'danger'}">${customer.status}</span></p>
                    <small class="text-muted">ID: ${customer.id}</small>
                </div>
            `);
            
            this.layers.customers.addLayer(marker);
        });
    }

    loadONUs() {
        // Sample ONU data
        const onus = [
            { id: 1, name: 'ONU-001', lat: -6.2085, lng: 106.8450, status: 'online' },
            { id: 2, name: 'ONU-002', lat: -6.2095, lng: 106.8500, status: 'online' },
            { id: 3, name: 'ONU-003', lat: -6.2055, lng: 106.8405, status: 'offline' }
        ];

        onus.forEach(onu => {
            const marker = L.circleMarker([onu.lat, onu.lng], {
                radius: 6,
                fillColor: onu.status === 'online' ? '#007bff' : '#dc3545',
                color: 'white',
                weight: 2,
                opacity: 1,
                fillOpacity: 0.8,
                className: onu.status === 'online' ? 'mobile-onu-marker' : 'mobile-offline-marker'
            }).bindPopup(`
                <div class="text-center">
                    <h6>${onu.name}</h6>
                    <p class="mb-1">Status: <span class="badge bg-${onu.status === 'online' ? 'success' : 'danger'}">${onu.status}</span></p>
                    <small class="text-muted">ID: ${onu.id}</small>
                </div>
            `);
            
            this.layers.onus.addLayer(marker);
        });
    }

    loadODPs() {
        // Sample ODP data
        const odps = [
            { id: 1, name: 'ODP-001', lat: -6.2080, lng: 106.8440, capacity: 16, used: 12 },
            { id: 2, name: 'ODP-002', lat: -6.2100, lng: 106.8480, capacity: 8, used: 5 }
        ];

        odps.forEach(odp => {
            const marker = L.circleMarker([odp.lat, odp.lng], {
                radius: 10,
                fillColor: '#ffc107',
                color: 'white',
                weight: 2,
                opacity: 1,
                fillOpacity: 0.8,
                className: 'mobile-odp-marker'
            }).bindPopup(`
                <div class="text-center">
                    <h6>${odp.name}</h6>
                    <p class="mb-1">Kapasitas: ${odp.used}/${odp.capacity}</p>
                    <div class="progress mb-2" style="height: 5px;">
                        <div class="progress-bar" style="width: ${(odp.used/odp.capacity)*100}%"></div>
                    </div>
                    <small class="text-muted">ID: ${odp.id}</small>
                </div>
            `);
            
            this.layers.odps.addLayer(marker);
        });
    }

    loadCables() {
        // Sample cable routes
        const cables = [
            { from: [-6.2080, 106.8440], to: [-6.2085, 106.8450], status: 'connected' },
            { from: [-6.2080, 106.8440], to: [-6.2095, 106.8500], status: 'connected' },
            { from: [-6.2100, 106.8480], to: [-6.2055, 106.8405], status: 'disconnected' }
        ];

        cables.forEach(cable => {
            const polyline = L.polyline([cable.from, cable.to], {
                color: cable.status === 'connected' ? '#28a745' : '#dc3545',
                weight: 3,
                opacity: 0.8
            });
            
            this.layers.cables.addLayer(polyline);
        });
    }

    updateStats() {
        // Update statistics
        const stats = {
            totalCustomers: this.layers.customers.getLayers().length,
            totalONU: this.layers.onus.getLayers().length,
            onlineONU: this.layers.onus.getLayers().filter(layer => 
                layer.options.className === 'mobile-onu-marker'
            ).length,
            offlineONU: this.layers.onus.getLayers().filter(layer => 
                layer.options.className === 'mobile-offline-marker'
            ).length
        };

        document.getElementById('totalCustomers').textContent = stats.totalCustomers;
        document.getElementById('totalONU').textContent = stats.totalONU;
        document.getElementById('onlineONU').textContent = stats.onlineONU;
        document.getElementById('offlineONU').textContent = stats.offlineONU;
    }

    bindEvents() {
        // Bind layer toggle events
        document.querySelectorAll('[onclick*="toggleLayer"]').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const el = e.currentTarget;
                const onClickVal = el.getAttribute('onclick') || '';
                const match = onClickVal.match(/toggleLayer\('(\w+)'\)/);
                if (match && match[1]) this.toggleLayer(match[1]);
            });
        });

        // Bind action button events
        document.querySelectorAll('.mobile-map-action-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const el = e.currentTarget;
                const action = el.getAttribute('onclick');
                if (action) {
                    try { eval(action); } catch (err) { console.error(err); }
                }
            });
        });
    }

    toggleLayer(layerName) {
        if (!this.map) return;
        if (!this.layers[layerName]) {
            this.layers[layerName] = L.layerGroup().addTo(this.map);
        }

        this.layersVisible[layerName] = !this.layersVisible[layerName];
        const layer = this.layers[layerName];
        if (this.layersVisible[layerName]) {
            this.map.addLayer(layer);
        } else {
            if (layer && this.map.hasLayer(layer)) this.map.removeLayer(layer);
        }
    }

    toggleLayers() {
        if (!this.map) return;
        const allVisible = Object.values(this.layersVisible).every(v => v);
        Object.keys(this.layersVisible).forEach(key => {
            this.layersVisible[key] = !allVisible;
            const layer = this.layers[key];
            if (!layer) return;
            if (this.layersVisible[key]) {
                this.map.addLayer(layer);
            } else {
                if (this.map.hasLayer(layer)) this.map.removeLayer(layer);
            }
        });
    }

    centerMap() {
        this.map.setView([-6.2088, 106.8456], 13);
    }

    refreshMap() {
        // Clear existing layers
        Object.values(this.layers).forEach(layer => {
            layer.clearLayers();
        });
        
        // Reload data
        this.loadMapData();
        this.updateStats();
        
        // Show success message
        this.showToast('Peta berhasil di-refresh!', 'success');
    }

    toggleFullscreen() {
        if (!document.fullscreenElement) {
            document.documentElement.requestFullscreen();
            this.isFullscreen = true;
        } else {
            document.exitFullscreen();
            this.isFullscreen = false;
        }
    }

    exportData() {
        // Export map data
        const data = {
            customers: this.layers.customers.getLayers().length,
            onus: this.layers.onus.getLayers().length,
            odps: this.layers.odps.getLayers().length,
            cables: this.layers.cables.getLayers().length,
            exportDate: new Date().toISOString()
        };
        
        const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'map-data.json';
        a.click();
        URL.revokeObjectURL(url);
        
        this.showToast('Data berhasil di-export!', 'success');
    }

    showToast(message, type) {
        const toast = document.createElement('div');
        toast.className = `alert alert-${type} position-fixed`;
        toast.style.cssText = 'top: 20px; right: 20px; z-index: 1060; min-width: 300px;';
        toast.innerHTML = `
            <div class="d-flex align-items-center">
                <i class="bi bi-check-circle-fill me-2"></i>
                ${message}
                <button type="button" class="btn-close ms-auto" onclick="this.parentElement.parentElement.remove()"></button>
            </div>
        `;
        
        document.body.appendChild(toast);
        
        setTimeout(() => {
            if (toast.parentElement) {
                toast.remove();
            }
        }, 3000);
    }
}

// Global mapping manager instance
let mobileMappingManager;

// Initialize mobile mapping when page loads
document.addEventListener('DOMContentLoaded', function() {
    // Respect inline mapping flag: if page handles mapping itself, skip global init
    if (window.__USE_INLINE_MAPPING__) return;
    // Check if this is mapping page
    if (document.getElementById('networkMap')) {
        mobileMappingManager = new MobileMappingManager();
        mobileMappingManager.init();
    }
});

// Global functions for onclick handlers
function toggleLayer(layerName) {
    if (mobileMappingManager) {
        mobileMappingManager.toggleLayer(layerName);
    }
}

function toggleLayers() {
    if (mobileMappingManager) {
        mobileMappingManager.toggleLayers();
    }
}

function centerMap() {
    if (mobileMappingManager) {
        mobileMappingManager.centerMap();
    }
}

function refreshMap() {
    if (mobileMappingManager) {
        mobileMappingManager.refreshMap();
    }
}

function toggleFullscreen() {
    if (mobileMappingManager) {
        mobileMappingManager.toggleFullscreen();
    }
}

function exportData() {
    if (mobileMappingManager) {
        mobileMappingManager.exportData();
    }
}

document.addEventListener('DOMContentLoaded', function() {
    // Initialize mobile billing interface
    initMobileBilling();
    
    // Add touch feedback for interactive elements
    addTouchFeedback();
    
    // Initialize haptic feedback
    initHapticFeedback();
    
    // Add pull-to-refresh functionality
    initPullToRefresh();
    
    // Initialize quick actions
    initQuickActions();
});

/**
 * Initialize mobile billing interface
 */
function initMobileBilling() {
    console.log('Initializing Admin Mobile Billing...');
    
    // Add loading states to stats cards
    const statCards = document.querySelectorAll('.stat-card');
    statCards.forEach(card => {
        card.addEventListener('click', function() {
            this.classList.add('loading');
            setTimeout(() => {
                this.classList.remove('loading');
            }, 1500);
        });
    });
    
    // Add ripple effect to menu cards
    const menuCards = document.querySelectorAll('.menu-card');
    menuCards.forEach(card => {
        card.addEventListener('click', function(e) {
            createRippleEffect(e, this);
        });
    });
    
    // Add active state management for navigation
    updateActiveNavigation();
    
    // Add smooth scrolling for better mobile experience
    document.documentElement.style.scrollBehavior = 'smooth';
}

/**
 * Add touch feedback for interactive elements
 */
function addTouchFeedback() {
    const interactiveElements = document.querySelectorAll('.menu-card, .action-btn, .stat-card, .nav-item');
    
    interactiveElements.forEach(element => {
        // Touch start
        element.addEventListener('touchstart', function(e) {
            this.style.transform = 'translateY(-2px) scale(0.98)';
            this.style.transition = 'all 0.1s ease';
            
            // Add haptic feedback
            if (navigator.vibrate) {
                navigator.vibrate(30);
            }
        });
        
        // Touch end
        element.addEventListener('touchend', function() {
            setTimeout(() => {
                this.style.transform = '';
                this.style.transition = 'all 0.3s ease';
            }, 150);
        });
        
        // Touch cancel
        element.addEventListener('touchcancel', function() {
            this.style.transform = '';
            this.style.transition = 'all 0.3s ease';
        });
    });
}

/**
 * Initialize haptic feedback
 */
function initHapticFeedback() {
    if (!navigator.vibrate) {
        console.log('Haptic feedback not supported on this device');
        return;
    }
    
    // Different vibration patterns for different actions
    const vibrationPatterns = {
        success: [100, 50, 100],
        error: [200, 100, 200],
        warning: [150, 75, 150],
        info: [50, 25, 50]
    };
    
    // Add haptic feedback to action buttons
    const actionButtons = document.querySelectorAll('.action-btn');
    actionButtons.forEach(button => {
        button.addEventListener('click', function() {
            navigator.vibrate(vibrationPatterns.info);
        });
    });
    
    // Add haptic feedback to menu cards
    const menuCards = document.querySelectorAll('.menu-card');
    menuCards.forEach(card => {
        card.addEventListener('click', function() {
            navigator.vibrate(vibrationPatterns.success);
        });
    });
}

/**
 * Initialize pull-to-refresh functionality
 */
function initPullToRefresh() {
    let startY = 0;
    let currentY = 0;
    let isRefreshing = false;
    const refreshThreshold = 100;
    
    document.addEventListener('touchstart', function(e) {
        if (window.scrollY === 0) {
            startY = e.touches[0].clientY;
        }
    });
    
    document.addEventListener('touchmove', function(e) {
        if (window.scrollY === 0 && startY > 0) {
            currentY = e.touches[0].clientY;
            const pullDistance = currentY - startY;
            
            if (pullDistance > 0) {
                e.preventDefault();
                
                // Add visual feedback
                const pullDistancePercent = Math.min(pullDistance / refreshThreshold, 1);
                document.body.style.transform = `translateY(${pullDistance * 0.5}px)`;
                document.body.style.opacity = 1 - (pullDistancePercent * 0.1);
                
                // Show refresh indicator
                showRefreshIndicator(pullDistancePercent);
            }
        }
    });
    
    document.addEventListener('touchend', function(e) {
        if (startY > 0) {
            const pullDistance = currentY - startY;
            
            if (pullDistance > refreshThreshold && !isRefreshing) {
                triggerRefresh();
            } else {
                // Reset position
                document.body.style.transform = '';
                document.body.style.opacity = '';
                hideRefreshIndicator();
            }
            
            startY = 0;
            currentY = 0;
        }
    });
}

/**
 * Show refresh indicator
 */
function showRefreshIndicator(progress) {
    let indicator = document.getElementById('refresh-indicator');
    if (!indicator) {
        indicator = document.createElement('div');
        indicator.id = 'refresh-indicator';
        indicator.innerHTML = '<i class="bi bi-arrow-clockwise"></i> Pull to refresh';
        indicator.style.cssText = `
            position: fixed;
            top: 20px;
            left: 50%;
            transform: translateX(-50%);
            background: rgba(67, 97, 238, 0.9);
            color: white;
            padding: 10px 20px;
            border-radius: 20px;
            font-size: 14px;
            z-index: 9999;
            transition: all 0.3s ease;
        `;
        document.body.appendChild(indicator);
    }
    
    indicator.style.opacity = progress;
    indicator.style.transform = `translateX(-50%) scale(${0.8 + progress * 0.2})`;
}

/**
 * Hide refresh indicator
 */
function hideRefreshIndicator() {
    const indicator = document.getElementById('refresh-indicator');
    if (indicator) {
        indicator.style.opacity = '0';
        setTimeout(() => {
            if (indicator.parentNode) {
                indicator.parentNode.removeChild(indicator);
            }
        }, 300);
    }
}

/**
 * Trigger refresh
 */
function triggerRefresh() {
    isRefreshing = true;
    
    // Show loading state
    const indicator = document.getElementById('refresh-indicator');
    if (indicator) {
        indicator.innerHTML = '<i class="bi bi-arrow-clockwise spinner"></i> Refreshing...';
    }
    
    // Use efficient data refresh instead of full page reload
    setTimeout(() => {
        // Check if we're on mapping page and use refreshMap function
        if (typeof refreshMap === 'function') {
            refreshMap();
        } else if (mobileMappingManager && typeof mobileMappingManager.refreshMap === 'function') {
            mobileMappingManager.refreshMap();
        } else {
            // Fallback to location reload only if no refresh function available
            location.reload();
        }
        
        // Reset refreshing state
        setTimeout(() => {
            isRefreshing = false;
            hideRefreshIndicator();
        }, 2000);
    }, 1000);
}

/**
 * Initialize quick actions
 */
function initQuickActions() {
    // Quick Add Customer
    window.quickAddCustomer = function() {
        showQuickModal('Tambah Pelanggan', 'customer-form');
    };
    
    // Quick Create Invoice
    window.quickCreateInvoice = function() {
        showQuickModal('Buat Tagihan', 'invoice-form');
    };
    
    // Quick Payment
    window.quickPayment = function() {
        showQuickModal('Input Pembayaran', 'payment-form');
    };
    
    // Quick Report
    window.quickReport = function() {
        showQuickModal('Laporan Cepat', 'report-form');
    };
}

/**
 * Show quick action modal
 */
function showQuickModal(title, formType) {
    // Create modal overlay
    const overlay = document.createElement('div');
    overlay.style.cssText = `
        position: fixed;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        background: rgba(0,0,0,0.5);
        z-index: 9999;
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 20px;
    `;
    
    // Create modal content
    const modal = document.createElement('div');
    modal.style.cssText = `
        background: white;
        border-radius: 16px;
        padding: 20px;
        max-width: 400px;
        width: 100%;
        max-height: 80vh;
        overflow-y: auto;
        box-shadow: 0 10px 30px rgba(0,0,0,0.3);
    `;
    
    modal.innerHTML = `
        <div class="d-flex justify-content-between align-items-center mb-3">
            <h5 class="mb-0">${title}</h5>
            <button class="btn-close" onclick="closeQuickModal()"></button>
        </div>
        <div id="quick-form-content">
            <p class="text-muted">Fitur ${title} akan segera tersedia. Redirect ke halaman lengkap...</p>
            <div class="d-grid gap-2 mt-3">
                <button class="btn btn-primary" onclick="redirectToFullPage('${formType}')">
                    Buka Halaman Lengkap
                </button>
                <button class="btn btn-outline-secondary" onclick="closeQuickModal()">
                    Batal
                </button>
            </div>
        </div>
    `;
    
    overlay.appendChild(modal);
    document.body.appendChild(overlay);
    
    // Add animation
    overlay.style.opacity = '0';
    modal.style.transform = 'scale(0.9)';
    
    setTimeout(() => {
        overlay.style.opacity = '1';
        modal.style.transform = 'scale(1)';
    }, 10);
    
    // Close on overlay click
    overlay.addEventListener('click', function(e) {
        if (e.target === overlay) {
            closeQuickModal();
        }
    });
    
    // Store reference for closing
    window.currentQuickModal = overlay;
}

/**
 * Close quick modal
 */
function closeQuickModal() {
    const overlay = window.currentQuickModal;
    if (overlay) {
        overlay.style.opacity = '0';
        const modal = overlay.querySelector('div');
        modal.style.transform = 'scale(0.9)';
        
        setTimeout(() => {
            if (overlay.parentNode) {
                overlay.parentNode.removeChild(overlay);
            }
        }, 300);
        
        window.currentQuickModal = null;
    }
}

/**
 * Redirect to full page
 */
function redirectToFullPage(formType) {
    const routes = {
        'customer-form': '/admin/billing/customers?action=add',
        'invoice-form': '/admin/billing/invoices?action=create',
        'payment-form': '/admin/billing/payments?action=input',
        'report-form': '/admin/billing/reports'
    };
    
    const route = routes[formType];
    if (route) {
        window.location.href = route;
    }
}

/**
 * Create ripple effect for button clicks
 */
function createRippleEffect(event, element) {
    const ripple = document.createElement('span');
    const rect = element.getBoundingClientRect();
    const size = Math.max(rect.width, rect.height);
    const x = event.clientX - rect.left - size / 2;
    const y = event.clientY - rect.top - size / 2;
    
    ripple.style.width = ripple.style.height = size + 'px';
    ripple.style.left = x + 'px';
    ripple.style.top = y + 'px';
    ripple.style.position = 'absolute';
    ripple.style.borderRadius = '50%';
    ripple.style.background = 'rgba(255, 255, 255, 0.3)';
    ripple.style.transform = 'scale(0)';
    ripple.style.animation = 'ripple 0.6s linear';
    ripple.style.pointerEvents = 'none';
    
    element.style.position = 'relative';
    element.style.overflow = 'hidden';
    element.appendChild(ripple);
    
    setTimeout(() => {
        ripple.remove();
    }, 600);
}

/**
 * Update active navigation state
 */
function updateActiveNavigation() {
    const currentPath = window.location.pathname || '';
    // Only anchor nav items to ensure href exists
    const navItems = document.querySelectorAll('a.nav-item');

    navItems.forEach(item => {
        item.classList.remove('active');
        const href = item.getAttribute('href');
        const hrefStr = String(href || '');
        if (!hrefStr) return;

        const normalized = hrefStr.indexOf('/admin/billing/mobile') === 0
            ? hrefStr.replace('/admin/billing/mobile', '')
            : hrefStr;

        if (normalized && currentPath.includes(normalized)) {
            item.classList.add('active');
        }
    });
}

/**
 * Add CSS for ripple animation
 */
const rippleCSS = `
@keyframes ripple {
    0% {
        transform: scale(0);
        opacity: 1;
    }
    100% {
        transform: scale(2);
        opacity: 0;
    }
}

.spinner {
    animation: spin 1s linear infinite;
}

@keyframes spin {
    0% { transform: rotate(0deg); }
    100% { transform: rotate(360deg); }
}
`;

// Inject CSS
const style = document.createElement('style');
style.textContent = rippleCSS;
document.head.appendChild(style);

/**
 * Performance optimization
 */
function optimizePerformance() {
    // Lazy load images
    const images = document.querySelectorAll('img[data-src]');
    const imageObserver = new IntersectionObserver((entries, observer) => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                const img = entry.target;
                img.src = img.dataset.src;
                img.classList.remove('lazy');
                observer.unobserve(img);
            }
        });
    });
    
    images.forEach(img => imageObserver.observe(img));
    
    // Debounce scroll events
    let scrollTimeout;
    window.addEventListener('scroll', function() {
        clearTimeout(scrollTimeout);
        scrollTimeout = setTimeout(() => {
            // Handle scroll events here
        }, 100);
    });
}

// Initialize performance optimizations
optimizePerformance();

/**
 * Error handling
 */
window.addEventListener('error', function(e) {
    console.error('Admin Mobile Billing Error:', e.error);
    
    // Show user-friendly error message
    if (e.error && e.error.message) {
        showNotification('Terjadi kesalahan: ' + e.error.message, 'error');
    }
});

/**
 * Show notification
 */
function showNotification(message, type = 'info') {
    const notification = document.createElement('div');
    notification.style.cssText = `
        position: fixed;
        top: 20px;
        right: 20px;
        background: ${type === 'error' ? '#dc3545' : type === 'success' ? '#28a745' : '#17a2b8'};
        color: white;
        padding: 12px 20px;
        border-radius: 8px;
        z-index: 10000;
        font-size: 14px;
        box-shadow: 0 4px 15px rgba(0,0,0,0.2);
        transform: translateX(100%);
        transition: transform 0.3s ease;
    `;
    
    notification.textContent = message;
    document.body.appendChild(notification);
    
    // Animate in
    setTimeout(() => {
        notification.style.transform = 'translateX(0)';
    }, 10);
    
    // Auto remove
    setTimeout(() => {
        notification.style.transform = 'translateX(100%)';
        setTimeout(() => {
            if (notification.parentNode) {
                notification.parentNode.removeChild(notification);
            }
        }, 300);
    }, 3000);
}

console.log('Admin Mobile Billing JavaScript loaded successfully!');
