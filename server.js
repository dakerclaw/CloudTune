/**
 * CloudTune - Backend Server (SA-only)
 *
 * Requires a Service Account JSON key file (sa-key.json).
 * Frontend communicates exclusively via /api/* proxy endpoints.
 *
 * Usage:
 *   1. Place sa-key.json in this directory
 *   2. Set FOLDER_ID env var (or leave empty to require from frontend)
 *   3. Run: node server.js
 *
 * Environment variables:
 *   PORT         - Server port (default: 3296)
 *   FOLDER_ID    - Google Drive folder ID
 *   SA_KEY_PATH  - Path to SA JSON key file (default: ./sa-key.json)
 *   HTTPS_PROXY  - Proxy URL for outbound HTTPS requests (e.g. http://ip:port)
 *                  Also supports HTTP_PROXY / http_proxy / https_proxy
 *
 * Proxy note:
 *   google-auth-library v9+ reads HTTP_PROXY/HTTPS_PROXY automatically.
 *   For Node.js fetch(), set GLOBAL_AGENT_HTTP_PROXY or use Node v22.14+.
 */

const express = require('express');
const path = require('path');
const { GoogleAuth } = require('google-auth-library');
const { Readable } = require('stream');
const fs = require('fs');

// === Load .env file (for direct `node server.js` without systemd) ===
const envPath = path.join(__dirname, '.env');
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const trimmed = line.trim();
    if (trimmed && !trimmed.startsWith('#') && trimmed.includes('=')) {
      const idx = trimmed.indexOf('=');
      const key = trimmed.slice(0, idx).trim();
      const val = trimmed.slice(idx + 1).trim().replace(/^["']|["']$/g, '');
      if (!process.env[key]) process.env[key] = val;
    }
  }
}

// === Configuration ===
const PORT = parseInt(process.env.PORT || '3296', 10);
const FOLDER_ID = process.env.FOLDER_ID || '';
const SA_KEY_PATH = process.env.SA_KEY_PATH || path.join(__dirname, 'sa-key.json');
const DRIVE_API_BASE = 'https://www.googleapis.com/drive/v3';

const AUDIO_MIME_TYPES = [
  'audio/mpeg','audio/mp3','audio/wav','audio/ogg',
  'audio/flac','audio/aac','audio/mp4','audio/x-m4a',
  'audio/webm','audio/amr','audio/x-ms-wma','application/ogg',
];

// === Proxy Support (for google-auth-library) ===
// google-auth-library v9+ auto-reads HTTP_PROXY / HTTPS_PROXY env vars.
// Nothing extra needed here — just make sure the env vars are set in .env
const HTTPS_PROXY = process.env.HTTPS_PROXY || process.env.https_proxy ||
                   process.env.HTTP_PROXY || process.env.http_proxy || '';
if (HTTPS_PROXY) {
  console.log(`   Proxy: ${HTTPS_PROXY}`);
}

// === Google Auth (SA-only) ===
let authClient = null;
let saEmail = '';
let saConfigured = false;

async function initAuth() {
  if (!fs.existsSync(SA_KEY_PATH)) {
    console.warn('⚠️  Service Account key file NOT found at:', SA_KEY_PATH);
    console.warn('   Frontend will show setup guide.');
    saConfigured = false;
    return;
  }

  try {
    const keyFile = JSON.parse(fs.readFileSync(SA_KEY_PATH, 'utf8'));
    saEmail = keyFile.client_email || '';

    authClient = new GoogleAuth({
      keyFile: SA_KEY_PATH,
      scopes: ['https://www.googleapis.com/auth/drive.readonly'],
    });

    const client = await authClient.getClient();
    await client.getAccessToken();

    saConfigured = true;
    console.log('✅ Service Account authenticated as:', saEmail);
  } catch (err) {
    console.error('❌ Service Account auth failed:', err.message);
    saConfigured = false;
  }
}

// === Drive API helpers (with proxy-aware fetch) ===
async function driveFetch(url, opts = {}) {
  const headers = opts.headers || {};
  const accessToken = await authClient.getAccessToken();
  const fetchOpts = {
    ...opts,
    headers: {
      ...headers,
      'Authorization': `Bearer ${accessToken.token}`,
    },
  };
  return fetch(url, fetchOpts);
}

// === Express App ===
const app = express();

// Only serve public-facing files (NOT server.js, package.json, sa-key.json, etc.)
app.use(express.static(path.join(__dirname), {
  index: 'index.html',
  setHeaders: (res, filePath) => {
    const basename = path.basename(filePath);
    if (['server.js', 'package.json', 'sa-key.json', '.env'].includes(basename)) {
      res.status(404).end();
    }
  },
  extensions: ['html', 'css', 'js', 'svg', 'png', 'jpg', 'ico', 'woff', 'woff2'],
}));

// Status endpoint
app.get('/api/status', (req, res) => {
  res.json({
    mode: 'service-account',
    saConfigured,
    saEmail: saConfigured ? saEmail : '',
    folderId: FOLDER_ID || null,
    version: '1.0.0',
  });
});

// List audio files in folder
app.get('/api/files', async (req, res) => {
  if (!saConfigured) return res.status(503).json({ error: 'Service Account not configured' });

  const folderId = req.query.folderId || FOLDER_ID;
  if (!folderId) return res.status(400).json({ error: 'folderId is required' });

  try {
    const mimeQuery = AUDIO_MIME_TYPES.map(m => `mimeType='${m}'`).join(' or ');
    const q = `'${folderId}' in parents and (${mimeQuery}) and trashed=false`;
    const url = `${DRIVE_API_BASE}/files?q=${encodeURIComponent(q)}&fields=files(id,name,mimeType,size,webContentLink)&orderBy=name&pageSize=1000`;

    const resp = await driveFetch(url);
    if (!resp.ok) {
      const err = await resp.json().catch(() => ({}));
      return res.status(resp.status).json({ error: err.error?.message || 'Drive API error' });
    }
    const data = await resp.json();
    res.json({ files: data.files || [] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// List sub-folders
app.get('/api/folders', async (req, res) => {
  if (!saConfigured) return res.status(503).json({ error: 'Service Account not configured' });

  const parentId = req.query.parentId || FOLDER_ID;
  if (!parentId) return res.status(400).json({ error: 'parentId is required' });

  try {
    const q = `'${parentId}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`;
    const url = `${DRIVE_API_BASE}/files?q=${encodeURIComponent(q)}&fields=files(id,name)&orderBy=name&pageSize=1000`;

    const resp = await driveFetch(url);
    if (!resp.ok) {
      const err = await resp.json().catch(() => ({}));
      return res.status(resp.status).json({ error: err.error?.message || 'Drive API error' });
    }
    const data = await resp.json();
    res.json({ folders: data.files || [] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Stream audio file (supports Range requests for seeking)
app.get('/api/stream/:fileId', async (req, res) => {
  if (!saConfigured) return res.status(503).json({ error: 'Service Account not configured' });

  const fileId = req.params.fileId;
  const range = req.headers.range;

  try {
    // First get file metadata (size, name)
    const metaUrl = `${DRIVE_API_BASE}/files/${fileId}?fields=size,name,mimeType,webContentLink`;
    const metaResp = await driveFetch(metaUrl);
    if (!metaResp.ok) return res.status(404).json({ error: 'File not found' });

    const meta = await metaResp.json();
    const fileSize = parseInt(meta.size, 10);

    // Build Drive API Range request URL
    let driveUrl = `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`;
    const fetchOpts = { headers: {} };

    if (range) {
      // Parse Range header: "bytes=start-end"
      const m = range.match(/bytes=(\d+)-(\d*)/);
      if (m) {
        const start = parseInt(m[1], 10);
        const end = m[2] ? parseInt(m[2], 10) : fileSize - 1;
        fetchOpts.headers['Range'] = `bytes=${start}-${end}`;
      }
    }

    const driveResp = await driveFetch(driveUrl, fetchOpts);

    // Forward status and headers
    res.status(driveResp.status);

    const forwardHeaders = ['content-type', 'content-length', 'content-range', 'accept-ranges'];
    for (const h of forwardHeaders) {
      if (driveResp.headers.get(h)) {
        res.set(h, driveResp.headers.get(h));
      }
    }

    // Stream the response body
    if (driveResp.body && typeof driveResp.body.pipe === 'function') {
      driveResp.body.pipe(res);
    } else if (driveResp.body) {
      const { Readable } = require('stream');
      Readable.fromWeb(driveResp.body).pipe(res);
    } else {
      const buf = await driveResp.buffer();
      res.send(buf);
    }
  } catch (err) {
    if (!res.headersSent) {
      res.status(500).json({ error: err.message });
    }
  }
});

// === Start ===
async function start() {
  console.log('🔧 Initializing CloudTune server...');
  await initAuth();

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`\n🎵 CloudTune server running at http://0.0.0.0:${PORT}`);
    if (saConfigured) {
      console.log(`   SA Email: ${saEmail}`);
      console.log(`   Share your music folder with: ${saEmail}`);
      if (FOLDER_ID) console.log(`   Folder ID: ${FOLDER_ID}`);
    } else {
      console.log(`   ⚠️  SA not configured — visit http://0.0.0.0:${PORT} for setup guide`);
    }
    console.log('');
  });
}

start().catch(err => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
