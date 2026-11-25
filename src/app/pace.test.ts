import { describe, expect, test } from 'vitest';
import { CHEAP, createPace, LONGEST, REST } from './pace';

describe('when the dressing is worked out', () => {
  test('a fast device: in the next frame, every time', () => {
    const p = createPace();
    for (let t = 0; t < 1000; t += 16) {
      p.shown();
      expect(p.due(t)).toBe(true);
      p.done(t, CHEAP - 1);
    }
  });

  test('a slow device: the piece is drawn first, the dressing the frame after', () => {
    const p = createPace();
    p.shown();
    expect(p.due(0)).toBe(true);
    p.done(150, 150);
    // A tap, a little after and long after.
    for (const t of [1600, 60_000]) {
      p.shown();
      expect(p.due(t)).toBe(false);
      expect(p.due(t + 16)).toBe(true);
      p.done(t + 166, 150);
    }
  });

  test('a different town is dressed at once', () => {
    const p = createPace();
    p.shown();
    p.due(0);
    p.done(150, 150);
    p.shown();
    p.reset();
    expect(p.due(200)).toBe(true);
    p.done(350, 150);
    p.shown();
    expect(p.due(5000)).toBe(false);
  });

  test('edits without end (a town growing): a share of the time, and never too long without', () => {
    const p = createPace();
    p.shown();
    p.due(0);
    p.done(100, 100);
    let last = 100, dressings = 0, longest = 0;
    for (let t = 116; t < 20_000; t += 16) {
      if (t % 4 === 0) p.shown();
      if (!p.due(t)) continue;
      p.done(t + 100, 100);
      dressings++;
      longest = Math.max(longest, t - last);
      last = t + 100;
      t += 100;
    }
    expect((dressings * 100) / 20_000).toBeLessThanOrEqual(1 / (1 + REST) + 0.02);
    expect(longest).toBeLessThanOrEqual(LONGEST + 16);
  });

  test('every frame a new edit: still dressed now and then', () => {
    const p = createPace();
    p.shown();
    p.due(0);
    p.done(0, 100);
    let dressed = 0;
    for (let t = 16; t < 10_000; t += 16) {
      p.shown();
      if (p.due(t)) {
        dressed++;
        p.done(t, 100);
      }
    }
    expect(dressed).toBeGreaterThanOrEqual(5);
  });
});
