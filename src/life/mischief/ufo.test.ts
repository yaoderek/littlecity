// The UFO (design section 13b): it takes exactly one person and brings exactly
// that person back; with nobody out of doors it comes and goes and takes
// nobody; undo, or the town changing, mid-abduction leaves nothing drawn and
// the person on their feet. The app's own wiring, no renderer.

import { describe, expect, test } from 'vitest';
import { buildScenario } from '@/scenario';
import { findScenario } from '@/scenario/discover';
import { generateTerrain, initialWorld } from '@/terrain/terrain';
import { crowdOf } from '@/life/doors/table';
import type { Person } from '@/life/people/crowd';
import { createTurmoil, type Turmoil } from '../../../tests/helpers/turmoil';
import { mischiefDrawn } from './owned';
import { UFO, ufosOf } from './ufo.system';

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

  test('three at most; undo mid-abduction: all gone at once, nothing drawn, the person on their feet', () => {
    const t = grown();
    const crowd = crowdOf(t.stage)!;
    const ufos = ufosOf(t.stage)!;
    expect(ufos.call(30.5, 0.8, 22.5)).toBe(true);
    expect(ufos.call(20.5, 0.8, 20.5)).toBe(true);
    expect(ufos.call(26.5, 0.8, 28.5)).toBe(true);
    expect(ufos.call(24.5, 0.8, 24.5)).toBe(false);
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
});
