// State variables
let token = localStorage.getItem('token') || '';
let role = localStorage.getItem('role') || '';
let currentTab = 'tab-overview';
let dashboardInterval = null;
let cachedSettings = null;
let vpsIp = '';

// DOM Elements
const appContainer = document.getElementById('app');
const firstRunContainer = document.getElementById('first-run-container');
const loginContainer = document.getElementById('login-container');
const dashboardContainer = document.getElementById('dashboard-container');

// API Helpers
async function apiFetch(url, options = {}) {
    const headers = {
        'Content-Type': 'application/json',
        ...options.headers
    };

    if (token) {
        headers['Authorization'] = `Bearer ${token}`;
    }

    const response = await fetch(url, { ...options, headers });
    
    if (response.status === 401) {
        // Token expired or invalid, force logout
        handleLogoutState();
        throw new Error('Unauthorized');
    }

    const data = await response.json();
    if (!response.ok) {
        throw new Error(data.error || 'API Request failed');
    }
    return data;
}

// Check initial status
async function initApp() {
    try {
        const res = await apiFetch('/api/auth-check');
        const registerLink = document.getElementById('link-to-register');
        if (res.allowPublicRegistration) {
            registerLink.classList.remove('hidden');
        } else {
            registerLink.classList.add('hidden');
        }

        if (res.isFirstRun) {
            showContainer('first-run');
        } else if (!token) {
            showContainer('login');
        } else {
            if (role === 'user') {
                showContainer('user-portal');
                loadUserPortal();
            } else {
                showContainer('dashboard');
                loadDashboard();
            }
        }
    } catch (err) {
        console.error('App init failed:', err);
    }
}

function showContainer(type) {
    firstRunContainer.classList.add('hidden');
    loginContainer.classList.add('hidden');
    dashboardContainer.classList.add('hidden');
    document.getElementById('register-container').classList.add('hidden');
    document.getElementById('reg-success-container').classList.add('hidden');
    document.getElementById('user-portal-container').classList.add('hidden');

    if (type === 'first-run') {
        firstRunContainer.classList.remove('hidden');
    } else if (type === 'login') {
        loginContainer.classList.remove('hidden');
    } else if (type === 'dashboard') {
        dashboardContainer.classList.remove('hidden');
    } else if (type === 'register') {
        document.getElementById('register-container').classList.remove('hidden');
    } else if (type === 'reg-success') {
        document.getElementById('reg-success-container').classList.remove('hidden');
    } else if (type === 'user-portal') {
        document.getElementById('user-portal-container').classList.remove('hidden');
    }
}

function handleLogoutState() {
    token = '';
    role = '';
    localStorage.removeItem('token');
    localStorage.removeItem('role');
    if (dashboardInterval) {
        clearInterval(dashboardInterval);
        dashboardInterval = null;
    }
    showContainer('login');
}

// First Run Setup form handler
document.getElementById('first-run-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const username = document.getElementById('setup-username').value;
    const password = document.getElementById('setup-password').value;

    try {
        const data = await apiFetch('/api/first-run', {
            method: 'POST',
            body: JSON.stringify({ username, password })
        });
        if (data.success && data.token) {
            token = data.token;
            role = 'admin';
            localStorage.setItem('token', token);
            localStorage.setItem('role', role);
            showContainer('dashboard');
            loadDashboard();
        }
    } catch (err) {
        alert('Setup failed: ' + err.message);
    }
});

// Login form handler
document.getElementById('login-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const username = document.getElementById('login-username').value;
    const password = document.getElementById('login-password').value;
    const errorAlert = document.getElementById('login-error');
    errorAlert.classList.add('hidden');

    try {
        const data = await apiFetch('/api/login', {
            method: 'POST',
            body: JSON.stringify({ username, password })
        });
        if (data.success && data.token) {
            token = data.token;
            role = data.role || 'user';
            localStorage.setItem('token', token);
            localStorage.setItem('role', role);
            
            if (role === 'user') {
                showContainer('user-portal');
                loadUserPortal();
            } else {
                showContainer('dashboard');
                loadDashboard();
            }
        }
    } catch (err) {
        errorAlert.textContent = err.message;
        errorAlert.classList.remove('hidden');
    }
});

// Logout handler
document.getElementById('btn-logout').addEventListener('click', async () => {
    try {
        await apiFetch('/api/logout', { method: 'POST' });
    } catch (err) {}
    handleLogoutState();
});

// Show Register page
document.getElementById('btn-show-register').addEventListener('click', (e) => {
    e.preventDefault();
    document.getElementById('register-form').reset();
    document.getElementById('register-error').classList.add('hidden');
    showContainer('register');
});

// Show Login page from register card
document.getElementById('btn-show-login').addEventListener('click', (e) => {
    e.preventDefault();
    showContainer('login');
});

// Registration success close button
document.getElementById('btn-reg-success-close').addEventListener('click', () => {
    showContainer('login');
});

// Register form submission
document.getElementById('register-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const username = document.getElementById('register-username').value;
    const password = document.getElementById('register-password').value;
    const errorAlert = document.getElementById('register-error');
    errorAlert.classList.add('hidden');

    try {
        const data = await apiFetch('/api/register', {
            method: 'POST',
            body: JSON.stringify({ username, password })
        });
        
        if (data.success && data.user) {
            // Populate success screen details
            document.getElementById('reg-success-user').textContent = data.user.username;
            document.getElementById('reg-success-pass').textContent = data.user.password;
            document.getElementById('reg-success-expiry').textContent = new Date(data.user.expires_at).toLocaleDateString();
            
            // Build standard WS payload
            const bug = 'www.google.com';
            const wsPort = cachedSettings ? cachedSettings.ws_port : '8080';
            const host = vpsIp || location.hostname || 'YOUR_VPS_IP';
            
            // Set HTTP Custom format line
            document.getElementById('reg-success-custom-val').value = `${host}:${wsPort}@${data.user.username}:${data.user.password}`;
            
            const payload = `GET / HTTP/1.1[crlf]Host: ${bug}[crlf]Connection: Upgrade[crlf]Upgrade: websocket[crlf]User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64)[crlf][crlf]`;
            document.getElementById('reg-success-payload').value = payload;

            showContainer('reg-success');
        }
    } catch (err) {
        errorAlert.textContent = err.message;
        errorAlert.classList.remove('hidden');
    }
});

// Navigation handlers
document.querySelectorAll('.menu-item').forEach(item => {
    item.addEventListener('click', (e) => {
        e.preventDefault();
        const tabId = item.getAttribute('data-tab');
        
        // Update menu items
        document.querySelectorAll('.menu-item').forEach(m => m.classList.remove('active'));
        item.classList.add('active');

        // Update tab contents
        document.querySelectorAll('.tab-content').forEach(tc => tc.classList.remove('active'));
        document.getElementById(tabId).classList.add('active');

        currentTab = tabId;
        
        // Update top title
        const pageTitle = document.getElementById('page-title');
        if (tabId === 'tab-overview') pageTitle.textContent = 'Overview';
        if (tabId === 'tab-accounts') pageTitle.textContent = 'Manage Accounts';
        if (tabId === 'tab-payloads') pageTitle.textContent = 'Payload Generator';
        if (tabId === 'tab-settings') pageTitle.textContent = 'Settings';

        // Load specific tab data
        if (tabId === 'tab-overview') {
            fetchStats();
            startPolling();
        } else {
            stopPolling();
            if (tabId === 'tab-accounts') fetchAccounts();
            if (tabId === 'tab-payloads') loadPayloadGenerator();
            if (tabId === 'tab-settings') loadSettings();
        }
    });
});

// Polling for Dashboard Metrics
function startPolling() {
    if (!dashboardInterval) {
        dashboardInterval = setInterval(fetchStats, 5000);
    }
}

function stopPolling() {
    if (dashboardInterval) {
        clearInterval(dashboardInterval);
        dashboardInterval = null;
    }
}

// Fetch dashboard statistics
async function fetchStats() {
    try {
        const stats = await apiFetch('/api/dashboard-stats');
        
        // Update system information
        vpsIp = stats.system.ip;
        document.getElementById('vps-ip').textContent = stats.system.ip;
        document.getElementById('vps-uptime').textContent = stats.system.uptime;

        // Update accounts statistics
        document.getElementById('stat-total-accounts').textContent = stats.accounts.total;
        document.getElementById('stat-active-accounts').textContent = stats.accounts.active;
        document.getElementById('stat-expired-accounts').textContent = stats.accounts.expired + stats.accounts.locked;
        document.getElementById('stat-active-connections').textContent = stats.accounts.connections;

        // Update Diagnostics progress bars
        document.getElementById('cpu-percent').textContent = `${stats.system.cpu}%`;
        document.getElementById('cpu-progress').style.width = `${stats.system.cpu}%`;

        document.getElementById('ram-usage-text').textContent = 
            `${stats.system.ram.used} / ${stats.system.ram.total} MB (${stats.system.ram.percent}%)`;
        document.getElementById('ram-progress').style.width = `${stats.system.ram.percent}%`;

        document.getElementById('disk-usage-text').textContent = 
            `${stats.system.disk.used} / ${stats.system.disk.total} GB (${stats.system.disk.percent}%)`;
        document.getElementById('disk-progress').style.width = `${stats.system.disk.percent}%`;

    } catch (err) {
        console.error('Failed to fetch stats:', err);
    }
}

// Fetch and render accounts list
async function fetchAccounts() {
    const tableBody = document.getElementById('accounts-table-body');
    tableBody.innerHTML = '<tr><td colspan="8" class="text-center text-muted"><i class="fa-solid fa-spinner fa-spin"></i> Fetching accounts...</td></tr>';
    
    try {
        const accounts = await apiFetch('/api/accounts');
        renderAccounts(accounts);
    } catch (err) {
        tableBody.innerHTML = `<tr><td colspan="8" class="text-center text-danger">Error: ${err.message}</td></tr>`;
    }
}

function renderAccounts(accounts) {
    const tableBody = document.getElementById('accounts-table-body');
    if (accounts.length === 0) {
        tableBody.innerHTML = '<tr><td colspan="8" class="text-center text-muted">No SSH accounts created yet.</td></tr>';
        return;
    }

    const searchQuery = document.getElementById('account-search').value.toLowerCase().trim();
    const filtered = accounts.filter(acc => 
        acc.username.toLowerCase().includes(searchQuery) ||
        (acc.description && acc.description.toLowerCase().includes(searchQuery))
    );

    tableBody.innerHTML = '';
    filtered.forEach(acc => {
        // Expiry calculation
        let daysLeftStr = 'Unlimited';
        let isAlmostExpired = false;

        if (acc.expires_at) {
            const exp = new Date(acc.expires_at);
            const now = new Date();
            const diffTime = exp - now;
            const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
            
            if (diffDays <= 0) {
                daysLeftStr = 'Expired';
            } else {
                daysLeftStr = `${diffDays} Day${diffDays > 1 ? 's' : ''}`;
                if (diffDays <= 3) isAlmostExpired = true;
            }
        }

        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td>
                <strong>${acc.username}</strong>
                ${acc.description ? `<br><small class="text-muted">${acc.description}</small>` : ''}
            </td>
            <td><code>${acc.password}</code></td>
            <td>${acc.limit} device${acc.limit > 1 ? 's' : ''}</td>
            <td>${acc.expires_at ? new Date(acc.expires_at).toLocaleDateString() : 'Never'}</td>
            <td class="${daysLeftStr === 'Expired' ? 'text-danger' : (isAlmostExpired ? 'text-purple' : '')}">${daysLeftStr}</td>
            <td><span class="badge badge-${acc.status}">${acc.status.toUpperCase()}</span></td>
            <td><span class="badge badge-${acc.active_connections > 0 ? 'active' : 'locked'}">${acc.active_connections} online</span></td>
            <td>
                <div class="table-actions">
                    <button class="action-btn btn-renew" title="View VPN Connection Details" onclick="showConfigModal('${acc.username}', '${acc.password}')">
                        <i class="fa-solid fa-circle-info"></i>
                    </button>
                    <button class="action-btn btn-edit" title="Change Password" onclick="openPasswordModal('${acc.username}')">
                        <i class="fa-solid fa-key"></i>
                    </button>
                    <button class="action-btn btn-edit" title="Edit Device Limit" onclick="openLimitModal('${acc.username}', ${acc.limit})">
                        <i class="fa-solid fa-arrow-up-9-digit"></i>
                    </button>
                    <button class="action-btn btn-renew" title="Renew / Extend" onclick="openRenewModal('${acc.username}')">
                        <i class="fa-solid fa-calendar-plus"></i>
                    </button>
                    <button class="action-btn btn-lock" title="${acc.status === 'locked' ? 'Unlock Account' : 'Lock Account'}" onclick="toggleUserLock('${acc.username}')">
                        <i class="fa-solid ${acc.status === 'locked' ? 'fa-lock-open' : 'fa-lock'}"></i>
                    </button>
                    <button class="action-btn btn-del" title="Delete Account" onclick="deleteUser('${acc.username}')">
                        <i class="fa-solid fa-trash"></i>
                    </button>
                </div>
            </td>
        `;
        tableBody.appendChild(tr);
    });

    if (filtered.length === 0 && searchQuery !== '') {
        tableBody.innerHTML = '<tr><td colspan="8" class="text-center text-muted">No accounts match search query.</td></tr>';
    }
}

// Live search search listener
document.getElementById('account-search').addEventListener('input', () => {
    apiFetch('/api/accounts').then(renderAccounts).catch(() => {});
});

// User Actions
async function deleteUser(username) {
    if (!confirm(`Are you sure you want to delete account: ${username}?`)) return;
    try {
        await apiFetch(`/api/accounts/${username}`, { method: 'DELETE' });
        fetchAccounts();
    } catch (err) {
        alert('Failed to delete user: ' + err.message);
    }
}

async function toggleUserLock(username) {
    try {
        await apiFetch(`/api/accounts/${username}/toggle`, { method: 'POST' });
        fetchAccounts();
    } catch (err) {
        alert('Failed to update lock status: ' + err.message);
    }
}

// Settings tab implementation
function toggleTrialGroup(checked) {
    const trialGroup = document.getElementById('trial-duration-group');
    if (checked) {
        trialGroup.classList.remove('hidden');
    } else {
        trialGroup.classList.add('hidden');
    }
}

document.getElementById('setting-public-reg').addEventListener('change', (e) => {
    toggleTrialGroup(e.target.checked);
});

async function loadSettings() {
    try {
        const settings = await apiFetch('/api/settings');
        cachedSettings = settings;
        document.getElementById('setting-ws-port').value = settings.ws_port;
        document.getElementById('setting-ssh-port').value = settings.ssh_port;
        document.getElementById('setting-decoy').value = settings.decoy_url;
        document.getElementById('setting-domain').value = settings.domain || '';
        document.getElementById('setting-public-reg').checked = settings.allow_public_registration;
        document.getElementById('setting-trial-days').value = settings.default_trial_days;
        
        toggleTrialGroup(settings.allow_public_registration);

        if (!vpsIp) {
            const stats = await apiFetch('/api/dashboard-stats').catch(() => null);
            if (stats) vpsIp = stats.system.ip;
        }
        document.getElementById('setting-vps-ip-display').textContent = vpsIp || location.hostname;
    } catch (err) {
        console.error('Failed to load settings:', err);
    }
}

document.getElementById('settings-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const ws_port = document.getElementById('setting-ws-port').value;
    const ssh_port = document.getElementById('setting-ssh-port').value;
    const decoy_url = document.getElementById('setting-decoy').value;
    const domain = document.getElementById('setting-domain').value.trim();
    const allow_public_registration = document.getElementById('setting-public-reg').checked;
    const default_trial_days = document.getElementById('setting-trial-days').value;
    
    const successAlert = document.getElementById('settings-success');
    successAlert.classList.add('hidden');

    try {
        await apiFetch('/api/settings', {
            method: 'POST',
            body: JSON.stringify({ 
                ws_port, 
                ssh_port, 
                decoy_url,
                domain,
                allow_public_registration,
                default_trial_days
            })
        });
        successAlert.classList.remove('hidden');
        setTimeout(() => successAlert.classList.add('hidden'), 4000);
        loadSettings();
    } catch (err) {
        alert('Failed to save settings: ' + err.message);
    }
});

// Domain DNS Live Verification handler
document.getElementById('btn-verify-domain').addEventListener('click', async () => {
    const domain = document.getElementById('setting-domain').value.trim();
    const statusEl = document.getElementById('domain-verification-status');
    const btn = document.getElementById('btn-verify-domain');
    
    if (!domain) {
        alert('Please enter a domain name first.');
        return;
    }

    statusEl.className = 'info-alert';
    statusEl.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Checking DNS A-Record live...';
    statusEl.classList.remove('hidden');
    btn.disabled = true;

    try {
        const res = await apiFetch('/api/verify-domain', {
            method: 'POST',
            body: JSON.stringify({ domain })
        });

        if (res.success) {
            statusEl.style.color = 'var(--green)';
            statusEl.innerHTML = `<i class="fa-solid fa-circle-check"></i> Verified! Domain A-record points to this VPS IP [${res.ip}].`;
        } else {
            statusEl.style.color = 'var(--red)';
            statusEl.innerHTML = `<i class="fa-solid fa-circle-exclamation"></i> Verification Failed: ${res.error}`;
        }
    } catch (err) {
        statusEl.style.color = 'var(--red)';
        statusEl.innerHTML = `<i class="fa-solid fa-circle-exclamation"></i> Query Failed: ${err.message}`;
    } finally {
        btn.disabled = false;
    }
});

// Payloads Generator
async function loadPayloadGenerator() {
    try {
        if (!cachedSettings) {
            cachedSettings = await apiFetch('/api/settings');
        }
        document.getElementById('payload-port').value = cachedSettings.ws_port;
        updatePayloadTexts();
    } catch (err) {
        console.error('Failed to get settings for payload:', err);
    }
}

function updatePayloadTexts() {
    const bug = document.getElementById('payload-bug').value || 'www.google.com';
    const port = document.getElementById('payload-port').value || '80';
    const host = vpsIp || 'YOUR_VPS_IP';

    // standard HTTP Upgrade payload
    const payload = `GET / HTTP/1.1[crlf]Host: ${bug}[crlf]Connection: Upgrade[crlf]Upgrade: websocket[crlf]User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64)[crlf][crlf]`;
    document.getElementById('ws-payload-text').value = payload;

    const direct = `Host/IP: ${host}\nPort: ${port}\nDecoy/SNI: ${bug}\nPayload: GET / HTTP/1.1[crlf]Host: ${bug}[crlf]Connection: Upgrade[crlf]Upgrade: websocket[crlf][crlf]`;
    document.getElementById('direct-config-text').value = direct;
}

document.getElementById('payload-bug').addEventListener('input', updatePayloadTexts);

// Copy Payload click handlers
document.querySelectorAll('.btn-copy').forEach(btn => {
    btn.addEventListener('click', () => {
        const targetId = btn.getAttribute('data-target');
        const textarea = document.getElementById(targetId);
        
        textarea.select();
        document.execCommand('copy');

        const originalText = btn.innerHTML;
        btn.innerHTML = '<i class="fa-solid fa-check"></i> Copied!';
        btn.classList.remove('btn-outline-blue', 'btn-outline-purple');
        btn.classList.add('btn-green');
        
        setTimeout(() => {
            btn.innerHTML = originalText;
            btn.classList.remove('btn-green');
            if (targetId === 'ws-payload-text') btn.classList.add('btn-outline-blue');
            if (targetId === 'direct-config-text') btn.classList.add('btn-outline-purple');
        }, 2000);
    });
});

// Modals management helpers
function openModal(modalId) {
    document.getElementById(modalId).classList.remove('hidden');
}

function closeModal(modalId) {
    document.getElementById(modalId).classList.add('hidden');
}

document.querySelectorAll('.modal-close').forEach(btn => {
    btn.addEventListener('click', () => {
        btn.closest('.modal-wrapper').classList.add('hidden');
    });
});

// Close modal if user clicks outside of it
window.addEventListener('click', (e) => {
    if (e.target.classList.contains('modal-wrapper')) {
        e.target.classList.add('hidden');
    }
});

// Create Modal triggering
document.getElementById('btn-open-create-modal').addEventListener('click', () => {
    document.getElementById('create-account-form').reset();
    document.getElementById('custom-expiry-group').classList.add('hidden');
    openModal('create-modal');
});

document.getElementById('create-duration').addEventListener('change', (e) => {
    const customGroup = document.getElementById('custom-expiry-group');
    if (e.target.value === 'custom') {
        customGroup.classList.remove('hidden');
        // Set min date to tomorrow
        const tomorrow = new Date();
        tomorrow.setDate(tomorrow.getDate() + 1);
        document.getElementById('create-expiry-date').min = tomorrow.toISOString().split('T')[0];
    } else {
        customGroup.classList.add('hidden');
    }
});

// Handle Create Account submit
document.getElementById('create-account-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const username = document.getElementById('create-username').value;
    const password = document.getElementById('create-password').value;
    const limit = document.getElementById('create-limit').value;
    const duration = document.getElementById('create-duration').value;
    const description = document.getElementById('create-desc').value;

    let expires_at = null;
    if (duration !== 'custom') {
        const days = parseInt(duration);
        const expDate = new Date();
        expDate.setDate(expDate.getDate() + days);
        expires_at = expDate.toISOString().split('T')[0];
    } else {
        expires_at = document.getElementById('create-expiry-date').value;
    }

    try {
        await apiFetch('/api/accounts', {
            method: 'POST',
            body: JSON.stringify({ username, password, limit, expires_at, description })
        });
        closeModal('create-modal');
        fetchAccounts();
        
        // Immediately trigger VPN connection details modal for this user
        showConfigModal(username, password);
    } catch (err) {
        alert('Failed to create account: ' + err.message);
    }
});

// Password Modal trigger
function openPasswordModal(username) {
    document.getElementById('password-username').value = username;
    document.getElementById('password-user-display').textContent = username;
    document.getElementById('change-password-input').value = '';
    openModal('password-modal');
}

document.getElementById('password-account-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const username = document.getElementById('password-username').value;
    const password = document.getElementById('change-password-input').value;

    try {
        await apiFetch(`/api/accounts/${username}/password`, {
            method: 'POST',
            body: JSON.stringify({ password })
        });
        closeModal('password-modal');
        fetchAccounts();
    } catch (err) {
        alert('Failed to change password: ' + err.message);
    }
});

// Limit Modal trigger
function openLimitModal(username, currentLimit) {
    document.getElementById('limit-username').value = username;
    document.getElementById('limit-user-display').textContent = username;
    document.getElementById('change-limit-input').value = currentLimit;
    openModal('limit-modal');
}

document.getElementById('limit-account-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const username = document.getElementById('limit-username').value;
    const limit = document.getElementById('change-limit-input').value;

    try {
        await apiFetch(`/api/accounts/${username}/limit`, {
            method: 'POST',
            body: JSON.stringify({ limit })
        });
        closeModal('limit-modal');
        fetchAccounts();
    } catch (err) {
        alert('Failed to update limit: ' + err.message);
    }
});

// Renew Modal trigger
function openRenewModal(username) {
    document.getElementById('renew-username').value = username;
    document.getElementById('renew-user-display').textContent = username;
    document.getElementById('renew-duration').value = '30';
    document.getElementById('renew-custom-expiry-group').classList.add('hidden');
    openModal('renew-modal');
}

document.getElementById('renew-duration').addEventListener('change', (e) => {
    const customGroup = document.getElementById('renew-custom-expiry-group');
    if (e.target.value === 'custom') {
        customGroup.classList.remove('hidden');
        const tomorrow = new Date();
        tomorrow.setDate(tomorrow.getDate() + 1);
        document.getElementById('renew-expiry-date').min = tomorrow.toISOString().split('T')[0];
    } else {
        customGroup.classList.add('hidden');
    }
});

document.getElementById('renew-account-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const username = document.getElementById('renew-username').value;
    const duration = document.getElementById('renew-duration').value;

    let expires_at = null;
    if (duration !== 'custom') {
        const days = parseInt(duration);
        const expDate = new Date();
        expDate.setDate(expDate.getDate() + days);
        expires_at = expDate.toISOString().split('T')[0];
    } else {
        expires_at = document.getElementById('renew-expiry-date').value;
    }

    try {
        await apiFetch(`/api/accounts/${username}/extend`, {
            method: 'POST',
            body: JSON.stringify({ expires_at })
        });
        closeModal('renew-modal');
        fetchAccounts();
    } catch (err) {
        alert('Renewal failed: ' + err.message);
    }
});

// Restart Buttons Handlers (mocks on front end, trigger simple notifications)
document.getElementById('btn-restart-ssh').addEventListener('click', () => {
    alert('SSH Daemon Restart Command Sent to VPS server. Check connection in a few seconds.');
});

document.getElementById('btn-restart-panel').addEventListener('click', () => {
    if (confirm('Reboot the web panel server? Connection will drop briefly.')) {
        alert('Panel reboot initiated.');
    }
});

// Show Config Modal with all details for VPN
async function showConfigModal(username, password) {
    try {
        if (!cachedSettings) {
            cachedSettings = await apiFetch('/api/settings');
        }
        
        const host = cachedSettings.domain || vpsIp || location.hostname || 'YOUR_VPS_IP';
        const port = cachedSettings.ws_port || '8080';
        
        // Populate modal data
        document.getElementById('config-display-username').textContent = username;
        document.getElementById('config-host-val').textContent = host;
        document.getElementById('config-port-val').textContent = port;
        document.getElementById('config-user-val').textContent = username;
        document.getElementById('config-pass-val').textContent = password;
        
        // HTTP Custom format: host:port@username:password
        const customFormat = `${host}:${port}@${username}:${password}`;
        document.getElementById('config-custom-format-val').value = customFormat;
        
        // WS Payload
        const bug = 'www.google.com';
        const payload = `GET / HTTP/1.1[crlf]Host: ${bug}[crlf]Connection: Upgrade[crlf]Upgrade: websocket[crlf]User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64)[crlf][crlf]`;
        document.getElementById('config-payload-val').value = payload;
        
        openModal('config-details-modal');
    } catch (e) {
        console.error('Error opening config modal:', e);
    }
}

// Inline copy handlers for copy buttons inside modals
document.addEventListener('click', (e) => {
    const btn = e.target.closest('.btn-copy-inline');
    if (!btn) return;
    
    const targetId = btn.getAttribute('data-target');
    const targetEl = document.getElementById(targetId);
    if (!targetEl) return;
    
    let textToCopy = '';
    if (targetEl.tagName === 'INPUT' || targetEl.tagName === 'TEXTAREA') {
        textToCopy = targetEl.value;
    } else {
        textToCopy = targetEl.textContent;
    }
    
    // Copy process
    const dummy = document.createElement('textarea');
    document.body.appendChild(dummy);
    dummy.value = textToCopy;
    dummy.select();
    document.execCommand('copy');
    document.body.removeChild(dummy);
    
    // UI Update feedback
    const originalHTML = btn.innerHTML;
    btn.innerHTML = '<i class="fa-solid fa-check" style="color:var(--green)"></i>';
    btn.classList.add('glow-green');
    
    setTimeout(() => {
        btn.innerHTML = originalHTML;
        btn.classList.remove('glow-green');
    }, 1500);
});

// Load standard user portal info
async function loadUserPortal() {
    try {
        if (!cachedSettings) {
            cachedSettings = await apiFetch('/api/settings').catch(() => ({ ws_port: '8080' }));
        }
        
        const profile = await apiFetch('/api/profile');
        
        // Update user status and connections badges
        const statusEl = document.getElementById('user-portal-status');
        statusEl.className = `badge badge-${profile.status}`;
        statusEl.textContent = profile.status.toUpperCase();
        
        const connsEl = document.getElementById('user-portal-conns');
        connsEl.className = `badge badge-${profile.active_connections > 0 ? 'active' : 'locked'}`;
        connsEl.textContent = `${profile.active_connections} online`;

        // Update fields
        document.getElementById('user-portal-username').textContent = profile.username;
        document.getElementById('user-portal-password').textContent = profile.password;
        
        // Expiry calculation
        let expiryStr = 'Never';
        if (profile.expires_at) {
            const exp = new Date(profile.expires_at);
            const now = new Date();
            const diffTime = exp - now;
            const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
            expiryStr = diffDays <= 0 ? 'Expired' : `${new Date(profile.expires_at).toLocaleDateString()} (${diffDays} day${diffDays > 1 ? 's' : ''} left)`;
        }
        document.getElementById('user-portal-expiry').textContent = expiryStr;
        document.getElementById('user-portal-limit').textContent = `${profile.limit} Device${profile.limit > 1 ? 's' : ''}`;

        // Custom config line
        const host = cachedSettings.domain || location.hostname || 'YOUR_VPS_IP';
        const port = cachedSettings.ws_port || '8080';
        document.getElementById('user-portal-custom-line').value = `${host}:${port}@${profile.username}:${profile.password}`;

        // Payload
        const bug = 'www.google.com';
        document.getElementById('user-portal-payload').value = `GET / HTTP/1.1[crlf]Host: ${bug}[crlf]Connection: Upgrade[crlf]Upgrade: websocket[crlf]User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64)[crlf][crlf]`;

    } catch (e) {
        console.error('Failed to load user portal:', e);
    }
}

// User portal logout listener
document.getElementById('btn-user-portal-logout').addEventListener('click', async () => {
    try {
        await apiFetch('/api/logout', { method: 'POST' });
    } catch (err) {}
    handleLogoutState();
});

// Main execution entry point
function loadDashboard() {
    fetchStats();
    startPolling();
}

// Run initial loading
initApp();
