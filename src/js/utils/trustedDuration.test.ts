import { endedAtDecodedDuration, resolveTrustedDurationMs, resolveTrustedDurationSec } from './trustedDuration';

describe('resolveTrustedDurationSec', () => {
  test('prefers the live element when it matches metadata', () => {
    expect(resolveTrustedDurationSec(240.4, 240)).toBe(240.4);
  });

  test('prefers the live element when metadata is a few seconds short', () => {
    expect(resolveTrustedDurationSec(245, 240)).toBe(245);
  });

  test('uses metadata when the element duration has collapsed', () => {
    expect(resolveTrustedDurationSec(45, 240)).toBe(240);
  });

  test('uses the element when metadata is missing', () => {
    expect(resolveTrustedDurationSec(180, 0)).toBe(180);
  });

  test('uses metadata when the element duration is missing', () => {
    expect(resolveTrustedDurationSec(NaN, 180)).toBe(180);
  });

  test('returns 0 when neither duration is usable', () => {
    expect(resolveTrustedDurationSec(NaN, 0)).toBe(0);
    expect(resolveTrustedDurationSec(0.5, 0.2)).toBe(0);
  });
});

describe('resolveTrustedDurationMs', () => {
  test('converts both inputs and the result', () => {
    expect(resolveTrustedDurationMs(45000, 240000)).toBe(240000);
    expect(resolveTrustedDurationMs(245000, 240000)).toBe(245000);
  });
});

describe('endedAtDecodedDuration', () => {
  test('metadata a few seconds long does not block a real end', () => {
    expect(
      endedAtDecodedDuration({
        ended: true,
        elementDurationSec: 180,
        positionSec: 179.8,
        expectedDurationSec: 184,
        lastGoodPositionSec: 179.8,
      })
    ).toBe(true);
  });

  test('a collapsed buffer is not the end of the file', () => {
    expect(
      endedAtDecodedDuration({
        ended: true,
        elementDurationSec: 45,
        positionSec: 45,
        expectedDurationSec: 240,
        lastGoodPositionSec: 90,
      })
    ).toBe(false);
  });

  test('an immediate end still advances', () => {
    expect(
      endedAtDecodedDuration({
        ended: true,
        elementDurationSec: 0,
        positionSec: 0,
        expectedDurationSec: 0,
        lastGoodPositionSec: 0,
      })
    ).toBe(true);
  });
});
