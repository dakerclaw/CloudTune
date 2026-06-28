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
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    const val = trimmed.slice(eqIdx + 1).trim().replace(/^["']|["']$/g, '');
    if (!process.env[key]) process.env[key] = val;
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

// === Express App ===
const app = express();

// Block access to sensitive files
const SENSITIVE_FILES = ['server.js', 'package.json', 'sa-key.json', '.env', 'sa-key.json.README'];
app.use((req, res, next) => {
  const basename = path.basename(req.path);
  if (SENSITIVE_FILES.includes(basename)) {
    return res.status(404).send('Not Found');
  }
  next();
});

// Serve only static front-end files
app.use(express.static(path.join(__dirname), { index: 'index.html' }));

// === Google Auth (SA-only) ===
let authClient = null;
let saEmail = '';

async function initAuth() {
  if (!fs.existsSync(SA_KEY_PATH)) {
    console.error('❌ Service Account key file NOT found at:', SA_KEY_PATH);
    console.error('   Please place your sa-key.json file in the project directory.');
    process.exit(1);
  }

  try {
    const keyFile = JSON.parse(fs.readFileSync(SA_KEY_PATH, 'utf8'));
    saEmail = keyFile.client_email;

    authClient = new GoogleAuth({
      keyFile: SA_KEY_PATH,
      scopes: ['https://www.googleapis.com/auth/drive.readonly'],
    });

    const client = await authClient.getClient();
    await client.getAccessToken();

    console.log('✅ Service Account authenticated as:', saEmail);
  } catch (err) {
    console.error('❌ Service Account auth failed:', err.message);
    process.exit(1);
  }
}

async function getAccessToken() {
  if (!authClient) return null;
  const client = await authClient.getClient();
  const { token } = await client.getAccessToken();
  return token;
}

// === API Routes ===

// Status endpoint
app.get('/api/status', (req, res) => {
  res.json({
    mode: 'service-account',
    saEmail,
    folderId: FOLDER_ID || null,
    version: '1.0.0',
  });
});

// List audio files
app.get('/api/files', async (req, res) => {
  const token = await getAccessToken();
  if (!token) return res.status(503).json({ error: 'SA not configured' });

  const folderId = req.query.folderId || FOLDER_ID || null;
  const searchQuery = req.query.search || null;

  let q;
  if (searchQuery) {
    const mimeQuery = AUDIO_MIME_TYPES.map(m => `mimeType='${m}'`).join(' or ');
    q = `(${mimeQuery}) and trashed=false and name contains '${searchQuery}'`;
  } else {
    const mimeQuery = AUDIO_MIME_TYPES.map(m => `mimeType='${m}'`).join(' or ');
    q = `(${mimeQuery}) and trashed=false`;
    if (folderId) q += ` and '${folderId}' in parents`;
  }

  const params = new URLSearchParams({
    q,
    fields: 'files(id,name,mimeType,size,modifiedTime),nextPageToken',
    orderBy: 'name',
    pageSize: '200',
  });

  if (req.query.pageToken) params.set('pageToken', req.query.pageToken);

  try {
    const response = await fetch(`${DRIVE_API_BASE}/files?${params}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!response.ok) {
      const body = await response.text();
      return res.status(response.status).json({ error: 'Drive API error', detail: body });
    }
    res.json(await response.json());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// List folders
app.get('/api/folders', async (req, res) => {
  const token = await getAccessToken();
  if (!token) return res.status(503).json({ error: 'SA not configured' });

  const parentId = req.query.parentId || null;
  let q = `mimeType='application/vnd.google-apps.folder' and trashed=false`;
  if (parentId) q += ` and '${parentId}' in parents`;

  const params = new URLSearchParams({
    q,
    fields: 'files(id,name)',
    orderBy: 'name',
    pageSize: '100',
  });

  try {
    const response = await fetch(`${DRIVE_API_BASE}/files?${params}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!response.ok) return res.status(response.status).json({ error: 'Drive API error' });
    res.json(await response.json());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Stream audio file with Range support
app.get('/api/stream/:fileId', async (req, res) => {
  const token = await getAccessToken();
  if (!token) return res.status(503).json({ error: 'SA not configured' });

  const { fileId } = req.params;
  const rangeHeader = req.headers.range;

  try {
    // Get file metadata
    const metaParams = new URLSearchParams({ fields: 'id,name,mimeType,size' });
    const metaResponse = await fetch(`${DRIVE_API_BASE}/files/${fileId}?${metaParams}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!metaResponse.ok) return res.status(metaResponse.status).json({ error: 'File not found' });

    const metadata = await metaResponse.json();
    const fileSize = parseInt(metadata.size, 10);

    // Parse range
    let startByte = 0;
    let endByte = fileSize - 1;

    if (rangeHeader) {
      const m = rangeHeader.match(/bytes=(\d*)-(\d*)/);
      if (m) {
        startByte = m[1] ? parseInt(m[1], 10) : 0;
        endByte = m[2] ? parseInt(m[2], 10) : fileSize - 1;
      }
      if (startByte >= fileSize || endByte >= fileSize) {
        res.status(416).setHeader('Content-Range', `bytes */${fileSize}`);
        return res.end();
      }
    }

    const contentLength = endByte - startByte + 1;

    res.setHeader('Content-Type', metadata.mimeType || 'audio/mpeg');
    res.setHeader('Accept-Ranges', 'bytes');
    res.setHeader('Content-Length', contentLength);
    res.setHeader('Cache-Control', 'public, max-age=3600');

    if (rangeHeader) {
      res.status(206);
      res.setHeader('Content-Range', `bytes ${startByte}-${endByte}/${fileSize}`);
    } else {
      res.status(200);
    }

    // Fetch from Drive with range
    const fetchHeaders = { Authorization: `Bearer ${token}` };
    if (rangeHeader) fetchHeaders.Range = `bytes=${startByte}-${endByte}`;

    const streamResponse = await fetch(
      `${DRIVE_API_BASE}/files/${fileId}?alt=media`,
      { headers: fetchHeaders }
    );

    if (!streamResponse.ok && streamResponse.status !== 206) {
      return res.status(streamResponse.status).json({ error: 'Failed to stream file' });
    }

    // Pipe stream to client
    const nodeStream = Readable.fromWeb(streamResponse.body);
    nodeStream.pipe(res);

    nodeStream.on('error', (err) => {
      console.error('Stream error:', err);
      if (!res.headersSent) res.status(500).json({ error: 'Stream error' });
      else res.end();
    });
  } catch (err) {
    console.error('Stream error:', err);
    if (!res.headersSent) res.status(500).json({ error: err.message });
  }
});

// === Start ===
async function start() {
  console.log('🔧 Initializing CloudTune server...');
  await initAuth();

  app.listen(PORT, () => {
    console.log(`\n🎵 CloudTune server running at http://localhost:${PORT}`);
    console.log(`   SA Email: ${saEmail}`);
    console.log(`   Share your music folder with: ${saEmail}`);
    if (FOLDER_ID) console.log(`   Folder ID: ${FOLDER_ID}`);
    console.log('');
  });
}

start().catch(err => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
