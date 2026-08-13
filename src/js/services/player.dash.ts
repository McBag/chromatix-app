// ======================================================================
// IMPORTS
// ======================================================================

import * as dashjs from 'dashjs';
import type { PlayerInitParams } from 'types/player';
import { resolveTrustedDurationSec } from 'js/utils/trustedDuration';

// ======================================================================
// STATE
// ======================================================================

let audioElement: HTMLAudioElement | null = null;
let mediaPlayer: dashjs.MediaPlayerClass | null = null;
// False until init() completes — guards all methods that require MediaSource.
let supported = false;
// True from unload() or loadTrack() until loadstart fires for the new source.
// Suppresses spurious error events that fire during source transitions.
let isResetting = false;
// True before the first loadTrack() and after any reset() from unload().
// initialize() must be called (not attachSource()) when this flag is set.
let needsReinit = true;
let lastGoodPositionSec = 0;
let expectedDurationSec = 0;
let pendingSeekSec: number | null = null;
let progressHasMoved = false;

// ======================================================================
// INITIALISE
// ======================================================================

export const init = ({
  volumeLevel,
  volumeMuted,
  onLoadStart,
  onCanPlay,
  onEnded,
  onError,
}: PlayerInitParams): void => {
  if (!window.MediaSource) {
    console.warn('%c--- .dash - MediaSource API not available; DASH playback disabled ---', 'color:#2f67d0');
    return;
  }

  if (audioElement) return; // Already initialised

  supported = true;
  console.log('%c--- .dash - init ---', 'color:#2f67d0');

  audioElement = document.createElement('audio');
  audioElement.volume = volumeMuted ? 0 : volumeLevel / 100;
  audioElement.addEventListener('loadstart', () => {
    // New source is loading — clear the flag so subsequent errors are real.
    isResetting = false;
    onLoadStart();
  });
  audioElement.addEventListener('canplay', () => {
    applyPendingSeek();
    onCanPlay();
  });
  audioElement.addEventListener('timeupdate', () => {
    snapshotElementPosition();
  });
  audioElement.addEventListener('ended', () => {
    if (lastGoodPositionSec >= 1.5) {
      const trusted = resolveTrustedDurationSec(audioElement?.duration || 0, expectedDurationSec);
      const pos = audioElement?.currentTime || lastGoodPositionSec;
      if (trusted <= 0 || pos < trusted - 1.5) {
        recoverToSavedPosition(true);
        return;
      }
    }
    onEnded();
  });
  audioElement.addEventListener('error', (event: Event) => {
    if (isResetting) return;
    // Suppress MEDIA_ERR_SRC_NOT_SUPPORTED (code 4) when src is empty — this is
    // a dash.js artifact. Real DASH failures come through the dash.js ERROR event.
    const el = audioElement!;
    if (el.error?.code === 4 /* MEDIA_ERR_SRC_NOT_SUPPORTED */ && !el.src) return;
    onError({ event, playerElement: el });
  });

  mediaPlayer = dashjs.MediaPlayer().create();
  mediaPlayer.updateSettings({
    debug: {
      logLevel: dashjs.Debug.LOG_LEVEL_NONE as dashjs.LogLevel,
    },
  });
  mediaPlayer.on(dashjs.MediaPlayer.events.ERROR, (e: dashjs.ErrorEvent) => {
    console.error('%c--- .dash - dash.js error ---', 'color:#f00', e);
    // Caption errors are non-fatal for audio playback — ignore them.
    if (e.error === 'cc') return;
    // Suppress errors during source transitions (same guard as the audio element error handler).
    if (isResetting) return;
    // Forward to the shared error handler so the user gets a toast notification
    // and playback auto-advances to the next track, consistent with native player errors.
    onError({ event: e as unknown as Event, playerElement: audioElement! });
  });
  // Do not call initialize() here — deferred to the first loadTrack() so the
  // audio element and source are attached in a single operation.
};

// ======================================================================
// UNLOAD
// ======================================================================

export const unload = (): void => {
  if (!mediaPlayer || !audioElement || !supported) return;
  // Calling reset() before initialize() throws "MediaPlayer not initialized!" — skip if idle.
  if (needsReinit) return;
  // reset() stops all network activity and detaches the audio element.
  // Do NOT call initialize() here — it fires a spurious loadstart that would
  // set playerTrackLoaded=true for a non-existent track.
  console.log('%c--- .dash - unload ---', 'color:#2f67d0');
  isResetting = true;
  mediaPlayer.reset();
  needsReinit = true;
  lastGoodPositionSec = 0;
  expectedDurationSec = 0;
  pendingSeekSec = null;
  progressHasMoved = false;
};

// ======================================================================
// LOAD TRACK
// ======================================================================

export const loadTrack = (
  dashSrc: string,
  progress: number = 0,
  play: boolean = true,
  durationMs: number = 0
): void => {
  if (!mediaPlayer || !audioElement || !supported) return;

  expectedDurationSec = durationMs > 0 ? durationMs / 1000 : 0;
  lastGoodPositionSec = progress > 0 ? progress / 1000 : 0;
  pendingSeekSec = progress > 0 ? progress / 1000 : null;
  progressHasMoved = false;

  const startTime = progress > 0 ? progress / 1000 : undefined;

  isResetting = true;

  console.log('%c--- .dash - loadTrack ---', 'color:#2f67d0');

  if (needsReinit) {
    // First load (or after reset) — initialize() re-attaches the audio element.
    mediaPlayer.initialize(audioElement, dashSrc, false, startTime);
    needsReinit = false;
  } else {
    // Subsequent loads — attachSource() is safer than reset()+initialize() in the
    // same call stack, which can silently fail in dash.js 5.x.
    mediaPlayer.attachSource(dashSrc, startTime);
  }

  // Call play() synchronously — dash.js's autoPlay invokes it after async manifest
  // fetch, by which point the browser's user-gesture context may have expired.
  if (play) {
    audioElement.play().catch((_e) => null);
  }
  // isResetting cleared when loadstart fires
};

// ======================================================================
// PLAYBACK CONTROLS
// ======================================================================

export const pause = (): void => {
  snapshotElementPosition();
  if (mediaPlayer && supported) {
    mediaPlayer.pause();
  }
};

export const resume = (): void => {
  recoverToSavedPosition(true);
};

export const restart = (): void => {
  lastGoodPositionSec = 0;
  pendingSeekSec = 0;
  if (mediaPlayer && supported) {
    mediaPlayer.seek(0);
    mediaPlayer.play();
  }
};

// ======================================================================
// VOLUME
// ======================================================================

export const setVolume = (volumeLevel: number): void => {
  if (audioElement) {
    audioElement.volume = volumeLevel / 100;
  }
};

// ======================================================================
// PROGRESS
// ======================================================================

export const setProgress = (progress: number): void => {
  if (!mediaPlayer || !supported) return;
  const target = Math.max(0, progress / 1000);
  lastGoodPositionSec = target;
  pendingSeekSec = target;
  mediaPlayer.seek(target);
};

export const getCurrentProgress = (): number => {
  // Use audioElement.currentTime directly — mediaPlayer.time() throws
  // PLAYBACK_NOT_INITIALIZED_ERROR when the player is not yet initialized.
  if (!audioElement) return 0;
  const live = audioElement.currentTime || 0;
  if (live < 0.5 && lastGoodPositionSec > 1.5) return lastGoodPositionSec;
  if (live > 0) {
    lastGoodPositionSec = live;
    return live;
  }
  return lastGoodPositionSec;
};

export const getCurrentDuration = (): number => {
  if (!audioElement) return expectedDurationSec || 0;
  return resolveTrustedDurationSec(audioElement.duration || 0, expectedDurationSec);
};

export const getCurrentPlayerElement = (): HTMLAudioElement | null => {
  return audioElement;
};

/**
 * Tesla/background recovery for DASH. dash.js has no native keep-alive path;
 * when the OS auto-pauses the element we re-assert play.
 */
export const ensureActivePlayback = (): void => {
  if (!mediaPlayer || !audioElement || !supported || needsReinit) return;
  if (isElementAtTrackEnd()) return;

  if (audioElement.ended) {
    recoverToSavedPosition(true);
    return;
  }

  if ('mediaSession' in navigator) {
    navigator.mediaSession.playbackState = 'playing';
  }

  if (audioElement.paused) {
    try {
      mediaPlayer.play();
    } catch {
      // ignore
    }
    void Promise.resolve(audioElement.play()).catch(() => null);
  }
};

export const isActivePlaybackAudible = (): boolean => {
  if (!audioElement || needsReinit) return false;
  // dash.js uses MediaSource; do not require element.src to be a http URL.
  return !audioElement.paused && !audioElement.ended && audioElement.readyState >= 2;
};

const applyPendingSeek = (): void => {
  if (!audioElement || pendingSeekSec == null) return;
  const target = pendingSeekSec;
  if (Math.abs((audioElement.currentTime || 0) - target) > 0.4 && mediaPlayer && supported) {
    try {
      mediaPlayer.seek(target);
    } catch {
      // not ready
    }
  }
  lastGoodPositionSec = target;
};

const snapshotElementPosition = (): void => {
  if (!audioElement) return;
  const timeSec = audioElement.currentTime;
  if (!Number.isFinite(timeSec) || timeSec < 0) return;
  const trusted = resolveTrustedDurationSec(audioElement.duration || 0, expectedDurationSec);
  if (trusted > 0 && timeSec >= trusted - 0.15 && lastGoodPositionSec + 2 < trusted) return;
  if (timeSec < 0.25 && lastGoodPositionSec > 1.5) return;
  if (timeSec > lastGoodPositionSec + 0.05) progressHasMoved = true;
  lastGoodPositionSec = timeSec;
};

export const recoverToSavedPosition = (play: boolean = true): void => {
  if (!mediaPlayer || !audioElement || !supported || needsReinit) return;
  if (isElementAtTrackEnd()) return;

  const target = pendingSeekSec != null ? pendingSeekSec : lastGoodPositionSec;
  if (target > 0) {
    try {
      mediaPlayer.seek(target);
      audioElement.currentTime = target;
    } catch {
      pendingSeekSec = target;
    }
  }

  if (play) {
    try {
      mediaPlayer.play();
    } catch {
      // ignore
    }
    void Promise.resolve(audioElement.play()).catch(() => null);
  }
};

export const isElementAtTrackEnd = (): boolean => {
  if (!audioElement) return false;
  const trusted = resolveTrustedDurationSec(audioElement.duration || 0, expectedDurationSec);
  const progress = audioElement.currentTime || 0;

  if (audioElement.ended) {
    if (trusted > 0 && progress < trusted - 1) return false;
    if (trusted > 0 && progress >= trusted - 1) return true;
    return !progressHasMoved && lastGoodPositionSec < 1.5;
  }

  if (!trusted || trusted <= 0 || Number.isNaN(trusted)) return false;
  if (progress < 1.5) return false;
  return progress >= trusted - 0.15;
};

export const handleBecameHidden = (): void => {
  if (!audioElement || needsReinit) return;
  if (isElementAtTrackEnd()) return;
  if (audioElement.ended) {
    recoverToSavedPosition(true);
    return;
  }
  ensureActivePlayback();
  // Match native: long re-assert window — Tesla often re-pauses late after minimize.
  [0, 50, 200, 500, 1000, 2000, 4000, 8000, 15000, 30000, 60000, 120000].forEach((delayMs) => {
    window.setTimeout(() => {
      if (!audioElement || needsReinit) return;
      if (isElementAtTrackEnd()) return;
      if (audioElement.paused || !isActivePlaybackAudible()) {
        ensureActivePlayback();
      }
    }, delayMs);
  });
};

export const runBackgroundPlaybackTick = (): boolean => {
  // Returns true when the track has ended and the caller should advance.
  if (!audioElement || needsReinit) return false;
  snapshotElementPosition();
  if (isElementAtTrackEnd()) return true;
  if (audioElement.ended) {
    recoverToSavedPosition(true);
    return false;
  }
  if (audioElement.paused) {
    ensureActivePlayback();
  }
  return false;
};

// ======================================================================
// HELPERS
// ======================================================================

export const isSupported = (): boolean => supported;
