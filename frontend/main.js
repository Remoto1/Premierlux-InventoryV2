/**
 * PREMIERLUX INVENTORY SYSTEM - MAIN LOGIC
 * Consolidated & Cleaned Version
 */

let currentUserRole = 'admin';

// --- API CONFIGURATION ---
const API_BASE = "http://127.0.0.1:5000";
const API_URL = `${API_BASE}/api/inventory`;
const BRANCHES_API_URL = `${API_BASE}/api/branches`;
const ALERTS_API_URL = `${API_BASE}/api/alerts`;
const SUPPLIERS_API_URL = `${API_BASE}/api/suppliers`;
const ORDERS_API_URL = `${API_BASE}/api/orders`;
const REPLENISH_API_URL = `${API_BASE}/api/replenishment/recommendations`;
const LOGS_API_URL = `${API_BASE}/api/logs`;



// Chart Instances
let dashBranchChart = null;
let dashCategoryChart = null;
let analyticsMainChart = null;
let stockInOutChart = null;
let analyticsSocket = null;
let lastAnalyticsPayload = null;

// ==========================================
// 1. GLOBAL HELPERS & STATE
// ==========================================

// Global Notification State
window.bellState = {
    lowStockItems: [],
    expiringItems: [],
    apiAlerts: []
};

// Toggle Visibility Helper
window.toggleMenu = function (menuId) {
    const menu = document.getElementById(menuId);
    if (menu) {
        menu.classList.toggle('invisible');
        menu.classList.toggle('opacity-0');
    }
};

window.closeAllDropdowns = function () {
    document.querySelectorAll('.nav-dropdown').forEach(d => d.classList.add('invisible', 'opacity-0'));
};

function showToast(message) {
    const toast = document.getElementById('toast');
    if (!toast) return;
    toast.textContent = message;
    toast.classList.remove('hidden');
    setTimeout(() => toast.classList.add('hidden'), 2500);
}

// ==========================================
// 2. PAGE NAVIGATION & INIT (Fixed)
// ==========================================

function showPage(page) {
    const sections = [
        'dashboard-section', 'inventory-section', 'branches-section',
        'orders-section', 'suppliers-section', 'compliance-section',
        'qr-section', 'admin-suppliers-section', 'admin-roles-section',
        'admin-logs-section', 'admin-accounts-section', 'analytics-section'
    ];

    // Hide all sections
    sections.forEach(id => {
        const el = document.getElementById(id);
        if (el) el.classList.add('hidden');
    });

    closeAllDropdowns();

    // Show target
    const target = document.getElementById(page + '-section');
    if (target) target.classList.remove('hidden');

    // --- PAGE SPECIFIC LOGIC ---

    if (page === 'dashboard') {
        initDashboard();          // Renders the charts and KPI cards
        fetchAlertsForBell();     // Gets system alerts from backend

        // ➤ MISSING PIECES RESTORED:
        fetchBatchesForAlerts();  // Checks for Expiring Items
        fetchInventory();         // Checks for Low Stock Items
    }

// NEW add code
    if (page === "admin-logs") {
  fetchLogs();
}
// NEW add code

    if (page === 'inventory') {
        fetchBranches(branches => {
            updateBranchSelect(branches);
        });
        fetchInventory();
    }

    if (page === 'branches') {
        fetchBranches();
    }

    if (page === 'suppliers') {
        fetchSuppliers();
    }

    if (page === 'orders') {
        fetchOrders();
    }

    if (page === 'analytics') {
        if (typeof initAnalyticsOverview === 'function') initAnalyticsOverview();
        if (typeof initAnalyticsSocket === 'function') initAnalyticsSocket();
        // Redraw charts if we have cached data
        if (lastAnalyticsPayload && typeof drawAnalytics === 'function') {
            drawAnalytics(lastAnalyticsPayload);
        }
    }
}
// Init on Load
window.onload = function () {
    // Attach listener for Add Branch
    const addBranchBtn = document.getElementById('addBranchBtn');
    if (addBranchBtn) addBranchBtn.addEventListener('click', saveBranch);

    // Initial Load
    showPage('dashboard');
    loadAiDashboard();
};


// ==========================================
// 3. DASHBOARD LOGIC
// ==========================================

async function initDashboard() {
    console.log("Initializing Dashboard...");
    try {
        const [invRes, branchRes, aiRes] = await Promise.all([
            fetch(API_URL).then(r => r.json()),
            fetch(BRANCHES_API_URL).then(r => r.json()),
            fetch(`${API_BASE}/api/ai/dashboard`).then(r => r.json())
        ]);

        // KPIs
        const totalValue = invRes.reduce((acc, item) => acc + ((item.price || 0) * (item.quantity || 0)), 0);
        const lowStockItems = invRes.filter(item => (item.quantity || 0) <= (item.reorder_level || 0));
        const expiringCount = window.bellState.expiringItems.length;

        document.getElementById('dash-total-value').textContent = `₱${totalValue.toLocaleString('en-PH', { maximumFractionDigits: 0 })}`;
        document.getElementById('dash-low-stock').textContent = lowStockItems.length;
        document.getElementById('dash-expiring').textContent = expiringCount;
        document.getElementById('dash-branches').textContent = branchRes.length;
        document.getElementById('dash-timestamp').textContent = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

        // AI Card
        if (aiRes) applyAiDashboardToCards(aiRes);

        // Restock Table (Top 5 Critical)
        const restockTable = document.getElementById('dash-restock-table');
        if (restockTable) {
            restockTable.innerHTML = '';
            const criticalItems = lowStockItems
                .sort((a, b) => ((a.quantity - a.reorder_level) - (b.quantity - b.reorder_level)))
                .slice(0, 5);

            criticalItems.forEach(item => {
                const row = `
                <tr class="hover:bg-slate-50 transition border-b border-slate-50 last:border-0">
                    <td class="px-6 py-3 font-medium text-slate-700">${item.name}</td>
                    <td class="px-6 py-3 text-xs text-slate-500">${item.branch}</td>
                    <td class="px-6 py-3 text-right font-bold text-rose-600">${item.quantity}</td>
                    <td class="px-6 py-3 text-center">
                        <button onclick="openRestockModal('${item.name.replace(/'/g, "\\'")}', '${item.branch}', ${item.quantity})" 
                                class="bg-indigo-50 text-indigo-600 hover:bg-indigo-600 hover:text-white px-3 py-1.5 rounded-lg text-xs font-bold transition shadow-sm">
                            Restock
                        </button>
                    </td>
                </tr>`;
                restockTable.innerHTML += row;
            });
        }

        // Charts
        renderGradientBranchChart(invRes);
        renderCategoryDoughnut(invRes);

    } catch (err) {
        console.error("Dashboard Init Error:", err);
    }
}

// Gradient Bar Chart
function renderGradientBranchChart(inventory) {
    const ctx = document.getElementById('dashBranchChart')?.getContext('2d');
    if (!ctx) return;

    const branchMap = {};
    inventory.forEach(item => {
        const val = (item.price || 0) * (item.quantity || 0);
        const branchName = item.branch || 'Unassigned';
        branchMap[branchName] = (branchMap[branchName] || 0) + val;
    });

    const labels = Object.keys(branchMap);
    const data = Object.values(branchMap);

    const gradient = ctx.createLinearGradient(0, 0, 0, 400);
    gradient.addColorStop(0, '#3b82f6');
    gradient.addColorStop(0.8, 'rgba(59, 130, 246, 0.1)');

    if (dashBranchChart) dashBranchChart.destroy();

    dashBranchChart = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: labels,
            datasets: [{
                label: 'Stock Value',
                data: data,
                backgroundColor: gradient,
                borderRadius: 8,
                borderSkipped: false,
                barPercentage: 0.5,
                categoryPercentage: 0.8
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: { legend: { display: false } },
            scales: {
                y: { beginAtZero: true, grid: { color: '#f1f5f9', borderDash: [5, 5] }, ticks: { callback: (val) => '₱' + (val / 1000) + 'k' } },
                x: { grid: { display: false } }
            }
        }
    });
}

// Doughnut Chart with Plugin
function renderCategoryDoughnut(inventory) {
    const ctx = document.getElementById('dashCategoryChart')?.getContext('2d');
    if (!ctx) return;

    const catMap = {};
    inventory.forEach(item => {
        const cat = item.category || 'Uncategorized';
        catMap[cat] = (catMap[cat] || 0) + 1;
    });

    const labels = Object.keys(catMap);
    const data = Object.values(catMap);
    const totalItems = inventory.length;

    if (dashCategoryChart) dashCategoryChart.destroy();

    const textCenterPlugin = {
        id: 'textCenter',
        beforeDraw: function (chart) {
            const { ctx, chartArea: { top, bottom, left, right } } = chart;
            ctx.save();
            const centerX = (left + right) / 2;
            const centerY = (top + bottom) / 2;
            ctx.font = `900 2.5em sans-serif`;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillStyle = "#1e293b";
            ctx.fillText(totalItems, centerX, centerY - 10);
            ctx.font = "bold 0.7em sans-serif";
            ctx.fillStyle = "#94a3b8";
            ctx.fillText("TOTAL ITEMS", centerX, centerY + 15);
            ctx.restore();
        }
    };

    dashCategoryChart = new Chart(ctx, {
        type: 'doughnut',
        data: {
            labels: labels,
            datasets: [{
                data: data,
                backgroundColor: ['#10b981', '#3b82f6', '#f97316', '#ef4444', '#8b5cf6'],
                borderWidth: 0,
                hoverOffset: 5
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            cutout: '75%',
            layout: { padding: 10 },
            plugins: {
                legend: { position: 'right', labels: { usePointStyle: true, pointStyle: 'circle', padding: 15 } }
            }
        },
        plugins: [textCenterPlugin]
    });
}


// ==========================================
// 4. INVENTORY LOGIC & CARDS
// ==========================================

function fetchInventory() {
    fetch(API_URL)
        .then(r => r.json())
        .then(data => {
            renderInventoryCards(data);
            if (window.updateLowStock) window.updateLowStock(data);
        })
        .catch(err => console.error("fetchInventory error", err));
}

function renderInventoryCards(items) {
    const container = document.getElementById('inventoryCards');
    const emptyState = document.getElementById('inventoryEmptyState');
    if (!container) return;
    container.innerHTML = '';

    const currentBranch = document.getElementById('branchFilter')?.value || 'All';
    const searchInput = document.getElementById('inventorySearch');
    const searchTerm = searchInput ? searchInput.value.toLowerCase() : '';

    const visibleItems = items.filter(item => {
        if (currentBranch !== 'All' && currentBranch !== '' && item.branch !== currentBranch) return false;
        if (searchTerm && !item.name.toLowerCase().includes(searchTerm)) return false;
        return true;
    });

    if (visibleItems.length === 0) {
        if (emptyState) emptyState.classList.remove('hidden');
    } else {
        if (emptyState) emptyState.classList.add('hidden');
    }

    visibleItems.forEach(item => {
        const card = document.createElement('div');
        const rawString = `${item.name}-${item.branch || 'general'}`;
        const uniqueId = rawString.replace(/[^a-zA-Z0-9]/g, '').toLowerCase();
        card.id = `card-${uniqueId}`;

        card.className = "group relative flex flex-col justify-between rounded-3xl bg-white/60 backdrop-blur-2xl border border-white/50 shadow-[0_8px_30px_rgb(0,0,0,0.04)] hover:shadow-xl hover:-translate-y-1 transition-all duration-300 cursor-pointer overflow-hidden h-full";
        card.onclick = () => openItemDetails(item);

        const isLow = (item.quantity || 0) <= (item.reorder_level || 0);
        const safeName = item.name.replace(/'/g, "\\'");
        const safeBranch = (item.branch || '').replace(/'/g, "\\'");

        card.innerHTML = `
          <div class="h-1.5 w-full bg-gradient-to-r ${isLow ? 'from-rose-500 to-orange-400' : 'from-emerald-400 to-teal-500'}"></div>
          <div class="p-5 flex-1 flex flex-col">
              <div class="flex justify-between items-start mb-4">
                  <div>
                      <h3 class="font-extrabold text-slate-800 text-lg leading-tight mb-1 group-hover:text-indigo-600 transition-colors">${item.name}</h3>
                      <span class="inline-flex items-center justify-center px-2 py-0.5 rounded-md bg-slate-100 border border-slate-200 text-[10px] font-bold text-slate-500 uppercase tracking-wider">${item.branch || 'General'}</span>
                  </div>
                  <div class="flex flex-col items-end">
                      <span class="text-3xl font-black ${isLow ? 'text-rose-500' : 'text-slate-700'} tracking-tight">${item.quantity || 0}</span>
                      <span class="text-[9px] text-slate-400 font-bold uppercase">In Stock</span>
                  </div>
              </div>
              <div class="grid grid-cols-2 gap-2 mb-5">
                  <div class="bg-white/50 rounded-xl p-2 border border-white/60">
                      <span class="block text-[9px] uppercase text-slate-400 font-bold mb-0.5">Category</span>
                      <span class="text-xs font-semibold text-slate-600 truncate block">${item.category || '-'}</span>
                  </div>
                   <div class="bg-white/50 rounded-xl p-2 border border-white/60">
                      <span class="block text-[9px] uppercase text-slate-400 font-bold mb-0.5">Reorder Lvl</span>
                      <div class="flex items-center gap-1">
                          <span class="text-xs font-semibold text-slate-600">${item.reorder_level || 0}</span>
                          ${isLow ? '<span class="text-[9px] text-rose-500 font-bold animate-pulse">!</span>' : ''}
                      </div>
                  </div>
              </div>
              <div class="mt-auto flex items-center gap-2 pt-4 border-t border-slate-100">
                  <button onclick="event.stopPropagation(); openEditStockModal('${safeName}', '${safeBranch}', ${item.quantity || 0})" 
                      class="flex-1 py-2 rounded-xl bg-white border border-slate-200 text-slate-600 text-xs font-bold hover:bg-slate-50 hover:border-slate-300 transition shadow-sm">
                      Edit
                  </button>
                  <button onclick="event.stopPropagation(); openRestockModal('${safeName}', '${safeBranch}', ${item.quantity || 0})" 
                      class="flex-[1.5] flex items-center justify-center gap-1.5 py-2 rounded-xl bg-indigo-50 text-indigo-600 border border-indigo-100 text-xs font-bold hover:bg-indigo-600 hover:text-white transition">
                      <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 3h2l.4 2M7 13h10l4-8H5.4M7 13L5.4 5M7 13l-2.293 2.293c-.63.63-.184 1.707.707 1.707H17m0 0a2 2 0 100 4 2 2 0 000-4zm-8 2a2 2 0 11-4 0 2 2 0 014 0z"></path></svg>
                      Reorder
                  </button>
                  <button onclick="event.stopPropagation(); confirmDelete('${safeName}')" 
                      class="flex-none w-9 h-9 flex items-center justify-center rounded-xl bg-rose-50 text-rose-400 border border-rose-100 hover:bg-rose-500 hover:text-white transition" title="Delete Item">
                      <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path></svg>
                  </button>
              </div>
          </div>`;
        container.appendChild(card);

        // Highlight
        if (window.pendingHighlight && window.pendingHighlight.id === uniqueId) {
            setTimeout(() => {
                const target = document.getElementById(`card-${uniqueId}`);
                if (target) {
                    target.scrollIntoView({ behavior: 'smooth', block: 'center' });
                    target.classList.add('highlight-pulse');
                    setTimeout(() => target.classList.remove('highlight-pulse'), 2500);
                }
            }, 500);
            window.pendingHighlight = null;
        }
    });
}

function confirmDelete(name) {
    if (confirm(`Are you sure you want to permanently delete "${name}"?`)) {
        deleteItem(name);
    }
}

function deleteItem(name) {
    fetch(`${API_URL}/${encodeURIComponent(name)}`, { method: 'DELETE' })
        .then(() => { fetchInventory(); initDashboard(); });
}

// --- CUSTOM INVENTORY DROPDOWN LOGIC (Glass Style) ---

function toggleBranchMenu() {
    const menu = document.getElementById('branchDropdownOptions');
    if (menu) menu.classList.toggle('hidden');
}

function selectBranch(value, label) {
    document.getElementById('branchFilter').value = value;
    const labelEl = document.getElementById('branchLabel');
    if (labelEl) labelEl.textContent = label;
    document.getElementById('branchDropdownOptions').classList.add('hidden');
    fetchInventory();
}

function updateBranchSelect(branches) {
    const container = document.getElementById('branchDropdownOptions');
    if (!container) return;
    container.innerHTML = '';
    container.innerHTML += `
        <button onclick="selectBranch('All', 'All branches')" 
            class="w-full text-left px-4 py-2.5 rounded-lg text-sm font-bold text-slate-700 hover:bg-indigo-50 hover:text-indigo-600 transition">
            All branches
        </button>`;
    branches.forEach(b => {
        container.innerHTML += `
            <button onclick="selectBranch('${b.name}', '${b.name}')" 
                class="w-full text-left px-4 py-2.5 rounded-lg text-sm font-medium text-slate-600 hover:bg-indigo-50 hover:text-indigo-600 transition">
                ${b.name}
            </button>`;
    });
}

// Close glass dropdowns when clicking outside
window.addEventListener('click', (e) => {
    // Inventory Dropdown
    const iBtn = document.getElementById('branchDropdownBtn');
    const iMenu = document.getElementById('branchDropdownOptions');
    if (iBtn && iMenu && !iBtn.contains(e.target) && !iMenu.contains(e.target)) {
        iMenu.classList.add('hidden');
    }
    // Restock Dropdown
    const rBtn = document.getElementById('restockSupplierBtn');
    const rMenu = document.getElementById('restockSupplierOptions');
    if (rBtn && rMenu && !rBtn.contains(e.target) && !rMenu.contains(e.target)) {
        rMenu.classList.add('hidden');
    }
    // Add Batch Dropdown
    const bBtn = document.getElementById('batchBranchBtn');
    const bMenu = document.getElementById('batchBranchOptions');
    if (bBtn && bMenu && !bBtn.contains(e.target) && !bMenu.contains(e.target)) {
        bMenu.classList.add('hidden');
    }
});


// ==========================================
// 5. NOTIFICATION & ALERTS (FIXED)
// ==========================================

// 1. Handle clicking the "Body" of the notification (Navigation)
function handleNotificationClick(itemName, branchName) {
    console.log(`Navigating to: ${itemName} (${branchName})`);
    closeAllDropdowns();

    // Generate ID using STRICT matching
    const rawString = `${itemName}-${branchName || 'general'}`;
    const cleanId = rawString.replace(/[^a-zA-Z0-9]/g, '').toLowerCase();

    // Set global highlight target
    window.pendingHighlight = { id: cleanId };

    // Navigate
    showPage('inventory');

    // Reset filters so the item is visible
    const branchSelect = document.getElementById('branchFilter');
    if (branchSelect) {
        branchSelect.value = '';
        const event = new Event('change');
        branchSelect.dispatchEvent(event);
    }

    // Refresh inventory to ensure data is loaded
    fetchInventory();
}

// --- MISSING HANDLER: This makes the "Like/Check" button work ---
function handleLocalAcknowledge(type, id) {
    // 1. Visual Feedback
    showToast("Alert Acknowledged");

    // 2. Remove from local state immediately (Optimistic UI)
    if (type === 'stock') {
        window.bellState.lowStockItems = window.bellState.lowStockItems.filter(i => i.name !== id);
    } else if (type === 'expiry') {
        // Filter by any possible ID match
        window.bellState.expiringItems = window.bellState.expiringItems.filter(i => (i.id !== id && i._id !== id && i.batch_number !== id));
    }

    // 3. Re-render the bell to update the count
    renderSharedBell();

    // D. (Optional) You can add an API call here if you want to save this action to the backend
    // fetch(`${API_BASE}/api/acknowledge`, ... )
}

// 3. Fetch System Alerts (from Backend)
function fetchAlertsForBell() {
    fetch(ALERTS_API_URL)
        .then(res => res.json())
        .then(alerts => {
            if (window.updateApiAlerts) window.updateApiAlerts(alerts);
            renderSharedBell(); // Render after fetching
        })
        .catch(err => console.error('Error fetching alerts', err));
}

// 4. Render the Dropdown Content
function renderSharedBell() {
    const alertBadge = document.getElementById('alertsBadge');
    const alertDropdown = document.getElementById('alertsDropdownList');

    if (!alertDropdown) return;

    // Get Counts
    const lowCount = window.bellState.lowStockItems.length;
    const expCount = window.bellState.expiringItems.length;
    const apiCount = window.bellState.apiAlerts.length;
    const totalAlerts = lowCount + expCount + apiCount;

    // Update Red Badge
    if (alertBadge) {
        alertBadge.textContent = totalAlerts > 9 ? '9+' : totalAlerts;
        if (totalAlerts > 0) {
            alertBadge.classList.remove('hidden');
            alertBadge.classList.add('animate-pulse');
        } else {
            alertBadge.classList.add('hidden');
        }
    }

    // Render List
    alertDropdown.innerHTML = '';
    if (totalAlerts === 0) {
        alertDropdown.innerHTML = `
            <div class="flex flex-col items-center justify-center py-8 text-slate-500 opacity-60">
                <span class="text-2xl">🎉</span>
                <span class="text-xs mt-2">All caught up!</span>
            </div>`;
        return;
    }

    // --- ROW CREATOR HELPER ---
    const createNotificationRow = (type, branch, item, detail, colorClass, btnCallback) => {
        // ➤ SAFEGUARDS: Ensure strings exist before calling .replace
        const safeItem = (item || 'Unknown Item').toString().replace(/'/g, "\\'");
        const safeBranch = (branch || 'General').toString().replace(/'/g, "\\'");

        return `
        <div class="group mb-2 bg-slate-800/50 hover:bg-slate-800 border border-white/5 rounded-xl overflow-hidden transition-all duration-200">
            <div class="flex items-center justify-between px-3 py-2 bg-white/5 border-b border-white/5">
                <div class="flex items-center gap-2 overflow-hidden">
                    <span class="text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded-md ${colorClass}">
                        ${type}
                    </span>
                    <span class="text-[10px] text-slate-400 font-medium truncate max-w-[100px]" title="${branch}">
                        ${branch || 'General'}
                    </span>
                </div>
                <button onclick="${btnCallback}; event.stopPropagation();" 
                    class="text-slate-500 hover:text-emerald-400 transition-colors p-1 rounded-full hover:bg-white/10" 
                    title="Acknowledge">
                    <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M14 10h4.764a2 2 0 011.789 2.894l-3.5 7A2 2 0 0115.263 21h-4.017c-.163 0-.326-.02-.485-.06L7 20m7-10V5a2 2 0 00-2-2h-.095c-.5 0-.905.405-.905.905 0 .714-.211 1.412-.608 2.006L7 11v9m7-10h-2M7 20H5a2 2 0 01-2-2v-6a2 2 0 012-2h2.5"></path></svg>
                </button>
            </div>
            <div onclick="handleNotificationClick('${safeItem}', '${safeBranch}')" 
                 class="px-3 py-2 cursor-pointer hover:bg-white/5 transition">
                <div class="flex justify-between items-center">
                    <span class="text-sm font-semibold text-slate-200">${item || 'Unknown Item'}</span>
                    <span class="text-[10px] text-slate-400 font-mono">${detail}</span>
                </div>
            </div>
        </div>`;
    };

    // A. Expiring Items
    window.bellState.expiringItems.forEach(item => {
        const daysLeft = item.daysLeft;
        const isExpired = daysLeft < 0;
        const badgeText = isExpired ? "Expired" : "Expiring";
        const detailText = isExpired ? `Expired ${Math.abs(daysLeft)} days ago` : `${daysLeft} days left`;
        const badgeColor = isExpired ? "bg-red-500/20 text-red-400" : "bg-orange-500/20 text-orange-400";
        // ➤ ID CHECK: Handles if _id is missing
        const itemId = item.id || item._id || item.batch_number || 'unknown';

        alertDropdown.innerHTML += createNotificationRow(
            badgeText,
            item.branch,
            item.item_name,
            detailText,
            badgeColor,
            `handleLocalAcknowledge('expiry', '${itemId}')`
        );
    });

    // B. Low Stock Items
    window.bellState.lowStockItems.forEach(item => {
        alertDropdown.innerHTML += createNotificationRow(
            "Low Stock",
            item.branch,
            item.name,
            `${item.quantity} units left`,
            "bg-rose-500/20 text-rose-400",
            `handleLocalAcknowledge('stock', '${item.name}')`
        );
    });

    // C. System Alerts
    window.bellState.apiAlerts.forEach(alert => {
        alertDropdown.innerHTML += createNotificationRow(
            "System",
            "Admin",
            alert.title,
            "Action required",
            "bg-indigo-500/20 text-indigo-400",
            `acknowledgeAlert('${alert.id}')`
        );
    });
}

// 5. Data State Updaters
window.updateLowStock = function (data) {
    if (!data) return;
    window.bellState.lowStockItems = data.filter(i => (i.quantity || 0) <= (i.reorder_level || 0));
    renderSharedBell();
};

window.updateApiAlerts = function (alerts) {
    if (!alerts) return;
    window.bellState.apiAlerts = alerts.filter(a => a.type !== 'low_stock' && a.type !== 'expiry_risk');
    renderSharedBell();
};

// C. Called by fetchBatchesForAlerts() in main.js
window.updateExpiryAndBell = function (batchData) {
    if (!batchData || !Array.isArray(batchData)) return;
    const today = new Date();
    window.bellState.expiringItems = [];

    batchData.forEach(item => {
        // ... (existing date logic remains exactly the same) ...
        const dateString = item.exp_date || item.expiration_date;
        if (dateString) {
            const expDate = new Date(dateString);
            if (!isNaN(expDate)) {
                const diffTime = expDate - today;
                const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
                if (diffDays <= 30) {
                    window.bellState.expiringItems.push({ ...item, daysLeft: diffDays });
                }
            }
        }
    });

    // ➤ NEW: Update the Dashboard KPI Card Immediately
    const dashExpiringEl = document.getElementById('dash-expiring');
    if (dashExpiringEl) {
        dashExpiringEl.textContent = window.bellState.expiringItems.length;
    }
    // ----------------------------------------------------

    // Update Notification Bell
    renderSharedBell();
};

function fetchBatchesForAlerts() {
    fetch(`${API_BASE}/api/batches`)
        .then(r => r.json())
        .then(data => { if (window.updateExpiryAndBell) window.updateExpiryAndBell(data); });
}


// ==========================================
// 6. ADD BATCH MODAL
// ==========================================

function openBatchOverlay() {
    const overlay = document.getElementById('batchOverlay');
    if (overlay) overlay.classList.remove('hidden');
    // Sync logic
    fetchBranches(branches => {
        if (typeof updateBranchSelect === 'function') updateBranchSelect(branches);
        updateBatchBranchSelect(branches);
    });
}

function closeBatchOverlay() {
    document.getElementById('batchOverlay').classList.add('hidden');
}

// Custom Glass Dropdown for Batch Modal
function updateBatchBranchSelect(branches) {
    const container = document.getElementById('batchBranchOptions');
    if (!container) return;
    container.innerHTML = '';
    branches.forEach(b => {
        container.innerHTML += `
            <button type="button" onclick="selectBatchBranch('${b.name}')" 
                class="w-full text-left px-3 py-2 rounded-lg text-sm font-medium text-slate-600 hover:bg-indigo-50 hover:text-indigo-600 transition">
                ${b.name}
            </button>`;
    });
}

function toggleBatchBranchMenu() {
    const menu = document.getElementById('batchBranchOptions');
    if (menu) menu.classList.toggle('hidden');
}

function selectBatchBranch(branchName) {
    document.getElementById('batch_branch').value = branchName;
    const label = document.getElementById('batchBranchLabel');
    if (label) {
        label.textContent = branchName;
        label.classList.remove('text-slate-400');
        label.classList.add('text-slate-800');
    }
    document.getElementById('batchBranchOptions').classList.add('hidden');
}

async function submitBatchForm(e) {
    e.preventDefault();
    // ... (Gathering payload logic remains the same) ...
    const payload = {
        item_name: document.getElementById('batch_item_name').value.trim(),
        // ... other fields ...
        exp_date: document.getElementById('batch_exp_date').value, // Ensure this is getting value
        // ...
    };

    try {
        const res = await fetch(`${API_BASE}/api/batches`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload)
        });

        if (!res.ok) {
            const data = await res.json(); // Safely get error message
            throw new Error(data.error || "Failed to add batch");
        }

        showToast('Batch successfully added!');
        closeBatchOverlay();

        // ➤ REFRESH DATA (Add these lines)
        fetchInventory();           // Updates the main cards
        fetchBatchesForAlerts();    // ➤ THIS UPDATES THE EXPIRING NOTIFICATIONS

        if (typeof initDashboard === 'function') initDashboard(); // Refreshes charts

    } catch (err) {
        console.error(err);
        alert(err.message);
    }
}
// ==========================================
// NEW add code
// ==========================================
async function fetchLogs() {
  const tbody = document.getElementById("logsTableBody");
  if (!tbody) return;

  tbody.innerHTML = `
    <tr>
      <td colspan="5" class="px-4 py-6 text-center text-slate-400 text-xs">
        Loading logs...
      </td>
    </tr>
  `;

  try {
    const res = await fetch(LOGS_API_URL, {
      credentials: "include"
    });

    if (!res.ok) {
      tbody.innerHTML = `
        <tr>
          <td colspan="5" class="px-4 py-6 text-center text-rose-500 text-xs">
            Failed to load logs.
          </td>
        </tr>
      `;
      return;
    }

    const logs = await res.json();

    if (!logs.length) {
      tbody.innerHTML = `
        <tr>
          <td colspan="5" class="px-4 py-6 text-center text-slate-400 text-xs">
            No activity logs yet.
          </td>
        </tr>
      `;
      return;
    }

    tbody.innerHTML = "";
    logs.forEach((log) => {
      const when = new Date(log.timestamp).toLocaleString();
      const details =
        log.details && Object.keys(log.details).length
          ? JSON.stringify(log.details)
          : "-";

      const tr = document.createElement("tr");
      tr.className = "hover:bg-slate-50 transition";

      tr.innerHTML = `
        <td class="px-4 py-2 text-xs font-mono text-slate-600">${log.user_email}</td>
        <td class="px-4 py-2 text-xs text-slate-500">${log.role}</td>
        <td class="px-4 py-2 text-xs font-semibold text-slate-700">${log.action}</td>
        <td class="px-4 py-2 text-xs text-slate-500 break-all">${details}</td>
        <td class="px-4 py-2 text-xs text-slate-500">${when}</td>
      `;
      tbody.appendChild(tr);
    });
  } catch (e) {
    console.error("Error loading logs", e);
    tbody.innerHTML = `
      <tr>
        <td colspan="5" class="px-4 py-6 text-center text-rose-500 text-xs">
          Error loading logs.
        </td>
      </tr>
    `;
  }
}
// ==========================================
// NEW add code
// ==========================================

// ==========================================
// 7. RESTOCK / ORDERS MODAL
// ==========================================

async function openRestockModal(itemName, branchName, currentQty) {
    const modal = document.getElementById('restockOverlay');
    if (!modal) return;

    document.getElementById('restock_item_name').textContent = itemName;
    document.getElementById('restock_branch').textContent = branchName;
    document.getElementById('restock_current').value = currentQty;
    document.getElementById('restock_qty').value = '';
    document.getElementById('restock_supplier').value = '';
    document.getElementById('restockSupplierLabel').textContent = 'Select Supplier...';

    try {
        const res = await fetch(SUPPLIERS_API_URL);
        const suppliers = await res.json();
        updateRestockSupplierSelect(suppliers);
    } catch (err) {
        console.error(err);
    }
    modal.classList.remove('hidden');
}

function updateRestockSupplierSelect(suppliers) {
    const container = document.getElementById('restockSupplierOptions');
    if (!container) return;
    container.innerHTML = '';
    if (suppliers.length === 0) container.innerHTML = `<div class="p-2 text-xs text-slate-400">No suppliers found.</div>`;
    else suppliers.forEach(s => {
        container.innerHTML += `
            <button type="button" onclick="selectRestockSupplier('${s.name}')" 
                class="w-full text-left px-3 py-2 rounded-lg text-sm font-medium text-slate-600 hover:bg-indigo-50 hover:text-indigo-600 transition flex justify-between items-center">
                <span>${s.name}</span><span class="text-[10px] text-slate-400">${s.lead_time_days || '?'} days</span>
            </button>`;
    });
}

function toggleRestockSupplierMenu() {
    document.getElementById('restockSupplierOptions').classList.toggle('hidden');
}

function selectRestockSupplier(name) {
    document.getElementById('restock_supplier').value = name;
    document.getElementById('restockSupplierLabel').textContent = name;
    document.getElementById('restockSupplierOptions').classList.add('hidden');
}

function closeRestockModal() {
    document.getElementById('restockOverlay').classList.add('hidden');
}

function handleRestockOutsideClick(e) {
    if (e.target.id === 'restockOverlay') closeRestockModal();
}

async function submitRestockRequest(e) {
    e.preventDefault();
    const payload = {
        item: document.getElementById('restock_item_name').textContent,
        branch: document.getElementById('restock_branch').textContent,
        quantity: parseInt(document.getElementById('restock_qty').value),
        supplier: document.getElementById('restock_supplier').value,
        priority: document.querySelector('input[name="priority"]:checked').value,
        notes: document.getElementById('restock_notes').value,
        status: 'pending',
        created_at: new Date().toISOString()
    };

    const btn = e.target.querySelector('button[type="submit"]');
    btn.textContent = "Sending...";
    btn.disabled = true;

    try {
        const res = await fetch(ORDERS_API_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
        if (!res.ok) throw new Error("Failed");
        closeRestockModal();
        showToast("Order sent!");
        if (!document.getElementById('orders-section').classList.contains('hidden')) fetchOrders();
    } catch (err) {
        alert(err.message);
    } finally {
        btn.textContent = "Submit Request";
        btn.disabled = false;
    }
}


// ==========================================
// 8. SUPPLIERS & ORDERS
// ==========================================

async function fetchSuppliers() {
    try {
        const res = await fetch(SUPPLIERS_API_URL);
        const data = await res.json();
        renderSupplierCards(data);
    } catch (e) { console.error(e); }
}

function renderSupplierCards(suppliers) {
    const grid = document.getElementById('suppliersGrid');
    if (!grid) return;
    grid.innerHTML = '';
    if (!suppliers || suppliers.length === 0) {
        grid.innerHTML = `<div class="col-span-full text-center py-10 text-slate-400">No suppliers.</div>`;
        return;
    }
    suppliers.forEach(s => {
        const initial = s.name.charAt(0).toUpperCase();
        grid.innerHTML += `
        <div class="bg-white/70 backdrop-blur-xl border border-white/60 rounded-2xl p-5 shadow-sm hover:shadow-md transition-all duration-200">
            <div class="flex items-start justify-between mb-4">
                <div class="flex items-center gap-3">
                    <div class="h-10 w-10 rounded-xl bg-gradient-to-br from-blue-500 to-cyan-400 flex items-center justify-center text-white font-bold shadow-sm">${initial}</div>
                    <div><h3 class="font-bold text-slate-800 text-sm">${s.name}</h3><p class="text-xs text-slate-500">${s.contact || ''}</p></div>
                </div>
            </div>
            <div class="grid grid-cols-2 gap-2 mb-4">
                <div class="bg-slate-50 p-2 rounded-lg border border-slate-100"><span class="block text-[10px] text-slate-400 uppercase font-bold">Lead Time</span><span class="text-xs font-semibold text-slate-700">${s.lead_time_days || '-'} Days</span></div>
                <div class="bg-slate-50 p-2 rounded-lg border border-slate-100"><span class="block text-[10px] text-slate-400 uppercase font-bold">Status</span><span class="text-xs font-semibold text-emerald-600">Active</span></div>
            </div>
        </div>`;
    });
}

function openSupplierModal() { document.getElementById('supplierOverlay').classList.remove('hidden'); }
function closeSupplierModal() { document.getElementById('supplierOverlay').classList.add('hidden'); }

async function submitSupplierForm(e) {
    e.preventDefault();
    const payload = {
        name: document.getElementById('new_supp_name').value,
        contact: document.getElementById('new_supp_contact').value,
        phone: document.getElementById('new_supp_phone').value,
        lead_time_days: document.getElementById('new_supp_lead').value
    };
    try {
        const res = await fetch(SUPPLIERS_API_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
        if (!res.ok) throw new Error("Failed");
        closeSupplierModal();
        fetchSuppliers();
        showToast("Supplier saved");
        document.getElementById('new_supp_name').value = '';
    } catch (err) { alert(err.message); }
}

async function fetchOrders() {
    try {
        const res = await fetch(ORDERS_API_URL);
        if (res.ok) renderOrdersTable(await res.json());
    } catch (e) { }
}

function renderOrdersTable(orders) {
    const tbody = document.getElementById('ordersTableBody');
    if (!tbody) return;
    tbody.innerHTML = '';
    if (!orders || orders.length === 0) { tbody.innerHTML = `<tr><td colspan="6" class="text-center py-8 text-slate-400">No orders.</td></tr>`; return; }

    orders.forEach(o => {
        let badge = o.status === 'pending'
            ? `<span class="px-2 py-1 rounded-md bg-amber-50 text-amber-600 text-xs font-bold border border-amber-100">Pending</span>`
            : `<span class="px-2 py-1 rounded-md bg-emerald-50 text-emerald-600 text-xs font-bold border border-emerald-100">Received</span>`;

        tbody.innerHTML += `
        <tr class="hover:bg-slate-50/50 transition">
            <td class="px-6 py-4 font-mono text-xs text-slate-500">#PO-${(o._id || o.id || '???').slice(-4)}</td>
            <td class="px-6 py-4"><div class="font-bold text-slate-700">${o.item}</div><div class="text-xs text-slate-400">Qty: ${o.quantity}</div></td>
            <td class="px-6 py-4 text-xs text-slate-600">${o.branch}</td>
            <td class="px-6 py-4">${badge}</td>
            <td class="px-6 py-4 text-xs text-slate-500">${new Date(o.created_at).toLocaleDateString()}</td>
            <td class="px-6 py-4 text-center">
                ${o.status === 'pending' ? `<button onclick="showToast('Order received logic needed')" class="text-xs bg-slate-900 text-white px-3 py-1.5 rounded-lg">Receive</button>` : `<span class="text-xs text-emerald-600 font-medium">✓ Done</span>`}
            </td>
        </tr>`;
    });
}

// ==========================================
// 9. BRANCHES & EDIT STOCK & AI (Keeping your existing logic)
// ==========================================

async function fetchBranches(onLoaded) {
    try {
        const res = await fetch(BRANCHES_API_URL);
        const branches = await res.json();
        const tbody = document.getElementById('branchesTableBody');
        if (tbody) {
            tbody.innerHTML = '';
            branches.forEach(b => {
                tbody.innerHTML += `<tr><td class="px-4 py-2">${b.name}</td><td class="px-4 py-2">${b.address}</td><td class="px-4 py-2">${b.manager}</td></tr>`;
            });
        }
        if (typeof onLoaded === 'function') onLoaded(branches);
    } catch (err) { console.error(err); }
}

async function saveBranch() {
    const name = document.getElementById('branchName').value.trim();
    if (!name) return alert('Name required');
    await fetch(BRANCHES_API_URL, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
            name, address: document.getElementById('branchAddress').value, manager: document.getElementById('branchManager').value
        })
    });
    document.getElementById('branchName').value = '';
    fetchBranches();
    initDashboard(); // Update KPI
}

let editContext = {};
function openEditStockModal(name, branch, currentQty) {
    editContext = { name, branch, current: currentQty };
    document.getElementById('edit_item_name').textContent = name;
    document.getElementById('edit_item_branch').textContent = branch;
    document.getElementById('edit_current_stock').textContent = currentQty;
    document.getElementById('editStockOverlay').classList.remove('hidden');
}
function closeEditStockModal() { document.getElementById('editStockOverlay').classList.add('hidden'); }

async function submitEditStock() {
    const qty = Number(document.getElementById('edit_quantity').value);
    const action = document.getElementById('edit_action').value;
    let delta = action === 'out' ? -qty : action === 'in' ? qty : qty - editContext.current;

    await fetch(`${API_URL}/${encodeURIComponent(editContext.name)}/adjust`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ branch: editContext.branch, delta })
    });
    closeEditStockModal();
    fetchInventory();
    initDashboard();
}

// AI Functions (Keep existing ones)
async function loadAiDashboard() {
    try {
        const res = await fetch(`${API_BASE}/api/ai/dashboard`);
        if (res.ok) applyAiDashboardToCards(await res.json());
    } catch (e) { }
}
function applyAiDashboardToCards(data) {
    if (document.getElementById("aiSummaryText")) document.getElementById("aiSummaryText").textContent = data.summary_text || "No AI data.";
    if (document.getElementById("aiRiskText")) document.getElementById("aiRiskText").textContent = data.risk_text || "No risk data.";
}

// Details Modal
function openItemDetails(item) {
    const o = document.getElementById('itemDetailsOverlay');
    if (!o) return;
    document.getElementById('detail_name').textContent = item.name;
    document.getElementById('detail_quantity').textContent = item.quantity;
    document.getElementById('detail_branch').textContent = item.branch;
    o.classList.remove('hidden');
}
function closeItemDetails() { document.getElementById('itemDetailsOverlay').classList.add('hidden'); }


// ==========================================
// 10. ANALYTICS PAGE LOGIC (Restored)
// ==========================================

// Initializer for the Analytics Page
function initAnalyticsOverview() {
    // 1. Fetch small KPIs at the top
    fetch(`${API_BASE}/analytics/overview`)
        .then(res => res.json())
        .then(d => {
            if (document.getElementById("an-new-items")) document.getElementById("an-new-items").textContent = d.new_items;
            if (document.getElementById("an-batches-7d")) document.getElementById("an-batches-7d").textContent = d.batches_7d;
            if (document.getElementById("an-total-items")) document.getElementById("an-total-items").textContent = d.total_items;
            if (document.getElementById("an-branches")) document.getElementById("an-branches").textContent = d.branches;
        })
        .catch(err => console.error("Analytics overview error", err));

    // 2. Fetch Lists (Low Stock & Top Products)
    fetchAnalyticsLists();
}

function fetchAnalyticsLists() {
    // 1. Low Stock Table
    fetch(`${API_BASE}/analytics/low-stock`)
        .then(res => res.json())
        .then(data => {
            const table = document.getElementById('lowStockTable');
            if (table) {
                table.innerHTML = "";
                if (data.length === 0) {
                    table.innerHTML = `<tr><td colspan="3" class="px-6 py-8 text-center text-slate-400 text-xs">All stock levels healthy.</td></tr>`;
                } else {
                    data.forEach(p => {
                        table.innerHTML += `
                        <tr class="hover:bg-slate-50 transition">
                            <td class="px-6 py-3 font-medium text-slate-700">${p.name}</td>
                            <td class="px-6 py-3 font-bold text-slate-800 text-right">${p.quantity}</td>
                            <td class="px-6 py-3 text-right">
                                <span class="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-rose-100 text-rose-800">
                                    Low
                                </span>
                            </td>
                        </tr>`;
                    });
                }
            }
        });

    // 2. Top Products List
    fetch(`${API_BASE}/analytics/top-products`)
        .then(res => res.json())
        .then(data => {
            const list = document.getElementById('topProductsList');
            if (list) {
                list.innerHTML = "";
                if (data.length === 0) {
                    list.innerHTML = `<li class="text-center text-slate-400 text-xs py-4">No consumption data yet.</li>`;
                } else {
                    data.forEach((p, index) => {
                        // Add medal emoji for top 3
                        let rank = `<span class="text-slate-400 text-[10px] font-bold">#${index + 1}</span>`;
                        if (index === 0) rank = '🥇';
                        if (index === 1) rank = '🥈';
                        if (index === 2) rank = '🥉';

                        list.innerHTML += `
                        <li class="flex items-center justify-between p-3 rounded-xl bg-slate-50 border border-slate-100 hover:bg-white hover:shadow-sm transition">
                            <div class="flex items-center gap-3">
                                <div class="w-6 text-center">${rank}</div>
                                <span class="text-sm font-semibold text-slate-700 truncate max-w-[120px]" title="${p._id}">${p._id}</span>
                            </div>
                            <span class="text-xs font-bold text-indigo-600 bg-indigo-50 px-2 py-1 rounded-lg">${p.used} used</span>
                        </li>`;
                    });
                }
            }
        });
}

// Socket Connection for Real-time Analytics
function initAnalyticsSocket() {
    if (analyticsSocket && analyticsSocket.connected) return;

    // Connect to the analytics namespace
    analyticsSocket = io(`${API_BASE}/analytics`, {
        transports: ["websocket"],
    });

    analyticsSocket.on("connect", () => {
        console.log("Analytics Socket connected");
    });

    analyticsSocket.on("analytics_update", (payload) => {
        console.log("Received Analytics Update");
        lastAnalyticsPayload = payload; // Cache it

        // Only draw if we are currently looking at the analytics section
        const section = document.getElementById('analytics-section');
        if (section && !section.classList.contains('hidden')) {
            drawAnalytics(payload);
        }
    });
}

// Main Chart Renderer (Big Line Chart + Bar Chart)
// Main Chart Renderer (Updated: No Category Pie)
function drawAnalytics(payload) {
    const section = document.getElementById('analytics-section');
    if (!section || section.classList.contains('hidden')) return;

    const lineCanvas = document.getElementById('analytics-main-chart');
    const barCanvas = document.getElementById('stockInOutChart');

    // Safety check
    if (!lineCanvas || !barCanvas) return;

    const weekly = payload.movement || {};
    const monthly = payload.movement_monthly || weekly;

    // Prepare Data
    const lineLabels = monthly.labels || [];
    const lineStockIn = monthly.stock_in || [];
    const lineStockOut = monthly.stock_out || [];

    const barLabels = weekly.labels || [];
    const barStockIn = weekly.stock_in || [];
    const barStockOut = weekly.stock_out || [];

    // 1. Draw Big Line Chart (Monthly Trends)
    const lineCtx = lineCanvas.getContext('2d');
    if (analyticsMainChart) analyticsMainChart.destroy();

    analyticsMainChart = new Chart(lineCtx, {
        type: 'line',
        data: {
            labels: lineLabels,
            datasets: [
                {
                    label: 'Stock In',
                    data: lineStockIn,
                    borderColor: '#22c55e', // Green
                    backgroundColor: 'rgba(34,197,94,0.1)',
                    tension: 0.4,
                    fill: true,
                    pointRadius: 4
                },
                {
                    label: 'Stock Out',
                    data: lineStockOut,
                    borderColor: '#ef4444', // Red
                    backgroundColor: 'rgba(239,68,68,0.1)',
                    tension: 0.4,
                    fill: true,
                    pointRadius: 4
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            interaction: { mode: 'index', intersect: false },
            plugins: {
                legend: { position: 'top' },
                title: {
                    display: true,
                    text: 'Monthly Stock Trends (In vs Out)',
                    font: { size: 16, weight: 'bold' },
                    padding: { bottom: 20 },
                    color: '#1e293b'
                }
            },
            scales: { y: { beginAtZero: true, grid: { borderDash: [5, 5] } }, x: { grid: { display: false } } }
        }
    });

    // 2. Draw Weekly Bar Chart
    const barCtx = barCanvas.getContext('2d');
    if (stockInOutChart) stockInOutChart.destroy();

    stockInOutChart = new Chart(barCtx, {
        type: 'bar',
        data: {
            labels: barLabels,
            datasets: [
                {
                    label: 'In',
                    data: barStockIn,
                    backgroundColor: '#22c55e',
                    borderRadius: 4
                },
                {
                    label: 'Out',
                    data: barStockOut,
                    backgroundColor: '#ef4444',
                    borderRadius: 4
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { display: false },
                title: {
                    display: true,
                    text: 'Weekly Activity (Last 7 Days)',
                    font: { size: 14, weight: 'bold' },
                    color: '#475569'
                }
            },
            scales: { y: { beginAtZero: true }, x: { grid: { display: false } } }
        }
    });

}


// ==========================================
// 11. AUTHENTICATION & LOGOUT
// ==========================================

async function doLogout() {
    try {
        // 1. Tell Backend to clear session
        await fetch(`${API_BASE}/api/logout`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' }
        });
    } catch (e) {
        console.error("Logout error", e);
    } finally {
        // 2. Redirect User to the Login Page
        window.location.href = "/login";
    }
}
