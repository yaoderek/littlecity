// The flying eye's field of view: 62° up and down, and never less than 50° across.

import { describe, expect, test } from 'vitest';
import { ACROSS, FLY_FOV, flyFov } from './lens';

const across = (fov: number, aspect: number): number => (2 * Math.atan(Math.tan((fov * Math.PI) / 360) * aspect) * 180) / Math.PI;

describe('the lens', () => {
  test('a wide screen flies at 62°, as it always has', () => {
    for (const [w, h] of [[1280, 800], [1500, 950], [844, 390], [1024, 768]] as const) expect(flyFov(w / h)).toBe(FLY_FOV);
  });

  test('an upright one sees 50° across: phones, a tablet', () => {
    for (const [w, h] of [[390, 844], [402, 569], [320, 568], [768, 1024]] as const) {
      expect(across(flyFov(w / h), w / h)).toBeGreaterThanOrEqual(ACROSS - 1e-9);
      expect(flyFov(w / h)).toBeLessThan(95);
    }
    expect(across(flyFov(390 / 844), 390 / 844)).toBeCloseTo(ACROSS, 9);
  });

  test('a sliver of a window does not turn it into a fish eye', () => {
    expect(flyFov(0.1)).toBeLessThanOrEqual(96);
    expect(flyFov(0)).toBeLessThanOrEqual(96);
  });
});
