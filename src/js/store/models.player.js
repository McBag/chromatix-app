// ======================================================================
// IMPORTS
// ======================================================================

import { PlaybackErrorMessage } from 'js/components';
import {
  analyticsEvent,
  getDashSrc,
  getTrackKeys,
  requiresTranscoding,
  sortList,
  teslaSetMetadataFromTrack,
} from 'js/utils';
import * as playerX from 'js/services/player';
import * as bridge from 'js/services/bridge';
import store from 'js/store/store';

// ======================================================================
// STATE
// ======================================================================

const isLocal = import.meta.env.VITE_ENV === 'local';

const playerState = {
  playerInited: false,
  playerLoading: false,
  playerPlaying: false,
  playerTrackLoaded: false,
  playerTrackError: false,
  playerInteractionCount: 0,
};

const state = Object.assign({}, playerState);

// ======================================================================
// ADJACENT ALBUM HELPERS
// ======================================================================

/** Parse artist id from routes like `/libraries/1/artists/12345`. */
const parseArtistIdFromLink = (link) => {
  if (!link || typeof link !== 'string') return null;
  const match = link.match(/\/artists\/([^/?#]+)/);
  return match ? match[1] : null;
};

/** Album sort year — data uses `releaseDate` (YYYY-…), not `year`. */
const getAlbumSortYear = (album) => {
  if (album?.year != null && album.year !== '') {
    const n = Number(album.year);
    if (!Number.isNaN(n) && n > 0) return n;
  }
  if (album?.releaseDate) {
    const match = String(album.releaseDate).match(/^(\d{4})/);
    if (match) return Number(match[1]);
  }
  return 0;
};

const resolveArtistIdFromTrack = (track, rootState) => {
  if (!track) return rootState?.sessionModel?.playingArtistId || null;
  if (track.artistId) return track.artistId;
  const fromLink = parseArtistIdFromLink(track.artistLink);
  if (fromLink) return fromLink;
  const albumId = track.albumId || rootState?.sessionModel?.playingAlbumId;
  if (albumId && rootState?.appModel?.allAlbums) {
    const album = rootState.appModel.allAlbums.find((a) => String(a.albumId) === String(albumId));
    if (album?.artistId) return album.artistId;
  }
  return rootState?.sessionModel?.playingArtistId || null;
};

const sortAlbumsByReleaseYearAsc = (albums) =>
  [...albums].sort((a, b) => {
    const aYear = getAlbumSortYear(a);
    const bYear = getAlbumSortYear(b);
    if (aYear !== bYear) return aYear - bYear;
    return String(a.title || '').localeCompare(String(b.title || ''), undefined, { sensitivity: 'base' });
  });

/**
 * Resolve the adjacent (older/newer) album by the same artist.
 * Returns the album object or null.
 *
 * Important for Tesla: never fall back to the unfiltered library list — that
 * picks a wrong "adjacent" album and looks like autoplay is broken. Prefer a
 * real artist discography fetch, then same-artist filter on allAlbums.
 */
const resolveAdjacentAlbum = async (rootState, { libraryId, playingAlbumId, playingArtistId, step }) => {
  let artistId = playingArtistId || null;
  const albumKey = (id) => libraryId + '-' + id;

  // If artist is still unknown, try the current album row in the library cache.
  if (!artistId && playingAlbumId && Array.isArray(rootState.appModel.allAlbums)) {
    const albumRow = rootState.appModel.allAlbums.find((a) => String(a.albumId) === String(playingAlbumId));
    if (albumRow?.artistId) artistId = albumRow.artistId;
  }

  let artistAlbums = artistId ? rootState.appModel.allArtistAlbums?.[albumKey(artistId)] : null;

  // Always try a live discography fetch when cache is empty (Tesla cold start /
  // background tab often never loaded the artist page).
  if ((!artistAlbums || !artistAlbums.length) && artistId) {
    try {
      const fetched = await bridge.getAllArtistAlbums(libraryId, artistId);
      const fresh = store.getState().appModel.allArtistAlbums?.[albumKey(artistId)];
      artistAlbums = (Array.isArray(fetched) && fetched.length ? fetched : null) || fresh || null;
    } catch {
      artistAlbums = store.getState().appModel.allArtistAlbums?.[albumKey(artistId)] || null;
    }
  }

  // Same-artist filter on the flat library cache — never use all library albums.
  if ((!artistAlbums || !artistAlbums.length) && artistId) {
    const allAlbums = store.getState().appModel.allAlbums;
    if (Array.isArray(allAlbums)) {
      artistAlbums = allAlbums.filter(
        (album) =>
          album?.albumId != null &&
          String(album.artistId) === String(artistId) &&
          (!album.libraryId || String(album.libraryId) === String(libraryId))
      );
    }
  }

  const sourceAlbums = (Array.isArray(artistAlbums) ? artistAlbums : []).filter((album) => album?.albumId != null);
  if (!sourceAlbums.length) return null;

  const sorted = sortAlbumsByReleaseYearAsc(sourceAlbums);
  const currentId = String(playingAlbumId);
  const currentIndex = sorted.findIndex((album) => String(album.albumId) === currentId);
  if (currentIndex < 0) return null;

  const adjacentAlbum = sorted[currentIndex + step];
  if (!adjacentAlbum || String(adjacentAlbum.albumId) === currentId) return null;
  return adjacentAlbum;
};

/** Schedule prefetch retries — Tesla background tabs throttle a single setTimeout(0). */
const scheduleAdjacentPrefetch = (dispatch, delaysMs = [0, 1500, 5000, 15000, 30000]) => {
  delaysMs.forEach((ms) => {
    window.setTimeout(() => {
      try {
        dispatch.playerModel.prefetchAdjacentAlbum();
      } catch {
        // ignore
      }
    }, ms);
  });
};

/** Count remaining tracks that still belong to the current album block. */
const countRemainingInAlbum = (playingTrackKeys, playingTrackList, fromIndex, albumId) => {
  if (!playingTrackKeys || fromIndex == null || albumId == null) return 0;
  let remaining = 0;
  for (let i = fromIndex; i < playingTrackKeys.length; i++) {
    const t = playingTrackList?.[playingTrackKeys[i]];
    if (t?.albumId != null && String(t.albumId) === String(albumId)) {
      remaining++;
    } else if (i > fromIndex) {
      break;
    }
  }
  return remaining;
};

// ======================================================================
// REDUCERS
// ======================================================================

const reducers = {
  setPlayerState(rootState, payload) {
    // console.log('%c--- setPlayerState ---', 'color:#5c16b1');
    return { ...rootState, ...payload };
  },
};

// ======================================================================
// EFFECTS
// ======================================================================

const effects = (dispatch) => ({
  //
  // INITIALISE
  //

  playerInit(payload, rootState) {
    console.log('%c--- playerInit ---', 'color:#5c16b1');

    // get saved volume and muted state
    const volumeLevel = rootState.sessionModel.volumeLevel;
    const volumeMuted = rootState.sessionModel.volumeMuted;

    // player events
    let loadstartTimeoutId = null;
    const onLoadStart = () => {
      // console.log('loadstart');
      clearTimeout(loadstartTimeoutId);
      loadstartTimeoutId = setTimeout(() => {
        dispatch.playerModel.playerSetLoading(true);
      }, 600);
    };
    const onCanPlay = () => {
      // console.log('canplay');
      clearTimeout(loadstartTimeoutId);
      dispatch.playerModel.playerSetLoading(false);
    };
    const onEnded = () => {
      // console.log('ended');
      playerX.requestTrackAdvance();
    };

    // create and save player element
    playerX.init({
      volumeLevel,
      volumeMuted,
      onLoadStart,
      onCanPlay,
      onEnded,
      onError: dispatch.playerModel.playerError,
    });
    playerX.setTrackEndedCallback(() => dispatch.playerModel.playerAutoNext());
    dispatch.playerModel.setPlayerState({
      playerInited: true,
    });

    // handle quit — unload so streams do not linger after navigation away
    window.addEventListener('beforeunload', () => {
      dispatch.playerModel.playerLogQuit();
      playerX.unload();
    });
  },

  playerRefresh(payload, rootState) {
    console.log('%c--- playerRefresh ---', 'color:#5c16b1');
    dispatch.playerModel.volumeRefresh();
    const playingTrackIndex = rootState.sessionModel.playingTrackIndex;
    const playingTrackProgress = rootState.sessionModel.playingTrackProgress;
    if (playingTrackIndex || playingTrackIndex === 0) {
      dispatch.playerModel.playerRefreshTrack({ index: playingTrackIndex, progress: playingTrackProgress });
    }
  },

  playerRefreshTrack(payload, rootState) {
    // For Plex DASH tracks, serverBaseUrl and userToken are needed to build the
    // manifest URL and load asynchronously after login, so retry until both are
    // available. Native-codec Plex tracks and all Jellyfin tracks embed their
    // credentials in the stored src URL and need no waiting.
    const currentService = rootState.appModel.currentService;
    const serverBaseUrl = rootState.appModel.serverBaseUrl;
    const userToken = rootState.appModel.userToken;
    const track = rootState.sessionModel.playingTrackList?.[rootState.sessionModel.playingTrackKeys?.[payload.index]];
    const plexDashCredentialsMissing =
      currentService === 'plex' && requiresTranscoding(track?.codec) && (!serverBaseUrl || !userToken);
    if (plexDashCredentialsMissing) {
      const retryCount = (payload.retryCount || 0) + 1;
      // Give up after ~30 seconds (300 retries × 100 ms). Set playerTrackError so
      // the user can still manually trigger a retry via the play button.
      if (retryCount > 300) {
        console.warn('%c--- playerRefreshTrack - credentials not available after 30s, giving up ---', 'color:#f00');
        dispatch.playerModel.setPlayerState({
          playerTrackLoaded: true,
          playerTrackError: true,
        });
        return;
      }
      setTimeout(() => dispatch.playerModel.playerRefreshTrack({ ...payload, retryCount }), 100);
      return;
    }
    console.log('%c--- playerRefreshTrack ---', 'color:#5c16b1');
    dispatch.playerModel.playerLoadIndex({ index: payload.index, play: false, progress: payload.progress });
  },

  playerSetLoading(payload, rootState) {
    const playerLoading = rootState.playerModel.playerLoading;
    if (playerLoading !== payload) {
      dispatch.playerModel.setPlayerState({
        playerLoading: payload,
      });
    }
  },

  playerUnload(payload, rootState) {
    console.log('%c--- playerUnload ---', 'color:#5c16b1');
    dispatch.playerModel.setPlayerState({
      playerPlaying: false,
      playerTrackLoaded: false,
    });
    playerX.unload();
  },

  //
  // PLAYBACK ERROR HANDLING
  //

  playerError(payload, rootState) {
    const { event, playerElement } = payload;
    const mediaError = playerElement.error;

    // Ignore errors from a stale element after src swap / unload.
    const activeElement = playerX.getCurrentPlayerElement?.();
    if (activeElement && playerElement !== activeElement) {
      return;
    }

    // Intentional abort during loadTrack src change — not a real error.
    if (mediaError?.code === MediaError.MEDIA_ERR_ABORTED) {
      return;
    }

    let errorCode = 'Unknown';
    let errorMessage = 'Unknown';

    // Attempt to determine the error type
    if (mediaError) {
      switch (mediaError.code) {
        case MediaError.MEDIA_ERR_ABORTED:
          errorCode = 'MEDIA_ERR_ABORTED';
          errorMessage = 'Fetching process aborted by user';
          break;
        case MediaError.MEDIA_ERR_NETWORK:
          errorCode = 'MEDIA_ERR_NETWORK';
          errorMessage = 'Network error occurred while fetching the media';
          break;
        case MediaError.MEDIA_ERR_DECODE:
          errorCode = 'MEDIA_ERR_DECODE';
          errorMessage = 'Media decoding error - file might be corrupted or unsupported format';
          break;
        case MediaError.MEDIA_ERR_SRC_NOT_SUPPORTED:
          errorCode = 'MEDIA_ERR_SRC_NOT_SUPPORTED';
          errorMessage = 'Media source not supported - check format or CORS issues';
          break;
        default:
          break;
      }
      if (mediaError.message) {
        errorMessage += `: ${mediaError.message}`;
      }
    }

    const playerTrackLoaded = rootState.playerModel.playerTrackLoaded;
    const playerPlaying = rootState.playerModel.playerPlaying;

    // Always log the error so we can diagnose it
    console.error('%c--- player - error ---', 'color:#f00', {
      errorCode,
      errorMessage,
      playerTrackLoaded,
      mediaError,
      sourceURL: isLocal ? playerElement.src : redactUrl(playerElement.src),
      originalEvent: event,
    });

    // Recover during cold-load gaps as well (playerPlaying may already be true
    // while playerTrackLoaded flickers), so background auto-next does not die.
    if (playerTrackLoaded || playerPlaying) {
      dispatch.playerModel.setPlayerState({
        playerTrackError: true,
      });
      dispatch.playerModel.playerErrorPlayback(true);
    }
  },

  playerErrorPlayback(payload, rootState) {
    // Determine the current track
    const playingTrackList = rootState.sessionModel.playingTrackList;
    const playingTrackIndex = rootState.sessionModel.playingTrackIndex;
    const playingTrackKeys = rootState.sessionModel.playingTrackKeys;
    const trackCurrent = playingTrackList?.[playingTrackKeys[playingTrackIndex]];

    // Display notification
    dispatch.appModel.addNotification({
      title: 'Playback error',
      description: PlaybackErrorMessage({ trackTitle: trackCurrent.title, trackArtist: trackCurrent.artist }),
    });

    // Try to play the next track (after a short delay)
    if (payload) {
      const isLastTrack = playingTrackIndex === playingTrackKeys.length - 1;
      const playingRepeatAll = rootState.sessionModel.playingRepeatAll;
      const playingRepeatOnce = rootState.sessionModel.playingRepeatOnce;
      if (isLastTrack && (playingRepeatAll || playingRepeatOnce)) {
        dispatch.sessionModel.setSessionState({
          playingRepeatAll: false,
          playingRepeatOnce: false,
        });
      }
      setTimeout(function () {
        dispatch.playerModel.playerErrorNext();
      }, 700);
    }
  },

  playerErrorNext(payload, rootState) {
    const manualPause = rootState.sessionModel._manualPause;
    const playerTrackLoaded = rootState.playerModel.playerTrackLoaded;
    const playerPlaying = rootState.playerModel.playerPlaying;
    if (manualPause || (!playerTrackLoaded && !playerPlaying)) return;

    // Honour album auto-continue / repeat instead of stopping after a transient error.
    dispatch.playerModel.setPlayerState({ playerTrackError: false });
    dispatch.playerModel.playerAutoNext();
  },

  playerLogQuit(payload, rootState) {
    // console.log('%c--- playerLogQuit ---', 'color:#5c16b1');
    try {
      // log playback state to server
      const playingTrackIndex = rootState.sessionModel.playingTrackIndex;
      const playingTrackList = rootState.sessionModel.playingTrackList;
      const playingTrackKeys = rootState.sessionModel.playingTrackKeys;
      const playingTrackProgress = rootState.sessionModel.playingTrackProgress;
      const currentTrack = playingTrackList[playingTrackKeys[playingTrackIndex]];
      bridge.logPlaybackQuit(currentTrack, playingTrackProgress);
    } catch (error) {
      // do nothing
    }
  },

  //
  // LOAD TRACKS
  //

  playerLoadTrackItem(payload, rootState) {
    // console.log('%c--- playerLoadTrackItem ---', 'color:#5c16b1');
    const {
      playingVariant,
      playingArtistId,
      playingArtistName,
      playingAlbumId,
      playingPlaylistId,
      playingFolderId,
      playingOrder,
      playingTrackIndex,
    } = payload;
    const isShuffle = rootState.sessionModel.playingShuffle;
    if (playingVariant === 'artists') {
      dispatch.playerModel.playerLoadArtist({
        artistId: playingArtistId,
        artistName: playingArtistName,
        playingOrder: playingOrder,
        trackIndex: playingTrackIndex,
        isShuffle: isShuffle,
        isTrack: true, // this ensures that the trackIndex is used
      });
    } else if (playingVariant === 'albums') {
      dispatch.playerModel.playerLoadAlbum({
        albumId: playingAlbumId,
        playingOrder: playingOrder,
        trackIndex: playingTrackIndex,
        isShuffle: isShuffle,
        isTrack: true, // this ensures that the trackIndex is used
      });
    } else if (playingVariant === 'playlists') {
      dispatch.playerModel.playerLoadPlaylist({
        playlistId: playingPlaylistId,
        playingOrder: playingOrder,
        trackIndex: playingTrackIndex,
        isShuffle: isShuffle,
        isTrack: true, // this ensures that the trackIndex is used
      });
    } else if (playingVariant === 'folders') {
      dispatch.playerModel.playerLoadFolder({
        folderId: playingFolderId,
        playingOrder: playingOrder,
        trackIndex: playingTrackIndex,
        isShuffle: isShuffle,
        isTrack: true, // this ensures that the trackIndex is used
      });
    }
  },

  async playerLoadArtist(payload, rootState) {
    console.log('%c--- playerLoadArtist ---', 'color:#5c16b1');
    const {
      artistId,
      artistName,
      playingOrder: playingOrderParam = null,
      trackIndex = 0,
      isShuffle = false,
      isTrack = false,
    } = payload;
    let playingOrder = playingOrderParam;

    const currentService = rootState.appModel.currentService;
    const libraryId = rootState.sessionModel.currentLibrary?.libraryId;
    const allArtistTracks = rootState.appModel.allArtistTracks;
    const currentArtistTracks = allArtistTracks[libraryId + '-' + artistId];

    // handle playing an artist before tracks are loaded
    if (!currentArtistTracks) {
      await bridge.getAllArtistTracks(libraryId, artistId, artistName);
      dispatch.playerModel.playerLoadArtist(payload);
      return;
    }

    // When no explicit order is given, sort by release date then disc/track number
    if (!playingOrder) {
      const indexed = currentArtistTracks.map((entry, index) => ({ ...entry, originalIndex: index }));
      const sorted = sortList({
        entries: indexed,
        options: 'releaseDate-asc-album-asc-discNumber-asc-trackNumber-asc',
        direction: 'asc',
      });
      playingOrder = sorted.map((entry) => entry.originalIndex);
    }

    const trackKeys = getTrackKeys(currentArtistTracks.length, playingOrder, isShuffle, isTrack ? trackIndex : null);
    const realIndex = isTrack ? trackKeys.indexOf(trackIndex) : 0;

    dispatch.playerModel.playerLoadTrackList({
      playingVariant: 'artists',
      playingServerId: rootState.sessionModel.currentServer?.serverId,
      playingLibraryId: rootState.sessionModel.currentLibrary?.libraryId,
      playingArtistId: artistId,
      playingAlbumId: null,
      playingPlaylistId: null,
      playingFolderId: null,
      playingLink: `/libraries/${rootState.sessionModel.currentLibrary?.libraryId}/artists/${artistId}`,
      playingOrder: playingOrder,
      playingTrackIndex: realIndex,
      playingTrackKeys: trackKeys,
      playingTrackList: currentArtistTracks,
      playingTrackCount: currentArtistTracks.length,
      playingTrackProgress: 0,
      playingShuffle: isShuffle,
    });

    analyticsEvent(toUpperFirst(currentService) + ' / Music / Play (Artist)');
  },

  async playerLoadAlbum(payload, rootState) {
    console.log('%c--- playerLoadAlbum ---', 'color:#5c16b1');
    const { albumId, playingOrder = null, trackIndex = 0, isShuffle = false, isTrack = false } = payload;

    const currentService = rootState.appModel.currentService;
    const libraryId = rootState.sessionModel.currentLibrary?.libraryId;
    const allAlbumTracks = rootState.appModel.allAlbumTracks;
    const currentAlbumTracks = allAlbumTracks[libraryId + '-' + albumId];

    // handle playing an album before tracks are loaded
    if (!currentAlbumTracks) {
      await bridge.getAlbumTracks(libraryId, albumId);
      await dispatch.playerModel.playerLoadAlbum(payload);
      return;
    }

    const trackKeys = getTrackKeys(currentAlbumTracks.length, playingOrder, isShuffle, isTrack ? trackIndex : null);
    const realIndex = isTrack ? trackKeys.indexOf(trackIndex) : 0;

    // Keep artist id so album-end autoplay can find the next/previous album.
    // Tracks may be an array or a keyed object depending on service transpose.
    const firstTrack = Array.isArray(currentAlbumTracks)
      ? currentAlbumTracks[0]
      : currentAlbumTracks?.[Object.keys(currentAlbumTracks)[0]];
    const albumFromLibrary = rootState.appModel.allAlbums?.find((a) => String(a.albumId) === String(albumId));
    const albumArtistId =
      firstTrack?.artistId ||
      parseArtistIdFromLink(firstTrack?.artistLink) ||
      albumFromLibrary?.artistId ||
      rootState.sessionModel.playingArtistId ||
      null;

    dispatch.playerModel.playerLoadTrackList({
      playingVariant: 'albums',
      playingServerId: rootState.sessionModel.currentServer?.serverId,
      playingLibraryId: rootState.sessionModel.currentLibrary?.libraryId,
      playingArtistId: albumArtistId,
      playingAlbumId: albumId,
      playingPlaylistId: null,
      playingFolderId: null,
      playingLink: `/libraries/${rootState.sessionModel.currentLibrary?.libraryId}/albums/${albumId}`,
      playingOrder: playingOrder,
      playingTrackIndex: realIndex,
      playingTrackKeys: trackKeys,
      playingTrackList: currentAlbumTracks,
      playingTrackCount: currentAlbumTracks.length,
      playingTrackProgress: 0,
      playingShuffle: isShuffle,
      _adjacentAlbumPrefetched: false,
      _lastQueuedAlbumId: null,
    });

    analyticsEvent(toUpperFirst(currentService) + ' / Music / Play (Album)');

    // Prefetch previous/next album early (with retries) — Tesla needs this before album end.
    if (rootState.sessionModel.autoPlayPreviousAlbumOnAlbumEnd) {
      scheduleAdjacentPrefetch(dispatch);
    }
  },

  async playerLoadPlaylist(payload, rootState) {
    console.log('%c--- playerLoadPlaylist ---', 'color:#5c16b1');
    const { playlistId, playingOrder = null, trackIndex = 0, isShuffle = false, isTrack = false } = payload;

    const currentService = rootState.appModel.currentService;
    const libraryId = rootState.sessionModel.currentLibrary?.libraryId;
    const allPlaylistTracks = rootState.appModel.allPlaylistTracks;
    const currentPlaylistTracks = allPlaylistTracks[libraryId + '-' + playlistId];

    // handle playing a playlist before tracks are loaded
    if (!currentPlaylistTracks) {
      await bridge.getPlaylistTracks(libraryId, playlistId);
      dispatch.playerModel.playerLoadPlaylist(payload);
      return;
    }

    const trackKeys = getTrackKeys(currentPlaylistTracks.length, playingOrder, isShuffle, isTrack ? trackIndex : null);
    const realIndex = isTrack ? trackKeys.indexOf(trackIndex) : 0;

    dispatch.playerModel.playerLoadTrackList({
      playingVariant: 'playlists',
      playingServerId: rootState.sessionModel.currentServer?.serverId,
      playingLibraryId: rootState.sessionModel.currentLibrary?.libraryId,
      playingArtistId: null,
      playingAlbumId: null,
      playingPlaylistId: playlistId,
      playingFolderId: null,
      playingLink: `/libraries/${rootState.sessionModel.currentLibrary?.libraryId}/playlists/${playlistId}`,
      playingOrder: playingOrder,
      playingTrackIndex: realIndex,
      playingTrackKeys: trackKeys,
      playingTrackList: currentPlaylistTracks,
      playingTrackCount: currentPlaylistTracks.length,
      playingTrackProgress: 0,
      playingShuffle: isShuffle,
    });

    analyticsEvent(toUpperFirst(currentService) + ' / Music / Play (Playlist)');
  },

  async playerLoadFolder(payload, rootState) {
    console.log('%c--- playerLoadFolder ---', 'color:#5c16b1');
    const { folderId, playingOrder = null, trackIndex = 0, isShuffle = false, isTrack = false } = payload;

    const currentService = rootState.appModel.currentService;
    const libraryId = rootState.sessionModel.currentLibrary?.libraryId;
    const allFolderItems = rootState.appModel.allFolderItems;
    const currentFolderItems = allFolderItems[libraryId + '-' + folderId]?.filter((entry) => entry.kind === 'track');

    // handle playing a folder before tracks are loaded
    if (!currentFolderItems) {
      await bridge.getFolderItems(folderId);
      dispatch.playerModel.playerLoadFolder(payload);
      return;
    }

    const trackKeys = getTrackKeys(currentFolderItems.length, playingOrder, isShuffle, isTrack ? trackIndex : null);
    const realIndex = isTrack ? trackKeys.indexOf(trackIndex) : 0;

    dispatch.playerModel.playerLoadTrackList({
      playingVariant: 'folders',
      playingServerId: rootState.sessionModel.currentServer?.serverId,
      playingLibraryId: rootState.sessionModel.currentLibrary?.libraryId,
      playingArtistId: null,
      playingAlbumId: null,
      playingPlaylistId: null,
      playingFolderId: folderId,
      playingLink: `/libraries/${rootState.sessionModel.currentLibrary?.libraryId}/folders/${folderId}`,
      playingOrder: playingOrder,
      playingTrackIndex: realIndex,
      playingTrackKeys: trackKeys,
      playingTrackList: currentFolderItems,
      playingTrackCount: currentFolderItems.length,
      playingTrackProgress: 0,
      playingShuffle: isShuffle,
    });

    analyticsEvent(toUpperFirst(currentService) + ' / Music / Play (Folder)');
  },

  playerLoadTrackList(payload, rootState) {
    // console.log('%c--- playerLoadTrackList ---', 'color:#5c16b1');
    dispatch.playerModel.setPlayerState({
      playerPlaying: true,
      playerTrackLoaded: true,
      playerTrackError: false,
    });
    dispatch.sessionModel.setSessionState({
      ...payload,
      _manualPause: false,
    });
    playerX.clearManualPauseFlag();
    // start playing
    const currentService = rootState.appModel.currentService;
    const serverBaseUrl = rootState.appModel.serverBaseUrl;
    const userToken = rootState.appModel.userToken;
    const sessionId = rootState.sessionModel.sessionId;
    const currentTrack = payload.playingTrackList[payload.playingTrackKeys[payload.playingTrackIndex]];
    teslaSetMetadataFromTrack(currentTrack);
    playerX.loadTrack(withDashSrc(currentTrack, currentService, serverBaseUrl, userToken, sessionId));
    playerX.nudgeActivePlayback();

    dispatch.playerModel.setPlayerState({
      playerInteractionCount: rootState.playerModel.playerInteractionCount + 1,
    });
    // log playback state to server
    bridge.logPlaybackPlay(currentTrack);
    // disable repeat once
    const disableRepeatOnceOnSourceChange = rootState.sessionModel.disableRepeatOnceOnSourceChange;
    if (disableRepeatOnceOnSourceChange) {
      dispatch.playerModel.playerRepeatOff();
    }
  },

  playerLoadIndex(payload, rootState) {
    // console.log('%c--- playerLoadIndex ---', 'color:#5c16b1');
    try {
      const currentService = rootState.appModel.currentService;
      const disableRepeatOnceOnTrackChange = rootState.sessionModel.disableRepeatOnceOnTrackChange;
      const playingTrackIndex = rootState.sessionModel.playingTrackIndex;
      const playingTrackList = rootState.sessionModel.playingTrackList;
      const playingTrackKeys = rootState.sessionModel.playingTrackKeys;
      const { index, play, progress } = payload;
      if (index || index === 0) {
        const currentTrack = playingTrackList[playingTrackKeys[index]];
        const serverBaseUrl = rootState.appModel.serverBaseUrl;
        const userToken = rootState.appModel.userToken;
        const sessionId = rootState.sessionModel.sessionId;
        const trackWithDash = withDashSrc(currentTrack, currentService, serverBaseUrl, userToken, sessionId);

        // Keep playingAlbumId / playingArtistId in sync when the queue spans albums
        // (e.g. after addAlbumToQueue / adjacent autoplay).
        const trackAlbumId = currentTrack?.albumId ?? null;
        const sessionAlbumId = rootState.sessionModel.playingAlbumId;
        const albumChanged =
          trackAlbumId != null &&
          sessionAlbumId != null &&
          String(trackAlbumId) !== String(sessionAlbumId);
        const resolvedArtistId = resolveArtistIdFromTrack(currentTrack, rootState);

        dispatch.playerModel.setPlayerState({
          playerPlaying: play,
          playerTrackLoaded: true,
          playerTrackError: false,
        });
        dispatch.sessionModel.setSessionState({
          playingTrackIndex: index,
          ...(play ? { _manualPause: false } : {}),
          ...(trackAlbumId != null
            ? {
                playingAlbumId: trackAlbumId,
                playingArtistId: resolvedArtistId || rootState.sessionModel.playingArtistId,
                ...(albumChanged ? { _adjacentAlbumPrefetched: false } : {}),
              }
            : {}),
        });
        playerX.setAdvanceLatchKey(`${index}:${playingTrackKeys[index]}`);
        if (play) {
          playerX.clearManualPauseFlag();
          teslaSetMetadataFromTrack(currentTrack);
        }
        const trackLoaded = playerX.loadTrack(trackWithDash, progress, play);
        if (!trackLoaded) {
          dispatch.playerModel.setPlayerState({
            playerPlaying: false,
            playerTrackError: true,
          });
        } else if (play) {
          playerX.nudgeActivePlayback();
        }

        // log playback state to server
        if (play && trackLoaded) {
          bridge.logPlaybackPlay(currentTrack, progress);
          analyticsEvent(toUpperFirst(currentService) + ' / Music / Play (Track)');
        }
        // disable repeat once
        if (playingTrackIndex !== index && disableRepeatOnceOnTrackChange) {
          dispatch.playerModel.playerRepeatOff();
        }

        // Prefetch adjacent album early enough that Tesla background network still has time.
        // Trigger from remaining ≤4 tracks (was ≤2) and schedule retries — single setTimeout
        // is often starved when the tab is minimized.
        if (
          play &&
          trackLoaded &&
          rootState.sessionModel.autoPlayPreviousAlbumOnAlbumEnd &&
          !rootState.sessionModel._adjacentAlbumPrefetched
        ) {
          const remainingInAlbum = countRemainingInAlbum(playingTrackKeys, playingTrackList, index, trackAlbumId);
          if (remainingInAlbum <= 4) {
            scheduleAdjacentPrefetch(dispatch, remainingInAlbum <= 2 ? [0, 800, 2500, 8000] : [0, 2000, 8000]);
          }
        }
      }
    } catch (error) {
      // this catches older users before shuffle was implemented
      dispatch.sessionModel.unloadTrack();
    }
  },

  //
  // PLAYER CONTROLS
  //

  playerResume(payload, rootState) {
    // console.log('%c--- playerResume ---', 'color:#5c16b1');
    dispatch.sessionModel.setSessionState({ _manualPause: false });
    playerX.clearManualPauseFlag();
    const playerTrackError = rootState.playerModel.playerTrackError;
    // If we know there was previously an error with the current track, try to load it again
    if (playerTrackError) {
      const playingTrackIndex = rootState.sessionModel.playingTrackIndex;
      dispatch.playerModel.playerLoadIndex({ index: playingTrackIndex, play: true });
    }
    // Otherwise, resume as normal
    else {
      playerX.resume();
      playerX.nudgeActivePlayback();
      dispatch.playerModel.setPlayerState({
        playerPlaying: true,
      });
      // log playback state to server
      const currentService = rootState.appModel.currentService;
      const playingTrackIndex = rootState.sessionModel.playingTrackIndex;
      const playingTrackKeys = rootState.sessionModel.playingTrackKeys;
      const playingTrackList = rootState.sessionModel.playingTrackList;
      const playingTrackProgress = rootState.sessionModel.playingTrackProgress;
      const currentTrack = playingTrackList[playingTrackKeys[playingTrackIndex]];
      bridge.logPlaybackPlay(currentTrack, playingTrackProgress);
      analyticsEvent(toUpperFirst(currentService) + ' / Music / Play (Resume)');
    }
  },

  playerProgress(payload, rootState) {
    // console.log('%c--- playerProgress ---', 'color:#5c16b1');
    const playerPlaying = rootState.playerModel.playerPlaying;
    if (playerPlaying) {
      dispatch.sessionModel.setPlayingTrackProgress(payload);

      // // Update player with current progress (handles auto-preloading internally)
      // // [NOTE] Not currently used, but may be in future
      // playerX.updateProgress(payload);

      // log playback state to server
      const playingTrackIndex = rootState.sessionModel.playingTrackIndex;
      const playingTrackKeys = rootState.sessionModel.playingTrackKeys;
      const playingTrackList = rootState.sessionModel.playingTrackList;
      const currentTrack = playingTrackList[playingTrackKeys[playingTrackIndex]];
      bridge.logPlaybackProgress(currentTrack, payload);
    }
  },

  playerPause(payload, rootState) {
    // console.log('%c--- playerPause ---', 'color:#5c16b1');
    dispatch.sessionModel.setSessionState({ _manualPause: true });
    playerX.pause();
    // log playback state to server
    if (rootState.playerModel.playerPlaying) {
      dispatch.playerModel.setPlayerState({
        playerPlaying: false,
      });
      const currentService = rootState.appModel.currentService;
      const playingTrackIndex = rootState.sessionModel.playingTrackIndex;
      const playingTrackKeys = rootState.sessionModel.playingTrackKeys;
      const playingTrackList = rootState.sessionModel.playingTrackList;
      const playingTrackProgress = rootState.sessionModel.playingTrackProgress;
      const currentTrack = playingTrackList[playingTrackKeys[playingTrackIndex]];
      bridge.logPlaybackPause(currentTrack, playingTrackProgress);
      analyticsEvent(toUpperFirst(currentService) + ' / Music / Pause');
    }
  },

  playerRestart(payload, rootState) {
    // console.log('%c--- playerRestart ---', 'color:#5c16b1');
    playerX.restart();
    dispatch.playerModel.setPlayerState({
      playerPlaying: true,
      playerInteractionCount: rootState.playerModel.playerInteractionCount + 1,
    });
  },

  playerPrev(payload, rootState) {
    // console.log('%c--- playerPrev ---', 'color:#5c16b1');
    const currentService = rootState.appModel.currentService;
    const playingTrackIndex = rootState.sessionModel.playingTrackIndex;
    const playingRepeatAll = rootState.sessionModel.playingRepeatAll;
    const playingTrackCount = rootState.sessionModel.playingTrackCount;
    const currentTime = playerX.getCurrentProgress();
    // play previous track, if available
    if (playingTrackIndex > 0 && currentTime <= 5) {
      dispatch.playerModel.playerLoadIndex({ index: playingTrackIndex - 1, play: true });
      analyticsEvent(toUpperFirst(currentService) + ' / Music / Previous Track');
    }
    // else play last track, if on repeat
    else if (playingRepeatAll && currentTime <= 5) {
      dispatch.playerModel.playerLoadIndex({ index: playingTrackCount - 1, play: true });
      analyticsEvent(toUpperFirst(currentService) + ' / Music / Previous Track');
    }
    // else restart current track
    else {
      dispatch.playerModel.playerRestart();
      analyticsEvent(toUpperFirst(currentService) + ' / Music / Restart Track');
    }
  },

  playerNext(payload, rootState) {
    // console.log('%c--- playerNext - ' + (payload === true ? 'true' : 'false') + ' ---', 'color:#5c16b1');
    const currentService = rootState.appModel.currentService;
    const playingTrackIndex = rootState.sessionModel.playingTrackIndex;
    const playingTrackKeys = rootState.sessionModel.playingTrackKeys;
    const playingTrackList = rootState.sessionModel.playingTrackList;
    const playingTrackCount = rootState.sessionModel.playingTrackCount;
    const playingRepeatAll = rootState.sessionModel.playingRepeatAll;
    const playingRepeatOnce = rootState.sessionModel.playingRepeatOnce;
    const currentTrack = playingTrackList[playingTrackKeys[playingTrackIndex]];

    // repeat current track, if on repeat once
    if (playingRepeatOnce && payload === true) {
      dispatch.playerModel.playerLoadIndex({ index: playingTrackIndex, play: true });
      analyticsEvent(toUpperFirst(currentService) + ' / Music / Next Track (Repeat Once) (Auto)');
    } else {
      // play next track, if available
      if (playingTrackIndex < playingTrackCount - 1) {
        dispatch.playerModel.playerLoadIndex({ index: playingTrackIndex + 1, play: true });
        if (payload === true) {
          analyticsEvent(toUpperFirst(currentService) + ' / Music / Next Track (Auto)');
        } else {
          analyticsEvent(toUpperFirst(currentService) + ' / Music / Next Track');
        }
      }
      // else play first track, if on repeat all
      else if (playingRepeatAll) {
        dispatch.playerModel.playerLoadIndex({ index: 0, play: true });
        if (payload === true) {
          analyticsEvent(toUpperFirst(currentService) + ' / Music / Next Track (Restart) (Auto)');
        } else {
          analyticsEvent(toUpperFirst(currentService) + ' / Music / Next Track (Restart)');
        }
      }
      // else load first track, but don't play
      else {
        dispatch.playerModel.playerLoadIndex({ index: 0, play: false });
        // log playback state to server
        bridge.logPlaybackStop(currentTrack);
      }
    }
  },

  playerRepeatToggle(payload, rootState) {
    // console.log('%c--- playerRepeatToggle ---', 'color:#5c16b1');
    const currentService = rootState.appModel.currentService;
    const playingRepeatAll = rootState.sessionModel.playingRepeatAll;
    const playingRepeatOnce = rootState.sessionModel.playingRepeatOnce;
    if (playingRepeatAll) {
      // repeat once
      dispatch.sessionModel.setSessionState({
        playingRepeatAll: false,
        playingRepeatOnce: true,
      });
      analyticsEvent(toUpperFirst(currentService) + ' / Music / Repeat Once');
    } else if (playingRepeatOnce) {
      // repeat off
      dispatch.sessionModel.setSessionState({
        playingRepeatAll: false,
        playingRepeatOnce: false,
      });
      analyticsEvent(toUpperFirst(currentService) + ' / Music / Repeat Off');
    } else {
      // repeat all
      dispatch.sessionModel.setSessionState({
        playingRepeatAll: true,
        playingRepeatOnce: false,
      });
      analyticsEvent(toUpperFirst(currentService) + ' / Music / Repeat All');
    }

    // Update the next track based on new repeat settings
    dispatch.playerModel.updateNextTrack();
  },

  playerRepeatOff(payload, rootState) {
    const currentService = rootState.appModel.currentService;
    const playingRepeatOnce = rootState.sessionModel.playingRepeatOnce;
    const revertRepeatOnceToRepeatAll = rootState.sessionModel.revertRepeatOnceToRepeatAll;
    if (playingRepeatOnce) {
      console.log('%c--- playerRepeatOff ---', 'color:#5c16b1');
      dispatch.sessionModel.setSessionState({
        playingRepeatAll: revertRepeatOnceToRepeatAll,
        playingRepeatOnce: false,
      });
      analyticsEvent(toUpperFirst(currentService) + ' / Music / Repeat All');

      // Update the next track based on new repeat settings
      dispatch.playerModel.updateNextTrack();
    }
  },

  playerShuffleToggle(payload, rootState) {
    // console.log('%c--- toggleShuffle ---', 'color:#5c16b1');
    const currentService = rootState.appModel.currentService;
    const playingOrder = rootState.sessionModel.playingOrder;
    const playingShuffle = rootState.sessionModel.playingShuffle;
    const playingTrackIndex = rootState.sessionModel.playingTrackIndex;
    const playingTrackCount = rootState.sessionModel.playingTrackCount;
    const isShuffle = !playingShuffle;

    const realIndex = rootState.sessionModel.playingTrackKeys[playingTrackIndex];
    const trackKeys = getTrackKeys(playingTrackCount, playingOrder, isShuffle, realIndex);
    const newIndex = trackKeys.indexOf(realIndex);

    dispatch.sessionModel.setSessionState({
      playingShuffle: isShuffle,
      playingTrackIndex: newIndex,
      playingTrackKeys: trackKeys,
    });

    // Update the next track based on new order
    dispatch.playerModel.updateNextTrack();

    analyticsEvent(toUpperFirst(currentService) + ' / Music / Shuffle ' + (isShuffle ? 'On' : 'Off'));
  },

  updateNextTrack(payload, rootState) {
    // Intentionally no-op: Tesla build uses a single active <audio> element
    // without next-track preload.
  },

  async addAlbumToQueue(payload, rootState) {
    const { albumId } = payload;
    const libraryId = rootState.sessionModel.currentLibrary?.libraryId;
    const allAlbumTracks = rootState.appModel.allAlbumTracks;
    let albumTracks = allAlbumTracks[libraryId + '-' + albumId];

    if (!albumTracks) {
      const fetched = await bridge.getAlbumTracks(libraryId, albumId);
      // Prefer returned list; fall back to store (older callers may still resolve void).
      albumTracks =
        (Array.isArray(fetched) ? fetched : null) ||
        store.getState().appModel.allAlbumTracks[libraryId + '-' + albumId];
      if (!albumTracks) return;
      rootState = store.getState();
    }

    // Normalize to array (some paths may store keyed objects).
    const tracks = Array.isArray(albumTracks) ? albumTracks : Object.values(albumTracks);
    if (!tracks.length) return;

    const playingTrackList = rootState.sessionModel.playingTrackList;
    const playingTrackKeys = rootState.sessionModel.playingTrackKeys;
    const playingTrackIndex = rootState.sessionModel.playingTrackIndex;
    const currentTrack = playingTrackList?.[playingTrackKeys?.[playingTrackIndex]];
    const playingAlbumId = rootState.sessionModel.playingAlbumId || currentTrack?.albumId;

    if (!playingTrackList || !playingTrackKeys || playingTrackIndex === null || playingTrackIndex === undefined) {
      await dispatch.playerModel.playerLoadAlbum({ albumId });
      return;
    }

    // Skip if this album is already queued after the current position.
    const alreadyQueued = playingTrackKeys.some((key, idx) => {
      if (idx <= playingTrackIndex) return false;
      return String(playingTrackList[key]?.albumId) === String(albumId);
    });
    if (alreadyQueued) {
      dispatch.sessionModel.setSessionState({ _lastQueuedAlbumId: albumId });
      return;
    }

    // Insert after the current album block in the queue.
    let insertAt = playingTrackIndex + 1;
    while (insertAt < playingTrackKeys.length) {
      const track = playingTrackList[playingTrackKeys[insertAt]];
      if (playingAlbumId != null && track?.albumId != null && String(track.albumId) !== String(playingAlbumId)) {
        break;
      }
      if (playingAlbumId == null || track?.albumId == null) break;
      insertAt++;
    }

    // playingTrackList is usually an array used as a sparse map via numeric keys.
    const newKeys = [...playingTrackKeys];
    const newList = Array.isArray(playingTrackList) ? [...playingTrackList] : { ...playingTrackList };
    const startKey = Math.max(...playingTrackKeys.map(Number).filter((n) => !Number.isNaN(n)), -1) + 1;

    tracks.forEach((track, offset) => {
      const key = startKey + offset;
      newKeys.splice(insertAt + offset, 0, key);
      newList[key] = track;
    });

    dispatch.sessionModel.setSessionState({
      playingTrackList: newList,
      playingTrackKeys: newKeys,
      playingTrackCount: newKeys.length,
      _lastQueuedAlbumId: albumId,
    });
  },

  playerAutoNext(payload, rootState) {
    const playingTrackIndex = rootState.sessionModel.playingTrackIndex;
    const playingTrackCount = rootState.sessionModel.playingTrackCount;
    const playingRepeatOnce = rootState.sessionModel.playingRepeatOnce;
    const playingRepeatAll = rootState.sessionModel.playingRepeatAll;
    const autoPlayPreviousAlbumOnAlbumEnd = rootState.sessionModel.autoPlayPreviousAlbumOnAlbumEnd;
    const _adjacentAlbumLoading = rootState.sessionModel._adjacentAlbumLoading;
    const attempt = typeof payload === 'object' && payload?.attempt != null ? payload.attempt : 0;

    if (playingRepeatOnce) {
      dispatch.playerModel.playerNext(true);
      return;
    }

    // Re-read from store — prefetch may have extended the queue mid-flight.
    const live = store.getState().sessionModel;
    if (live.playingTrackIndex != null && live.playingTrackCount != null && live.playingTrackIndex < live.playingTrackCount - 1) {
      dispatch.playerModel.playerNext(true);
      return;
    }

    if (playingTrackIndex < playingTrackCount - 1) {
      dispatch.playerModel.playerNext(true);
      return;
    }

    if (playingRepeatAll) {
      dispatch.playerModel.playerNext(true);
      return;
    }

    // Hold media focus while adjacent album resolves (Tesla drops BT audio on silence).
    const holdMediaFocus = () => {
      if ('mediaSession' in navigator) {
        navigator.mediaSession.playbackState = 'playing';
      }
      playerX.syncHiddenMediaSession();
      playerX.ensureAudioKeepAlive();
      playerX.nudgeActivePlayback();
    };

    // Adjacent album fetch still in flight — wait and retry (longer than before for Tesla).
    if (_adjacentAlbumLoading || live._adjacentAlbumLoading) {
      holdMediaFocus();
      if (attempt < 40) {
        window.setTimeout(() => dispatch.playerModel.playerAutoNext({ attempt: attempt + 1 }), 350);
      }
      return;
    }

    if (autoPlayPreviousAlbumOnAlbumEnd) {
      holdMediaFocus();
      dispatch.playerModel.playerLoadAdjacentAlbum({ attempt: 0 });
      return;
    }

    dispatch.playerModel.playerNext(true);
  },

  /**
   * Prefetch the adjacent album into the queue while the current one is still playing.
   * Idempotent via _adjacentAlbumPrefetched / _lastQueuedAlbumId.
   * Safe to call repeatedly (keep-alive / delayed retries for Tesla).
   */
  async prefetchAdjacentAlbum(_payload, rootState) {
    if (!rootState.sessionModel.autoPlayPreviousAlbumOnAlbumEnd) return;
    if (rootState.sessionModel._adjacentAlbumLoading) return;
    if (rootState.sessionModel._adjacentAlbumPrefetched) return;
    if (rootState.sessionModel.playingRepeatAll || rootState.sessionModel.playingRepeatOnce) return;

    const libraryId = rootState.sessionModel.currentLibrary?.libraryId;
    const playingTrackList = rootState.sessionModel.playingTrackList;
    const playingTrackKeys = rootState.sessionModel.playingTrackKeys;
    const playingTrackIndex = rootState.sessionModel.playingTrackIndex;
    const currentTrack = playingTrackList?.[playingTrackKeys?.[playingTrackIndex]];
    const playingAlbumId = rootState.sessionModel.playingAlbumId || currentTrack?.albumId;
    const playingArtistId = resolveArtistIdFromTrack(currentTrack, rootState);
    const step = rootState.sessionModel.autoPlayNextAlbumByReleaseYear ? 1 : -1;

    if (!libraryId || !playingAlbumId) return;

    // Already have more tracks after current album block → nothing to prefetch.
    if (playingTrackKeys && playingTrackIndex != null) {
      let hasMoreAfterAlbum = false;
      for (let i = playingTrackIndex + 1; i < playingTrackKeys.length; i++) {
        const t = playingTrackList[playingTrackKeys[i]];
        if (t?.albumId != null && String(t.albumId) !== String(playingAlbumId)) {
          hasMoreAfterAlbum = true;
          break;
        }
      }
      if (hasMoreAfterAlbum) {
        dispatch.sessionModel.setSessionState({ _adjacentAlbumPrefetched: true });
        return;
      }
    }

    dispatch.sessionModel.setSessionState({ _adjacentAlbumLoading: true });
    try {
      // Use live store state after awaits — Tesla can rehydrate / race with keep-alive.
      const adjacentAlbum = await resolveAdjacentAlbum(store.getState(), {
        libraryId,
        playingAlbumId,
        playingArtistId: playingArtistId || store.getState().sessionModel.playingArtistId,
        step,
      });
      if (!adjacentAlbum) {
        // If discography is loaded and still null → no further album (stop retry spam).
        // If discography missing → leave prefetched false so keep-alive can retry later.
        const artistId = playingArtistId || store.getState().sessionModel.playingArtistId;
        const discography = artistId
          ? store.getState().appModel.allArtistAlbums?.[libraryId + '-' + artistId]
          : null;
        const discographyReady = Array.isArray(discography) && discography.length > 0;
        dispatch.sessionModel.setSessionState({
          _adjacentAlbumLoading: false,
          ...(discographyReady ? { _adjacentAlbumPrefetched: true } : {}),
        });
        return;
      }
      const liveLast = store.getState().sessionModel._lastQueuedAlbumId;
      if (String(liveLast) === String(adjacentAlbum.albumId)) {
        dispatch.sessionModel.setSessionState({
          _adjacentAlbumLoading: false,
          _adjacentAlbumPrefetched: true,
        });
        return;
      }
      await dispatch.playerModel.addAlbumToQueue({ albumId: adjacentAlbum.albumId });

      const after = store.getState().sessionModel;
      const queuedOk =
        after.playingTrackKeys?.some((key, idx) => {
          if (idx <= (after.playingTrackIndex ?? -1)) return false;
          return String(after.playingTrackList?.[key]?.albumId) === String(adjacentAlbum.albumId);
        }) || String(after._lastQueuedAlbumId) === String(adjacentAlbum.albumId);

      dispatch.sessionModel.setSessionState({
        _adjacentAlbumLoading: false,
        _adjacentAlbumPrefetched: !!queuedOk,
        _lastQueuedAlbumId: queuedOk ? adjacentAlbum.albumId : after._lastQueuedAlbumId,
      });
    } catch (err) {
      console.error('prefetchAdjacentAlbum failed', err);
      // Leave _adjacentAlbumPrefetched false so scheduleAdjacentPrefetch / keep-alive can retry.
      dispatch.sessionModel.setSessionState({ _adjacentAlbumLoading: false });
    }
  },

  /**
   * Load the previous or next album by the same artist after the current album ends.
   *
   * Sort is always ascending by release year (then title). Direction:
   * - autoPlayNextAlbumByReleaseYear=true  → newer album (index + 1)
   * - autoPlayNextAlbumByReleaseYear=false → older album (index - 1)  [default "previous"]
   *
   * Tracks are appended to the queue (not a full replace) so the Queue UI fills
   * and playback can advance with playerNext.
   */
  async playerLoadAdjacentAlbum(payload, rootState) {
    const attempt = typeof payload === 'object' && payload?.attempt != null ? payload.attempt : 0;
    const libraryId = rootState.sessionModel.currentLibrary?.libraryId;
    const playingTrackList = rootState.sessionModel.playingTrackList;
    const playingTrackKeys = rootState.sessionModel.playingTrackKeys;
    const playingTrackIndex = rootState.sessionModel.playingTrackIndex;
    const currentTrack = playingTrackList?.[playingTrackKeys?.[playingTrackIndex]];
    const playingAlbumId = rootState.sessionModel.playingAlbumId || currentTrack?.albumId;
    const playingArtistId = resolveArtistIdFromTrack(currentTrack, rootState);
    const autoPlayNextAlbumByReleaseYear = rootState.sessionModel.autoPlayNextAlbumByReleaseYear;
    // +1 = next (newer by year), -1 = previous (older by year)
    const step = autoPlayNextAlbumByReleaseYear ? 1 : -1;

    const holdMediaFocus = () => {
      if ('mediaSession' in navigator) {
        navigator.mediaSession.playbackState = 'playing';
      }
      playerX.syncHiddenMediaSession();
      playerX.ensureAudioKeepAlive();
    };

    if (!libraryId || !playingAlbumId) {
      dispatch.playerModel.playerNext(true);
      return;
    }

    // If adjacent tracks were already prefetched into the queue, just advance.
    const freshBefore = store.getState().sessionModel;
    if (
      freshBefore.playingTrackIndex != null &&
      freshBefore.playingTrackCount != null &&
      freshBefore.playingTrackIndex < freshBefore.playingTrackCount - 1
    ) {
      dispatch.playerModel.playerNext(true);
      return;
    }

    dispatch.sessionModel.setSessionState({ _adjacentAlbumLoading: true });
    holdMediaFocus();

    try {
      const adjacentAlbum = await resolveAdjacentAlbum(store.getState(), {
        libraryId,
        playingAlbumId,
        playingArtistId: playingArtistId || store.getState().sessionModel.playingArtistId,
        step,
      });

      if (!adjacentAlbum) {
        dispatch.sessionModel.setSessionState({ _adjacentAlbumLoading: false });
        // Retry a few times — artist discography may still be loading on Tesla.
        if (attempt < 8) {
          holdMediaFocus();
          window.setTimeout(
            () => dispatch.playerModel.playerLoadAdjacentAlbum({ attempt: attempt + 1 }),
            400 + attempt * 300
          );
          return;
        }
        dispatch.playerModel.playerNext(true);
        return;
      }

      holdMediaFocus();
      // Append to queue so the Queue panel shows tracks; then start the next index.
      await dispatch.playerModel.addAlbumToQueue({ albumId: adjacentAlbum.albumId });

      dispatch.sessionModel.setSessionState({
        _adjacentAlbumLoading: false,
        _adjacentAlbumPrefetched: true,
        _lastQueuedAlbumId: adjacentAlbum.albumId,
      });

      const after = store.getState().sessionModel;
      if (after.playingTrackIndex < after.playingTrackCount - 1) {
        holdMediaFocus();
        dispatch.playerModel.playerNext(true);
      } else if (attempt < 5) {
        // Queue insert may have raced — retry before full replace.
        holdMediaFocus();
        window.setTimeout(
          () => dispatch.playerModel.playerLoadAdjacentAlbum({ attempt: attempt + 1 }),
          300
        );
      } else {
        // Last resort: full load of adjacent album (keeps playback going).
        holdMediaFocus();
        await dispatch.playerModel.playerLoadAlbum({ albumId: adjacentAlbum.albumId });
      }
    } catch (err) {
      console.error('playerLoadAdjacentAlbum failed', err);
      dispatch.sessionModel.setSessionState({ _adjacentAlbumLoading: false });
      if (attempt < 6) {
        holdMediaFocus();
        window.setTimeout(
          () => dispatch.playerModel.playerLoadAdjacentAlbum({ attempt: attempt + 1 }),
          500 + attempt * 400
        );
        return;
      }
      dispatch.playerModel.playerNext(true);
    }
  },

  //
  // VOLUME CONTROLS
  //

  volumeRefresh(payload, rootState) {
    // console.log('%c--- volumeRefresh ---', 'color:#5c16b1');
    const volumeLevel = rootState.sessionModel.volumeLevel;
    const volumeMuted = rootState.sessionModel.volumeMuted;
    const actualVolume = volumeMuted ? 0 : volumeLevel;
    playerX.setVolume(actualVolume);
  },

  volumeLevelSet(payload, rootState) {
    // console.log('%c--- volumeLevelSet ---', 'color:#5c16b1');
    dispatch.sessionModel.setSessionState({
      volumeLevel: payload,
      volumeMuted: false,
    });
    playerX.setVolume(payload);
  },

  volumeMuteToggle(payload, rootState) {
    // console.log('%c--- volumeMuteToggle ---', 'color:#5c16b1');
    const defaultVolumeLevel = 75;
    const currentService = rootState.appModel.currentService;
    const volumeLevel = rootState.sessionModel.volumeLevel;
    const volumeMuted = rootState.sessionModel.volumeMuted;
    let newVolumeLevel;
    let newVolumeMuted;
    // if muted and volume is 0, unmute and set volume to default
    if (volumeMuted && volumeLevel === 0) {
      newVolumeLevel = defaultVolumeLevel;
      newVolumeMuted = false;
    }
    // if muted and volume is not 0, unmute
    else if (volumeMuted) {
      newVolumeLevel = volumeLevel;
      newVolumeMuted = false;
    }
    // if not muted and volume is 0, unmute and set volume to default
    else if (!volumeMuted && volumeLevel === 0) {
      newVolumeLevel = defaultVolumeLevel;
      newVolumeMuted = false;
    }
    // if not muted and volume is not 0, mute
    else {
      newVolumeLevel = volumeLevel;
      newVolumeMuted = true;
    }
    // save state
    dispatch.sessionModel.setSessionState({
      volumeLevel: newVolumeLevel,
      volumeMuted: newVolumeMuted,
    });
    const actualVolume = newVolumeMuted ? 0 : newVolumeLevel;
    playerX.setVolume(actualVolume);
    analyticsEvent(toUpperFirst(currentService) + ' / Music / Mute ' + (newVolumeMuted ? 'On' : 'Off'));
  },
});

// ======================================================================
// EXPORT
// ======================================================================

export const playerModel = {
  // initial state
  state,
  // reducers - handle state changes with pure functions
  reducers,
  // effects - handle state changes with impure functions
  effects,
};

// ======================================================================
// HELPER FUNCTIONS
// ======================================================================

const toUpperFirst = (string) => {
  return string?.charAt(0).toUpperCase() + string?.slice(1);
};

// Adds a freshly computed dashSrc to a track if the current service is Plex
// and the necessary connection details are available.
const withDashSrc = (track, currentService, serverBaseUrl, accessToken, sessionId) => {
  if (currentService !== 'plex' || !track?.trackKey || !serverBaseUrl || !accessToken || !sessionId) {
    return track;
  }
  return { ...track, dashSrc: getDashSrc(track.trackKey, serverBaseUrl, accessToken, sessionId) };
};

// Redacts sensitive query params from a URL string before logging.
const REDACTED_PARAMS = ['X-Plex-Token', 'X-Emby-Token', 'api_key', 'token'];
const redactUrl = (url) => {
  try {
    const parsed = new URL(url);
    REDACTED_PARAMS.forEach((param) => {
      if (parsed.searchParams.has(param)) {
        parsed.searchParams.set(param, '[REDACTED]');
      }
    });
    return parsed.toString();
  } catch {
    return '[invalid URL]';
  }
};
