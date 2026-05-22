const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const url = require('url');

const PORT = process.env.PORT || 3000;
const WEBHOOK_URL = 'https://hook.us1.make.com/162c6gmhrfp2s7edupkrocmyavvtmlcs';

// ── Proxy the Make.com webhook request from the server side (no CORS) ──
function proxyWebhook(params) {
  return new Promise((resolve, reject) => {
    const query = new URLSearchParams(params).toString();
    const target = `${WEBHOOK_URL}?${query}`;
    const parsed = new url.URL(target);

    const options = {
      hostname: parsed.hostname,
      path: parsed.pathname + parsed.search,
      method: 'GET',
      headers: { 'User-Agent': 'Node-Proxy/1.0' }
    };

    const req = https.request(options, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => resolve({ status: res.statusCode, body }));
    });

    req.on('error', reject);
    req.setTimeout(10000, () => { req.destroy(); reject(new Error('Timeout')); });
    req.end();
  });
}

// ── Simple router ──
const server = http.createServer(async (req, res) => {
  const parsed = url.parse(req.url, true);
  const pathname = parsed.pathname;

  // CORS headers (allows the HTML page to call /proxy from any origin)
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    return res.end();
  }

  // ── Serve the HTML frontend ──
  if (pathname === '/' || pathname === '/index.html') {
    const file = path.join(__dirname, 'index.html');
    fs.readFile(file, (err, data) => {
      if (err) { res.writeHead(500); return res.end('Could not load index.html'); }
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(data);
    });
    return;
  }

  // ── Proxy endpoint: GET /proxy?registration_number=…&customer_name=…&customer_email=… ──
  if (pathname === '/proxy') {
    const { registration_number, customer_name, customer_email } = parsed.query;

    if (!registration_number || !customer_name || !customer_email) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: 'Missing required parameters.' }));
    }

    try {
      const result = await proxyWebhook({ registration_number, customer_name, customer_email });
      console.log(`[${new Date().toISOString()}] Webhook triggered → HTTP ${result.status}`);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, upstreamStatus: result.status }));
    } catch (err) {
      console.error(`[${new Date().toISOString()}] Webhook error:`, err.message);
      res.writeHead(502, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Failed to reach webhook.', detail: err.message }));
    }
    return;
  }

  // 404
  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'Not found' }));
});

server.listen(PORT, () => {
  console.log(`\n  ✦ Webhook proxy running`);
  console.log(`  → Open http://localhost:${PORT} in your browser\n`);
});
