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
 * Title is the plain track title; artist and album stay in their own fields.
 */
const useMediaMeta = (metadata: MediaMetadataInit | null): null => {
  useEffect(() => {
    if (!metadata) return;
    teslaSetMetadataFromTrack(metadata);
  }, [metadata]);

  return null;
};

export default useMediaMeta;
