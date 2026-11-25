// What the UFO is drawn with (design section 13b, the UFO). Owner: Mischief.
//
//   saucerMesh   a cartoon flying saucer about a house and a half wide: a silver
//                upper hull and a darker ribbed underside, a red rim band that
//                glows (so the saucer reads against dark roofs at night), a
//                turquoise glow round the hatch underneath, the dome's base ring, an
//                antenna; origin at the middle of its underside
//   domeMesh     its glass dome: a pale translucent wash (MIST), so whoever
//                sits inside it shows through
//   alienMesh    the little green pilot, head, big black eyes and shoulders,
//                drawn on its own (it leans over the dome's edge to look about)
//   lightsMesh   the ring of coloured lights round the rim and the antenna's
//                tip, half of them in each of two copies (drawn in turn: they
//                chase and the tip blinks); self-lit
//   coneMesh     the tractor beam: a cone from the hatch (y 0) to the ground
//                (y −1), translucent turquoise light, brightest at its edges, fading
//                down its length (the renderer's tractor mode: PATTERN.beam
//                with param d = −1, src/render/shaders/surface.ts)
//   ringsMesh    four bands round the cone a quarter of its length apart,
//                moved up it (lifting) or down it (setting down)
//   poolMesh     the pool of light where the beam meets the ground, and the
//                wider spill of it round about (lighting the street at night)
//   rimMesh      the pool's bright pulsing rim
//   motesMesh    sparkles rising in the beam
//   ufoShadowMesh  a ring of shadow under it (bigger as it comes down)
//   helpMesh     the "HELP!" balloon over whoever is taken (the raiders' card)

import { rotationY } from '@/core/mat4';
import { MeshBuilder, PATTERN, type MeshData } from '@/gen/mesh';
import { smoothBall, smoothLathe } from '@/gen/soft';
import { airborne, MIST } from '@/gen/airborne';
import { balloon, dot, stroke } from '@/parts/people/balloon';
import { PALETTE } from '@/style/palette';

/** The saucer's size: radius, the hull under and over the rim, the dome, how many lights. The beam's colour. */
export const SAUCER = { r: 1.05, under: 0.15, over: 0.2, dome: 0.34, lights: 12, beam: '#2fd3cf' } as const;

let saucer: MeshData | null = null;
export function saucerMesh(): MeshData {
  if (saucer) return saucer;
  const b = new MeshBuilder({ ink: 'ufo' });
  const { r, under, over, dome } = SAUCER;
  const metal = airborne(PATTERN.metal);
  // The underside: a darker, ribbed bowl (rings of two tones) down to the hatch.
  b.setInk('under').setColor('#8b90a3').setPattern(metal);
  smoothLathe(b, [[r * 0.3, 0.012], [r * 0.55, under * 0.3], [r * 0.82, under * 0.72], [r * 0.985, under * 0.97]], { segments: 20, crease: 0.9 });
  b.setColor('#a8adbe');
  for (const k of [0.46, 0.66]) b.lathe([[r * (k + 0.03), under * (k * 1.15 - 0.2) + 0.004], [r * (k - 0.03), under * (k * 1.15 - 0.26) + 0.004]], { segments: 20 });
  // The rim band: red, self-lit (it glows at night).
  b.setInk('rim').setColor('#e2524a').setPattern(airborne(PATTERN.glow));
  b.lathe([[r * 0.985, under * 0.97], [r * 1.0, under + 0.02], [r * 0.985, under + 0.045]], { segments: 20 });
  // The upper hull: bright silver, from the rim up to the dome's foot.
  b.setInk('hull').setColor('#dfe2ea').setPattern(metal);
  smoothLathe(b, [[r * 0.985, under + 0.045], [r * 0.9, under + over * 0.32], [r * 0.66, under + over * 0.75], [dome * 1.08, under + over]], { segments: 20, crease: 0.9 });
  // The dome's seat: a dark ring round its foot.
  b.setInk('seat').setColor('#5d6275').setPattern(metal);
  b.lathe([[dome * 1.1, under + over - 0.004], [dome * 1.1, under + over + 0.022], [dome * 0.99, under + over + 0.026]], { segments: 18 });
  // The hatch: a turquoise glow underneath.
  b.setInk('hatch').setColor(SAUCER.beam).setPattern(airborne(PATTERN.glow));
  b.lathe([[r * 0.3, 0.012], [r * 0.22, 0.008], [0, 0.006]], { segments: 18 });
  // The antenna: up out of the top of the dome (its tip is a light).
  b.setInk('antenna').setColor('#5d6275').setPattern(metal);
  b.lathe([[0.012, under + over + dome * 0.85], [0.01, under + over + dome + 0.17]], { segments: 6 });
  saucer = b.build();
  return saucer;
}

let domeM: MeshData | null = null;
/** The glass dome: a pale translucent bubble (no ink, see-through), over the pilot. */
export function domeMesh(): MeshData {
  if (domeM) return domeM;
  const b = new MeshBuilder({ ink: 'ufo-dome' });
  const { under, over, dome } = SAUCER;
  b.setInk('dome').setColor('#cfefff').setPattern(MIST);
  smoothLathe(b, [[dome, under + over + 0.02], [dome * 0.93, under + over + dome * 0.45], [dome * 0.62, under + over + dome * 0.82], [0, under + over + dome * 0.93]], { segments: 16, crease: 1.3 });
  domeM = b.build();
  return domeM;
}

let alienM: MeshData | null = null;
/** The pilot: shoulders, a big green head, two big black eyes (facing +Z). Origin at its seat. */
export function alienMesh(): MeshData {
  if (alienM) return alienM;
  const b = new MeshBuilder({ ink: 'ufo-alien' });
  b.setPattern(airborne(PATTERN.none));
  b.setInk('body').setColor('#4fae45');
  smoothBall(b, 0, 0.06, 0, 0.13, 0.09, 0.1, 10, 5);
  b.setInk('head').setColor('#78e05f');
  smoothBall(b, 0, 0.24, 0.01, 0.14, 0.15, 0.13, 12, 7);
  b.setInk('eyes').setColor(PALETTE.ink);
  for (const s of [-1, 1]) smoothBall(b, s * 0.06, 0.25, 0.115, 0.04, 0.055, 0.02, 8, 4);
  alienM = b.build();
  return alienM;
}

const lights: (MeshData | null)[] = [null, null];
/** Half the rim's lights (every other one, from `half`), and in half 0 the antenna's tip: drawn in turn, they chase. */
export function lightsMesh(half: 0 | 1): MeshData {
  const had = lights[half];
  if (had) return had;
  const b = new MeshBuilder({ ink: `ufo-lights-${half}` });
  const { r, under, over, dome, lights: n } = SAUCER;
  // Self-lit (radiant at dusk and night), and in the air.
  b.setPattern(airborne(PATTERN.glow));
  const colours = ['#ffe14d', '#ff5f6d', '#5fe6ff', '#9dff5a'];
  for (let i = half; i < n; i += 2) {
    const a = (i / n) * Math.PI * 2;
    b.setInk(`light${i}`).setColor(colours[i % 4]!);
    smoothBall(b, Math.cos(a) * r * 1.005, under + 0.022, Math.sin(a) * r * 1.005, 0.075, 0.055, 0.075, 8, 4);
  }
  if (half === 0) {
    b.setInk('tip').setColor('#ff5f6d');
    smoothBall(b, 0, under + over + dome + 0.19, 0, 0.04, 0.04, 0.04, 8, 4);
  }
  const m = b.build();
  lights[half] = m;
  return m;
}

/** Quads round an upright band from (r0 at y0) to (r1 at y1), all tractor light, `edge` from e0 to e1. */
function band(b: MeshBuilder, r0: number, y0: number, r1: number, y1: number, e0: number, e1: number, sides: number): void {
  for (let i = 0; i < sides; i++) {
    const a = (i / sides) * Math.PI * 2, c = ((i + 1) / sides) * Math.PI * 2;
    b.quad([Math.cos(a) * r0, y0, Math.sin(a) * r0], [Math.cos(a) * r1, y1, Math.sin(a) * r1], [Math.cos(c) * r1, y1, Math.sin(c) * r1], [Math.cos(c) * r0, y0, Math.sin(c) * r0], { edge: [e0, e1, e1, e0] });
  }
}

/** The beam's radius at the hatch and at the ground. */
export const BEAM = { r0: SAUCER.r * 0.3, r1: SAUCER.r * 0.95 } as const;

let cone: MeshData | null = null;
export function coneMesh(): MeshData {
  if (cone) return cone;
  const b = new MeshBuilder({ ink: 'ufo-cone' });
  b.setColor(SAUCER.beam).setPattern(PATTERN.beam).setInk('cone');
  band(b, BEAM.r0, 0, BEAM.r1, -1, 0, 0.45, 16);
  cone = b.build();
  return cone;
}

let rings: MeshData | null = null;
/** Four bright bands round the cone, a quarter of its length apart (the top one at −0.06). */
export function ringsMesh(): MeshData {
  if (rings) return rings;
  const b = new MeshBuilder({ ink: 'ufo-rings' });
  b.setColor('#a6fff4').setPattern(PATTERN.beam).setInk('rings');
  for (let k = 0; k < 4; k++) {
    const y = -0.06 - k * 0.25;
    const r = BEAM.r0 + (BEAM.r1 - BEAM.r0) * -y;
    band(b, r * 1.02, y + 0.03, r * 1.02, y - 0.03, 0, 0, 14);
  }
  rings = b.build();
  return rings;
}

let pool: MeshData | null = null;
/** The pool of light on the ground (radius 1, bright in the middle) and its spill round about (to radius 1.6, faint: kept small, it is light laid over the page at 3× on a phone). */
export function poolMesh(): MeshData {
  if (pool) return pool;
  const b = new MeshBuilder({ ink: 'ufo-pool' });
  b.setColor(SAUCER.beam).setPattern(PATTERN.beam).setInk('pool');
  const sides = 18;
  for (let i = 0; i < sides; i++) {
    const a = (i / sides) * Math.PI * 2, c = ((i + 1) / sides) * Math.PI * 2;
    // Facing up (counter-clockwise seen from above).
    b.tri([0, 0, 0], [Math.cos(c), 0, Math.sin(c)], [Math.cos(a), 0, Math.sin(a)], { edge: [0, 0.35, 0.35] });
    b.quad([Math.cos(a), 0, Math.sin(a)], [Math.cos(c), 0, Math.sin(c)], [Math.cos(c) * 1.6, 0, Math.sin(c) * 1.6], [Math.cos(a) * 1.6, 0, Math.sin(a) * 1.6], { edge: [0.55, 0.55, 1, 1] });
  }
  pool = b.build();
  return pool;
}

let rim: MeshData | null = null;
/** The pool's rim: a bright flat ring at radius 1 (scaled to pulse). */
export function rimMesh(): MeshData {
  if (rim) return rim;
  const b = new MeshBuilder({ ink: 'ufo-rim' });
  b.setColor('#a6fff4').setPattern(PATTERN.beam).setInk('rim');
  const sides = 20;
  for (let i = 0; i < sides; i++) {
    const a = (i / sides) * Math.PI * 2, c = ((i + 1) / sides) * Math.PI * 2;
    b.quad([Math.cos(a) * 0.9, 0.01, Math.sin(a) * 0.9], [Math.cos(c) * 0.9, 0.01, Math.sin(c) * 0.9], [Math.cos(c) * 1.05, 0.01, Math.sin(c) * 1.05], [Math.cos(a) * 1.05, 0.01, Math.sin(a) * 1.05], { edge: [0, 0, 0, 0] });
  }
  rim = b.build();
  return rim;
}

let motes: MeshData | null = null;
/** Sparkles in the beam: little four-pointed stars up a unit column inside the cone (moved up it, wrapping). */
export function motesMesh(): MeshData {
  if (motes) return motes;
  const b = new MeshBuilder({ ink: 'ufo-motes' });
  b.setColor('#e6fffb').setPattern(airborne(PATTERN.glow));
  for (let i = 0; i < 9; i++) {
    const y = -(i + 0.5) / 9;
    const rr = (BEAM.r0 + (BEAM.r1 - BEAM.r0) * -y) * (0.25 + ((i * 37) % 10) / 16);
    const a = i * 2.39;
    b.setInk(`mote${i}`);
    smoothBall(b, Math.cos(a) * rr, y, Math.sin(a) * rr, 0.022, 0.022, 0.022, 6, 3);
  }
  motes = b.build();
  return motes;
}

let shadow: MeshData | null = null;
/** A ring of shadow on the ground, outer radius 1 (scaled), flat. */
export function ufoShadowMesh(): MeshData {
  if (shadow) return shadow;
  const b = new MeshBuilder({ ink: 'ufo-shadow' });
  b.setPattern(airborne(PATTERN.none)).setInk('shadow').setColor('#aaa5b6');
  b.lathe([[1, 0], [1, 0.004], [0.62, 0.004], [0.62, 0]], { segments: 18 });
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
