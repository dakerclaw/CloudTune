/**
 * CloudTune - Main Application Module (SA-only)
 * Backend proxy handles all Drive auth. Frontend only needs folder ID.
 */

(function () {
  'use strict';

  const $ = id => document.getElementById(id);

  const dom = {
    loginScreen: $('loginScreen'),
    appScreen: $('appScreen'),
    saEmailDisplay: $('saEmailDisplay'),
    saFolderInput: $('saFolderInput'),
    saConnectBtn: $('saConnectBtn'),
    loginError: $('loginError'),
    searchInput: $('searchInput'),
    headerSettingsBtn: $('headerSettingsBtn'),
    logoutBtn: $('logoutBtn'),
    tabBtns: document.querySelectorAll('.tab-btn'),
    songsTab: $('songsTab'),
    playingTab: $('playingTab'),
    loadingState: $('loadingState'),
    emptyState: $('emptyState'),
    songList: $('songList'),
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
    settingsModal: $('settingsModal'),
    saEmailDisplay2: $('saEmailDisplay2'),
    settingsFolderId: $('settingsFolderId'),
    saveSettingsBtn: $('saveSettingsBtn'),
    cancelSettingsBtn: $('cancelSettingsBtn'),
    toastContainer: $('toastContainer'),
  };

  let currentTab = 'songs';
  let searchTimeout = null;
  let allFiles = [];
  let allFolders = [];
  let folderStack = [];  // 文件夹导航栈：[{id, name}]

  // === Init ===

  async function init() {
    Player.init();
    Player.setCallbacks({
      stateChange: onPlayerStateChange,
      timeUpdate: onPlayerTimeUpdate,
      trackChange: onTrackChange,
      error: onPlayerError,
    });

    bindEvents();

    const saAvailable = await Drive.detectMode();
    if (!saAvailable) {
      showLoginError('无法连接后端服务器，请确保 server.js 已启动。');
      return;
    }

    setupSAMode();
  }

  // === SA Mode ===

  function setupSAMode() {
    const status = Drive.getBackendStatus();
    if (dom.saEmailDisplay && status.saEmail) {
      dom.saEmailDisplay.textContent = status.saEmail;
    }

    const savedFolder = Config.get('folderId') || status.folderId || '';
    if (dom.saFolderInput) dom.saFolderInput.value = savedFolder;
    if (dom.saConnectBtn) {
      dom.saConnectBtn.disabled = !savedFolder;
    }

    if (savedFolder) enterApp();
  }

  // === Events ===

  function bindEvents() {
    window.addEventListener('files-loaded', onFilesLoaded);
    window.addEventListener('drive-error', onDriveError);

    // Login screen
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

    dom.searchInput.addEventListener('input', onSearchInput);
    if (dom.headerSettingsBtn) {
      dom.headerSettingsBtn.addEventListener('click', onSettingsClick);
    }
    if (dom.logoutBtn) {
      dom.logoutBtn.addEventListener('click', onLogout);
    }

    dom.tabBtns.forEach(btn => {
      btn.addEventListener('click', () => switchTab(btn.dataset.tab));
    });

    dom.playPauseBtn.addEventListener('click', () => Player.togglePlay());
    dom.prevBtn.addEventListener('click', () => Player.previous());
    dom.nextBtn.addEventListener('click', () => Player.next());
    dom.shuffleBtn.addEventListener('click', () => Player.toggleShuffle());
    dom.repeatBtn.addEventListener('click', () => Player.cycleRepeatMode());
    dom.npProgressBar.addEventListener('click', onProgressClick);
    dom.volumeIconBtn.addEventListener('click', () => Player.toggleMute());
    dom.volumeSlider.addEventListener('click', onVolumeClick);

    dom.pbPlayBtn.addEventListener('click', () => Player.togglePlay());
    dom.pbPrevBtn.addEventListener('click', () => Player.previous());
    dom.pbNextBtn.addEventListener('click', () => Player.next());
    dom.pbInfo.addEventListener('click', () => switchTab('playing'));
    dom.pbArt.addEventListener('click', () => switchTab('playing'));

    dom.saveSettingsBtn.addEventListener('click', onSaveSettings);
    dom.cancelSettingsBtn.addEventListener('click', closeSettingsModal);

    dom.settingsModal.addEventListener('click', (e) => {
      if (e.target === dom.settingsModal) closeSettingsModal();
    });
  }

  function onSAConnect() {
    const folderId = dom.saFolderInput?.value.trim();
    if (!folderId) {
      showLoginError('请输入 Google Drive 文件夹 ID');
      return;
    }
    Config.set('folderId', folderId);
    dom.loginError.style.display = 'none';
    enterApp();
  }

  // === Screens ===

  function enterApp() {
    dom.loginScreen.classList.remove('active');
    dom.appScreen.classList.add('active');
    loadFiles();
  }

  function showLoginScreen() {
    dom.appScreen.classList.remove('active');
    dom.loginScreen.classList.add('active');
    Player.destroy();
  }

  function showLoginError(msg) {
    if (dom.loginError) {
      dom.loginError.textContent = msg;
      dom.loginError.style.display = 'block';
    }
  }

  // === Tabs ===

  function switchTab(tab) {
    currentTab = tab;
    dom.tabBtns.forEach(btn => btn.classList.toggle('active', btn.dataset.tab === tab));
    dom.songsTab.classList.toggle('active', tab === 'songs');
    dom.songsTab.style.display = tab === 'songs' ? '' : 'none';
    dom.playingTab.classList.toggle('active', tab === 'playing');
    dom.playingTab.style.display = tab === 'playing' ? 'flex' : 'none';
  }

  // === Files ===

  async function loadFiles() {
    const folderId = folderStack.length > 0 ? folderStack[folderStack.length - 1].id : (Config.get('folderId') || null);
    dom.loadingState.style.display = 'flex';
    dom.emptyState.style.display = 'none';
    dom.songList.innerHTML = '';

    try {
      const [files, folders] = await Promise.all([
        Drive.listAudioFiles(folderId),
        Drive.listFolders(folderId)
      ]);
      allFiles = files;
      allFolders = folders;
      // renderItems is called by onFilesLoaded event listener
    } catch (error) {
      dom.loadingState.style.display = 'none';
      dom.emptyState.style.display = 'flex';
      showToast('加载失败: ' + error.message, 'error');
    }
  }

  function onFilesLoaded(e) {
    dom.loadingState.style.display = 'none';
    // Use already cached allFiles and allFolders
    renderItems();
  }

  function onDriveError(e) {
    dom.loadingState.style.display = 'none';
    showToast('Drive 错误: ' + e.detail.error.message, 'error');
  }

  // === Song List ===

  function renderItems() {
    dom.songList.innerHTML = '';
    dom.loadingState.style.display = 'none';

    const hasFolders = allFolders.length > 0;
    const hasFiles = allFiles.length > 0;

    if (!hasFolders && !hasFiles) {
      dom.emptyState.style.display = 'flex';
      return;
    }

    dom.emptyState.style.display = 'none';

    // Render folders first
    allFolders.forEach((folder, index) => {
      dom.songList.appendChild(createFolderItem(folder, index));
    });

    // Then render files
    allFiles.forEach((file, index) => {
      dom.songList.appendChild(createSongItem(file, index));
    });

    updateActiveSong();
    renderBreadcrumb();
  }

  function renderItemsFromList(items) {
    dom.songList.innerHTML = '';
    dom.loadingState.style.display = 'none';
    dom.emptyState.style.display = 'none';

    items.forEach((item, index) => {
      if (item.mimeType === 'application/vnd.google-apps.folder') {
        dom.songList.appendChild(createFolderItem(item, index));
      } else {
        dom.songList.appendChild(createSongItem(item, index));
      }
    });

    updateActiveSong();
  }

  function createFolderItem(folder, index) {
    const div = document.createElement('div');
    div.className = 'song-item folder-item';
    div.dataset.folderId = folder.id;

    div.innerHTML = `
      <span class="song-index"></span>
      <div class="song-art" style="background:#5a3ed8">
        <svg viewBox="0 0 24 24" width="20" height="20" fill="white"><path d="M10 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2h-8l-2-2z"/></svg>
      </div>
      <div class="song-info">
        <span class="song-name">${escapeHtml(folder.name)}</span>
        <div class="song-meta">
          <span>文件夹</span>
        </div>
      </div>
    `;

    div.addEventListener('click', () => {
      navigateToFolder(folder.id, folder.name);
    });
    return div;
  }

  function createSongItem(file, index) {
    const div = document.createElement('div');
    div.className = 'song-item';
    div.dataset.index = index;

    const color = Drive.getColorFromName(file.name);
    const displayName = Drive.formatFileName(file.name);
    const fileSize = Drive.formatSize(parseInt(file.size));

    div.innerHTML = `
      <span class="song-index">${index + 1}</span>
      <div class="song-art" style="background:${color}">
        <svg viewBox="0 0 24 24" width="20" height="20" fill="white"><path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z"/></svg>
      </div>
      <div class="song-info">
        <span class="song-name">${escapeHtml(displayName)}</span>
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

  function navigateToFolder(folderId, folderName) {
    folderStack.push({ id: folderId, name: folderName });
    loadFiles();
  }

  function navigateBack() {
    if (folderStack.length > 0) {
      folderStack.pop();
      loadFiles();
    }
  }

  function navigateToBreadcrumb(index) {
    // index = -1 means root
    if (index === -1) {
      folderStack = [];
    } else {
      folderStack = folderStack.slice(0, index + 1);
    }
    loadFiles();
  }

  function renderBreadcrumb() {
    let breadcrumb = dom.songList.querySelector('.breadcrumb');
    if (!breadcrumb) {
      breadcrumb = document.createElement('div');
      breadcrumb.className = 'breadcrumb';
      dom.songList.insertBefore(breadcrumb, dom.songList.firstChild);
    }

    let html = '<span class="breadcrumb-item" data-index="-1">全部</span>';
    folderStack.forEach((folder, index) => {
      html += `<span class="breadcrumb-sep">/</span>`;
      html += `<span class="breadcrumb-item" data-index="${index}">${escapeHtml(folder.name)}</span>`;
    });
    breadcrumb.innerHTML = html;

    breadcrumb.querySelectorAll('.breadcrumb-item').forEach(item => {
      item.addEventListener('click', (e) => {
        e.stopPropagation();
        navigateToBreadcrumb(parseInt(item.dataset.index));
      });
    });
  }

  function updateActiveSong() {
    const ci = Player.getCurrentIndex();
    const playing = Player.getState().isPlaying;
    dom.songList.querySelectorAll('.song-item').forEach((item, i) => {
      item.classList.remove('active', 'playing');
      if (i === ci) {
        item.classList.add('active');
        if (playing) item.classList.add('playing');
      }
    });
  }

  // === Search ===

  function onSearchInput() {
    const query = dom.searchInput.value.trim().toLowerCase();
    clearTimeout(searchTimeout);
    searchTimeout = setTimeout(() => {
      if (!query) {
        renderItems();
        return;
      }
      const filtered = allFiles.filter(f =>
        Drive.formatFileName(f.name).toLowerCase().includes(query)
      );
      if (filtered.length > 0) {
        // Show filtered files (keep folders visible)
        const combined = [...allFolders, ...filtered];
        renderItemsFromList(combined);
      } else {
        Drive.searchFiles(query).then(files => {
          allFiles = files;
          renderItems();
        }).catch(() => {
          renderItemsFromList([...allFolders, ...filtered]);
        });
      }
    }, 300);
  }

  // === Player UI ===

  function onPlayerStateChange(state) {
    const playPath = 'M8 5v14l11-7z';
    const pausePath = 'M6 19h4V5H6v14zm8-14v14h4V5h-4z';

    dom.playPauseIcon.innerHTML = `<path d="${state.isPlaying ? pausePath : playPath}"/>`;
    dom.pbPlayIcon.innerHTML = `<path d="${state.isPlaying ? pausePath : playPath}"/>`;
    dom.pbLoading.style.display = (state.isPlaying && state.currentTime === 0) ? 'block' : 'none';
    dom.shuffleBtn.classList.toggle('active', state.isShuffle);
    dom.repeatBtn.classList.toggle('active', state.repeatMode !== 'none');

    const rp = 'M7 7h10v3l4-4-4-4v3H5v6h2V7zm10 10H7v-3l-4 4 4 4v-3h12v-6h-2v4z';
    if (state.repeatMode === 'one') {
      dom.repeatIcon.innerHTML = `<path d="${rp}"/><text x="12" y="15" font-size="7" fill="currentColor" text-anchor="middle" font-family="sans-serif">1</text>`;
    } else {
      dom.repeatIcon.innerHTML = `<path d="${rp}"/>`;
    }

    dom.volumeFill.style.width = `${(state.isMuted ? 0 : state.volume) * 100}%`;
    updateVolumeIcon(state.isMuted ? 0 : state.volume);
    dom.playerBar.classList.toggle('no-track', !state.currentTrack);
    dom.npIndicator.style.display = state.isPlaying ? 'flex' : 'none';
    updateActiveSong();
  }

  function onPlayerTimeUpdate(info) {
    dom.npProgressFill.style.width = `${info.progress}%`;
    dom.npCurrentTime.textContent = formatTime(info.currentTime);
    dom.npDuration.textContent = info.duration ? formatTime(info.duration) : '--:--';
    dom.pbMiniProgress.style.width = `${info.progress}%`;
  }

  function onTrackChange(track) {
    if (!track) return;
    const color = Drive.getColorFromName(track.name);
    const displayName = Drive.formatFileName(track.name);

    dom.npTitle.textContent = displayName;
    dom.npSubtitle.textContent = Drive.formatSize(parseInt(track.size)) + ' · ' + track.mimeType.split('/').pop();
    dom.npArt.style.background = `linear-gradient(135deg, ${color}, #1a0a2e)`;

    dom.pbTitle.textContent = displayName;
    dom.pbMeta.textContent = Drive.formatSize(parseInt(track.size));
    dom.pbArt.style.background = `linear-gradient(135deg, ${color}, #1a0a2e)`;
  }

  function onPlayerError(error) {
    showToast('播放错误: ' + (error.message || '未知错误'), 'error');
  }

  // === Progress & Volume ===

  function onProgressClick(e) {
    const rect = dom.npProgressBar.getBoundingClientRect();
    const pct = ((e.clientX - rect.left) / rect.width) * 100;
    Player.seekByPercent(Math.max(0, Math.min(100, pct)));
  }

  function onVolumeClick(e) {
    const rect = dom.volumeSlider.getBoundingClientRect();
    const pct = (e.clientX - rect.left) / rect.width;
    Player.setVolume(Math.max(0, Math.min(1, pct)));
  }

  function updateVolumeIcon(vol) {
    let path;
    if (vol === 0) {
      path = 'M16.5 12c0-1.77-1.02-3.29-2.5-4.03v2.21l2.45 2.45c.03-.2.05-.41.05-.63zm2.5 0c0 .94-.2 1.82-.54 2.64l1.51 1.51C20.63 14.91 21 13.5 21 12c0-4.28-2.99-7.86-7-8.77v2.06c2.89.86 5 3.54 5 6.71zM4.27 3L3 4.27 7.73 9H3v6h4l5 5v-6.73l4.25 4.25c-.67.56-1.42 1.01-2.25 1.28v2.06c1.38-.31 2.63-.95 3.69-1.81L19.73 21 21 19.73l-9-9L4.27 3zM12 4L9.91 6.09 12 8.18V4z';
    } else if (vol < 0.5) {
      path = 'M18.5 12c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM5 9v6h4l5 5V4L9 9H5z';
    } else {
      path = 'M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z';
    }
    dom.volumeIcon.innerHTML = `<path d="${path}"/>`;
  }

  // === Settings ===

  function onSettingsClick() {
    dom.settingsFolderId.value = Config.get('folderId') || '';
    // Populate SA email in settings modal
    const status = Drive.getBackendStatus();
    if (dom.saEmailDisplay2 && status.saEmail) {
      dom.saEmailDisplay2.textContent = status.saEmail;
    }
    dom.settingsModal.classList.add('active');
  }

  function onSaveSettings() {
    const folderId = dom.settingsFolderId.value.trim();
    Config.set('folderId', folderId);
    if (dom.saFolderInput) dom.saFolderInput.value = folderId;
    closeSettingsModal();
    showToast('设置已保存', 'success');
    loadFiles();
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
    } catch {
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
        <span class="folder-name">${escapeHtml(folder.name)}</span>
      `;
      item.addEventListener('click', () => {
        Config.set('folderId', folder.id);
        if (dom.saFolderInput) dom.saFolderInput.value = folder.id;
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

  // === Logout ===

  function onLogout() {
    Config.set('folderId', '');
    showLoginScreen();
    Player.destroy();
  }

  // === Keyboard ===

  function onKeydown(e) {
    if (!dom.appScreen.classList.contains('active')) return;
    if (e.key === ' ') { e.preventDefault(); Player.togglePlay(); }
    else if (e.key === 'ArrowRight') { e.ctrlKey ? Player.next() : Player.seekBy(5); }
    else if (e.key === 'ArrowLeft') { e.ctrlKey ? Player.previous() : Player.seekBy(-5); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); Player.setVolume(Player.getState().volume + 0.05); }
    else if (e.key === 'ArrowDown') { e.preventDefault(); Player.setVolume(Player.getState().volume - 0.05); }
    else if (e.key === 'm') { Player.toggleMute(); }
    else if (e.key === 's') { Player.toggleShuffle(); }
    else if (e.key === 'r') { Player.cycleRepeatMode(); }
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

  // === Util ===

  function formatTime(secs) {
    if (!secs || secs < 0) return '0:00';
    const m = Math.floor(secs / 60);
    const s = Math.floor(secs % 60);
    return `${m}:${s.toString().padStart(2, '0')}`;
  }

  function escapeHtml(s) {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  // === Boot ===
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
