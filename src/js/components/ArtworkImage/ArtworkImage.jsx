// ======================================================================
// IMPORTS
// ======================================================================

import { useEffect, useState } from 'react';

// ======================================================================
// COMPONENT
// ======================================================================

// Artwork <img> that renders nothing once its src fails to load, so the parent's placeholder shows instead.
// Tracks the failed src (not a flag) so a reused element resets when given new artwork, e.g. in virtual lists.
// Optional placeholderSrc (e.g. 360px thumb) shows immediately under a slower primary src (e.g. 680px cover).
const ArtworkImage = ({ src, placeholderSrc, debugKind, ...props }) => {
  const [failedSrc, setFailedSrc] = useState(null);
  const [primaryReady, setPrimaryReady] = useState(false);

  useEffect(() => {
    setPrimaryReady(false);
  }, [src]);

  const primaryOk = Boolean(src) && failedSrc !== src;
  const placeholderOk = Boolean(placeholderSrc) && placeholderSrc !== src && failedSrc !== placeholderSrc;
  const showPrimary = primaryOk && (primaryReady || !placeholderOk);

  if (!primaryOk && !placeholderOk) {
    return null;
  }

  return (
    <>
      {placeholderOk && (
        <img
          src={placeholderSrc}
          draggable="false"
          data-debug-kind={debugKind || undefined}
          onError={() => setFailedSrc(placeholderSrc)}
          {...props}
        />
      )}
      {primaryOk && (
        <img
          src={src}
          draggable="false"
          data-debug-kind={debugKind || undefined}
          onLoad={() => setPrimaryReady(true)}
          onError={() => setFailedSrc(src)}
          style={showPrimary ? undefined : { opacity: 0 }}
          {...props}
        />
      )}
    </>
  );
};

// ======================================================================
// EXPORT
// ======================================================================

export default ArtworkImage;
