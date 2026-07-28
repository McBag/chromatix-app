// ======================================================================
// IMPORTS
// ======================================================================

import { useMemo } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { NavLink } from 'react-router-dom';
import clsx from 'clsx';

import { Favourite, Icon, PopoverMenu, RangeSlider, StarRating, ContextMenuTracks } from 'js/components';
import {
  useKeyPlaybackControls,
  useKeyMediaControls,
  useMediaControls,
  useMediaMeta,
  usePlayerProgress,
} from 'js/hooks';
import { analyticsEvent, durationToStringShort } from 'js/utils';
import platformFeatures from 'js/_config/platformFeatures';

import style from './ControlBar.module.scss';

// ======================================================================
// COMPONENT
// ======================================================================

const ControlBar = () => {
  return (
    <div className={style.wrap} data-allow-key-controls>
      <div className={style.leftSection}>
        <PrimaryControls />
        <ControlProgress />
      </div>

      <div className={style.centerSection}>
        <NowPlaying />
      </div>

      <div className={style.rightSection}>
        <SecondaryControls />
      </div>
    </div>
  );
};

const NowPlaying = () => {
  const dispatch = useDispatch();

  const controlBarTitle = useSelector(({ sessionModel }) => sessionModel.controlBarTitle);
  const controlBarArtist = useSelector(({ sessionModel }) => sessionModel.controlBarArtist);
  const controlBarAlbum = useSelector(({ sessionModel }) => sessionModel.controlBarAlbum);
  const controlBarIsFavourite = useSelector(({ sessionModel }) => sessionModel.controlBarIsFavourite);
  const controlBarUserRating = useSelector(({ sessionModel }) => sessionModel.controlBarUserRating);

  const playingLink = useSelector(({ sessionModel }) => sessionModel.playingLink);
  const playingTrackList = useSelector(({ sessionModel }) => sessionModel.playingTrackList);
  const playingTrackIndex = useSelector(({ sessionModel }) => sessionModel.playingTrackIndex);
  const playingTrackKeys = useSelector(({ sessionModel }) => sessionModel.playingTrackKeys);

  const currentService = useSelector(({ appModel }) => appModel.currentService);
  const platformOpts = platformFeatures[currentService] || {};

  const trackCurrent = playingTrackList?.[playingTrackKeys[playingTrackIndex]];

  return (
    <div className={style.nowPlayingOuter}>
      <ContextMenuTracks track={trackCurrent}>
        <div className={style.nowPlayingInner}>
          <div className={clsx(style.coverWrap, { [style.coverPlaceholder]: !trackCurrent || !trackCurrent?.thumbSm })}>
            {trackCurrent && (
              <>
                {trackCurrent.thumbSm && (
                  <div className={style.coverArtwork}>
                    <img src={trackCurrent.thumbSm} alt={trackCurrent.title} draggable="false" />
                  </div>
                )}
                {playingLink && (
                  <NavLink
                    className={style.coverLink}
                    to={playingLink}
                    draggable="false"
                    onClick={() => {
                      dispatch.appModel.setAppState({ scrollToPlaying: true });
                      analyticsEvent('Navigate to Playing');
                    }}
                  />
                )}
              </>
            )}
          </div>

          <div className={style.detailsWrap}>
            {/* Always reserve fixed line slots when enabled so the bar never shifts between songs. */}
            {controlBarTitle && (
              <div className={style.title}>
                {trackCurrent?.title || <span className={style.linePlaceholder}>–</span>}
              </div>
            )}

            {controlBarArtist && (
              <div className={style.artist}>
                {trackCurrent?.artistLink ? (
                  <NavLink to={trackCurrent.artistLink} draggable="false">
                    {trackCurrent.artist}
                  </NavLink>
                ) : trackCurrent?.artist ? (
                  trackCurrent.artist
                ) : (
                  <span className={style.linePlaceholder}>–</span>
                )}
              </div>
            )}

            {controlBarAlbum && (
              <div className={style.album}>
                {trackCurrent?.albumLink ? (
                  <NavLink to={trackCurrent.albumLink} draggable="false">
                    {trackCurrent.album}
                  </NavLink>
                ) : trackCurrent?.album ? (
                  trackCurrent.album
                ) : (
                  <span className={style.linePlaceholder}>–</span>
                )}
              </div>
            )}

            {(controlBarIsFavourite && platformOpts?.enableIsFavourite) ||
            (controlBarUserRating && platformOpts?.enableUserRating) ? (
              <div className={style.metaRow}>
                {controlBarIsFavourite && platformOpts?.enableIsFavourite && (
                  <div className={style.favourite}>
                    {trackCurrent ? (
                      <Favourite
                        type="track"
                        itemId={trackCurrent.trackId}
                        isFavourite={trackCurrent.isFavourite}
                        size={14}
                        editable
                      />
                    ) : null}
                  </div>
                )}
                {controlBarUserRating && platformOpts?.enableUserRating && (
                  <div className={style.rating}>
                    {trackCurrent ? (
                      <StarRating
                        type="track"
                        ratingKey={trackCurrent.trackId}
                        rating={trackCurrent.userRating}
                        editable
                        size={13}
                      />
                    ) : null}
                  </div>
                )}
              </div>
            ) : null}
          </div>
        </div>
      </ContextMenuTracks>
    </div>
  );
};

export const PrimaryControls = ({ fullPageMode }) => {
  const dispatch = useDispatch();

  const playerLoading = useSelector(({ playerModel }) => playerModel.playerLoading);
  const playerPlaying = useSelector(({ playerModel }) => playerModel.playerPlaying);

  const playingTrackList = useSelector(({ sessionModel }) => sessionModel.playingTrackList);
  const playingTrackIndex = useSelector(({ sessionModel }) => sessionModel.playingTrackIndex);
  const playingTrackKeys = useSelector(({ sessionModel }) => sessionModel.playingTrackKeys);
  const playingRepeatAll = useSelector(({ sessionModel }) => sessionModel.playingRepeatAll);
  const playingRepeatOnce = useSelector(({ sessionModel }) => sessionModel.playingRepeatOnce);
  const playingShuffle = useSelector(({ sessionModel }) => sessionModel.playingShuffle);

  const trackCurrent = playingTrackList?.[playingTrackKeys[playingTrackIndex]];
  const isDisabled = !trackCurrent ? true : false;

  // handle keyboard controls
  const controlHandlers = useMemo(
    () => ({
      playPause: () =>
        !isDisabled && (!playerPlaying ? dispatch.playerModel.playerResume() : dispatch.playerModel.playerPause()),
      play: () => !isDisabled && dispatch.playerModel.playerResume(),
      pause: () => !isDisabled && dispatch.playerModel.playerPause(),
      prev: () => !isDisabled && dispatch.playerModel.playerPrev(),
      next: () => !isDisabled && dispatch.playerModel.playerNext(),
    }),
    [dispatch, isDisabled, playerPlaying]
  );

  const trackMeta = useMemo(() => {
    if (!trackCurrent) return null;

    const artwork = [];
    if (trackCurrent.thumbMd) {
      artwork.push({ src: trackCurrent.thumbMd, sizes: '512x512', type: 'image/jpeg' });
    } else if (trackCurrent.thumbSm) {
      artwork.push({ src: trackCurrent.thumbSm, sizes: '256x256', type: 'image/jpeg' });
    }

    return {
      title: trackCurrent.title,
      artist: trackCurrent.artist,
      album: trackCurrent.album,
      thumbMd: trackCurrent.thumbMd,
      thumbSm: trackCurrent.thumbSm,
      artwork,
    };
  }, [trackCurrent]);

  useKeyPlaybackControls(controlHandlers);
  useKeyMediaControls(controlHandlers);
  useMediaControls(controlHandlers);
  useMediaMeta(trackMeta);

  return (
    <div className={clsx(style.primaryControls, { [style.fullPageMode]: fullPageMode })}>
      <button
        type="button"
        className={clsx(style.shuffle, { [style.active]: playingShuffle })}
        onClick={dispatch.playerModel.playerShuffleToggle}
        disabled={isDisabled}
      >
        <Icon icon="ShuffleIcon" cover stroke />
      </button>
      <button type="button" className={style.rewind} onClick={dispatch.playerModel.playerPrev} disabled={isDisabled}>
        <Icon icon="RewindIcon" cover stroke />
      </button>
      {!playerPlaying && (
        <button type="button" className={style.play} onClick={dispatch.playerModel.playerResume} disabled={isDisabled}>
          <Icon icon="PlayFilledIcon" cover />
        </button>
      )}
      {playerPlaying && (
        <button type="button" className={style.pause} onClick={dispatch.playerModel.playerPause}>
          {!playerLoading && <Icon icon="PauseFilledIcon" cover />}
          {playerLoading && <div className={style.loading}></div>}
        </button>
      )}
      <button type="button" className={style.forward} onClick={dispatch.playerModel.playerNext} disabled={isDisabled}>
        <Icon icon="FastForwardIcon" cover stroke />
      </button>
      <button
        type="button"
        className={clsx(style.repeat, { [style.active]: playingRepeatAll || playingRepeatOnce })}
        onClick={dispatch.playerModel.playerRepeatToggle}
        disabled={isDisabled}
      >
        {playingRepeatOnce ? <Icon icon="RepeatOnceIcon" cover stroke /> : <Icon icon="RepeatAllIcon" cover stroke />}
      </button>
    </div>
  );
};

export const SecondaryControls = ({ fullPageMode }) => {
  const dispatch = useDispatch();

  const isOnline = useSelector(({ appModel }) => appModel.isOnline);

  const volumeLevel = useSelector(({ sessionModel }) => sessionModel.volumeLevel);
  const volumeMuted = useSelector(({ sessionModel }) => sessionModel.volumeMuted);
  const queueIsVisible = useSelector(({ sessionModel }) => sessionModel.queueIsVisible);

  const playingTrackList = useSelector(({ sessionModel }) => sessionModel.playingTrackList);
  const playingTrackIndex = useSelector(({ sessionModel }) => sessionModel.playingTrackIndex);
  const playingTrackKeys = useSelector(({ sessionModel }) => sessionModel.playingTrackKeys);

  const controlBarFullPageToggle = useSelector(({ sessionModel }) => sessionModel.controlBarFullPageToggle);
  const controlBarQueueToggle = useSelector(({ sessionModel }) => sessionModel.controlBarQueueToggle);
  const controlBarVolumeToggle = useSelector(({ sessionModel }) => sessionModel.controlBarVolumeToggle);
  const controlBarVolumeSlider = useSelector(({ sessionModel }) => sessionModel.controlBarVolumeSlider);

  const trackCurrent = playingTrackList?.[playingTrackKeys[playingTrackIndex]];
  const expandDisabled = !trackCurrent ? true : false;
  const queueDisabled = !trackCurrent && !queueIsVisible ? true : false;

  const volIcon = volumeMuted || volumeLevel <= 0 ? 'VolXIcon' : volumeLevel < 50 ? 'VolLowIcon' : 'VolHighIcon';

  return (
    <div className={clsx(style.secondaryControls, { [style.fullPageMode]: fullPageMode })}>
      <div className={style.secondaryButtons}>
        {fullPageMode && (
          <button type="button" className={style.expand} onClick={dispatch.appModel.fullPageOff}>
            <Icon icon="CollapseIcon" cover stroke />
          </button>
        )}

        {fullPageMode && <FullPageMenu />}

        {!fullPageMode && controlBarFullPageToggle && (
          <button
            type="button"
            className={style.expand}
            onClick={dispatch.appModel.fullPageOn}
            disabled={expandDisabled}
          >
            <Icon icon="ExpandSplitIcon" cover stroke />
          </button>
        )}

        {!fullPageMode && controlBarQueueToggle && (
          <button
            type="button"
            className={clsx(style.queue, { [style.active]: queueIsVisible })}
            onClick={dispatch.sessionModel.queueVisibleToggle}
            disabled={queueDisabled}
          >
            <Icon icon="QueueIcon" cover stroke />
          </button>
        )}

        {controlBarVolumeToggle && (
          <button type="button" className={style.volume} onClick={dispatch.playerModel.volumeMuteToggle}>
            <Icon icon={volIcon} cover stroke />
          </button>
        )}
      </div>

      {controlBarVolumeSlider && (
        <div className={style.volSlider}>
          <RangeSlider
            value={volumeMuted ? 0 : volumeLevel}
            handleChange={dispatch.playerModel.volumeLevelSet}
            allowAccess={false}
          />
        </div>
      )}

      {!isOnline && (
        <div className={style.secondaryButtons}>
          <div className={style.offline} title="No Internet Connection">
            <Icon icon="CloudOfflineIcon" cover stroke strokeWidth={1.2} />
          </div>
        </div>
      )}
    </div>
  );
};

const FullPageMenu = () => {
  const dispatch = useDispatch();

  const fullPageArtist = useSelector(({ sessionModel }) => sessionModel.fullPageArtist);
  const fullPageAlbum = useSelector(({ sessionModel }) => sessionModel.fullPageAlbum);
  const fullPageIsFavourite = useSelector(({ sessionModel }) => sessionModel.fullPageIsFavourite);
  const fullPageUserRating = useSelector(({ sessionModel }) => sessionModel.fullPageUserRating);
  const fullPageCodec = useSelector(({ sessionModel }) => sessionModel.fullPageCodec);
  const fullPageBitrate = useSelector(({ sessionModel }) => sessionModel.fullPageBitrate);
  const fullPageTheme = useSelector(({ sessionModel }) => sessionModel.fullPageTheme);

  const currentService = useSelector(({ appModel }) => appModel.currentService);
  const platformOpts = platformFeatures[currentService] || {};

  const optionsSetter = (key, value) => {
    dispatch.sessionModel.setSessionState({
      [key]: value,
    });
  };

  return (
    <PopoverMenu
      setter={optionsSetter}
      top={-2}
      left={2}
      entries={[
        {
          label: 'Title',
          disabled: true,
          checked: true,
        },
        {
          label: 'Artist',
          attr: 'fullPageArtist',
          checked: fullPageArtist,
        },
        {
          label: 'Album',
          attr: 'fullPageAlbum',
          checked: fullPageAlbum,
        },
        ...(platformOpts?.enableIsFavourite
          ? [
              {
                label: 'Favourites',
                attr: 'fullPageIsFavourite',
                checked: fullPageIsFavourite,
              },
            ]
          : []),
        ...(platformOpts?.enableUserRating
          ? [
              {
                label: 'Rating',
                attr: 'fullPageUserRating',
                checked: fullPageUserRating,
              },
            ]
          : []),
        {
          label: 'Audio codec',
          attr: 'fullPageCodec',
          checked: fullPageCodec,
        },
        {
          label: 'Bitrate',
          attr: 'fullPageBitrate',
          checked: fullPageBitrate,
        },
        {
          variant: 'divider',
        },
        {
          label: 'Match your theme',
          attr: 'fullPageTheme',
          checked: fullPageTheme,
        },
      ]}
    >
      <span className={style.settings}>
        <Icon icon="CogIcon" cover stroke />
      </span>
    </PopoverMenu>
  );
};

export const ControlProgress = () => {
  const {
    trackProgress,
    trackProgressCurrent,
    trackProgressMax,
    handleProgressChange,
    handleProgressMouseDown,
    handleProgressMouseUp,
    isDisabled,
  } = usePlayerProgress();

  const playingTrackList = useSelector(({ sessionModel }) => sessionModel.playingTrackList);
  const playingTrackIndex = useSelector(({ sessionModel }) => sessionModel.playingTrackIndex);
  const playingTrackKeys = useSelector(({ sessionModel }) => sessionModel.playingTrackKeys);

  const realIndex = playingTrackKeys?.[playingTrackIndex];
  const trackCurrent = playingTrackList?.[realIndex];

  return (
    <div className={style.scrubber}>
      <div className={style.scrubLeft}>{!isDisabled && durationToStringShort(trackProgress)}</div>
      <div className={style.scrubSlider}>
        <RangeSlider
          max={trackProgressMax}
          value={trackProgressCurrent}
          handleChange={handleProgressChange}
          handleMouseDown={handleProgressMouseDown}
          handleMouseUp={handleProgressMouseUp}
          isDisabled={isDisabled}
          hideBar={isDisabled}
          allowAccess={false}
        />
      </div>
      <div className={style.scrubRight}>{!isDisabled && durationToStringShort(trackCurrent?.duration)}</div>
    </div>
  );
};

// ======================================================================
// EXPORT
// ======================================================================

export default ControlBar;
