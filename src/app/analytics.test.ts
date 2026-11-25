import type { CaptureResult } from 'posthog-js';
import { describe, expect, it } from 'vitest';
import { chip, scrub, tally, track } from './analytics';

describe('analytics', () => {
  it('cuts a share link town out of every URL it sends', () => {
    const event = {
      uuid: 'x',
      event: '$pageview',
      properties: { $current_url: 'https://littlecity.io/#t=AbCdEf', $pathname: '/', seconds: 30 },
      $set_once: { $initial_current_url: 'https://littlecity.io/?a=1#t=AbCdEf' },
    } as unknown as CaptureResult;
    const out = scrub(event)!;
    expect(out.properties.$current_url).toBe('https://littlecity.io/');
    expect(out.properties.seconds).toBe(30);
    expect(out.$set_once!.$initial_current_url).toBe('https://littlecity.io/?a=1');
  });

  it('does nothing until it is started', () => {
    expect(() => {
      track('town_opened', { how: 'new' });
      tally('uses');
    }).not.toThrow();
  });

  it('knows the chip in what a browser says of its graphics', () => {
    expect(chip('ANGLE (Intel, Intel(R) UHD Graphics 620 Direct3D11 vs_5_0 ps_5_0, D3D11)')).toBe('Intel(R) UHD Graphics 620');
    expect(chip('ANGLE (Intel, Intel(R) UHD Graphics 620 (0x00003EA0) Direct3D11 vs_5_0 ps_5_0, D3D11)')).toBe('Intel(R) UHD Graphics 620');
    expect(chip('ANGLE (Apple, ANGLE Metal Renderer: Apple M1, Unspecified Version)')).toBe('Apple M1');
    expect(chip('Mali-G52')).toBe('Mali-G52');
    expect(chip('')).toBe('');
  });
});
