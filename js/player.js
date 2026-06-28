/**
 * CloudTune - Audio Player Module (SA-only)
 * Uses backend stream URL with Range request support for seeking.
 */

const Player = (() => {
  let audio = null;
  let playlist = [];
  let currentIndex = -1;
  let isPlaying = false;
  let isShuffle = false;
  let repeatMode = 'none'; // 'none' | 'all' | 'one'
  let volume = 1;
  let isMuted = false;

  let onStateChange = null;
  let onTimeUpdate = null;
  let onTrackChange = null;
  let onError = null;

  function init() {
    audio = new Audio();
    audio.preload = 'auto';
    audio.volume = volume;

    audio.addEventListener('play', () => { isPlaying = true; notifyStateChange(); });
    audio.addEventListener('pause', () => { isPlaying = false; notifyStateChange(); });

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
      notifyStateChange();
      if (onTimeUpdate) {
        onTimeUpdate({ currentTime: audio.currentTime, duration: audio.duration, progress: 0 });
      }
    });

    audio.addEventListener('ended', () => handleTrackEnd());

    audio.addEventListener('error', (e) => {
      console.error('Audio error:', e);
      if (onError) onError(e);
      notifyStateChange();
    });

    audio.addEventListener('waiting', () => notifyStateChange());
    audio.addEventListener('canplay', () => notifyStateChange());

    const savedVolume = Config.get('volume');
    if (savedVolume !== undefined) {
      volume = savedVolume;
      audio.volume = volume;
    }

    console.log('Player module initialized (SA mode)');
  }

  function notifyStateChange() {
    if (onStateChange) {
      onStateChange({
        isPlaying,
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
    if (repeatMode === 'one') {
      audio.currentTime = 0;
      audio.play();
    } else if (repeatMode === 'all') {
      currentIndex = (currentIndex + 1) % playlist.length;
      playCurrent();
    } else {
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

    try {
      const streamUrl = Drive.getStreamUrl(track.id);
      audio.src = streamUrl;
      await audio.play();
      if (onTrackChange) onTrackChange(track, currentIndex);
      Config.set('lastTrackIndex', currentIndex);
    } catch (error) {
      console.error('Failed to play track:', error);
      if (onError) onError(error);
    }
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

  function pause() { if (audio) audio.pause(); }
  function resume() { if (audio && audio.src) audio.play().catch(() => {}); }
  function togglePlay() { isPlaying ? pause() : resume(); }

  function next() {
    if (playlist.length === 0) return;
    if (isShuffle) {
      let ni = currentIndex;
      while (playlist.length > 1 && ni === currentIndex) ni = Math.floor(Math.random() * playlist.length);
      currentIndex = ni;
    } else {
      currentIndex = (currentIndex + 1) % playlist.length;
    }
    playCurrent();
  }

  function previous() {
    if (playlist.length === 0) return;
    if (audio && audio.currentTime > 3) { audio.currentTime = 0; return; }
    if (isShuffle) {
      let ni = currentIndex;
      while (playlist.length > 1 && ni === currentIndex) ni = Math.floor(Math.random() * playlist.length);
      currentIndex = ni;
    } else {
      currentIndex = (currentIndex - 1 + playlist.length) % playlist.length;
    }
    playCurrent();
  }

  /** Seek to a percentage (0-100) of the track */
  function seekByPercent(pct) {
    if (audio && audio.duration) {
      audio.currentTime = Math.min((pct / 100) * audio.duration, audio.duration);
    }
  }

  /** Seek forward/backward by seconds */
  function seekBy(seconds) {
    if (audio && audio.duration) {
      audio.currentTime = Math.max(0, Math.min(audio.duration, audio.currentTime + seconds));
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

  function toggleShuffle() { isShuffle = !isShuffle; notifyStateChange(); }

  function cycleRepeatMode() {
    const modes = ['none', 'all', 'one'];
    repeatMode = modes[(modes.indexOf(repeatMode) + 1) % modes.length];
    notifyStateChange();
  }

  function getCurrentIndex() {
    return currentIndex;
  }

  function getCurrentTrack() {
    return (currentIndex >= 0 && currentIndex < playlist.length) ? playlist[currentIndex] : null;
  }

  function getState() {
    return {
      isPlaying, currentIndex,
      currentTrack: getCurrentTrack(),
      duration: audio ? audio.duration : 0,
      currentTime: audio ? audio.currentTime : 0,
      volume, isMuted, isShuffle, repeatMode,
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
    if (audio) { audio.pause(); audio.src = ''; }
    playlist = [];
    currentIndex = -1;
  }

  return {
    init, setPlaylist, play, pause, resume, togglePlay,
    next, previous,
    seekByPercent, seekBy,
    setVolume, toggleMute,
    toggleShuffle, cycleRepeatMode,
    getCurrentIndex, getCurrentTrack, getState, setCallbacks, destroy,
  };
})();
