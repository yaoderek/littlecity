// The guide (design section 7, "The guide"): a little field guide to the
// special buildings, each with a picture of its recipe town, its name and
// one plain sentence on how to get it. Owner: Interface (the entries and
// their proofs are src/guide/).
//
// Desktop: a page on the right of the screen; the town stays playable
// beside it. Phone: a full-height sheet that slides up and is swiped down to
// close. A small tick marks every entry the current town already holds.
// Keeping the ticks right is cheap: the town's roles are gathered once per
// change, and only while the guide is open.

import { ENTRIES, GROUPS, type GuideEntry } from '@/guide/entries';
import { mischiefGuideSection } from './mischief';
import { contentsOf, holds, propsOf, type TownContents } from '@/guide/proof';
import { track } from '@/app/analytics';
import { t } from '@/i18n';
import type { DressingPlan, ShapePlan } from '@/resolve/plan';
import { el, iconButton } from './dom';
import { icon } from './icons';
import './guide.css';

/** A swipe down this far (CSS px) on the phone sheet closes it; a short flick closes it too. */
const SWIPE_CLOSE_PX = 90;
const FLICK_PX_PER_MS = 0.6;

export interface GuideHost {
  /** The town as shown now. */
  shape(): ShapePlan;
}

export interface Guide {
  /** The book button (it goes under the menu button). */
  readonly button: HTMLButtonElement;
  /** The panel. */
  readonly el: HTMLElement;
  readonly isOpen: boolean;
  open(): void;
  close(): boolean;
  toggle(): void;
  /** The town changed: the ticks follow (worked out now if the guide is open, else when it opens). */
  townChanged(): void;
  /** The newest dressing: the ticks of the entries that are dressing (lamps, laundry, parks) follow. */
  dressed(dressing: DressingPlan): void;
  /** The ids of the entries ticked now (browser tests, the console). */
  found(): string[];
  dispose(): void;
}

/** Where an entry's picture is, under the site's base path (the game is published under /littlecity/). */
export function pictureUrl(id: string): string {
  return `${import.meta.env.BASE_URL}guide/${id}.webp`;
}

export function createGuide(host: GuideHost): Guide {
  const button = iconButton('guide', t('Guide to special buildings'), {
    class: 'lc-round',
    title: t('Guide: special buildings and how to get them'),
    attrs: { 'aria-expanded': 'false', 'aria-controls': 'lc-guide', 'data-ui': 'guide-button' },
  });
  const close = iconButton('close', t('Close the guide'), { class: 'lc-guide-close', attrs: { 'data-ui': 'guide-close' } });
  const scroller = el('div', { class: 'lc-guide-pages', attrs: { tabindex: '0', 'aria-label': t('Special buildings') } });
  const panel = el(
    'aside',
    { class: 'lc-guide', attrs: { id: 'lc-guide', role: 'dialog', 'aria-modal': 'false', 'aria-labelledby': 'lc-guide-title', hidden: '', 'data-ui': 'guide' } },
    [
      el('div', { class: 'lc-guide-grip', attrs: { 'aria-hidden': 'true' } }),
      el('header', { class: 'lc-guide-head' }, [
        el('div', { class: 'lc-guide-titles' }, [
          el('h2', { text: t('Field guide'), attrs: { id: 'lc-guide-title' } }),
          el('p', { text: t('Special buildings and the things your town does, and how to get them') }),
        ]),
        close,
      ]),
      scroller,
    ],
  );

  // ── the pages ───────────────────────────────────────────────────────────
  const cards = new Map<string, { entry: GuideEntry; card: HTMLElement }>();
  const counts = new Map<string, HTMLElement>();
  const tick = icon('tick');
  for (const group of GROUPS) {
    const entries = ENTRIES.filter((e) => e.group === group.id);
    if (entries.length === 0) continue;
    const list = el('ul', { class: 'lc-guide-list' });
    for (const entry of entries) {
      const card = el('li', { class: 'lc-guide-entry', attrs: { 'data-entry': entry.id } }, [
        el('img', {
          class: 'lc-guide-picture',
          attrs: { src: pictureUrl(entry.id), alt: '', loading: 'lazy', decoding: 'async', width: '180', height: '135', draggable: 'false' },
        }),
        el('div', { class: 'lc-guide-words' }, [
          el('h4', {}, [
            el('span', { text: t(entry.name) }),
            entry.group === 'auto' ? null : el('span', { class: 'lc-guide-tick', html: tick, title: t('In your town'), attrs: { 'aria-label': t('in your town') } }),
          ]),
          entry.when ? el('p', { class: 'lc-guide-when', text: t(entry.when) }) : null,
          el('p', { text: t(entry.how) }),
        ]),
      ]);
      cards.set(entry.id, { entry, card });
      list.append(card);
    }
    const count = el('span', { class: 'lc-guide-count' });
    if (group.id !== 'auto') counts.set(group.id, count);
    scroller.append(
      el('section', { class: `lc-guide-group lc-guide-${group.id}`, attrs: { 'data-group': group.id } }, [
        group.id === 'auto' ? null : el('h3', {}, [el('span', { text: t(group.title) }), count]),
        list,
      ]),
    );
  }

  // Mischief (design section 13b): what each of its tools does.
  scroller.append(mischiefGuideSection());

  // ── the ticks ───────────────────────────────────────────────────────────
  let town: TownContents | null = null;
  let props: ReadonlySet<string> | null = null;
  let shownShape: ShapePlan | null = null;
  const found = new Set<string>();

  const refresh = (): void => {
    const shape = host.shape();
    if (shape !== shownShape || !town) {
      shownShape = shape;
      town = { ...contentsOf(shape, null), props };
    } else town = { ...town, props };
    found.clear();
    for (const { entry, card } of cards.values()) {
      if (entry.group === 'auto') continue;
      const has = holds(entry.proof, town);
      // A dressing entry keeps its tick until the new dressing says otherwise.
      const on = has ?? card.hasAttribute('data-found');
      card.toggleAttribute('data-found', on);
      if (on) found.add(entry.id);
    }
    for (const [group, count] of counts) {
      const all = ENTRIES.filter((e) => e.group === group);
      const got = all.filter((e) => found.has(e.id)).length;
      count.textContent = got ? t('{got} of {all}', { got, all: all.length }) : '';
    }
  };
  let stale = true;

  // ── open and close ──────────────────────────────────────────────────────
  let scrollTop = 0;
  const api: Guide = {
    button,
    el: panel,
    get isOpen() {
      return !panel.hasAttribute('hidden');
    },
    open() {
      if (api.isOpen) return;
      track('guide_opened');
      panel.removeAttribute('hidden');
      panel.parentElement?.classList.add('lc-guide-open');
      panel.style.translate = '';
      button.setAttribute('aria-expanded', 'true');
      scroller.scrollTop = scrollTop;
      if (stale) {
        stale = false;
        refresh();
      }
      scroller.focus({ preventScroll: true });
    },
    close() {
      if (!api.isOpen) return false;
      scrollTop = scroller.scrollTop;
      const hadFocus = panel.contains(document.activeElement);
      panel.setAttribute('hidden', '');
      panel.parentElement?.classList.remove('lc-guide-open');
      button.setAttribute('aria-expanded', 'false');
      if (hadFocus) button.focus({ preventScroll: true });
      return true;
    },
    toggle() {
      if (!api.close()) api.open();
    },
    townChanged() {
      stale = true;
      if (api.isOpen) {
        stale = false;
        refresh();
      }
    },
    dressed(dressing) {
      props = propsOf(dressing);
      api.townChanged();
    },
    found: () => {
      if (stale) {
        stale = false;
        refresh();
      }
      return [...found];
    },
    dispose() {
      panel.remove();
      button.remove();
    },
  };
  button.addEventListener('click', () => api.toggle());
  close.addEventListener('click', () => api.close());
  panel.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    e.stopPropagation();
    api.close();
  });

  // ── phone: swipe the sheet down to close it ─────────────────────────────
  let swipe: { y: number; t: number; dy: number; fromTop: boolean } | null = null;
  const sheet = (): boolean => getComputedStyle(panel).getPropertyValue('--lc-guide-sheet').trim() === '1';
  panel.addEventListener(
    'touchstart',
    (e) => {
      if (e.touches.length !== 1 || !sheet()) return;
      const head = !scroller.contains(e.target as Node);
      swipe = { y: e.touches[0]!.clientY, t: e.timeStamp, dy: 0, fromTop: head || scroller.scrollTop <= 0 };
    },
    { passive: true },
  );
  panel.addEventListener(
    'touchmove',
    (e) => {
      if (!swipe || !swipe.fromTop) return;
      const dy = e.touches[0]!.clientY - swipe.y;
      if (dy <= 0 && swipe.dy === 0) {
        // Scrolling the pages up: not a swipe.
        swipe = null;
        return;
      }
      swipe.dy = Math.max(0, dy);
      panel.style.translate = `0 ${swipe.dy}px`;
      panel.classList.add('lc-guide-dragging');
      if (e.cancelable) e.preventDefault();
    },
    { passive: false },
  );
  const endSwipe = (e: TouchEvent): void => {
    if (!swipe) return;
    const { dy, t } = swipe;
    swipe = null;
    panel.classList.remove('lc-guide-dragging');
    if (dy > SWIPE_CLOSE_PX || (dy > 24 && dy / Math.max(1, e.timeStamp - t) > FLICK_PX_PER_MS)) api.close();
    panel.style.translate = '';
  };
  panel.addEventListener('touchend', endSwipe);
  panel.addEventListener('touchcancel', endSwipe);

  return api;
}
