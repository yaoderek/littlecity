// When the town's dressing is worked out (src/resolve/staged.ts poll): at once on a fast device, and on a
// slow one a little later and not too often. Pure: no clock of its own. Owner: Interface.
//
// An edit has two halves. The shape (the walls and roofs) is worked out in the edit itself; the dressing
// (people, props, everything the rules decorate with) follows. On a slow phone the dressing alone is a
// few hundred milliseconds, and done in the very next frame it stood between a tap and the first picture
// of what the tap did. So there: the piece is drawn first, then the dressing is done; and while edits keep
// coming (a town growing) the dressing takes at most a share of the time, the newest town's only.

/** A dressing cheaper than this (ms) is done in the next frame, as if this file did not exist. */
export const CHEAP = 12;
/** A dressing takes at most 1 / (1 + REST) of the time. */
export const REST = 3;
/** ... and where it is frames lost, not more often than this (ms), however cheap it gets: fewer hitches. */
export const APART = 800;
const HITCH = 25;
/** ... but the town is never left undressed longer than this (ms). */
export const LONGEST = 1600;

export interface Pace {
  /** The town was shown without its dressing. */
  shown(): void;
  /** Once a frame: is it time to work the dressing out? */
  due(now: number): boolean;
  /** It was worked out and drawn, ending now, and took this long (ms). */
  done(now: number, took: number): void;
  /** A different town altogether: its dressing does not wait (the old town's props would show meanwhile). */
  reset(): void;
  /** What a dressing takes on this device (ms), of late. */
  readonly cost: number;
}

export function createPace(): Pace {
  let cost = 0;
  let waiting = false;
  let urgent = false;
  /** Frames begun since the town was last shown (the first of them draws it). */
  let frames = 0;
  let last = -Infinity;
  /** The first frame that found the town undressed, or null. */
  let since: number | null = null;
  return {
    get cost() {
      return cost;
    },
    shown() {
      waiting = true;
      frames = 0;
    },
    reset() {
      urgent = true;
    },
    due(now) {
      if (!waiting || urgent || cost < CHEAP) return true;
      frames++;
      since ??= now;
      if (now - since >= LONGEST) return true;
      // The first frame draws the piece itself; the dressing is for a frame after it.
      return frames > 1 && now - last >= Math.max(cost * REST, cost > HITCH ? APART : 0);
    },
    done(now, took) {
      // Quick to believe it is slow, slower to believe it is fast again.
      cost = took > cost ? took : cost + (took - cost) * 0.3;
      waiting = false;
      urgent = false;
      since = null;
      last = now;
    },
  };
}
