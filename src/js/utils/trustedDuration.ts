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

/**
 * True when `ended` belongs to the decoded file, not a collapsed buffer.
 * Metadata a few seconds longer than the file must not block the advance.
 * A duration that is much shorter than the library length is still a stall.
 */
export const endedAtDecodedDuration = ({
  ended,
  elementDurationSec,
  positionSec,
  expectedDurationSec,
  lastGoodPositionSec,
}: {
  ended: boolean;
  elementDurationSec: number;
  positionSec: number;
  expectedDurationSec: number;
  lastGoodPositionSec: number;
}): boolean => {
  if (!ended) return false;

  const elDur = elementDurationSec;
  const pos = Number.isFinite(positionSec) ? positionSec : lastGoodPositionSec;

  // Empty or sub-second files still have to leave the queue.
  if (!Number.isFinite(elDur) || elDur <= 1) return true;

  if (pos < elDur - 1.5) return false;

  // Collapsed buffer: the element duration shrank to the playhead, far short of the file.
  if (
    isUsableSec(expectedDurationSec) &&
    elDur + 15 < expectedDurationSec &&
    lastGoodPositionSec + 2 < expectedDurationSec
  ) {
    return false;
  }

  return true;
};

export default resolveTrustedDurationSec;
