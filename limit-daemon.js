const { execSync } = require('child_process');
const db = require('./db');

const isLinux = process.platform === 'linux';
const isRoot = isLinux ? (process.getuid() === 0) : true;
const sudoPrefix = isRoot ? '' : 'sudo ';
const CHECK_INTERVAL = 10000; // Check every 10 seconds

function checkLimitsAndExpirations() {
    const users = db.getUsers();
    const now = new Date();

    // 1. Process Expirations
    for (const user of users) {
        if (user.expires_at) {
            const expiryDate = new Date(user.expires_at);
            // Ignore times, check calendar date (or precise timestamp)
            if (expiryDate < now && user.status === 'active') {
                console.log(`[Daemon] Account expired: ${user.username}. Locking...`);
                db.updateUser(user.username, { status: 'expired' });
                if (isLinux) {
                    try {
                        execSync(`${sudoPrefix}usermod -L ${user.username}`);
                        execSync(`${sudoPrefix}pkill -u ${user.username}`);
                        console.log(`[Daemon] System user ${user.username} locked and disconnected.`);
                    } catch (e) {
                        console.error(`[Daemon] Error locking system user ${user.username}:`, e.message);
                    }
                }
            }
        }
    }

    // 2. Process Multi-login connection limits
    if (!isLinux) return;

    try {
        // Find all active sshd user processes
        // Format output: pid user cmd
        const output = execSync('ps -eo pid,user,cmd | grep sshd:').toString();
        const lines = output.trim().split('\n');

        // Group PIDs by username
        const userSessions = {};
        for (const line of lines) {
            const match = line.match(/sshd:\s+([a-zA-Z0-9_\-]+)/);
            if (match) {
                const username = match[1];
                const parts = line.trim().split(/\s+/);
                const pid = parseInt(parts[0]);
                const procOwner = parts[1];

                // Check that the process is owned by the user (meaning it's the actual session process, not the root supervisor)
                if (procOwner === username) {
                    if (!userSessions[username]) {
                        userSessions[username] = [];
                    }
                    userSessions[username].push(pid);
                }
            }
        }

        // Enforce connection limits
        for (const username in userSessions) {
            const dbUser = db.getUser(username);
            if (!dbUser) continue; // Skip accounts not in database (like system accounts)

            const pids = userSessions[username];
            const limit = dbUser.limit || 1;

            if (pids.length > limit) {
                console.log(`[Daemon] User ${username} exceeds login limit: ${pids.length}/${limit}`);
                // Sort PIDs ascending (PIDs increase over time, so oldest is first)
                pids.sort((a, b) => a - b);
                // Keep the oldest 'limit' number of connections, kill the rest (new connections)
                // This prevents new connections from succeeding if they are already logged in elsewhere, 
                // OR we can kill the oldest. Standard VPS behavior is usually to kill the oldest or newest.
                // Let's kill the newest excess connections (pids from index 'limit' to end).
                const toKill = pids.slice(limit);
                for (const pid of toKill) {
                    try {
                        execSync(`${sudoPrefix}kill -9 ${pid}`);
                        console.log(`[Daemon] Terminated excess connection PID ${pid} for ${username}`);
                    } catch (e) {
                        console.error(`[Daemon] Error killing PID ${pid}:`, e.message);
                    }
                }
            }
        }
    } catch (e) {
        // Catch grep failures (exit code 1 means no active sshd: processes)
    }
}

console.log('=== VPS SSH WebSocket Limit Daemon Started ===');
console.log(`Interval: ${CHECK_INTERVAL / 1000}s`);
console.log('==============================================');

// Start loop
setInterval(checkLimitsAndExpirations, CHECK_INTERVAL);
// Initial run
checkLimitsAndExpirations();
