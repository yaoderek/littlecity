// How sharp the page is drawn, and the governor that chooses (design section 14). Pure: no Three.js,
// no DOM, no clock (it is fed the gaps between frames).
//
// A view starts at its sharpest and only gives ground when frames are really slow, a level at a time,
// in this order: the super-sampling (only a low-density screen has it; from 2 to 1.5 to none), then
// the pixel ratio from 3 toward 2, and the half-resolution ink pass last (it is the change that shows
// most: lines a third of a phone's resolution, thick and soft). Once frames are comfortably fast again
// it tries one level back up; a level that proves slow again is not tried for a while, longer each
// time, so it never flickers between two.
//
// Slow is not only "every frame late". A level a little over what one refresh allows gives two frames
// on time and then one a refresh late: the median frame is on time, no frame is very long, and the
// picture judders, most of all while the camera turns. So a frame is long when it is well over the
// usual frame (the median), whatever the screen's refresh rate, and one long frame in ten is slow.
// (Derek, 2026-11-22, a 2560 x 1440 screen at 1x: "pretty strong jitter" turning the camera. Twice
// the size each way is 14.7 million pixels a frame there, about 17 ms of drawing on an M5: see
// startLevel.)
//
// And slow is not only "many frames, each a bit late". A device that cannot draw ten frames in a window
// is the slowest there is. (It was judged fine for ever: a window wanted ten frames, and every gap was
// longer than a "pause". Found 2026-11-24, when a lot of people came at once on all sorts of devices: a
// 1366 x 768 window with no graphics card stayed at four times its pixels, 1.3 frames a second.) Below
// the levels that look right there are now two rough ones, fewer pixels than the screen has: soft, and
// only for a device that would otherwise not be playable.

export interface Quality {
  /** Device pixels per CSS pixel the page is drawn at. */
  pixelRatio: number;
  /** The scene drawn at this many times the pixel ratio each way and averaged down (1, 1.5 or 2). */
  superSample: number;
  /** The ink computed at half resolution (cheaper, softer, blockier lines). */
  halfInk: boolean;
  /** Fewer pixels than the screen has: soft to look at, for a device that is really slow (GOVERNOR.roughAt). */
  rough?: true;
}

/** The levels for a screen of this device pixel ratio, sharpest first. */
export function qualityLevels(devicePixelRatio: number): Quality[] {
  const start = Math.max(1, Math.min(3, devicePixelRatio || 1));
  if (start < 1.5) {
    return [
      { pixelRatio: start, superSample: 2, halfInk: false },
      // Most of the smoothness for 56% of the pixels: the step a big screen can afford.
      { pixelRatio: start, superSample: 1.5, halfInk: false },
      { pixelRatio: start, superSample: 1, halfInk: false },
      { pixelRatio: start, superSample: 1, halfInk: true },
      // (The ink in full: at half of so few pixels a line is a smear, and the ink is the cheap pass.)
      { pixelRatio: start * 0.75, superSample: 1, halfInk: false, rough: true },
      { pixelRatio: start * 0.5, superSample: 1, halfInk: false, rough: true },
    ];
  }
  const out: Quality[] = [{ pixelRatio: start, superSample: 1, halfInk: false }];
  for (const r of [2.5, 2]) if (r < start - 0.25) out.push({ pixelRatio: r, superSample: 1, halfInk: false });
  const low = Math.min(start, 2);
  out.push({ pixelRatio: low, superSample: 1, halfInk: true });
  if (low > 1.5) out.push({ pixelRatio: 1.5, superSample: 1, halfInk: true });
  for (const r of [1, 0.7]) out.push({ pixelRatio: r, superSample: 1, halfInk: false, rough: true });
  return out;
}

/**
 * Pixels of the scene a frame, above which a super-sampled view starts a step down (measured on an
 * Apple M5, tools/perf.mjs --passes: 14.7 million take 15 ms at rest and 17.5 ms while the camera
 * turns, 9.2 million under 10 ms).
 */
export const START_PIXELS = 10_000_000;

/**
 * The level a view of this size (CSS pixels) starts at. The sharpest, unless that is super-sampled
 * and more pixels than a frame has time for: then the next one, and the governor tries the sharpest
 * once frames have been fast for a while (a faster machine gets it within seconds). A screen with
 * no super-sampling starts at its sharpest as before: its next level is a change that shows.
 */
export function startLevel(levels: readonly Quality[], width: number, height: number): number {
  const first = levels[0], next = levels[1];
  if (!first || !next || first.superSample <= 1 || next.superSample >= first.superSample) return 0;
  const side = first.pixelRatio * first.superSample;
  return width * side * height * side > START_PIXELS ? 1 : 0;
}

/** What a browser will say about the device it is on. */
export interface Device {
  /** The graphics driver's name (WEBGL_debug_renderer_info), or '' where it is not told. */
  gpu: string;
  /** Gigabytes, as navigator.deviceMemory has it (rounded, 8 at most, not in every browser). */
  memory?: number;
}

/** No graphics card at all: every pixel is worked out by the processor. */
const SOFTWARE = /swiftshader|llvmpipe|softpipe|basic render|software/i;
/** Chips that were never going to draw a screen at four times its pixels: old or cheap, by their family names. */
const WEAK = /intel.*\bu?hd graphics|intel.*\bgma\b|mali-(4|t|g31|g5[127]\b|g68)|adreno[^0-9]*([2-5]\d\d|6[01]\d)\b|powervr|videocore|radeon.*\br[2-5]\b/i;

/**
 * The level to start at for what the device says of itself. Only a start: the governor goes down or up
 * from there. A guess too low costs a strong device ten seconds of a little less sharpness; a guess too
 * high costs a weak one its first impression.
 */
export function deviceLevel(levels: readonly Quality[], device: Device): number {
  if (SOFTWARE.test(device.gpu)) return levels.length - 1;
  if (!WEAK.test(device.gpu) && !(device.memory !== undefined && device.memory <= 2)) return 0;
  const at = levels.findIndex((q) => q.superSample === 1 && q.pixelRatio <= 2);
  return Math.max(0, at);
}

export const GOVERNOR = {
  /** Milliseconds of frames judged together. */
  window: 2000,
  /** Milliseconds ignored after starting and after every change (shaders compile, buffers are made). */
  settle: 1500,
  /** A gap longer than this is a pause (a hidden tab, a rebuild), not a slow frame: left out, unless half the frames are. */
  pause: 250,
  /** Slow: the median frame longer than this (below about 48 a second) ... */
  slowMedian: 21,
  /**
   * ... or this share of frames long: over `longFrame` (two refreshes at 60 Hz), or well over the
   * usual frame (`longRatio` times the median: a frame that took two refreshes where most take one,
   * at 60 Hz or 120).
   */
  slowShare: 0.1,
  longFrame: 34,
  longRatio: 1.6,
  /** Very slow (the median longer than this): one window is enough to step down. */
  verySlow: 30,
  /** Slower than this, two levels at once; slower than that, straight to the last one, without waiting for motion. */
  crawl: 50,
  stall: 100,
  /** Rough levels are gone down to only for a median frame longer than this (33 a second and sharp beats 60 and soft). */
  roughAt: 30,
  /** A window is judged on at least this many frames, however long they take. */
  fewest: 5,
  /** Frames in which the page itself was busy are judged only when there are no others, and only as hopeless: longer than this, its own work taken off. */
  busySlow: 60,
  /** Fast: the median and the 90th percentile under these (a steady 60, or better), and hardly a long frame. */
  fastMedian: 17.5,
  fastP90: 20,
  fastShare: 0.03,
  /** A level just tried: for this long after it settles, one slow window sends it straight back. */
  trial: 12_000,
  /** Windows in a row: slow to step down, fast to try a level up. */
  slowWindows: 2,
  fastWindows: 5,
  /** After a level up proved slow: no new try for this long, doubling each time. */
  backoff: 30_000,
  /** A change waits for the picture to be moving (it then does not show as a pop), at most this long. */
  waitForMotion: 3000,
} as const;

export interface Governor {
  /** The level now (an index into the levels, 0 the sharpest). */
  readonly level: number;
  /**
   * One frame: the gap since the last (milliseconds) and whether the picture is moving now. `busy`:
   * the page was working in that gap (an edit resolved, the town rebuilt), so a long gap says nothing
   * of how fast the page is drawn and is left out (while there are other frames to go by; otherwise
   * it counts less `work`, the milliseconds of it the page's own work is known to have taken). Returns
   * the level to change to, when it changes, or null.
   */
  frame(gapMs: number, moving: boolean, busy?: boolean, work?: number): number | null;
}

export function createGovernor(levels: number, start = 0, rough: (level: number) => boolean = () => false): Governor {
  let level = Math.max(0, Math.min(levels - 1, start));
  let clock = 0;
  let quietUntil = GOVERNOR.settle;
  let gaps: number[] = [];
  /** The frames the page was busy in, its own work taken off. */
  let busyGaps: number[] = [];
  let windowStart = 0;
  let slowRun = 0, fastRun = 0;
  /** A level up being tried: where it came from, and until when a slow window sends it straight back. */
  let trial: { from: number; until: number } | null = null;
  /** No trying a level up before this time; and how long the next wait is. */
  let noUpUntil = 0;
  let nextBackoff: number = GOVERNOR.backoff;
  /** The level now was come up to (not stepped down to, and not the one it started at). */
  let rose = false;
  /** A change waiting for the picture to move; `up` when it is a try of the level above. */
  let pending: { to: number; since: number; up: boolean; now?: boolean } | null = null;

  const medianOf = (xs: readonly number[]): number => [...xs].sort((a, b) => a - b)[xs.length >> 1] ?? 0;
  /** What the window says, and its median frame. */
  const judge = (): { verdict: 'slow' | 'fast' | 'ok'; median: number } => {
    const ok = { verdict: 'ok', median: 0 } as const;
    if (gaps.length < GOVERNOR.fewest) {
      // Not one quiet frame to go by: a device so slow that the last edit's work is always in the last
      // few frames. What the page did itself is known, and taken off; the rest is drawing.
      const median = medianOf(busyGaps);
      return busyGaps.length >= GOVERNOR.fewest && median > GOVERNOR.busySlow ? { verdict: 'slow', median } : ok;
    }
    // A pause now and then is a pause. Every other frame longer than one is a page that cannot keep up.
    const pauses = gaps.filter((g) => g > GOVERNOR.pause).length;
    const s = (pauses * 2 >= gaps.length ? [...gaps] : gaps.filter((g) => g <= GOVERNOR.pause)).sort((a, b) => a - b);
    if (s.length < GOVERNOR.fewest) return ok;
    const median = s[s.length >> 1]!;
    const p90 = s[Math.floor(s.length * 0.9)]!;
    const longAt = Math.min(GOVERNOR.longFrame, median * GOVERNOR.longRatio);
    const long = s.filter((g) => g > longAt).length / s.length;
    if (median > GOVERNOR.slowMedian || long >= GOVERNOR.slowShare) return { verdict: 'slow', median };
    return { verdict: median <= GOVERNOR.fastMedian && p90 <= GOVERNOR.fastP90 && long <= GOVERNOR.fastShare ? 'fast' : 'ok', median };
  };
  /** The level to step down to from a window whose median frame was this long (the level now: nowhere to go). */
  const below = (median: number): number => {
    let to = median > GOVERNOR.stall ? levels - 1 : Math.min(levels - 1, level + (median > GOVERNOR.crawl ? 2 : 1));
    if (median <= GOVERNOR.roughAt) while (to > level && rough(to)) to--;
    return to;
  };

  return {
    get level() {
      return level;
    },
    frame(gapMs, moving, busy = false, work = 0) {
      clock += Math.min(gapMs, GOVERNOR.window / 2);
      if (pending) {
        if (moving || pending.now || clock - pending.since >= GOVERNOR.waitForMotion) {
          const { to, up } = pending;
          if (up) trial = { from: level, until: clock + GOVERNOR.settle + GOVERNOR.trial };
          rose = up;
          pending = null;
          level = to;
          quietUntil = clock + GOVERNOR.settle;
          gaps = [];
          busyGaps = [];
          windowStart = clock;
          return to;
        }
        return null;
      }
      if (clock < quietUntil) {
        windowStart = clock;
        return null;
      }
      if (busy) busyGaps.push(Math.max(0, gapMs - work));
      else gaps.push(gapMs);
      if (clock - windowStart < GOVERNOR.window || gaps.length + busyGaps.length < GOVERNOR.fewest) return null;
      const { verdict, median } = judge();
      const verySlow = verdict === 'slow' && median > GOVERNOR.verySlow;
      gaps = [];
      busyGaps = [];
      windowStart = clock;
      if (verdict === 'slow') {
        fastRun = 0;
        slowRun++;
        if (trial && clock <= trial.until) {
          // Not so slow that going back to a rough level is worth it: it stays, at less than 60 but sharp.
          if (rough(trial.from) && median <= GOVERNOR.roughAt) {
            trial = null;
            return null;
          }
          // The level up was too much: back, and wait longer before the next try.
          pending = { to: trial.from, since: clock, up: false };
          trial = null;
          noUpUntil = clock + nextBackoff;
          nextBackoff *= 2;
          slowRun = 0;
          return null;
        }
        const to = below(median);
        if ((slowRun >= GOVERNOR.slowWindows || verySlow) && to > level) {
          pending = { to, since: clock, up: false, now: median > GOVERNOR.crawl };
          slowRun = 0;
          // A level it had come back up to, that kept up for a while and no longer does (a level at
          // the edge): not straight back to it, and a longer wait each time.
          if (rose) {
            noUpUntil = clock + nextBackoff;
            nextBackoff *= 2;
          }
        }
        return null;
      }
      slowRun = 0;
      if (trial && clock > trial.until) trial = null;
      if (verdict === 'fast') {
        fastRun++;
        if (fastRun >= GOVERNOR.fastWindows && level > 0 && clock >= noUpUntil) {
          pending = { to: level - 1, since: clock, up: true };
          fastRun = 0;
        }
      } else fastRun = 0;
      return null;
    },
  };
}
