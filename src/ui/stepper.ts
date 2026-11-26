// The held-length stepper (design section 7, "Held length"): a small − n +
// beside the tray, shown only while a piece with a length is selected. It
// does what scrolling over the island does, and it is the only way on touch.
// Owner: Interface.

import { t } from '@/i18n';
import { el, iconButton } from './dom';
import { MAX_LENGTH } from './length';

export interface Stepper {
  readonly el: HTMLElement;
  /** Shows the length, or hides the stepper when the selected piece has none. `max` is the longest it goes. */
  show(length: number | null, max?: number, label?: 'Length' | 'Brush'): void;
  /** A small note above the stepper saying what it (and scrolling) does, or null to take it away. */
  hint(text: string | null): void;
}

export function createStepper(change: (by: number) => void): Stepper {
  const less = iconButton('less', t('Shorter'), { class: 'lc-step', attrs: { 'data-ui': 'length-less' }, on: { click: () => change(-1) } });
  const more = iconButton('more', t('Longer'), { class: 'lc-step', attrs: { 'data-ui': 'length-more' }, on: { click: () => change(1) } });
  const value = el('output', { class: 'lc-length-value', attrs: { 'data-ui': 'length-value', 'aria-live': 'polite' } });
  // The note is not a control: clicks pass through it to the town.
  const note = el('div', { class: 'lc-card lc-step-hint', attrs: { 'data-ui': 'length-hint', role: 'note', hidden: '' } });
  const root = el(
    'div',
    { class: 'lc-card lc-stepper', title: t('Length: scroll over the island, or press − and +'), attrs: { role: 'group', 'aria-label': t('Length'), 'data-ui': 'length', hidden: '' } },
    [less, value, more, note],
  );
  return {
    el: root,
    show(length, max = MAX_LENGTH, label = 'Length') {
      root.toggleAttribute('hidden', length === null);
      if (length === null) return;
      value.textContent = String(length);
      const brush = label === 'Brush';
      value.setAttribute('aria-label', brush ? t('Brush {n}', { n: length }) : t('Length {n}', { n: length }));
      root.setAttribute('aria-label', brush ? t('Brush') : t('Length'));
      root.title = brush ? t('Brush: scroll over the island, or press − and +') : t('Length: scroll over the island, or press − and +');
      less.setAttribute('aria-label', brush ? t('Narrower') : t('Shorter'));
      more.setAttribute('aria-label', brush ? t('Wider') : t('Longer'));
      less.disabled = length <= 1;
      more.disabled = length >= max;
    },
    hint(text) {
      note.toggleAttribute('hidden', text === null);
      if (text !== null) note.textContent = text;
    },
  };
}
