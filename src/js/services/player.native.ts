// ======================================================================
// OPTIONS
// ======================================================================

const trackEndPollMs = 250;
const trackEndEpsilonMs = 100;
const playRetryMs = 300;
const hiddenPlayRetryMs = 150;
const hiddenPlayMaxRetries = 12;
const hiddenPlayReloadThreshold = 4;
const hiddenLoadRecoveryMs = 150;
const hiddenLoadRecoveryMaxMs = 120000;
const reloadReadyTimeoutMs = 1500;
const HAVE_CURRENT_DATA = 2;
const HAVE_FUTURE_DATA = 3;
const progressStallMs = 1500;

let playerContainer: HTMLDivElement | null = null;
let trackEndPollId: number | null = null;
let hiddenLoadRecoveryId: number | null = null;
let hiddenLoadRecoveryTimeoutId: number | null = null;
let hiddenLoadRecoveryToken = 0;
let pausedByUser = false;
let activePlayToken = 0;
let onTrackEndedCallback: (() => void) | null = null;
let advanceFired = false;
let hiddenPlayFailCount = 0;
let lastProgressSampleMs = 0;
let lastProgressSampleTime = 0;
let progressHasMoved = false;

// Silent Web Audio keep-alive: keeps the browser audio pipeline open during
// cold-load gaps between tracks so Tesla does not hand focus to another app.
let audioKeepAliveCtx: AudioContext | null = null;
let audioKeepAliveOsc: OscillatorNode | null = null;
let audioKeepAliveGain: GainNode | null = null;

// ======================================================================
// TYPES
// ======================================================================

interface PlayerInitParams {
  volumeLevel: number;
  volumeMuted: boolean;
  onLoadStart: () => void;
  onCanPlay: () => void;
  onEnded: () => void;
  onError: (params: { event: Event; playerElement: HTMLAudioElement }) => void;
}

// ======================================================================
// INITIALISE
// ======================================================================

let playerElement: HTMLAudioElement | null = null;

export const init = ({
  volumeLevel,
  volumeMuted,
  onLoadStart,
  onCanPlay,
  onEnded: _onEnded,
  onError,
}: PlayerInitParams): void => {
  console.log('%c--- player - init ---', 'color:#a18507');
  if (!playerElement) {
    playerElement = document.createElement('audio');
    setupPlayerElement(playerElement, volumeLevel, volumeMuted, onLoadStart, onCanPlay, onError);
    appendPlayerElement();
  }
};

const appendPlayerElement = (): void => {
  if (!playerElement) return;

  if (!playerContainer) {
    playerContainer = document.createElement('div');
    playerContainer.id = 'chromatix-player-elements';
    playerContainer.setAttribute('aria-hidden', 'true');
    playerContainer.style.cssText = 'position:fixed;width:0;height:0;overflow:hidden;opacity:0;pointer-events:none;';
    document.body.appendChild(playerContainer);
  }

  playerElement.setAttribute('playsinline', 'true');
  playerElement.setAttribute('webkit-playsinline', 'true');
  // Hint to Chromium/Tesla that this element is intentional media, not an ad.
  playerElement.setAttribute('controlslist', 'nodownload noplaybackrate');
  if (
    playerElement.parentNode !== playerContainer &&
    playerContainer instanceof Node &&
    playerElement instanceof Node
  ) {
    playerContainer.appendChild(playerElement);
  }
};

const setupPlayerElement = (
  element: HTMLAudioElement,
  volumeLevel: number,
  volumeMuted: boolean,
  onLoadStart: () => void,
  onCanPlay: () => void,
  onError: (params: { event: Event; playerElement: HTMLAudioElement }) => void
): void => {
  element.pause();
  element.volume = volumeMuted ? 0 : volumeLevel / 100;
  element.preload = 'auto';

  element.addEventListener('loadstart', onLoadStart);
  element.addEventListener('canplay', onCanPlay);
  element.addEventListener('ended', () => {
    requestTrackAdvance();
  });
  element.addEventListener('error', (event: Event) => onError({ event, playerElement: element }));
  element.addEventListener('playing', () => {
    if (!pausedByUser) {
      stopHiddenLoadRecovery();
      ensureAudioKeepAlive();
      if (!trackEndPollId) {
        startTrackEndPolling();
      }
    }
  });
  element.addEventListener('stalled', () => {
    if (!pausedByUser) {
      ensureHiddenLoadRecovery();
    }
  });
  element.addEventListener('waiting', () => {
    if (!pausedByUser) {
      ensureHiddenLoadRecovery();
    }
  });
  element.addEventListener('suspend', () => {
    if (!pausedByUser) {
      ensureHiddenLoadRecovery();
    }
  });
  element.addEventListener('emptied', () => {
    if (!pausedByUser) {
      // After src swap or internal reset, re-arm recovery in background
      ensureHiddenLoadRecovery();
    }
  });
  element.addEventListener('pause', () => {
    // Tesla (and some Chromium builds) auto-pause media when the browser is
    // minimized. If the user did not pause, immediately re-assert play.
    if (!pausedByUser && element.src && !element.ended) {
      setMediaSessionPlaying();
      window.setTimeout(() => {
        if (!pausedByUser && element.paused && element.src && !element.ended) {
          ensureActivePlayback();
        }
      }, 0);
      window.setTimeout(() => {
        if (!pausedByUser && element.paused && element.src && !element.ended) {
          ensureActivePlayback();
        }
      }, 100);
      window.setTimeout(() => {
        if (!pausedByUser && element.paused && element.src && !element.ended) {
          ensureActivePlayback();
        }
      }, 400);
    }
  });
};

export const getCurrentPlayerElement = (): HTMLAudioElement | null => {
  return playerElement;
};

// ======================================================================
// AUDIO CONTEXT KEEP-ALIVE
// ======================================================================

const getAudioContextCtor = (): typeof AudioContext | null => {
  if (typeof window === 'undefined') return null;
  return (
    window.AudioContext ||
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext ||
    null
  );
};

export const ensureAudioKeepAlive = (): void => {
  if (pausedByUser || typeof window === 'undefined') return;

  const Ctor = getAudioContextCtor();
  if (!Ctor) return;

  try {
    if (!audioKeepAliveCtx) {
      audioKeepAliveCtx = new Ctor();
    }

    if (audioKeepAliveCtx.state === 'suspended') {
      void audioKeepAliveCtx.resume();
    }

    if (!audioKeepAliveOsc && audioKeepAliveCtx) {
      audioKeepAliveOsc = audioKeepAliveCtx.createOscillator();
      audioKeepAliveGain = audioKeepAliveCtx.createGain();
      // Near-silent but non-zero so the audio pipeline stays claimed.
      audioKeepAliveGain.gain.value = 0.0001;
      audioKeepAliveOsc.frequency.value = 20;
      audioKeepAliveOsc.connect(audioKeepAliveGain);
      audioKeepAliveGain.connect(audioKeepAliveCtx.destination);
      audioKeepAliveOsc.start();
    }
  } catch {
    // AudioContext may be blocked until a user gesture; ignore.
  }
};

export const stopAudioKeepAlive = (): void => {
  try {
    if (audioKeepAliveOsc) {
      audioKeepAliveOsc.stop();
      audioKeepAliveOsc.disconnect();
    }
  } catch {
    // ignore
  }
  try {
    audioKeepAliveGain?.disconnect();
  } catch {
    // ignore
  }
  try {
    void audioKeepAliveCtx?.close();
  } catch {
    // ignore
  }
  audioKeepAliveOsc = null;
  audioKeepAliveGain = null;
  audioKeepAliveCtx = null;
};

const samplePlaybackProgress = (element: HTMLAudioElement): void => {
  const progressMs = element.currentTime * 1000;
  const now = Date.now();
  if (progressMs !== lastProgressSampleMs) {
    if (lastProgressSampleTime > 0) {
      progressHasMoved = true;
    }
    lastProgressSampleMs = progressMs;
    lastProgressSampleTime = now;
  } else if (lastProgressSampleTime === 0) {
    lastProgressSampleMs = progressMs;
    lastProgressSampleTime = now;
  }
};

const isProgressAdvancing = (): boolean => {
  if (!progressHasMoved || lastProgressSampleTime === 0) return false;
  // Wider window: Tesla throttles timers heavily when minimized, so samples
  // may arrive every 1s+ even while audio is still advancing.
  return Date.now() - lastProgressSampleTime < progressStallMs;
};

const isElementAudible = (element: HTMLAudioElement): boolean => {
  if (element.paused || element.ended) return false;

  samplePlaybackProgress(element);

  const isHidden = typeof document !== 'undefined' && document.hidden;
  if (!isHidden) return true;

  // Accept HAVE_CURRENT_DATA while progress advances — waiting for
  // HAVE_ENOUGH_DATA in a throttled background tab often never succeeds.
  return (
    element.readyState >= HAVE_FUTURE_DATA ||
    isProgressAdvancing() ||
    (element.readyState >= HAVE_CURRENT_DATA && progressHasMoved)
  );
};

const isElementAtTrackEnd = (element: HTMLAudioElement): boolean => {
  if (element.ended) return true;

  const durationMs = element.duration * 1000;
  const progressMs = element.currentTime * 1000;
  if (!durationMs || durationMs <= 0 || Number.isNaN(durationMs)) return false;

  return progressMs >= durationMs - trackEndEpsilonMs;
};

// ======================================================================
// TRACK ADVANCE GUARD
// ======================================================================

export const setAdvanceLatchKey = (_key: string): void => {
  advanceFired = false;
};

export const resetTrackAdvanceLatch = (): void => {
  advanceFired = false;
};

export const setTrackEndedCallback = (handler: (() => void) | null): void => {
  onTrackEndedCallback = handler;
};

export const requestTrackAdvance = (): void => {
  if (advanceFired) return;

  advanceFired = true;
  stopTrackEndPolling();
  // Keep silent audio pipeline open across the cold-load gap so Tesla does not
  // drop Bluetooth/media focus while the next track buffers.
  ensureAudioKeepAlive();
  onTrackEndedCallback?.();
};

// ======================================================================
// VARIOUS PLAYER FUNCTIONS
// ======================================================================

const stopHiddenLoadRecovery = (): void => {
  if (hiddenLoadRecoveryId) {
    window.clearInterval(hiddenLoadRecoveryId);
    hiddenLoadRecoveryId = null;
  }
  if (hiddenLoadRecoveryTimeoutId) {
    window.clearTimeout(hiddenLoadRecoveryTimeoutId);
    hiddenLoadRecoveryTimeoutId = null;
  }
};

const startHiddenLoadRecovery = (playToken: number): void => {
  stopHiddenLoadRecovery();
  if (typeof document === 'undefined' || !document.hidden || pausedByUser) return;

  hiddenLoadRecoveryToken = playToken;

  const tick = () => {
    if (pausedByUser || playToken !== activePlayToken || playToken !== hiddenLoadRecoveryToken) {
      stopHiddenLoadRecovery();
      return;
    }

    const element = getCurrentPlayerElement();
    if (!element?.src) return;

    const durationSec = element.duration || 0;
    syncHiddenMediaSession(element.currentTime || 0, durationSec > 0 ? durationSec : undefined);
    ensureAudioKeepAlive();

    if (isElementAudible(element)) {
      stopHiddenLoadRecovery();
      if (!trackEndPollId) {
        startTrackEndPolling();
      }
      return;
    }

    ensureActivePlayback();
  };

  tick();
  hiddenLoadRecoveryId = window.setInterval(tick, hiddenLoadRecoveryMs);
  hiddenLoadRecoveryTimeoutId = window.setTimeout(() => {
    if (pausedByUser || playToken !== activePlayToken || playToken !== hiddenLoadRecoveryToken) {
      stopHiddenLoadRecovery();
      return;
    }

    const element = getCurrentPlayerElement();
    if (!element?.src || isElementAudible(element)) {
      stopHiddenLoadRecovery();
      return;
    }

    // Re-arm instead of stopping — Tesla can throttle background tabs for minutes.
    startHiddenLoadRecovery(playToken);
  }, hiddenLoadRecoveryMaxMs);
};

export const isHiddenLoadRecoveryActive = (): boolean => hiddenLoadRecoveryId !== null;

export const ensureHiddenLoadRecovery = (): void => {
  if (typeof document === 'undefined' || !document.hidden || pausedByUser) return;

  const element = getCurrentPlayerElement();
  if (!element?.src || isElementAudible(element)) return;

  if (!isHiddenLoadRecoveryActive()) {
    startHiddenLoadRecovery(activePlayToken);
  }
};

export const unload = (): void => {
  console.log('%c--- player - unload ---', 'color:#a18507');
  stopHiddenLoadRecovery();
  stopAudioKeepAlive();
  if (playerElement) {
    playerElement.pause();
    playerElement.src = '';
    playerElement.load();
  }
  advanceFired = false;
  hiddenPlayFailCount = 0;
  stopTrackEndPolling();
  if ('mediaSession' in navigator) {
    navigator.mediaSession.playbackState = 'none';
  }
};

const setMediaSessionPlaying = (): void => {
  if ('mediaSession' in navigator && !pausedByUser) {
    navigator.mediaSession.playbackState = 'playing';
  }
};

export const syncHiddenMediaSession = (positionSec?: number, durationSec?: number): void => {
  if (!('mediaSession' in navigator) || pausedByUser) return;

  navigator.mediaSession.playbackState = 'playing';

  if (typeof navigator.mediaSession.setPositionState !== 'function') return;

  const element = getCurrentPlayerElement();
  const position = positionSec ?? element?.currentTime ?? 0;
  const duration = durationSec ?? element?.duration ?? 0;

  if (duration <= 0 || Number.isNaN(duration)) return;

  try {
    navigator.mediaSession.setPositionState({
      duration,
      position: Math.min(Math.max(position, 0), duration),
      playbackRate: 1,
    });
  } catch {
    // setPositionState may reject invalid states on some Chromium builds
  }
};

const attemptElementPlay = (
  element: HTMLAudioElement,
  playToken: number,
  attempt: number,
  onSuccess: () => void
): void => {
  if (pausedByUser || playToken !== activePlayToken) return;

  setMediaSessionPlaying();
  ensureAudioKeepAlive();

  // Some environments / mocks return void from play(); normalize to a Promise.
  Promise.resolve(element.play())
    .then(() => {
      if (playToken !== activePlayToken) return;
      hiddenPlayFailCount = 0;
      onSuccess();
    })
    .catch(() => {
      if (pausedByUser || playToken !== activePlayToken) return;

      hiddenPlayFailCount += 1;
      const maxRetries = typeof document !== 'undefined' && document.hidden ? hiddenPlayMaxRetries : 1;
      const retryDelay = typeof document !== 'undefined' && document.hidden ? hiddenPlayRetryMs : playRetryMs;

      if (attempt < maxRetries) {
        window.setTimeout(() => attemptElementPlay(element, playToken, attempt + 1, onSuccess), retryDelay);
        return;
      }

      if (typeof document !== 'undefined' && document.hidden && hiddenPlayFailCount >= hiddenPlayReloadThreshold) {
        reloadElementAndPlay(element, playToken, onSuccess);
      }
    });
};

const reloadElementAndPlay = (element: HTMLAudioElement, playToken: number, onSuccess: () => void): void => {
  const src = element.src;
  if (!src || pausedByUser || playToken !== activePlayToken) return;

  const savedTime = element.currentTime;
  hiddenPlayFailCount = 0;
  element.load();
  if (savedTime > 0) {
    element.currentTime = savedTime;
  }

  const startAfterReady = () => {
    if (pausedByUser || playToken !== activePlayToken) return;
    attemptElementPlay(element, playToken, 0, onSuccess);
  };

  if (element.readyState >= HAVE_FUTURE_DATA) {
    startAfterReady();
  } else {
    // Guard against the element never becoming ready (e.g. Tesla background
    // tab throttling the network). Without this, the once:true listener would
    // never fire and playback would stay dead after a transient error burst.
    let started = false;
    const guardedStart = () => {
      if (started) return;
      started = true;
      element.removeEventListener('canplay', guardedStart);
      element.removeEventListener('loadeddata', guardedStart);
      startAfterReady();
    };
    element.addEventListener('canplay', guardedStart, { once: true });
    element.addEventListener('loadeddata', guardedStart, { once: true });
    window.setTimeout(() => {
      if (started) return;
      if (pausedByUser || playToken !== activePlayToken) return;
      // Force a play attempt even if canplay never fired.
      startAfterReady();
    }, reloadReadyTimeoutMs);
  }
};

const startPlaybackWithRetry = (element: HTMLAudioElement, playToken: number): void => {
  const onPlaySuccess = () => {
    if (playToken !== activePlayToken) return;
    if (isElementAudible(element)) {
      stopHiddenLoadRecovery();
      startTrackEndPolling();
    } else if (typeof document !== 'undefined' && document.hidden) {
      // play() resolved but element not yet considered audible — keep recovery.
      ensureHiddenLoadRecovery();
      if (!trackEndPollId) startTrackEndPolling();
    }
  };

  attemptElementPlay(element, playToken, 0, onPlaySuccess);
};

// Start playback once the element is ready, but never block forever: a Tesla
// background tab can throttle the network so that canplay/canplaythrough never
// fire. Without the timeout fallback the once:true listeners would linger and
// playback would die, which is the "music stops after a few songs" symptom.
//
// When hidden we wait only for canplay / HAVE_CURRENT_DATA — canplaythrough
// often never fires under background network throttling.
const beginPlaybackWhenReady = (element: HTMLAudioElement, playToken: number, onStart: () => void): void => {
  const isHidden = typeof document !== 'undefined' && document.hidden;
  const readyThreshold = isHidden ? HAVE_CURRENT_DATA : HAVE_FUTURE_DATA;
  const readyEvent = isHidden ? 'canplay' : 'canplay';

  if (element.readyState >= readyThreshold) {
    onStart();
    return;
  }

  let started = false;
  const guardedStart = () => {
    if (started || pausedByUser || playToken !== activePlayToken) return;
    started = true;
    element.removeEventListener(readyEvent, guardedStart);
    element.removeEventListener('canplay', guardedStart);
    element.removeEventListener('loadeddata', guardedStart);
    onStart();
  };

  element.addEventListener(readyEvent, guardedStart, { once: true });
  if (isHidden) {
    element.addEventListener('loadeddata', guardedStart, { once: true });
    // Also accept canplaythrough if it happens to fire first.
    element.addEventListener('canplaythrough', guardedStart, { once: true });
  }

  window.setTimeout(() => {
    if (started || pausedByUser || playToken !== activePlayToken) return;
    // Force a start attempt even if the ready event was never emitted.
    started = true;
    element.removeEventListener(readyEvent, guardedStart);
    element.removeEventListener('canplay', guardedStart);
    element.removeEventListener('loadeddata', guardedStart);
    element.removeEventListener('canplaythrough', guardedStart);
    onStart();
  }, reloadReadyTimeoutMs);
};

const playWhenReady = (element: HTMLAudioElement, playToken: number): void => {
  beginPlaybackWhenReady(element, playToken, () => startPlaybackWithRetry(element, playToken));
};

export const loadTrack = (trackSrc: string, progress: number = 0, play: boolean = true): void => {
  console.log('%c--- player - loadTrack ---', 'color:#a18507');
  stopHiddenLoadRecovery();
  resetTrackAdvanceLatch();
  hiddenPlayFailCount = 0;
  lastProgressSampleMs = 0;
  lastProgressSampleTime = 0;
  progressHasMoved = false;
  const playToken = ++activePlayToken;

  if (play) {
    setMediaSessionPlaying();
    ensureAudioKeepAlive();
  }

  if (playerElement) {
    // NOTE: intentionally no explicit pause() before src swap on auto-next.
    // Assigning src aborts current playback; explicit pause() + load() can
    // extend the silent gap and make Tesla drop Bluetooth audio focus.
    playerElement.src = trackSrc;
    playerElement.load();
    if (progress) {
      playerElement.currentTime = progress / 1000;
    }
    if (play) {
      playWhenReady(playerElement, playToken);
      startHiddenLoadRecovery(playToken);
      // Immediate play attempt in addition to ready-wait — some Chromium builds
      // buffer more reliably once play() has been requested.
      if (typeof document !== 'undefined' && document.hidden) {
        attemptElementPlay(playerElement, playToken, 0, () => {
          if (!trackEndPollId) startTrackEndPolling();
        });
      }
    } else {
      stopTrackEndPolling();
    }
  }
};

export const pause = (): void => {
  pausedByUser = true;
  stopHiddenLoadRecovery();
  stopTrackEndPolling();
  stopAudioKeepAlive();
  if (playerElement) {
    playerElement.pause();
  }
  if ('mediaSession' in navigator) {
    navigator.mediaSession.playbackState = 'paused';
  }
};

export const resume = (): void => {
  pausedByUser = false;
  if ('mediaSession' in navigator) {
    navigator.mediaSession.playbackState = 'playing';
  }
  ensureAudioKeepAlive();
  if (playerElement) {
    Promise.resolve(playerElement.play())
      .then(() => startTrackEndPolling())
      .catch((_error: any) => {
        // Resume can be rejected when the element is not ready yet (common
        // after a long Tesla background freeze). Re-arm hidden load recovery so
        // the keep-alive poll can bring playback back instead of leaving it dead.
        ensureHiddenLoadRecovery();
      });
  }
};

export const clearManualPauseFlag = (): void => {
  pausedByUser = false;
};

export const isManualPause = (): boolean => pausedByUser;

export const isPlaybackExpected = (): boolean => !pausedByUser;

export const ensureActivePlayback = (): void => {
  if (pausedByUser) return;

  const element = getCurrentPlayerElement();
  if (!element?.src) return;

  setMediaSessionPlaying();
  ensureAudioKeepAlive();

  if (element.ended) {
    requestTrackAdvance();
    return;
  }

  if (element.paused) {
    const onPlaySuccess = () => startTrackEndPolling();
    beginPlaybackWhenReady(element, activePlayToken, () =>
      attemptElementPlay(element, activePlayToken, 0, onPlaySuccess)
    );
    return;
  }

  if (!trackEndPollId) {
    startTrackEndPolling();
  }
};

export const restart = (): void => {
  if (playerElement) {
    playerElement.currentTime = 0;
    playerElement.play().catch((_error: any) => null);
  }
};

export const setVolume = (volumeLevel: number): void => {
  const volume = volumeLevel / 100;
  if (playerElement) {
    playerElement.volume = volume;
  }
};

export const setProgress = (progress: number): void => {
  if (playerElement) {
    playerElement.currentTime = progress / 1000;
  }
};

export const getCurrentProgress = (): number => {
  return playerElement?.currentTime || 0;
};

export const getCurrentDuration = (): number => {
  return playerElement?.duration || 0;
};

const startTrackEndPolling = (): void => {
  stopTrackEndPolling();

  trackEndPollId = window.setInterval(() => {
    const element = getCurrentPlayerElement();
    if (!element || advanceFired) return;

    // Also check when paused: Tesla may leave the element paused at track end.
    if (isElementAtTrackEnd(element)) {
      requestTrackAdvance();
      return;
    }

    if (element.paused && !pausedByUser && element.src) {
      ensureActivePlayback();
    }
  }, trackEndPollMs);
};

const stopTrackEndPolling = (): void => {
  if (trackEndPollId) {
    window.clearInterval(trackEndPollId);
    trackEndPollId = null;
  }
};

export const runBackgroundPlaybackTick = (): void => {
  const element = getCurrentPlayerElement();
  if (!element || advanceFired) return;

  if (isElementAtTrackEnd(element)) {
    requestTrackAdvance();
    return;
  }

  if (!pausedByUser && element.paused && element.src) {
    ensureActivePlayback();
  }

  ensureAudioKeepAlive();
};

export const nudgeActivePlayback = (): void => {
  ensureActivePlayback();
};

export const isActivePlaybackAudible = (): boolean => {
  const element = getCurrentPlayerElement();
  return Boolean(element && isElementAudible(element));
};

export const getPlaybackProgressMs = (): number => {
  const element = getCurrentPlayerElement();
  return element ? element.currentTime * 1000 : 0;
};

/**
 * Called when the page becomes hidden (Tesla browser minimized).
 * Aggressively re-asserts playback intent so system auto-pause does not stick.
 */
export const handleBecameHidden = (): void => {
  if (pausedByUser) return;

  ensureAudioKeepAlive();
  setMediaSessionPlaying();

  const element = getCurrentPlayerElement();
  if (!element?.src) return;

  if (element.ended || isElementAtTrackEnd(element)) {
    requestTrackAdvance();
    return;
  }

  if (element.paused || !isElementAudible(element)) {
    ensureActivePlayback();
    ensureHiddenLoadRecovery();
  }

  // Burst of re-play attempts — Tesla often pauses a few hundred ms after hide.
  [50, 200, 500, 1000, 2000, 4000].forEach((delayMs) => {
    window.setTimeout(() => {
      if (pausedByUser) return;
      const el = getCurrentPlayerElement();
      if (!el?.src) return;
      if (el.ended || isElementAtTrackEnd(el)) {
        requestTrackAdvance();
        return;
      }
      if (el.paused || !isElementAudible(el)) {
        ensureActivePlayback();
        ensureHiddenLoadRecovery();
      }
      syncHiddenMediaSession();
      ensureAudioKeepAlive();
    }, delayMs);
  });
};

