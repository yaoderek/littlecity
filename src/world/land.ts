// Shaping the land: raising and digging columns, and carrying what stands on
// them (design section 6, "Things standing on it move with it"). Owner:
// Landshaping. Pure; world.ts calls in here for the 'land' edit.
//
// What a column carries: its stack, the cells from the ground up (y = h)
// while each holds a block, plus the cell on top of the stack (a floor or a
// fence lying there). Everything in those cells moves by one level with the
// ground: blocks (seq, colour, style and all), floors and edge pieces. A
// block above a gap (a bridge, an arch) does not rest on this column and
// stays where it is. An edge piece between a moving column and a still one
// stays put if the still side holds it up, else it goes with the moving side.
//
// A column is refused (and skipped) when:
//   - it is in the sea border, or would rise above LAND_MAX, or is water and
//     is dug;
//   - raising water would lift a dock or a bridge (a dock or arch on the
//     water; an Auto block rides up and adapts);
//   - carrying would push something past the top of the world or into
//     something that is not moving;
//   - after the move something it carried would stand where it may not (a
//     tree, path or fence dug down into water): the reason names it.
// The edit as a whole is refused only when every column is.

import { phrase } from '@/core/phrase';
import { columnIndex, edgeCells, inColumnBounds, key, keyX, keyY, keyZ, NO_CELL, SIZE_X, SIZE_Y, SIZE_Z, type CellKey, type EdgeKey } from '@/core/grid';
import { KINDS, placedInfo, type EdgeKind, type FloorKind } from '@/core/kinds';
import type { Block, Edit, Terrain, World } from '@/core/world';
import { baseOf, editsWith, islandOf, LAND_MAX, landEditable } from '@/terrain/land';

type LandEdit = Extract<Edit, { type: 'land' }>;

const N = SIZE_X * SIZE_Z;
const STEP = 1 << 12; // one level in a cell key
const yes = { ok: true } as const;

interface Column {
  col: number;
  x: number;
  z: number;
  dy: 1 | -1;
  /** Ground height before. */
  h: number;
  /** The carried cells are y = h … top (top may be past the grid when the stack reaches it). */
  top: number;
}

export interface LandResult {
  /** The new world (the input world when nothing moved). */
  world: World;
  /** Columns that moved, with their change. */
  moved: ReadonlyMap<number, 1 | -1>;
  /** Columns that could not move, and why. */
  refused: ReadonlyMap<number, string>;
}

const blockIn = (w: World, x: number, y: number, z: number): Block | undefined => (y >= 0 && y < SIZE_Y ? w.blocks.get(key(x, y, z)) : undefined);

/** Reads the edit's column lists; null if they are not well formed. */
function columnsOf(e: LandEdit): Map<number, 1 | -1> | null {
  if (!Array.isArray(e.up) || !Array.isArray(e.down)) return null;
  const out = new Map<number, 1 | -1>();
  for (const [list, dy] of [[e.up, 1], [e.down, -1]] as const) {
    for (const c of list) {
      if (typeof c !== 'number' || !Number.isInteger(c) || c < 0 || c >= N || out.has(c)) return null;
      out.set(c, dy);
    }
  }
  return out;
}

/** The checks one column can answer on its own, before anything moves. */
function columnVerdict(w: World, t: Terrain, col: number, dy: 1 | -1): Column | string {
  const x = col % SIZE_X, z = (col / SIZE_X) | 0;
  if (!inColumnBounds(x, z) || !landEditable(x, z)) return phrase('the outer five columns of the map stay sea');
  const h = t.height[col]!;
  let top = h;
  while (top < SIZE_Y && blockIn(w, x, top, z)) top++;
  if (dy < 0) {
    if (h === 0) return phrase('this is water already');
    return { col, x, z, dy, h, top };
  }
  if (h >= LAND_MAX) return phrase('the land can rise no higher');
  if (h === 0) {
    const onWater = blockIn(w, x, 0, z);
    // A dock or bridge stays where it is; an Auto block (a dock while it floats) rides up and adapts.
    if (onWater && (onWater.kind === 'dock' || onWater.kind === 'arch')) return phrase('a dock or a bridge stands on this water');
  }
  // The stack's blocks end at top - 1; the cell `top` may hold a floor or edge pieces, which go to top + 1.
  if (top >= SIZE_Y) return phrase('it would push something past the top of the world');
  const lying = w.floors.has(key(x, top, z)) || edgesAt(w, x, top, z).length > 0;
  if (lying && top + 1 >= SIZE_Y) return phrase('it would push something past the top of the world');
  if (lying && blockIn(w, x, top + 1, z)) return phrase('something above is in the way');
  return { col, x, z, dy, h, top };
}

/** The edge pieces on the four sides of a cell. */
function edgesAt(w: World, x: number, y: number, z: number): EdgeKey[] {
  if (w.edges.size === 0) return [];
  const out: EdgeKey[] = [];
  const c = key(x, y, z);
  const tryEdge = (e: number): void => {
    if (w.edges.has(e)) out.push(e);
  };
  tryEdge(c * 2); // east side
  tryEdge(c * 2 + 1); // south side
  if (x > 0) tryEdge(key(x - 1, y, z) * 2);
  if (z > 0) tryEdge(key(x, y, z - 1) * 2 + 1);
  return out;
}

const isSolidIn = (w: World, t: Terrain, c: CellKey): boolean => {
  if (c === NO_CELL) return false;
  if (keyY(c) < t.height[columnIndex(keyX(c), keyZ(c))]!) return true;
  const b = w.blocks.get(c);
  return b !== undefined && placedInfo(b.kind).solid;
};
const onTop = (w: World, t: Terrain, c: CellKey): boolean => {
  const y = keyY(c);
  const h = t.height[columnIndex(keyX(c), keyZ(c))]!;
  if (y < h) return false;
  if (y === h) return h > 0;
  return isSolidIn(w, t, c - STEP);
};
const standable = (w: World, t: Terrain, c: CellKey): boolean => {
  if (!onTop(w, t, c)) return false;
  const b = w.blocks.get(c);
  return b === undefined || !placedInfo(b.kind).solid;
};

/** Moves the given columns together; returns the new world and, for anything that would end up out of place, the column to blame. */
function simulate(w: World, t: Terrain, cols: ReadonlyMap<number, Column>): { world: World; terrain: Terrain; blame: Map<number, string> } {
  const blame = new Map<number, string>();
  const carried = (c: CellKey): Column | undefined => {
    const col = cols.get(columnIndex(keyX(c), keyZ(c)));
    if (!col) return undefined;
    const y = keyY(c);
    return y >= col.h && y <= col.top ? col : undefined;
  };
  const blocks = new Map<CellKey, Block>();
  const movedBlocks: CellKey[] = [];
  for (const [c, b] of w.blocks) {
    const col = carried(c);
    if (!col) blocks.set(c, b);
    else {
      blocks.set(c + col.dy * STEP, b);
      movedBlocks.push(c + col.dy * STEP);
    }
  }
  const floors = new Map<CellKey, FloorKind>();
  for (const [c, f] of w.floors) {
    const col = carried(c);
    floors.set(col ? c + col.dy * STEP : c, f);
  }
  const edges = new Map<EdgeKey, EdgeKind>();
  const shifts: [EdgeKey, number, EdgeKind][] = [];
  for (const [e, k] of w.edges) {
    const [a, b] = edgeCells(e);
    const ca = carried(a), cb = b === NO_CELL ? undefined : carried(b);
    let dy = 0;
    if (ca && cb) dy = ca.dy === cb.dy || standable(w, t, a) ? ca.dy : cb.dy;
    else if (ca) dy = b !== NO_CELL && standable(w, t, b) ? 0 : ca.dy;
    else if (cb) dy = standable(w, t, a) ? 0 : cb.dy;
    shifts.push([e, dy, k]);
  }
  for (const [e, dy, k] of shifts) if (dy === 0) edges.set(e, k);
  for (const [e, dy, k] of shifts) {
    if (dy === 0) continue;
    const to = e + dy * STEP * 2;
    if (edges.has(to)) {
      // Two pieces would meet in one place: the move is refused, so where this one lands does not matter.
      const [a, b] = edgeCells(e);
      const owner = carried(a) ?? (b === NO_CELL ? undefined : carried(b));
      if (owner) blame.set(owner.col, phrase('something beside it is in the way'));
      continue;
    }
    edges.set(to, k);
  }
  const heights = new Map<number, number>();
  for (const col of cols.values()) heights.set(col.col, col.h + col.dy);
  const base = baseOf(t);
  const terrainEdits = editsWith(base, w.terrainEdits, heights);
  const next: World = { ...w, blocks, floors, edges };
  if (terrainEdits) next.terrainEdits = terrainEdits;
  else delete next.terrainEdits;
  const nt = islandOf(next, base);

  // What the moved columns now hold must still be legal where it stands.
  const blameCell = (c: CellKey, why: string): void => {
    const col = cols.get(columnIndex(keyX(c), keyZ(c)));
    if (col && !blame.has(col.col)) blame.set(col.col, why);
  };
  for (const c of movedBlocks) {
    const b = blocks.get(c)!;
    const info = placedInfo(b.kind);
    if (info.waterOnly) {
      if (!(keyY(c) === 0 && nt.height[columnIndex(keyX(c), keyZ(c))] === 0)) blameCell(c, phrase('a dock stays on the water'));
      continue;
    }
    if (!info.needsWalkableTop) continue;
    const under = blocks.get(c - STEP);
    if (b.kind === 'windmill' && under?.kind === 'windmill') continue;
    if (!onTop(next, nt, c)) blameCell(c, `the ${b.kind} there needs dry ground`);
  }
  for (const col of cols.values()) {
    // Floors in the column (moved or not) need a walkable top, and a block in their cell that keeps them.
    for (let y = Math.max(0, col.h + col.dy); y <= Math.min(SIZE_Y - 1, col.top + 1); y++) {
      const c = key(col.x, y, col.z);
      const f = floors.get(c);
      if (f === undefined) continue;
      const b = blocks.get(c);
      if (!onTop(next, nt, c)) blameCell(c, `the ${f} there needs dry ground`);
      else if (b && !(b.kind === 'arch' ? isSolidIn(next, nt, c - STEP) : b.kind !== 'auto' && KINDS[b.kind].keepsFloor)) blameCell(c, phrase('something above is in the way'));
    }
  }
  for (const [e, k] of edges) {
    const [a, b] = edgeCells(e);
    const ca = cols.get(columnIndex(keyX(a), keyZ(a)));
    const cb = b === NO_CELL ? undefined : cols.get(columnIndex(keyX(b), keyZ(b)));
    if (!ca && !cb) continue;
    if (standable(next, nt, a) || (b !== NO_CELL && standable(next, nt, b))) continue;
    blameCell(ca ? a : b, `the ${k} there needs dry ground`);
  }
  return { world: next, terrain: nt, blame };
}

let memo: { w: World; t: Terrain; e: LandEdit; r: LandResult | string } | null = null;

/** Works out a land edit: what moves, what is refused. A string when the edit cannot be read. */
export function shapeLand(w: World, t: Terrain, e: LandEdit): LandResult | string {
  if (memo && memo.w === w && memo.t === t && memo.e === e) return memo.r;
  const r = work(w, islandOf(w, t), e);
  memo = { w, t, e, r };
  return r;
}

function work(w: World, t: Terrain, e: LandEdit): LandResult | string {
  const wanted = columnsOf(e);
  if (!wanted) return phrase('that edit could not be read');
  if (wanted.size === 0) return phrase('no ground to shape');
  const refused = new Map<number, string>();
  const cols = new Map<number, Column>();
  for (const [col, dy] of wanted) {
    const v = columnVerdict(w, t, col, dy);
    if (typeof v === 'string') refused.set(col, v);
    else cols.set(col, v);
  }
  // Each round drops the columns whose move would leave something out of place, and tries again.
  for (let round = 0; cols.size > 0 && round < 8; round++) {
    const sim = simulate(w, t, cols);
    if (sim.blame.size === 0) {
      const moved = new Map<number, 1 | -1>();
      for (const c of cols.values()) moved.set(c.col, c.dy);
      return { world: sim.world, moved, refused };
    }
    for (const [col, why] of sim.blame) {
      cols.delete(col);
      refused.set(col, why);
    }
  }
  return { world: w, moved: new Map(), refused };
}

/** canApply's answer for a land edit. */
export function canShapeLand(w: World, t: Terrain, e: LandEdit): { ok: true } | { ok: false; reason: string } {
  const r = shapeLand(w, t, e);
  if (typeof r === 'string') return { ok: false, reason: r };
  if (r.moved.size > 0) return yes;
  // The first column's reason (in the order given) is the one to show.
  const first = [...e.up, ...e.down].find((c) => r.refused.has(c));
  return { ok: false, reason: (first !== undefined && r.refused.get(first)) || phrase('the ground cannot move here') };
}
