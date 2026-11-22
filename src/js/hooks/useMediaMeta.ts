import { useEffect } from 'react';

import { teslaSetMetadataFromTrack } from 'js/utils/teslaArtworkFix';

interface MediaMetadataInit {
  title?: string;
  artist?: string;
  album?: string;
  thumbSm?: string;
  thumbMd?: string;
  artwork?: {
    src: string;
    sizes?: string;
    type?: string;
  }[];
}

/**
 * Sets Media Session metadata for lock screens / car UIs.
 * Title is the plain track title; the artist field is "Artist - Album" when an album is set.
 */
const useMediaMeta = (metadata: MediaMetadataInit | null): null => {
  useEffect(() => {
    if (!metadata) return;
    teslaSetMetadataFromTrack(metadata);
  }, [metadata]);

  return null;
};

export default useMediaMeta;
