// The UFO (design section 13b): it takes exactly one person and brings exactly
// that person back; with nobody out of doors it comes and goes and takes
// nobody; undo, or the town changing, mid-abduction leaves nothing drawn and
// the person on their feet. The app's own wiring, no renderer.

import { describe, expect, test } from 'vitest';
import { key, keyX, keyY, keyZ } from '@/core/grid';
import { buildScenario } from '@/scenario';
import { findScenario } from '@/scenario/discover';
import { generateTerrain, initialWorld } from '@/terrain/terrain';
import { crowdOf } from '@/life/doors/table';
import type { Person } from '@/life/people/crowd';
import { createTurmoil, type Turmoil } from '../../../tests/helpers/turmoil';
import { mischiefDrawn } from './owned';
import { UFO, ufosOf } from './ufo.system';
import { SAUCER } from './ufo-art';
import { throwerOf } from './thrown.system';

function grown(): Turmoil {
  const built = buildScenario(findScenario('grown-town-1')!);
  const t = createTurmoil({ world: built.world, terrain: built.terrain });
  t.run(20);
  return t;
}

const ids = (t: Turmoil): string[] => crowdOf(t.stage)!.people.filter((p) => !p.id.startsWith('ashore:')).map((p) => p.id).sort();

describe('the UFO', () => {
  test('takes exactly one person away and brings exactly that person back, on their feet and on the walking graph', () => {
    const t = grown();
    const crowd = crowdOf(t.stage)!;
    const before = ids(t);
    const ufos = ufosOf(t.stage)!;
    expect(ufos.call(30.5, 0.8, 22.5)).toBe(true);
    let taken: Person | null = null;
    const seen = new Set<string>();
    let gone = false;
    for (let i = 0; i < 1200 && ufos.saucers.length + (taken ? 0 : 1) > 0; i++) {
      t.run(0.1);
      const s = ufos.saucers[0];
      if (s?.person) taken ??= s.person;
      if (s) seen.add(s.phase);
      if (s?.phase === 'gone') {
        gone = true;
        // Away with them: out of sight, nobody else taken, nobody lost or made twice.
        expect(taken!.visible).toBe(false);
        expect(ids(t)).toEqual(before.filter((id) => crowd.people.some((p) => p.id === id)));
        expect(crowd.people.filter((p) => p.mode === 'thrown' && !p.visible).length).toBe(1);
      }
    }
    expect(taken).not.toBeNull();
    expect(gone).toBe(true);
    for (const ph of ['in', 'beam', 'lift', 'away', 'gone', 'back', 'drop', 'leave']) expect(seen.has(ph), ph).toBe(true);
    expect(ufos.saucers.length).toBe(0);
    // Back down and up again within a bounded time.
    for (let i = 0; i < 300 && taken!.mode === 'thrown'; i++) t.run(0.1);
    expect(taken!.mode).not.toBe('thrown');
    expect(taken!.visible).toBe(true);
    expect(taken!.tumble ?? null).toBeNull();
    expect(crowd.nav!.nodes[taken!.node]).toBeDefined();
    // Nobody lost or made twice (bar anybody whose home went: there was no blast).
    const after = ids(t);
    expect(new Set(after).size).toBe(after.length);
    for (const id of before) expect(after).toContain(id);
    expect(mischiefDrawn(t.stage)).toBe(0);
  }, 180_000);

  test('with nobody about it comes, searches with its beam, and goes, taking nobody', () => {
    const terrain = generateTerrain(7);
    const t = createTurmoil({ world: initialWorld(7, terrain), terrain });
    t.run(2);
    expect(crowdOf(t.stage)?.people.filter((p) => p.visible).length ?? 0).toBe(0);
    const ufos = ufosOf(t.stage)!;
    expect(ufos.call(24.5, 1, 24.5)).toBe(true);
    const seen = new Set<string>();
    for (let i = 0; i < 200 && (i === 0 || ufos.saucers.length > 0); i++) {
      t.run(0.1);
      const s = ufos.saucers[0];
      if (s) {
        seen.add(s.phase);
        expect(s.person).toBeNull();
      }
    }
    expect(seen.has('seek')).toBe(true);
    expect(seen.has('lift')).toBe(false);
    expect(ufos.saucers.length).toBe(0);
    expect(mischiefDrawn(t.stage)).toBe(0);
  }, 120_000);

  test('as many as are called (no limit); undo mid-abduction: all gone at once, nothing drawn, the person on their feet', () => {
    const t = grown();
    const crowd = crowdOf(t.stage)!;
    const ufos = ufosOf(t.stage)!;
    expect(ufos.call(30.5, 0.8, 22.5)).toBe(true);
    expect(ufos.call(20.5, 0.8, 20.5)).toBe(true);
    expect(ufos.call(26.5, 0.8, 28.5)).toBe(true);
    expect(ufos.call(24.5, 0.8, 24.5)).toBe(true);
    t.run(0.1);
    expect(ufos.saucers.length).toBe(4);
    for (let i = 0; i < 100 && !ufos.saucers.some((s) => s.phase === 'lift'); i++) t.run(0.1);
    const taken = ufos.saucers.find((s) => s.phase === 'lift')!.person!;
    expect(taken.mode).toBe('thrown');
    t.mischief.cancel();
    t.run(0.1);
    expect(ufos.saucers.length).toBe(0);
    expect(mischiefDrawn(t.stage)).toBe(0);
    expect(taken.mode).not.toBe('thrown');
    expect(taken.visible).toBe(true);
    expect(crowd.people.filter((p) => p.mode === 'thrown').length).toBe(0);
    void UFO;
  }, 120_000);

  test('the town changing mid-abduction (a house built, the dressing again): it carries on and brings the same person back', () => {
    const t = grown();
    const crowd = crowdOf(t.stage)!;
    const ufos = ufosOf(t.stage)!;
    const before = ids(t);
    expect(ufos.call(30.5, 0.8, 22.5)).toBe(true);
    for (let i = 0; i < 100 && !ufos.saucers.some((s) => s.phase === 'lift'); i++) t.run(0.1);
    const taken = ufos.saucers[0]!.person!;
    // A house built elsewhere in the middle of it.
    const shape = t.game.shape;
    const free = [...shape.terrain.height.keys()].find((i) => shape.terrain.height[i]! > 0 && !shape.kinds.has(key(i % 48, shape.terrain.height[i]!, Math.floor(i / 48))) && (i % 48) > 4 && (i % 48) < 12)!;
    const x = free % 48, z = Math.floor(free / 48);
    t.game.edit({ type: 'placeBlock', cell: key(x, shape.terrain.height[free]!, z), kind: 'house', color: 'auto', from: null });
    for (let i = 0; i < 1200 && ufos.saucers.length > 0; i++) t.run(0.1);
    for (let i = 0; i < 300 && taken.mode === 'thrown'; i++) t.run(0.1);
    expect(taken.mode).not.toBe('thrown');
    expect(taken.visible).toBe(true);
    expect(mischiefDrawn(t.stage)).toBe(0);
    const after = ids(t);
    expect(new Set(after).size).toBe(after.length);
    for (const id of before) expect(after).toContain(id);
    void crowd;
  }, 180_000);

  test('it goes where it was clicked: with nobody within reach of the click it takes nobody, however many are out elsewhere', () => {
    const t = grown();
    const crowd = crowdOf(t.stage)!;
    const ufos = ufosOf(t.stage)!;
    const out = crowd.people.filter((p) => p.visible && p.mode !== 'home' && p.mode !== 'visit');
    expect(out.length).toBeGreaterThan(5);
    // A spot on the island well away from everybody out now.
    const h = t.game.shape.terrain.height;
    let spot: [number, number] | null = null;
    for (let z = 3; z < 45 && !spot; z++) for (let x = 3; x < 45 && !spot; x++) {
      if (h[x + z * 48]! === 0) continue;
      if (crowd.people.every((p) => Math.hypot(p.x - x - 0.5, p.z - z - 0.5) > UFO.near + 4)) spot = [x + 0.5, z + 0.5];
    }
    expect(spot).not.toBeNull();
    expect(ufos.call(spot![0], 1, spot![1])).toBe(true);
    t.run(0.1);
    const seen = new Set<string>();
    for (let i = 0; i < 200 && ufos.saucers.length > 0; i++) {
      t.run(0.1);
      const s = ufos.saucers[0];
      if (!s) break;
      seen.add(s.phase);
      // It never leaves the spot to look elsewhere.
      if (s.phase === 'seek' || s.phase === 'beam') expect(Math.hypot(s.x - spot![0], s.z - spot![1])).toBeLessThan(0.5);
      expect(s.person).toBeNull();
    }
    expect(seen.has('seek')).toBe(true);
    expect(seen.has('lift')).toBe(false);
  }, 120_000);

  test('it never passes through anything: its disc stays clear of buildings, towers and trees all the way, coming in beside the tallest', () => {
    const t = grown();
    const ufos = ufosOf(t.stage)!;
    const shape = t.game.shape;
    // The tallest buildings' cells (towers, the lighthouse), and the trees.
    const tall = [...shape.kinds].filter(([, k]) => k !== 'tree').sort((a, b) => keyY(b[0]) - keyY(a[0])).slice(0, 3).map(([c]) => c);
    const trees = [...shape.kinds].filter(([, k]) => k === 'tree').map(([c]) => c);
    const inTree = (x: number, y: number, z: number): boolean => trees.some((c) => Math.abs(keyX(c) + 0.5 - x) < 0.5 && Math.abs(keyZ(c) + 0.5 - z) < 0.5 && y >= keyY(c) * 0.8 && y < keyY(c) * 0.8 + 1.9);
    const problems: string[] = [];
    for (const c of tall) {
      expect(ufos.call(keyX(c) + 1.5, 1, keyZ(c) + 0.5)).toBe(true);
      for (let i = 0; i < 900 && ufos.saucers.length > 0; i++) {
        t.run(1 / 30);
        const g = throwerOf(t.stage)!.ground!;
        for (const s of ufos.saucers) {
          if (s.phase === 'gone' || s.phase === 'done') continue;
          // Round its rim and across its middle, its underside and its top.
          for (let k = 0; k <= 8; k++) {
            const a = (k / 8) * Math.PI * 2, r = k === 8 ? 0 : SAUCER.r;
            const x = s.x + Math.cos(a) * r, z = s.z + Math.sin(a) * r;
            for (const y of [s.y + 0.01, s.y + SAUCER.under + SAUCER.over]) {
              if (g.blocked(x, y, z) || inTree(x, y, z)) problems.push(`saucer ${s.n} (${s.phase}) at ${x.toFixed(1)}, ${y.toFixed(2)}, ${z.toFixed(1)}`);
            }
          }
        }
      }
    }
    expect(problems.slice(0, 5)).toEqual([]);
  }, 300_000);

  test('twenty called in quick succession, many over one spot: each takes its own catch (nobody twice), they never pass through each other, and all gone they leave nothing behind', () => {
    const t = grown();
    const ufos = ufosOf(t.stage)!;
    const crowd = crowdOf(t.stage)!;
    const before = ids(t);
    // Twenty taps in two seconds, round the busiest spot.
    const p0 = crowd.people.find((q) => q.visible && (q.mode === 'walk' || q.mode === 'linger'))!;
    for (let i = 0; i < 20; i++) {
      expect(ufos.call(p0.x + ((i * 7) % 5) - 2, p0.y, p0.z + ((i * 3) % 5) - 2)).toBe(true);
      t.run(0.1);
    }
    expect(ufos.saucers.length).toBe(20);
    const problems: string[] = [];
    for (let i = 0; i < 4000 && ufos.saucers.length > 0; i++) {
      t.run(0.1);
      // Never more handles out than the saucers about (twelve each), and nobody in two beams.
      expect(ufos.live).toBe(ufos.saucers.length * 12);
      const held = ufos.saucers.map((s) => s.person).filter((p) => p);
      expect(new Set(held).size).toBe(held.length);
      // No two discs overlapping (centres closer than a diameter across and nearer than a hull's height up and down).
      const shown = ufos.saucers.filter((s) => s.phase !== 'gone' && s.phase !== 'done');
      for (let a = 0; a < shown.length; a++) for (let b = a + 1; b < shown.length; b++) {
        const A = shown[a]!, B = shown[b]!;
        if (Math.hypot(A.x - B.x, A.z - B.z) < SAUCER.r * 2 && Math.abs(A.y - B.y) < SAUCER.under + SAUCER.over) problems.push(`${A.n} (${A.phase} lane ${A.lane} t ${A.t.toFixed(2)} to ${A.to.y.toFixed(1)}) and ${B.n} (${B.phase} lane ${B.lane} t ${B.t.toFixed(2)} to ${B.to.y.toFixed(1)}) at ${A.x.toFixed(1)}, ${A.y.toFixed(1)}, ${A.z.toFixed(1)}`);
      }
    }
    expect(problems.slice(0, 5)).toEqual([]);
    expect(ufos.saucers.length).toBe(0);
    expect(ufos.live).toBe(0);
    // (The last ones set down are still dizzy, with stars: drawn by the thrown bodies' system until they get up.)
    for (let i = 0; i < 400 && crowd.people.some((p) => p.mode === 'thrown'); i++) t.run(0.1);
    t.run(1);
    expect(mischiefDrawn(t.stage)).toBe(0);
    expect(crowd.people.filter((p) => p.mode === 'thrown').length).toBe(0);
    const after = ids(t);
    for (const id of before) expect(after).toContain(id);
  }, 300_000);
});
