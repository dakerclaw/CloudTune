/**
 * CloudTune - Backend Server
 * 
 * Provides a Service Account-based proxy for Google Drive API,
 * so users don't need to set up OAuth2 credentials.
 * 
 * Usage:
 *   1. Create a Google Cloud project
 *   2. Create a Service Account and download the JSON key file
 *   3. Share your Drive music folder with the SA email
 *   4. Place the key file as "sa-key.json" in this directory
 *   5. Set FOLDER_ID env var (or configure in the app)
 *   6. Run: node server.js
 * 
 * Environment variables:
 *   PORT         - Server port (default: 3000)
 *   FOLDER_ID    - Google Drive folder ID to list audio files from
 *   SA_KEY_PATH  - Path to Service Account JSON key file (default: ./sa-key.json)
 */

const express = require('express');
const path = require('path');
const { GoogleAuth } = require('google-auth-library');
const { Readable } = require('stream');
const fs = require('fs');

// === Configuration ===
const PORT = parseInt(process.env.PORT || '3000', 10);
const FOLDER_ID = process.env.FOLDER_ID || '';
const SA_KEY_PATH = process.env.SA_KEY_PATH || path.join(__dirname, 'sa-key.json');
const DRIVE_API_BASE = 'https://www.googleapis.com/drive/v3';

const AUDIO_MIME_TYPES = [
  'audio/mpeg',
  'audio/mp3',
  'audio/wav',
  'audio/ogg',
  'audio/flac',
  'audio/aac',
  'audio/mp4',
  'audio/x-m4a',
  'audio/webm',
  'audio/amr',
  'audio/x-ms-wma',
  'application/ogg',
];

// === Express App ===
const app = express();

// Serve static frontend files
app.use(express.static(path.join(__dirname)));

// === Google Auth Setup ===
let authClient = null;
let saEmail = '';

async function initAuth() {
  if (!fs.existsSync(SA_KEY_PATH)) {
    console.warn('⚠️  Service Account key file not found at:', SA_KEY_PATH);
    console.warn('   The server will run in "OAuth2-only" mode (no SA proxy).');
    console.warn('   To enable SA mode, place your key file and restart.');
    return null;
  }

  try {
    const keyFile = JSON.parse(fs.readFileSync(SA_KEY_PATH, 'utf8'));
    saEmail = keyFile.client_email;

    authClient = new GoogleAuth({
      keyFile: SA_KEY_PATH,
      scopes: ['https://www.googleapis.com/auth/drive.readonly'],
    });

    // Test auth by getting a token
    const client = await authClient.getClient();
    await client.getAccessToken();

    console.log('✅ Service Account authenticated as:', saEmail);
    return authClient;
  } catch (err) {
    console.error('❌ Service Account auth failed:', err.message);
    console.warn('   The server will run in "OAuth2-only" mode.');
    return null;
  }
}

async function getAccessToken() {
  if (!authClient) return null;
  const client = await authClient.getClient();
  const { token } = await client.getAccessToken();
  return token;
}

// === API Routes ===

// Status endpoint - lets frontend detect SA mode availability
app.get('/api/status', async (req, res) => {
  const hasSA = !!authClient;
  res.json({
    mode: hasSA ? 'service-account' : 'oauth2',
    saEmail: hasSA ? saEmail : null,
    folderId: FOLDER_ID || null,
    version: '1.0.0',
  });
});

// List audio files
app.get('/api/files', async (req, res) => {
  const token = await getAccessToken();
  if (!token) {
    return res.status(503).json({ error: 'Service Account not configured' });
  }

  const folderId = req.query.folderId || FOLDER_ID || null;
  const pageToken = req.query.pageToken || null;
  const searchQuery = req.query.search || null;

  let q;
  if (searchQuery) {
    const mimeQuery = AUDIO_MIME_TYPES.map(m => `mimeType='${m}'`).join(' or ');
    q = `(${mimeQuery}) and trashed=false and name contains '${searchQuery}'`;
  } else {
    const mimeQuery = AUDIO_MIME_TYPES.map(m => `mimeType='${m}'`).join(' or ');
    q = `(${mimeQuery}) and trashed=false`;
    if (folderId) {
      q += ` and '${folderId}' in parents`;
    }
  }

  const params = new URLSearchParams({
    q,
    fields: 'files(id,name,mimeType,size,modifiedTime),nextPageToken',
    orderBy: 'name',
    pageSize: '200',
  });

  if (pageToken) {
    params.set('pageToken', pageToken);
  }

  try {
    const response = await fetch(`${DRIVE_API_BASE}/files?${params}`, {
      headers: { Authorization: `Bearer ${token}` },
    });

    if (!response.ok) {
      const errorBody = await response.text();
      console.error('Drive API error:', response.status, errorBody);
      return res.status(response.status).json({ error: 'Drive API error', status: response.status });
    }

    const data = await response.json();
    res.json(data);
  } catch (err) {
    console.error('Failed to list files:', err);
    res.status(500).json({ error: err.message });
  }
});

// List folders (for browsing)
app.get('/api/folders', async (req, res) => {
  const token = await getAccessToken();
  if (!token) {
    return res.status(503).json({ error: 'Service Account not configured' });
  }

  const parentId = req.query.parentId || null;
  let q = `mimeType='application/vnd.google-apps.folder' and trashed=false`;
  if (parentId) {
    q += ` and '${parentId}' in parents`;
  }

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

    if (!response.ok) {
      return res.status(response.status).json({ error: 'Drive API error' });
    }

    const data = await response.json();
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Stream audio file - supports Range requests for seeking
app.get('/api/stream/:fileId', async (req, res) => {
  const token = await getAccessToken();
  if (!token) {
    return res.status(503).json({ error: 'Service Account not configured' });
  }

  const { fileId } = req.params;
  const rangeHeader = req.headers.range;

  try {
    // First, get file metadata to know the content length
    const metaParams = new URLSearchParams({
      fields: 'id,name,mimeType,size',
    });

    const metaResponse = await fetch(`${DRIVE_API_BASE}/files/${fileId}?${metaParams}`, {
      headers: { Authorization: `Bearer ${token}` },
    });

    if (!metaResponse.ok) {
      return res.status(metaResponse.status).json({ error: 'File not found' });
    }

    const metadata = await metaResponse.json();
    const fileSize = parseInt(metadata.size, 10);

    // Build the Drive API download URL
    const downloadUrl = `${DRIVE_API_BASE}/files/${fileId}?alt=media`;

    // Determine range to fetch
    let startByte = 0;
    let endByte = fileSize - 1;

    if (rangeHeader) {
      const rangeMatch = rangeHeader.match(/bytes=(\d*)-(\d*)/);
      if (rangeMatch) {
        startByte = rangeMatch[1] ? parseInt(rangeMatch[1], 10) : 0;
        endByte = rangeMatch[2] ? parseInt(rangeMatch[2], 10) : fileSize - 1;
      }

      // Validate range
      if (startByte >= fileSize || endByte >= fileSize) {
        res.status(416).setHeader('Content-Range', `bytes */${fileSize}`);
        return res.end();
      }
    }

    const contentLength = endByte - startByte + 1;

    // Set response headers
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

    // Fetch the audio data from Drive (with range if needed)
    const fetchHeaders = { Authorization: `Bearer ${token}` };
    if (rangeHeader) {
      fetchHeaders.Range = `bytes=${startByte}-${endByte}`;
    }

    const streamResponse = await fetch(downloadUrl, { headers: fetchHeaders });

    if (!streamResponse.ok && streamResponse.status !== 206) {
      return res.status(streamResponse.status).json({ error: 'Failed to stream file' });
    }

    // Pipe the stream to the client using Node.js Readable stream
    const nodeStream = Readable.fromWeb(streamResponse.body);
    nodeStream.pipe(res);

    nodeStream.on('error', (err) => {
      console.error('Stream error:', err);
      if (!res.headersSent) {
        res.status(500).json({ error: 'Stream error' });
      } else {
        res.end();
      }
    });

    nodeStream.on('end', () => {
      res.end();
    });
  } catch (err) {
    console.error('Stream error:', err);
    if (!res.headersSent) {
      res.status(500).json({ error: err.message });
    }
  }
});

// === Start Server ===
async function start() {
  console.log('🔧 Initializing CloudTune server...');
  await initAuth();

  app.listen(PORT, () => {
    console.log(`\n🎵 CloudTune server running at http://localhost:${PORT}`);
    console.log(`   Mode: ${authClient ? 'Service Account' : 'OAuth2-only'}`);
    if (authClient) {
      console.log(`   SA Email: ${saEmail}`);
      console.log(`   Share your music folder with: ${saEmail}`);
    }
    if (FOLDER_ID) {
      console.log(`   Folder ID: ${FOLDER_ID}`);
    }
    console.log('');
  });
}

start().catch(err => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
