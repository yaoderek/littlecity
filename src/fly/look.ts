// Looking round in fly mode (design section 7): mouse movement turned into the eye's yaw and pitch.
// Pure.
//
// Every mouse movement between two frames is added up and the sum turns the eye once, at the start of
// the next frame, by exactly that much: one to one with the mouse, never eased (any easing on the look
// reads as lag). A movement no hand could make (browsers sometimes report a jump of thousands of pixels
// with the cursor captured) is dropped.

/** Degrees of turn per CSS pixel of mouse movement. */
export const LOOK_RATE = 0.16;
/** One mouse event moving more than this (CSS pixels, either way) is a glitch, not a hand. */
export const LOOK_SPIKE = 400;

export interface LookSum {
  dx: number;
  dy: number;
}

export const newLook = (): LookSum => ({ dx: 0, dy: 0 });

/** Adds one mouse movement; false if it was dropped as a glitch. */
export function addLook(sum: LookSum, dx: number, dy: number): boolean {
  if (!Number.isFinite(dx) || !Number.isFinite(dy) || Math.abs(dx) > LOOK_SPIKE || Math.abs(dy) > LOOK_SPIKE) return false;
  sum.dx += dx;
  sum.dy += dy;
  return true;
}

/** A finger turns the eye this many times as far as the mouse would: a thumb has half a phone to move in. */
export const DRAG_RATE = 2.5;

/** Adds a finger's movement. (All of it, however far: a finger is where it says, and one slow frame is a long way.) */
export function addDrag(sum: LookSum, dx: number, dy: number): void {
  sum.dx += dx * DRAG_RATE;
  sum.dy += dy * DRAG_RATE;
}

const wrap = (a: number): number => ((((a + 180) % 360) + 360) % 360) - 180;

/** Turns the eye by everything added since the last frame, and empties the sum. */
export function applyLook(eye: { yaw: number; pitch: number }, sum: LookSum): void {
  if (sum.dx !== 0) eye.yaw = wrap(eye.yaw - sum.dx * LOOK_RATE);
  if (sum.dy !== 0) eye.pitch = Math.max(-89, Math.min(89, eye.pitch - sum.dy * LOOK_RATE));
  sum.dx = 0;
  sum.dy = 0;
}
