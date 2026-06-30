const WebSocket = require('ws');

console.log("Connecting to ws://104.207.77.66:8080/ via WebSocket Proxy...");
const ws = new WebSocket('ws://104.207.77.66:8080/', {
    handshakeTimeout: 5000,
    headers: {
        'Upgrade': 'websocket',
        'Connection': 'Upgrade'
    }
});

ws.on('open', () => {
    console.log('[SUCCESS] WebSocket connection opened successfully!');
    console.log('Waiting for SSH Handshake banner from local port 22022...');
});

ws.on('message', (data) => {
    const str = data.toString().trim();
    console.log(`[SSH HANDSHAKE] Received: ${str}`);
    if (str.includes('SSH-')) {
        console.log('[✔ SUCCESS] SSH handshake received over WebSocket! Tunnel is 100% WORKING!');
    }
    ws.close();
    process.exit(0);
});

ws.on('error', (err) => {
    console.error('[ERROR] WebSocket connection failed:', err.message);
    process.exit(1);
});

setTimeout(() => {
    console.error('[TIMEOUT] No SSH banner received. Connection timed out.');
    process.exit(1);
}, 6000);
