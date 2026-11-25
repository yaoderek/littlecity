// What the UFO is drawn with (design section 13b, the UFO). Owner: Mischief.
//
//   saucerMesh   a domed disc about a house wide: a silver hull with a soft
//                round outline, a band of panels, a glass dome with a little
//                green figure inside; origin at the middle of its underside
//   lightsMesh   the ring of lights round the rim, half of them (two copies
//                drawn in turn make them chase)
//   beamMesh     the cone of light from its underside to the ground, one
//                unit tall (scaled to the drop), and the round pool it lays
//                on the ground: MIST, a translucent wash, never inked
//   shadowMesh   a soft round shadow on whatever is under it
//   helpMesh     the "HELP!" balloon over whoever is taken (the raiders' card)

import { rotationY } from '@/core/mat4';
import { MeshBuilder, PATTERN, type MeshData } from '@/gen/mesh';
import { smoothBall, smoothLathe } from '@/gen/soft';
import { airborne, MIST } from '@/gen/airborne';
import { balloon, dot, stroke } from '@/parts/people/balloon';
import { PALETTE } from '@/style/palette';

/** The saucer's size: its radius (a house is a cell wide), the hull's height under and over the rim, the dome. */
export const SAUCER = { r: 0.72, under: 0.13, over: 0.16, dome: 0.3, lights: 10 } as const;

let saucer: MeshData | null = null;
export function saucerMesh(): MeshData {
  if (saucer) return saucer;
  const b = new MeshBuilder({ ink: 'ufo' });
  const { r, under, over, dome } = SAUCER;
  const air = airborne(PATTERN.metal);
  // The hull: one smooth round from the hatch under it, out to the rim and up to the dome's foot.
  b.setInk('hull').setColor('#c9ccd6').setPattern(air);
  smoothLathe(b, [[0, 0], [r * 0.32, 0.005], [r * 0.7, under * 0.55], [r * 0.97, under * 0.95], [r, under + 0.01], [r * 0.93, under + over * 0.35], [r * 0.62, under + over * 0.8], [dome * 0.98, under + over]], { segments: 24, crease: 0.9 });
  // The hatch underneath: a darker disc.
  b.setInk('hatch').setColor('#6f7385');
  b.lathe([[r * 0.3, 0.006], [0, 0.004]], { segments: 16 });
  // The glass dome, and inside it a little green figure with big black eyes.
  b.setInk('dome').setColor('#a9dcef').setPattern(airborne(PATTERN.glass));
  smoothLathe(b, [[dome, under + over - 0.005], [dome * 0.92, under + over + dome * 0.42], [dome * 0.62, under + over + dome * 0.78], [0, under + over + dome * 0.9]], { segments: 18, crease: 1.2 });
  b.setInk('alien').setColor('#7ed36a').setPattern(air);
  smoothBall(b, 0, under + over + dome * 0.55, 0.0, 0.085, 0.1, 0.085, 10, 6);
  b.setInk('eyes').setColor(PALETTE.ink);
  for (const s of [-1, 1]) smoothBall(b, s * 0.035, under + over + dome * 0.58, 0.07, 0.022, 0.03, 0.012, 6, 4);
  saucer = b.build();
  return saucer;
}

const lights: (MeshData | null)[] = [null, null];
/** Half the rim's lights (every other one, from `half`): drawn in turn, they chase round. */
export function lightsMesh(half: 0 | 1): MeshData {
  const had = lights[half];
  if (had) return had;
  const b = new MeshBuilder({ ink: `ufo-lights-${half}` });
  const { r, under, lights: n } = SAUCER;
  // Self-lit (they glow at dusk and by night), and in the air.
  b.setPattern(airborne(PATTERN.glow));
  for (let i = half; i < n; i += 2) {
    const a = (i / n) * Math.PI * 2;
    b.setInk(`light${i}`).setColor(i % 4 < 2 ? '#ffe066' : '#ff8a5c');
    smoothBall(b, Math.cos(a) * r * 0.985, under + 0.012, Math.sin(a) * r * 0.985, 0.045, 0.035, 0.045, 8, 4);
  }
  const m = b.build();
  lights[half] = m;
  return m;
}

let beam: MeshData | null = null;
/** The cone from the hatch (r0, top, y = 0) down to the ground (r1, y = −1), and the pool of light at its foot. */
export function beamMesh(): MeshData {
  if (beam) return beam;
  const b = new MeshBuilder({ ink: 'ufo-beam' });
  // A soft wash (MIST): translucent, never inked, fading where its sides turn edge-on (soft edges).
  b.setColor('#eefab0').setPattern(MIST).setInk('beam');
  const r0 = SAUCER.r * 0.3, r1 = SAUCER.r * 0.85, sides = 16;
  for (let i = 0; i < sides; i++) {
    const a = (i / sides) * Math.PI * 2, c = ((i + 1) / sides) * Math.PI * 2;
    // Fading toward the ground (edge 0 at the hatch, 0.55 at the foot: still there where it lands).
    b.quad([Math.cos(a) * r0, 0, Math.sin(a) * r0], [Math.cos(a) * r1, -1, Math.sin(a) * r1], [Math.cos(c) * r1, -1, Math.sin(c) * r1], [Math.cos(c) * r0, 0, Math.sin(c) * r0], { edge: [0, 0.55, 0.55, 0] });
  }
  beam = b.build();
  return beam;
}

let pool: MeshData | null = null;
/** The round pool of light the beam lays on the ground (radius 1, flat, fading to its edge). */
export function poolMesh(): MeshData {
  if (pool) return pool;
  const b = new MeshBuilder({ ink: 'ufo-pool' });
  b.setColor('#f4ffc4').setPattern(MIST).setInk('pool');
  const sides = 20;
  for (let i = 0; i < sides; i++) {
    const a = (i / sides) * Math.PI * 2, c = ((i + 1) / sides) * Math.PI * 2;
    b.tri([0, 0, 0], [Math.cos(c), 0, Math.sin(c)], [Math.cos(a), 0, Math.sin(a)], { edge: [0.2, 0.95, 0.95] });
  }
  pool = b.build();
  return pool;
}

let shadow: MeshData | null = null;
/** A round shadow on the ground, radius 1 (scaled), flat. */
export function ufoShadowMesh(): MeshData {
  if (shadow) return shadow;
  const b = new MeshBuilder({ ink: 'ufo-shadow' });
  b.setPattern(airborne(PATTERN.none)).setInk('shadow').setColor('#8c8699');
  b.lathe([[1, 0], [1, 0.004], [0, 0.006]], { segments: 20 });
  shadow = b.build();
  return shadow;
}

type Pt = readonly [number, number];
const GLYPHS: Record<string, readonly (readonly Pt[])[]> = {
  H: [[[0, 0], [0, 1]], [[0.7, 0], [0.7, 1]], [[0, 0.52], [0.7, 0.52]]],
  E: [[[0.7, 1], [0, 1], [0, 0], [0.7, 0]], [[0, 0.52], [0.55, 0.52]]],
  L: [[[0, 1], [0, 0], [0.65, 0]]],
  P: [[[0, 0], [0, 1], [0.55, 1], [0.72, 0.86], [0.72, 0.66], [0.55, 0.52], [0, 0.52]]],
  '!': [[[0.2, 1], [0.2, 0.32]]],
};

let help: MeshData | null = null;
/** "HELP!" in a shout balloon, flat in its XY plane facing +Z (lettered on the back too), the tail's tip at the origin. */
export function helpMesh(): MeshData {
  if (help) return help;
  const b = new MeshBuilder({ ink: 'ufo-help' });
  const text = 'HELP!';
  const h = 0.085, w = 0.017, step = h * 0.86;
  const rx = (text.length * step) / 2 + 0.06, ry = 0.1, cy = 0.2, t = 0.01;
  b.setInk('balloon').setColor(PALETTE.white).setPattern(PATTERN.none);
  balloon(b, { rx, ry, cy, t, segments: 44, wobble: 0.08, seed: 11, tipX: -0.04, bow: 0.02 });
  b.setInk('word').setColor(PALETTE.redDark);
  const x0 = -(text.length * step - h * 0.2) / 2;
  for (const side of [0, Math.PI]) {
    b.at(rotationY(side), () => {
      [...text].forEach((ch, i) => {
        const g = GLYPHS[ch];
        if (!g) return;
        const ox = x0 + i * step;
        for (const line of g) stroke(b, line.map(([x, y]) => [ox + x * h * 0.62, cy - h / 2 + y * h] as const), w, t + 0.001);
        if (ch === '!') dot(b, ox + 0.2 * h * 0.62, cy - h / 2 + 0.08 * h, w * 0.75, t + 0.001, 8);
      });
    });
  }
  help = b.build();
  return help;
}
