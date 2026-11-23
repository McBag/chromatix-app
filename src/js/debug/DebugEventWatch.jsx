import { useEffect, useRef } from 'react';
import { useLocation } from 'react-router-dom';
import { useSelector } from 'react-redux';

import { isDebugEnabled } from 'js/debug/audioDebug';
import { isDebugLogStarted, logAlbumChange } from 'js/debug/debugLog';

const albumPath = /\/libraries\/[^/]+\/albums\/([^/?#]+)/;

const sameRef = (a, b) => {
  if (!a && !b) return true;
  return String(a?.id ?? '') === String(b?.id ?? '') && (a?.name || '') === (b?.name || '');
};

/** Watches route and player album changes while debug logging is on. Renders nothing. */
export const DebugEventWatch = () => {
  const location = useLocation();
  const playingAlbumId = useSelector(({ sessionModel }) => sessionModel.playingAlbumId);
  const playingTrackList = useSelector(({ sessionModel }) => sessionModel.playingTrackList);
  const playingTrackKeys = useSelector(({ sessionModel }) => sessionModel.playingTrackKeys);
  const playingTrackIndex = useSelector(({ sessionModel }) => sessionModel.playingTrackIndex);
  const allAlbums = useSelector(({ appModel }) => appModel.allAlbums);

  const routeRef = useRef(null);
  const playRef = useRef(null);

  const track = playingTrackList?.[playingTrackKeys?.[playingTrackIndex]];
  const albumRow = allAlbums?.find((album) => String(album.albumId) === String(playingAlbumId));

  useEffect(() => {
    if (!isDebugEnabled() || !isDebugLogStarted()) return;
    const match = location.pathname.match(albumPath);
    const id = match ? decodeURIComponent(match[1]) : null;
    const row = id && allAlbums?.find((album) => String(album.albumId) === String(id));
    const next = id
      ? {
          id,
          name: row?.title || row?.name || null,
          cover: row?.thumbMd || row?.thumbSm || null,
          thumb: row?.thumbSm || null,
        }
      : null;
    if (sameRef(routeRef.current, next)) return;
    if (routeRef.current || next) logAlbumChange({ source: 'route', from: routeRef.current, to: next });
    routeRef.current = next;
  }, [location.pathname, allAlbums]);

  useEffect(() => {
    if (!isDebugEnabled() || !isDebugLogStarted()) return;
    if (playingAlbumId == null) return;
    const next = {
      id: playingAlbumId,
      name: track?.album || albumRow?.title || albumRow?.name || null,
      cover: track?.thumbMd || albumRow?.thumbMd || track?.thumbSm || albumRow?.thumbSm || null,
      thumb: track?.thumbSm || albumRow?.thumbSm || null,
    };
    if (sameRef(playRef.current, next)) return;
    logAlbumChange({ source: 'player', from: playRef.current, to: next });
    playRef.current = next;
  }, [playingAlbumId, track, albumRow]);

  return null;
};

export default DebugEventWatch;
