// ======================================================================
// IMPORTS
// ======================================================================

import { useCallback, useEffect, useRef, useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import * as playerX from 'js/services/player';

// ======================================================================
// TYPES
// ======================================================================

interface UsePlayerProgressOptions {
  updateStore?: boolean;
}

interface UsePlayerProgressReturn {
  trackProgress: number;
  trackProgressCurrent: number;
  trackProgressMax: number;
  handleProgressChange: (value: number) => void;
  handleProgressMouseDown: () => void;
  handleProgressMouseUp: (value?: number) => void;
  isDisabled: boolean;
}

// ======================================================================
// HOOK
// ======================================================================

const usePlayerProgress = (options: UsePlayerProgressOptions = {}): UsePlayerProgressReturn => {
  const { updateStore = true } = options;

  const dispatch = useDispatch();

  const counterRef = useRef(0);
  const didMountRef = useRef(false);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const mouseDownRef = useRef(false);

  const playerInited = useSelector(({ playerModel }: any) => playerModel.playerInited);
  const playerInteractionCount = useSelector(({ playerModel }: any) => playerModel.playerInteractionCount);

  const playingTrackList = useSelector(({ sessionModel }: any) => sessionModel.playingTrackList);
  const playingTrackIndex = useSelector(({ sessionModel }: any) => sessionModel.playingTrackIndex);
  const playingTrackKeys = useSelector(({ sessionModel }: any) => sessionModel.playingTrackKeys);

  const [trackProgress, setTrackProgress] = useState(playerX.getCurrentProgress() * 1000 || 0);
  const latestProgressRef = useRef(trackProgress);
  latestProgressRef.current = trackProgress;

  const realIndex = playingTrackKeys?.[playingTrackIndex];
  const trackCurrent = playingTrackList?.[realIndex];
  const isDisabled = !trackCurrent;

  const trackProgressCurrent = trackProgress / 1000;
  const trackProgressMax = trackCurrent?.duration ? trackCurrent?.duration / 1000 : 0;

  // Handle progress change
  const handleProgressChange = useCallback(
    (value: number) => {
      const ms = value * 1000;
      latestProgressRef.current = ms;
      setTrackProgress(ms);
      if (updateStore) {
        dispatch.playerModel.playerProgress(ms);
      }
    },
    [dispatch, updateStore]
  );

  // Handle mouse down (on scrubber)
  const handleProgressMouseDown = useCallback(() => {
    mouseDownRef.current = true;
  }, []);

  // Handle mouse up (on scrubber)
  const handleProgressMouseUp = useCallback(
    (value?: number) => {
      mouseDownRef.current = false;
      const ms = typeof value === 'number' && Number.isFinite(value) ? value * 1000 : latestProgressRef.current;
      latestProgressRef.current = ms;
      setTrackProgress(ms);
      playerX.setProgress(ms);
      if (updateStore) {
        dispatch.playerModel.playerProgress(ms);
      }
    },
    [dispatch, updateStore]
  );

  // Handle track progress updates
  const updateTrackProgress = useCallback(() => {
    if (!mouseDownRef.current) {
      const newTrackProgress = Math.round(playerX.getCurrentProgress()) * 1000;
      setTrackProgress(newTrackProgress);

      if (updateStore) {
        // Only update redux every 30 seconds to avoid triggering store persistence
        counterRef.current += 1;
        if (counterRef.current === 30) {
          dispatch.playerModel.playerProgress(newTrackProgress);
          counterRef.current = 0;
        }
      }
    }
  }, [dispatch, updateStore]);

  // Whilst track is playing, update track progress (faster when tab is hidden)
  useEffect(() => {
    if (playerInited) {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
      }

      const getIntervalMs = () => {
        if (document.hidden) return 250;
        return 1000;
      };

      intervalRef.current = setInterval(updateTrackProgress, getIntervalMs());

      const handleVisibility = () => {
        if (!playerInited || !intervalRef.current) return;
        clearInterval(intervalRef.current);
        intervalRef.current = setInterval(updateTrackProgress, getIntervalMs());
      };

      document.addEventListener('visibilitychange', handleVisibility);

      return () => {
        document.removeEventListener('visibilitychange', handleVisibility);
        if (intervalRef.current) {
          clearInterval(intervalRef.current);
        }
      };
    }
    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
      }
    };
  }, [playerInited, playingTrackIndex, updateTrackProgress]);

  // If a new track is selected, reset track progress
  useEffect(() => {
    if (didMountRef.current) {
      counterRef.current = 0;
      setTrackProgress(0);
    } else {
      didMountRef.current = true;
    }
  }, [realIndex, playerInteractionCount]);

  return {
    trackProgress,
    trackProgressCurrent,
    trackProgressMax,
    handleProgressChange,
    handleProgressMouseDown,
    handleProgressMouseUp,
    isDisabled,
  };
};

export default usePlayerProgress;
