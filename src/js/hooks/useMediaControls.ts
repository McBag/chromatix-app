import { useEffect, useRef } from 'react';
import { useSelector } from 'react-redux';

import * as playerX from 'js/services/player';

interface MediaControlHandlers {
  play: () => void;
  pause: () => void;
  prev: () => void;
  next: () => void;
}

interface SeekDetails {
  seekOffset?: number;
}

const hiddenPauseGraceMs = 4000;

/**
 * Media Session owner for play, pause, skip, and in-track seek.
 * Hardware media keys are included. A pause in the first moments after the
 * page hides is treated as the Tesla browser minimising; a later pause while
 * audio is actually playing is a steering-wheel pause.
 */
const useMediaControls = (handlers: MediaControlHandlers): null => {
  const keyboardMediaKeys = useSelector(
    ({ sessionModel }: { sessionModel: { keyboardMediaKeys: boolean } }) => sessionModel.keyboardMediaKeys
  );
  const handlersRef = useRef(handlers);
  handlersRef.current = handlers;
  const hiddenAtRef = useRef(0);
  const lastSystemPauseAtRef = useRef(0);

  useEffect(() => {
    if (!('mediaSession' in navigator)) {
      return undefined;
    }

    const noop = (): void => {};

    const seekBy = (direction: -1 | 1, offsetSec?: number): void => {
      const skipMs = (offsetSec && offsetSec > 0 ? offsetSec : 10) * 1000;
      const position = playerX.getPlaybackProgressMs();
      const duration = playerX.getCurrentDuration() * 1000;
      const next = position + direction * skipMs;
      const clamped = duration > 0 ? Math.min(Math.max(0, next), Math.max(0, duration - 250)) : Math.max(0, next);
      playerX.setProgress(clamped);
    };

    if (!keyboardMediaKeys) {
      navigator.mediaSession.setActionHandler('play', noop);
      navigator.mediaSession.setActionHandler('pause', noop);
      navigator.mediaSession.setActionHandler('seekbackward', noop);
      navigator.mediaSession.setActionHandler('seekforward', noop);
      navigator.mediaSession.setActionHandler('previoustrack', noop);
      navigator.mediaSession.setActionHandler('nexttrack', noop);
    } else {
      navigator.mediaSession.setActionHandler('play', () => {
        playerX.clearManualPauseFlag();
        playerX.ensureAudioKeepAlive();
        handlersRef.current.play();
        playerX.nudgeActivePlayback();
      });

      navigator.mediaSession.setActionHandler('pause', () => {
        if (typeof document !== 'undefined' && document.hidden) {
          if (!playerX.isPlaybackExpected()) return;
          const now = Date.now();
          const sinceHide = hiddenAtRef.current ? now - hiddenAtRef.current : hiddenPauseGraceMs;
          const sinceSystem = now - lastSystemPauseAtRef.current;
          const settled = sinceHide >= hiddenPauseGraceMs && sinceSystem >= hiddenPauseGraceMs;
          if (settled && playerX.isActivePlaybackAudible()) {
            handlersRef.current.pause();
            return;
          }
          lastSystemPauseAtRef.current = now;
          navigator.mediaSession.playbackState = 'playing';
          playerX.nudgeActivePlayback();
          playerX.ensureAudioKeepAlive();
          playerX.handleBecameHidden();
          return;
        }
        handlersRef.current.pause();
      });

      navigator.mediaSession.setActionHandler('seekbackward', (details: SeekDetails | null) => {
        seekBy(-1, details?.seekOffset);
      });
      navigator.mediaSession.setActionHandler('seekforward', (details: SeekDetails | null) => {
        seekBy(1, details?.seekOffset);
      });
      navigator.mediaSession.setActionHandler('previoustrack', () => {
        handlersRef.current.prev();
      });
      navigator.mediaSession.setActionHandler('nexttrack', () => {
        handlersRef.current.next();
      });
    }

    const handleVisibility = (): void => {
      if (document.hidden) {
        hiddenAtRef.current = Date.now();
        lastSystemPauseAtRef.current = Date.now();
      }
    };
    document.addEventListener('visibilitychange', handleVisibility);

    return () => {
      document.removeEventListener('visibilitychange', handleVisibility);
      if ('mediaSession' in navigator) {
        navigator.mediaSession.setActionHandler('play', null);
        navigator.mediaSession.setActionHandler('pause', null);
        navigator.mediaSession.setActionHandler('seekbackward', null);
        navigator.mediaSession.setActionHandler('seekforward', null);
        navigator.mediaSession.setActionHandler('previoustrack', null);
        navigator.mediaSession.setActionHandler('nexttrack', null);
      }
    };
  }, [keyboardMediaKeys]);

  return null;
};

export default useMediaControls;
