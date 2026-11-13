// @vitest-environment jsdom
import { afterEach, expect, it } from 'vitest';
import { ownFocus } from './focus';

afterEach(async () => {
  document.body.replaceChildren();
  await Promise.resolve();
});

it('wraps within a full-screen view and preserves existing inert content', () => {
  const background = document.createElement('main');
  background.setAttribute('inert', '');
  const view = document.createElement('section');
  view.innerHTML = '<p tabindex="0">Story</p><button>Continue</button><button>Skip</button>';
  document.body.append(background, view);
  const first = view.querySelector<HTMLElement>('p')!;
  const last = view.querySelector<HTMLButtonElement>('button:last-child')!;
  const release = ownFocus(view, view.querySelector<HTMLButtonElement>('button')!);
  last.focus();
  last.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }));
  expect(document.activeElement).toBe(first);
  first.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true, cancelable: true }));
  expect(document.activeElement).toBe(last);
  release();
  expect(background.hasAttribute('inert')).toBe(true);
});

it('marks newly mounted background controls inert while a scope is active', async () => {
  const view = document.createElement('section');
  view.innerHTML = '<button>Continue</button>';
  document.body.append(view);
  const release = ownFocus(view);
  const added = document.createElement('button');
  document.body.append(added);
  await Promise.resolve();
  expect(added.hasAttribute('inert')).toBe(true);
  release();
  expect(added.hasAttribute('inert')).toBe(false);
});
