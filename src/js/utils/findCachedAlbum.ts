/** Plex/Jellyfin album ids may be string or number; compare loosely. */
export const sameEntityId = (a: unknown, b: unknown): boolean => a != null && b != null && String(a) === String(b);

const albumIdOf = (entry: { albumId?: unknown } | null | undefined): unknown => entry?.albumId;

export const findAlbumInList = <T extends { albumId?: unknown; error404?: boolean }>(
  list: T[] | null | undefined,
  albumId: unknown
): T | null => list?.find((album) => sameEntityId(albumIdOf(album), albumId)) ?? null;

const ALBUM_MAP_KEYS = [
  'allArtistAlbums',
  'allArtistRelatedAlbums',
  'allArtistAppearanceAlbums',
  'allAlbumCollectionItems',
  'allAlbumGenreItems',
  'allAlbumMoodItems',
  'allAlbumStyleItems',
  'allAlbumTagItems',
] as const;

type AlbumLike = {
  albumId?: unknown;
  title?: string;
  thumbSm?: string | null;
  thumbMd?: string | null;
  error404?: boolean;
};

const scoreAlbum = (album: AlbumLike): number =>
  (album.error404 ? -10 : 0) + (album.thumbMd ? 4 : 0) + (album.thumbSm ? 2 : 0) + (album.title ? 1 : 0);

/**
 * Resolve an album from allAlbums first, then from artist/library list caches
 * (the album page used to miss covers that were already on the artist page).
 */
export const findCachedAlbum = (
  appModel: Record<string, unknown> | null | undefined,
  albumId: unknown
): AlbumLike | null => {
  if (albumId == null || !appModel) return null;

  const matches: AlbumLike[] = [];
  const allAlbums = findAlbumInList(appModel.allAlbums as AlbumLike[] | undefined, albumId);
  if (allAlbums) matches.push(allAlbums);

  for (const key of ALBUM_MAP_KEYS) {
    const map = appModel[key] as Record<string, AlbumLike[]> | undefined;
    if (!map || typeof map !== 'object') continue;
    for (const list of Object.values(map)) {
      const found = findAlbumInList(list, albumId);
      if (found) matches.push(found);
    }
  }

  if (matches.length === 0) return null;
  return matches.reduce((best, album) => (scoreAlbum(album) > scoreAlbum(best) ? album : best));
};
