#!/usr/bin/env bash

# Terminal Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
BLUE='\033[0;36m'
PURPLE='\033[0;35m'
NC='\033[0m' # No Color

clear
echo -e "${PURPLE}==================================================${NC}"
echo -e "${PURPLE}     SSH WEBSOCKET APP MANAGER AUTO-INSTALLER     ${NC}"
echo -e "${PURPLE}==================================================${NC}"
echo -e "${BLUE}Starting installation on your Linux VPS...${NC}\n"

# 1. Root Check
if [ "$EUID" -ne 0 ]; then
  echo -e "${RED}Error: Please run this script as root (sudo bash install.sh)${NC}"
  exit 1
fi

# 2. OS Compatibility Check
if [ -f /etc/debian_version ]; then
    OS="Debian"
elif [ -f /etc/redhat-release ]; then
    OS="CentOS"
else
    echo -e "${YELLOW}Warning: OS not explicitly supported. Attempting Debian-style setup...${NC}"
    OS="Debian"
fi

# 3. Update repositories and install curl
echo -e "${YELLOW}[1/6] Updating system packages...${NC}"
# 3. Update repositories and install curl
echo -e "${YELLOW}[1/6] Updating system packages (this may take a minute)...${NC}"
export DEBIAN_FRONTEND=noninteractive
apt-get update -y
apt-get install -y curl build-essential openssh-server ca-certificates gnupg

# 4. Check & Install Node.js
if ! command -v node &> /dev/null; then
    echo -e "${YELLOW}[2/6] Node.js not found. Installing Node.js LTS...${NC}"
    curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
    apt-get install -y nodejs
    if ! command -v node &> /dev/null; then
        echo -e "${RED}Error: Node.js installation failed.${NC}"
        exit 1
    fi
else
    echo -e "${GREEN}[✔] Node.js is already installed ($(node -v))${NC}"
fi

# 5. Check & Install PM2 Process Manager
if ! command -v pm2 &> /dev/null; then
    echo -e "${YELLOW}[3/6] Installing PM2 Process Manager...${NC}"
    npm install pm2 -g
else
    echo -e "${GREEN}[✔] PM2 is already installed${NC}"
fi

# 6. Configure OpenSSH for Tunneling
echo -e "${YELLOW}[4/6] Configuring SSH Daemon...${NC}"
SSHD_CONFIG="/etc/ssh/sshd_config"
if [ -f "$SSHD_CONFIG" ]; then
    # Backup original configuration
    cp "$SSHD_CONFIG" "${SSHD_CONFIG}.bak"
    
    # Ensure PasswordAuthentication is set to yes
    sed -i 's/^#PasswordAuthentication.*/PasswordAuthentication yes/' "$SSHD_CONFIG"
    sed -i 's/^PasswordAuthentication.*/PasswordAuthentication yes/' "$SSHD_CONFIG"
    
    # Ensure PermitTunnel is set to yes
    if ! grep -q "^PermitTunnel" "$SSHD_CONFIG"; then
        echo "PermitTunnel yes" >> "$SSHD_CONFIG"
    else
        sed -i 's/^PermitTunnel.*/PermitTunnel yes/' "$SSHD_CONFIG"
    fi

    # Restart SSH Daemon
    systemctl restart sshd || systemctl restart ssh
    echo -e "${GREEN}[✔] SSH configured and restarted.${NC}"
else
    echo -e "${RED}Warning: sshd_config not found. Please manually verify SSH setup.${NC}"
fi

# 7. Install project dependencies
echo -e "${YELLOW}[5/6] Deploying Application...${NC}"
cd "$(dirname "$0")" || exit

# Clean up old database and Linux system users to start completely fresh
if [ -f "db.json" ]; then
    echo -e "${YELLOW}Removing old database and clearing system users...${NC}"
    node -e "
    try {
        const db = JSON.parse(require('fs').readFileSync('db.json', 'utf8'));
        const { execSync } = require('child_process');
        if (db && db.users) {
            db.users.forEach(u => {
                try { execSync('pkill -u ' + u.username, { stdio: 'ignore' }); } catch(e){}
                try { execSync('userdel -r ' + u.username, { stdio: 'ignore' }); console.log('Cleaned system user: ' + u.username); } catch(e){}
            });
        }
    } catch(e) { console.error('Cleanup warning:', e.message); }
    " &> /dev/null
    rm -f db.json
    echo -e "${GREEN}[✔] Old users and database purged.${NC}"
fi

npm install --omit=dev

# 8. Start Services via PM2
echo -e "${YELLOW}[6/6] Launching services using PM2...${NC}"
pm2 stop all &> /dev/null
pm2 delete all &> /dev/null

# Launch Web panel, WebSocket proxy, and limit daemon
pm2 start server.js --name "ssh-panel" --log-date-format "YYYY-MM-DD HH:mm Z"
pm2 start ws-proxy.js --name "ssh-proxy" --log-date-format "YYYY-MM-DD HH:mm Z"
pm2 start limit-daemon.js --name "ssh-daemon" --log-date-format "YYYY-MM-DD HH:mm Z"

# Save PM2 state and configure startup
pm2 save &> /dev/null
pm2 startup systemd &> /dev/null

# Fetch Public IP
PUBLIC_IP=$(curl -s ifconfig.me || wget -qO- ifconfig.me || echo "YOUR_VPS_IP")

echo -e "\n${GREEN}==================================================${NC}"
echo -e "${GREEN}      INSTALLATION COMPLETED SUCCESSFULLY!        ${NC}"
echo -e "${GREEN}==================================================${NC}"
echo -e "${BLUE}Your Premium SSH WebSocket App Manager is active!${NC}\n"
echo -e "👉 ${YELLOW}Web Panel URL:${NC}    http://${PUBLIC_IP}:3000"
echo -e "👉 ${YELLOW}Default Username:${NC} admin"
echo -e "👉 ${YELLOW}Default Password:${NC} admin"
echo -e "👉 ${YELLOW}WS Tunnel Port:${NC}   8080"
echo -e "👉 ${YELLOW}SSH Server Port:${NC}  22"
echo -e "\n${YELLOW}Important Action Required:${NC}"
echo -e "1. Open the Web Panel URL and update your admin password immediately."
echo -e "2. Ensure firewall ports ${BLUE}3000 (Web panel)${NC} and ${BLUE}8080 (WS Proxy)${NC} are open."
echo -e "   e.g. Run: ${PURPLE}ufw allow 3000/tcp && ufw allow 8080/tcp && ufw reload${NC}"
echo -e "==================================================\n"
