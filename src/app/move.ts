// Moving in (move.html): Little City lived at https://yaoderek.github.io/littlecity/ until
// 2026-11-21 and lives at https://littlecity.io/ since. A browser keeps each site's storage apart,
// so the old address forwards through a small page (tools/bridge/index.html) that packs up that
// browser's towns and settings and hands them here, where they are filed before the game opens.
// Owner: Interface.
//
// Two ways in:
//   move.html#<parcel>   the usual: the parcel rides in the fragment, which never reaches a server.
//                        Once it is filed this page goes back to the old address with ?moved=<print>,
//                        so the old page knows it arrived (and does not send it again) before it
//                        forwards into the game: a parcel that never arrives (littlecity.io out of reach)
//                        is sent again on the next visit.
//   move.html?opener     a parcel too big for a URL: the old page opened this one in a window and
//                        posts the parcel once it hears 'lc-move-ready'
//
// The rule is the keeper's (towns.ts): nothing the player built is ever written over. Nothing here
// is replaced, ever: an incoming town is added under its id when that id is free, and a different
// version of a town already here is added beside it under a new id (a duplicate is better than a
// loss). The town that opens next visit is taken only if this browser has none here yet (under a
// new id if its own is taken by a different version, so the keeper's start-up filing cannot write
// over that one), and otherwise filed in My towns as a town of its own. Identical towns are not
// added twice. Settings are copied only where this site has none.

import { LANG_KEY, loadLanguage, pickLang, t } from '@/i18n';
import { SAVE_KEY } from '@/world/save';
import { browserLibrary, type TownEntry } from './library';
import { ID_KEY, PREVIOUS_KEY } from './towns';

export const OLD_ORIGIN = 'https://yaoderek.github.io';

/** What the old page sends. `open` is the search and fragment the old link had (a shared town's #t=...). */
export interface Parcel {
  v: 1;
  local: Record<string, string>;
  towns: TownEntry[];
  open: string;
  /** The old page's fingerprint of what it sent: handed back to it once the parcel is filed. */
  print?: string;
}

/** The fragment form: 'z.' + base64url(gzip(JSON)), or 'j.' + base64url(JSON) where gzip is missing. */
export async function readParcel(text: string): Promise<Parcel> {
  const kind = text.slice(0, 2);
  const bytes = fromBase64Url(text.slice(2));
  let json: string;
  if (kind === 'z.') json = await new Response(new Blob([bytes as BlobPart]).stream().pipeThrough(new DecompressionStream('gzip'))).text();
  else if (kind === 'j.') json = new TextDecoder().decode(bytes);
  else throw new Error('not a parcel');
  const p = JSON.parse(json) as Parcel;
  if (p?.v !== 1 || typeof p.local !== 'object' || !Array.isArray(p.towns)) throw new Error('not a parcel');
  return p;
}

function fromBase64Url(s: string): Uint8Array {
  const b = atob(s.replace(/-/g, '+').replace(/_/g, '/'));
  const out = new Uint8Array(b.length);
  for (let i = 0; i < b.length; i++) out[i] = b.charCodeAt(i);
  return out;
}

const isEntry = (e: unknown): e is TownEntry =>
  !!e && typeof (e as TownEntry).id === 'string' && typeof (e as TownEntry).code === 'string' && typeof (e as TownEntry).name === 'string';

/** Files a parcel in this site's storage. Returns how many towns were added. */
export async function moveIn(p: Parcel, storage: Storage | null): Promise<number> {
  const { library } = await browserLibrary(storage);
  const have = new Map((await library.all()).filter(isEntry).map((e) => [e.id, e]));
  const codes = new Set([...have.values()].map((e) => e.code));
  let moved = 0;
  const put = async (e: TownEntry): Promise<void> => {
    await library.put(e);
    have.set(e.id, e);
    codes.add(e.code);
    moved++;
  };
  for (const town of p.towns) {
    if (!isEntry(town) || codes.has(town.code)) continue;
    // A different version of a town already here: beside it, named so the two can be told apart.
    await put(have.has(town.id) ? { ...town, id: crypto.randomUUID(), name: t('{name} (from the old address)', { name: town.name }), named: true } : town);
  }
  /** A town that has no place here: kept in My towns under a new name, unless an identical one is there. */
  const fileAside = async (code: string): Promise<void> => {
    if (codes.has(code)) return;
    let n = have.size;
    for (const e of have.values()) {
      const m = /^Town (\d+)$/.exec(e.name);
      if (m) n = Math.max(n, Number(m[1]));
    }
    const now = Date.now();
    await put({ id: crypto.randomUUID(), code, name: `Town ${n + 1}`, created: now, updated: now });
  };

  const get = (k: string): string | null => storage?.getItem(k) ?? null;
  const set = (k: string, v: string): void => storage?.setItem(k, v);
  for (const [k, v] of Object.entries(p.local)) {
    if (typeof v !== 'string' || k === SAVE_KEY || k === ID_KEY || k === PREVIOUS_KEY) continue;
    if (get(k) === null) set(k, v);
  }
  const saved = p.local[SAVE_KEY];
  if (saved) {
    if (get(SAVE_KEY) === null) {
      let id = p.local[ID_KEY];
      const known = id ? have.get(id) : undefined;
      if (known && known.code !== saved) id = crypto.randomUUID();
      set(SAVE_KEY, saved);
      if (id !== undefined) set(ID_KEY, id);
      moved++;
    } else if (get(SAVE_KEY) !== saved) await fileAside(saved);
  }
  const previous = p.local[PREVIOUS_KEY];
  if (previous) {
    if (get(PREVIOUS_KEY) === null) set(PREVIOUS_KEY, previous);
    else {
      try {
        const prev = JSON.parse(previous) as { code?: unknown };
        if (typeof prev.code === 'string') await fileAside(prev.code);
      } catch {
        // unreadable: the old site still has it
      }
    }
  }
  return moved;
}

function storage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

/** Into the game, with whatever the old link was opening (a shared town). Only a search and a fragment are carried. */
function enter(open: string): void {
  const safe = /^(\?[^#]*)?(#.*)?$/.test(open) ? open : '';
  location.replace('/' + safe);
}

async function main(): Promise<void> {
  // The player's language, as the game picks it (main.ts); English if it cannot be had.
  await loadLanguage(pickLang({ param: new URLSearchParams(location.search).get('lang'), chosen: storage()?.getItem(LANG_KEY), browser: navigator.languages ?? [navigator.language] }));
  const say = document.getElementById('say');
  const fail = (): void => {
    if (!say) return;
    // The link goes where the line says {link}.
    const [before = '', after = ''] = t('Your towns could not be moved here. They are safe at the old address: {link}.').split('{link}');
    say.textContent = before;
    const a = document.createElement('a');
    a.href = `${OLD_ORIGIN}/littlecity/?again`;
    a.textContent = t('try again');
    say.append(a, after);
  };
  if (location.search.includes('opener') && window.opener) {
    window.addEventListener('message', (e: MessageEvent) => {
      if (e.origin !== OLD_ORIGIN || (e.data as { type?: string })?.type !== 'lc-move') return;
      const parcel = (e.data as { parcel: Parcel }).parcel;
      moveIn(parcel, storage())
        .then(() => {
          // The old page goes on into the game; this window was only the way in.
          (window.opener as Window | null)?.postMessage({ type: 'lc-move-done' }, OLD_ORIGIN);
          window.close();
          setTimeout(() => enter(parcel.open), 300);
        })
        .catch(fail);
    });
    (window.opener as Window).postMessage({ type: 'lc-move-ready' }, OLD_ORIGIN);
    return;
  }
  const text = location.hash.slice(1);
  if (!text) return enter('');
  // The parcel leaves the address bar (and the history) before anything else.
  history.replaceState(null, '', location.pathname);
  try {
    const parcel = await readParcel(text);
    await moveIn(parcel, storage());
    if (parcel.print) location.replace(`${OLD_ORIGIN}/littlecity/?moved=${encodeURIComponent(parcel.print)}&open=${encodeURIComponent(parcel.open)}`);
    else enter(parcel.open);
  } catch {
    fail();
  }
}

if (typeof document !== 'undefined' && document.getElementById('say')) void main();
