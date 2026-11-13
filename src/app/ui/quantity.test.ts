// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { quantityControl } from './quantity';

describe('quantity control', () => {
  it('rejects empty, fractional, and out-of-range entries and recovers with a step', () => {
    const change = vi.fn();
    const { el, input } = quantityControl({ field: 'test', max: 4, onChange: change });
    for (const value of ['', '0', '-1', '1.5', '5']) {
      input.value = value; input.dispatchEvent(new Event('input'));
      expect(change.mock.lastCall?.[1]).toBe(false);
      expect(input.getAttribute('aria-invalid')).toBe('true');
    }
    input.value = ''; input.dispatchEvent(new Event('input'));
    el.querySelector<HTMLButtonElement>('[data-action="quantity-plus"]')!.click();
    expect(input.value).toBe('1');
    expect(change.mock.lastCall).toEqual([1, true]);
    expect(el.querySelector<HTMLButtonElement>('[data-action="quantity-minus"]')!.disabled).toBe(true);
  });
});
