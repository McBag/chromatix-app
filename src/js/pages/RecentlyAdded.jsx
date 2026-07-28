import { useMemo } from 'react';

import { ActionToggle, ActionWrap, Loading, TitleHeading, ViewGrid, ViewList } from 'js/components';
import { useGetAlbumArray } from 'js/hooks';

const RecentlyAdded = () => {
  const {
    viewAlbums,
    sortAlbums,
    orderAlbums,
    gridOptions,
    colOptions,
    setViewAlbums,
    sortedAlbums: sourceAlbums,
  } = useGetAlbumArray();

  const sortedAlbums = useMemo(() => {
    if (!sourceAlbums) return sourceAlbums;
    return [...sourceAlbums].sort((a, b) => (b.addedAt || 0) - (a.addedAt || 0));
  }, [sourceAlbums]);

  const isLoading = !sortedAlbums;
  const isEmptyList = !isLoading && sortedAlbums?.length === 0;
  const isGridView = !isLoading && !isEmptyList && viewAlbums === 'grid';
  const isListView = !isLoading && !isEmptyList && viewAlbums === 'list';

  return (
    <>
      <TitleHeading
        title="Recently Added"
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

export default RecentlyAdded;
