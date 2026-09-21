import { useMemo, useRef } from 'react';

import { ActionToggle, ActionWrap, Loading, TitleHeading, ViewGrid, ViewList } from 'js/components';
import { useGetAlbumArray } from 'js/hooks';

const shuffle = (entries) => {
  const list = [...entries];
  for (let i = list.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [list[i], list[j]] = [list[j], list[i]];
  }
  return list;
};

const RandomAlbums = () => {
  const {
    viewAlbums,
    sortAlbums,
    orderAlbums,
    gridOptions,
    colOptions,
    setViewAlbums,
    sortedAlbums: sourceAlbums,
  } = useGetAlbumArray();

  const shuffleKeyRef = useRef('');
  const shuffledRef = useRef(null);
  const sortedAlbums = useMemo(() => {
    if (!sourceAlbums) return sourceAlbums;
    const key = sourceAlbums.map((album) => album.albumId).join('\0');
    if (shuffledRef.current && shuffleKeyRef.current === key) return shuffledRef.current;
    const next = shuffle(sourceAlbums);
    shuffleKeyRef.current = key;
    shuffledRef.current = next;
    return next;
  }, [sourceAlbums]);

  const isLoading = !sortedAlbums;
  const isEmptyList = !isLoading && sortedAlbums?.length === 0;
  const isGridView = !isLoading && !isEmptyList && viewAlbums === 'grid';
  const isListView = !isLoading && !isEmptyList && viewAlbums === 'list';

  return (
    <>
      <TitleHeading
        title="Random Albums"
        subtitle={sortedAlbums ? `${sortedAlbums.length} albums` : <>&nbsp;</>}
        padding={!isListView && !isGridView}
      />
      <ActionWrap padding={!isListView && !isGridView}>
        <ActionToggle
          value={viewAlbums}
          options={[
            { value: 'grid', label: 'Grid view' },
            { value: 'list', label: 'List view' },
          ]}
          setter={setViewAlbums}
          icon={viewAlbums === 'grid' ? 'GridIcon' : 'ListIcon'}
        />
      </ActionWrap>
      {isLoading && <Loading forceVisible inline showOffline />}
      {isGridView && (
        <ViewGrid
          variant="albums"
          entries={sortedAlbums}
          showFavs={gridOptions.isFavourite}
          showRatings={gridOptions.userRating}
        />
      )}
      {isListView && (
        <ViewList
          variant="albums"
          entries={sortedAlbums}
          sortKey={sortAlbums}
          orderKey={orderAlbums}
          colOptions={colOptions}
        />
      )}
      {isEmptyList && <Loading forceVisible inline showOffline />}
    </>
  );
};

export default RandomAlbums;
