/**
 * CloudTune - Google Drive Module (SA-only)
 * All Drive API requests go through the backend proxy (/api/*).
 */

const Drive = (() => {
  const AUDIO_MIME_TYPES = [
    'audio/mpeg','audio/mp3','audio/wav','audio/ogg',
    'audio/flac','audio/aac','audio/mp4','audio/x-m4a',
    'audio/webm','audio/amr','audio/x-ms-wma','application/ogg',
  ];

  let cachedFiles = [];
  let cachedFolders = [];
  let currentFolderId = null;
  let backendStatus = null;

  // === Mode Detection ===

  async function detectMode() {
    try {
      const response = await fetch('/api/status', { signal: AbortSignal.timeout(3000) });
      if (response.ok) {
        backendStatus = await response.json();
        return backendStatus.mode === 'service-account';
      }
    } catch (e) {
      console.error('Backend not available:', e.message);
    }
    return false;
  }

  // === List Audio Files ===

  async function listAudioFiles(folderId = null) {
    currentFolderId = folderId;
    const params = new URLSearchParams();
    if (folderId) params.set('folderId', folderId);

    try {
      const response = await fetch(`/api/files?${params}`);
      if (!response.ok) throw new Error(`Backend API error: ${response.status}`);
      const data = await response.json();
      cachedFiles = data.files || [];
      window.dispatchEvent(new CustomEvent('files-loaded', { detail: { files: cachedFiles } }));
      return cachedFiles;
    } catch (error) {
      console.error('Failed to list audio files:', error);
      window.dispatchEvent(new CustomEvent('drive-error', { detail: { error } }));
      throw error;
    }
  }

  // === List Folders ===

  async function listFolders(parentId = null) {
    const params = new URLSearchParams();
    if (parentId) params.set('parentId', parentId);

    try {
      const response = await fetch(`/api/folders?${params}`);
      if (!response.ok) throw new Error(`Backend API error: ${response.status}`);
      const data = await response.json();
      cachedFolders = data.folders || [];
      return cachedFolders;
    } catch (error) {
      console.error('Failed to list folders:', error);
      throw error;
    }
  }

  // === Audio Streaming ===

  function getStreamUrl(fileId) {
    return `/api/stream/${fileId}`;
  }

  // === Search ===

  async function searchFiles(queryText) {
    const params = new URLSearchParams({ search: queryText });
    try {
      const response = await fetch(`/api/files?${params}`);
      if (!response.ok) throw new Error(`Backend API error: ${response.status}`);
      const data = await response.json();
      return data.files || [];
    } catch (error) {
      console.error('Search failed:', error);
      throw error;
    }
  }

  // === Utility Functions ===

  function getCachedFiles() { return cachedFiles; }
  function getCachedFolders() { return cachedFolders; }
  function getCurrentFolder() { return currentFolderId; }
  function getBackendStatus() { return backendStatus; }

  function formatSize(bytes) {
    if (!bytes) return '';
    const units = ['B', 'KB', 'MB', 'GB'];
    let i = 0, size = bytes;
    while (size >= 1024 && i < units.length - 1) { size /= 1024; i++; }
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
    return `hsl(${hue}, 65%, 55%)`;
  }

  return {
    detectMode,
    listAudioFiles,
    listFolders,
    getStreamUrl,
    searchFiles,
    getCachedFiles,
    getCachedFolders,
    getCurrentFolder,
    getBackendStatus,
    formatSize,
    formatFileName,
    getColorFromName,
  };
})();
