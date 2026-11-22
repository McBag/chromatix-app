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

export const teslaSetMetadataFromTrack = (track: TrackLike | null | undefined): void => {
  if (!track || !('mediaSession' in navigator)) return;

  navigator.mediaSession.metadata = new MediaMetadata({
    title: formatMediaSessionTitle(track.title),
    artist: formatMediaSessionArtist(track.artist, track.album),
    album: (track.album || '').trim(),
    artwork: buildArtwork(track),
  });

  // Explicitly claim 'playing' state early (before loadTrack src swap) so that
  // Tesla's media focus / Bluetooth does not drop during the cold-load gap on auto-next.
  navigator.mediaSession.playbackState = 'playing';
};
