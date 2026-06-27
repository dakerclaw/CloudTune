/**
 * CloudTune - Main Application Module
 * Orchestrates all modules and manages UI interactions
 * 
 * Supports dual auth mode:
 * - Service Account: Backend handles Drive auth, user just specifies folder
 * - OAuth2: User authenticates with Google, direct Drive API access
 */

(function () {
  'use strict';

  const $ = id => document.getElementById(id);

  const dom = {
    loginScreen: $('loginScreen'),
    appScreen: $('appScreen'),
    // Login
    clientIdInput: $('clientIdInput'),
    folderIdInput: $('folderIdInput'),
    loginBtn: $('loginBtn'),
    loginError: $('loginError'),
    // SA mode elements
    saModeSection: $('saModeSection'),
    saEmailDisplay: $('saEmailDisplay'),
    saFolderInput: $('saFolderInput'),
    saConnectBtn: $('saConnectBtn'),
    // OAuth2 mode elements
    oauthModeSection: $('oauthModeSection'),
    // Mode switcher
    modeTabs: document.querySelectorAll('.mode-tab'),
    // Header
    searchInput: $('searchInput'),
    folderBtn: $('folderBtn'),
    settingsBtn: $('settingsBtn'),
    logoutBtn: $('logoutBtn'),
    modeIndicator: $('modeIndicator'),
    // Tabs
    tabBtns: document.querySelectorAll('.tab-btn'),
    songsTab: $('songsTab'),
    playingTab: $('playingTab'),
    // Songs
    loadingState: $('loadingState'),
    emptyState: $('emptyState'),
    songList: $('songList'),
    // Now Playing
    npArt: $('npArt'),
    npIndicator: $('npIndicator'),
    npTitle: $('npTitle'),
    npSubtitle: $('npSubtitle'),
    npCurrentTime: $('npCurrentTime'),
    npDuration: $('npDuration'),
    npProgressBar: $('npProgressBar'),
    npProgressFill: $('npProgressFill'),
    shuffleBtn: $('shuffleBtn'),
    prevBtn: $('prevBtn'),
    playPauseBtn: $('playPauseBtn'),
    playPauseIcon: $('playPauseIcon'),
    nextBtn: $('nextBtn'),
    repeatBtn: $('repeatBtn'),
    repeatIcon: $('repeatIcon'),
    volumeIconBtn: $('volumeIconBtn'),
    volumeIcon: $('volumeIcon'),
    volumeSlider: $('volumeSlider'),
    volumeFill: $('volumeFill'),
    // Player Bar
    playerBar: $('playerBar'),
    pbMiniProgress: $('pbMiniProgress'),
    pbLoading: $('pbLoading'),
    pbArt: $('pbArt'),
    pbTitle: $('pbTitle'),
    pbMeta: $('pbMeta'),
    pbInfo: $('pbInfo'),
    pbPlayBtn: $('pbPlayBtn'),
    pbPlayIcon: $('pbPlayIcon'),
    pbPrevBtn: $('pbPrevBtn'),
    pbNextBtn: $('pbNextBtn'),
    // Settings Modal
    settingsModal: $('settingsModal'),
    settingsClientId: $('settingsClientId'),
    settingsFolderId: $('settingsFolderId'),
    settingsAuthMode: $('settingsAuthMode'),
    saveSettingsBtn: $('saveSettingsBtn'),
    cancelSettingsBtn: $('cancelSettingsBtn'),
    // Folder Modal
    folderModal: $('folderModal'),
    folderList: $('folderList'),
    allFilesBtn: $('allFilesBtn'),
    closeFolderBtn: $('closeFolderBtn'),
    // Toast
    toastContainer: $('toastContainer'),
  };

  let currentTab = 'songs';
  let searchTimeout = null;
  let allFiles = [];

  // === Initialize ===
  async function init() {
    Player.init();
    Player.setCallbacks({
      stateChange: onPlayerStateChange,
      timeUpdate: onPlayerTimeUpdate,
      trackChange: onTrackChange,
      error: onPlayerError,
    });

    bindEvents();

    // Detect auth mode
    const mode = await Drive.detectMode();

    if (mode === 'service-account') {
      // SA mode available - configure login screen for SA
      setupSAMode();
    } else {
      // No backend - use OAuth2 mode
      setupOAuth2Mode();
    }

    console.log('CloudTune initialized, mode:', Config.getEffectiveMode());
  }

  // === Mode Setup ===

  function setupSAMode() {
    const status = Drive.getBackendStatus();

    // Show SA mode section, hide OAuth2 section
    if (dom.saModeSection) dom.saModeSection.style.display = 'block';
    if (dom.oauthModeSection) dom.oauthModeSection.style.display = 'none';

    // Show SA email
    if (dom.saEmailDisplay && status.saEmail) {
      dom.saEmailDisplay.textContent = status.saEmail;
    }

    // Set folder ID from backend config or saved config
    if (status.folderId) {
      if (dom.saFolderInput) dom.saFolderInput.value = status.folderId;
    } else if (Config.get('folderId')) {
      if (dom.saFolderInput) dom.saFolderInput.value = Config.get('folderId');
    }

    // Enable SA connect button
    if (dom.saConnectBtn) {
      dom.saConnectBtn.disabled = !dom.saFolderInput?.value.trim();
    }

    // Auto-hide login screen if folder is already configured
    if (Config.get('folderId')) {
      Auth.init(); // SA mode init
      Auth.login(); // SA mode "login" (just dispatches success event)
    }
  }

  function setupOAuth2Mode() {
    // Show OAuth2 section, hide SA section
    if (dom.saModeSection) dom.saModeSection.style.display = 'none';
    if (dom.oauthModeSection) dom.oauthModeSection.style.display = 'block';

    const savedClientId = Config.get('clientId');
    const savedFolderId = Config.get('folderId');

    if (savedClientId) {
      dom.clientIdInput.value = savedClientId;
      dom.loginBtn.disabled = false;
    }
    if (savedFolderId) {
      dom.folderIdInput.value = savedFolderId;
    }
  }

  // === Event Binding ===

  function bindEvents() {
    // Auth events
    window.addEventListener('auth-success', onAuthSuccess);
    window.addEventListener('auth-error', onAuthError);
    window.addEventListener('auth-logout', onAuthLogout);
    window.addEventListener('files-loaded', onFilesLoaded);
    window.addEventListener('drive-error', onDriveError);

    // SA mode events
    if (dom.saFolderInput) {
      dom.saFolderInput.addEventListener('input', () => {
        if (dom.saConnectBtn) {
          dom.saConnectBtn.disabled = !dom.saFolderInput.value.trim();
        }
      });
    }
    if (dom.saConnectBtn) {
      dom.saConnectBtn.addEventListener('click', onSAConnect);
    }

    // OAuth2 events
    dom.clientIdInput.addEventListener('input', onClientIdInput);
    dom.loginBtn.addEventListener('click', onLogin);

    // Header
    dom.searchInput.addEventListener('input', onSearchInput);
    dom.folderBtn.addEventListener('click', onFolderClick);
    dom.settingsBtn.addEventListener('click', onSettingsClick);
    dom.logoutBtn.addEventListener('click', onLogout);

    // Tabs
    dom.tabBtns.forEach(btn => {
      btn.addEventListener('click', () => switchTab(btn.dataset.tab));
    });

    // Player controls
    dom.playPauseBtn.addEventListener('click', () => Player.togglePlay());
    dom.prevBtn.addEventListener('click', () => Player.previous());
    dom.nextBtn.addEventListener('click', () => Player.next());
    dom.shuffleBtn.addEventListener('click', () => Player.toggleShuffle());
    dom.repeatBtn.addEventListener('click', () => Player.cycleRepeatMode());
    dom.npProgressBar.addEventListener('click', onProgressClick);
    dom.volumeIconBtn.addEventListener('click', () => Player.toggleMute());
    dom.volumeSlider.addEventListener('click', onVolumeClick);

    // Player bar
    dom.pbPlayBtn.addEventListener('click', () => Player.togglePlay());
    dom.pbPrevBtn.addEventListener('click', () => Player.previous());
    dom.pbNextBtn.addEventListener('click', () => Player.next());
    dom.pbInfo.addEventListener('click', () => switchTab('playing'));
    dom.pbArt.addEventListener('click', () => switchTab('playing'));

    // Settings
    dom.saveSettingsBtn.addEventListener('click', onSaveSettings);
    dom.cancelSettingsBtn.addEventListener('click', closeSettingsModal);

    // Folder modal
    dom.allFilesBtn.addEventListener('click', () => {
      Config.set('folderId', '');
      loadFiles();
      closeFolderModal();
    });
    dom.closeFolderBtn.addEventListener('click', closeFolderModal);

    // Modal overlay close
    dom.settingsModal.addEventListener('click', (e) => {
      if (e.target === dom.settingsModal) closeSettingsModal();
    });
    dom.folderModal.addEventListener('click', (e) => {
      if (e.target === dom.folderModal) closeFolderModal();
    });

    // Keyboard
    document.addEventListener('keydown', onKeydown);
  }

  // === SA Mode Login ===

  function onSAConnect() {
    const folderId = dom.saFolderInput?.value.trim();
    if (!folderId) {
      showLoginError('请输入 Google Drive 文件夹 ID');
      return;
    }

    Config.set('folderId', folderId);
    dom.loginError.style.display = 'none';

    Auth.init();
    Auth.login();
  }

  // === OAuth2 Login ===

  function onClientIdInput() {
    const value = dom.clientIdInput.value.trim();
    dom.loginBtn.disabled = !value;
    Config.set('clientId', value);
  }

  function onLogin() {
    const clientId = dom.clientIdInput.value.trim();
    const folderId = dom.folderIdInput.value.trim();
    if (!clientId) {
      showLoginError('请输入 Google Client ID');
      return;
    }

    Config.update({ clientId, folderId });
    dom.loginError.style.display = 'none';
    dom.loginBtn.disabled = true;

    Auth.init();
    Auth.login();
  }

  // === Auth Event Handlers ===

  function onAuthSuccess(e) {
    dom.loginBtn.disabled = false;
    const mode = e.detail?.mode || Config.getEffectiveMode();

    showAppScreen();

    // Update mode indicator
    if (dom.modeIndicator) {
      dom.modeIndicator.textContent = mode === 'service-account' ? 'SA' : 'OAuth2';
      dom.modeIndicator.style.background = mode === 'service-account' ? '#22c55e' : '#7c5cfc';
    }

    loadFiles();
  }

  function onAuthError(e) {
    dom.loginBtn.disabled = false;
    const msg = e.detail?.error?.message || e.detail?.error || '认证失败，请重试';
    showLoginError(msg);
  }

  function onAuthLogout() {
    showLoginScreen();
    Player.destroy();
  }

  function showLoginError(msg) {
    dom.loginError.textContent = msg;
    dom.loginError.style.display = 'block';
  }

  // === Screen Switching ===

  function showAppScreen() {
    dom.loginScreen.classList.remove('active');
    dom.appScreen.classList.add('active');
  }

  function showLoginScreen() {
    dom.appScreen.classList.remove('active');
    dom.loginScreen.classList.add('active');
  }

  // === Tab Switching ===

  function switchTab(tab) {
    currentTab = tab;
    dom.tabBtns.forEach(btn => btn.classList.toggle('active', btn.dataset.tab === tab));

    if (tab === 'songs') {
      dom.songsTab.classList.add('active');
      dom.songsTab.style.display = '';
      dom.playingTab.classList.remove('active');
      dom.playingTab.style.display = 'none';
    } else {
      dom.songsTab.classList.remove('active');
      dom.songsTab.style.display = 'none';
      dom.playingTab.classList.add('active');
      dom.playingTab.style.display = 'flex';
    }
  }

  // === File Loading ===

  async function loadFiles() {
    const folderId = Config.get('folderId') || null;

    dom.loadingState.style.display = 'flex';
    dom.emptyState.style.display = 'none';
    dom.songList.innerHTML = '';

    try {
      allFiles = await Drive.listAudioFiles(folderId);
      renderSongList(allFiles);
    } catch (error) {
      dom.loadingState.style.display = 'none';
      dom.emptyState.style.display = 'flex';
      showToast('加载失败: ' + error.message, 'error');
    }
  }

  function onFilesLoaded(e) {
    dom.loadingState.style.display = 'none';
    const files = e.detail.files;
    if (files.length === 0) {
      dom.emptyState.style.display = 'flex';
    } else {
      renderSongList(files);
    }
  }

  function onDriveError(e) {
    dom.loadingState.style.display = 'none';
    showToast('Drive 错误: ' + e.detail.error.message, 'error');
  }

  // === Song List ===

  function renderSongList(files) {
    dom.songList.innerHTML = '';
    dom.loadingState.style.display = 'none';

    if (files.length === 0) {
      dom.emptyState.style.display = 'flex';
      return;
    }

    dom.emptyState.style.display = 'none';
    files.forEach((file, index) => {
      dom.songList.appendChild(createSongItem(file, index));
    });
    updateActiveSong();
  }

  function createSongItem(file, index) {
    const div = document.createElement('div');
    div.className = 'song-item';
    div.dataset.index = index;
    div.dataset.fileId = file.id;

    const colors = Drive.getColorFromName(file.name);
    const displayName = Drive.formatFileName(file.name);
    const fileSize = Drive.formatSize(parseInt(file.size));

    div.innerHTML = `
      <span class="song-index">${index + 1}</span>
      <div class="song-art" style="background:${colors.primary}">
        <svg viewBox="0 0 24 24" width="20" height="20" fill="white"><path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z"/></svg>
      </div>
      <div class="song-info">
        <span class="song-name">${displayName}</span>
        <div class="song-meta">
          <span>${fileSize}</span>
          <span>${file.mimeType.split('/').pop()}</span>
        </div>
      </div>
    `;

    div.addEventListener('click', () => {
      Player.setPlaylist(allFiles, index);
      switchTab('playing');
    });
    return div;
  }

  function updateActiveSong() {
    const currentIndex = Player.getCurrentIndex();
    const isPlaying = Player.getState().isPlaying;
    dom.songList.querySelectorAll('.song-item').forEach((item, i) => {
      item.classList.remove('active', 'playing');
      if (i === currentIndex) {
        item.classList.add('active');
        if (isPlaying) item.classList.add('playing');
      }
    });
  }

  // === Search ===

  function onSearchInput() {
    const query = dom.searchInput.value.trim();
    clearTimeout(searchTimeout);
    searchTimeout = setTimeout(() => {
      if (!query) {
        renderSongList(allFiles);
        return;
      }
      const filtered = allFiles.filter(f =>
        Drive.formatFileName(f.name).toLowerCase().includes(query.toLowerCase())
      );
      if (filtered.length > 0) {
        renderSongList(filtered);
      } else {
        Drive.searchFiles(query).then(files => renderSongList(files)).catch(() => showToast('搜索失败', 'error'));
      }
    }, 300);
  }

  // === Player State Updates ===

  function onPlayerStateChange(state) {
    const playPath = 'M8 5v14l11-7z';
    const pausePath = 'M6 19h4V5H6v14zm8-14v14h4V5h-4z';

    dom.playPauseIcon.innerHTML = `<path d="${state.isPlaying ? pausePath : playPath}"/>`;
    dom.pbPlayIcon.innerHTML = `<path d="${state.isPlaying ? pausePath : playPath}"/>`;
    dom.pbLoading.style.display = state.isLoading ? 'block' : 'none';
    dom.shuffleBtn.classList.toggle('active', state.isShuffle);
    dom.repeatBtn.classList.toggle('active', state.repeatMode !== 'none');

    const repeatBasePath = 'M7 7h10v3l4-4-4-4v3H5v6h2V7zm10 10H7v-3l-4 4 4 4v-3h12v-6h-2v4z';
    if (state.repeatMode === 'one') {
      dom.repeatIcon.innerHTML = `<path d="${repeatBasePath}"/><text x="12" y="15" font-size="7" fill="currentColor" text-anchor="middle" font-family="sans-serif">1</text>`;
    } else {
      dom.repeatIcon.innerHTML = `<path d="${repeatBasePath}"/>`;
    }

    dom.volumeFill.style.width = `${(state.isMuted ? 0 : state.volume) * 100}%`;
    updateVolumeIcon(state.isMuted ? 0 : state.volume);
    dom.playerBar.classList.toggle('no-track', !state.currentTrack);
    dom.npIndicator.style.display = state.isPlaying ? 'flex' : 'none';
    dom.npArt.classList.toggle('paused', !state.isPlaying);
    updateActiveSong();
  }

  function onPlayerTimeUpdate(timeInfo) {
    dom.npProgressFill.style.width = `${timeInfo.progress}%`;
    dom.npCurrentTime.textContent = formatTime(timeInfo.currentTime);
    dom.npDuration.textContent = timeInfo.duration ? formatTime(timeInfo.duration) : '--:--';
    dom.pbMiniProgress.style.width = `${timeInfo.progress}%`;
  }

  function onTrackChange(track, index) {
    if (!track) return;
    const colors = Drive.getColorFromName(track.name);
    const displayName = Drive.formatFileName(track.name);

    dom.npTitle.textContent = displayName;
    dom.npSubtitle.textContent = Drive.formatSize(parseInt(track.size)) + ' · ' + track.mimeType.split('/').pop();
    dom.npArt.style.background = `linear-gradient(135deg, ${colors.primary}, ${colors.secondary})`;
    dom.npArt.innerHTML = `
      <svg viewBox="0 0 24 24" width="48" height="48" fill="white"><path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z"/></svg>
      <div class="np-playing-indicator" id="npIndicator">
        <div class="bar"></div><div class="bar"></div><div class="bar"></div><div class="bar"></div>
      </div>
    `;

    dom.pbTitle.textContent = displayName;
    dom.pbMeta.textContent = Drive.formatSize(parseInt(track.size));
    dom.pbArt.style.background = `linear-gradient(135deg, ${colors.primary}, ${colors.secondary})`;
    dom.pbArt.innerHTML = `
      <svg viewBox="0 0 24 24" width="16" height="16" fill="white"><path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z"/></svg>
    `;

    dom.npIndicator = document.getElementById('npIndicator');
    dom.npIndicator.style.display = Player.getState().isPlaying ? 'flex' : 'none';
  }

  function onPlayerError(error) {
    showToast('播放错误: ' + (error.message || '未知错误'), 'error');
  }

  // === Progress & Volume ===

  function onProgressClick(e) {
    const rect = dom.npProgressBar.getBoundingClientRect();
    const percent = ((e.clientX - rect.left) / rect.width) * 100;
    Player.seekByPercent(Math.max(0, Math.min(100, percent)));
  }

  function onVolumeClick(e) {
    const rect = dom.volumeSlider.getBoundingClientRect();
    const percent = ((e.clientX - rect.left) / rect.width);
    Player.setVolume(Math.max(0, Math.min(1, percent)));
  }

  function updateVolumeIcon(volume) {
    let path;
    if (volume === 0) {
      path = 'M16.5 12c0-1.77-1.02-3.29-2.5-4.03v2.21l2.45 2.45c.03-.2.05-.41.05-.63zm2.5 0c0 .94-.2 1.82-.54 2.64l1.51 1.51C20.63 14.91 21 13.5 21 12c0-4.28-2.99-7.86-7-8.77v2.06c2.89.86 5 3.54 5 6.71zM4.27 3L3 4.27 7.73 9H3v6h4l5 5v-6.73l4.25 4.25c-.67.56-1.42 1.01-2.25 1.28v2.06c1.38-.31 2.63-.95 3.69-1.81L19.73 21 21 19.73l-9-9L4.27 3zM12 4L9.91 6.09 12 8.18V4z';
    } else if (volume < 0.5) {
      path = 'M18.5 12c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM5 9v6h4l5 5V4L9 9H5z';
    } else {
      path = 'M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z';
    }
    dom.volumeIcon.innerHTML = `<path d="${path}"/>`;
  }

  // === Settings Modal ===

  function onSettingsClick() {
    dom.settingsClientId.value = Config.get('clientId');
    dom.settingsFolderId.value = Config.get('folderId');
    if (dom.settingsAuthMode) {
      dom.settingsAuthMode.value = Config.get('authMode') || 'auto';
    }
    dom.settingsModal.classList.add('active');
  }

  function onSaveSettings() {
    Config.update({
      clientId: dom.settingsClientId.value.trim(),
      folderId: dom.settingsFolderId.value.trim(),
      authMode: dom.settingsAuthMode?.value || 'auto',
    });
    closeSettingsModal();
    showToast('设置已保存', 'success');

    // Re-detect mode and re-init
    Drive.detectMode().then(mode => {
      Auth.init();
      if (Auth.isAuthenticated()) loadFiles();
    });
  }

  function closeSettingsModal() {
    dom.settingsModal.classList.remove('active');
  }

  // === Folder Modal ===

  async function onFolderClick() {
    dom.folderModal.classList.add('active');
    try {
      const folders = await Drive.listFolders();
      renderFolderList(folders);
    } catch (error) {
      dom.folderList.innerHTML = '<p style="color:var(--text-tertiary);padding:16px;text-align:center">无法加载文件夹列表</p>';
    }
  }

  function renderFolderList(folders) {
    dom.folderList.innerHTML = '';
    if (folders.length === 0) {
      dom.folderList.innerHTML = '<p style="color:var(--text-tertiary);padding:16px;text-align:center">没有找到文件夹</p>';
      return;
    }
    folders.forEach(folder => {
      const item = document.createElement('div');
      item.className = 'folder-item';
      item.innerHTML = `
        <div class="folder-icon">
          <svg viewBox="0 0 24 24" fill="currentColor"><path d="M10 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2h-8l-2-2z"/></svg>
        </div>
        <span class="folder-name">${folder.name}</span>
      `;
      item.addEventListener('click', () => {
        Config.set('folderId', folder.id);
        loadFiles();
        closeFolderModal();
        showToast('已切换到文件夹: ' + folder.name, 'success');
      });
      dom.folderList.appendChild(item);
    });
  }

  function closeFolderModal() {
    dom.folderModal.classList.remove('active');
  }

  function onLogout() {
    if (Config.isServiceAccountMode()) {
      // In SA mode, "logout" just resets folder config and shows login screen
      Config.set('folderId', '');
      showLoginScreen();
      Player.destroy();
    } else {
      Auth.logout();
    }
  }

  // === Keyboard ===

  function onKeydown(e) {
    if (!dom.appScreen.classList.contains('active')) return;
    switch (e.key) {
      case ' ': e.preventDefault(); Player.togglePlay(); break;
      case 'ArrowRight': e.ctrlKey ? Player.next() : Player.seek(Player.getCurrentTime() + 5); break;
      case 'ArrowLeft': e.ctrlKey ? Player.previous() : Player.seek(Player.getCurrentTime() - 5); break;
      case 'ArrowUp': e.preventDefault(); Player.setVolume(Player.getState().volume + 0.05); break;
      case 'ArrowDown': e.preventDefault(); Player.setVolume(Player.getState().volume - 0.05); break;
      case 'm': Player.toggleMute(); break;
      case 's': Player.toggleShuffle(); break;
      case 'r': Player.cycleRepeatMode(); break;
    }
  }

  // === Toast ===

  function showToast(message, type = 'info') {
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.textContent = message;
    dom.toastContainer.appendChild(toast);
    setTimeout(() => {
      toast.classList.add('fade-out');
      setTimeout(() => toast.remove(), 300);
    }, 3000);
  }

  // === Utility ===

  function formatTime(seconds) {
    if (!seconds || seconds < 0) return '0:00';
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${m}:${s.toString().padStart(2, '0')}`;
  }

  // === Init ===
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
