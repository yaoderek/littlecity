// Looking round in fly mode: every mouse movement between two frames counts, the sum turns the eye
// once and by exactly that much (no easing: easing on the look reads as lag), glitches are dropped.

import { describe, expect, test } from 'vitest';
import { addDrag, addLook, applyLook, DRAG_RATE, LOOK_RATE, LOOK_SPIKE, newLook } from './look';

describe('the look', () => {
  test('many small, uneven movements in a frame add up, and turn the eye by their sum, at once', () => {
    const sum = newLook();
    const eye = { yaw: 10, pitch: 0 };
    const moves = [1.5, -0.25, 3, 0.75, 2, -1, 0.5, 4.25];
    for (const m of moves) addLook(sum, m, m / 2);
    // Nothing moves until the frame applies it.
    expect(eye).toEqual({ yaw: 10, pitch: 0 });
    applyLook(eye, sum);
    const total = moves.reduce((a, b) => a + b, 0);
    expect(eye.yaw).toBeCloseTo(10 - total * LOOK_RATE, 9);
    expect(eye.pitch).toBeCloseTo(-(total / 2) * LOOK_RATE, 9);
    // Applied once: the next frame with no movement leaves the eye where it is (nothing eases on).
    applyLook(eye, sum);
    expect(eye.yaw).toBeCloseTo(10 - total * LOOK_RATE, 9);
    expect(sum).toEqual({ dx: 0, dy: 0 });
  });

  test('a glitch (a jump no hand could make) is dropped; pitch stops short of straight up and down', () => {
    const sum = newLook();
    expect(addLook(sum, LOOK_SPIKE + 1, 0)).toBe(false);
    expect(addLook(sum, Number.NaN, 0)).toBe(false);
    expect(addLook(sum, 3, -2)).toBe(true);
    expect(sum).toEqual({ dx: 3, dy: -2 });
    const eye = { yaw: 0, pitch: 80 };
    addLook(sum, 0, -1000 + 700);
    applyLook(eye, sum);
    expect(eye.pitch).toBe(89);
  });

  test("a finger turns it farther than the mouse, the same way, and a long swipe in one slow frame counts", () => {
    const sum = newLook();
    addDrag(sum, 10, -4);
    addDrag(sum, 240, 0);
    const eye = { yaw: 0, pitch: 0 };
    applyLook(eye, sum);
    expect(eye.yaw).toBeCloseTo(-250 * DRAG_RATE * LOOK_RATE, 9);
    expect(eye.pitch).toBeCloseTo(4 * DRAG_RATE * LOOK_RATE, 9);
  });
});
