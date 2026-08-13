/**
 * Pick a duration we can trust for "has this track actually ended?".
 *
 * HTMLAudioElement.duration can collapse to the buffered length after pause,
 * stall, or a dropped connection. Library metadata can be a few seconds short
 * of the decoded file. Prefer the live element when it looks complete; fall
 * back to metadata when the element is obviously truncated.
 */

const isUsableSec = (value: number): boolean => Number.isFinite(value) && value > 1;

export const resolveTrustedDurationSec = (elementDurationSec: number, expectedDurationSec: number): number => {
  const elOk = isUsableSec(elementDurationSec);
  const expectedOk = isUsableSec(expectedDurationSec);

  if (elOk && expectedOk) {
    // Collapsed buffer: live duration is much shorter than the known track length.
    if (elementDurationSec + 3 < expectedDurationSec) return expectedDurationSec;
    return elementDurationSec;
  }
  if (elOk) return elementDurationSec;
  if (expectedOk) return expectedDurationSec;
  return 0;
};

export const resolveTrustedDurationMs = (elementDurationMs: number, expectedDurationMs: number): number =>
  resolveTrustedDurationSec(elementDurationMs / 1000, expectedDurationMs / 1000) * 1000;

export default resolveTrustedDurationSec;
