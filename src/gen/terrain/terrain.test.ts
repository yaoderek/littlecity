import { describe, expect, test } from 'vitest';
import { allChunks, CELL_H, chunkOf, columnIndex, key, SEA_Y, SIZE_X, SIZE_Z, type CellKey } from '@/core/grid';
import { rand } from '@/core/rand';
import { resetStyles, setStyle } from '@/core/style';
import { MAT, type Block } from '@/core/world';
import { resolveShape } from '@/resolve/index';
import type { ShapePlan } from '@/resolve/plan';
import { TerrainBuilder, TownBuilder } from '@/scenario';
import { emptyWorld } from '@/world/world';
import { inkGroups, validateMesh } from '../checks';
import { EDGE_FAR, PATTERN, triangleCount, type MeshData } from '../mesh';
import { terraceGrass } from '@/style/terrain';
import { generateTerrain } from '@/terrain/terrain';
import { buildTerrainChunk, terrainChunkMesh, terrainLayer } from './terrain.gen';
import { FULL } from '../../../tests/helpers/tier';

/** A hand-made island with everything the mesh must handle: beach, steps, a 2-level cliff, a cove, a peak. */
function island(build?: (b: TownBuilder) => void): ShapePlan {
  const t = new TerrainBuilder(11);
  t.rect(10, 10, 37, 37, 1);
  t.rect(14, 14, 30, 30, 2);
  t.rect(18, 18, 24, 24, 4); // a two-level cliff all round
  t.disc(21, 21, 1.5, 5);
  t.disc(37, 24, 3.2, 0); // a cove
  t.set(12, 20, 0); // a pond one cell wide
  const terrain = t.build();
  const b = new TownBuilder(emptyWorld(11), terrain);
  build?.(b);
  return resolveShape(b.world, terrain, { rules: [] });
}

const meshOf = (plan: ShapePlan, x: number, z: number): MeshData => terrainLayer.build(chunkOf(x, z), plan, null as never).mesh;

function tris(mesh: MeshData, keep: (pattern: number, ny: number) => boolean): number[][] {
  const out: number[][] = [];
  for (let v = 0; v < mesh.pattern.length; v += 3) {
    if (!keep(mesh.pattern[v]!, mesh.normal[v * 3 + 1]!)) continue;
    out.push([...mesh.position.subarray(v * 3, v * 3 + 9)]);
  }
  return out;
}

describe('the terrain layer', () => {
  const plan = island();

  test('every chunk is a sound mesh inside its triangle budget', () => {
    let total = 0;
    for (const chunk of allChunks()) {
      const mesh = terrainLayer.build(chunk, plan, null as never).mesh;
      expect(validateMesh(mesh)).toEqual([]);
      expect(triangleCount(mesh)).toBeLessThan(26_000);
      total += triangleCount(mesh);
    }
    expect(total).toBeGreaterThan(20_000);
    expect(total).toBeLessThan(140_000);
  });

  test('tops face up and sit exactly on their level, so pieces stand flush on them', () => {
    const mesh = meshOf(plan, 20, 20);
    const tops = tris(mesh, (p, ny) => (p === PATTERN.grass || p === PATTERN.rock) && ny > 0.99);
    expect(tops.length).toBeGreaterThan(500);
    for (const t of tops) {
      const level = t[1]! / CELL_H;
      expect(Math.abs(level - Math.round(level))).toBeLessThan(1e-6);
      expect(t[4]).toBe(t[1]);
      expect(t[7]).toBe(t[1]);
    }
  });

  test('a lawn that crosses a chunk border is one surface: the same ink id on both sides', () => {
    const a = meshOf(plan, 15, 20), b = meshOf(plan, 16, 20); // columns 15 and 16 are in different chunks
    const level2 = (mesh: MeshData): Set<number> => {
      const ids = new Set<number>();
      for (let v = 0; v < mesh.pattern.length; v++) {
        if (mesh.pattern[v] === PATTERN.grass && Math.abs(mesh.position[v * 3 + 1]! - 2 * CELL_H) < 1e-6) ids.add(mesh.inkId[v]!);
      }
      return ids;
    };
    expect(level2(a).size).toBe(1);
    expect(level2(a)).toEqual(level2(b));
    // Earth banks, rock, turf, sea, the slab: a handful of surfaces, not one per cell.
    expect(inkGroups(a).size).toBeLessThan(16);
  });

  test('outlines are rounded: a terrace corner is cut back from the grid corner', () => {
    // The north-west corner of the level-1 terrace is the grid vertex (10, 10).
    const mesh = meshOf(plan, 10, 10);
    let nearest = Infinity;
    for (let v = 0; v < mesh.pattern.length; v++) {
      if (mesh.pattern[v] !== PATTERN.grass || Math.abs(mesh.position[v * 3 + 1]! - CELL_H) > 1e-6) continue;
      nearest = Math.min(nearest, Math.hypot(mesh.position[v * 3]! - 10, mesh.position[v * 3 + 2]! - 10));
    }
    expect(nearest).toBeGreaterThan(0.05); // a square corner would have a vertex at distance 0
    expect(nearest).toBeLessThan(0.32);
  });

  test('each terrace above the first is a step lighter, and terraceGrass says which green', () => {
    const colorAt = (mesh: MeshData, level: number): number[] => {
      for (let v = 0; v < mesh.pattern.length; v++) {
        if (mesh.pattern[v] === PATTERN.grass && Math.abs(mesh.position[v * 3 + 1]! - level * CELL_H) < 1e-6) return [...mesh.color.subarray(v * 3, v * 3 + 3)];
      }
      return [];
    };
    const mesh = meshOf(plan, 20, 20);
    expect(colorAt(mesh, 2)).toEqual(terraceGrass(2));
    expect(colorAt(mesh, 4)).toEqual(terraceGrass(4));
    const sum = (c: number[]): number => c[0]! + c[1]! + c[2]!;
    expect(sum(terraceGrass(2))).toBeGreaterThan(sum(terraceGrass(1)));
    expect(sum(terraceGrass(4))).toBeGreaterThan(sum(terraceGrass(2)));
    expect(terraceGrass(1)).toEqual([0xb9, 0xdc, 0x94]); // the lowest land is the palette's grass
  });

  test('a drop of two or more is rock; one level is an earth bank with a grass lip; sand meets the sea as a beach', () => {
    // Banks are one surface whose `edge` says how rocky each point is: 1 on the cliff, 0 on a one-level bank.
    const rockiness = (mesh: MeshData, near: (x: number, y: number, z: number) => boolean): number[] => {
      const out: number[] = [];
      for (let v = 0; v < mesh.pattern.length; v++) {
        if (mesh.pattern[v] !== PATTERN.rock || Math.abs(mesh.normal[v * 3 + 1]!) > 0.5) continue;
        if (near(mesh.position[v * 3]!, mesh.position[v * 3 + 1]!, mesh.position[v * 3 + 2]!)) out.push(mesh.edge[v]!);
      }
      return out;
    };
    const mid = meshOf(plan, 20, 20);
    // The west face of the bluff (x = 18, a drop from 4 to 2), away from its corners.
    const cliff = rockiness(mid, (x, _y, z) => x < 18.3 && x > 17.6 && z > 20 && z < 23);
    expect(cliff.length).toBeGreaterThan(10);
    expect(Math.min(...cliff)).toBe(1);
    // The west bank of the level-2 lawn (x = 14, one level): earth.
    const bank = rockiness(meshOf(plan, 14, 20), (x, _y, z) => x < 14.3 && x > 13.6 && z > 20 && z < 23);
    expect(bank.length).toBeGreaterThan(10);
    expect(Math.max(...bank)).toBe(0);
    // The beach slopes: its foot stands out from the terrace edge, below the waterline.
    const shore = meshOf(plan, 10, 20);
    let lowest = Infinity, westmost = Infinity;
    for (let v = 0; v < shore.pattern.length; v++) {
      if (shore.pattern[v] !== PATTERN.sand) continue;
      lowest = Math.min(lowest, shore.position[v * 3 + 1]!);
      westmost = Math.min(westmost, shore.position[v * 3]!);
    }
    expect(lowest).toBeLessThan(SEA_Y);
    expect(westmost).toBeLessThan(9.85);
    expect(plan.terrain.material[10 + 20 * SIZE_X]).toBe(MAT.sand);
  });

  test('earth and rock are one inked surface that blends over a cell, so they interleave instead of meeting on a line', () => {
    // A lawn at 2 against ground at 1, with a notch two deeper halfway along: bank, cliff, bank.
    const t = new TerrainBuilder(5);
    t.rect(10, 10, 37, 37, 3);
    t.rect(10, 10, 37, 20, 2);
    t.rect(22, 16, 24, 20, 1);
    const terrain = t.build();
    const notch = resolveShape(emptyWorld(5), terrain, { rules: [] });
    const mesh = meshOf(notch, 20, 20);
    const inks = new Set<number>(), values = new Set<number>();
    for (let v = 0; v < mesh.pattern.length; v++) {
      if (mesh.pattern[v] !== PATTERN.rock || Math.abs(mesh.normal[v * 3 + 1]!) > 0.5) continue;
      const x = mesh.position[v * 3]!, z = mesh.position[v * 3 + 2]!;
      if (z < 20.6 || z > 21.4 || x < 17 || x > 29) continue; // the south face of the step, z = 21
      inks.add(mesh.inkId[v]!);
      values.add(Math.round(mesh.edge[v]! * 100) / 100);
    }
    expect(inks.size).toBe(1); // no ink seam between the earth stretch and the rock stretch
    expect(values.has(0)).toBe(true);
    expect(values.has(1)).toBe(true);
    expect([...values].some((e) => e > 0.2 && e < 0.8)).toBe(true); // and a half-way point where they meet
  });

  test('a tall rock face carries ledges with a grass top, but not where something is built against its foot', () => {
    const ledges = (p: ShapePlan): number => {
      // Grass at the height of level 3, standing out past the bluff's west face (x = 18): a ledge top.
      const mesh = meshOf(p, 20, 20);
      let n = 0;
      for (let v = 0; v < mesh.pattern.length; v += 3) {
        if (mesh.pattern[v] !== PATTERN.grass || Math.abs(mesh.position[v * 3 + 1]! - 3 * CELL_H) > 1e-6) continue;
        const xs = [mesh.position[v * 3]!, mesh.position[v * 3 + 3]!, mesh.position[v * 3 + 6]!];
        const zs = [mesh.position[v * 3 + 2]!, mesh.position[v * 3 + 5]!, mesh.position[v * 3 + 8]!];
        if (Math.min(...xs) < 17.95 && Math.max(...xs) < 18.3 && Math.min(...zs) > 18.4 && Math.max(...zs) < 24.6) n++;
      }
      return n;
    };
    // Whether a given face has a ledge is seeded; over several seeds some do, and none juts further than the style says.
    let withLedge = 0;
    for (let seed = 1; seed <= 8; seed++) {
      const t = new TerrainBuilder(seed);
      t.rect(10, 10, 37, 37, 2);
      t.rect(18, 18, 24, 24, 4);
      const terrain = t.build();
      const open = resolveShape(emptyWorld(seed), terrain, { rules: [] });
      if (ledges(open) === 0) continue;
      withLedge++;
      const b = new TownBuilder(emptyWorld(seed), terrain);
      for (let z = 18; z <= 24; z++) b.house(17, z);
      expect(ledges(resolveShape(b.world, terrain, { rules: [] })), `seed ${seed}`).toBe(0);
    }
    expect(withLedge).toBeGreaterThan(0);
  });

  test('the sea carries the distance to the shore: 0 at the waterline, far on open water', () => {
    const mesh = meshOf(plan, 5, 20);
    let nearShore = Infinity, open = 0;
    for (let v = 0; v < mesh.pattern.length; v++) {
      if (mesh.pattern[v] !== PATTERN.water) continue;
      expect(mesh.position[v * 3 + 1]).toBeCloseTo(SEA_Y, 6);
      const x = mesh.position[v * 3]!;
      if (x > 9.4 && x < 9.6) nearShore = Math.min(nearShore, mesh.edge[v]!);
      if (x < 4) open = Math.max(open, mesh.edge[v]!);
    }
    expect(nearShore).toBeLessThan(0.4);
    expect(open).toBeGreaterThan(3);
    expect(open).toBeLessThan(EDGE_FAR);
  });

  test('the sea sheet stays inside the slab: its corners are rounded off', () => {
    const mesh = meshOf(plan, 0, 0);
    let nearest = Infinity;
    for (let v = 0; v < mesh.pattern.length; v++) {
      if (mesh.pattern[v] === PATTERN.water) nearest = Math.min(nearest, Math.hypot(mesh.position[v * 3]!, mesh.position[v * 3 + 2]!));
    }
    expect(nearest).toBeGreaterThan(1);
    // And the slab has sides here: sea, then earth below it.
    let lowest = Infinity;
    for (let v = 0; v < mesh.pattern.length; v++) lowest = Math.min(lowest, mesh.position[v * 3 + 1]!);
    expect(lowest).toBeLessThan(-0.5);
  });

  test('the hash changes exactly when the chunk would: flat ground ignores what is built on it, a step does not', () => {
    const chunk = chunkOf(20, 20);
    const base = terrainLayer.hash(chunk, plan);
    expect(terrainLayer.hash(chunk, island())).toBe(base);
    // A house in the middle of the level-2 lawn: nothing about the ground changes.
    const lawn = island((b) => b.house(26, 27));
    expect(terrainLayer.hash(chunk, lawn)).toBe(base);
    expect(terrainLayer.build(chunk, lawn, null as never).mesh.position).toEqual(terrainLayer.build(chunk, plan, null as never).mesh.position);
    // A house on the corner cell of the level-4 bluff: its rounded corner is squared off under it.
    const corner = island((b) => b.house(18, 18));
    expect(terrainLayer.hash(chunk, corner)).not.toBe(base);
    const cut = (p: ShapePlan): number => {
      const mesh = terrainLayer.build(chunk, p, null as never).mesh;
      let nearest = Infinity;
      for (let v = 0; v < mesh.pattern.length; v++) {
        if (Math.abs(mesh.position[v * 3 + 1]! - 4 * CELL_H) > 1e-6 || mesh.normal[v * 3 + 1]! < 0.99) continue;
        nearest = Math.min(nearest, Math.hypot(mesh.position[v * 3]! - 18, mesh.position[v * 3 + 2]! - 18));
      }
      return nearest;
    };
    expect(cut(corner)).toBeLessThan(cut(plan) - 0.05);
    // Another chunk is not disturbed by any of it.
    const other = chunkOf(40, 40);
    expect(terrainLayer.hash(other, corner)).toBe(terrainLayer.hash(other, plan));
  });

  // Wall-clock budget: only in the full run (LC_FULL=1), where nothing else shares the machine's time with it;
  // in the gate a busy machine failed it with nothing wrong (docs/swarm/test-diet.md).
  test.runIf(FULL)('building a chunk is quick enough to do on an edit', () => {
    const chunk = chunkOf(20, 20);
    buildTerrainChunk(chunk, plan);
    const t0 = performance.now();
    for (let i = 0; i < 5; i++) buildTerrainChunk(chunk, plan).build();
    expect((performance.now() - t0) / 5).toBeLessThan(40);
  });

  test('an empty sea and a map-filling plateau both build', () => {
    const sea = resolveShape(emptyWorld(1), new TerrainBuilder(1).build(), { rules: [] });
    const full = new TerrainBuilder(2);
    full.rect(0, 0, SIZE_X - 1, SIZE_Z - 1, 6);
    const plateau = resolveShape(emptyWorld(2), full.build(), { rules: [] });
    for (const p of [sea, plateau]) for (const chunk of allChunks()) expect(validateMesh(terrainLayer.build(chunk, p, null as never).mesh)).toEqual([]);
  });

  test('a chunk built again after edits is the chunk built from nothing, byte for byte', () => {
    for (const terrain of [plan.terrain, generateTerrain(4242, 2)]) {
      // Houses and floors come and go at the steps of the ground (shores, river banks, terraces), a few at a time.
      const steps: [number, number, number][] = [];
      for (let z = 1; z < SIZE_Z - 1; z++) for (let x = 1; x < SIZE_X - 1; x++) {
        const h = terrain.height[columnIndex(x, z)]!;
        if ([[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dz]) => terrain.height[columnIndex(x + dx!, z + dz!)] !== h)) steps.push([x, h, z]);
      }
      const blocks = new Map<CellKey, Block>();
      const floors = new Map<CellKey, 'plaza'>();
      for (let round = 0; round < 8; round++) {
        for (let k = 0; k < (round === 0 ? 60 : 6); k++) {
          const [x, h, z] = steps[Math.floor(rand(5, round, k) * steps.length)]!;
          const c = key(x, h, z);
          if (blocks.delete(c) || floors.delete(c)) continue;
          if (rand(6, round, k) < 0.3) floors.set(c, 'plaza');
          else blocks.set(c, { kind: 'house', color: 0, rot: 0, seq: k });
        }
        const world = { ...emptyWorld(terrain.seed, 2), blocks: new Map(blocks), floors: new Map(floors) };
        const town = { ...plan, terrain, world };
        if (round === 6) setStyle('terrain', 'radiusBuilt', 0.02);
        for (const chunk of allChunks()) {
          const again = terrainChunkMesh(chunk, town), fresh = buildTerrainChunk(chunk, town).build();
          for (const k of Object.keys(fresh) as (keyof MeshData)[]) {
            const a = again[k], b = fresh[k];
            const bytes = (m: typeof a): Buffer => Buffer.from(m.buffer, m.byteOffset, m.byteLength);
            expect(a.length === b.length && bytes(a).equals(bytes(b)), `round ${round}, chunk ${chunk.cx}:${chunk.cz}, ${k}`).toBe(true);
          }
        }
      }
      resetStyles();
    }
  });
});
