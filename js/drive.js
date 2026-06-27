/**
 * CloudTune - Google Drive Module
 * 
 * Dual-mode Drive API client:
 * - Service Account mode: All requests go through backend proxy (/api/*)
 * - OAuth2 mode: Direct Drive API calls with user's access token
 */

const Drive = (() => {
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

  let cachedFiles = [];
  let cachedFolders = [];
  let currentFolderId = null;
  let backendStatus = null;

  // === Mode Detection ===

  function isSA() {
    return Config.isServiceAccountMode();
  }

  /**
   * Detect backend availability and determine auth mode
   */
  async function detectMode() {
    try {
      const response = await fetch('/api/status', {
        signal: AbortSignal.timeout(3000),
      });

      if (response.ok) {
        backendStatus = await response.json();
        if (backendStatus.mode === 'service-account') {
          Config.setDetectedMode('service-account');
          console.log('Drive: Service Account mode detected (backend available)');
          console.log('Drive: SA email:', backendStatus.saEmail);

          // If backend has a configured folder, use it
          if (backendStatus.folderId && !Config.get('folderId')) {
            Config.set('folderId', backendStatus.folderId);
          }
          return 'service-account';
        }
      }
    } catch (e) {
      // Backend not available
      console.log('Drive: Backend not available, falling back to OAuth2 mode');
    }

    Config.setDetectedMode('oauth2');
    return 'oauth2';
  }

  // === Build Query ===

  function buildAudioQuery(folderId) {
    const mimeQuery = AUDIO_MIME_TYPES.map(m => `mimeType='${m}'`).join(' or ');
    let query = `(${mimeQuery}) and trashed=false`;
    if (folderId) {
      query += ` and '${folderId}' in parents`;
    }
    return query;
  }

  // === List Audio Files ===

  async function listAudioFiles(folderId = null) {
    currentFolderId = folderId;

    if (isSA()) {
      return listAudioFilesSA(folderId);
    } else {
      return listAudioFilesOAuth2(folderId);
    }
  }

  async function listAudioFilesSA(folderId) {
    const params = new URLSearchParams();
    if (folderId) params.set('folderId', folderId);

    try {
      const response = await fetch(`/api/files?${params}`);

      if (!response.ok) {
        throw new Error(`Backend API error: ${response.status}`);
      }

      const data = await response.json();
      cachedFiles = data.files || [];

      window.dispatchEvent(new CustomEvent('files-loaded', {
        detail: { files: cachedFiles }
      }));

      return cachedFiles;
    } catch (error) {
      console.error('Failed to list audio files (SA):', error);
      window.dispatchEvent(new CustomEvent('drive-error', {
        detail: { error }
      }));
      throw error;
    }
  }

  async function listAudioFilesOAuth2(folderId) {
    const token = Auth.getToken();
    if (!token) {
      throw new Error('Not authenticated');
    }

    const query = buildAudioQuery(folderId);
    const params = new URLSearchParams({
      q: query,
      fields: 'files(id,name,mimeType,size,modifiedTime,hasThumbnail,thumbnailLink,webContentLink),nextPageToken',
      orderBy: 'name',
      pageSize: '200',
    });

    try {
      const response = await fetch(`${DRIVE_API_BASE}/files?${params}`, {
        headers: { Authorization: `Bearer ${token}` },
      });

      if (!response.ok) {
        if (response.status === 401) {
          Auth.refreshToken();
          throw new Error('Token expired, refreshing...');
        }
        throw new Error(`Drive API error: ${response.status}`);
      }

      const data = await response.json();
      cachedFiles = data.files || [];

      window.dispatchEvent(new CustomEvent('files-loaded', {
        detail: { files: cachedFiles }
      }));

      return cachedFiles;
    } catch (error) {
      console.error('Failed to list audio files (OAuth2):', error);
      window.dispatchEvent(new CustomEvent('drive-error', {
        detail: { error }
      }));
      throw error;
    }
  }

  // === List Folders ===

  async function listFolders(parentId = null) {
    if (isSA()) {
      return listFoldersSA(parentId);
    } else {
      return listFoldersOAuth2(parentId);
    }
  }

  async function listFoldersSA(parentId) {
    const params = new URLSearchParams();
    if (parentId) params.set('parentId', parentId);

    try {
      const response = await fetch(`/api/folders?${params}`);
      if (!response.ok) throw new Error(`Backend API error: ${response.status}`);

      const data = await response.json();
      cachedFolders = data.files || [];
      return cachedFolders;
    } catch (error) {
      console.error('Failed to list folders (SA):', error);
      throw error;
    }
  }

  async function listFoldersOAuth2(parentId) {
    const token = Auth.getToken();
    if (!token) throw new Error('Not authenticated');

    let query = `mimeType='application/vnd.google-apps.folder' and trashed=false`;
    if (parentId) query += ` and '${parentId}' in parents`;

    const params = new URLSearchParams({
      q: query,
      fields: 'files(id,name)',
      orderBy: 'name',
      pageSize: '100',
    });

    try {
      const response = await fetch(`${DRIVE_API_BASE}/files?${params}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!response.ok) throw new Error(`Drive API error: ${response.status}`);

      const data = await response.json();
      cachedFolders = data.files || [];
      return cachedFolders;
    } catch (error) {
      console.error('Failed to list folders (OAuth2):', error);
      throw error;
    }
  }

  // === Audio Streaming ===

  /**
   * Get the playable audio URL for a file
   * - SA mode: Use backend stream endpoint (supports range requests / seeking)
   * - OAuth2 mode: Use blob fetch (downloads entire file)
   */
  async function fetchAudioUrl(fileId) {
    if (isSA()) {
      // Backend stream endpoint - supports Range requests for seeking
      return `/api/stream/${fileId}`;
    } else {
      return fetchAudioBlob(fileId);
    }
  }

  /**
   * OAuth2 mode: Fetch audio as blob and create playable URL
   * (Entire file must be downloaded before playback)
   */
  async function fetchAudioBlob(fileId) {
    const token = Auth.getToken();
    if (!token) throw new Error('Not authenticated');

    try {
      const response = await fetch(`${DRIVE_API_BASE}/files/${fileId}?alt=media`, {
        headers: { Authorization: `Bearer ${token}` },
      });

      if (!response.ok) throw new Error(`Failed to fetch audio: ${response.status}`);

      const blob = await response.blob();
      return URL.createObjectURL(blob);
    } catch (error) {
      console.error('Failed to fetch audio blob:', error);
      throw error;
    }
  }

  // === Search ===

  async function searchFiles(queryText) {
    if (isSA()) {
      try {
        const params = new URLSearchParams({ search: queryText });
        const response = await fetch(`/api/files?${params}`);
        if (!response.ok) throw new Error(`Backend API error: ${response.status}`);
        const data = await response.json();
        return data.files || [];
      } catch (error) {
        console.error('Search failed (SA):', error);
        throw error;
      }
    } else {
      return searchFilesOAuth2(queryText);
    }
  }

  async function searchFilesOAuth2(queryText) {
    const token = Auth.getToken();
    if (!token) throw new Error('Not authenticated');

    const mimeQuery = AUDIO_MIME_TYPES.map(m => `mimeType='${m}'`).join(' or ');
    const q = `(${mimeQuery}) and trashed=false and name contains '${queryText}'`;

    const params = new URLSearchParams({
      q,
      fields: 'files(id,name,mimeType,size,modifiedTime,hasThumbnail,thumbnailLink)',
      orderBy: 'name',
      pageSize: '50',
    });

    const response = await fetch(`${DRIVE_API_BASE}/files?${params}`, {
      headers: { Authorization: `Bearer ${token}` },
    });

    if (!response.ok) throw new Error(`Drive API error: ${response.status}`);

    const data = await response.json();
    return data.files || [];
  }

  // === Utility Functions ===

  function getCachedFiles() { return cachedFiles; }
  function getCachedFolders() { return cachedFolders; }
  function getCurrentFolder() { return currentFolderId; }
  function getBackendStatus() { return backendStatus; }

  function revokeBlobUrl(url) {
    if (url && url.startsWith('blob:')) {
      URL.revokeObjectURL(url);
    }
  }

  function formatSize(bytes) {
    if (!bytes) return '';
    const units = ['B', 'KB', 'MB', 'GB'];
    let i = 0;
    let size = bytes;
    while (size >= 1024 && i < units.length - 1) {
      size /= 1024;
      i++;
    }
    return `${size.toFixed(1)} ${units[i]}`;
  }

  function formatFileName(name) {
    return name.replace(/\.(mp3|wav|ogg|flac|aac|m4a|wma|webm|amr)$/i, '');
  }

  function getColorFromName(name) {
    let hash = 0;
    for (let i = 0; i < name.length; i++) {
      hash = name.charCodeAt(i) + ((hash << 5) - hash);
    }
    const hue = Math.abs(hash % 360);
    const saturation = 60 + (Math.abs(hash >> 8) % 20);
    const lightness = 45 + (Math.abs(hash >> 16) % 15);
    return {
      primary: `hsl(${hue}, ${saturation}%, ${lightness}%)`,
      secondary: `hsl(${hue + 30}, ${saturation - 10}%, ${lightness - 10}%)`,
    };
  }

  return {
    detectMode,
    listAudioFiles,
    listFolders,
    fetchAudioUrl,
    fetchAudioBlob,
    searchFiles,
    getCachedFiles,
    getCachedFolders,
    getCurrentFolder,
    getBackendStatus,
    revokeBlobUrl,
    formatSize,
    formatFileName,
    getColorFromName,
    AUDIO_MIME_TYPES,
  };
})();
