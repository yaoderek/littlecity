// Flying by touch: which finger holds the stick, which one looks, and what they ask for.

import { describe, expect, test } from 'vitest';
import { createThumbs, STICK } from './thumbs';

const W = 390, H = 844;
const thumbs = () => createThumbs();

describe('the thumbs', () => {
  test('low on the left holds the stick where it lands; anywhere else looks', () => {
    for (const [x, y, is] of [[90, 700, 'stick'], [194, 340, 'stick'], [196, 700, 'look'], [90, 330, 'look'], [300, 100, 'look']] as const) {
      const t = thumbs();
      expect(t.down(1, x, y, W, H), `${x},${y}`).toBe(is);
      expect(t.base).toEqual(is === 'stick' ? { x, y } : null);
      expect(t.stick).toEqual({ x: 0, y: 0 });
    }
  });

  test('up is forward, right is right; farther is faster, from nothing inside the dead zone to one at the rim', () => {
    const t = thumbs();
    t.down(1, 100, 700, W, H);
    t.move(1, 100, 700 - STICK.radius);
    expect(t.stick.y).toBeCloseTo(1, 9);
    expect(t.stick.x).toBeCloseTo(0, 9);
    t.move(1, 100 + STICK.radius * STICK.dead, 700);
    expect(Math.hypot(t.stick.x, t.stick.y)).toBeCloseTo(0, 9);
    t.move(1, 100 + STICK.radius / 2, 700);
    expect(t.stick.x).toBeCloseTo((0.5 - STICK.dead) / (1 - STICK.dead), 9);
    t.move(1, 100 - STICK.radius * 0.6, 700 + STICK.radius * 0.8);
    expect(t.stick.x).toBeCloseTo(-0.6, 9);
    expect(t.stick.y).toBeCloseTo(-0.8, 9);
  });

  test('past the rim it is never more than one, and the base follows: pulling back answers at once', () => {
    const t = thumbs();
    t.down(1, 100, 700, W, H);
    t.move(1, 100, 500);
    expect(t.stick.y).toBeCloseTo(1, 9);
    expect(t.base!.y).toBeCloseTo(500 + STICK.radius, 9);
    t.move(1, 100, 500 + STICK.radius * 1.5);
    expect(t.stick.y).toBeLessThan(0);
  });

  test('two thumbs at once, whichever came first; letting one go leaves the other', () => {
    const t = thumbs();
    expect(t.down(7, 300, 600, W, H)).toBe('look');
    expect(t.down(8, 80, 700, W, H)).toBe('stick');
    expect(t.move(7, 310, 595)).toEqual({ dx: 10, dy: -5 });
    expect(t.move(8, 80, 640)).toBeNull();
    expect(t.stick.y).toBeCloseTo(1, 9);
    t.up(7);
    expect(t.stick.y).toBeCloseTo(1, 9);
    t.up(8);
    expect(t.stick).toEqual({ x: 0, y: 0 });
    expect(t.base).toBeNull();
  });

  test('the look is each movement, not the way from where the finger came down', () => {
    const t = thumbs();
    t.down(1, 300, 600, W, H);
    expect(t.move(1, 305, 600)).toEqual({ dx: 5, dy: 0 });
    expect(t.move(1, 305, 602)).toEqual({ dx: 0, dy: 2 });
  });

  test('a finger too many does nothing: neither a second stick nor a second look', () => {
    const t = thumbs();
    t.down(1, 80, 700, W, H);
    // The stick is held: the next one on the left looks.
    expect(t.down(2, 60, 600, W, H)).toBe('look');
    expect(t.down(3, 300, 600, W, H)).toBeNull();
    expect(t.move(3, 350, 600)).toBeNull();
    t.up(3);
    expect(t.move(2, 61, 600)).toEqual({ dx: 1, dy: 0 });
    // The same finger twice (a lost end): taken afresh.
    expect(t.down(1, 90, 650, W, H)).toBe('stick');
    expect(t.base).toEqual({ x: 90, y: 650 });
  });

  test('reset lets everything go', () => {
    const t = thumbs();
    t.down(1, 80, 700, W, H);
    t.down(2, 300, 600, W, H);
    t.move(1, 80, 600);
    t.reset();
    expect(t.stick).toEqual({ x: 0, y: 0 });
    expect(t.base).toBeNull();
    expect(t.move(1, 80, 500)).toBeNull();
    expect(t.move(2, 310, 600)).toBeNull();
    expect(t.down(3, 300, 600, W, H)).toBe('look');
  });
});
