// Share codec, autosave and the town file (design section 15). Owner: Logic.
//
// A share code is base64url of "LC", a version byte, then the town. There are
// two forms. encodeTown writes whichever is shorter for the town (a tie goes
// to version 5); the link, the town file and the autosave all use it, and
// decodeTown reads every version.
//
// ── Version 5 (2026-11-20, short links): the town range-coded ──
//
//   "LC" 5 | checksum (u32 LE, FNV-1a of everything after it) | seed (i32 LE)
//   | body: one adaptive binary range-coded stream (rangecoder.ts), laid out
//     and modelled in codec5.ts:
//       generator bit | blocks: count, then per block in seq order: seq gap;
//         where it is (on the block after the one under the last block? the
//         step that followed this step last time? the same step again? else
//         dy, dx, dz); kind (by the kind below or the last kind); colour (by
//         the colour below, or the last); rot (stairs); styled bit, style
//       | nextSeq − last seq − 1
//       | floors: every column of the map, row by row: has a floor (by its
//         neighbours west, north, north-west, north-east); per floor, lowest
//         first: kind (by the kinds west and north), level (from a
//         neighbour's), another floor above it?
//       | edges: count, then key gap and kind (by the last kind)
//       | sections: flags, then per set bit, lowest first, the section coded
//         in place: bit 0 the reshaped land (every column: edited? height,
//         from a neighbour's); bit 1 damaged blocks (every block: damaged?
//         the same damage as the last? damage). Bit 2 is promised to the
//         island size. A bit this code does not know is "a different version".
//
//   Grown towns come out about 40% shorter than the old encoder made them.
//   The checksum is what refuses a damaged code: a range decoder reads any
//   bytes as some bits, so every value is also checked as it is read.
//
// ── Versions 1 to 4: the town packed to bytes and deflated ──
//
// Until 2026-11-20 every town was written this way; it is still written when
// it is the shorter (a town of exact machine-made repeats, like the
// benchmark's, where deflate's long matches win). Since 2026-11-20 the
// deflate encoder parses optimally with dynamic Huffman codes (deflate.ts),
// so the same payload deflates about 24% smaller than before; old decoders
// read either. legacy-codec.ts keeps the old encoder, frozen, for the tests.
//
//   "LC" version | checksum (u32 LE, of the payload) | deflate(payload)
//   payload = seed (i32 LE) | nextSeq (varint)
//           | blocks: count, then per block in seq order: seq gap (varint),
//             dx, dy, dz from the previous block (zigzag varints),
//             kind | colour << 4 | styled << 7 (byte), rot (byte, stairs only),
//             style (byte, version 2 and styled only)
//           | floors: count, then key delta (varint), kind (byte)
//           | edges:  count, then key delta (varint), kind (byte)
//
// Version 2 (2026-11-19, house styles) differs from version 1 only in the
// styled bit and the style byte after it. In this form a town with no styled
// block is still written as version 1; the decoder reads both.
//
// Version 3 (2026-11-19, the second island generator) is version 2 with one
// byte after the seed: the generator that made the island (World.terrainGen,
// 1 or 2). Only a town on generator 2 needs version 3; a code without the
// byte is generator 1, so every old link and file still opens on the island
// it was built on.
//
// Version 4 (2026-11-19, shaping the land) is version 3 (generator byte
// included) followed by optional sections after the edges:
//
//   sections = flags (varint) | per set bit, lowest first: length (varint), bytes
//   bit 0, the reshaped land (World.terrainEdits): count (varint), then per
//          column in index order: index delta from the previous (varint, the
//          first from -1), height (byte, 0–10)
//
//   bit 1, damaged blocks (Block.ruin, mischief: design section 13b): count
//          (varint), then per damaged block its index in the block list
//          above (delta varint, the first from -1) and its damage (varint; the
//          passing "settling" mark is never saved)
//
// Each section is self-contained and length-prefixed, so another optional
// section can take the next bit beside this one without touching it. A town
// with no section to write is written as version 1, 2 or 3 (the lowest that
// holds it); a flag bit this code does not know is "a different version".
//
// None of the functions here throw. decodeTown rejects garbage, truncation
// and other versions with a plain sentence (plan Review Focus 2); saveTown
// and the autosaver report storage trouble instead of failing (Focus 5).

import { phrase } from '@/core/phrase';
import { inBounds, key, keyX, keyY, keyZ, NO_CELL, edgeCells, type CellKey, type EdgeKey } from '@/core/grid';
import { EDGE_KINDS, FLOOR_KINDS, PALETTE_SIZE, type EdgeKind, type FloorKind } from '@/core/kinds';
import type { Block, Rot, World } from '@/core/world';
import { isHouseStyle } from '@/style/houses';
import { LAND_MAX, landEditable } from '@/terrain/land';
import { Bad, decodeBody, encodeBody, PLACED, SECTION_LAND, SECTION_RUINS } from './codec5';
import { isRuin, savedRuin } from './damage';
import { deflateRaw, fromBase64Url, inflateRaw, toBase64Url } from './deflate';

export type DecodeResult = { ok: true; world: World } | { ok: false; reason: string };

/** Above this many characters a share link is too long; offer the town file instead (design section 15). */
export const SHARE_LINK_MAX = 6000;
/** The first format, still written for towns with no styled block. */
const VERSION_1 = 1;
/** Version 1 plus a house style on blocks that have one. */
const VERSION_2 = 2;
/** Version 2 plus the island generator (a byte after the seed). */
const VERSION_3 = 3;
/** Version 3 plus optional sections after the edges (the reshaped land). */
const VERSION_4 = 4;
/** Everything range-coded under learned contexts (codec5.ts). */
const VERSION_5 = 5;
/** Section flags (versions 4 and 5) and the kind codes are codec5.ts's: one list for every version. */
const KNOWN_SECTIONS = SECTION_LAND | SECTION_RUINS;

const NOT_A_TOWN = phrase('This is not a Little City town.');
const DAMAGED = phrase('This town link is damaged or incomplete.');
const OTHER_VERSION = phrase('This town was made by a different version of Little City.');

// ───────────────────────────────────────────────────────────── bytes ──

class Writer {
  bytes: number[] = [];
  byte(b: number): void {
    this.bytes.push(b & 0xff);
  }
  u32(v: number): void {
    for (let i = 0; i < 4; i++) this.byte(v >>> (8 * i));
  }
  varint(v: number): void {
    let n = Math.max(0, Math.floor(v));
    while (n >= 0x80) {
      this.byte((n & 0x7f) | 0x80);
      n = Math.floor(n / 128);
    }
    this.byte(n);
  }
}

class Reader {
  pos = 0;
  constructor(private readonly b: Uint8Array) {}
  get done(): boolean {
    return this.pos >= this.b.length;
  }
  byte(): number {
    if (this.pos >= this.b.length) throw new RangeError('truncated');
    return this.b[this.pos++]!;
  }
  u32(): number {
    let v = 0;
    for (let i = 0; i < 4; i++) v |= this.byte() << (8 * i);
    return v >>> 0;
  }
  varint(): number {
    let v = 0;
    let mul = 1;
    for (let i = 0; i < 5; i++) {
      const b = this.byte();
      v += (b & 0x7f) * mul;
      if (!(b & 0x80)) return v;
      mul *= 128;
    }
    throw new RangeError('varint too long');
  }
}

function zigzag(n: number): number {
  return n >= 0 ? n * 2 : -n * 2 - 1;
}
function unzigzag(n: number): number {
  return n & 1 ? -(n + 1) / 2 : n / 2;
}

function checksum(bytes: Uint8Array): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < bytes.length; i++) h = Math.imul(h ^ bytes[i]!, 0x01000193);
  return h >>> 0;
}

function sortedKeys<K extends number>(m: ReadonlyMap<K, unknown>): K[] {
  return [...m.keys()].sort((a, b) => a - b);
}

// ───────────────────────────────────────────────────────────── codec ──

/**
 * A URL-safe string holding the whole town: version 5, or the deflated
 * format (version 1 to 4) when that comes out shorter (a town of exact
 * machine-made repeats can); a tie goes to version 5.
 */
export function encodeTown(w: World): string {
  const ranged = encodeRanged(w);
  const deflated = encodeDeflated(w);
  return deflated.length < ranged.length ? deflated : ranged;
}

/** Version 5: "LC" 5 | checksum (u32 LE, of everything after it) | seed (i32 LE) | range-coded body. */
export function encodeRanged(w: World, moreFlags = 0): string {
  const body = encodeBody(w, moreFlags);
  const all = new Uint8Array(11 + body.length);
  all.set([0x4c, 0x43, VERSION_5]);
  const seed = w.seed | 0;
  for (let i = 0; i < 4; i++) all[7 + i] = (seed >>> (8 * i)) & 0xff;
  all.set(body, 11);
  const sum = checksum(all.subarray(7));
  for (let i = 0; i < 4; i++) all[3 + i] = (sum >>> (8 * i)) & 0xff;
  return toBase64Url(all);
}

/** The deflated format: version 1, 2, 3 or 4, the lowest that holds the town. */
export function encodeDeflated(w: World): string {
  const version = deflatedVersion(w);
  const p = new Writer();
  p.u32(w.seed | 0);
  if (version >= VERSION_3) p.byte(w.terrainGen ?? 1);
  p.varint(w.nextSeq);
  // Blocks in placement order, each relative to the one placed before it:
  // towns grow in stacks and rows, so the steps are small and repetitive.
  const blocks = [...w.blocks].sort((a, b) => a[1].seq - b[1].seq);
  p.varint(blocks.length);
  let px = 0, py = 0, pz = 0, pseq = 0;
  for (const [cell, b] of blocks) {
    p.varint(b.seq - pseq - 1);
    pseq = b.seq;
    p.varint(zigzag(keyX(cell) - px));
    p.varint(zigzag(keyY(cell) - py));
    p.varint(zigzag(keyZ(cell) - pz));
    px = keyX(cell);
    py = keyY(cell);
    pz = keyZ(cell);
    const styled = version !== VERSION_1 && !!b.style;
    p.byte(PLACED.indexOf(b.kind) | (b.color << 4) | (styled ? 0x80 : 0));
    if (b.kind === 'stairs') p.byte(b.rot);
    if (styled) p.byte(b.style!);
  }
  let prev = -1;
  const floors = sortedKeys(w.floors);
  p.varint(floors.length);
  for (const cell of floors) {
    p.varint(cell - prev);
    prev = cell;
    p.byte(FLOOR_KINDS.indexOf(w.floors.get(cell)!));
  }
  prev = -1;
  const edges = sortedKeys(w.edges);
  p.varint(edges.length);
  for (const e of edges) {
    p.varint(e - prev);
    prev = e;
    p.byte(EDGE_KINDS.indexOf(w.edges.get(e)!));
  }
  if (version === VERSION_4) writeSections(p, w, blocks.map(([, b]) => b));
  const payload = Uint8Array.from(p.bytes);
  const head = new Writer();
  head.byte(0x4c);
  head.byte(0x43);
  head.byte(version);
  head.u32(checksum(payload));
  const packed = deflateRaw(payload);
  const all = new Uint8Array(head.bytes.length + packed.length);
  all.set(head.bytes);
  all.set(packed, head.bytes.length);
  return toBase64Url(all);
}

/** Version 4's optional sections: the flags, then each present section with its length. */
function writeSections(p: Writer, w: World, order: readonly Block[]): void {
  let flags = 0;
  const sections: number[][] = [];
  if (w.terrainEdits && w.terrainEdits.size > 0) {
    flags |= SECTION_LAND;
    const s = new Writer();
    const cols = sortedKeys(w.terrainEdits);
    s.varint(cols.length);
    let prev = -1;
    for (const c of cols) {
      s.varint(c - prev);
      prev = c;
      s.byte(w.terrainEdits.get(c)!);
    }
    sections.push(s.bytes);
  }
  const ruined: [number, number][] = [];
  order.forEach((b, i) => {
    const r = savedRuin(b.ruin);
    if (r) ruined.push([i, r]);
  });
  if (ruined.length > 0) {
    flags |= SECTION_RUINS;
    const s = new Writer();
    s.varint(ruined.length);
    let prev = -1;
    for (const [i, r] of ruined) {
      s.varint(i - prev);
      prev = i;
      s.varint(r);
    }
    sections.push(s.bytes);
  }
  p.varint(flags);
  for (const bytes of sections) {
    p.varint(bytes.length);
    for (const b of bytes) p.byte(b);
  }
}

/** Reads version 4's sections into the world's optional fields; a reason string if they are damaged. */
function readSections(r: Reader, out: { terrainEdits?: Map<number, number> }, order: readonly CellKey[], blocks: Map<CellKey, Block>): string | null {
  const flags = r.varint();
  if (flags & ~KNOWN_SECTIONS) return OTHER_VERSION;
  if (flags & SECTION_LAND) {
    const length = r.varint();
    const end = r.pos + length;
    const edits = new Map<number, number>();
    const n = r.varint();
    if (n < 1 || n > 48 * 48) return DAMAGED;
    let prev = -1;
    for (let i = 0; i < n; i++) {
      const c = prev + r.varint();
      if (c === prev || c >= 48 * 48 || !landEditable(c % 48, (c / 48) | 0)) return DAMAGED;
      prev = c;
      const h = r.byte();
      if (h > LAND_MAX) return DAMAGED;
      edits.set(c, h);
    }
    if (r.pos !== end) return DAMAGED;
    out.terrainEdits = edits;
  }
  if (flags & SECTION_RUINS) {
    const length = r.varint();
    const end = r.pos + length;
    const n = r.varint();
    if (n < 1 || n > order.length) return DAMAGED;
    let prev = -1;
    for (let i = 0; i < n; i++) {
      const at = prev + r.varint();
      const cell = order[at];
      if (at === prev || cell === undefined) return DAMAGED;
      prev = at;
      const ruin = r.varint();
      if (!isRuin(ruin) || savedRuin(ruin) !== ruin) return DAMAGED;
      blocks.set(cell, { ...blocks.get(cell)!, ruin });
    }
    if (r.pos !== end) return DAMAGED;
  }
  return null;
}

/** The version encodeTown writes for this town. */
export function codecVersion(w: World): 1 | 2 | 3 | 4 | 5 {
  return versionOf(encodeTown(w));
}
const versionOf = (code: string): 1 | 2 | 3 | 4 | 5 => fromBase64Url(code.slice(0, 4))![2] as 1 | 2 | 3 | 4 | 5;

/** The deflated format's version for a town: 4 with reshaped land or a damaged block, 3 on generator 2's island, else 2 if any block has a house style, else 1. */
export function deflatedVersion(w: World): 1 | 2 | 3 | 4 {
  if (w.terrainEdits && w.terrainEdits.size > 0) return VERSION_4;
  for (const b of w.blocks.values()) if (savedRuin(b.ruin)) return VERSION_4;
  if (w.terrainGen === 2) return VERSION_3;
  for (const b of w.blocks.values()) if (b.style) return VERSION_2;
  return VERSION_1;
}

function cellOk(cell: number): boolean {
  return cell >= 0 && cell < 1 << 17 && inBounds(keyX(cell), keyY(cell), keyZ(cell));
}

/** Never throws: a bad code comes back as { ok: false, reason }. */
export function decodeTown(code: string): DecodeResult {
  try {
    return decode(code);
  } catch {
    return { ok: false, reason: DAMAGED };
  }
}

function decode(code: string): DecodeResult {
  if (typeof code !== 'string' || code.trim() === '') return { ok: false, reason: phrase('There is no town in this link.') };
  const bytes = fromBase64Url(code.trim());
  if (!bytes || bytes.length < 2 || bytes[0] !== 0x4c || bytes[1] !== 0x43) return { ok: false, reason: NOT_A_TOWN };
  if (bytes.length < 3) return { ok: false, reason: DAMAGED };
  const version = bytes[2];
  if (version === VERSION_5) return decode5(bytes);
  if (version !== VERSION_1 && version !== VERSION_2 && version !== VERSION_3 && version !== VERSION_4) return { ok: false, reason: OTHER_VERSION };
  if (bytes.length < 8) return { ok: false, reason: DAMAGED };
  const head = new Reader(bytes.subarray(3, 7));
  const sum = head.u32();
  let payload: Uint8Array;
  try {
    payload = inflateRaw(bytes.subarray(7), 1 << 20, true);
  } catch {
    return { ok: false, reason: DAMAGED };
  }
  if (checksum(payload) !== sum) return { ok: false, reason: DAMAGED };

  const r = new Reader(payload);
  const seed = r.u32() | 0;
  let terrainGen: 1 | 2 = 1;
  if (version === VERSION_3 || version === VERSION_4) {
    const g = r.byte();
    if (g !== 1 && g !== 2) return { ok: false, reason: OTHER_VERSION };
    terrainGen = g;
  }
  const nextSeq = r.varint();
  if (nextSeq < 1) return { ok: false, reason: DAMAGED };
  const blocks = new Map<CellKey, Block>();
  const nBlocks = r.varint();
  if (nBlocks > 48 * 48 * 32) return { ok: false, reason: DAMAGED };
  let px = 0, py = 0, pz = 0, pseq = 0;
  /** Cells in the order they were read (the ruins section points into it). */
  const order: CellKey[] = [];
  for (let i = 0; i < nBlocks; i++) {
    const seq = pseq + 1 + r.varint();
    pseq = seq;
    px += unzigzag(r.varint());
    py += unzigzag(r.varint());
    pz += unzigzag(r.varint());
    if (!inBounds(px, py, pz)) return { ok: false, reason: DAMAGED };
    const cell = key(px, py, pz);
    if (blocks.has(cell) || seq >= nextSeq) return { ok: false, reason: DAMAGED };
    order.push(cell);
    const kc = r.byte();
    const kind = PLACED[kc & 15];
    const styled = version !== VERSION_1 && (kc & 0x80) !== 0;
    const color = styled ? (kc >> 4) & 7 : kc >> 4;
    if (kind === undefined || color >= PALETTE_SIZE) return { ok: false, reason: DAMAGED };
    let rot: Rot = 0;
    if (kind === 'stairs') {
      const rr = r.byte();
      if (rr > 3) return { ok: false, reason: DAMAGED };
      rot = rr as Rot;
    }
    if (styled) {
      const style = r.byte();
      if (style === 0 || !isHouseStyle(style)) return { ok: false, reason: DAMAGED };
      blocks.set(cell, { kind, color, rot, seq, style });
    } else blocks.set(cell, { kind, color, rot, seq });
  }
  const floors = new Map<CellKey, FloorKind>();
  let prev = -1;
  const nFloors = r.varint();
  if (nFloors > 48 * 48 * 32) return { ok: false, reason: DAMAGED };
  for (let i = 0; i < nFloors; i++) {
    const cell = prev + r.varint();
    if (cell === prev || !cellOk(cell)) return { ok: false, reason: DAMAGED };
    prev = cell;
    const kind = FLOOR_KINDS[r.byte()];
    if (!kind) return { ok: false, reason: DAMAGED };
    floors.set(cell, kind);
  }
  const edges = new Map<EdgeKey, EdgeKind>();
  prev = -1;
  const nEdges = r.varint();
  if (nEdges > 48 * 48 * 32 * 2) return { ok: false, reason: DAMAGED };
  for (let i = 0; i < nEdges; i++) {
    const e = prev + r.varint();
    if (e === prev) return { ok: false, reason: DAMAGED };
    prev = e;
    const [a, b] = edgeCells(e);
    if (!cellOk(a) || b === NO_CELL) return { ok: false, reason: DAMAGED };
    const kind = EDGE_KINDS[r.byte()];
    if (!kind) return { ok: false, reason: DAMAGED };
    edges.set(e, kind);
  }
  const extra: { terrainEdits?: Map<number, number> } = {};
  if (version === VERSION_4) {
    const bad = readSections(r, extra, order, blocks);
    if (bad) return { ok: false, reason: bad };
  }
  if (!r.done) return { ok: false, reason: DAMAGED };
  let world: World = { version: 1, seed, nextSeq, blocks, floors, edges };
  if (terrainGen === 2) world = { ...world, terrainGen };
  if (extra.terrainEdits) world = { ...world, terrainEdits: extra.terrainEdits };
  return { ok: true, world };
}

/** Version 5: "LC" 5 | checksum (u32 LE, of everything after it) | seed (i32 LE) | range-coded body. */
function decode5(bytes: Uint8Array): DecodeResult {
  if (bytes.length < 11) return { ok: false, reason: DAMAGED };
  const head = new Reader(bytes.subarray(3, 11));
  const sum = head.u32();
  const seed = head.u32() | 0;
  if (checksum(bytes.subarray(7)) !== sum) return { ok: false, reason: DAMAGED };
  try {
    return { ok: true, world: decodeBody(bytes.subarray(11), seed) };
  } catch (e) {
    return { ok: false, reason: e instanceof Bad && e.otherVersion ? OTHER_VERSION : DAMAGED };
  }
}

/** The share code, and whether it is short enough for a link (else offer the town file). */
export function shareTown(w: World): { code: string; fitsLink: boolean } {
  const code = encodeTown(w);
  return { code, fitsLink: code.length <= SHARE_LINK_MAX };
}

/** Reads a share code out of a full URL, a '#fragment', or a bare code. */
export function codeFromLink(link: string): string {
  const hash = link.indexOf('#');
  let code = hash >= 0 ? link.slice(hash + 1) : link;
  if (code.startsWith('town=')) code = code.slice(5);
  return code.trim();
}

// ──────────────────────────────────────────────────────── town file ──

/** A suggested file name for "download town file". */
export function townFileName(w: World): string {
  return `little-city-${w.seed >>> 0}.town`;
}

/** The contents of a town file: a small JSON wrapper around the share code. */
export function townFileText(w: World): string {
  const town = encodeTown(w);
  return JSON.stringify({ littleCity: versionOf(town), town }) + '\n';
}

/** Reads a dropped town file (or a pasted link or code). Never throws. */
export function readTownFile(text: string): DecodeResult {
  try {
    const trimmed = typeof text === 'string' ? text.trim() : '';
    if (trimmed.startsWith('{')) {
      let parsed: unknown;
      try {
        parsed = JSON.parse(trimmed);
      } catch {
        return { ok: false, reason: NOT_A_TOWN };
      }
      const town = (parsed as { town?: unknown } | null)?.town;
      if (typeof town !== 'string') return { ok: false, reason: NOT_A_TOWN };
      return decodeTown(town);
    }
    return decodeTown(codeFromLink(trimmed));
  } catch {
    return { ok: false, reason: NOT_A_TOWN };
  }
}

// ─────────────────────────────────────────────────────────── autosave ──

/** The slice of Storage that autosave needs; pass window.localStorage, or a fake in tests. */
export interface TownStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export const SAVE_KEY = 'little-city.town.v1';

/** Returns false (and never throws) if storage is unavailable or full (plan Review Focus 5). */
export function saveTown(storage: TownStorage | null | undefined, w: World): boolean {
  try {
    if (!storage) return false;
    storage.setItem(SAVE_KEY, encodeTown(w));
    return true;
  } catch {
    return false;
  }
}

/** The saved town, or null if there is none or it cannot be read. Never throws. */
export function loadTown(storage: TownStorage | null | undefined): World | null {
  try {
    const code = storage?.getItem(SAVE_KEY);
    if (!code) return null;
    const result = decodeTown(code);
    return result.ok ? result.world : null;
  } catch {
    return null;
  }
}

export interface Timers {
  set(fn: () => void, ms: number): unknown;
  clear(handle: unknown): void;
}

export interface AutosaveOptions {
  /** Debounce in milliseconds (design section 15: 500). */
  delay?: number;
  /** Defaults to setTimeout / clearTimeout; tests pass fakes. */
  timers?: Timers;
  /** Called once, the first time a save fails (storage missing, denied or full). */
  onUnavailable?(): void;
}

export interface Autosave {
  /** Saves this world after `delay` ms of quiet; a newer world replaces a pending one. */
  schedule(w: World): void;
  /** Saves the pending world now (page hide, unload). Returns whether it was saved. */
  flush(): boolean;
  /** Drops the pending save. */
  cancel(): void;
  /** True once a save has failed. Play goes on regardless. */
  readonly failed: boolean;
}

/** Debounced autosave to storage. Never throws, whatever the storage does. */
export function createAutosave(storage: TownStorage | null | undefined, opts: AutosaveOptions = {}): Autosave {
  const delay = opts.delay ?? 500;
  const timers: Timers = opts.timers ?? {
    set: (fn, ms) => setTimeout(fn, ms),
    clear: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
  };
  let pending: World | null = null;
  let handle: unknown = null;
  let failed = false;
  let told = false;
  const save = (): boolean => {
    handle = null;
    const w = pending;
    pending = null;
    if (!w) return false;
    const ok = saveTown(storage, w);
    if (!ok) {
      failed = true;
      if (!told) {
        told = true;
        try {
          opts.onUnavailable?.();
        } catch {
          // a failing listener must not break the game
        }
      }
    }
    return ok;
  };
  return {
    schedule(w) {
      pending = w;
      if (handle !== null) timers.clear(handle);
      handle = timers.set(save, delay);
    },
    flush() {
      if (handle !== null) timers.clear(handle);
      return save();
    },
    cancel() {
      if (handle !== null) timers.clear(handle);
      handle = null;
      pending = null;
    },
    get failed() {
      return failed;
    },
  };
}
