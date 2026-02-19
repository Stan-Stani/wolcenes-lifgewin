const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = 3002;
const VERIFICATION_TOKEN = 'ef166948-a6c8-47e3-b251-0370e0727d89';
const DATA_FILE = '/var/www/html/wolcen/earnings.json';

function loadData() {
  try {
    return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
  } catch {
    return { total: 0, donations: [] };
  }
}

function saveData(data) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
}

const server = http.createServer((req, res) => {
  // CORS headers for client-side fetch from the static site
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(200);
    res.end();
    return;
  }

  if (req.method === 'POST' && req.url === '/wolcen/api/webhook') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      try {
        // Ko-fi sends data as form-encoded with a "data" field containing JSON
        const params = new URLSearchParams(body);
        const payload = JSON.parse(params.get('data'));

        if (payload.verification_token !== VERIFICATION_TOKEN) {
          res.writeHead(403);
          res.end('Forbidden');
          return;
        }

        const amount = parseFloat(payload.amount) || 0;
        const data = loadData();
        data.total = Math.round((data.total + amount) * 100) / 100;
        data.donations.push({
          from: payload.from_name || 'Anonymous',
          amount,
          message: payload.message || '',
          timestamp: payload.timestamp || new Date().toISOString()
        });
        // Keep only last 50 donations
        if (data.donations.length > 50) {
          data.donations = data.donations.slice(-50);
        }
        saveData(data);

        console.log(`[${new Date().toISOString()}] Donation: $${amount} from ${payload.from_name || 'Anonymous'} — Total: $${data.total}`);
        res.writeHead(200);
        res.end('OK');
      } catch (err) {
        console.error(`[${new Date().toISOString()}] Error:`, err.message);
        res.writeHead(400);
        res.end('Bad Request');
      }
    });
  } else {
    res.writeHead(404);
    res.end('Not Found');
  }
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`Wolcen webhook listener running on 127.0.0.1:${PORT}`);
});
