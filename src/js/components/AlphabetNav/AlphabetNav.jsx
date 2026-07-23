import { useMemo } from 'react';
import { useSelector } from 'react-redux';
import clsx from 'clsx';

import { getAlphabetLetter } from 'js/utils';

import style from './AlphabetNav.module.scss';

const letters = ['#', ...'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('')];

const AlphabetNav = ({ entries = [], queueVisible = false }) => {
  const ignoreLeadingArticles = useSelector(({ sessionModel }) => sessionModel.optionSortIgnoreLeadingArticles);

  const letterIndexMap = useMemo(() => {
    const map = {};
    entries.forEach((entry, index) => {
      const letter = getAlphabetLetter(entry?.title, { ignoreLeadingArticles });
      if (map[letter] === undefined) {
        map[letter] = index;
      }
    });
    return map;
  }, [entries, ignoreLeadingArticles]);

  const handleClick = (letter) => {
    const index = letterIndexMap[letter];
    if (index == null || index < 0) return;

    window.dispatchEvent(new CustomEvent('chromatix-scroll-to-index', { detail: { index } }));
  };

  return (
    <div className={clsx(style.wrap, { [style.wrapQueueOpen]: queueVisible })} aria-label="Alphabet navigation">
      {letters.map((letter) => {
        const hasEntries = letterIndexMap[letter] != null;

        return (
          <button
            key={letter}
            type="button"
            className={clsx(style.letter, { [style.letterDisabled]: !hasEntries })}
            onClick={() => handleClick(letter)}
            disabled={!hasEntries}
          >
            {letter}
          </button>
        );
      })}
    </div>
  );
};

export default AlphabetNav;
