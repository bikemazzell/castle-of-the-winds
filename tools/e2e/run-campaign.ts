import { mkdirSync, writeFileSync } from 'node:fs';
import { launchBrave, ensureVite, newPage } from './brave';
import { assertNoPageErrors, collectPageErrors, screenshot, runWith } from './helpers';

/**
 * E2E campaign acceptance run (plan Task 7.3 + CODE-QUALITY Task 10):
 * Phase A — UNEDITED progression: a stock character must reach dungeon level 2
 * with no editor help (bounds: ≤2 deaths) — this is the balance-relevant leg.
 * Phase B — ASSISTED full playthrough (editor-boosted stats/spells/gold):
 * town errands, Mine 1–8 → Fortress 9–11, defeat Hrungnir, assert the ending.
 * Labeled `assisted` in the report: a QUEST/TRANSITION test, not a balance
 * claim. Uses the sanctioned dev hooks (window.__cotw) for driving/dispatch.
 * Telemetry → docs/e2e/campaign-report.json. Exit 0/1 — `npm run e2e:campaign`.
 */

interface LevelStat {
  level: number;
  turnsAtArrival: number;
  steps: number;
  deaths: number;
}
interface UneditedReport {
  character: string;
  reachedLevel2: boolean;
  deaths: number;
  turns: number;
}
interface Report {
  seedName: string;
  assisted: boolean;
  editedStats: boolean;
  unedited: UneditedReport | null;
  levels: LevelStat[];
  bossAttempts: number;
  deaths: number;
  totalTurns: number;
  victory: boolean;
  balancingNotes: string[];
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

type CdpPage = import('puppeteer-core').Page;

/** Dismiss story cutscenes + level-up modals; return 'death' if the death dialog is up. */
async function housekeeping(page: CdpPage): Promise<'ok' | 'death' | 'victory-pending'> {
  for (let i = 0; i < 30; i++) {
    const state = await page.evaluate(() => {
      const story = document.querySelector<HTMLElement>('.story-overlay [data-action="continue"]');
      if (story) {
        story.click();
        return 'story';
      }
      if (document.querySelector('.story-overlay.victory')) return 'victory';
      const title = document.querySelector('.modal-overlay .dialog-title')?.textContent ?? '';
      if (/You are dead/.test(title)) return 'death';
      if (/level/i.test(title)) {
        document.querySelector<HTMLElement>('.modal-overlay [data-action="close"]')?.click();
        return 'modal';
      }
      return 'clear';
    });
    if (state === 'death') return 'death';
    if (state === 'victory') return 'victory-pending';
    if (state === 'clear') return 'ok';
    await sleep(40);
  }
  return 'ok';
}

interface WalkState {
  done: boolean;
  dead?: boolean;
  err?: string;
}

/** BFS step toward (tx,ty) using the debug walkability oracle; dispatches one MOVE. */
async function stepToward(page: CdpPage, tx: number, ty: number): Promise<WalkState> {
  return await page.evaluate(
    (tx: number, ty: number): WalkState => {
      const c = (window as unknown as {
        __cotw: {
          position: () => { x: number; y: number; level: number } | null;
          dispatch: (a: unknown) => void;
          walkable: (x: number, y: number) => boolean;
          levelSize: () => number;
        };
      }).__cotw;
      const pos = c.position();
      if (!pos) return { done: false, err: 'no position' };
      if (pos.x === tx && pos.y === ty) return { done: true };
      const size = c.levelSize();
      const start = pos.y * size + pos.x;
      const goal = ty * size + tx;
      const prev = new Int32Array(size * size).fill(-1);
      prev[start] = start;
      const queue = [start];
      while (queue.length > 0) {
        const cur = queue.shift()!;
        if (cur === goal) break;
        const cx = cur % size;
        const cy = (cur - cx) / size;
        const dirs: [number, number][] = [
          [1, 0],
          [-1, 0],
          [0, 1],
          [0, -1],
        ];
        for (const [dx, dy] of dirs) {
          const nx = cx + dx;
          const ny = cy + dy;
          if (nx < 0 || ny < 0 || nx >= size || ny >= size) continue;
          const ni = ny * size + nx;
          if (prev[ni] !== -1) continue;
          if (!c.walkable(nx, ny)) continue;
          prev[ni] = cur;
          queue.push(ni);
        }
      }
      if (prev[goal] === -1) return { done: false, err: 'unreachable' };
      let cur = goal;
      while (prev[cur] !== start && cur !== start) cur = prev[cur]!;
      const cx = cur % size;
      const cy = (cur - cx) / size;
      c.dispatch({ type: 'MOVE', dx: cx - pos.x, dy: cy - pos.y });
      return { done: false };
    },
    tx,
    ty,
  );
}

/** Current level via the debug hooks (used to detect auto-stair transitions). */
async function currentLevel(page: CdpPage): Promise<number> {
  return await page.evaluate(
    () =>
      (window as unknown as { __cotw: { position: () => { level: number } | null } }).__cotw.position()
        ?.level ?? -1,
  );
}

/** Walk to a tile; fight through monsters on the way (bump-attacks). */
async function walkTo(
  page: CdpPage,
  tx: number,
  ty: number,
  maxSteps = 400,
  heal?: { spellId: string; minHp: number },
): Promise<'arrived' | 'died' | 'unreachable' | 'capped'> {
  const startLevel = await currentLevel(page);
  for (let i = 0; i < maxSteps; i++) {
    const hk = await housekeeping(page);
    if (hk === 'death') return 'died';
    if (hk === 'victory-pending') return 'arrived'; // quest completed mid-walk
    if (heal) {
      // Suppress breath-capable threats from range first: heal-tanking a
      // dragon's 6d6 breath across a long walk is mathematically hopeless
      // (campaign 7.3 telemetry — repeated same-tile deaths on levels 7/10).
      const fire = await page.evaluate(() => {
        const c = (window as unknown as {
          __cotw: {
            position: () => { x: number; y: number } | null;
            entities: () => { x: number; y: number; name: string; hp: number }[];
            dispatch: (a: unknown) => void;
          };
        }).__cotw;
        const pos = c.position();
        if (!pos) return false;
        const dragon = c
          .entities()
          .filter((m) => /dragon/i.test(m.name))
          .map((m) => ({ m, d: Math.max(Math.abs(m.x - pos.x), Math.abs(m.y - pos.y)) }))
          .filter((e) => e.d >= 1 && e.d <= 6)
          .sort((a, b) => a.d - b.d)[0];
        if (!dragon) return false;
        c.dispatch({ type: 'CAST', spellId: 's527', target: { x: dragon.m.x, y: dragon.m.y } });
        return true;
      });
      if (fire) {
        const fireHk = await housekeeping(page);
        if (fireHk === 'death') return 'died';
        if (fireHk === 'victory-pending') return 'arrived';
        await sleep(25);
        continue;
      }
      // Self-heal when badly hurt (REST is unreliable mid-dungeon: nearby
      // monsters interrupt it — manual-accurate). Casting costs the turn.
      const hp = await page.evaluate(
        () => (window as unknown as { __cotw: { hp: () => number } }).__cotw.hp(),
      );
      if (hp < heal.minHp) {
        await page.evaluate(
          (id: string) => {
            (window as unknown as { __cotw: { dispatch: (a: unknown) => void } }).__cotw.dispatch({
              type: 'CAST',
              spellId: id,
            });
          },
          heal.spellId,
        );
        const healHk = await housekeeping(page);
        if (healHk === 'death') return 'died';
        if (healHk === 'victory-pending') return 'arrived';
        await sleep(25);
        continue;
      }
    }
    const st = await stepToward(page, tx, ty);
    if (st.done) return 'arrived';
    // Landing on a stair auto-descends/ascends mid-walk: the target coordinate
    // no longer applies (it belonged to the previous level) — treat as arrival.
    if ((await currentLevel(page)) !== startLevel) return 'arrived';
    if (st.err === 'unreachable') return 'unreachable';
    await sleep(25);
  }
  return 'capped';
}

/** Death recovery via the death dialog → Load → autosave. */
async function recoverFromDeath(page: CdpPage): Promise<boolean> {
  const deathText = await page.evaluate(
    () => document.querySelector('.modal-overlay')?.textContent ?? '',
  );
  const killedBy = deathText.match(/Killed by\s*([^\n•]+)/)?.[1]?.trim() ?? 'unknown';
  console.log(`campaign: killed by ${killedBy}`);
  if (process.env.CAMPAIGN_DEBUG) {
    const logTail = await page.evaluate(() => {
      const c = (window as unknown as { __cotw: { log: () => string[] } }).__cotw;
      return c.log().slice(-20);
    });
    console.log(`campaign: log tail >>> ${JSON.stringify(logTail)}`);
    const state = await page.evaluate(() => {
      const c = (window as unknown as {
        __cotw: { position: () => { x: number; y: number; level: number }; hp: () => number };
      }).__cotw;
      return { pos: c.position(), hp: c.hp() };
    });
    console.log(`campaign: state at death >>> ${JSON.stringify(state)}`);
  }
  const hasDeath = await page.evaluate(() =>
    /You are dead/.test(document.querySelector('.modal-overlay .dialog-title')?.textContent ?? ''));
  if (!hasDeath) return false;
  await page.evaluate(() => {
    document.querySelector<HTMLElement>('.modal-overlay [data-action="load"]')?.click();
  });
  await page.waitForSelector('.save-dialog [data-slot-id="auto"] [data-action="load"]');
  const enabled = await page.$eval(
    '.save-dialog [data-slot-id="auto"] [data-action="load"]',
    (el) => !(el as HTMLButtonElement).disabled,
  );
  if (!enabled) return false;
  await page.click('.save-dialog [data-slot-id="auto"] [data-action="load"]');
  await page.waitForFunction(() => !document.querySelector('.modal-overlay'));
  return true;
}

/** Dispatch with proof: story/level-up overlays can silently swallow
 * __cotw.dispatch (it no-ops while showingStory). This drains overlays
 * first, dispatches, then waits for the applied-action counter to move —
 * a loud timeout instead of a mysteriously-no-op'd REST/ASCEND/CAST
 * (campaign runs 18-20 regression). */
function makeDispatchChecked(page: CdpPage): (a: unknown) => Promise<void> {
  return async (a: unknown): Promise<void> => {
    const before = await page.evaluate(
      () => (window as unknown as { __cotw: { appliedCount: () => number } }).__cotw.appliedCount(),
    );
    for (let attempt = 0; attempt < 3; attempt++) {
      const hk = await housekeeping(page);
      if (hk === 'death') return; // caller's death recovery owns this state
      if (hk === 'victory-pending') return;
      await page.evaluate(
        (act: unknown) => (window as unknown as { __cotw: { dispatch: (x: unknown) => void } }).__cotw.dispatch(act),
        a,
      );
      try {
        await page.waitForFunction(
          (n: number) =>
            (window as unknown as { __cotw: { appliedCount: () => number } }).__cotw.appliedCount() > n,
          { timeout: 2000, polling: 50 },
          before,
        );
        return;
      } catch {
        // overlay may have opened between housekeeping and dispatch — retry
      }
    }
    throw new Error(`campaign: dispatch ${JSON.stringify(a)} was swallowed (appliedCount stuck at ${before})`);
  };
}

async function main(): Promise<number> {
  let exit = 0;
  const report: Report = {
    seedName: 'Champion',
    assisted: true,
    editedStats: true,
    unedited: null,
    levels: [],
    bossAttempts: 0,
    deaths: 0,
    totalTurns: 0,
    victory: false,
    balancingNotes: [],
  };
  const fail = (msg: string): void => {
    console.error(`FAIL: ${msg}`);
    exit = 1;
  };
  try {
    await runWith([], async (close) => {
      const brave = await launchBrave(console.error);
      close((): Promise<void> => brave.close());
      const vite = await ensureVite(console.error);
      close((): Promise<void> => vite.stop());
      const page = await newPage(brave.browser, vite.url);
    const { errors } = collectPageErrors(page);
    await page.setViewport({ width: 1280, height: 800 });
    // Per-call evaluate helpers: page.evaluate cannot carry functions back over
    // CDP (they serialize to undefined) — each hook call runs inside the page.
    const turnNow = (): Promise<number> =>
      page.evaluate(() => (window as unknown as { __cotw: { turn: () => number } }).__cotw.turn());
    const posNow = (): Promise<{ x: number; y: number; level: number } | null> =>
      page.evaluate(
        () =>
          (window as unknown as { __cotw: { position: () => { x: number; y: number; level: number } | null } })
            .__cotw.position(),
      );
    const hpNow = (): Promise<number> =>
      page.evaluate(() => (window as unknown as { __cotw: { hp: () => number } }).__cotw.hp());
    const manaNow = (): Promise<number> =>
      page.evaluate(() => (window as unknown as { __cotw: { mana: () => number } }).__cotw.mana());
    const isDeadNow = (): Promise<boolean> =>
      page.evaluate(() => (window as unknown as { __cotw: { isDead: () => boolean } }).__cotw.isDead());
    const stairDown = (): Promise<{ x: number; y: number } | null> =>
      page.evaluate(
        () =>
          (window as unknown as { __cotw: { stair: (k: 'down' | 'up') => { x: number; y: number } | null } })
            .__cotw.stair('down'),
      );
    const stairUp = (): Promise<{ x: number; y: number } | null> =>
      page.evaluate(
        () =>
          (window as unknown as { __cotw: { stair: (k: 'down' | 'up') => { x: number; y: number } | null } })
            .__cotw.stair('up'),
      );
    const bossInfo = (): Promise<{ x: number; y: number; name: string; hp: number } | null> =>
      page.evaluate(
        () =>
          (window as unknown as { __cotw: { boss: () => { x: number; y: number; name: string; hp: number } | null } })
            .__cotw.boss(),
      );

    const dispatchChecked = makeDispatchChecked(page);


    // --- Phase A (Task 10): UNEDITED progression — balance-relevant leg ---
    // A stock 50/50/50/50 intermediate character must reach dungeon level 2
    // with no editor help. Bounds: <= 2 deaths, generous turn cap.
    {
      const uDispatch = makeDispatchChecked(page);
      const uHp = hpNow;
      const uTurn = turnNow;
      await page.evaluate(() => localStorage.clear());
      await page.reload({ waitUntil: 'domcontentloaded' });
      await page.waitForSelector('[data-action="new-game"]');
      await page.click('[data-action="new-game"]');
      await page.waitForSelector('.modal-overlay [data-field="name"]');
      await page.type('.modal-overlay [data-field="name"]', 'Unedited');
      await page.click('.modal-overlay [data-action="begin"]');
      await page.waitForSelector('.story-overlay [data-action="continue"]');
      await housekeeping(page);
      await page.waitForFunction(() => !document.querySelector('.story-overlay'));

      let uDeaths = 0;
      let mineWalk: 'arrived' | 'died' | 'unreachable' | 'capped' = 'arrived';
      for (let attempt = 0; attempt < 3; attempt++) {
        if ((await uHp()) < 15) await uDispatch({ type: 'REST' });
        mineWalk = await walkTo(page, 15, 2, 400);
        if (mineWalk === 'died') {
          uDeaths++;
          const recovered = await recoverFromDeath(page);
          if (!recovered) break;
          continue;
        }
        break;
      }
      let reachedLevel2 = false;
      if (mineWalk === 'arrived') {
        await uDispatch({ type: 'DESCEND' }); // town mine stair -> dungeon level 1
        await sleep(300);
        if ((await currentLevel(page)) === 1) {
          // rest if hurt, then walk to the down stair and descend again
          for (let attempt = 0; attempt < 3; attempt++) {
            if ((await uHp()) < 15) await uDispatch({ type: 'REST' });
            const st = await stairDown();
            if (!st) break;
            const down = await walkTo(page, st.x, st.y, 400);
            if (down === 'died') {
              uDeaths++;
              const recovered = await recoverFromDeath(page);
              if (!recovered) break;
              continue;
            }
            break;
          }
          await uDispatch({ type: 'DESCEND' });
          await sleep(300);
          reachedLevel2 = (await currentLevel(page)) === 2;
        }
      }
      const uTurns = await uTurn();
      report.unedited = { character: 'Unedited', reachedLevel2, deaths: uDeaths, turns: uTurns };
      console.log(`campaign: unedited progression reachedLevel2=${reachedLevel2} deaths=${uDeaths} turns=${uTurns}`);
      if (!reachedLevel2) fail('unedited progression did not reach dungeon level 2 (balance leg)');
      if (uDeaths > 2) fail(`unedited progression deaths ${uDeaths} exceed the bound of 2`);
    }

    // --- Phase B: ASSISTED campaign (editor-boosted — quest/transition test,
    // explicitly NOT a balance claim; the unedited leg above covers balance) ---
    await page.evaluate(() => localStorage.clear());
    await page.reload({ waitUntil: 'domcontentloaded' });

    // --- New game "Champion" (assisted) ---
    console.log('campaign: assisted flow begins (editor-boosted — quest/transition test, NOT balance)');
    await page.waitForSelector('[data-action="new-game"]');
    await page.click('[data-action="new-game"]');
    await page.waitForSelector('.modal-overlay [data-field="name"]');
    await page.type('.modal-overlay [data-field="name"]', 'Champion');
    await page.click('.modal-overlay [data-action="begin"]');
    await page.waitForSelector('.story-overlay [data-action="continue"]');
    await housekeeping(page);
    await page.waitForFunction(() => !document.querySelector('.story-overlay'));

    // --- Editor pass: veteran champion (sanctioned setup for the acceptance run) ---
    await page.click('[data-action="pause"]');
    await page.waitForSelector('.modal-overlay .pause [data-pause-action="save"]');
    await page.click('.modal-overlay .pause [data-pause-action="save"]');
    await page.waitForSelector('.modal-overlay [data-action="edit-save"]');
    await page.click('.modal-overlay [data-action="edit-save"]');
    await page.waitForSelector('.modal-overlay [data-field="level"]');
    // NOTE: no named helper arrows inside page.evaluate — tsx's keepNames wraps
    // them in __name() calls that do not exist in the browser page context.
    await page.evaluate(() => {
      const fields: [string, string][] = [
        ['str', '90'],
        ['dex', '90'],
        ['con', '90'],
        ['level', '12'],
        ['gold', '20000'],
        ['spells', 's527, s512, s694'],
      ];
      for (const [field, value] of fields) {
        const el = document.querySelector<HTMLInputElement>(`.modal-overlay [data-field="${field}"]`);
        if (!el) throw new Error(`editor field missing: ${field}`);
        el.value = value;
        el.dispatchEvent(new Event('input', { bubbles: true }));
      }
    });
    await page.click('.modal-overlay [data-action="apply-edits"]');
    await page.waitForFunction(() => !document.querySelector('.modal-overlay'));
    const shopDoorList = (): Promise<{ shopId: string; x: number; y: number }[]> =>
      page.evaluate(
        () =>
          (window as unknown as { __cotw: { shopDoors: () => { shopId: string; x: number; y: number }[] } })
            .__cotw.shopDoors(),
      );
    if ((await hpNow()) < 50) fail('editor hot-swap did not raise hp pool');

    // --- Town errands: buy Long Sword (Bjorn) + Plate Mail (Sverting), equip ---
    const doors = await shopDoorList();
    // Phase 2 task 6: shop doors never auto-open — arriving on the door tile
    // needs an explicit own-cell tap. No-op if a dialog is already open.
    const openShopHere = (): Promise<boolean> =>
      page.evaluate(() => {
        if (document.querySelector('.modal-overlay')) return true;
        const c = (window as unknown as {
          __cotw: { position: () => { x: number; y: number } | null; travel: { tap: (cell: { x: number; y: number }, t?: string) => void } };
        }).__cotw;
        const pos = c.position();
        if (!pos) return false;
        c.travel.tap({ x: pos.x, y: pos.y }, 'touch');
        return !!document.querySelector('.modal-overlay');
      });
    const closeTopModal = async (): Promise<void> => {
      await page.waitForSelector('.modal-overlay [data-action="close"]', { timeout: 5000 });
      await page.evaluate(() => {
        const closeBtn = document.querySelector<HTMLElement>('.modal-overlay [data-action="close"]');
        closeBtn?.click();
      });
      await page.waitForFunction(() => !document.querySelector('.modal-overlay'), { timeout: 5000 }).catch(() => {});
    };
    const bjorn = doors.find((d) => d.shopId === 'bjorn')!;
    let r = await walkTo(page, bjorn.x, bjorn.y);
    if (r !== 'arrived') fail(`walk to bjorn: ${r}`);
    if (!(await openShopHere())) fail('bjorn merchant did not open');
    await page.waitForSelector('.modal-overlay .merchant-buy-list', { timeout: 5000 });
    const bought1 = await page.evaluate(() => {
      const row = document.querySelector<HTMLElement>(
        '.modal-overlay .merchant-buy-list .item-row[data-def-id="i-long-sword"] .item-row-button',
      );
      if (!row) return false;
      row.click(); // select
      const buy = document.querySelector<HTMLButtonElement>('.modal-overlay [data-field="primary-action"]');
      if (!buy || buy.disabled) return false;
      buy.click();
      return true;
    });
    if (!bought1) fail('long sword not purchasable at bjorn');
    await closeTopModal();
    const sverting = doors.find((d) => d.shopId === 'sverting')!;
    r = await walkTo(page, sverting.x, sverting.y);
    if (r !== 'arrived') fail(`walk to sverting: ${r}`);
    if (!(await openShopHere())) fail('sverting merchant did not open');
    const bought2 = await page.evaluate(() => {
      const row = document.querySelector<HTMLElement>(
        '.modal-overlay .merchant-buy-list .item-row[data-def-id="i-plate-mail"] .item-row-button',
      );
      if (!row) return false;
      row.click();
      const buy = document.querySelector<HTMLButtonElement>('.modal-overlay [data-field="primary-action"]');
      if (!buy || buy.disabled) return false;
      buy.click();
      return true;
    });
    if (!bought2) fail('plate mail not purchasable at sverting');
    await closeTopModal();
    // Equip both via the inventory panel: select the pack row, then the
    // single primary action button (Phase 5 panel layout).
    await page.keyboard.press('i');
    await page.waitForSelector('.modal-overlay .inventory-panel');
    const equipped = await page.evaluate(() => {
      let n = 0;
      for (const id of ['i-long-sword', 'i-plate-mail']) {
        const row = document.querySelector<HTMLElement>(
          `.modal-overlay .item-row[data-uid*="${id}"] .item-row-button`,
        );
        if (!row) continue;
        row.click(); // select
        const primary = document.querySelector<HTMLButtonElement>('.modal-overlay [data-field="primary-action"]');
        if (primary && !primary.disabled && (primary.textContent ?? '').match(/equip/i)) {
          primary.click();
          n++;
        }
      }
      return n;
    });
    if (equipped !== 2) fail(`equipped ${equipped}/2 purchased items`);
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => !document.querySelector('.modal-overlay'));
    await screenshot(page, 'docs/e2e/campaign-town.png');

    // --- Descend Mine 1–8 → Fortress 9–11 by walking to stairs ---
    const mine = { x: 15, y: 2 };
    r = await walkTo(page, mine.x, mine.y);
    if (r !== 'arrived') fail(`walk to mine entrance: ${r}`);
    await sleep(400);
    // Phase 2 task 6: stairs never auto-descend — confirm the transition.
    let level = (await posNow())!.level;
    if (level !== 1) {
      await dispatchChecked({ type: 'DESCEND' });
      await housekeeping(page);
      await sleep(400);
      level = (await posNow())!.level;
    }
    if (level !== 1) fail(`expected level 1 after mine entrance, got ${level}`);

    for (let target = 1; target <= 10; target++) {
      const stat: LevelStat = { level: target, turnsAtArrival: await turnNow(), steps: 0, deaths: 0 };
      // Heal up at arrival (rest interrupts are fine; try a few times).
      for (let i = 0; i < 4; i++) {
        if ((await hpNow()) >= 48) break;
        await dispatchChecked({ type: 'REST' });
        await housekeeping(page);
        await sleep(50);
      }
      const stair = await stairDown();
      if (!stair) {
        fail(`no down stair on level ${target}`);
        break;
      }
      const before = (await posNow())!;
      let res = await walkTo(page, stair.x, stair.y, 400, { spellId: 's512', minHp: 30 });
      stat.steps = Math.abs((await turnNow()) - stat.turnsAtArrival);
      // Death recovery: REST may be interrupted by nearby monsters, so top up
      // with heal spell spam (s512: 1 mana, +8 hp at L8) before retrying; cap
      // attempts so a genuinely unwinnable state fails loudly instead of looping.
      let deathsThisLevel = 0;
      while (res === 'died') {
        stat.deaths++;
        report.deaths++;
        deathsThisLevel++;
        console.log(`campaign: death #${report.deaths} on level ${target} (${(performance.now() / 1000).toFixed(0)}s)`);
        if (deathsThisLevel > 12) {
          fail(`level ${target}: died ${deathsThisLevel}× walking to the stairs`);
          break;
        }
        if (!(await recoverFromDeath(page))) {
          fail('could not recover from death (no autosave?)');
          break;
        }
        for (let i = 0; i < 4; i++) {
          if ((await hpNow()) >= 48) break;
          await dispatchChecked({ type: 'REST' });
          await housekeeping(page);
          await sleep(50);
        }
        for (let i = 0; i < 12 && (await hpNow()) < 40; i++) {
          await dispatchChecked({ type: 'CAST', spellId: 's512' });
          await housekeeping(page);
          await sleep(30);
        }
        res = await walkTo(page, stair.x, stair.y, 400, { spellId: 's512', minHp: 30 });
      }
      if (res !== 'arrived') {
        fail(`level ${target}: walk to stairs ${res}`);
        break;
      }
      await sleep(400); // auto-descend
      let now = (await posNow())!;
      if (now.level !== before.level + 1) {
        // Arrivals teleport the player onto the stair without a MOVE, so
        // auto-stairs never fires — descend explicitly.
        await dispatchChecked({ type: 'DESCEND' });
        await sleep(400);
        now = (await posNow())!;
      }
      if (now.level !== before.level + 1) {
        // maybe an unknown trap teleported us; retry from current position
        const retry = await stairDown();
        if (!retry || (await walkTo(page, retry.x, retry.y)) !== 'arrived') {
          fail(`level ${target}: did not descend (at ${now.level})`);
          break;
        }
        await sleep(400);
        await dispatchChecked({ type: 'DESCEND' });
        await sleep(400);
      }
      const after = (await posNow())!;
      level = after.level;
      report.levels.push(stat);
      console.log(
        `campaign: level ${stat.level} -> ${level} (turns ${stat.turnsAtArrival}→${await turnNow()}, deaths ${stat.deaths}, ${(performance.now() / 1000).toFixed(0)}s)`,
      );

      // Story interlude: the vengeance quest's homecoming stage needs a town
      // visit after the mine. Ascend to level 3 (levels 1-3 have no up stair),
      // Rune of Return home, rest, then dive back to the mine bottom.
      if (level === 8) {
        console.log('campaign: homecoming — ascending + Rune of Return to town');
        let ascOk = true;
        // Walk-to-up-stair + ASCEND, tolerant of auto-stairs firing mid-walk
        // (the final MOVE onto 0x13 ascends automatically) vs. already
        // standing on the stair (walk is a no-op, explicit ASCEND needed).
        for (let lv = 8; lv > 3 && ascOk; ) {
          const cl = await currentLevel(page);
          if (cl !== lv) { fail(`homecoming: expected level ${lv}, at ${cl}`); ascOk = false; break; }
          const up = await stairUp();
          if (!up) { fail(`homecoming: no up stair on level ${lv}`); ascOk = false; break; }
          let w = await walkTo(page, up.x, up.y, 400, { spellId: 's512', minHp: 30 });
          let tries = 0;
          while (w === 'died' && tries++ < 3) {
            if (!(await recoverFromDeath(page))) { fail('homecoming: death unrecoverable'); break; }
            for (let i = 0; i < 4 && (await hpNow()) < 48; i++) {
              await dispatchChecked({ type: 'REST' });
              await housekeeping(page);
            }
            w = await walkTo(page, up.x, up.y, 400, { spellId: 's512', minHp: 30 });
          }
          if (w !== 'arrived') { fail(`homecoming: walk ${w} on level ${lv}`); ascOk = false; break; }
          await sleep(300);
          await housekeeping(page);
          await sleep(100);
          let cl2 = await currentLevel(page);
          if (cl2 === lv) {
            // still here — walk ended on the stair without auto-ascending
            await dispatchChecked({ type: 'ASCEND' });
            await housekeeping(page);
            await sleep(300);
            cl2 = await currentLevel(page);
          }
          if (cl2 !== lv - 1) {
            const dbg = await page.evaluate(() => {
              const c = (window as unknown as {
                __cotw: {
                  position: () => { x: number; y: number; level: number } | null;
                  stair: (d: string) => { x: number; y: number } | null;
                  log: () => string[];
                  dispatch: (a: unknown) => void;
                  walkable: (x: number, y: number) => boolean;
                };
              }).__cotw;
              const pos = c.position();
              const log = c.log();
              return { pos, up: c.stair('up'), lastLog: log.slice(-8) };
            });
            console.log('campaign: no-ascent dump >>>', JSON.stringify(dbg));
            fail(`homecoming: no ascent from level ${lv} (at ${cl2})`);
            ascOk = false;
            break;
          }
          lv = cl2;
        }
        if (!ascOk) break;
        if ((await currentLevel(page)) !== 3) { fail('homecoming: not on level 3'); break; }
        await dispatchChecked({ type: 'CAST', spellId: 's694' });
        await sleep(150);
        for (let i = 0; i < 6; i++) {
          await housekeeping(page); // homecoming cutscenes
          await sleep(80);
        }
        if ((await currentLevel(page)) !== 0) { fail('homecoming: rune did not return to town'); break; }
        for (let i = 0; i < 3; i++) {
          await dispatchChecked({ type: 'REST' });
          await housekeeping(page);
          await sleep(50);
        }
        const mineWalk = await walkTo(page, 15, 2, 400);
        if (mineWalk !== 'arrived') { fail(`homecoming: mine walk ${mineWalk}`); break; }
        await sleep(400);
        // No auto-stairs anymore (UI plan Phase 2): stepping onto the mine
        // stair stops there — descend explicitly.
        if ((await currentLevel(page)) === 0) {
          await dispatchChecked({ type: 'DESCEND' });
          await housekeeping(page);
          await sleep(400);
        }
        if ((await currentLevel(page)) !== 1) { fail('homecoming: no descent into the mine'); break; }
        for (let d = 1; d <= 7; d++) {
          const sd = await stairDown();
          if (!sd) { fail(`homecoming: no down stair on level ${d}`); break; }
          const w2 = await walkTo(page, sd.x, sd.y, 400, { spellId: 's512', minHp: 30 });
          if (w2 !== 'arrived') { fail(`homecoming: re-descent walk ${w2} on ${d}`); break; }
          await sleep(400);
          if ((await currentLevel(page)) === d) {
            await dispatchChecked({ type: 'DESCEND' });
            await sleep(400);
          }
          if ((await currentLevel(page)) !== d + 1) { fail(`homecoming: no descent at ${d}`); break; }
        }
        if ((await currentLevel(page)) !== 8) { fail('homecoming: not back at level 8'); break; }
        console.log(`campaign: homecoming complete — back at the mine bottom (turns ${await turnNow()})`);
      }
    }
    if (level !== 11) fail(`did not reach the Fortress bottom (level ${level})`);

    // --- Boss: Hrungnir, The Hill Giant Lord (level 11) ---
    for (let attempt = 1; level === 11 && attempt <= 8; attempt++) {
      report.bossAttempts = attempt;
      console.log(`campaign: boss attempt ${attempt}`);
      // Refill pools unconditionally: REST is rest-until-recovered (no-op when
      // full), and refilled mana makes each attempt diverge instead of
      // replaying the previous death deterministically.
      await dispatchChecked({ type: 'REST' });
      await housekeeping(page);
      await sleep(50);
      // heal to full first
      for (let i = 0; i < 4; i++) {
        if ((await hpNow()) >= 48) break;
        await dispatchChecked({ type: 'REST' });
        await housekeeping(page);
        await sleep(50);
      }
      const boss = await bossInfo();
      if (!boss) {
        // boss dead already (e.g. spell killed during approach)
        break;
      }
      if (process.env.CAMPAIGN_DEBUG) {
        const dbg = await posNow();
        const vitals = await page.evaluate(() => {
          const c = (window as unknown as { __cotw: { hp: () => number; mana: () => number } }).__cotw;
          return { hp: c.hp(), mana: c.mana() };
        });
        console.log(
          `campaign: dbg attempt ${attempt} boss=${JSON.stringify(boss)} pos=${JSON.stringify(dbg)} vitals=${JSON.stringify(vitals)}`,
        );
      }
      // Ranged-attrition fight (runs 10-13 telemetry): melee-grinding escorts
      // while the boss crosses the room wastes ~100 turns and loses the heal
      // race. Instead: fireball EVERYTHING from range — escorts die in a few
      // casts (statue 30hp ≈ 4, wights ≈ 3 each, ogres ≈ 5 each ≈ 20 mana),
      // then solo-dance Hrungnir: its 25%×19.5 ≈ 4.9/turn incoming loses to
      // +8 heals, so fireball/heal alternation wins by attrition (~17 hits +
      // ~17 heals ≈ 34 mana, fits 64). Attempt divergence: WAIT (attempt−1)
      // turns shifts the RNG stream so death-reloads don't replay identically
      // (loads restore the arrival autosave: boss back at full).
      const healThresh = Math.min(30 + attempt * 5, 60);
      for (let w = 0; w < attempt - 1; w++) {
        await dispatchChecked({ type: 'WAIT' });
        await housekeeping(page);
      }
      let action = 0;
      let diedInCombat = false;
      let stalled = 0;
      while (action++ < 500) {
        const turnBefore = await turnNow();
        const b = await bossInfo();
        if (!b || b.hp <= 0) break;
        const mana = await manaNow();
        const hp = await hpNow();
        if (hp < healThresh && mana >= 1) {
          await dispatchChecked({ type: 'CAST', spellId: 's512' });
          const hk = await housekeeping(page);
          if (hk === 'death') { diedInCombat = true; break; }
          await sleep(25);
          continue;
        }
        const pos = (await posNow())!;
        const bossDist = Math.max(Math.abs(pos.x - b.x), Math.abs(pos.y - b.y));
        if (bossDist <= 1 && mana >= 1) {
          await dispatchChecked({ type: 'CAST', spellId: 's527', target: { x: b.x, y: b.y } });
        } else if (bossDist <= 8 && mana >= 2) {
          // Engagement phase — nuke the nearest escort in range. Melee escorts
          // in the approach corridor are what turned earlier fights into 3v1s.
          const escort = await page.evaluate(
            (bossName: string, px: number, py: number) => {
              const c = (window as unknown as {
                __cotw: { entities: () => { x: number; y: number; name: string }[] };
              }).__cotw;
              return c
                .entities()
                .filter((m) => m.name !== bossName)
                .map((m) => ({ m, d: Math.max(Math.abs(m.x - px), Math.abs(m.y - py)) }))
                .filter((e) => e.d >= 1 && e.d <= 6)
                .sort((a, b2) => a.d - b2.d)[0];
            },
            b.name, pos.x, pos.y,
          );
          if (escort) {
            await dispatchChecked({ type: 'CAST', spellId: 's527', target: { x: escort.m.x, y: escort.m.y } });
          } else {
            const st = await stepToward(page, b.x, b.y);
            if (st.err === 'unreachable') break;
          }
        } else {
          // Far from the boss (or dry): walk in — bump attacks fight through
          // whatever blocks the corridor.
          const st = await stepToward(page, b.x, b.y);
          if (st.err === 'unreachable') break;
        }
        const hk = await housekeeping(page);
        if (hk === 'death') { diedInCombat = true; break; }
        if (hk === 'victory-pending') break;
        // Turn-stall detector: rejected actions (e.g. out of mana) consume no
        // turn — bail this attempt instead of spinning to the action cap.
        if ((await turnNow()) === turnBefore) {
          if (++stalled > 6) break;
        } else {
          stalled = 0;
        }
        await sleep(25);
      }
      if (process.env.CAMPAIGN_DEBUG) {
        console.log(`campaign: dbg attempt ${attempt} done actions=${action} boss=${JSON.stringify(await bossInfo())}`);
      }
      if (diedInCombat || (await isDeadNow())) {
        report.deaths++;
        console.log(`campaign: death #${report.deaths} in boss combat (${(performance.now() / 1000).toFixed(0)}s)`);
        if (!(await recoverFromDeath(page))) { fail('boss death unrecoverable'); break; }
        continue;
      }
      const bossGone = (await bossInfo()) === null;
      if (bossGone) break;
    }
    if ((await bossInfo()) !== null) fail('boss not defeated after all attempts');

    // --- Ending: cutscenes drain into the victory overlay ---
    await sleep(400);
    for (let i = 0; i < 30; i++) {
      const hk = await housekeeping(page);
      if (hk === 'victory-pending') break;
      await sleep(100);
    }
    const victoryText = await page.evaluate(
      () => document.querySelector('.story-overlay.victory')?.textContent ?? '',
    );
    report.victory = victoryText.includes('Here ends Part One');
    if (!report.victory) fail(`victory screen missing (got: "${victoryText.slice(0, 80)}")`);
    else await screenshot(page, 'docs/e2e/campaign-victory.png');
    report.totalTurns = await turnNow();

    // Telemetry + balancing notes.
    if (report.deaths === 0) report.balancingNotes.push('zero deaths across the full campaign — combat is on the forgiving side');
    if (report.bossAttempts > 4) report.balancingNotes.push(`boss needed ${report.bossAttempts} attempts — boss spike may be too sharp`);
    report.balancingNotes.push('item Armor Value → d20 AC divisor 4 (tuned this task; see APPROXIMATIONS.md #39)');
    mkdirSync('docs/e2e', { recursive: true });
    writeFileSync('docs/e2e/campaign-report.json', `${JSON.stringify(report, null, 2)}\n`);
    console.log(`campaign report: ${JSON.stringify(report, null, 2)}`);

    assertNoPageErrors(errors);
    console.log(`campaign: ${exit === 0 ? 'PASS' : 'FAIL'} (victory=${report.victory}, deaths=${report.deaths}, bossAttempts=${report.bossAttempts}, turns=${report.totalTurns})`);
    });
  } catch (err) {
    console.error('campaign FAILED:', err);
    exit = 1;
  }
  return exit;
}

void main().then((code) => process.exit(code));
