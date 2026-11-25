// A vertex pool (Look, Stage 1): many meshes packed into one set of GPU
// buffers, drawn with one call. Pure data, no Three.js, so it is unit-tested
// in Node; poolmesh.ts turns a pool into a BufferGeometry.
//
// Each 16 × 16 chunk of static geometry is one pool; props, actors and
// spawned things share another. An entry is one structure, one layer chunk
// or one prop: `put` appends it (and retires the version it replaces),
// `remove` retires it. Retired ranges are collapsed to nothing (their
// positions are zeroed) and reclaimed later by compaction, so an edit costs
// the size of what changed, not the size of the chunk.
//
// The packed vertex (26 bytes):
//   position  3 × float32
//   normal    4 × int8, normalised     xyz, and sway in w
//   color     4 × uint8, normalised    rgb (sRGB), and the pattern id in a (as id / 255)
//   ink       2 × uint16               ink id, and edge distance × EDGE_SCALE
//   slot      1 × uint16               0 = fixed in the world; otherwise a row of the slot table
//                                      (slots.ts) that gives the vertex a matrix and four params

import { MIST } from '@/gen/airborne';
import { PATTERN, type MeshData } from '@/gen/mesh';

/** `edge` is stored as a uint16 in units of 1 / EDGE_SCALE. */
export const EDGE_SCALE = 256;
const EDGE_MAX = 65535;

export interface PoolEntry {
  readonly key: string;
  hash: number;
  /** First vertex and vertex count. */
  offset: number;
  count: number;
  slot: number;
  /** Holds PATTERN.beam vertices, which the overlay pass draws. */
  beams: boolean;
  /** Holds other vertices, which the page's own pass draws. */
  solid: boolean;
}

/** A dirty span of vertices: [start, end). */
export type Span = [start: number, end: number];

const MIN_CAPACITY = 1536;

export class VertexPool {
  capacity = 0;
  /** Vertices in use, retired ones included. Draw this many. */
  count = 0;
  /** Vertices in retired ranges. */
  garbage = 0;
  position = new Float32Array(0);
  normal = new Int8Array(0);
  color = new Uint8Array(0);
  ink = new Uint16Array(0);
  slot = new Uint16Array(0);
  readonly entries = new Map<string, PoolEntry>();
  /** Goes up when the arrays are replaced by larger ones: the GPU buffers must be recreated. */
  generation = 0;
  /** Bounds of everything ever put (they only grow, until compaction). */
  readonly min: [number, number, number] = [Infinity, Infinity, Infinity];
  readonly max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
  /** Entries holding beam vertices, and entries or slots that the overlay pass must draw. */
  beamEntries = 0;
  /** Entries the page's own pass must draw: a pool of nothing but smoke has none. */
  solidEntries = 0;

  private dirty: Span[] = [];
  private slotDirty: Span[] = [];

  /** Adds or replaces an entry. The entry keeps its slot unless one is given. */
  put(key: string, hash: number, mesh: MeshData, slot?: number): PoolEntry {
    const old = this.entries.get(key);
    const keepSlot = slot ?? old?.slot ?? 0;
    if (old) {
      this.retire(old);
      this.entries.delete(key); // before reserve(), so a compaction reclaims its range
    }
    const n = mesh.position.length / 3;
    this.reserve(n);
    const offset = this.count;
    const mist = pack(this, offset, mesh, keepSlot);
    const beams = mist > 0, solid = mist < n;
    this.count += n;
    const entry: PoolEntry = { key, hash, offset, count: n, slot: keepSlot, beams, solid };
    this.entries.set(key, entry);
    if (beams) this.beamEntries++;
    if (solid) this.solidEntries++;
    if (n > 0) {
      this.mark(this.dirty, offset, offset + n);
      this.mark(this.slotDirty, offset, offset + n);
      growBounds(this, mesh.position);
    }
    return entry;
  }

  remove(key: string): boolean {
    const old = this.entries.get(key);
    if (!old) return false;
    this.retire(old);
    this.entries.delete(key);
    this.maybeCompact();
    return true;
  }

  /** Points every vertex of an entry at a slot (0 = fixed in the world). */
  setSlot(entry: PoolEntry, slot: number): void {
    if (entry.slot === slot) return;
    entry.slot = slot;
    this.slot.fill(slot, entry.offset, entry.offset + entry.count);
    this.mark(this.slotDirty, entry.offset, entry.offset + entry.count);
  }

  /** The spans changed since the last call: [position / normal / color / ink spans, slot spans]. */
  takeDirty(): { data: Span[]; slots: Span[] } {
    const out = { data: this.dirty, slots: this.slotDirty };
    this.dirty = [];
    this.slotDirty = [];
    return out;
  }

  /** Squeezes retired ranges out. Offsets change; slots and keys do not. */
  compact(): void {
    if (this.garbage === 0) return;
    const live = [...this.entries.values()].sort((a, b) => a.offset - b.offset);
    let at = 0;
    for (const e of live) {
      if (e.offset !== at) {
        this.position.copyWithin(at * 3, e.offset * 3, (e.offset + e.count) * 3);
        this.normal.copyWithin(at * 4, e.offset * 4, (e.offset + e.count) * 4);
        this.color.copyWithin(at * 4, e.offset * 4, (e.offset + e.count) * 4);
        this.ink.copyWithin(at * 2, e.offset * 2, (e.offset + e.count) * 2);
        this.slot.copyWithin(at, e.offset, e.offset + e.count);
        e.offset = at;
      }
      at += e.count;
    }
    this.count = at;
    this.garbage = 0;
    this.dirty = at > 0 ? [[0, at]] : [];
    this.slotDirty = at > 0 ? [[0, at]] : [];
  }

  clear(): void {
    this.entries.clear();
    this.count = 0;
    this.garbage = 0;
    this.beamEntries = 0;
    this.solidEntries = 0;
    this.dirty = [];
    this.slotDirty = [];
    this.min.fill(Infinity);
    this.max.fill(-Infinity);
  }

  private retire(e: PoolEntry): void {
    if (e.count > 0) {
      this.position.fill(0, e.offset * 3, (e.offset + e.count) * 3);
      this.mark(this.dirty, e.offset, e.offset + e.count);
      this.garbage += e.count;
    }
    if (e.beams) this.beamEntries--;
    if (e.solid) this.solidEntries--;
  }

  private maybeCompact(): void {
    if (this.garbage > 4096 && this.garbage > this.count * 0.4) this.compact();
  }

  /** Makes room for `n` more vertices, reclaiming retired ranges before growing. */
  private reserve(n: number): void {
    if (this.count + n <= this.capacity) {
      this.maybeCompact();
      return;
    }
    this.compact();
    if (this.count + n <= this.capacity) return;
    const capacity = Math.max(MIN_CAPACITY, Math.ceil((this.count + n) * 1.5));
    const grow = <T extends Float32Array | Int8Array | Uint8Array | Uint16Array>(old: T, size: number): T => {
      const next = new (old.constructor as new (n: number) => T)(capacity * size);
      next.set(old.subarray(0, this.count * size));
      return next;
    };
    this.position = grow(this.position, 3);
    this.normal = grow(this.normal, 4);
    this.color = grow(this.color, 4);
    this.ink = grow(this.ink, 2);
    this.slot = grow(this.slot, 1);
    this.capacity = capacity;
    this.generation++;
    this.dirty = [];
    this.slotDirty = [];
  }

  private mark(list: Span[], start: number, end: number): void {
    // A handful of spans at most: beyond that, merge into one.
    for (const s of list) {
      if (start <= s[1] && end >= s[0]) {
        s[0] = Math.min(s[0], start);
        s[1] = Math.max(s[1], end);
        return;
      }
    }
    if (list.length < 8) {
      list.push([start, end]);
      return;
    }
    let lo = start, hi = end;
    for (const s of list) {
      lo = Math.min(lo, s[0]);
      hi = Math.max(hi, s[1]);
    }
    list.length = 0;
    list.push([lo, hi]);
  }
}

function growBounds(pool: VertexPool, p: Float32Array): void {
  const { min, max } = pool;
  for (let i = 0; i < p.length; i += 3) {
    const x = p[i]!, y = p[i + 1]!, z = p[i + 2]!;
    if (x < min[0]) min[0] = x;
    if (x > max[0]) max[0] = x;
    if (y < min[1]) min[1] = y;
    if (y > max[1]) max[1] = y;
    if (z < min[2]) min[2] = z;
    if (z > max[2]) max[2] = z;
  }
}

/** True if a mesh holds beam or mist vertices, which the overlay pass draws. */
export function hazy(mesh: MeshData): boolean {
  return mesh.pattern.some(isHaze);
}
/** As the shader reads it: the pattern without its AIRBORNE bit (src/gen/airborne.ts). */
const isHaze = (pattern: number): boolean => (pattern & 127) === PATTERN.beam || (pattern & 127) === MIST;

/** Writes a mesh into the pool's arrays at a vertex offset. Returns how many of its vertices are beam or mist (the overlay pass's). */
function pack(pool: VertexPool, offset: number, mesh: MeshData, slot: number): number {
  const n = mesh.position.length / 3;
  pool.position.set(mesh.position, offset * 3);
  const { normal, color, ink } = pool;
  const mn = mesh.normal, mc = mesh.color, mp = mesh.pattern, mi = mesh.inkId, me = mesh.edge, ms = mesh.sway;
  let mist = 0;
  for (let v = 0; v < n; v++) {
    const o4 = (offset + v) * 4;
    normal[o4] = Math.round(mn[v * 3]! * 127);
    normal[o4 + 1] = Math.round(mn[v * 3 + 1]! * 127);
    normal[o4 + 2] = Math.round(mn[v * 3 + 2]! * 127);
    normal[o4 + 3] = Math.round(ms[v]! * 127);
    color[o4] = mc[v * 3]!;
    color[o4 + 1] = mc[v * 3 + 1]!;
    color[o4 + 2] = mc[v * 3 + 2]!;
    const pattern = mp[v]!;
    color[o4 + 3] = pattern;
    if (isHaze(pattern)) mist++;
    const o2 = (offset + v) * 2;
    ink[o2] = mi[v]!;
    const e = me[v]! * EDGE_SCALE;
    ink[o2 + 1] = e >= EDGE_MAX ? EDGE_MAX : e <= 0 ? 0 : Math.round(e);
  }
  pool.slot.fill(slot, offset, offset + n);
  return mist;
}
