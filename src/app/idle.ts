/** Wall-clock pacing for optional idle actions. Never replay missed ticks. */
export function createIdleActions() {
  let lastActivity = 0, lastRest = 0, lastSearch = 0, lastAutomatic = 0;
  const activity = (now: number): void => {
    lastActivity = lastRest = lastSearch = lastAutomatic = now;
  };
  return {
    activity,
    tick(now: number, prefs: { idleRestSeconds?: number; idleSearchSeconds?: number }, blocked: boolean, needsRest: boolean): 'REST' | 'SEARCH' | null {
      if (blocked) { activity(now); return null; }
      const rest = (prefs.idleRestSeconds ?? 0) * 1000;
      const search = (prefs.idleSearchSeconds ?? 0) * 1000;
      const delays = [rest, search].filter(delay => delay > 0);
      if (!delays.length || now - Math.max(lastActivity, lastAutomatic) < Math.min(...delays)) return null;
      const restDue = rest > 0 && needsRest && now - lastRest >= rest;
      const searchDue = search > 0 && now - lastSearch >= search;
      if (!restDue && !searchDue) return null;
      const action = restDue && (!searchDue || lastRest <= lastSearch) ? 'REST' : 'SEARCH';
      if (action === 'REST') lastRest = now;
      else lastSearch = now;
      lastAutomatic = now;
      return action;
    },
  };
}
