const express = require('express');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { execSync } = require('child_process');
const db = require('./db');

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const isLinux = process.platform === 'linux';
const isRoot = isLinux ? (process.getuid() === 0) : true;
const sudoPrefix = isRoot ? '' : 'sudo ';
const activeSessions = new Map();

// Helper to execute commands safely
function runCmd(cmd) {
    if (!isLinux) {
        console.log(`[MOCK CMD]: ${cmd}`);
        return true;
    }
    try {
        // Run capturing stderr
        execSync(cmd, { stdio: 'pipe' });
        return true;
    } catch (e) {
        const stderr = e.stderr ? e.stderr.toString().trim() : '';
        const message = stderr || e.message;
        console.error(`Error running command: ${cmd}. Stderr: ${stderr}`, e);
        throw new Error(message);
    }
}

// Check active SSH sessions using ps
function getActiveSessions() {
    if (!isLinux) {
        // Return mock data for dev mode
        const mock = {};
        db.getUsers().forEach((u, i) => {
            if (i % 2 === 0) mock[u.username] = 1;
        });
        return mock;
    }
    try {
        const output = execSync('ps -eo user,cmd | grep sshd:').toString();
        const lines = output.trim().split('\n');
        const counts = {};
        for (const line of lines) {
            const match = line.match(/sshd:\s+([a-zA-Z0-9_\-]+)/);
            if (match) {
                const username = match[1];
                const parts = line.trim().split(/\s+/);
                const procOwner = parts[0];
                if (procOwner === username) {
                    counts[username] = (counts[username] || 0) + 1;
                }
            }
        }
        return counts;
    } catch (e) {
        return {};
    }
}

// Get system metrics
function getSystemMetrics() {
    const stats = {
        cpu: 0,
        ram: { total: 0, used: 0, free: 0, percent: 0 },
        disk: { total: 0, used: 0, free: 0, percent: 0 },
        uptime: 'N/A',
        ip: 'N/A'
    };

    if (!isLinux) {
        return {
            cpu: 12,
            ram: { total: 8000, used: 3200, free: 4800, percent: 40 },
            disk: { total: 100, used: 45, free: 55, percent: 45 },
            uptime: '3 days, 4 hours',
            ip: '127.0.0.1'
        };
    }

    try {
        // Uptime
        const uptimeSeconds = parseFloat(fs.readFileSync('/proc/uptime', 'utf8').split(' ')[0]);
        const days = Math.floor(uptimeSeconds / (24 * 3600));
        const hours = Math.floor((uptimeSeconds % (24 * 3600)) / 3600);
        const mins = Math.floor((uptimeSeconds % 3600) / 60);
        stats.uptime = `${days}d ${hours}h ${mins}m`;

        // CPU Usage (Load Avg 1m)
        const loadAvg = fs.readFileSync('/proc/loadavg', 'utf8').split(' ')[0];
        stats.cpu = Math.round(parseFloat(loadAvg) * 100);

        // Memory Info
        const memInfo = fs.readFileSync('/proc/meminfo', 'utf8');
        const memTotalMatch = memInfo.match(/MemTotal:\s+(\d+)\s+kB/);
        const memAvailMatch = memInfo.match(/MemAvailable:\s+(\d+)\s+kB/);
        if (memTotalMatch && memAvailMatch) {
            const total = parseInt(memTotalMatch[1]) / 1024; // MB
            const avail = parseInt(memAvailMatch[1]) / 1024; // MB
            const used = total - avail;
            stats.ram = {
                total: Math.round(total),
                used: Math.round(used),
                free: Math.round(avail),
                percent: Math.round((used / total) * 100)
            };
        }

        // Disk Usage
        const dfOutput = execSync("df -m / | tail -1").toString().trim().split(/\s+/);
        if (dfOutput.length >= 5) {
            const total = parseInt(dfOutput[1]);
            const used = parseInt(dfOutput[2]);
            const free = parseInt(dfOutput[3]);
            stats.disk = {
                total: Math.round(total / 1024), // GB
                used: Math.round(used / 1024),
                free: Math.round(free / 1024),
                percent: parseInt(dfOutput[4].replace('%', ''))
            };
        }

        // Public IP
        try {
            stats.ip = execSync("curl -s -m 2 ifconfig.me || curl -s -m 2 api.ipify.org || hostname -I | awk '{print $1}'").toString().trim();
        } catch (_) {
            stats.ip = 'Unknown';
        }
    } catch (e) {
        console.error('Error fetching system stats:', e);
    }

    return stats;
}

// Authentication Middleware
function requireAuth(req, res, next) {
    const authHeader = req.headers['authorization'];
    if (authHeader && authHeader.startsWith('Bearer ')) {
        const token = authHeader.substring(7);
        const session = activeSessions.get(token);
        if (session) {
            req.user = session; // attach session info
            return next();
        }
    }
    return res.status(401).json({ error: 'Unauthorized' });
}

function requireAdmin(req, res, next) {
    if (req.user && req.user.role === 'admin') {
        return next();
    }
    return res.status(403).json({ error: 'Forbidden: Admin access only' });
}

// API Routes

// Initial setup or login status check
app.get('/api/auth-check', (req, res) => {
    const settings = db.getSettings();
    res.json({
        isFirstRun: settings.is_first_run,
        allowPublicRegistration: settings.allow_public_registration,
        authenticated: false // Front-end will check via header
    });
});

// Setup admin on first run
app.post('/api/first-run', (req, res) => {
    const settings = db.getSettings();
    if (!settings.is_first_run) {
        return res.status(400).json({ error: 'First run setup already completed.' });
    }

    const { username, password } = req.body;
    if (!username || !password || password.length < 5) {
        return res.status(400).json({ error: 'Invalid username or password (min 5 chars).' });
    }

    db.updateSettings({ admin_username: username });
    db.setAdminPassword(password);
    
    // Auto-login
    const token = crypto.randomBytes(32).toString('hex');
    activeSessions.set(token, { role: 'admin', username });
    res.json({ success: true, token, role: 'admin' });
});

// Login
app.post('/api/login', (req, res) => {
    const { username, password } = req.body;
    
    // 1. Check if Admin
    if (db.verifyAdmin(username, password)) {
        const token = crypto.randomBytes(32).toString('hex');
        activeSessions.set(token, { role: 'admin', username });
        return res.json({ success: true, token, role: 'admin' });
    }
    
    // 2. Check if Standard SSH User
    const user = db.getUser(username);
    if (user && user.password === password) {
        // Expiry check
        const isExpired = user.expires_at && new Date(user.expires_at) < new Date();
        const finalStatus = isExpired ? 'expired' : user.status;
        
        if (finalStatus === 'expired' || finalStatus === 'locked') {
            return res.status(403).json({ error: `Account is ${finalStatus}. Please contact administrator.` });
        }
        
        const token = crypto.randomBytes(32).toString('hex');
        activeSessions.set(token, { role: 'user', username });
        return res.json({ success: true, token, role: 'user' });
    }
    
    res.status(401).json({ error: 'Invalid admin or user credentials' });
});

// Public Registration
app.post('/api/register', (req, res) => {
    const s = db.getSettings();
    if (!s.allow_public_registration) {
        return res.status(403).json({ error: 'Public registration is disabled by administrator.' });
    }

    const { username, password } = req.body;

    // Validate inputs
    if (!username || !/^[a-zA-Z0-9_\-]+$/.test(username)) {
        return res.status(400).json({ error: 'Username must be alphanumeric and can contain _ or -' });
    }
    if (!password || password.length < 4) {
        return res.status(400).json({ error: 'Password must be at least 4 characters long' });
    }

    if (db.getUser(username)) {
        return res.status(400).json({ error: 'Username is already taken.' });
    }

    try {
        // Calculate expiration date
        const expDate = new Date();
        expDate.setDate(expDate.getDate() + (s.default_trial_days || 3));
        const expires_at = expDate.toISOString().split('T')[0];

        // Create user in system
        runCmd(`${sudoPrefix}useradd -M -s /bin/false ${username}`);
        runCmd(`echo "${username}:${password}" | ${sudoPrefix}chpasswd`);
        runCmd(`${sudoPrefix}chage -E ${expires_at} ${username}`);

        const newUser = {
            username,
            password,
            limit: 1, // Default limit for public registration is 1 device
            expires_at,
            created_at: new Date().toISOString(),
            status: 'active',
            description: 'Public Registration'
        };

        db.addUser(newUser);
        res.json({ success: true, user: newUser });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// Logout
app.post('/api/logout', requireAuth, (req, res) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader.substring(7);
    activeSessions.delete(token);
    res.json({ success: true });
});

// User Profile (for standard user dashboard portal)
app.get('/api/profile', requireAuth, (req, res) => {
    if (req.user.role !== 'user') {
        return res.status(400).json({ error: 'Not a standard user session' });
    }
    const user = db.getUser(req.user.username);
    if (!user) return res.status(404).json({ error: 'User not found' });
    
    const activeSess = getActiveSessions();
    const isExpired = user.expires_at && new Date(user.expires_at) < new Date();
    const finalStatus = isExpired ? 'expired' : user.status;
    
    res.json({
        username: user.username,
        password: user.password,
        limit: user.limit,
        expires_at: user.expires_at,
        status: finalStatus,
        description: user.description,
        active_connections: activeSess[user.username] || 0
    });
});

// Dashboard Stats
app.get('/api/dashboard-stats', requireAuth, requireAdmin, (req, res) => {
    const activeSess = getActiveSessions();
    const system = getSystemMetrics();
    const users = db.getUsers();

    let activeConns = 0;
    Object.values(activeSess).forEach(c => activeConns += c);

    const totalAccounts = users.length;
    const expiredAccounts = users.filter(u => u.status === 'expired' || (u.expires_at && new Date(u.expires_at) < new Date())).length;
    const lockedAccounts = users.filter(u => u.status === 'locked').length;
    const activeAccounts = totalAccounts - expiredAccounts - lockedAccounts;

    res.json({
        system,
        accounts: {
            total: totalAccounts,
            active: activeAccounts,
            expired: expiredAccounts,
            locked: lockedAccounts,
            connections: activeConns
        }
    });
});

// Verify Domain DNS A-Record Live Check
app.post('/api/verify-domain', requireAuth, requireAdmin, async (req, res) => {
    const { domain } = req.body;
    if (!domain) {
        return res.status(400).json({ error: 'Domain name is required' });
    }

    try {
        const dns = require('dns').promises;
        const cleanDomain = domain.replace(/^(https?:\/\/)?(www\.)?/, '').split('/')[0].split(':')[0].trim();
        
        // 1. Resolve domain A-records
        const addresses = await dns.resolve4(cleanDomain);
        if (!addresses || addresses.length === 0) {
            return res.json({ success: false, error: 'No DNS A-record found for this domain.' });
        }

        // 2. Fetch VPS Public IP to compare
        const vpsIp = await getPublicIp();
        
        // 3. Compare resolved IPs with VPS IP
        const match = addresses.includes(vpsIp);
        if (match) {
            return res.json({ success: true, ip: addresses[0], vpsIp });
        } else {
            return res.json({ 
                success: false, 
                error: `DNS A-record points to [${addresses.join(', ')}], but your VPS IP is [${vpsIp}]. Please update your DNS records.`,
                resolvedIps: addresses,
                vpsIp
            });
        }
    } catch (err) {
        console.error('DNS Verification failed:', err);
        return res.json({ success: false, error: `DNS query failed: ${err.message}` });
    }
});

// Settings CRUD
app.get('/api/settings', requireAuth, requireAdmin, (req, res) => {
    const s = db.getSettings();
    res.json({
        ws_port: s.ws_port,
        ssh_port: s.ssh_port,
        app_port: s.app_port,
        decoy_url: s.decoy_url,
        allow_public_registration: s.allow_public_registration,
        default_trial_days: s.default_trial_days,
        domain: s.domain || ''
    });
});

app.post('/api/settings', requireAuth, requireAdmin, (req, res) => {
    const { ws_port, ssh_port, decoy_url, allow_public_registration, default_trial_days, domain } = req.body;
    const updates = {};
    if (ws_port) updates.ws_port = parseInt(ws_port);
    if (ssh_port) updates.ssh_port = parseInt(ssh_port);
    if (decoy_url) updates.decoy_url = decoy_url;
    if (allow_public_registration !== undefined) updates.allow_public_registration = !!allow_public_registration;
    if (default_trial_days !== undefined) updates.default_trial_days = parseInt(default_trial_days);
    if (domain !== undefined) updates.domain = domain.trim();

    db.updateSettings(updates);
    res.json({ success: true, settings: db.getSettings() });
});

// Get Accounts
app.get('/api/accounts', requireAuth, requireAdmin, (req, res) => {
    const activeSess = getActiveSessions();
    const users = db.getUsers().map(u => {
        const isExpired = u.expires_at && new Date(u.expires_at) < new Date();
        const finalStatus = isExpired ? 'expired' : u.status;
        return {
            username: u.username,
            password: u.password,
            limit: u.limit,
            expires_at: u.expires_at,
            created_at: u.created_at,
            status: finalStatus,
            description: u.description,
            active_connections: activeSess[u.username] || 0
        };
    });
    res.json(users);
});

// Create Account
app.post('/api/accounts', requireAuth, requireAdmin, (req, res) => {
    const { username, password, limit, expires_at, description } = req.body;

    // Validate inputs
    if (!username || !/^[a-zA-Z0-9_\-]+$/.test(username)) {
        return res.status(400).json({ error: 'Username must be alphanumeric and can contain _ or -' });
    }
    if (!password || password.length < 4) {
        return res.status(400).json({ error: 'Password must be at least 4 characters long' });
    }

    try {
        // Create user in system
        // -M: no home directory, -s /bin/false: login shell disabled
        runCmd(`${sudoPrefix}useradd -M -s /bin/false ${username}`);
        runCmd(`echo "${username}:${password}" | ${sudoPrefix}chpasswd`);
        
        if (expires_at) {
            // Set account expiration date on Linux system
            runCmd(`${sudoPrefix}chage -E ${expires_at} ${username}`);
        }

        const newUser = {
            username,
            password, // Storing raw password to view in panel (standard for SSH tunnels)
            limit: limit ? parseInt(limit) : 1,
            expires_at: expires_at || null,
            created_at: new Date().toISOString(),
            status: 'active',
            description: description || ''
        };

        db.addUser(newUser);
        res.json({ success: true, user: newUser });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// Delete Account
app.delete('/api/accounts/:username', requireAuth, requireAdmin, (req, res) => {
    const { username } = req.params;
    try {
        // Kill user ssh sessions first
        try {
            runCmd(`${sudoPrefix}pkill -u ${username}`);
        } catch (_) {}
        
        // Remove from system
        runCmd(`${sudoPrefix}userdel -r ${username}`);
        
        db.deleteUser(username);
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// Toggle Lock/Unlock
app.post('/api/accounts/:username/toggle', requireAuth, requireAdmin, (req, res) => {
    const { username } = req.params;
    const user = db.getUser(username);
    if (!user) return res.status(404).json({ error: 'User not found' });

    try {
        const nextStatus = user.status === 'locked' ? 'active' : 'locked';
        if (nextStatus === 'locked') {
            // Lock system user account
            runCmd(`${sudoPrefix}usermod -L ${username}`);
            // Kill active sessions
            try {
                runCmd(`${sudoPrefix}pkill -u ${username}`);
            } catch (_) {}
        } else {
            // Unlock system user account
            runCmd(`${sudoPrefix}usermod -U ${username}`);
        }

        db.updateUser(username, { status: nextStatus });
        res.json({ success: true, status: nextStatus });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// Change password
app.post('/api/accounts/:username/password', requireAuth, requireAdmin, (req, res) => {
    const { username } = req.params;
    const { password } = req.body;
    if (!password || password.length < 4) {
        return res.status(400).json({ error: 'Password must be at least 4 characters long' });
    }

    try {
        runCmd(`echo "${username}:${password}" | ${sudoPrefix}chpasswd`);
        db.updateUser(username, { password });
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// Extend expiration
app.post('/api/accounts/:username/extend', requireAuth, requireAdmin, (req, res) => {
    const { username } = req.params;
    const { expires_at } = req.body; // YYYY-MM-DD
    if (!expires_at) return res.status(400).json({ error: 'Expiry date is required' });

    try {
        runCmd(`${sudoPrefix}chage -E ${expires_at} ${username}`);
        // If locked/expired, unlock it on extend
        runCmd(`${sudoPrefix}usermod -U ${username}`);
        db.updateUser(username, { expires_at, status: 'active' });
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// Update limit
app.post('/api/accounts/:username/limit', requireAuth, requireAdmin, (req, res) => {
    const { username } = req.params;
    const { limit } = req.body;
    if (!limit || parseInt(limit) < 1) return res.status(400).json({ error: 'Limit must be 1 or higher' });

    try {
        db.updateUser(username, { limit: parseInt(limit) });
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// Start API Server
const settings = db.getSettings();
const PORT = settings.app_port;
app.listen(PORT, '0.0.0.0', () => {
    console.log(`Web Admin Panel running on http://0.0.0.0:${PORT}`);
});
