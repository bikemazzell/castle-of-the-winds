// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { createActionPalette } from './action-palette';
afterEach(()=>{document.body.replaceChildren();});
it('offers labeled icons for each one-click action and remains open after repeated use',()=>{
  const onAction=vi.fn(),palette=createActionPalette({onAction});document.body.append(palette.el);
  expect(palette.isOpen()).toBe(false);palette.show();
  const ids=['wait','search','rest','fire','interact','disarm','journal'];
  expect([...palette.el.querySelectorAll<HTMLButtonElement>('[data-action]')].map(b=>b.dataset.action)).toEqual(ids);
  for(const id of ids){
    const button=palette.el.querySelector<HTMLButtonElement>(`[data-action="${id}"]`)!;
    expect(button.getAttribute('aria-label')).toBeTruthy();expect(button.textContent.trim()).not.toBe('');
    expect(button.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true');
    button.click();expect(onAction).toHaveBeenLastCalledWith(id);expect(palette.isOpen()).toBe(true);
  }
  palette.el.querySelector<HTMLButtonElement>('[data-action="wait"]')!.click();
  expect(onAction).toHaveBeenCalledTimes(8);expect(palette.isOpen()).toBe(true);
});
it('toggles and closes explicitly, reporting changes without making the map modal',()=>{
  const palette=createActionPalette({onAction:vi.fn()}),outside=document.createElement('button');
  document.body.append(outside,palette.el);outside.focus();const changed=vi.fn();palette.el.addEventListener('toggle',changed);
  palette.toggle();expect(palette.isOpen()).toBe(true);expect(document.activeElement).toBe(outside);
  expect(palette.el.getAttribute('aria-modal')).toBeNull();expect(palette.el.getAttribute('role')).not.toBe('dialog');
  const tab=new KeyboardEvent('keydown',{key:'Tab',bubbles:true,cancelable:true});palette.el.dispatchEvent(tab);expect(tab.defaultPrevented).toBe(false);
  palette.show();expect(changed).toHaveBeenCalledTimes(1);
  palette.el.querySelector<HTMLButtonElement>('[data-palette-close]')!.click();
  expect(palette.isOpen()).toBe(false);expect(changed).toHaveBeenCalledTimes(2);
  palette.toggle();palette.hide();expect(changed).toHaveBeenCalledTimes(4);
});
it('releases handlers on destroy and ignores hidden actions',()=>{
  const onAction=vi.fn(),palette=createActionPalette({onAction});document.body.append(palette.el);
  const wait=palette.el.querySelector<HTMLButtonElement>('[data-action="wait"]')!;wait.click();expect(onAction).not.toHaveBeenCalled();
  palette.show();palette.destroy();wait.click();expect(onAction).not.toHaveBeenCalled();expect(palette.el.isConnected).toBe(false);
});
