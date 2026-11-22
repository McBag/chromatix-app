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
 * Artist and album stay in their own MediaMetadata fields — Tesla already
 * shows the artist on the line below the title.
 * Unicode (including German umlauts) is kept as-is.
 */
export const formatMediaSessionTitle = (title?: string): string => {
  return (title || '').trim() || 'Chromatix';
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
    artist: (track.artist || '').trim(),
    album: (track.album || '').trim(),
    artwork: buildArtwork(track),
  });

  // Explicitly claim 'playing' state early (before loadTrack src swap) so that
  // Tesla's media focus / Bluetooth does not drop during the cold-load gap on auto-next.
  navigator.mediaSession.playbackState = 'playing';
};
