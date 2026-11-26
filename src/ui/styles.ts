// The house-style flyout (design section 7, "House style"). Owner: Interface.
//
// Hovering the House button (a long press on touch, ↑ from the keyboard)
// opens a small card above it: a dice tile for Random, then one tile per
// style, each a tiny drawing of that house in the selected wall colour.
// Choosing a tile picks that style (and the House piece) and closes the card;
// so does leaving it. It never covers the held-length stepper: if it would,
// it rises above it.

import { t } from '@/i18n';
import { HOUSE_STYLES, RANDOM_STYLE } from '@/style/houses';
import { el } from './dom';
import { styleIcon } from './icons';

/** How long the mouse may be away (crossing the gap between button and card) before the card closes. */
const LEAVE_MS = 260;
/** A hover must rest this long before the card opens, so sweeping across the tray does not flash it. */
const HOVER_MS = 120;
/** Touch: a press this long opens the card (the same as a long press on the town). */
const LONG_PRESS_MS = 450;
/** Touch: a finger that moves this far is scrolling the tray, not pressing. */
const SLOP_PX = 10;

export interface StyleFlyout {
  readonly el: HTMLElement;
  readonly isOpen: boolean;
  /** Wires a (new) House button: hover, long press and keyboard open the card from it. */
  attach(button: HTMLElement): void;
  /** Redraws the tiles: the chosen style, and the wall colour (a palette index) each style is drawn in. */
  render(style: number, wallIndex: (style: number) => number): void;
  open(focus?: boolean): void;
  close(): boolean;
  dispose(): void;
}

export interface StyleFlyoutHost {
  /** The tray element the card is placed in (its containing block). */
  tray: HTMLElement;
  /** Elements the card must not cover when they are showing (the length stepper). */
  avoid(): readonly HTMLElement[];
  choose(style: number): void;
}

export function styleName(style: number): string {
  const name = style === RANDOM_STYLE ? undefined : HOUSE_STYLES[style - 1]?.name;
  return name ? t(name) : t('Random');
}

export function createStyleFlyout(host: StyleFlyoutHost): StyleFlyout {
  const root = el('div', {
    class: 'lc-pop lc-styles',
    attrs: { role: 'menu', 'aria-label': t('House style'), 'data-ui': 'styles', hidden: '' },
  });
  let button: HTMLElement | null = null;
  let current = RANDOM_STYLE;
  let leaveTimer: ReturnType<typeof setTimeout> | null = null;
  let hoverTimer: ReturnType<typeof setTimeout> | null = null;
  let pressTimer: ReturnType<typeof setTimeout> | null = null;
  let pressAt: { x: number; y: number } | null = null;
  /** A long press opened the card: the click that ends that press must not also select. */
  let swallowClick = false;
  const offs: (() => void)[] = [];

  const clear = (t: ReturnType<typeof setTimeout> | null): null => {
    if (t !== null) clearTimeout(t);
    return null;
  };
  const tiles = (): HTMLButtonElement[] => [...root.querySelectorAll<HTMLButtonElement>('button')];

  const place = (): void => {
    if (!button) return;
    const tray = host.tray.getBoundingClientRect();
    const b = button.getBoundingClientRect();
    root.style.left = '0px';
    root.style.bottom = '0px';
    const w = root.offsetWidth;
    const left = Math.max(0, Math.min(tray.width - w, b.left + b.width / 2 - w / 2 - tray.left));
    root.style.left = `${Math.round(left)}px`;
    // Above the button, clear of the drawer tabs' tops.
    let bottom = tray.bottom - b.top + 8;
    root.style.bottom = `${Math.round(bottom)}px`;
    const me = root.getBoundingClientRect();
    for (const other of host.avoid()) {
      if (other.hidden || other.offsetParent === null) continue;
      const o = other.getBoundingClientRect();
      const overlaps = me.left < o.right && me.right > o.left && me.top < o.bottom && me.bottom > o.top;
      if (overlaps) bottom = Math.max(bottom, tray.bottom - o.top + 6);
    }
    root.style.bottom = `${Math.round(bottom)}px`;
  };

  const api: StyleFlyout = {
    el: root,
    get isOpen() {
      return !root.hasAttribute('hidden');
    },
    attach(next) {
      button = next;
      next.setAttribute('aria-haspopup', 'menu');
      next.setAttribute('aria-expanded', String(api.isOpen));
      next.addEventListener('pointerenter', (e) => {
        if (e.pointerType !== 'mouse') return;
        leaveTimer = clear(leaveTimer);
        if (!api.isOpen) hoverTimer = setTimeout(() => api.open(), HOVER_MS);
      });
      next.addEventListener('pointerleave', (e) => {
        hoverTimer = clear(hoverTimer);
        if (e.pointerType === 'mouse' && api.isOpen) leaveTimer = setTimeout(() => api.close(), LEAVE_MS);
        if (e.pointerType !== 'mouse') pressTimer = clear(pressTimer);
      });
      next.addEventListener('pointerdown', (e) => {
        if (e.pointerType === 'mouse') return;
        swallowClick = false;
        pressAt = { x: e.clientX, y: e.clientY };
        pressTimer = clear(pressTimer);
        pressTimer = setTimeout(() => {
          pressTimer = null;
          swallowClick = true;
          navigator.vibrate?.(10);
          api.open();
        }, LONG_PRESS_MS);
      });
      next.addEventListener('pointermove', (e) => {
        if (pressTimer !== null && pressAt && Math.hypot(e.clientX - pressAt.x, e.clientY - pressAt.y) > SLOP_PX) pressTimer = clear(pressTimer);
      });
      const endPress = (): void => {
        pressTimer = clear(pressTimer);
      };
      next.addEventListener('pointerup', endPress);
      next.addEventListener('pointercancel', endPress);
      next.addEventListener('contextmenu', (e) => e.preventDefault());
      // The tray's own click handler (select House) was added first: stop it from the capture phase.
      next.addEventListener(
        'click',
        (e) => {
          if (!swallowClick) return;
          swallowClick = false;
          e.stopImmediatePropagation();
          e.preventDefault();
        },
        { capture: true },
      );
      next.addEventListener('keydown', (e) => {
        if (e.key === 'ArrowUp') {
          e.preventDefault();
          api.open(true);
        }
      });
    },
    render(style, wallIndex) {
      current = style;
      const focused = root.contains(document.activeElement) ? (document.activeElement as HTMLElement).dataset.style : undefined;
      root.replaceChildren(
        ...[RANDOM_STYLE, ...HOUSE_STYLES.map((_, i) => i + 1)].map((n) =>
          el(
            'button',
            {
              class: 'lc-btn lc-style',
              title: n === RANDOM_STYLE ? t('Random: every house different') : t('{style}: {hint}', { style: styleName(n), hint: t(HOUSE_STYLES[n - 1]!.hint) }),
              attrs: {
                type: 'button',
                role: 'menuitemradio',
                'aria-checked': String(n === style),
                'aria-label': t('House style: {style}', { style: styleName(n) }),
                'data-style': String(n),
              },
              on: { click: () => host.choose(n) },
            },
            [el('span', { class: 'lc-btn-icon', html: styleIcon(n, wallIndex(n)) }), el('span', { class: 'lc-btn-label', text: styleName(n) })],
          ),
        ),
      );
      if (focused !== undefined) root.querySelector<HTMLElement>(`[data-style="${focused}"]`)?.focus();
    },
    open(focus = false) {
      leaveTimer = clear(leaveTimer);
      if (!api.isOpen) {
        root.removeAttribute('hidden');
        button?.setAttribute('aria-expanded', 'true');
      }
      place();
      if (focus) (root.querySelector<HTMLElement>(`[data-style="${current}"]`) ?? tiles()[0])?.focus();
    },
    close() {
      hoverTimer = clear(hoverTimer);
      leaveTimer = clear(leaveTimer);
      if (!api.isOpen) return false;
      const hadFocus = root.contains(document.activeElement);
      root.setAttribute('hidden', '');
      button?.setAttribute('aria-expanded', 'false');
      if (hadFocus) button?.focus();
      return true;
    },
    dispose() {
      api.close();
      for (const off of offs) off();
    },
  };

  root.addEventListener('pointerenter', (e) => {
    if (e.pointerType === 'mouse') leaveTimer = clear(leaveTimer);
  });
  root.addEventListener('pointerleave', (e) => {
    if (e.pointerType === 'mouse') leaveTimer = setTimeout(() => api.close(), LEAVE_MS);
  });
  root.addEventListener('keydown', (e) => {
    const list = tiles();
    const at = list.indexOf(document.activeElement as HTMLButtonElement);
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown' || e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
      e.preventDefault();
      const step = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : -1;
      list[(at + step + list.length) % list.length]?.focus();
    } else if (e.key === 'Home' || e.key === 'End') {
      e.preventDefault();
      list[e.key === 'Home' ? 0 : list.length - 1]?.focus();
    } else if (e.key === 'Escape') {
      e.stopPropagation();
      api.close();
    }
  });
  root.addEventListener('focusout', (e) => {
    const to = e.relatedTarget as Node | null;
    if (to && (root.contains(to) || to === button)) return;
    if (to) api.close();
  });
  // A tap or click anywhere else closes it (on touch nothing else would).
  const outside = (e: PointerEvent): void => {
    if (!api.isOpen) return;
    const t = e.target as Node;
    if (root.contains(t) || button?.contains(t)) return;
    api.close();
  };
  document.addEventListener('pointerdown', outside, { capture: true });
  offs.push(() => document.removeEventListener('pointerdown', outside, { capture: true }));
  const onResize = (): void => {
    if (api.isOpen) place();
  };
  window.addEventListener('resize', onResize);
  offs.push(() => window.removeEventListener('resize', onResize));
  return api;
}
