// ======================================================================
// IMPORTS
// ======================================================================

import { useEffect, useRef } from 'react';
import debounce from 'lodash/debounce';
import clsx from 'clsx';

import style from './RangeSlider.module.scss';

// ======================================================================
// COMPONENT
// ======================================================================

export const RangeSlider = ({
  id,
  min = 0,
  max = 100,
  step = 1,
  value,
  allowAccess = true,
  isDisabled = false,
  hideBar = false,
  handleChange,
  handleMouseDown,
  handleMouseUp,
}) => {
  const widthPercent = ((value - min) / (max - min)) * 100;

  const handleChangeRef = useRef(handleChange);
  handleChangeRef.current = handleChange;
  const debouncedHandleChange = useRef(debounce((next) => handleChangeRef.current?.(next), 10)).current;

  useEffect(() => () => debouncedHandleChange.cancel(), [debouncedHandleChange]);

  return (
    <div className={style.wrap}>
      <div
        className={clsx(
          style.input,
          allowAccess && !isDisabled && style.inputAccessible,
          isDisabled && !hideBar && style.inputDisabled
        )}
      >
        <div className={style.track}>
          {!hideBar && (
            <div
              className={style.fill}
              style={{
                width: widthPercent + '%',
              }}
            ></div>
          )}
        </div>

        <input
          type="range"
          id={id}
          min={min}
          max={max}
          step={step}
          value={value}
          onChange={(event) => !isDisabled && debouncedHandleChange(parseFloat(event.target.value))}
          onMouseDown={!isDisabled ? handleMouseDown : undefined}
          onMouseUp={!isDisabled ? (event) => handleMouseUp?.(parseFloat(event.currentTarget.value)) : undefined}
          onTouchStart={!isDisabled ? handleMouseDown : undefined}
          onTouchEnd={!isDisabled ? (event) => handleMouseUp?.(parseFloat(event.currentTarget.value)) : undefined}
          disabled={isDisabled}
          tabIndex={allowAccess && !isDisabled ? 0 : -1}
        />
      </div>
    </div>
  );
};

// ======================================================================
// EXPORT
// ======================================================================

export default RangeSlider;
