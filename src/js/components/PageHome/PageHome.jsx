// ======================================================================
// IMPORTS
// ======================================================================

import React, { useRef } from 'react';
import { useDispatch } from 'react-redux';
import clsx from 'clsx';

import { Button, Icon } from 'js/components';
import { useGetDownloadLinks } from 'js/hooks';
import { analyticsEvent } from 'js/utils';

import style from './PageHome.module.scss';

// ======================================================================
// COMPONENT
// ======================================================================

export const PageHome = () => {
  const dispatch = useDispatch();
  const getStartedRef = useRef(null);

  const downloadLinks = useGetDownloadLinks();

  const scrollToGetStarted = () => {
    getStartedRef.current.scrollIntoView({ behavior: 'smooth' });
  };

  return (
    <div className={clsx(style.wrap, 'text-center')}>
      <main>
        <section aria-label="Introduction">
          {/* INTRO */}

          <div className={style.intro}>
            <h1 className={style.h1}>Chromatix</h1>

            <div className="mt-35 mt-lg-40"></div>

            <div className={style.body}>
              <p>
                A desktop music player for Plex and Jellyfin that transforms your listening experience and makes
                interacting with your music libraries a joy.
              </p>
            </div>

            <div className="mt-20 mt-lg-25"></div>

            <div className={style.badges}>
              <div className={clsx(style.badge, style.badgeDesktop)}>
                <span>Works with</span>
                <BadgeService icon="PlexSiteIcon" label="Plex" />
              </div>
              <div className={clsx(style.badge, style.badgeDesktop)}>
                <span>Works with</span>
                <BadgeService icon="JellyfinSiteIcon" label="Jellyfin" />
              </div>
              <div className={clsx(style.badge, style.badgeDesktop)}>
                <strong>Free</strong> to use
              </div>
              <div className={clsx(style.badge, style.badgeMobile)}>
                <span>Works with</span>
                <BadgeService icon="PlexSiteIcon" label="Plex" />
                <span>and</span>
                <BadgeService icon="JellyfinSiteIcon" label="Jellyfin" />
              </div>
            </div>

            <div className="mt-50 mt-lg-60"></div>

            <Button onClick={scrollToGetStarted}>Get Started</Button>
          </div>

          {/* IMAGE */}

          <div className={style.image}>
            <picture>
              <source type="image/webp" srcSet="/images/webp/chromatix-006.webp" />
              <img
                src="/images/compressed/chromatix-006.jpg"
                alt="Chromatix music player for Plex and Jellyfin"
                width="1920"
                height="1425"
                draggable="false"
              />
            </picture>
          </div>
        </section>

        {/* WHAT'S DIFFERENT FROM UPSTREAM */}

        <section className={style.differences} aria-label="What's different from upstream">
          <h2 className={style.h2}>What's different from upstream</h2>

          <div className="mt-25 mt-lg-30"></div>

          <div className={style.differencesIntro}>
            <p>
              This repository is a Tesla-optimized fork of Chromatix, based on upstream 1.0.0. The changes below are in
              this tree and are not in chromatix-app/chromatix-app. Tesla-oriented behaviour is the default; there is no
              user-agent sniffing.
            </p>
          </div>

          <div className={style.differencesBlock}>
            <h3 className={style.h3}>Start page and in-car UI</h3>
            <ul className={style.differencesList}>
              <li>
                The web app opens on the login form (PageLogin) instead of this marketing page, so the first screen in
                the car is a login.
              </li>
              <li>
                Larger back/forward nav arrows (a 24×24 icon inside a 52×48 touch target), a compact ControlBar with a
                52px play button, a larger sidebar search field, always-visible album-card queue and play buttons, an
                always-expanded Library section, and AlphabetNav on artist lists.
              </li>
            </ul>
          </div>

          <div className={style.differencesBlock}>
            <h3 className={style.h3}>Playback and Media Session</h3>
            <ul className={style.differencesList}>
              <li>
                Background playback continues when the tab is minimized, including auto-next, with a silent keep-alive
                so Tesla keeps media focus. Pause and seek restore the same position after a stall or a dropped
                connection. A 2 second Media Session pause guard ignores the spurious pause the car sends right after
                playback resumes.
              </li>
              <li>
                Stop / resume from the Tesla media bar is verified working: the first tap on the centre square pauses
                and keeps the card; a second tap resumes. There is no play triangle — that is a Tesla limitation. A 600
                ms debounce means one tap cannot pause and immediately resume. This toggle applies only when the pause
                came from the Tesla bar, not from the in-app pause button.
              </li>
            </ul>
          </div>

          <div className={style.differencesBlock}>
            <h3 className={style.h3}>Library pages and media card</h3>
            <ul className={style.differencesList}>
              <li>
                Recently Added and Random Albums sidebar pages, with list headers that stay sticky the same way as the
                Albums tab.
              </li>
              <li>
                Media Session title is the track title only; the second line is Artist - Album when an album is present.
                Unicode is left as-is.
              </li>
            </ul>
          </div>

          <div className={style.differencesBlock}>
            <h3 className={style.h3}>Debug, hosting, and branches</h3>
            <ul className={style.differencesList}>
              <li>
                Opt-in debug overlay, permanently in this fork: <code>?debug=1</code> shows it (remembered; the header
                includes the app version), <code>?debug=0</code> or the × button hides it. <code>?msSilent=0</code>,{' '}
                <code>?msHold=0</code>, and <code>?msStop=1</code> try the other Media Session pause variants.
              </li>
              <li>
                <code>npm run build:win</code> produces a CRA-style <code>build/</code> tree for Tesla static hosting.
                On the Ultra.cc nginx host, <code>index.html</code> is served with Cache-Control no-cache, and{' '}
                <code>/static</code> assets with a long immutable cache. Snapshot branches{' '}
                <code>{'release/<version>'}</code> keep the last three versions (currently 1.0.0, 0.74.0, and 0.73.0),
                based on the matching upstream tags.
              </li>
            </ul>
          </div>

          <div className={style.differencesBlock}>
            <h3 className={style.h3}>Known limits</h3>
            <ul className={style.differencesList}>
              <li>
                The Tesla media bar does not show a play triangle while the silent keep-alive stays playing (needed so
                the card is not dropped after a stop or a Grok call). Resume is the second tap on the stop square.
              </li>
              <li>
                Tesla Light Sync does not work with browser audio. That is a vehicle limit, not something this fork can
                enable.
              </li>
            </ul>
          </div>
        </section>

        {/* GET STARTED */}

        <section className={style.getStarted} ref={getStartedRef} aria-label="Get started">
          <h2 className={style.h2}>A fresh way to enjoy your music library</h2>

          <div className="mt-50 mt-lg-65"></div>

          <div className={style.option}>
            <div className={style.optionLabel}>Option 1</div>
            <h3 className={style.h3}>Use in your browser</h3>

            <hr className={style.dividerSubtitle} />

            <div className={style.buttons}>
              <Button
                onClick={dispatch.appModel.doPlexLogin}
                color="onPrimary"
                size="medium"
                wrap={false}
                icon={<Icon icon="PlexSiteIcon" cover />}
              >
                Login with Plex
              </Button>
              <Button
                to="/login-jellyfin"
                color="onPrimary"
                size="medium"
                wrap={false}
                icon={<Icon icon="JellyfinSiteIcon" cover />}
              >
                Login with Jellyfin
              </Button>
            </div>

            <div className={style.buttonsNote}>
              Note: Chromatix is optimised for desktop devices, and will not work well on mobile
            </div>
          </div>

          <div className="mt-60 mt-lg-80"></div>

          <div className={style.option}>
            <div className={style.optionLabel}>Option 2</div>
            <h3 className={style.h3}>Download the app</h3>

            <hr className={style.dividerSubtitle} />

            <div className={style.downloadsFlex}>
              <div>
                {downloadLinks.map((downloadLink, index) => (
                  <React.Fragment key={index}>
                    {downloadLink.kind === 'divider' ? (
                      <div className={style.downloadsDivider}></div>
                    ) : downloadLink.kind === 'link' ? (
                      <div>
                        <a
                          className={style.downloadsLink}
                          href={downloadLink.url}
                          target="_blank"
                          rel="noreferrer nofollow"
                          draggable="false"
                          onClick={() => logDownload(downloadLink.label)}
                        >
                          <span className={style.downloadsIcon}>
                            <Icon icon={downloadLink.icon} cover />
                          </span>
                          <span>{downloadLink.label}</span>
                        </a>
                      </div>
                    ) : (
                      <div className={style.downloadsNote}>
                        <span className={style.downloadsIcon}>
                          <Icon icon={downloadLink.icon} cover />
                        </span>
                        <span>{downloadLink.label}</span>
                      </div>
                    )}
                  </React.Fragment>
                ))}
              </div>
            </div>
          </div>
        </section>

        {/* SOCIAL */}

        <section className={style.social} aria-label="Community and support">
          <div className={style.icons}>
            <a
              className={style.icon}
              href="https://www.reddit.com/r/chromatix/"
              title="Join Chromatix on Reddit"
              target="_blank"
              rel="noreferrer nofollow"
              draggable="false"
            >
              <Icon icon="RedditSiteIcon" cover />
              <span className="u-hide-text">Join Chromatix on Reddit</span>
            </a>
            <a
              className={style.icon}
              href="https://github.com/chromatix-app"
              title="View Chromatix on GitHub"
              target="_blank"
              rel="noreferrer nofollow"
              draggable="false"
            >
              <Icon icon="GithubSiteIcon" cover />
              <span className="u-hide-text">View Chromatix on GitHub</span>
            </a>
            <a
              className={style.icon}
              href="https://chromatix.featurebase.app"
              title="Roadmap, feature requests and bug reports on Featurebase"
              target="_blank"
              rel="noreferrer nofollow"
              draggable="false"
            >
              <Icon icon="FeaturebaseSiteIcon" cover />
              <span className="u-hide-text">Roadmap, feature requests and bug reports on Featurebase</span>
            </a>
          </div>
          <div className={style.support}>
            <a
              className={style.github}
              href="https://github.com/sponsors/alexb148"
              target="_blank"
              rel="noreferrer nofollow"
              draggable="false"
              onClick={() => {
                analyticsEvent('Link / GitHub Sponsors');
              }}
            >
              Sponsor me on GitHub
            </a>
            <a
              className={style.kofi}
              href="https://ko-fi.com/chromaticnova"
              target="_blank"
              rel="noreferrer nofollow"
              draggable="false"
              onClick={() => {
                analyticsEvent('Link / Ko-fi');
              }}
            >
              Support me on Ko-fi
            </a>
          </div>
        </section>
      </main>

      {/* FOOTER */}

      <hr className={style.dividerFooter} />

      <footer className={style.legal}>Copyright &copy; {new Date().getFullYear()}</footer>
    </div>
  );
};

// ======================================================================
// BADGE SERVICE
// ======================================================================

const BadgeService = ({ icon, label }) => (
  <strong className={style.badgeService}>
    <span className={clsx(style.badgeIcon, style[icon])}>
      <Icon icon={icon} cover />
    </span>
    {label}
  </strong>
);

// ======================================================================
// HELPERS
// ======================================================================

const logDownload = (label) => {
  analyticsEvent(`Download / Home / ${label}`);
};

// ======================================================================
// EXPORT
// ======================================================================

export default PageHome;
