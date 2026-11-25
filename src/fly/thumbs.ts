// Flying by touch (fly mode, design section 7): one finger holds a stick, another looks. Pure.
//
// A finger landing low on the left holds the stick, whose base comes to where it landed; a finger
// anywhere else looks. One of each: a finger too many is nothing. This file only says who does what;
// src/ui/fly.ts feeds it pointer events and draws the stick.

export const STICK = {
  /** The stick is full this far from its base (CSS pixels). */
  radius: 52,
  /** This much of that is nothing at all (a thumb resting). */
  dead: 0.12,
  /** It may be taken hold of left of this share of the width and below this share of the height. */
  left: 0.5,
  below: 0.4,
} as const;

interface Point {
  x: number;
  y: number;
}

export interface Thumbs {
  /** What the stick asks for: x -1 left … 1 right, y -1 back … 1 forward; never longer than 1. */
  readonly stick: Readonly<Point>;
  /** The stick's base and the thumb on it (CSS pixels), or null with nobody holding it. */
  readonly base: Readonly<Point> | null;
  readonly thumb: Readonly<Point> | null;
  /** A finger came down on a picture w × h. */
  down(id: number, x: number, y: number, w: number, h: number): 'stick' | 'look' | null;
  /** It moved: how far it looks, or null if it is not the one that looks. */
  move(id: number, x: number, y: number): { dx: number; dy: number } | null;
  up(id: number): void;
  reset(): void;
}

export function createThumbs(): Thumbs {
  let holds: number | null = null;
  let looks: number | null = null;
  let base: Point | null = null;
  let thumb: Point | null = null;
  let last: Point = { x: 0, y: 0 };
  let stick: Point = { x: 0, y: 0 };
  const letGo = (): void => {
    holds = null;
    base = thumb = null;
    stick = { x: 0, y: 0 };
  };
  const push = (x: number, y: number): void => {
    let dx = x - base!.x, dy = y - base!.y;
    const d = Math.hypot(dx, dy);
    if (d > STICK.radius) {
      // Past the rim the base follows, so pulling back answers at once.
      const k = STICK.radius / d;
      base = { x: x - dx * k, y: y - dy * k };
      dx *= k;
      dy *= k;
    }
    thumb = { x, y };
    const far = Math.min(1, d / STICK.radius);
    const much = far <= STICK.dead ? 0 : (far - STICK.dead) / (1 - STICK.dead);
    const len = Math.hypot(dx, dy) || 1;
    stick = much === 0 ? { x: 0, y: 0 } : { x: (dx / len) * much, y: (-dy / len) * much };
  };
  const up = (id: number): void => {
    if (id === holds) letGo();
    if (id === looks) looks = null;
  };
  return {
    get stick() {
      return stick;
    },
    get base() {
      return base;
    },
    get thumb() {
      return thumb;
    },
    down(id, x, y, w, h) {
      up(id);
      if (holds === null && x < w * STICK.left && y > h * STICK.below) {
        holds = id;
        base = { x, y };
        thumb = { x, y };
        return 'stick';
      }
      if (looks !== null) return null;
      looks = id;
      last = { x, y };
      return 'look';
    },
    move(id, x, y) {
      if (id === holds) push(x, y);
      if (id !== looks) return null;
      const by = { dx: x - last.x, dy: y - last.y };
      last = { x, y };
      return by;
    },
    up,
    reset() {
      letGo();
      looks = null;
    },
  };
}
