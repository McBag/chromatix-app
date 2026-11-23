import { logMediaSessionArtwork } from 'js/debug/debugLog';
import { mediaSessionPausePolicy, subscribeMediaSessionPausePolicy } from 'js/services/mediaSessionPausePolicy';

interface MediaArtwork {
  src: string;
  sizes?: string;
  type?: string;
}

interface TrackLike {
  title?: string;
  artist?: string;
  album?: string;
  albumId?: string | number;
  thumbSm?: string;
  thumbMd?: string;
  /** Pre-built MediaSession artwork (e.g. from ControlBar). Preferred over thumbs. */
  artwork?: MediaArtwork[];
}

export type TeslaSetMetadataOptions = {
  /** Bypass identical-metadata dedupe and assign a new MediaMetadata (Tesla artwork retry). */
  forceRetry?: boolean;
};

/** Delay after the `playing` event before the one-shot Media Session artwork retry. */
export const mediaSessionArtworkRetryMs = 1500;

/**
 * Tesla media player line 1 (`title`): the plain track title.
 * Unicode (including German umlauts) is kept as-is.
 */
export const formatMediaSessionTitle = (title?: string): string => {
  return (title || '').trim() || 'Chromatix';
};

/**
 * Tesla media player line 2 (`artist`): "Artist - Album" when an album is
 * present, otherwise just the artist. The MediaMetadata `album` field is
 * still set separately. Unicode is kept as-is.
 */
export const formatMediaSessionArtist = (artist?: string, album?: string): string => {
  const artistLabel = (artist || '').trim();
  const albumLabel = (album || '').trim();

  if (artistLabel && albumLabel) return `${artistLabel} - ${albumLabel}`;
  return artistLabel;
};

const buildArtwork = (track: TrackLike): MediaArtwork[] => {
  if (Array.isArray(track.artwork) && track.artwork.length > 0) {
    return track.artwork.filter((item) => Boolean(item?.src));
  }

  const artwork: MediaArtwork[] = [];
  if (track.thumbMd) artwork.push({ src: track.thumbMd, sizes: '512x512', type: 'image/jpeg' });
  else if (track.thumbSm) artwork.push({ src: track.thumbSm, sizes: '256x256', type: 'image/jpeg' });
  return artwork;
};

const artworkSrcs = (items?: ReadonlyArray<{ src?: string }> | null): string[] =>
  (items || []).map((item) => item?.src || '').filter(Boolean);

const sameArtworkSrcs = (
  left?: ReadonlyArray<{ src?: string }> | null,
  right?: ReadonlyArray<{ src?: string }> | null
): boolean => {
  const a = artworkSrcs(left);
  const b = artworkSrcs(right);
  return a.length === b.length && a.every((src, index) => src === b[index]);
};

const cloneArtwork = (items?: ReadonlyArray<MediaArtwork | MediaImage> | null): MediaArtwork[] =>
  (items || [])
    .map((item) => {
      if (!item?.src) return null;
      const cloned: MediaArtwork = { src: item.src };
      if (item.sizes) cloned.sizes = item.sizes;
      if (item.type) cloned.type = item.type;
      return cloned;
    })
    .filter((item): item is MediaArtwork => Boolean(item));

const isSameMetadata = (
  current: MediaMetadata | null | undefined,
  next: { title: string; artist: string; album: string; artwork: MediaArtwork[] }
): boolean => {
  if (!current) return false;
  return (
    current.title === next.title &&
    current.artist === next.artist &&
    current.album === next.album &&
    sameArtworkSrcs(current.artwork, next.artwork)
  );
};

const snapshotTrack = (track: TrackLike): TrackLike => ({
  title: track.title,
  artist: track.artist,
  album: track.album,
  albumId: track.albumId,
  thumbSm: track.thumbSm,
  thumbMd: track.thumbMd,
  artwork: track.artwork ? cloneArtwork(track.artwork) : undefined,
});

const artworkRetryKey = (track: TrackLike): string => {
  if (track.albumId != null && String(track.albumId) !== '') return String(track.albumId);
  const album = (track.album || '').trim();
  if (album) return `album:${album}`;
  const src = artworkSrcs(buildArtwork(track))[0];
  return src ? `art:${src}` : '';
};

let retryTimer: number | null = null;
let pendingRetryTrack: TrackLike | null = null;
let pendingRetryKey = '';
let retriedArtworkKey = '';
let retryAwaitingPlaying = false;

const clearRetryTimer = (): void => {
  if (retryTimer != null) {
    window.clearTimeout(retryTimer);
    retryTimer = null;
  }
};

const cancelPendingArtworkRetry = (): void => {
  clearRetryTimer();
  pendingRetryTrack = null;
  pendingRetryKey = '';
  retryAwaitingPlaying = false;
};

export const resetTeslaArtworkRetryForTests = (): void => {
  cancelPendingArtworkRetry();
  retriedArtworkKey = '';
};

const armArtworkRetry = (track: TrackLike): void => {
  if (!mediaSessionPausePolicy.retryArtworkAfterPlay) {
    cancelPendingArtworkRetry();
    return;
  }
  if (artworkSrcs(buildArtwork(track)).length === 0) return;
  const key = artworkRetryKey(track);
  if (!key) return;
  if (key === retriedArtworkKey) return;
  if (key === pendingRetryKey && pendingRetryTrack) {
    pendingRetryTrack = snapshotTrack(track);
    return;
  }
  clearRetryTimer();
  pendingRetryTrack = snapshotTrack(track);
  pendingRetryKey = key;
  retryAwaitingPlaying = true;
};

/** A new media load started: do not fire a retry until `playing` is heard again. */
export const notifyTeslaArtworkLoadStarted = (): void => {
  if (!pendingRetryTrack) return;
  clearRetryTimer();
  retryAwaitingPlaying = true;
};

/** Actual playback started. Schedule the one-shot artwork rewrite after the retry delay. */
export const notifyTeslaArtworkPlaybackStarted = (): void => {
  if (!pendingRetryTrack || !mediaSessionPausePolicy.retryArtworkAfterPlay) return;
  if (retryTimer != null) return;
  retryAwaitingPlaying = false;
  const key = pendingRetryKey;
  const track = pendingRetryTrack;
  retryTimer = window.setTimeout(() => {
    retryTimer = null;
    if (retryAwaitingPlaying) return;
    if (!mediaSessionPausePolicy.retryArtworkAfterPlay) return;
    if (!track || pendingRetryKey !== key) return;
    pendingRetryTrack = null;
    pendingRetryKey = '';
    retriedArtworkKey = key;
    teslaSetMetadataFromTrack(track, { forceRetry: true });
  }, mediaSessionArtworkRetryMs);
};

if (typeof window !== 'undefined') {
  subscribeMediaSessionPausePolicy(() => {
    if (!mediaSessionPausePolicy.retryArtworkAfterPlay) {
      cancelPendingArtworkRetry();
    }
  });
}

export const teslaSetMetadataFromTrack = (
  track: TrackLike | null | undefined,
  options?: TeslaSetMetadataOptions
): void => {
  if (!track || !('mediaSession' in navigator)) return;

  const title = formatMediaSessionTitle(track.title);
  const artist = formatMediaSessionArtist(track.artist, track.album);
  const album = (track.album || '').trim();
  const incomingArtwork = buildArtwork(track);
  const current = navigator.mediaSession.metadata;
  const preservedArtwork = incomingArtwork.length === 0 && artworkSrcs(current?.artwork).length > 0;
  const artwork = preservedArtwork ? cloneArtwork(current?.artwork) : incomingArtwork;
  const next = { title, artist, album, artwork };

  if (options?.forceRetry) {
    if (artwork.length === 0) return;
    navigator.mediaSession.metadata = new MediaMetadata(next);
    logMediaSessionArtwork('retry', next);
    navigator.mediaSession.playbackState = 'playing';
    return;
  }

  if (isSameMetadata(current, next)) {
    logMediaSessionArtwork('skip', next);
  } else {
    navigator.mediaSession.metadata = new MediaMetadata(next);
    logMediaSessionArtwork(preservedArtwork ? 'preserve' : 'set', next);
  }

  // Explicitly claim 'playing' state early (before loadTrack src swap) so that
  // Tesla's media focus / Bluetooth does not drop during the cold-load gap on auto-next.
  navigator.mediaSession.playbackState = 'playing';
  armArtworkRetry(track);
};
