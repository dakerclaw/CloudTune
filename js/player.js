/**
 * CloudTune - Audio Player Module
 * 
 * Supports two playback modes:
 * - SA mode: Direct stream URL from backend (supports seeking via Range requests)
 * - OAuth2 mode: Blob URL (must download entire file before playback)
 */

const Player = (() => {
  let audio = null;
  let playlist = [];
  let currentIndex = -1;
  let currentBlobUrl = null;
  let currentStreamUrl = null;
  let isPlaying = false;
  let isShuffle = false;
  let repeatMode = 'none';
  let isLoading = false;
  let volume = 1;
  let isMuted = false;

  let onStateChange = null;
  let onTimeUpdate = null;
  let onTrackChange = null;
  let onError = null;

  function init() {
    audio = new Audio();
    audio.preload = 'metadata';
    audio.volume = volume;

    audio.addEventListener('play', () => {
      isPlaying = true;
      notifyStateChange();
    });

    audio.addEventListener('pause', () => {
      isPlaying = false;
      notifyStateChange();
    });

    audio.addEventListener('timeupdate', () => {
      if (onTimeUpdate) {
        onTimeUpdate({
          currentTime: audio.currentTime,
          duration: audio.duration || 0,
          progress: audio.duration ? (audio.currentTime / audio.duration) * 100 : 0,
        });
      }
    });

    audio.addEventListener('loadedmetadata', () => {
      isLoading = false;
      notifyStateChange();
      if (onTimeUpdate) {
        onTimeUpdate({
          currentTime: audio.currentTime,
          duration: audio.duration,
          progress: 0,
        });
      }
    });

    audio.addEventListener('ended', () => {
      handleTrackEnd();
    });

    audio.addEventListener('error', (e) => {
      isLoading = false;
      isPlaying = false;
      console.error('Audio error:', e);
      if (onError) onError(e);
      notifyStateChange();
    });

    audio.addEventListener('waiting', () => {
      isLoading = true;
      notifyStateChange();
    });

    audio.addEventListener('canplay', () => {
      isLoading = false;
      notifyStateChange();
    });

    const savedVolume = Config.get('volume');
    if (savedVolume !== undefined) {
      volume = savedVolume;
      audio.volume = volume;
    }

    console.log('Player module initialized');
  }

  function notifyStateChange() {
    if (onStateChange) {
      onStateChange({
        isPlaying,
        isLoading,
        currentIndex,
        currentTrack: getCurrentTrack(),
        duration: audio ? audio.duration : 0,
        currentTime: audio ? audio.currentTime : 0,
        volume,
        isMuted,
        isShuffle,
        repeatMode,
      });
    }
  }

  function handleTrackEnd() {
    switch (repeatMode) {
      case 'one':
        playCurrent();
        break;
      case 'all':
        if (currentIndex < playlist.length - 1) {
          next();
        } else {
          currentIndex = 0;
          playCurrent();
        }
        break;
      default:
        if (currentIndex < playlist.length - 1) {
          next();
        } else {
          isPlaying = false;
          notifyStateChange();
        }
    }
  }

  async function playCurrent() {
    if (currentIndex < 0 || currentIndex >= playlist.length) return;

    const track = playlist[currentIndex];
    isLoading = true;
    notifyStateChange();

    // Clean up previous URLs
    cleanupUrls();

    try {
      const isSA = Config.isServiceAccountMode();

      if (isSA) {
        // SA mode: Use backend stream URL directly
        // This supports Range requests and seeking
        currentStreamUrl = `/api/stream/${track.id}`;
        audio.src = currentStreamUrl;
        await audio.play();
      } else {
        // OAuth2 mode: Fetch as blob, then play
        const blobUrl = await Drive.fetchAudioBlob(track.id);
        currentBlobUrl = blobUrl;
        audio.src = blobUrl;
        await audio.play();
      }

      if (onTrackChange) {
        onTrackChange(track, currentIndex);
      }

      Config.set('lastTrackIndex', currentIndex);
    } catch (error) {
      console.error('Failed to play track:', error);
      isLoading = false;
      isPlaying = false;
      notifyStateChange();
      if (onError) onError(error);
    }
  }

  function cleanupUrls() {
    if (currentBlobUrl) {
      Drive.revokeBlobUrl(currentBlobUrl);
      currentBlobUrl = null;
    }
    currentStreamUrl = null;
  }

  function setPlaylist(files, startIndex = 0) {
    playlist = files;
    currentIndex = startIndex;
    if (startIndex >= 0 && startIndex < files.length) {
      playCurrent();
    }
  }

  function play(index) {
    if (index >= 0 && index < playlist.length) {
      currentIndex = index;
      playCurrent();
    }
  }

  function pause() {
    if (audio) audio.pause();
  }

  function resume() {
    if (audio && audio.src && !isPlaying) {
      audio.play().catch(e => console.error('Resume failed:', e));
    }
  }

  function togglePlay() {
    if (isPlaying) pause();
    else resume();
  }

  function next() {
    if (playlist.length === 0) return;
    if (isShuffle) {
      let newIdx = currentIndex;
      if (playlist.length > 1) {
        while (newIdx === currentIndex) {
          newIdx = Math.floor(Math.random() * playlist.length);
        }
      }
      currentIndex = newIdx;
    } else {
      currentIndex = (currentIndex + 1) % playlist.length;
    }
    playCurrent();
  }

  function previous() {
    if (playlist.length === 0) return;
    if (audio && audio.currentTime > 3) {
      audio.currentTime = 0;
      return;
    }
    if (isShuffle) {
      let newIdx = currentIndex;
      if (playlist.length > 1) {
        while (newIdx === currentIndex) {
          newIdx = Math.floor(Math.random() * playlist.length);
        }
      }
      currentIndex = newIdx;
    } else {
      currentIndex = (currentIndex - 1 + playlist.length) % playlist.length;
    }
    playCurrent();
  }

  function seek(time) {
    if (audio && audio.duration) {
      audio.currentTime = Math.min(time, audio.duration);
    }
  }

  function seekByPercent(percent) {
    if (audio && audio.duration) {
      audio.currentTime = (percent / 100) * audio.duration;
    }
  }

  function setVolume(val) {
    volume = Math.max(0, Math.min(1, val));
    if (audio) audio.volume = isMuted ? 0 : volume;
    Config.set('volume', volume);
    notifyStateChange();
  }

  function toggleMute() {
    isMuted = !isMuted;
    if (audio) audio.volume = isMuted ? 0 : volume;
    notifyStateChange();
  }

  function toggleShuffle() {
    isShuffle = !isShuffle;
    notifyStateChange();
  }

  function cycleRepeatMode() {
    const modes = ['none', 'all', 'one'];
    const idx = modes.indexOf(repeatMode);
    repeatMode = modes[(idx + 1) % modes.length];
    notifyStateChange();
  }

  function getCurrentTrack() {
    if (currentIndex >= 0 && currentIndex < playlist.length) {
      return playlist[currentIndex];
    }
    return null;
  }

  function getPlaylist() { return playlist; }
  function getCurrentIndex() { return currentIndex; }
  function getDuration() { return audio ? audio.duration : 0; }
  function getCurrentTime() { return audio ? audio.currentTime : 0; }

  function getState() {
    return {
      isPlaying,
      isLoading,
      currentIndex,
      currentTrack: getCurrentTrack(),
      duration: getDuration(),
      currentTime: getCurrentTime(),
      volume,
      isMuted,
      isShuffle,
      repeatMode,
      playlistLength: playlist.length,
    };
  }

  function setCallbacks({ stateChange, timeUpdate, trackChange, error }) {
    onStateChange = stateChange;
    onTimeUpdate = timeUpdate;
    onTrackChange = trackChange;
    onError = error;
  }

  function destroy() {
    if (audio) {
      audio.pause();
      audio.src = '';
    }
    cleanupUrls();
    playlist = [];
    currentIndex = -1;
  }

  return {
    init,
    setPlaylist,
    play,
    pause,
    resume,
    togglePlay,
    next,
    previous,
    seek,
    seekByPercent,
    setVolume,
    toggleMute,
    toggleShuffle,
    cycleRepeatMode,
    getCurrentTrack,
    getPlaylist,
    getCurrentIndex,
    getDuration,
    getCurrentTime,
    getState,
    setCallbacks,
    destroy,
  };
})();
