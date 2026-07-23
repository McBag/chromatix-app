import { useEffect } from 'react';

import * as playerX from 'js/services/player';

interface MediaControlHandlers {
  play: () => void;
  pause: () => void;
  prev: () => void;
  next: () => void;
}

/**
 * Custom hook that sets up media control handlers for the browser's Media Session API.
 * Enables media controls in notifications, lock screens, and media control centers.
 *
 * Tesla note: the browser often fires a MediaSession "pause" when the app is
 * minimized. We ignore pause while document.hidden so background playback keeps
 * going; visible pauses (steering-wheel / OS controls while app is open) still
 * reach the app pause handler.
 */
const useMediaControls = (handlers: MediaControlHandlers): null => {
  useEffect(() => {
    if (!('mediaSession' in navigator)) {
      return undefined;
    }

    navigator.mediaSession.setActionHandler('play', () => {
      playerX.clearManualPauseFlag();
      playerX.ensureAudioKeepAlive();
      handlers.play();
      playerX.nudgeActivePlayback();
    });

    navigator.mediaSession.setActionHandler('pause', () => {
      // When the page is hidden, treat pause as a system minimize event — not a
      // user pause. Re-assert playing so Tesla does not leave the stream dead.
      if (typeof document !== 'undefined' && document.hidden) {
        if (playerX.isPlaybackExpected()) {
          navigator.mediaSession.playbackState = 'playing';
          playerX.nudgeActivePlayback();
          playerX.ensureAudioKeepAlive();
          playerX.handleBecameHidden();
        }
        return;
      }
      handlers.pause();
    });

    navigator.mediaSession.setActionHandler('seekbackward', handlers.prev);
    navigator.mediaSession.setActionHandler('seekforward', handlers.next);
    navigator.mediaSession.setActionHandler('previoustrack', handlers.prev);
    navigator.mediaSession.setActionHandler('nexttrack', handlers.next);

    return () => {
      if ('mediaSession' in navigator) {
        navigator.mediaSession.setActionHandler('play', null);
        navigator.mediaSession.setActionHandler('pause', null);
        navigator.mediaSession.setActionHandler('seekbackward', null);
        navigator.mediaSession.setActionHandler('seekforward', null);
        navigator.mediaSession.setActionHandler('previoustrack', null);
        navigator.mediaSession.setActionHandler('nexttrack', null);
      }
    };
  }, [handlers]);

  return null;
};

export default useMediaControls;
