import { useEffect, useRef } from 'react';
import { useSelector } from 'react-redux';

import * as playerX from 'js/services/player';

const hiddenPollMs = 250;
const visiblePollMs = 3000;

const useTeslaOptimization = (): null => {
  const playerPlaying = useSelector(({ playerModel }: any) => playerModel.playerPlaying);
  const manualPause = useSelector(({ sessionModel }: any) => sessionModel._manualPause);
  const playingTrackIndex = useSelector(({ sessionModel }: any) => sessionModel.playingTrackIndex);
  const playingTrackKeys = useSelector(({ sessionModel }: any) => sessionModel.playingTrackKeys);
  const playingTrackList = useSelector(({ sessionModel }: any) => sessionModel.playingTrackList);

  const pollIdRef = useRef<number | null>(null);
  const playerPlayingRef = useRef(playerPlaying);
  const manualPauseRef = useRef(manualPause);
  playerPlayingRef.current = playerPlaying;
  manualPauseRef.current = manualPause;

  useEffect(() => {
    if (!playerPlaying || manualPause || !('mediaSession' in navigator)) {
      if (pollIdRef.current != null) {
        window.clearInterval(pollIdRef.current);
        pollIdRef.current = null;
      }
      return undefined;
    }

    const syncMediaSession = () => {
      if (!playerPlayingRef.current || manualPauseRef.current) return;

      const trackKey = playingTrackKeys?.[playingTrackIndex];
      const currentTrack = trackKey != null ? playingTrackList?.[trackKey] : null;
      const elementDurationSec = playerX.getCurrentDuration();
      const storeDurationSec = currentTrack?.duration ? currentTrack.duration / 1000 : 0;
      const durationSec = elementDurationSec > 0 ? elementDurationSec : storeDurationSec;
      const positionSec = playerX.getPlaybackProgressMs() / 1000;

      // Only position/playbackState — do NOT re-set full metadata here.
      // Constant MediaMetadata recreation cancels Tesla cover loads.
      playerX.syncHiddenMediaSession(positionSec, durationSec > 0 ? durationSec : undefined);
      playerX.ensureAudioKeepAlive();

      // While minimized, re-nudge if the element was auto-paused by the OS.
      if (document.hidden && !playerX.isActivePlaybackAudible()) {
        playerX.nudgeActivePlayback();
        playerX.ensureHiddenLoadRecovery();
      }
    };

    const startMediaSessionPoll = () => {
      if (pollIdRef.current != null) {
        window.clearInterval(pollIdRef.current);
      }
      const pollMs = document.hidden ? hiddenPollMs : visiblePollMs;
      pollIdRef.current = window.setInterval(syncMediaSession, pollMs);
    };

    syncMediaSession();
    startMediaSessionPoll();

    const handleVisibility = () => {
      syncMediaSession();
      if (document.hidden && playerPlayingRef.current && !manualPauseRef.current) {
        playerX.handleBecameHidden();
      }
      startMediaSessionPoll();
    };

    document.addEventListener('visibilitychange', handleVisibility);

    return () => {
      if (pollIdRef.current != null) {
        window.clearInterval(pollIdRef.current);
        pollIdRef.current = null;
      }
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, [manualPause, playerPlaying, playingTrackIndex, playingTrackKeys, playingTrackList]);

  return null;
};

export default useTeslaOptimization;
