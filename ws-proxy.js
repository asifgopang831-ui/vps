const http = require('http');
const net = require('net');
const WebSocket = require('ws');
const db = require('./db');

// Load configurations from DB
const settings = db.getSettings();
const WS_PORT = settings.ws_port || 8080;
const SSH_PORT = settings.ssh_port || 22;
const DECOY_URL = settings.decoy_url || 'https://google.com';

// Create HTTP decoy server
const server = http.createServer((req, res) => {
    // Return a mock premium index page or redirect to decoy URL to camouflage the server
    res.writeHead(302, { 'Location': DECOY_URL });
    res.end();
});

// Create WebSocket server
const wss = new WebSocket.Server({ noServer: true });

server.on('upgrade', (request, socket, head) => {
    // If you need custom headers or handshake modifications, they can be set here
    wss.handleUpgrade(request, socket, head, (ws) => {
        wss.emit('connection', ws, request);
    });
});

wss.on('connection', (ws, req) => {
    const clientIp = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
    console.log(`[WS Proxy] Connected: ${clientIp}`);

    // Create TCP socket to local OpenSSH / Dropbear SSH server
    const sshSocket = net.connect({
        host: '127.0.0.1',
        port: SSH_PORT
    });

    sshSocket.on('connect', () => {
        // SSH socket successfully connected
    });

    // Pipe WebSocket client -> SSH TCP Socket
    ws.on('message', (message, isBinary) => {
        try {
            if (sshSocket.writable) {
                const buffer = isBinary ? message : Buffer.from(message);
                sshSocket.write(buffer);
            }
        } catch (err) {
            console.error('[WS Proxy] Error writing to SSH socket:', err.message);
            sshSocket.destroy();
            ws.close();
        }
    });

    // Pipe SSH TCP Socket -> WebSocket client
    sshSocket.on('data', (data) => {
        try {
            if (ws.readyState === WebSocket.OPEN) {
                ws.send(data, { binary: true });
            }
        } catch (err) {
            console.error('[WS Proxy] Error writing to WebSocket:', err.message);
            ws.close();
            sshSocket.destroy();
        }
    });

    // Closures & Cleanup
    ws.on('close', () => {
        sshSocket.end();
    });

    ws.on('error', (err) => {
        console.error('[WS Proxy] WebSocket Error:', err.message);
        sshSocket.destroy();
    });

    sshSocket.on('close', () => {
        ws.close();
    });

    sshSocket.on('error', (err) => {
        console.error('[WS Proxy] SSH Socket Error:', err.message);
        ws.close();
    });
});

// Listen on external port
server.listen(WS_PORT, '0.0.0.0', () => {
    console.log(`=== SSH WebSocket Tunnel Proxy ===`);
    console.log(`Listening on Port: ${WS_PORT}`);
    console.log(`Tunneling to SSH: 127.0.0.1:${SSH_PORT}`);
    console.log(`Decoy camouflage: ${DECOY_URL}`);
    console.log(`==================================`);
});
