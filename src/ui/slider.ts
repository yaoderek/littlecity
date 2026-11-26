// One slider for the time of day, the season and the weather (design section 7, "Time, season and
// weather sliders"). Owner: Seasons, for the Interface.
//
// A button opens a small card beside it: a hand-drawn track with labelled stops, each with its little
// picture, and a thumb. Drag to scrub (the town follows the thumb live), let go and it settles on the
// nearest stop (the town eases there); click a stop to go straight to it; arrows, Home and End step;
// Escape or a click anywhere else closes it. On a phone the card is a strip across the screen with a
// 44 px thumb.
//
//   const s = createSlider({ name: 'time', label: 'Time of day', stops, position, scrub, choose });
//   button.addEventListener('click', () => s.toggle(button));
//   // each frame: s.refresh()   (the thumb follows the town while it glides)

import { t } from '@/i18n';
import { el } from './dom';
import { icon } from './icons';
import './slider.css';

export interface SliderStop {
  id: string;
  label: string;
  /** An icon id from ./icons. */
  icon: string;
}

export interface SliderOptions {
  /** 'time', 'season', 'weather': the card's data-ui is `slider-<name>`. */
  name: string;
  label: string;
  stops: readonly SliderStop[];
  /** Where the town is now along the stops, 0 to stops.length − 1 (fractional between two). */
  position(): number;
  /** While dragging: the town follows. */
  scrub(position: number): void;
  /** Let go on, clicked or stepped to a stop. */
  choose(index: number): void;
}

export interface Slider {
  readonly el: HTMLElement;
  readonly isOpen: boolean;
  open(anchor: HTMLElement): void;
  close(): void;
  toggle(anchor: HTMLElement): void;
  /** Puts the thumb where the town is (call each frame while open; cheap when closed). */
  refresh(): void;
}

/** A pencil line along the track, a little uneven, with a tick under every stop. */
function trackSvg(n: number): string {
  let d = 'M2 10 Q25 8.6 50 10.2 T98 9.6';
  for (let i = 0; i < n; i++) {
    const x = 2 + (96 * i) / Math.max(1, n - 1);
    d += ` M${x.toFixed(1)} 5.6 L${(x + 0.2).toFixed(1)} 14.2`;
  }
  return `<svg class="lc-slider-line" viewBox="0 0 100 20" preserveAspectRatio="none" aria-hidden="true"><path d="${d}" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" vector-effect="non-scaling-stroke"/></svg>`;
}

export function createSlider(o: SliderOptions): Slider {
  const n = o.stops.length;
  const thumb = el('div', { class: 'lc-slider-thumb', attrs: { 'aria-hidden': 'true' } });
  const rail = el('div', { class: 'lc-slider-rail', html: trackSvg(n) }, [thumb]);
  const stops = o.stops.map((s, i) =>
    el('button', { class: 'lc-slider-stop', attrs: { type: 'button', tabindex: '-1', 'data-stop': s.id, 'aria-label': s.label, style: `left: ${(i / Math.max(1, n - 1)) * 100}%` }, on: { click: () => pick(i) } }, [
      el('span', { class: 'lc-slider-tick', html: icon(s.icon) }),
      el('span', { class: 'lc-slider-label', text: s.label }),
    ]),
  );
  const track = el(
    'div',
    {
      class: 'lc-slider-track',
      attrs: { role: 'slider', tabindex: '0', 'aria-label': o.label, 'aria-valuemin': '0', 'aria-valuemax': String(n - 1), style: `--lc-stops: ${n}` },
    },
    [rail, el('div', { class: 'lc-slider-stops' }, stops)],
  );
  const now = el('span', { class: 'lc-slider-now' });
  const card = el('div', { class: 'lc-card lc-slider', attrs: { 'data-ui': `slider-${o.name}`, hidden: '' } }, [el('div', { class: 'lc-slider-title', text: `${t('{label}:', { label: o.label })} ` }, [now]), track]);

  let anchor: HTMLElement | null = null;
  let dragging = false;
  let shown = -1;
  /** The stop last chosen while open: arrows step from it, though the town may still be easing there. */
  let chosen: number | null = null;

  const setThumb = (pos: number): void => {
    const p = Math.min(n - 1, Math.max(0, pos));
    if (Math.abs(p - shown) < 1e-3) return;
    shown = p;
    thumb.style.left = `${(p / Math.max(1, n - 1)) * 100}%`;
    const near = Math.round(p);
    track.setAttribute('aria-valuenow', String(near));
    track.setAttribute('aria-valuetext', o.stops[near]!.label);
    now.textContent = o.stops[near]!.label;
    stops.forEach((s, i) => s.classList.toggle('lc-on', i === near));
  };
  const posAt = (clientX: number): number => {
    const r = rail.getBoundingClientRect();
    return Math.min(n - 1, Math.max(0, ((clientX - r.left) / Math.max(1, r.width)) * (n - 1)));
  };
  const pick = (i: number): void => {
    const k = Math.min(n - 1, Math.max(0, i));
    chosen = k;
    card.classList.add('lc-settling');
    setThumb(k);
    o.choose(k);
  };

  rail.addEventListener('pointerdown', (e) => {
    dragging = true;
    card.classList.remove('lc-settling');
    rail.setPointerCapture(e.pointerId);
    const p = posAt(e.clientX);
    setThumb(p);
    o.scrub(p);
    e.preventDefault();
  });
  rail.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    const p = posAt(e.clientX);
    setThumb(p);
    o.scrub(p);
  });
  const release = (e: PointerEvent): void => {
    if (!dragging) return;
    dragging = false;
    pick(Math.round(posAt(e.clientX)));
  };
  rail.addEventListener('pointerup', release);
  rail.addEventListener('pointercancel', release);
  track.addEventListener('keydown', (e) => {
    const at = chosen ?? Math.round(o.position());
    const step: Record<string, number> = { ArrowRight: 1, ArrowUp: 1, ArrowLeft: -1, ArrowDown: -1 };
    if (e.key in step) pick(at + step[e.key]!);
    else if (e.key === 'Home') pick(0);
    else if (e.key === 'End') pick(n - 1);
    else if (e.key === 'Escape' || e.key === 'Enter') {
      api.close();
      anchor?.focus();
    } else return;
    e.preventDefault();
    e.stopPropagation();
  });
  const away = (e: PointerEvent): void => {
    const t = e.target as Node | null;
    if (t && (card.contains(t) || anchor?.contains(t))) return;
    api.close();
  };
  const escape = (e: KeyboardEvent): void => {
    if (e.key === 'Escape') api.close();
  };

  const api: Slider = {
    el: card,
    get isOpen() {
      return !card.hidden;
    },
    open(at) {
      anchor = at;
      card.hidden = false;
      at.setAttribute('aria-expanded', 'true');
      // Beside its button: under it, its right edge under the button's (phones: a strip, in CSS).
      const r = at.getBoundingClientRect();
      card.style.top = `${Math.round(r.bottom + 8)}px`;
      card.style.right = `${Math.max(8, Math.round(window.innerWidth - r.right - 40))}px`;
      shown = -1;
      chosen = null;
      card.classList.remove('lc-settling');
      api.refresh();
      document.addEventListener('pointerdown', away, true);
      document.addEventListener('keydown', escape);
      track.focus({ preventScroll: true });
    },
    close() {
      if (card.hidden) return;
      card.hidden = true;
      dragging = false;
      anchor?.setAttribute('aria-expanded', 'false');
      document.removeEventListener('pointerdown', away, true);
      document.removeEventListener('keydown', escape);
    },
    toggle(at) {
      if (api.isOpen) api.close();
      else api.open(at);
    },
    refresh() {
      if (card.hidden || dragging) return;
      // After a choice the thumb rests on its stop while the town eases there.
      setThumb(chosen ?? o.position());
    },
  };
  return api;
}
