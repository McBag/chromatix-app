import { useEffect, useRef } from 'react';
import { useDispatch, useSelector } from 'react-redux';

import * as playerX from 'js/services/player';

const hiddenPollMs = 100;
const visiblePollMs = 500;
const wallClockEndEpsilonMs = 100;
const hiddenRecoveryBurstMs = [0, 150, 400, 800, 1500, 3000, 5000, 10000, 15000, 30000];

/**
 * Background timer that is less throttled than main-thread setInterval when the
 * tab is minimized (critical for Tesla browser multi-song auto-next).
 */
const createKeepAliveWorker = (): Worker | null => {
  if (typeof Worker === 'undefined') return null;

  try {
    const workerSource = `
      let intervalId = null;
      self.onmessage = function (event) {
        var data = event.data || {};
        if (data.type === 'start') {
          if (intervalId !== null) clearInterval(intervalId);
          var ms = typeof data.ms === 'number' ? data.ms : 100;
          intervalId = setInterval(function () {
            self.postMessage({ type: 'tick' });
          }, ms);
        } else if (data.type === 'stop') {
          if (intervalId !== null) {
            clearInterval(intervalId);
            intervalId = null;
          }
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

  useEffect(() => {
    const trackKey = playingTrackKeys?.[playingTrackIndex];
    if (trackKey !== lastTrackKeyRef.current) {
      lastTrackKeyRef.current = trackKey ?? null;
      trackStartRef.current = null; // defer wall-clock seed until we have actual playback progress (prevents premature advance after buffering delay on track switch)
      trackChangedAtRef.current = Date.now();

      if (document.hidden && playerPlaying && !manualPause) {
        playerX.ensureAudioKeepAlive();
        hiddenRecoveryBurstMs.forEach((delayMs) => {
          window.setTimeout(() => playerX.nudgeActivePlayback(), delayMs);
        });
      }

      // Kick adjacent-album prefetch on every track change while autoplay is on
      // (covers Tesla where setTimeout from load handlers was throttled away).
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
      if (!playerPlaying || manualPause) return;

      playerX.runBackgroundPlaybackTick();
      playerX.ensureAudioKeepAlive();

      const trackKey = playingTrackKeys?.[playingTrackIndex];
      const currentTrack = trackKey != null ? playingTrackList?.[trackKey] : null;
      const durationMs = currentTrack?.duration || playerX.getCurrentDuration() * 1000;

      // Seed / calibrate wall-clock start using the element's current position.
      // This is deferred (see track key effect) so that initial buffering delay
      // does not cause wall-clock to fire early and cut the track short.
      // When element stalls in background, real-time keeps ticking from last known position.
      const playedMs = playerX.getPlaybackProgressMs();
      if (!trackStartRef.current) {
        const sinceTrackChange = Date.now() - trackChangedAtRef.current;
        // Ignore stale progress from the previous track during the cold-load gap.
        if (!(sinceTrackChange < 2000 && playedMs > 1000)) {
          trackStartRef.current = Date.now() - playedMs;
        }
      }
      const trackStart = trackStartRef.current;

      if (durationMs > 0 && trackStart && Date.now() - trackStart >= durationMs - wallClockEndEpsilonMs) {
        playerX.requestTrackAdvance();
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
          const now = Date.now();
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

    const stopWorker = () => {
      if (workerRef.current) {
        try {
          workerRef.current.postMessage({ type: 'stop' });
        } catch {
          // ignore
        }
      }
    };

    const schedulePoll = () => {
      clearMainPoll();
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
            // Keep a slow main-thread fallback in case the worker is suspended.
            pollIdRef.current = window.setInterval(runTick, 1000);
            return;
          } catch {
            // fall through to main-thread interval
          }
        }
      }

      pollIdRef.current = window.setInterval(runTick, ms);
    };

    const handleVisibilityChange = () => {
      if (document.hidden) {
        runTick();
        if (!manualPause && playerPlaying) {
          playerX.handleBecameHidden();
          playerX.nudgeActivePlayback();
        }
      } else if (playerPlaying && !manualPause && !playerX.isActivePlaybackAudible()) {
        dispatch.playerModel.playerResume();
      } else if (playerPlaying && !manualPause) {
        playerX.nudgeActivePlayback();
        playerX.ensureAudioKeepAlive();
      }
      schedulePoll();
    };

    const handlePageShow = () => {
      if (playerPlaying && !manualPause && !playerX.isActivePlaybackAudible()) {
        dispatch.playerModel.playerResume();
      }
    };

    const handleBackgroundLifecycle = () => {
      if (document.hidden) {
        runTick();
        if (!manualPause && playerPlaying) {
          playerX.handleBecameHidden();
        }
      }
    };

    schedulePoll();
    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('pageshow', handlePageShow);
    document.addEventListener('freeze', handleBackgroundLifecycle);
    window.addEventListener('pagehide', handleBackgroundLifecycle);

    return () => {
      clearMainPoll();
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
