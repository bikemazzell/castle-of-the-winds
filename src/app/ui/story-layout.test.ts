// @vitest-environment jsdom
import { expect, it } from 'vitest';
import { showStoryTexts } from './story';

it('reflows legacy lines but preserves paragraphs and resets the next page scroll', () => {
  const overlay = showStoryTexts(document.body, ['A line\r\ncontinued.\r\n\r\nAnother paragraph.', 'Next.'], {gender: 'female'});
  const text = overlay.querySelector<HTMLElement>('.story-text')!;
  expect(text.textContent).toBe('A line continued.\n\nAnother paragraph.');
  text.scrollTop = 100;
  overlay.querySelector<HTMLButtonElement>('button')!.click();
  expect(text.scrollTop).toBe(0);
  overlay.remove();
});
