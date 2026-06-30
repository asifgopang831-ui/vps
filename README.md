# Premium VPS SSH WebSocket App Manager

A complete, high-performance, and secure web administration dashboard designed for managing SSH accounts tunneling connection requests through WebSockets (useful for firewalled networks or bypassing restrictions).

---

## Key Features

- 💻 **Premium Glassmorphic UI**: Sleek dark mode dashboard built with modern CSS and real-time responsiveness.
- ⚙️ **SSH User Account CRUD**: Easily create, list, delete, change passwords, and lock/unlock system SSH accounts.
- ⏱️ **Automatic Account Expiry**: Set specific account durations (e.g. 30 days) that auto-lock and disconnect on expiration.
- 🚫 **Multi-Login Connection Enforcer**: Set active concurrent session limits per user. The background daemon actively kills excess logins.
- 🔌 **Built-in WebSocket Proxy**: A compile-free, pure-JavaScript WebSocket-to-TCP SSH bridge proxy (runs on port `8080` by default).
- 📊 **Diagnostics Monitor**: Real-time stats on VPS CPU load, Memory usage, Storage usage, Uptime, and Active SSH tunnels.
- 🚀 **Configuration Generator**: Provides copy-pasteable connection formats and HTTP payloads for mobile tunneling apps (HTTP Custom, NapsternetV, HA Tunnel, etc.).
- 🛡️ **Setup Wizard**: Out-of-the-box security requiring customized admin username and password creation on first launch.

---

## One-Click VPS Installation

### Prerequisites
- A VPS running **Ubuntu** (20.04/22.04 LTS recommended) or **Debian**.
- Root access to the server.

### Step 1: Upload Files
Upload all files in this project folder to your VPS directory (e.g., `/root/vps/`).

### Step 2: Make Installer Executable
SSH into your VPS and navigate to the project directory:
```bash
cd /root/vps
chmod +x install.sh
```

### Step 3: Run the Auto-Installer
Execute the installation script as root:
```bash
sudo ./install.sh
```

The script will automatically update packages, install Node.js (v20), PM2, configure OpenSSH, install project dependencies, and launch all backend services.

### Step 4: Open Firewall Ports
Ensure the web administration port (`3000`) and the WebSocket proxy port (`8080`) are open:
```bash
# If using UFW:
sudo ufw allow 3000/tcp
sudo ufw allow 8080/tcp
sudo ufw reload
```

---

## Service Management (via PM2)

All services are managed in the background using the PM2 process manager:

- **Check logs (Real-time logs):**
  ```bash
  pm2 logs
  ```
- **Restart all services:**
  ```bash
  pm2 restart all
  ```
- **Check service status:**
  ```bash
  pm2 status
  ```
- **Stop/Start individual services:**
  ```bash
  pm2 stop ssh-panel
  pm2 start ssh-proxy
  ```

---

## Project Structure

```
vps/
├── package.json               # Node.js configurations and minimal dependencies
├── db.js                      # Core JSON-file Database wrapper (zero binary dependencies)
├── db.json                    # Local storage database (auto-generated)
├── server.js                  # Main Express API and Web Server
├── ws-proxy.js                # Core TCP-over-WebSocket tunnel proxy
├── limit-daemon.js            # Background expiration and login limit enforcer
├── install.sh                 # Automatic Debian/Ubuntu script
├── public/                    # Admin Panel frontend assets
│   ├── index.html             # Dashboard layout markup
│   ├── style.css              # Premium glassmorphic styling
│   └── app.js                 # API routing and interaction controller
└── README.md                  # Documentation Guide
```
