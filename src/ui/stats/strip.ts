// The strip at the top right: how many live here, a face for how they feel, and one silly count.
// Plain DOM, three chips in one card; it never takes a tap. (The numbers come from watch.ts.)

import { el } from '@/ui/dom';
import type { StatsView } from './watch';
import './stats.css';

const svg = (body: string) =>
  `<svg class="lc-stat-icon" viewBox="0 0 48 48" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" ` +
  `stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><g filter="url(#lc-wobble)">${body}</g></svg>`;

const PEOPLE = svg(
  '<circle cx="17" cy="16" r="6"/><path d="M6 40c0-9 5-14 11-14s11 5 11 14"/>' +
    '<circle cx="34" cy="19" r="5"/><path d="M30 28c6-2 12 2 12 12"/>',
);

const HEAD = '<circle cx="24" cy="24" r="18"/><circle cx="17.5" cy="20" r="1.4" fill="currentColor"/><circle cx="30.5" cy="20" r="1.4" fill="currentColor"/>';
/** Five faces, happiest first: grin, smile, flat, frown, wail. */
const FACES = [
  svg(HEAD + '<path d="M14 28c3 8 17 8 20 0z"/>'),
  svg(HEAD + '<path d="M16 30c4 4 12 4 16 0"/>'),
  svg(HEAD + '<path d="M17 32h14"/>'),
  svg(HEAD + '<path d="M16 35c4-4 12-4 16 0"/>'),
  svg(HEAD + '<path d="M13 15l8 3M35 15l-8 3"/><path d="M15 36c3-8 15-8 18 0z"/>'),
];
const face = (mood: number) => FACES[mood >= 80 ? 0 : mood >= 60 ? 1 : mood >= 40 ? 2 : mood >= 20 ? 3 : 4]!;

export function createStatsStrip(root: HTMLElement) {
  const people = el('span', { class: 'lc-stat-n' });
  const mood = el('span', { class: 'lc-stat-n' });
  const moodIcon = el('span', { class: 'lc-stat-glyph' });
  const label = el('span', { class: 'lc-stat-label' });
  const count = el('span', { class: 'lc-stat-n' });
  const silly = el('span', { class: 'lc-stat lc-stat-silly', attrs: { hidden: '' } }, [label, count]);
  const sr = (text: string) => el('span', { class: 'lc-stat-sr', text });
  const strip = el('div', { class: 'lc-stats lc-card' }, [
    el('span', { class: 'lc-stat' }, [el('span', { class: 'lc-stat-glyph', html: PEOPLE }), sr('Residents '), people]),
    el('span', { class: 'lc-stat' }, [moodIcon, sr('Happiness '), mood, sr(' of 100')]),
    silly,
  ]);
  root.append(strip);

  let band = -1;
  let shown: string | null = null;
  let fade = 0;
  let latest = '';
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');

  return {
    hide(hidden: boolean): void {
      strip.hidden = hidden;
    },
    show(v: StatsView): void {
      people.textContent = v.population === null ? '—' : v.population.toLocaleString();
      const b = FACES.indexOf(face(v.mood));
      if (b !== band) {
        band = b;
        moodIcon.innerHTML = FACES[b]!;
      }
      mood.textContent = String(v.mood);

      if (!v.silly) {
        silly.hidden = true;
        shown = null;
        return;
      }
      latest = v.silly.n.toLocaleString();
      if (v.silly.label === shown) {
        // Same label: the number is live, unless the label is mid-fade (the swap then sets it).
        if (!silly.classList.contains('lc-stat-out')) count.textContent = latest;
        return;
      }
      const swap = () => {
        label.textContent = v.silly!.label;
        count.textContent = latest;
        silly.classList.remove('lc-stat-out');
      };
      shown = v.silly.label;
      clearTimeout(fade);
      if (silly.hidden || reduced.matches) swap();
      else {
        silly.classList.add('lc-stat-out');
        fade = window.setTimeout(swap, 220);
      }
      silly.hidden = false;
    },
  };
}
