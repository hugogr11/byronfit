// server.js — ByronFit local dev server
// Run:  node server.js
// Open: http://localhost:3000/login.html
//
// Set CLAUDE_API_KEY below with your Anthropic key.

const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const url = require('url');

const CLAUDE_API_KEY = process.env.CLAUDE_API_KEY || '';
const PORT = process.env.PORT || 3000;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css':  'text/css',
  '.js':   'application/javascript',
  '.json': 'application/json',
  '.png':  'image/png',
  '.ico':  'image/x-icon',
};

http.createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  if (req.url === '/api/strava/exchange' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      const { code } = JSON.parse(body);
      const payload = JSON.stringify({
        client_id: process.env.STRAVA_CLIENT_ID || '282302',
        client_secret: process.env.STRAVA_CLIENT_SECRET || '',
        code,
        grant_type: 'authorization_code',
      });
      const opts = {
        hostname: 'www.strava.com',
        path: '/oauth/token',
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) },
      };
      const proxyReq = https.request(opts, proxyRes => {
        let data = '';
        proxyRes.on('data', c => { data += c; });
        proxyRes.on('end', () => {
          res.writeHead(proxyRes.statusCode, { 'content-type': 'application/json' });
          res.end(data);
        });
      });
      proxyReq.on('error', err => { res.writeHead(500); res.end(JSON.stringify({ error: err.message })); });
      proxyReq.write(payload);
      proxyReq.end();
    });
    return;
  }

  if (req.url === '/api/strava/refresh' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      const { refresh_token } = JSON.parse(body);
      const payload = JSON.stringify({
        client_id: process.env.STRAVA_CLIENT_ID || '282302',
        client_secret: process.env.STRAVA_CLIENT_SECRET || '',
        refresh_token,
        grant_type: 'refresh_token',
      });
      const opts = {
        hostname: 'www.strava.com',
        path: '/oauth/token',
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) },
      };
      const proxyReq = https.request(opts, proxyRes => {
        let data = '';
        proxyRes.on('data', c => { data += c; });
        proxyRes.on('end', () => {
          res.writeHead(proxyRes.statusCode, { 'content-type': 'application/json' });
          res.end(data);
        });
      });
      proxyReq.on('error', err => { res.writeHead(500); res.end(JSON.stringify({ error: err.message })); });
      proxyReq.write(payload);
      proxyReq.end();
    });
    return;
  }

  if (req.url === '/api/ai' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      const bodyBuf = Buffer.from(body, 'utf8');
      const opts = {
        hostname: 'api.anthropic.com',
        path: '/v1/messages',
        method: 'POST',
        headers: {
          'x-api-key': CLAUDE_API_KEY,
          'anthropic-version': '2023-06-01',
          'content-type': 'application/json',
          'content-length': bodyBuf.length,
        },
      };
      const proxyReq = https.request(opts, proxyRes => {
        let data = '';
        proxyRes.on('data', chunk => { data += chunk; });
        proxyRes.on('end', () => {
          res.writeHead(proxyRes.statusCode, { 'content-type': 'application/json' });
          res.end(data);
        });
      });
      proxyReq.on('error', err => {
        res.writeHead(500);
        res.end(JSON.stringify({ error: err.message }));
      });
      proxyReq.write(bodyBuf);
      proxyReq.end();
    });
    return;
  }

  let filePath = '.' + decodeURIComponent(url.parse(req.url).pathname);
  if (filePath === './') filePath = './login.html';

  const ext = path.extname(filePath).toLowerCase();
  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404, { 'content-type': 'text/plain' });
      res.end('Not found: ' + filePath);
      return;
    }
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'text/plain' });
    res.end(data);
  });
}).listen(PORT, '0.0.0.0', () => {
  console.log('\n  ByronFit corriendo en puerto ' + PORT);
});
