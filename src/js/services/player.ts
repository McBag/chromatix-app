// ======================================================================
// IMPORTS
// ======================================================================

import * as dashX from './player.dash';
import * as nativeX from './player.native';
import type { PlayerInitParams } from 'types/player';
import requiresTranscoding from 'js/utils/requiresTranscoding';

// ======================================================================
// TYPES
// ======================================================================

/** Minimal track shape required by the player router. */
interface PlayerTrack {
  src: string;
  dashSrc?: string | null;
  codec?: string | null;
  trackKey?: string | null;
  duration?: number | null;
}

// ======================================================================
// STATE
// ======================================================================

type ActivePlayer = 'native' | 'dash';

let activePlayer: ActivePlayer = 'native';
let onlineRecoveryBound = false;

// ======================================================================
// INITIALISE / UNLOAD
// ======================================================================

export const init = (params: PlayerInitParams): void => {
  // Each sub-player gets its own callback wrappers that only forward events
  // if that player is currently active. This prevents the inactive player's
  // stale events from affecting playback state (e.g. a spurious loadstart from
  // nativeX while the DASH player is active setting playerLoading unexpectedly).
  nativeX.init({
    ...params,
    onLoadStart: () => {
      if (activePlayer === 'native') params.onLoadStart();
    },
    onCanPlay: () => {
      if (activePlayer === 'native') params.onCanPlay();
    },
    onEnded: () => {
      if (activePlayer === 'native') params.onEnded();
    },
    onError: (e) => {
      if (activePlayer === 'native') params.onError(e);
      // else console.log('%c--- player - native error suppressed (dash is active) ---', 'color:#4c25b9', e);
    },
  });
  if (typeof window !== 'undefined' && !onlineRecoveryBound) {
    onlineRecoveryBound = true;
    window.addEventListener('online', () => {
      recoverToSavedPosition();
    });
  }

  dashX.init({
    ...params,
    onLoadStart: () => {
      if (activePlayer === 'dash') params.onLoadStart();
    },
    onCanPlay: () => {
      if (activePlayer === 'dash') params.onCanPlay();
    },
    onEnded: () => {
      if (activePlayer === 'dash') params.onEnded();
    },
    onError: (e) => {
      if (activePlayer === 'dash') params.onError(e);
      // else console.log('%c--- player - dash error suppressed (native is active) ---', 'color:#4c25b9', e);
    },
  });
};

export const unload = (): void => {
  nativeX.unload();
  dashX.unload();
  activePlayer = 'native';
};

// ======================================================================
// LOAD TRACK
// ======================================================================

/**
 * Load a track and start playback. Returns `false` if the player could not
 * load the track (e.g. a Plex DASH track whose credentials are not yet
 * available), so callers can surface an error state without needing to
 * replicate the routing logic.
 */
export const loadTrack = (track: PlayerTrack, progress: number = 0, play: boolean = true): boolean => {
  const transcoding = requiresTranscoding(track.codec);
  if (transcoding && track.dashSrc && dashX.isSupported()) {
    // Preserve silent Web Audio keep-alive across the native→DASH handoff so
    // Tesla does not drop Bluetooth focus while the DASH manifest loads.
    nativeX.unload({ preserveKeepAlive: true });
    nativeX.setNextTrack(null);
    if (play) nativeX.ensureAudioKeepAlive();
    dashX.loadTrack(track.dashSrc, progress, play, track.duration || 0);
    activePlayer = 'dash';
  } else if (transcoding && !track.dashSrc && track.trackKey && dashX.isSupported()) {
    // Plex track that needs DASH but dashSrc is unavailable — credentials not
    // ready yet. Leave both players idle; Resume will retry with a fresh URL.
    dashX.unload();
    nativeX.unload();
    activePlayer = 'native';
    return false;
  } else {
    // Native path: either codec is supported, or the src URL already embeds
    // server-side transcoding (e.g. Jellyfin universal endpoint).
    dashX.unload();
    nativeX.loadTrack(track.src, progress, play, track.duration || 0);
    activePlayer = 'native';
  }
  return true;
};

export const setNextTrack = (track: PlayerTrack | string | null): void => {
  if (!track) {
    nativeX.setNextTrack(null);
    return;
  }
  if (typeof track === 'string') {
    nativeX.setNextTrack(track);
    return;
  }
  const transcoding = requiresTranscoding(track.codec);
  if (transcoding && track.dashSrc && dashX.isSupported()) {
    // Next item needs DASH — native standby cannot preload it.
    nativeX.setNextTrack(null);
    return;
  }
  if (track.src) {
    nativeX.setNextTrack(track.src);
  } else {
    nativeX.setNextTrack(null);
  }
};

export const maybeWarmStartNext = (): void => {
  if (activePlayer !== 'native') return;
  nativeX.maybeWarmStartNext();
};

// ======================================================================
// PLAYBACK CONTROLS
// ======================================================================

export const pause = (): void => {
  if (activePlayer === 'dash') {
    dashX.pause();
  } else {
    nativeX.pause();
  }
};

export const resume = (): void => {
  if (activePlayer === 'dash') {
    dashX.resume();
  } else {
    nativeX.resume();
  }
};

export const recoverToSavedPosition = (): void => {
  const play = !nativeX.isManualPause();
  if (activePlayer === 'dash') {
    dashX.recoverToSavedPosition(play);
    return;
  }
  nativeX.recoverToSavedPosition(play);
};

export const restart = (): void => {
  if (activePlayer === 'dash') {
    dashX.restart();
  } else {
    nativeX.restart();
  }
};

export const setProgress = (progress: number): void => {
  if (activePlayer === 'dash') {
    dashX.setProgress(progress);
  } else {
    nativeX.setProgress(progress);
  }
};

export const getCurrentProgress = (): number => {
  if (activePlayer === 'dash') {
    return dashX.getCurrentProgress();
  }
  return nativeX.getCurrentProgress();
};

// ======================================================================
// VOLUME
// ======================================================================

export const setVolume = (volumeLevel: number): void => {
  // Both players need to stay in sync so that switching between them
  // doesn't cause a volume change.
  nativeX.setVolume(volumeLevel);
  dashX.setVolume(volumeLevel);
};

// ======================================================================
// TESLA / BACKGROUND PLAYBACK HELPERS
// Native player owns keep-alive; re-export so callers use player.ts only.
// ======================================================================

export const getCurrentPlayerElement = (): HTMLAudioElement | null => {
  if (activePlayer === 'dash') return dashX.getCurrentPlayerElement();
  return nativeX.getCurrentPlayerElement();
};

export const setAdvanceLatchKey = (key: string): void => {
  nativeX.setAdvanceLatchKey(key);
};

export const resetTrackAdvanceLatch = (): void => {
  nativeX.resetTrackAdvanceLatch();
};

export const setTrackEndedCallback = (handler: (() => void) | null): void => {
  nativeX.setTrackEndedCallback(handler);
};

export const requestTrackAdvance = (): void => {
  // Latch + callback live on native regardless of which engine is active.
  nativeX.requestTrackAdvance();
};

export const clearManualPauseFlag = (): void => {
  nativeX.clearManualPauseFlag();
};

export const isManualPause = (): boolean => nativeX.isManualPause();

export const isPlaybackExpected = (): boolean => {
  if (activePlayer === 'dash') return !nativeX.isManualPause();
  return nativeX.isPlaybackExpected();
};

export const ensureActivePlayback = (): void => {
  if (activePlayer === 'dash') {
    if (!nativeX.isManualPause()) dashX.ensureActivePlayback();
    return;
  }
  nativeX.ensureActivePlayback();
};

export const ensureAudioKeepAlive = (): void => {
  // Silent oscillator always lives on native; keep it running for DASH too so
  // Tesla does not hand audio focus to another app between segments.
  if (!nativeX.isManualPause()) nativeX.ensureAudioKeepAlive();
};

export const stopAudioKeepAlive = (): void => {
  nativeX.stopAudioKeepAlive();
};

export const ensureHiddenLoadRecovery = (): void => {
  if (activePlayer === 'dash') {
    if (!nativeX.isManualPause()) dashX.ensureActivePlayback();
    return;
  }
  nativeX.ensureHiddenLoadRecovery();
};

export const isHiddenLoadRecoveryActive = (): boolean => {
  if (activePlayer === 'dash') return false;
  return nativeX.isHiddenLoadRecoveryActive();
};

export const syncHiddenMediaSession = (positionSec?: number, durationSec?: number): void => {
  if (activePlayer === 'dash') {
    if (nativeX.isManualPause() || !('mediaSession' in navigator)) return;
    navigator.mediaSession.playbackState = 'playing';
    if (typeof navigator.mediaSession.setPositionState !== 'function') return;
    const el = dashX.getCurrentPlayerElement();
    const position = positionSec ?? el?.currentTime ?? 0;
    const duration = durationSec ?? el?.duration ?? 0;
    if (duration <= 0 || Number.isNaN(duration)) return;
    try {
      navigator.mediaSession.setPositionState({
        duration,
        position: Math.min(Math.max(position, 0), duration),
        playbackRate: 1,
      });
    } catch {
      // ignore invalid states
    }
    return;
  }
  nativeX.syncHiddenMediaSession(positionSec, durationSec);
};

export const runBackgroundPlaybackTick = (): void => {
  if (activePlayer === 'dash') {
    if (nativeX.isManualPause()) return;
    const ended = dashX.runBackgroundPlaybackTick();
    if (ended) {
      nativeX.requestTrackAdvance();
      return;
    }
    nativeX.ensureAudioKeepAlive();
    return;
  }
  nativeX.runBackgroundPlaybackTick();
};

export const nudgeActivePlayback = (): void => {
  if (activePlayer === 'dash') {
    if (!nativeX.isManualPause()) dashX.ensureActivePlayback();
    return;
  }
  nativeX.nudgeActivePlayback();
};

export const isActivePlaybackAudible = (): boolean => {
  if (activePlayer === 'dash') return dashX.isActivePlaybackAudible();
  return nativeX.isActivePlaybackAudible();
};

export const getPlaybackProgressMs = (): number => {
  if (activePlayer === 'dash') return dashX.getCurrentProgress() * 1000;
  return nativeX.getPlaybackProgressMs();
};

export const getCurrentDuration = (): number => {
  if (activePlayer === 'dash') return dashX.getCurrentDuration();
  return nativeX.getCurrentDuration();
};

export const handleBecameHidden = (): void => {
  if (activePlayer === 'dash') {
    if (!nativeX.isManualPause()) {
      nativeX.ensureAudioKeepAlive();
      dashX.handleBecameHidden();
    }
    return;
  }
  nativeX.handleBecameHidden();
};

// ======================================================================
// NEXT-TRACK PRELOAD
// Native A/B handoff: buffer the next src on a standby <audio> and start it
// ~80ms (visible) / ~320ms (hidden) before the current track ends for gapless
// playback. Hidden Tesla tabs get the slightly earlier start so play() wins
// the JS-freeze-on-ended race without skipping the last seconds of a song.
// ======================================================================

// ======================================================================
// DEBUGGING - BROWSER CONSOLE ACCESS
// ======================================================================

if (import.meta.env.VITE_ENV === 'local') {
  (window as any).__playerX = {
    getCurrentProgress,
    getActivePlayer: () => activePlayer,
  };
}
