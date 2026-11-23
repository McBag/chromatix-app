import { useEffect, useRef, useState } from 'react';
import { useSelector } from 'react-redux';

import { dlog } from 'js/debug/audioDebug';
import * as playerX from 'js/services/player';
import {
  describeMediaSessionPausePolicy,
  mediaSessionPausePolicy,
  subscribeMediaSessionPausePolicy,
} from 'js/services/mediaSessionPausePolicy';

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
// After an interruption by another source, the Tesla answers every new start of
// our audio with a media-session pause within ~30 ms, although it never pauses
// the element itself. A pause that close to an explicit play is not the user.
const playIntentPauseGuardMs = 2000;

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
  const [policyTick, setPolicyTick] = useState(0);

  useEffect(() => subscribeMediaSessionPausePolicy(() => setPolicyTick((tick) => tick + 1)), []);

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
      dlog('MS handlers noop (keyboardMediaKeys=0)');
      navigator.mediaSession.setActionHandler('play', noop);
      navigator.mediaSession.setActionHandler('pause', noop);
      navigator.mediaSession.setActionHandler('seekbackward', noop);
      navigator.mediaSession.setActionHandler('seekforward', noop);
      navigator.mediaSession.setActionHandler('previoustrack', noop);
      navigator.mediaSession.setActionHandler('nexttrack', noop);
    } else {
      navigator.mediaSession.setActionHandler('play', () => {
        dlog(
          `MS play accepted -> resume manualPause=${playerX.isManualPause() ? 1 : 0} ${describeMediaSessionPausePolicy()}`
        );
        playerX.clearManualPauseFlag();
        playerX.ensureAudioKeepAlive();
        handlersRef.current.play();
        playerX.nudgeActivePlayback();
      });

      navigator.mediaSession.setActionHandler('pause', () => {
        const sincePlay = playerX.msSincePlayIntent();
        if (sincePlay < playIntentPauseGuardMs) {
          dlog(`MS pause IGNORED (${sincePlay} ms after play)`);
          navigator.mediaSession.playbackState = 'playing';
          return;
        }
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
        dlog('MS pause accepted -> playerPause (hold session)');
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

      if (mediaSessionPausePolicy.registerMediaSessionStopAsPause) {
        dlog('MS stop handler registered (maps to pause)');
        navigator.mediaSession.setActionHandler('stop', () => {
          const sincePlay = playerX.msSincePlayIntent();
          if (sincePlay < playIntentPauseGuardMs) {
            dlog(`MS stop IGNORED (${sincePlay} ms after play)`);
            navigator.mediaSession.playbackState = 'playing';
            return;
          }
          dlog('MS stop accepted -> treated as pause (session held)');
          handlersRef.current.pause();
        });
      } else {
        navigator.mediaSession.setActionHandler('stop', null);
      }

      dlog(
        `MS handlers ready keys=1 play=1 pause=1 stop=${mediaSessionPausePolicy.registerMediaSessionStopAsPause ? 1 : 0} ${describeMediaSessionPausePolicy()}`
      );
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
        navigator.mediaSession.setActionHandler('stop', null);
      }
    };
  }, [keyboardMediaKeys, policyTick]);

  return null;
};

export default useMediaControls;
