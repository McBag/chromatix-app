import { useEffect, useRef } from 'react';
import { useDispatch, useSelector } from 'react-redux';

import * as playerX from 'js/services/player';

const hiddenPollMs = 100;
const visiblePollMs = 500;
// Main-thread fallback while hidden — Tesla throttles intervals hard; keep a slow pulse.
const hiddenMainFallbackMs = 500;
const wallClockEndEpsilonMs = 100;
// Long recovery window after track change / minimize — Tesla re-kills streams late.
const hiddenRecoveryBurstMs = [0, 100, 250, 500, 1000, 2000, 4000, 8000, 15000, 30000, 45000, 60000, 90000, 120000];

/**
 * Background timer that is less throttled than main-thread setInterval when the
 * tab is minimized (critical for Tesla browser multi-song auto-next).
 * Uses both setInterval and a self-rescheduling setTimeout chain — some WebViews
 * suspend one path while leaving the other runnable.
 */
const createKeepAliveWorker = (): Worker | null => {
  if (typeof Worker === 'undefined') return null;

  try {
    const workerSource = `
      var intervalId = null;
      var timeoutId = null;
      var tickMs = 100;
      function clearAll() {
        if (intervalId !== null) { clearInterval(intervalId); intervalId = null; }
        if (timeoutId !== null) { clearTimeout(timeoutId); timeoutId = null; }
      }
      function chainTick() {
        self.postMessage({ type: 'tick' });
        timeoutId = setTimeout(chainTick, tickMs);
      }
      self.onmessage = function (event) {
        var data = event.data || {};
        if (data.type === 'start') {
          clearAll();
          tickMs = typeof data.ms === 'number' ? data.ms : 100;
          intervalId = setInterval(function () {
            self.postMessage({ type: 'tick' });
          }, tickMs);
          // Parallel timeout chain — survives some WebView interval freezes.
          timeoutId = setTimeout(chainTick, tickMs);
        } else if (data.type === 'stop') {
          clearAll();
        }
      };
    `;
    const blob = new Blob([workerSource], { type: 'application/javascript' });
    return new Worker(URL.createObjectURL(blob));
  } catch {
    return null;
  }
};

const usePlaybackKeepAlive = (): null => {
  const dispatch = useDispatch();
  const trackStartRef = useRef<number | null>(null);
  const lastTrackKeyRef = useRef<number | null>(null);
  const trackChangedAtRef = useRef(0);
  const workerRef = useRef<Worker | null>(null);
  const pollIdRef = useRef<number | null>(null);

  const playerPlaying = useSelector(({ playerModel }: any) => playerModel.playerPlaying);
  const manualPause = useSelector(({ sessionModel }: any) => sessionModel._manualPause);
  const playingTrackIndex = useSelector(({ sessionModel }: any) => sessionModel.playingTrackIndex);
  const playingTrackKeys = useSelector(({ sessionModel }: any) => sessionModel.playingTrackKeys);
  const playingTrackList = useSelector(({ sessionModel }: any) => sessionModel.playingTrackList);
  const playingTrackCount = useSelector(({ sessionModel }: any) => sessionModel.playingTrackCount);
  const playingAlbumId = useSelector(({ sessionModel }: any) => sessionModel.playingAlbumId);
  const autoPlayPreviousAlbumOnAlbumEnd = useSelector(
    ({ sessionModel }: any) => sessionModel.autoPlayPreviousAlbumOnAlbumEnd
  );
  const adjacentAlbumPrefetched = useSelector(({ sessionModel }: any) => sessionModel._adjacentAlbumPrefetched);
  const lastPrefetchKickRef = useRef(0);
  const chainTimeoutRef = useRef<number | null>(null);
  const lastTickAtRef = useRef(0);
  const playerPlayingRef = useRef(playerPlaying);
  const manualPauseRef = useRef(manualPause);

  playerPlayingRef.current = playerPlaying;
  manualPauseRef.current = manualPause;

  useEffect(() => {
    const trackKey = playingTrackKeys?.[playingTrackIndex];
    if (trackKey !== lastTrackKeyRef.current) {
      lastTrackKeyRef.current = trackKey ?? null;
      trackStartRef.current = null; // defer wall-clock seed until we have actual playback progress (prevents premature advance after buffering delay on track switch)
      trackChangedAtRef.current = Date.now();

      if (document.hidden && playerPlaying && !manualPause) {
        playerX.ensureAudioKeepAlive();
        playerX.handleBecameHidden();
        hiddenRecoveryBurstMs.forEach((delayMs) => {
          window.setTimeout(() => {
            if (manualPauseRef.current || !playerPlayingRef.current) return;
            playerX.ensureAudioKeepAlive();
            playerX.nudgeActivePlayback();
            if (!playerX.isActivePlaybackAudible()) {
              playerX.ensureHiddenLoadRecovery();
            }
          }, delayMs);
        });
      }

      // Kick adjacent-album prefetch on every track change while autoplay is on
      // (covers Tesla where setTimeout from load handlers was throttled away).
      if (playerPlaying && !manualPause) {
        dispatch.playerModel.updateNextTrack();
      }
      if (playerPlaying && !manualPause && autoPlayPreviousAlbumOnAlbumEnd && !adjacentAlbumPrefetched) {
        window.setTimeout(() => dispatch.playerModel.prefetchAdjacentAlbum(), 0);
      }
    }
  }, [
    adjacentAlbumPrefetched,
    autoPlayPreviousAlbumOnAlbumEnd,
    dispatch,
    manualPause,
    playerPlaying,
    playingTrackIndex,
    playingTrackKeys,
  ]);

  useEffect(() => {
    const runTick = () => {
      if (!playerPlayingRef.current || manualPauseRef.current) return;

      // Deduplicate ticks when worker + main interval fire close together.
      const now = Date.now();
      if (now - lastTickAtRef.current < 40) return;
      lastTickAtRef.current = now;

      playerX.runBackgroundPlaybackTick();
      playerX.ensureAudioKeepAlive();
      playerX.maybeWarmStartNext();

      const trackKey = playingTrackKeys?.[playingTrackIndex];
      const currentTrack = trackKey != null ? playingTrackList?.[trackKey] : null;
      const elementDurationMs = playerX.getCurrentDuration() * 1000;
      // Prefer the live element duration. Metadata that is a few seconds short
      // used to trip auto-next before the file actually ended.
      const durationMs = elementDurationMs > 1000 ? elementDurationMs : currentTrack?.duration || 0;

      // Seed wall-clock start from real playback progress (deferred so buffering
      // at track start does not cut the song short). Pure wall-clock without a
      // progress near-end check used to skip mid-track after long stalls.
      const playedMs = playerX.getPlaybackProgressMs();
      const sinceTrackChange = Date.now() - trackChangedAtRef.current;
      if (!trackStartRef.current) {
        // Ignore stale progress from the previous track during the cold-load gap.
        if (!(sinceTrackChange < 2500 && playedMs > 1000)) {
          trackStartRef.current = Date.now() - playedMs;
        }
      }
      const trackStart = trackStartRef.current;

      // Advance only when we are actually near the end of the track.
      // Never fire in the first 2.5s after a swap (stale currentTime / duration
      // from the previous element used to skip song 4).
      if (durationMs > 0 && sinceTrackChange >= 2500 && playedMs >= 2000) {
        const nearEndByProgress = playedMs >= durationMs - wallClockEndEpsilonMs;
        const progressNearEnd = playedMs >= Math.max(durationMs * 0.85, durationMs - 15000);
        const wallPastEnd =
          Boolean(trackStart) && Date.now() - (trackStart as number) >= durationMs + 2000 && progressNearEnd;
        if (nearEndByProgress || wallPastEnd) {
          playerX.requestTrackAdvance();
        }
      }

      // Near end of last album track(s): keep kicking prefetch so Tesla background
      // network has the next album queued before silence would kill media focus.
      if (autoPlayPreviousAlbumOnAlbumEnd && !adjacentAlbumPrefetched) {
        const nearQueueEnd =
          playingTrackCount != null &&
          playingTrackIndex != null &&
          playingTrackIndex >= Math.max(0, playingTrackCount - 3);
        const albumId = playingAlbumId || currentTrack?.albumId;
        let remainingInAlbum = 0;
        if (albumId != null && playingTrackKeys && playingTrackIndex != null) {
          for (let i = playingTrackIndex; i < playingTrackKeys.length; i++) {
            const t = playingTrackList?.[playingTrackKeys[i]];
            if (t?.albumId != null && String(t.albumId) === String(albumId)) remainingInAlbum++;
            else if (i > playingTrackIndex) break;
          }
        }
        const nearAlbumEnd = remainingInAlbum > 0 && remainingInAlbum <= 3;
        const nearTrackEnd = durationMs > 0 && playedMs > 0 && durationMs - playedMs < 45000;
        if (nearQueueEnd || nearAlbumEnd || (nearTrackEnd && remainingInAlbum === 1)) {
          if (now - lastPrefetchKickRef.current > 4000) {
            lastPrefetchKickRef.current = now;
            dispatch.playerModel.prefetchAdjacentAlbum();
          }
        }
      }

      if (!playerX.isActivePlaybackAudible()) {
        if (document.hidden) {
          playerX.ensureHiddenLoadRecovery();
        }
        playerX.nudgeActivePlayback();
      }
    };

    const clearMainPoll = () => {
      if (pollIdRef.current != null) {
        window.clearInterval(pollIdRef.current);
        pollIdRef.current = null;
      }
    };

    const clearChainTimeout = () => {
      if (chainTimeoutRef.current != null) {
        window.clearTimeout(chainTimeoutRef.current);
        chainTimeoutRef.current = null;
      }
    };

    const stopWorker = () => {
      if (workerRef.current) {
        try {
          workerRef.current.postMessage({ type: 'stop' });
        } catch {
          // ignore
        }
      }
    };

    /** Main-thread cascading timeout — some Tesla builds throttle setInterval harder. */
    const scheduleChain = (ms: number) => {
      clearChainTimeout();
      const tick = () => {
        runTick();
        chainTimeoutRef.current = window.setTimeout(tick, ms);
      };
      chainTimeoutRef.current = window.setTimeout(tick, ms);
    };

    const schedulePoll = () => {
      clearMainPoll();
      clearChainTimeout();
      stopWorker();

      const ms = document.hidden ? hiddenPollMs : visiblePollMs;

      // Prefer worker timer when hidden — less throttled than main thread.
      if (document.hidden) {
        if (!workerRef.current) {
          workerRef.current = createKeepAliveWorker();
          if (workerRef.current) {
            workerRef.current.onmessage = () => runTick();
          }
        }
        if (workerRef.current) {
          try {
            workerRef.current.postMessage({ type: 'start', ms });
            // Faster main-thread fallback + cascading timeout if worker is suspended.
            pollIdRef.current = window.setInterval(runTick, hiddenMainFallbackMs);
            scheduleChain(hiddenMainFallbackMs);
            return;
          } catch {
            // fall through to main-thread interval
          }
        }
        // No worker: dual main-thread paths.
        pollIdRef.current = window.setInterval(runTick, ms);
        scheduleChain(ms);
        return;
      }

      pollIdRef.current = window.setInterval(runTick, ms);
    };

    const handleVisibilityChange = () => {
      if (document.hidden) {
        runTick();
        if (!manualPauseRef.current && playerPlayingRef.current) {
          playerX.ensureAudioKeepAlive();
          playerX.handleBecameHidden();
          playerX.nudgeActivePlayback();
          hiddenRecoveryBurstMs.forEach((delayMs) => {
            window.setTimeout(() => {
              if (manualPauseRef.current || !playerPlayingRef.current) return;
              playerX.ensureAudioKeepAlive();
              playerX.nudgeActivePlayback();
              if (!playerX.isActivePlaybackAudible()) {
                playerX.ensureHiddenLoadRecovery();
              }
            }, delayMs);
          });
        }
      } else if (playerPlayingRef.current && !manualPauseRef.current && !playerX.isActivePlaybackAudible()) {
        dispatch.playerModel.playerResume();
      } else if (playerPlayingRef.current && !manualPauseRef.current) {
        playerX.nudgeActivePlayback();
        playerX.ensureAudioKeepAlive();
      }
      schedulePoll();
    };

    const handlePageShow = () => {
      if (playerPlayingRef.current && !manualPauseRef.current && !playerX.isActivePlaybackAudible()) {
        dispatch.playerModel.playerResume();
      }
    };

    const handleBackgroundLifecycle = () => {
      if (document.hidden) {
        runTick();
        if (!manualPauseRef.current && playerPlayingRef.current) {
          playerX.ensureAudioKeepAlive();
          playerX.handleBecameHidden();
        }
      }
    };

    // Keep MediaSession play/pause handlers from dropping us while hidden.
    const handleFocus = () => {
      if (playerPlayingRef.current && !manualPauseRef.current) {
        playerX.ensureAudioKeepAlive();
        playerX.nudgeActivePlayback();
      }
    };

    schedulePoll();
    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('pageshow', handlePageShow);
    window.addEventListener('focus', handleFocus);
    document.addEventListener('freeze', handleBackgroundLifecycle);
    window.addEventListener('pagehide', handleBackgroundLifecycle);

    return () => {
      clearMainPoll();
      clearChainTimeout();
      stopWorker();
      if (workerRef.current) {
        try {
          workerRef.current.terminate();
        } catch {
          // ignore
        }
        workerRef.current = null;
      }
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('pageshow', handlePageShow);
      window.removeEventListener('focus', handleFocus);
      document.removeEventListener('freeze', handleBackgroundLifecycle);
      window.removeEventListener('pagehide', handleBackgroundLifecycle);
    };
  }, [
    adjacentAlbumPrefetched,
    autoPlayPreviousAlbumOnAlbumEnd,
    dispatch,
    manualPause,
    playerPlaying,
    playingAlbumId,
    playingTrackCount,
    playingTrackIndex,
    playingTrackKeys,
    playingTrackList,
  ]);

  useEffect(() => {
    if (!playerPlaying || manualPause || !('wakeLock' in navigator)) {
      return undefined;
    }

    let wakeLock: {
      release: () => Promise<void>;
      addEventListener: (type: string, listener: () => void) => void;
    } | null = null;
    let cancelled = false;

    const acquireWakeLock = async () => {
      try {
        if (cancelled || wakeLock || !navigator.wakeLock) return;
        wakeLock = await navigator.wakeLock.request('screen');
        wakeLock.addEventListener('release', () => {
          wakeLock = null;
        });
      } catch {
        // Wake lock may be unavailable in some Tesla browser builds.
      }
    };

    const releaseWakeLock = async () => {
      try {
        await wakeLock?.release();
      } catch {
        // ignore
      }
      wakeLock = null;
    };

    acquireWakeLock();

    const handleVisibility = () => {
      if (document.visibilityState === 'visible' && playerPlaying && !manualPause) {
        acquireWakeLock();
      }
    };

    document.addEventListener('visibilitychange', handleVisibility);

    return () => {
      cancelled = true;
      document.removeEventListener('visibilitychange', handleVisibility);
      releaseWakeLock();
    };
  }, [manualPause, playerPlaying]);

  return null;
};

export default usePlaybackKeepAlive;
