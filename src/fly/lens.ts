// The flying eye's field of view (fly mode, design section 7). Pure.

/** Up and down, degrees. */
export const FLY_FOV = 62;
/** Across, degrees, at the least: 62° up and down on an upright phone is 31° across, a look down a tube. */
export const ACROSS = 50;
/** Wider than this the top and bottom are drawn out. */
const WIDEST = 96;

const HALF = Math.PI / 360;

/** The field of view up and down for a picture this wide to its height. */
export function flyFov(aspect: number): number {
  const fov = Math.atan(Math.tan(ACROSS * HALF) / Math.max(1e-3, aspect)) / HALF;
  return Math.min(WIDEST, Math.max(FLY_FOV, fov));
}
