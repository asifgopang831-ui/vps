const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DB_PATH = path.join(__dirname, 'db.json');

// Helper to generate salt and hash
function generatePasswordHash(password) {
    const salt = crypto.randomBytes(16).toString('hex');
    const hash = crypto.pbkdf2Sync(password, salt, 1000, 64, 'sha512').toString('hex');
    return { salt, hash };
}

function verifyPassword(password, salt, hash) {
    const checkHash = crypto.pbkdf2Sync(password, salt, 1000, 64, 'sha512').toString('hex');
    return checkHash === hash;
}

// Initial default state
const defaultDb = {
    settings: {
        admin_username: 'admin',
        admin_password_hash: '', // will be set on first load
        admin_password_salt: '',
        ws_port: 8080, // Default WebSocket proxy port
        ssh_port: 22,   // Default SSH server port
        app_port: 3000, // Web Admin panel port
        decoy_url: 'https://google.com',
        allow_public_registration: true,
        default_trial_days: 3,
        domain: '',
        is_first_run: true
    },
    users: []
};

// Seed default admin password 'admin' if not set
const defaultAdmin = generatePasswordHash('admin');
defaultDb.settings.admin_password_hash = defaultAdmin.hash;
defaultDb.settings.admin_password_salt = defaultAdmin.salt;

class Database {
    constructor() {
        this.data = { ...defaultDb };
        this.load();
    }

    load() {
        try {
            if (fs.existsSync(DB_PATH)) {
                const raw = fs.readFileSync(DB_PATH, 'utf8');
                this.data = JSON.parse(raw);
                // Ensure all default properties exist if db.json is old
                this.data.settings = { ...defaultDb.settings, ...this.data.settings };
                this.data.users = this.data.users || [];
            } else {
                this.save();
            }
        } catch (e) {
            console.error('Error loading database, using default state:', e);
            this.data = { ...defaultDb };
        }
    }

    save() {
        try {
            fs.writeFileSync(DB_PATH, JSON.stringify(this.data, null, 2), 'utf8');
        } catch (e) {
            console.error('Error saving database:', e);
        }
    }

    getSettings() {
        return this.data.settings;
    }

    updateSettings(newSettings) {
        this.data.settings = { ...this.data.settings, ...newSettings };
        this.save();
        return this.data.settings;
    }

    getUsers() {
        return this.data.users;
    }

    getUser(username) {
        return this.data.users.find(u => u.username === username);
    }

    addUser(user) {
        if (this.getUser(user.username)) {
            throw new Error(`User ${user.username} already exists`);
        }
        this.data.users.push(user);
        this.save();
        return user;
    }

    updateUser(username, updates) {
        const index = this.data.users.findIndex(u => u.username === username);
        if (index === -1) {
            throw new Error(`User ${username} not found`);
        }
        this.data.users[index] = { ...this.data.users[index], ...updates };
        this.save();
        return this.data.users[index];
    }

    deleteUser(username) {
        const index = this.data.users.findIndex(u => u.username === username);
        if (index === -1) {
            return false;
        }
        this.data.users.splice(index, 1);
        this.save();
        return true;
    }

    verifyAdmin(username, password) {
        const s = this.data.settings;
        if (s.admin_username !== username) return false;
        return verifyPassword(password, s.admin_password_salt, s.admin_password_hash);
    }

    setAdminPassword(newPassword) {
        const { salt, hash } = generatePasswordHash(newPassword);
        this.data.settings.admin_password_hash = hash;
        this.data.settings.admin_password_salt = salt;
        this.data.settings.is_first_run = false;
        this.save();
    }
}

module.exports = new Database();
