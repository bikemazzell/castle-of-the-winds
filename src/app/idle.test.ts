import { expect, it } from 'vitest';
import { createIdleActions } from './idle';
it('waits after input, alternates due actions, and never catches up in bursts', () => {
  const idle = createIdleActions();
  idle.activity(0);
  const prefs = { idleRestSeconds: 5, idleSearchSeconds: 5 };
  expect(idle.tick(4999, prefs, false, true)).toBeNull();
  expect(idle.tick(5000, prefs, false, true)).toBe('REST');
  expect(idle.tick(5001, prefs, false, true)).toBeNull();
  expect(idle.tick(10000, prefs, false, true)).toBe('SEARCH');
  idle.activity(11000);
  expect(idle.tick(14000, prefs, false, true)).toBeNull();
});
it('resets the delay while blocked and does not rest at full health', () => {
  const idle = createIdleActions();
  expect(idle.tick(9000, { idleSearchSeconds: 5 }, true, false)).toBeNull();
  expect(idle.tick(10000, { idleSearchSeconds: 5 }, false, false)).toBeNull();
  expect(idle.tick(15000, { idleRestSeconds: 5 }, false, false)).toBeNull();
  expect(idle.tick(15000, {}, false, true)).toBeNull();
});
