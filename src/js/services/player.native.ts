// ======================================================================
// OPTIONS
// ======================================================================

import { endedAtDecodedDuration, resolveTrustedDurationSec } from 'js/utils/trustedDuration';

const trackEndPollMs = 250;
const trackEndNearEndPollMs = 50;
const trackEndEpsilonMs = 80;
const playRetryMs = 300;
const hiddenPlayRetryMs = 200;
const hiddenPlayMaxRetries = 16;
// Only hard-reload after many failed play() attempts — mid-stream load() kills Tesla BT focus.
const hiddenPlayReloadThreshold = 10;
const hiddenLoadRecoveryMs = 200;
const hiddenLoadRecoveryMaxMs = 180000;
const reloadReadyTimeoutMs = 2000;
const HAVE_CURRENT_DATA = 2;
const HAVE_FUTURE_DATA = 3;
// Visible tabs sample frequently; hidden Tesla timers are coarser so use a wider stall window.
const progressStallMsVisible = 1500;
const progressStallMsHidden = 5000;
// Zombie stall: element claims "playing" but currentTime freezes (Tesla network freeze).
const zombieStallMsVisible = 4000;
const zombieStallMsHidden = 8000;
// Never hard-reload once we are more than a few seconds into a track.
const midTrackReloadGuardMs = 4000;
// Keep-alive health: re-assert Web Audio + silent loop so Tesla cannot age them out.
const keepAliveHealthMs = 2000;
// Pause re-assert burst when OS auto-pauses media on minimize.
const pauseReassertDelaysMs = [0, 50, 120, 300, 700, 1500, 3000, 6000, 12000, 20000];
// Extra re-play attempts after the page becomes hidden (Tesla often pauses later too).
const becameHiddenBurstMs = [0, 50, 200, 500, 1000, 2000, 4000, 8000, 15000, 30000, 60000, 120000];
// Gapless: start the preloaded next element just before the current one ends.
// Visible tabs can be tight; hidden Tesla tabs may freeze JS on `ended`, so
// start a few hundred ms earlier — never multiple seconds (that skipped songs).
const gaplessLeadMsVisible = 80;
const gaplessLeadMsHidden = 320;
const hiddenLoopGuardRemainingMs = 4000;
const nearEndPollRemainingMs = 5000;
const minPlayedBeforeEndMs = 1500;
const positionDriftSec = 0.4;

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
let keepAliveHealthId: number | null = null;
let keepAliveStateHandler: (() => void) | null = null;
let standbyElement: HTMLAudioElement | null = null;
let nextTrackSrc: string | null = null;
let preloadedSrc: string | null = null;
let warmStartActive = false;
let lastKnownCurrentTime = 0;
let lastGoodPositionSec = 0;
let expectedDurationSec = 0;
let pendingSeekSec: number | null = null;
let lastAdvancedToSrc: string | null = null;
let gaplessTimerId: number | null = null;
let gaplessGeneration = 0;
let trackEndPollMsCurrent = trackEndPollMs;
let onLoadStartCb: () => void = () => undefined;
let onCanPlayCb: () => void = () => undefined;
let onErrorCb: (params: { event: Event; playerElement: HTMLAudioElement }) => void = () => undefined;

// Dual keep-alive pipeline for Tesla minimized tabs:
// 1) Near-silent Web Audio oscillator (claims the audio graph)
// 2) Looping near-silent HTMLAudioElement (claims the media/BT focus path)
// Either alone can be suspended; together they survive much longer.
let audioKeepAliveCtx: AudioContext | null = null;
let audioKeepAliveOsc: OscillatorNode | null = null;
let audioKeepAliveGain: GainNode | null = null;
let silentLoopElement: HTMLAudioElement | null = null;
let silentLoopObjectUrl: string | null = null;

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
  onLoadStartCb = onLoadStart;
  onCanPlayCb = onCanPlay;
  onErrorCb = onError;
  if (!playerElement) {
    playerElement = document.createElement('audio');
    setupPlayerElement(playerElement, volumeLevel, volumeMuted);
    appendPlayerElement(playerElement);
  }
};

const ensurePlayerContainer = (): HTMLDivElement | null => {
  if (typeof document === 'undefined') return null;
  if (!playerContainer) {
    playerContainer = document.createElement('div');
    playerContainer.id = 'chromatix-player-elements';
    playerContainer.setAttribute('aria-hidden', 'true');
    playerContainer.style.cssText = 'position:fixed;width:0;height:0;overflow:hidden;opacity:0;pointer-events:none;';
    document.body.appendChild(playerContainer);
  }
  return playerContainer;
};

const appendPlayerElement = (element: HTMLAudioElement | null): void => {
  if (!element) return;

  const container = ensurePlayerContainer();
  if (!container) return;

  element.setAttribute('playsinline', 'true');
  element.setAttribute('webkit-playsinline', 'true');
  // Hint to Chromium/Tesla that this element is intentional media, not an ad.
  element.setAttribute('controlslist', 'nodownload noplaybackrate');
  if (element.parentNode !== container && container instanceof Node && element instanceof Node) {
    container.appendChild(element);
  }
};

const isActivePlayer = (element: HTMLAudioElement): boolean => element === playerElement;

const setupPlayerElement = (element: HTMLAudioElement, volumeLevel: number, volumeMuted: boolean): void => {
  element.pause();
  element.volume = volumeMuted ? 0 : volumeLevel / 100;
  element.preload = 'auto';

  element.addEventListener('loadstart', () => {
    if (isActivePlayer(element)) onLoadStartCb();
  });
  element.addEventListener('canplay', () => {
    if (!isActivePlayer(element)) return;
    applyPendingSeek(element);
    onCanPlayCb();
  });
  element.addEventListener('ended', () => {
    if (!isActivePlayer(element)) return;
    // Real EOF, including when tags are a few seconds longer than the file.
    // A collapsed buffer still looks "ended" at a short duration — that one recovers.
    if (elementReachedDecodedEnd(element)) {
      requestTrackAdvance();
      return;
    }
    // The event means the element thinks it finished. Ignore it only when we
    // already have a mid-track position that is not near the trusted duration
    // (buffer death / dropped connection). Immediate ended at 0 still advances.
    if (lastGoodPositionSec >= 1.5) {
      const trusted = trustedDurationFor(element);
      const pos = Number.isFinite(element.currentTime) ? element.currentTime : lastGoodPositionSec;
      if (trusted <= 0 || pos < trusted - 1.5) {
        recoverToSavedPosition(!pausedByUser);
        return;
      }
    }
    requestTrackAdvance();
  });
  element.addEventListener('error', (event: Event) => {
    if (!isActivePlayer(element)) return;
    onErrorCb({ event, playerElement: element });
  });
  element.addEventListener('playing', () => {
    if (!isActivePlayer(element) || pausedByUser) return;
    stopHiddenLoadRecovery();
    ensureAudioKeepAlive();
    if (!trackEndPollId) {
      startTrackEndPolling();
    }
    scheduleGaplessTimer();
  });
  element.addEventListener('timeupdate', () => {
    if (!isActivePlayer(element)) return;
    snapshotElementPosition(element);
    if (pausedByUser) return;
    maybeWarmStartNext();
  });
  element.addEventListener('stalled', () => {
    if (isActivePlayer(element) && !pausedByUser) {
      ensureHiddenLoadRecovery();
    }
  });
  element.addEventListener('waiting', () => {
    if (isActivePlayer(element) && !pausedByUser) {
      ensureHiddenLoadRecovery();
    }
  });
  element.addEventListener('suspend', () => {
    if (isActivePlayer(element) && !pausedByUser) {
      ensureHiddenLoadRecovery();
    }
  });
  element.addEventListener('emptied', () => {
    if (isActivePlayer(element) && !pausedByUser) {
      // After src swap or internal reset, re-arm recovery in background
      ensureHiddenLoadRecovery();
    }
  });
  element.addEventListener('pause', () => {
    // Tesla (and some Chromium builds) auto-pause media when the browser is
    // minimized. If the user did not pause, aggressively re-assert play over
    // a long window — Tesla often re-pauses several times after hide.
    if (!isActivePlayer(element) || pausedByUser || !element.src || shouldTreatAsTrackEnd(element)) return;
    setMediaSessionPlaying();
    ensureAudioKeepAlive();
    pauseReassertDelaysMs.forEach((delayMs) => {
      window.setTimeout(() => {
        if (pausedByUser) return;
        const el = getCurrentPlayerElement();
        if (!el?.src || shouldTreatAsTrackEnd(el)) return;
        if (el.paused || !isElementAudible(el)) {
          ensureActivePlayback();
          ensureHiddenLoadRecovery();
        }
        ensureAudioKeepAlive();
        setMediaSessionPlaying();
      }, delayMs);
    });
  });
};

export const getCurrentPlayerElement = (): HTMLAudioElement | null => {
  return playerElement;
};

const sameSrc = (a: string | null | undefined, b: string | null | undefined): boolean => {
  if (!a || !b) return false;
  if (a === b) return true;
  try {
    const base = typeof location !== 'undefined' ? location.href : 'http://localhost/';
    return new URL(a, base).href === new URL(b, base).href;
  } catch {
    return false;
  }
};

const ensureStandbyElement = (): HTMLAudioElement | null => {
  if (typeof document === 'undefined') return null;
  if (!standbyElement) {
    standbyElement = document.createElement('audio');
    const volume = playerElement?.volume ?? 1;
    setupPlayerElement(standbyElement, volume * 100, volume === 0);
    if (playerElement) {
      standbyElement.volume = playerElement.volume;
    }
    appendPlayerElement(standbyElement);
  }
  return standbyElement;
};

const swapToStandby = (): boolean => {
  if (!standbyElement) return false;
  const prev = playerElement;
  playerElement = standbyElement;
  standbyElement = prev;
  warmStartActive = false;
  preloadedSrc = null;
  lastKnownCurrentTime = 0;
  lastGoodPositionSec = 0;
  pendingSeekSec = null;
  lastProgressSampleMs = 0;
  lastProgressSampleTime = 0;
  progressHasMoved = false;
  if (prev) {
    try {
      prev.loop = false;
      prev.pause();
    } catch {
      // ignore
    }
  }
  return true;
};

const gaplessLeadMs = (): number => {
  const isHidden = typeof document !== 'undefined' && document.hidden;
  return isHidden ? gaplessLeadMsHidden : gaplessLeadMsVisible;
};

const standbyReadyThreshold = (): number => {
  const isHidden = typeof document !== 'undefined' && document.hidden;
  return isHidden ? HAVE_CURRENT_DATA : HAVE_FUTURE_DATA;
};

const isStandbyReadyFor = (trackSrc: string, opts?: { allowCurrentData?: boolean }): boolean => {
  if (!standbyElement || !sameSrc(standbyElement.src, trackSrc)) return false;
  if (standbyElement.error) return false;
  const threshold = opts?.allowCurrentData ? HAVE_CURRENT_DATA : standbyReadyThreshold();
  return standbyElement.readyState >= threshold;
};

const tryAdoptStandby = (trackSrc: string, progress: number, play: boolean, playToken: number): boolean => {
  // At a hard track change, adopt even with only HAVE_CURRENT_DATA — better than
  // throwing away the preload and cold-loading the same src.
  if (!isStandbyReadyFor(trackSrc, { allowCurrentData: true }) || !standbyElement) return false;

  const alreadyPlaying = !standbyElement.paused && !standbyElement.ended;

  if (!swapToStandby() || !playerElement) return false;

  lastAdvancedToSrc = trackSrc;

  if (progress && !alreadyPlaying) {
    playerElement.currentTime = progress / 1000;
  }

  if (play) {
    if (alreadyPlaying && !playerElement.paused) {
      startTrackEndPolling();
      scheduleGaplessTimer();
    } else {
      playWhenReady(playerElement, playToken);
      startHiddenLoadRecovery(playToken);
      if (typeof document !== 'undefined' && document.hidden) {
        attemptElementPlay(playerElement, playToken, 0, () => {
          if (!trackEndPollId) startTrackEndPolling();
        });
      }
    }
  } else {
    stopTrackEndPolling();
    try {
      playerElement.pause();
    } catch {
      // ignore
    }
  }
  return true;
};

const remainingMsOf = (element: HTMLAudioElement | null): number => {
  if (!element) return Number.POSITIVE_INFINITY;
  const durationSec = trustedDurationFor(element);
  if (!durationSec || durationSec <= 0 || Number.isNaN(durationSec)) return Number.POSITIVE_INFINITY;
  return (durationSec - element.currentTime) * 1000;
};

const clearGaplessTimer = (): void => {
  if (gaplessTimerId != null) {
    window.clearTimeout(gaplessTimerId);
    gaplessTimerId = null;
  }
};

const scheduleGaplessTimer = (): void => {
  clearGaplessTimer();
  if (pausedByUser || !playerElement || !nextTrackSrc) return;
  if (sameSrc(playerElement.src, nextTrackSrc) && !playerElement.ended) return;

  const remaining = remainingMsOf(playerElement);
  const lead = gaplessLeadMs();
  if (!Number.isFinite(remaining) || remaining <= 0 || remaining <= lead) return;
  if (remaining - lead > 180000) return;

  gaplessTimerId = window.setTimeout(() => {
    gaplessTimerId = null;
    maybeWarmStartNext();
  }, remaining - lead);
};

const alreadyOnSrc = (trackSrc: string | null): boolean => {
  if (!trackSrc || !playerElement) return false;
  return sameSrc(playerElement.src, trackSrc) && !playerElement.ended;
};

const commitGaplessHandoff = (): boolean => {
  if (pausedByUser || !nextTrackSrc) return false;

  const targetSrc = nextTrackSrc;

  if (!alreadyOnSrc(targetSrc)) {
    if (!standbyElement || !sameSrc(standbyElement.src, targetSrc)) return false;
    if (!swapToStandby()) return false;
  }

  warmStartActive = false;
  setMediaSessionPlaying();
  ensureAudioKeepAlive();
  if (!trackEndPollId) startTrackEndPolling();

  // Redux may already have advanced via `ended` → loadTrack(adopt). A second
  // auto-next here skips a song (the "track 4 started too early" bug).
  const alreadyNotified = advanceFired || sameSrc(lastAdvancedToSrc, targetSrc);
  lastAdvancedToSrc = targetSrc;

  if (!alreadyNotified) {
    requestTrackAdvance();
  }

  scheduleGaplessTimer();
  return true;
};

const startGaplessHandoff = (): boolean => {
  if (pausedByUser || !nextTrackSrc || !isStandbyReadyFor(nextTrackSrc)) return false;
  if (alreadyOnSrc(nextTrackSrc)) return false;
  if (warmStartActive) return false;

  const next = standbyElement;
  if (!next) return false;

  const generation = gaplessGeneration;
  const expectedSrc = nextTrackSrc;
  warmStartActive = true;
  setMediaSessionPlaying();
  ensureAudioKeepAlive();

  const stillCurrent = (): boolean =>
    generation === gaplessGeneration && sameSrc(nextTrackSrc, expectedSrc) && sameSrc(next.src, expectedSrc);

  if (!next.paused && !next.ended) {
    if (!stillCurrent()) {
      warmStartActive = false;
      return false;
    }
    return commitGaplessHandoff();
  }

  Promise.resolve(next.play())
    .then(() => {
      if (!stillCurrent()) {
        warmStartActive = false;
        return;
      }
      if (pausedByUser) {
        warmStartActive = false;
        try {
          next.pause();
        } catch {
          // ignore
        }
        return;
      }
      commitGaplessHandoff();
    })
    .catch(() => {
      if (generation === gaplessGeneration) warmStartActive = false;
    });
  return true;
};

export const setNextTrack = (trackSrc: string | null): void => {
  if (!sameSrc(nextTrackSrc, trackSrc)) {
    gaplessGeneration += 1;
  }
  nextTrackSrc = trackSrc;
  if (!trackSrc) {
    preloadedSrc = null;
    clearGaplessTimer();
    if (standbyElement && standbyElement.paused) {
      try {
        standbyElement.removeAttribute('src');
        standbyElement.load();
      } catch {
        // ignore
      }
    }
    return;
  }

  if (sameSrc(preloadedSrc, trackSrc) || sameSrc(standbyElement?.src, trackSrc)) {
    scheduleGaplessTimer();
    return;
  }

  const standby = ensureStandbyElement();
  if (!standby) return;

  preloadedSrc = trackSrc;
  standby.preload = 'auto';
  standby.src = trackSrc;
  standby.load();
  scheduleGaplessTimer();
};

export const maybeWarmStartNext = (): void => {
  if (pausedByUser || !nextTrackSrc || !playerElement) return;
  if (alreadyOnSrc(nextTrackSrc)) return;

  const remaining = remainingMsOf(playerElement);
  const isHidden = typeof document !== 'undefined' && document.hidden;
  const standbyReady = isStandbyReadyFor(nextTrackSrc);

  if (isHidden && remaining <= hiddenLoopGuardRemainingMs && remaining > 0 && !standbyReady) {
    playerElement.loop = true;
  }

  // Any backward jump while looping is the wrap. A throttled Tesla timer often
  // skips the old "previous sample was inside the last 3s" window.
  const current = playerElement.currentTime || 0;
  const wrapped = Boolean(playerElement.loop && lastKnownCurrentTime > 1 && current + 0.5 < lastKnownCurrentTime);

  lastKnownCurrentTime = current;

  if (wrapped) {
    playerElement.loop = false;
    if (standbyReady) {
      startGaplessHandoff();
    } else {
      requestTrackAdvance();
    }
    return;
  }

  if (!standbyReady) {
    if (nextTrackSrc && !sameSrc(standbyElement?.src, nextTrackSrc)) {
      setNextTrack(nextTrackSrc);
    }
    return;
  }

  if (remaining <= gaplessLeadMs()) {
    startGaplessHandoff();
    return;
  }

  scheduleGaplessTimer();
};

// ======================================================================
// AUDIO CONTEXT + SILENT-LOOP KEEP-ALIVE
// ======================================================================

const getAudioContextCtor = (): typeof AudioContext | null => {
  if (typeof window === 'undefined') return null;
  return (
    window.AudioContext ||
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext ||
    null
  );
};

/** Tiny mono WAV (~0.25s) with near-zero amplitude — inaudible but not pure digital silence. */
const buildNearSilentLoopObjectUrl = (): string => {
  const sampleRate = 8000;
  const numSamples = 2000; // 0.25s
  const dataSize = numSamples * 2;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);

  const writeStr = (offset: number, str: string) => {
    for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i));
  };

  writeStr(0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  writeStr(8, 'WAVE');
  writeStr(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeStr(36, 'data');
  view.setUint32(40, dataSize, true);

  // Extremely quiet 20 Hz-ish content so silence detectors do not drop the stream.
  for (let i = 0; i < numSamples; i++) {
    const sample = Math.sin((2 * Math.PI * 20 * i) / sampleRate) * 8; // ~ -72 dBFS
    view.setInt16(44 + i * 2, sample | 0, true);
  }

  const blob = new Blob([buffer], { type: 'audio/wav' });
  return URL.createObjectURL(blob);
};

const bindAudioContextStateHandler = (ctx: AudioContext): void => {
  if (keepAliveStateHandler) {
    try {
      ctx.removeEventListener('statechange', keepAliveStateHandler);
    } catch {
      // ignore
    }
  }
  keepAliveStateHandler = () => {
    if (pausedByUser) return;
    if (ctx.state === 'suspended' || ctx.state === 'interrupted') {
      void ctx.resume().catch(() => null);
    }
  };
  ctx.addEventListener('statechange', keepAliveStateHandler);
};

const ensureWebAudioKeepAlive = (): void => {
  const Ctor = getAudioContextCtor();
  if (!Ctor) return;

  try {
    if (!audioKeepAliveCtx || audioKeepAliveCtx.state === 'closed') {
      audioKeepAliveOsc = null;
      audioKeepAliveGain = null;
      audioKeepAliveCtx = new Ctor();
      bindAudioContextStateHandler(audioKeepAliveCtx);
    }

    if (audioKeepAliveCtx.state === 'suspended' || audioKeepAliveCtx.state === 'interrupted') {
      void audioKeepAliveCtx.resume().catch(() => null);
    }

    if (!audioKeepAliveOsc && audioKeepAliveCtx) {
      audioKeepAliveOsc = audioKeepAliveCtx.createOscillator();
      audioKeepAliveGain = audioKeepAliveCtx.createGain();
      // Near-silent but non-zero so the audio pipeline stays claimed.
      audioKeepAliveGain.gain.value = 0.00015;
      audioKeepAliveOsc.frequency.value = 20;
      audioKeepAliveOsc.type = 'sine';
      audioKeepAliveOsc.connect(audioKeepAliveGain);
      audioKeepAliveGain.connect(audioKeepAliveCtx.destination);
      audioKeepAliveOsc.start();
    } else if (audioKeepAliveGain && audioKeepAliveCtx) {
      // Micro-nudge gain so some Chromium builds do not age out a "static" silent graph.
      const g = audioKeepAliveGain.gain;
      const now = audioKeepAliveCtx.currentTime;
      try {
        g.setValueAtTime(0.00015, now);
        g.linearRampToValueAtTime(0.0002, now + 0.02);
        g.linearRampToValueAtTime(0.00015, now + 0.05);
      } catch {
        g.value = 0.00015;
      }
    }
  } catch {
    // AudioContext may be blocked until a user gesture; ignore.
  }
};

const ensureSilentLoopKeepAlive = (): void => {
  if (typeof document === 'undefined') return;

  try {
    if (!silentLoopElement) {
      if (!silentLoopObjectUrl) {
        silentLoopObjectUrl = buildNearSilentLoopObjectUrl();
      }
      silentLoopElement = document.createElement('audio');
      silentLoopElement.setAttribute('playsinline', 'true');
      silentLoopElement.setAttribute('webkit-playsinline', 'true');
      silentLoopElement.setAttribute('aria-hidden', 'true');
      silentLoopElement.loop = true;
      silentLoopElement.preload = 'auto';
      // Keep independent of user volume; inaudible content only.
      silentLoopElement.volume = 0.01;
      silentLoopElement.src = silentLoopObjectUrl;

      const container = ensurePlayerContainer();
      if (container && silentLoopElement.parentNode !== container) {
        container.appendChild(silentLoopElement);
      }
    }

    if (silentLoopElement.paused) {
      void Promise.resolve(silentLoopElement.play()).catch(() => null);
    }
  } catch {
    // ignore — silent loop is best-effort
  }
};

const startKeepAliveHealthWatch = (): void => {
  if (keepAliveHealthId != null || typeof window === 'undefined') return;
  keepAliveHealthId = window.setInterval(() => {
    if (pausedByUser) {
      stopKeepAliveHealthWatch();
      return;
    }
    ensureWebAudioKeepAlive();
    ensureSilentLoopKeepAlive();
  }, keepAliveHealthMs);
};

const stopKeepAliveHealthWatch = (): void => {
  if (keepAliveHealthId != null) {
    window.clearInterval(keepAliveHealthId);
    keepAliveHealthId = null;
  }
};

export const ensureAudioKeepAlive = (): void => {
  if (pausedByUser || typeof window === 'undefined') return;

  ensureWebAudioKeepAlive();
  ensureSilentLoopKeepAlive();
  startKeepAliveHealthWatch();
};

export const stopAudioKeepAlive = (): void => {
  stopKeepAliveHealthWatch();

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
  if (audioKeepAliveCtx && keepAliveStateHandler) {
    try {
      audioKeepAliveCtx.removeEventListener('statechange', keepAliveStateHandler);
    } catch {
      // ignore
    }
  }
  keepAliveStateHandler = null;
  try {
    void audioKeepAliveCtx?.close();
  } catch {
    // ignore
  }
  audioKeepAliveOsc = null;
  audioKeepAliveGain = null;
  audioKeepAliveCtx = null;

  try {
    if (silentLoopElement) {
      silentLoopElement.pause();
      silentLoopElement.removeAttribute('src');
      silentLoopElement.load();
      silentLoopElement.remove();
    }
  } catch {
    // ignore
  }
  silentLoopElement = null;
  if (silentLoopObjectUrl) {
    try {
      URL.revokeObjectURL(silentLoopObjectUrl);
    } catch {
      // ignore
    }
    silentLoopObjectUrl = null;
  }
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
  // Wider window when hidden: Tesla throttles timers heavily when minimized, so
  // samples may arrive every few seconds even while audio is still advancing.
  const isHidden = typeof document !== 'undefined' && document.hidden;
  const stallMs = isHidden ? progressStallMsHidden : progressStallMsVisible;
  return Date.now() - lastProgressSampleTime < stallMs;
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

const trustedDurationFor = (element: HTMLAudioElement): number =>
  resolveTrustedDurationSec(element.duration || 0, expectedDurationSec);

const snapshotElementPosition = (element: HTMLAudioElement | null): void => {
  if (!element) return;
  const timeSec = element.currentTime;
  if (!Number.isFinite(timeSec) || timeSec < 0) return;

  const trusted = trustedDurationFor(element);
  // Ignore a jump-to-end caused by a collapsed buffer or dropped stream.
  if (trusted > 0 && timeSec >= trusted - 0.15 && lastGoodPositionSec + 2 < trusted) {
    return;
  }
  // Ignore a reset to 0 while we already have a real mid-track position.
  if (timeSec < 0.25 && lastGoodPositionSec > 1.5) return;

  lastGoodPositionSec = timeSec;
};

const retireStalePendingSeek = (currentTime: number): void => {
  if (pendingSeekSec == null) return;
  // Playback has moved on. A later canplay must not jump back to the old seek.
  if (currentTime > pendingSeekSec + positionDriftSec) {
    pendingSeekSec = null;
  }
};

const applyPendingSeek = (element: HTMLAudioElement): void => {
  if (pendingSeekSec == null) return;
  const target = pendingSeekSec;
  const current = element.currentTime || 0;
  retireStalePendingSeek(current);
  if (pendingSeekSec == null) return;

  if (Math.abs(current - target) > positionDriftSec) {
    try {
      element.currentTime = target;
    } catch {
      return;
    }
  }
  if (Math.abs((element.currentTime || 0) - target) <= positionDriftSec) {
    pendingSeekSec = null;
    lastGoodPositionSec = target;
  }
};

const elementReachedDecodedEnd = (element: HTMLAudioElement): boolean =>
  endedAtDecodedDuration({
    ended: element.ended,
    elementDurationSec: element.duration,
    positionSec: Number.isFinite(element.currentTime) ? element.currentTime : lastGoodPositionSec,
    expectedDurationSec,
    lastGoodPositionSec,
  });

const shouldTreatAsTrackEnd = (element: HTMLAudioElement): boolean => {
  if (isElementAtTrackEnd(element)) return true;
  if (!element.ended) return false;
  // Broken/empty files fire ended immediately — still advance so playback does not stall.
  if (!progressHasMoved && lastGoodPositionSec < 1.5) return true;
  const trusted = trustedDurationFor(element);
  return trusted > 0 && element.currentTime >= trusted - 1.5;
};

const isElementAtTrackEnd = (element: HTMLAudioElement): boolean => {
  const trusted = trustedDurationFor(element);
  const progressMs = (Number.isFinite(element.currentTime) ? element.currentTime : 0) * 1000;
  const durationMs = trusted * 1000;

  if (element.ended) {
    return elementReachedDecodedEnd(element);
  }

  if (!durationMs || durationMs <= 0 || Number.isNaN(durationMs)) return false;
  // A brand-new (or just-swapped) element can report a tiny/stale duration.
  // Never treat the first 1.5s as "ended" unless the element itself did.
  if (progressMs < minPlayedBeforeEndMs) return false;

  return progressMs >= durationMs - trackEndEpsilonMs;
};

export const recoverToSavedPosition = (play: boolean = true): void => {
  const element = getCurrentPlayerElement();
  if (!element?.src) return;
  if (pausedByUser && !play) return;
  if (shouldTreatAsTrackEnd(element)) return;

  retireStalePendingSeek(element.currentTime || 0);
  const target = pendingSeekSec != null ? pendingSeekSec : lastGoodPositionSec;
  const needsReload = Boolean(element.ended || element.error || element.readyState < 1);

  if (needsReload) {
    const src = element.src;
    element.src = src;
    element.load();
    if (target > 0) {
      pendingSeekSec = target;
      try {
        element.currentTime = target;
      } catch {
        // applied on canplay
      }
    }
    if (play && !pausedByUser) {
      playWhenReady(element, activePlayToken);
      startHiddenLoadRecovery(activePlayToken);
    }
    return;
  }

  if (target > 0 && Math.abs((element.currentTime || 0) - target) > positionDriftSec) {
    try {
      element.currentTime = target;
    } catch {
      pendingSeekSec = target;
    }
  }

  if (pendingSeekSec != null && Math.abs((element.currentTime || 0) - target) <= positionDriftSec) {
    pendingSeekSec = null;
  }

  if (play && !pausedByUser) {
    playWhenReady(element, activePlayToken);
  }
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
  lastAdvancedToSrc = nextTrackSrc;
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

export const unload = (opts?: { preserveKeepAlive?: boolean }): void => {
  console.log('%c--- player - unload ---', 'color:#a18507');
  stopHiddenLoadRecovery();
  // When handing off to DASH, keep the silent Web Audio oscillator running so
  // Tesla does not drop Bluetooth/media focus during the cold-load gap.
  if (!opts?.preserveKeepAlive) {
    stopAudioKeepAlive();
  }
  if (playerElement) {
    playerElement.loop = false;
    playerElement.pause();
    playerElement.src = '';
    playerElement.load();
  }
  if (standbyElement) {
    standbyElement.loop = false;
    standbyElement.pause();
    standbyElement.src = '';
    standbyElement.load();
  }
  nextTrackSrc = null;
  preloadedSrc = null;
  warmStartActive = false;
  lastKnownCurrentTime = 0;
  lastGoodPositionSec = 0;
  expectedDurationSec = 0;
  pendingSeekSec = null;
  lastAdvancedToSrc = null;
  clearGaplessTimer();
  advanceFired = false;
  hiddenPlayFailCount = 0;
  stopTrackEndPolling();
  if (!opts?.preserveKeepAlive && 'mediaSession' in navigator) {
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
        // Hard reload mid-track often kills Tesla media focus. Only do it near
        // the start of a track (or before progress has moved).
        const progressMs = (element.currentTime || 0) * 1000;
        if (!progressHasMoved || progressMs < midTrackReloadGuardMs) {
          reloadElementAndPlay(element, playToken, onSuccess);
        } else {
          // Soft recovery: keep trying play() without destroying the buffer.
          hiddenPlayFailCount = Math.floor(hiddenPlayReloadThreshold / 2);
          window.setTimeout(() => attemptElementPlay(element, playToken, 0, onSuccess), hiddenPlayRetryMs);
        }
      }
    });
};

const reloadElementAndPlay = (element: HTMLAudioElement, playToken: number, onSuccess: () => void): void => {
  const src = element.src;
  if (!src || pausedByUser || playToken !== activePlayToken) return;

  const savedTime = element.currentTime;
  // Avoid full load() when we already have a position mid-track — it resets the
  // network pipeline and can leave Tesla silent until the next user gesture.
  if (savedTime * 1000 >= midTrackReloadGuardMs && progressHasMoved) {
    hiddenPlayFailCount = 0;
    attemptElementPlay(element, playToken, 0, onSuccess);
    return;
  }

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

export const setManualPause = (paused: boolean): void => {
  pausedByUser = paused;
  if (!paused) return;
  warmStartActive = false;
  gaplessGeneration += 1;
  clearGaplessTimer();
  stopHiddenLoadRecovery();
  stopTrackEndPolling();
  stopAudioKeepAlive();
  if (playerElement) playerElement.loop = false;
  if ('mediaSession' in navigator) {
    navigator.mediaSession.playbackState = 'paused';
  }
};

export const loadTrack = (
  trackSrc: string,
  progress: number = 0,
  play: boolean = true,
  durationMs: number = 0
): void => {
  console.log('%c--- player - loadTrack ---', 'color:#a18507');
  gaplessGeneration += 1;
  stopHiddenLoadRecovery();
  resetTrackAdvanceLatch();
  hiddenPlayFailCount = 0;
  lastProgressSampleMs = 0;
  lastProgressSampleTime = 0;
  progressHasMoved = false;
  lastKnownCurrentTime = 0;
  expectedDurationSec = durationMs > 0 ? durationMs / 1000 : 0;
  lastGoodPositionSec = progress > 0 ? progress / 1000 : 0;
  pendingSeekSec = progress > 0 ? progress / 1000 : null;
  lastAdvancedToSrc = trackSrc;
  const playToken = ++activePlayToken;

  if (play) {
    setMediaSessionPlaying();
    ensureAudioKeepAlive();
  }

  if (playerElement) {
    playerElement.loop = false;
  }

  // Warm / gapless handoff already swapped to this src — do not reload or we
  // create a gap and stutter at the start of the next song.
  // A network/decode error leaves src in place. Reloading is the retry; play() on
  // the broken element fails and the queue then skips the song.
  if (playerElement && sameSrc(playerElement.src, trackSrc) && !playerElement.ended && !playerElement.error) {
    if (progress) {
      playerElement.currentTime = progress / 1000;
      lastGoodPositionSec = progress / 1000;
    }
    if (play) {
      if (playerElement.paused) {
        playWhenReady(playerElement, playToken);
        startHiddenLoadRecovery(playToken);
      } else if (!trackEndPollId) {
        startTrackEndPolling();
      }
      scheduleGaplessTimer();
    } else {
      stopTrackEndPolling();
    }
    return;
  }

  warmStartActive = false;
  clearGaplessTimer();

  if (tryAdoptStandby(trackSrc, progress, play, playToken)) {
    return;
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
  snapshotElementPosition(playerElement);
  setManualPause(true);
  if (playerElement) {
    playerElement.pause();
  }
  if (standbyElement) {
    standbyElement.pause();
  }
};

export const resume = (): void => {
  pausedByUser = false;
  if ('mediaSession' in navigator) {
    navigator.mediaSession.playbackState = 'playing';
  }
  ensureAudioKeepAlive();
  if (playerElement) {
    recoverToSavedPosition(true);
    Promise.resolve(playerElement.play())
      .then(() => startTrackEndPolling())
      .catch((_error: any) => {
        // Resume can be rejected when the element is not ready yet (common
        // after a long Tesla background freeze). Re-arm hidden load recovery so
        // the keep-alive poll can bring playback back instead of leaving it dead.
        recoverToSavedPosition(true);
        ensureHiddenLoadRecovery();
      });
  }
};

export const clearManualPauseFlag = (): void => {
  pausedByUser = false;
};

export const isManualPause = (): boolean => pausedByUser;

export const isPlaybackExpected = (): boolean => !pausedByUser;

const isZombiePlayback = (element: HTMLAudioElement): boolean => {
  // Element thinks it is playing, but currentTime has not advanced for too long.
  // Tesla does this when the media pipeline freezes under background throttling.
  if (element.paused || element.ended || !progressHasMoved) return false;
  if (lastProgressSampleTime === 0) return false;
  samplePlaybackProgress(element);
  if (isElementAtTrackEnd(element)) return false;
  const isHidden = typeof document !== 'undefined' && document.hidden;
  const stallMs = isHidden ? zombieStallMsHidden : zombieStallMsVisible;
  return Date.now() - lastProgressSampleTime >= stallMs;
};

export const ensureActivePlayback = (): void => {
  if (pausedByUser) return;

  const element = getCurrentPlayerElement();
  if (!element?.src) return;

  setMediaSessionPlaying();
  ensureAudioKeepAlive();

  if (shouldTreatAsTrackEnd(element)) {
    requestTrackAdvance();
    return;
  }

  if (element.ended || element.error) {
    recoverToSavedPosition(true);
    return;
  }

  if (element.paused) {
    const onPlaySuccess = () => startTrackEndPolling();
    beginPlaybackWhenReady(element, activePlayToken, () =>
      attemptElementPlay(element, activePlayToken, 0, onPlaySuccess)
    );
    return;
  }

  // Soft recover frozen "playing" elements without a hard load() mid-track.
  if (isZombiePlayback(element)) {
    const onPlaySuccess = () => startTrackEndPolling();
    // pause()+play() can unstick Tesla's decoder without discarding the buffer.
    try {
      element.pause();
    } catch {
      // ignore
    }
    beginPlaybackWhenReady(element, activePlayToken, () =>
      attemptElementPlay(element, activePlayToken, 0, onPlaySuccess)
    );
    if (typeof document !== 'undefined' && document.hidden) {
      ensureHiddenLoadRecovery();
    }
    return;
  }

  if (!trackEndPollId) {
    startTrackEndPolling();
  }
};

export const restart = (): void => {
  lastGoodPositionSec = 0;
  pendingSeekSec = null;
  if (playerElement) {
    try {
      playerElement.currentTime = 0;
    } catch {
      pendingSeekSec = 0;
    }
    playerElement.play().catch((_error: any) => null);
  }
};

export const setVolume = (volumeLevel: number): void => {
  const volume = volumeLevel / 100;
  if (playerElement) {
    playerElement.volume = volume;
  }
  if (standbyElement) {
    standbyElement.volume = volume;
  }
};

export const setProgress = (progress: number): void => {
  if (!playerElement) return;
  const target = Math.max(0, progress / 1000);
  lastGoodPositionSec = target;
  pendingSeekSec = target;
  try {
    playerElement.currentTime = target;
  } catch {
    // applied on canplay
  }
};

export const getCurrentProgress = (): number => {
  if (!playerElement) return 0;
  return getPlaybackProgressMs() / 1000;
};

export const getCurrentDuration = (): number => {
  if (!playerElement) return expectedDurationSec || 0;
  return trustedDurationFor(playerElement);
};

const startTrackEndPolling = (): void => {
  stopTrackEndPolling();
  trackEndPollMsCurrent = trackEndPollMs;

  const tick = () => {
    const element = getCurrentPlayerElement();
    if (!element || advanceFired) {
      trackEndPollId = window.setTimeout(tick, trackEndPollMsCurrent);
      return;
    }

    maybeWarmStartNext();

    const remaining = remainingMsOf(element);
    trackEndPollMsCurrent =
      Number.isFinite(remaining) && remaining <= nearEndPollRemainingMs ? trackEndNearEndPollMs : trackEndPollMs;

    // Also check when paused: Tesla may leave the element paused at track end.
    if (isElementAtTrackEnd(element)) {
      requestTrackAdvance();
      return;
    }

    if (element.paused && !pausedByUser && element.src) {
      ensureActivePlayback();
    }

    trackEndPollId = window.setTimeout(tick, trackEndPollMsCurrent);
  };

  trackEndPollId = window.setTimeout(tick, trackEndPollMsCurrent);
};

const stopTrackEndPolling = (): void => {
  if (trackEndPollId) {
    window.clearTimeout(trackEndPollId);
    window.clearInterval(trackEndPollId);
    trackEndPollId = null;
  }
};

export const runBackgroundPlaybackTick = (): void => {
  const element = getCurrentPlayerElement();
  if (!element || advanceFired) return;

  ensureAudioKeepAlive();
  maybeWarmStartNext();

  if (shouldTreatAsTrackEnd(element)) {
    requestTrackAdvance();
    return;
  }

  if (element.ended || element.error) {
    recoverToSavedPosition(true);
    return;
  }

  if (pausedByUser || !element.src) return;

  samplePlaybackProgress(element);

  if (element.paused || !isElementAudible(element) || isZombiePlayback(element)) {
    ensureActivePlayback();
    if (typeof document !== 'undefined' && document.hidden) {
      ensureHiddenLoadRecovery();
    }
  }

  if (typeof document !== 'undefined' && document.hidden) {
    const durationSec = element.duration || 0;
    syncHiddenMediaSession(element.currentTime || 0, durationSec > 0 ? durationSec : undefined);
  }
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
  if (!element) return 0;
  const live = Number.isFinite(element.currentTime) ? element.currentTime * 1000 : 0;
  const saved = lastGoodPositionSec * 1000;
  if (live < 500 && saved > 1500) return saved;
  const trustedMs = element ? trustedDurationFor(element) * 1000 : expectedDurationSec * 1000;
  if (trustedMs > 0 && saved + 2000 < trustedMs && live >= trustedMs - 150) return saved;
  if (live > 0) {
    lastGoodPositionSec = live / 1000;
    return live;
  }
  return saved;
};

/**
 * Called when the page becomes hidden (Tesla browser minimized).
 * Aggressively re-asserts playback intent so system auto-pause does not stick.
 */
export const handleBecameHidden = (): void => {
  if (pausedByUser) return;

  ensureAudioKeepAlive();
  setMediaSessionPlaying();
  maybeWarmStartNext();

  const element = getCurrentPlayerElement();
  if (!element?.src) return;

  if (shouldTreatAsTrackEnd(element)) {
    requestTrackAdvance();
    return;
  }

  if (element.ended || element.error) {
    recoverToSavedPosition(true);
    return;
  }

  if (element.paused || !isElementAudible(element) || isZombiePlayback(element)) {
    ensureActivePlayback();
    ensureHiddenLoadRecovery();
  }

  // Long burst of re-play attempts — Tesla often pauses right after hide and
  // again after tens of seconds when background throttling kicks in harder.
  becameHiddenBurstMs.forEach((delayMs) => {
    window.setTimeout(() => {
      if (pausedByUser) return;
      const el = getCurrentPlayerElement();
      if (!el?.src) return;
      if (shouldTreatAsTrackEnd(el)) {
        requestTrackAdvance();
        return;
      }
      if (el.ended || el.error) {
        recoverToSavedPosition(true);
        return;
      }
      if (el.paused || !isElementAudible(el) || isZombiePlayback(el)) {
        ensureActivePlayback();
        ensureHiddenLoadRecovery();
      }
      syncHiddenMediaSession();
      ensureAudioKeepAlive();
    }, delayMs);
  });
};
