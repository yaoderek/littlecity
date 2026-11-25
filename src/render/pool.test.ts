import { describe, expect, test } from 'vitest';
import { identity, translation } from '@/core/mat4';
import { EDGE_FAR, MeshBuilder, PATTERN } from '@/gen/mesh';
import { AIRBORNE, MIST } from '@/gen/airborne';
import { EDGE_SCALE, hazy, VertexPool } from './pool';
import { DEFAULT_PARAMS, SLOT_COLS, SlotTable } from './slots';

const box = (x: number, color = '#ff8040', ink = 'a') => new MeshBuilder({ ink }).setColor(color).setPattern(PATTERN.brick).box([x, 0, 0], [x + 1, 1, 1]).build();
const VERTS = 36;

describe('VertexPool', () => {
  test('packs position, normal + sway, colour + pattern, ink id + edge, and the slot', () => {
    const pool = new VertexPool();
    const mesh = new MeshBuilder({ ink: 7 }).setColor([10, 20, 30]).setPattern(PATTERN.marble).setSway(0.5).setEdge(0.25).quad([0, 0, 1], [1, 0, 1], [1, 0, 0], [0, 0, 0]).build();
    const e = pool.put('q', 1, mesh, 5);
    expect(e).toMatchObject({ offset: 0, count: 6, slot: 5, beams: false, solid: true });
    expect([...pool.position.subarray(0, 3)]).toEqual([0, 0, 1]);
    expect([...pool.normal.subarray(0, 4)]).toEqual([0, 127, 0, 64]); // up, sway 0.5
    expect([...pool.color.subarray(0, 4)]).toEqual([10, 20, 30, PATTERN.marble]);
    expect(pool.ink[0]).toBe(mesh.inkId[0]);
    expect(pool.ink[1]).toBe(0.25 * EDGE_SCALE);
    expect([...pool.slot.subarray(0, 6)]).toEqual([5, 5, 5, 5, 5, 5]);
    // EDGE_FAR survives the trip; huge distances clamp instead of wrapping.
    pool.put('far', 1, new MeshBuilder().setEdge(EDGE_FAR).tri([0, 0, 0], [0, 0, 1], [1, 0, 0]).build());
    expect(pool.ink[6 * 2 + 1]).toBe(EDGE_FAR * EDGE_SCALE);
    pool.put('huge', 1, new MeshBuilder().setEdge(1e6).tri([0, 0, 0], [0, 0, 1], [1, 0, 0]).build());
    expect(pool.ink[9 * 2 + 1]).toBe(65535);
  });

  test('an edit costs what changed: replacing one entry touches only its old and new spans', () => {
    const pool = new VertexPool();
    for (let i = 0; i < 20; i++) pool.put(`s${i}`, i, box(i));
    pool.takeDirty();
    const generation = pool.generation;
    pool.put('s3', 99, box(50));
    const { data } = pool.takeDirty();
    const touched = data.reduce((n, [a, b]) => n + (b - a), 0);
    expect(touched).toBe(VERTS * 2);
    expect(pool.generation).toBe(generation);
    // The old span is collapsed to nothing, the new one sits at the end.
    expect(pool.position.subarray(3 * VERTS * 3, 4 * VERTS * 3).every((v) => v === 0)).toBe(true);
    expect(pool.entries.get('s3')).toMatchObject({ offset: 20 * VERTS, hash: 99 });
    expect(pool.garbage).toBe(VERTS);
    expect(pool.count).toBe(21 * VERTS);
  });

  test('replacing keeps the slot (a lifted structure stays lifted when it changes)', () => {
    const pool = new VertexPool();
    pool.put('a', 1, box(0), 9);
    const e = pool.put('a', 2, box(0, '#00ff00'));
    expect(e.slot).toBe(9);
    expect(pool.slot[e.offset]).toBe(9);
  });

  test('setSlot re-points an entry and reports only the slot span', () => {
    const pool = new VertexPool();
    pool.put('a', 1, box(0));
    const e = pool.put('b', 1, box(2));
    pool.takeDirty();
    pool.setSlot(e, 4);
    const d = pool.takeDirty();
    expect(d.data).toEqual([]);
    expect(d.slots).toEqual([[VERTS, VERTS * 2]]);
    expect(pool.slot[VERTS]).toBe(4);
    expect(pool.slot[0]).toBe(0);
  });

  test('compaction squeezes retired spans out and keeps every live entry intact', () => {
    const pool = new VertexPool();
    for (let i = 0; i < 10; i++) pool.put(`s${i}`, i, box(i * 2), i);
    for (const i of [0, 3, 4, 8]) pool.remove(`s${i}`);
    expect(pool.garbage).toBe(4 * VERTS);
    pool.compact();
    expect(pool.garbage).toBe(0);
    expect(pool.count).toBe(6 * VERTS);
    const order = [...pool.entries.values()].sort((a, b) => a.offset - b.offset);
    expect(order.map((e) => e.key)).toEqual(['s1', 's2', 's5', 's6', 's7', 's9']);
    for (const e of order) {
      const i = Number(e.key.slice(1));
      expect(pool.position[e.offset * 3]).toBe(i * 2); // its own first vertex
      expect(pool.slot[e.offset]).toBe(i);
      expect(pool.slot[e.offset + e.count - 1]).toBe(i);
    }
    expect(pool.takeDirty().data).toEqual([[0, 6 * VERTS]]);
  });

  test('growing replaces the arrays (a new generation) and keeps the data; churn does not grow for ever', () => {
    const pool = new VertexPool();
    pool.put('a', 1, box(3));
    const first = pool.generation;
    for (let i = 0; i < 200; i++) pool.put(`s${i}`, i, box(i));
    expect(pool.generation).toBeGreaterThan(first);
    expect(pool.position[0]).toBe(3);
    const capacity = pool.capacity;
    // The same 200 entries replaced 50 times over: retired spans are reclaimed, capacity stays put.
    for (let round = 0; round < 50; round++) for (let i = 0; i < 200; i++) pool.put(`s${i}`, round * 1000 + i, box(i));
    expect(pool.capacity).toBeLessThanOrEqual(capacity * 2);
    expect(pool.entries.size).toBe(201);
    expect(pool.count - pool.garbage).toBe(201 * VERTS);
  });

  test('entries with light beams are counted, so the overlay pass knows to draw this pool', () => {
    const pool = new VertexPool();
    const beam = new MeshBuilder().setPattern(PATTERN.beam).tri([0, 0, 0], [0, 0, 1], [1, 0, 0]).build();
    expect(pool.put('beam', 1, beam).beams).toBe(true);
    expect(pool.beamEntries).toBe(1);
    // Nothing but beams: the page's own pass has nothing to draw here.
    expect(pool.solidEntries).toBe(0);
    pool.put('beam', 2, box(0));
    expect(pool.beamEntries).toBe(0);
    expect(pool.solidEntries).toBe(1);
    pool.put('beam', 3, beam);
    pool.remove('beam');
    expect(pool.beamEntries).toBe(0);
    expect(pool.solidEntries).toBe(0);
  });

  test('a mesh that is smoke or a beam anywhere is hazy, in the air or not', () => {
    const of = (pattern: number): boolean => hazy(new MeshBuilder().tri([0, 0, 0], [0, 0, 1], [1, 0, 0]).setPattern(pattern).tri([0, 0, 0], [0, 0, 1], [1, 0, 0]).build());
    for (const p of [PATTERN.beam, MIST, PATTERN.beam | AIRBORNE, MIST | AIRBORNE]) expect(of(p)).toBe(true);
    for (const p of [PATTERN.none, PATTERN.glow, PATTERN.planks, AIRBORNE]) expect(of(p)).toBe(false);
  });

  test('bounds cover everything put', () => {
    const pool = new VertexPool();
    pool.put('a', 1, box(0));
    pool.put('b', 1, box(9));
    expect(pool.min).toEqual([0, 0, 0]);
    expect(pool.max).toEqual([10, 1, 1]);
  });
});

describe('SlotTable', () => {
  test('slot 0 is the identity with default params and is never handed out', () => {
    const t = new SlotTable();
    expect([...t.data.subarray(0, 16)]).toEqual([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, ...DEFAULT_PARAMS]);
    expect(t.alloc()).toBe(1);
    expect(t.alloc()).toBe(2);
  });

  test('a matrix is stored as three rows; hiding collapses it and showing restores it', () => {
    const t = new SlotTable();
    const s = t.alloc();
    t.setMatrix(s, translation(4, 5, 6));
    const row = (i: number): number[] => [...t.data.subarray(s * 16 + i * 4, s * 16 + i * 4 + 4)];
    expect(row(0)).toEqual([1, 0, 0, 4]);
    expect(row(1)).toEqual([0, 1, 0, 5]);
    expect(row(2)).toEqual([0, 0, 1, 6]);
    t.setVisible(s, false);
    expect(row(0)).toEqual([0, 0, 0, 0]);
    t.setMatrix(s, translation(7, 8, 9)); // moved while hidden
    expect(row(0)).toEqual([0, 0, 0, 0]);
    t.setVisible(s, true);
    expect(row(0)).toEqual([1, 0, 0, 7]);
  });

  test('params default to glow 1; a freed slot comes back clean', () => {
    const t = new SlotTable();
    const s = t.alloc();
    expect([...t.data.subarray(s * 16 + 12, s * 16 + 16)]).toEqual([1, 0, 0, 0]);
    t.setParams(s, 0.5, 2, 3, 4);
    t.setMatrix(s, translation(1, 1, 1));
    t.release(s);
    expect(t.alloc()).toBe(s);
    expect([...t.data.subarray(s * 16, s * 16 + 16)]).toEqual([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 1, 0, 0, 0]);
    expect(t.used).toBe(1);
  });

  test('it grows without losing anything, and says so', () => {
    const t = new SlotTable();
    const generation = t.generation;
    const first = t.alloc();
    t.setMatrix(first, translation(3, 2, 1));
    const n = SLOT_COLS * 4 + 10;
    for (let i = 0; i < n; i++) t.alloc();
    expect(t.generation).toBeGreaterThan(generation);
    expect(t.capacity).toBeGreaterThan(n);
    expect([...t.data.subarray(first * 16, first * 16 + 4)]).toEqual([1, 0, 0, 3]);
    expect(t.data.length).toBe(t.rows * SLOT_COLS * 16);
    t.setMatrix(first, identity());
    expect(t.dirty).toBe(true);
  });
});
