import { logMediaSessionArtwork } from 'js/debug/debugLog';

interface MediaArtwork {
  src: string;
  sizes?: string;
  type?: string;
}

interface TrackLike {
  title?: string;
  artist?: string;
  album?: string;
  thumbSm?: string;
  thumbMd?: string;
  /** Pre-built MediaSession artwork (e.g. from ControlBar). Preferred over thumbs. */
  artwork?: MediaArtwork[];
}

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

export const teslaSetMetadataFromTrack = (track: TrackLike | null | undefined): void => {
  if (!track || !('mediaSession' in navigator)) return;

  const title = formatMediaSessionTitle(track.title);
  const artist = formatMediaSessionArtist(track.artist, track.album);
  const album = (track.album || '').trim();
  const incomingArtwork = buildArtwork(track);
  const current = navigator.mediaSession.metadata;
  const preservedArtwork = incomingArtwork.length === 0 && artworkSrcs(current?.artwork).length > 0;
  const artwork = preservedArtwork ? cloneArtwork(current?.artwork) : incomingArtwork;
  const next = { title, artist, album, artwork };

  if (isSameMetadata(current, next)) {
    logMediaSessionArtwork('skip', next);
  } else {
    navigator.mediaSession.metadata = new MediaMetadata(next);
    logMediaSessionArtwork(preservedArtwork ? 'preserve' : 'set', next);
  }

  // Explicitly claim 'playing' state early (before loadTrack src swap) so that
  // Tesla's media focus / Bluetooth does not drop during the cold-load gap on auto-next.
  navigator.mediaSession.playbackState = 'playing';
};
