import { findAlbumInList, findCachedAlbum, sameEntityId } from './findCachedAlbum';

const album = (id: string | number, extra: Record<string, unknown> = {}) => ({
  albumId: id,
  title: extra.title as string | undefined,
  thumbSm: extra.thumbSm as string | undefined,
  thumbMd: extra.thumbMd as string | undefined,
  error404: extra.error404 as boolean | undefined,
});

describe('findCachedAlbum', () => {
  test('sameEntityId compares string and number ids', () => {
    expect(sameEntityId(13416, '13416')).toBe(true);
    expect(sameEntityId('13416', '13416')).toBe(true);
    expect(sameEntityId(13416, 13417)).toBe(false);
    expect(sameEntityId(null, '13416')).toBe(false);
  });

  test('findAlbumInList matches mixed id types', () => {
    const list = [album(13416, { title: 'When Your Heart Stops Beating' })];
    expect(findAlbumInList(list, '13416')?.title).toBe('When Your Heart Stops Beating');
    expect(findAlbumInList(list, 999)).toBeNull();
  });

  test('finds an album in allArtistAlbums when it is missing from allAlbums', () => {
    const found = findCachedAlbum(
      {
        allAlbums: [],
        allArtistAlbums: {
          'lib-1': [album('13416', { title: 'When Your Heart Stops Beating', thumbSm: 'sm-360', thumbMd: 'md-680' })],
        },
      },
      13416
    );
    expect(found?.title).toBe('When Your Heart Stops Beating');
    expect(found?.thumbMd).toBe('md-680');
    expect(found?.thumbSm).toBe('sm-360');
  });

  test('prefers a complete allAlbums entry over a cached list row', () => {
    const found = findCachedAlbum(
      {
        allAlbums: [album('13416', { title: 'Details', thumbSm: 'sm', thumbMd: 'md' })],
        allArtistAlbums: {
          'lib-1': [album('13416', { title: 'List only', thumbSm: 'sm' })],
        },
      },
      '13416'
    );
    expect(found?.title).toBe('Details');
    expect(found?.thumbMd).toBe('md');
  });

  test('prefers a cached row with artwork over an allAlbums 404 stub', () => {
    const found = findCachedAlbum(
      {
        allAlbums: [album('13416', { error404: true })],
        allArtistAlbums: {
          'lib-1': [album(13416, { title: 'News', thumbSm: 'sm-360' })],
        },
      },
      '13416'
    );
    expect(found?.title).toBe('News');
    expect(found?.thumbSm).toBe('sm-360');
  });

  test('returns null when the album is not in any cache', () => {
    expect(findCachedAlbum({ allAlbums: [album(1)], allArtistAlbums: {} }, 'missing')).toBeNull();
  });
});
