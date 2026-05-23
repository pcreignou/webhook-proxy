const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const url = require('url');

const PORT = process.env.PORT || 3000;
const WEBHOOK_URL = 'https://hook.us1.make.com/162c6gmhrfp2s7edupkrocmyavvtmlcs';

// ── Follow redirects and return the final URL ──
function proxyWebhook(params, maxRedirects = 10) {
  return new Promise((resolve, reject) => {
    let redirectCount = 0;

    function doRequest(targetUrl) {
      const parsed = new url.URL(targetUrl);
      const options = {
        hostname: parsed.hostname,
        path: parsed.pathname + parsed.search,
        method: 'GET',
        headers: { 'User-Agent': 'Node-Proxy/1.0' }
      };

      const req = https.request(options, (res) => {
        const { statusCode, headers } = res;

        // Consume body so socket is released
        res.resume();

        // Handle redirects (301, 302, 303, 307, 308)
        if ([301, 302, 303, 307, 308].includes(statusCode) && headers.location) {
          if (redirectCount >= maxRedirects) {
            return reject(new Error('Too many redirects'));
          }
          redirectCount++;
          const nextUrl = headers.location.startsWith('http')
            ? headers.location
            : new url.URL(headers.location, targetUrl).toString();

          console.log(`  ↳ Redirect ${redirectCount}: ${nextUrl}`);
          return doRequest(nextUrl);
        }

        // Final destination reached
        resolve({
          status: statusCode,
          finalUrl: targetUrl,        // the URL we actually landed on
          redirected: redirectCount > 0
        });
      });

      req.on('error', reject);
      req.setTimeout(15000, () => { req.destroy(); reject(new Error('Timeout')); });
      req.end();
    }

    const query = new URLSearchParams(params).toString();
    doRequest(`${WEBHOOK_URL}?${query}`);
  });
}

// ── Simple router ──
const server = http.createServer(async (req, res) => {
  const parsed = url.parse(req.url, true);
  const pathname = parsed.pathname;

  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    return res.end();
  }

  // ── Serve frontend ──
  if (pathname === '/' || pathname === '/index.html') {
    const file = path.join(__dirname, 'index.html');
    fs.readFile(file, (err, data) => {
      if (err) { res.writeHead(500); return res.end('Could not load index.html'); }
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(data);
    });
    return;
  }

  // ── Proxy endpoint ──
  if (pathname === '/proxy') {
    const { registration_number, customer_name, customer_email } = parsed.query;

    if (!registration_number || !customer_name || !customer_email) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: 'Missing required parameters.' }));
    }

    try {
      const result = await proxyWebhook({ registration_number, customer_name, customer_email });
      console.log(`[${new Date().toISOString()}] Done → HTTP ${result.status} | finalUrl: ${result.finalUrl}`);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        ok: true,
        upstreamStatus: result.status,
        redirectUrl: result.redirected ? result.finalUrl : null
      }));
    } catch (err) {
      console.error(`[${new Date().toISOString()}] Error:`, err.message);
      res.writeHead(502, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Failed to reach webhook.', detail: err.message }));
    }
    return;
  }

  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'Not found' }));
});

server.listen(PORT, () => {
  console.log(`\n  ✦ Webhook proxy running`);
  console.log(`  → Open http://localhost:${PORT} in your browser\n`);
});
