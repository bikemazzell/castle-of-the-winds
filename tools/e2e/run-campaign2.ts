// Part-2 campaign acceptance run (PART2-PLAN Task P8).
//
// Phase A — UNEDITED progression leg (balance-relevant): a stock 50/50/50/50
// intermediate character starts a Part-2 game, walks the North Road to the
// castle stair, descends explicitly, and must reach castle level 2 with at
// most 2 deaths. Mirrors the Part-1 campaign's Phase A.
//
// Phase B — ASSISTED leg (labeled; quest/transition test, NOT a balance
// claim): the editor builds a veteran and refills health/mana as reported
// (level 20, STR/CON 90, DEX/INT 100, gold,
// lightning bolt / fireball / heal / rune of return — slug ids), teleports to
// castle level 24, descends for real into 25 (surtur-gate), kills Surtur with
// lightning (asserting the fire-immunity shrug and the lightning
// vulnerability lines from the log), then Rune-of-Returns home for the
// [24,25,26] homecoming drain and the victory screen.
//
// Lessons baked in (from the Part-1 campaign work):
// - __cotw.dispatch no-ops while story overlays are up — every dispatch goes
//   through dispatchChecked, which drains overlays and waits for the
//   applied-action counter to move (loud failure instead of silent no-op).
// - page.evaluate cannot carry functions back over CDP — per-call helpers.
// - No named function consts inside page.evaluate callbacks (tsx keepNames
//   wraps them in __name() which does not exist in the page).
// - Story/level-up overlays drain via housekeeping before every step.

import { writeFileSync } from 'node:fs';
import { launchBrave, ensureVite, newPage } from './brave';
import { collectPageErrors, runWith } from './helpers';

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

type CdpPage = import('puppeteer-core').Page;

interface Report {
  part: 2;
  assisted: boolean;
  editedStats: boolean;
  resourceRefills: number;
  seed: number;
  victory: boolean;
  fireShrugSeen: boolean;
  lightningTearsSeen: boolean;
  deaths: number;
  bossAttempts: number;
  totalTurns: number;
  unedited: { character: string; reachedLevel2: boolean; deaths: number; turns: number } | null;
}

/** Dismiss story cutscenes + level-up modals; detect death / victory states. */
async function housekeeping(page: CdpPage): Promise<'ok' | 'death' | 'victory-pending'> {
  for (let i = 0; i < 40; i++) {
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

/** BFS one-step-toward using the walkability oracle; dispatches one MOVE. */
async function stepToward(page: CdpPage, tx: number, ty: number): Promise<WalkState> {
  return await page.evaluate(
    (tx: number, ty: number): WalkState => {
      const c = (window as unknown as {
        __cotw: {
          position: () => { x: number; y: number; level: number } | null;
          dispatch: (a: unknown) => void;
          walkable: (x: number, y: number, avoidNpcs?: boolean) => boolean;
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
          if (!c.walkable(nx, ny, true)) continue;
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

async function currentLevel(page: CdpPage): Promise<number> {
  return await page.evaluate(
    () =>
      (window as unknown as { __cotw: { position: () => { level: number } | null } }).__cotw.position()
        ?.level ?? -1,
  );
}

/** Walk to a tile; optional combat support (self-heal + dragon suppression). */
async function walkTo(
  page: CdpPage,
  tx: number,
  ty: number,
  maxSteps = 400,
  heal?: { healSpellId: string; nukeSpellId: string; minHp: number },
): Promise<'arrived' | 'died' | 'unreachable' | 'capped'> {
  const startLevel = await currentLevel(page);
  for (let i = 0; i < maxSteps; i++) {
    const hk = await housekeeping(page);
    if (hk === 'death') return 'died';
    if (hk === 'victory-pending') return 'arrived';
    if (heal) {
      // Suppress breath-capable threats from range first (Part-1 campaign
      // telemetry: heal-tanking a dragon's 6d6 breath is hopeless).
      const fire = await page.evaluate(
        (nukeId: string) => {
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
            .filter((m) => /dragon|devil/i.test(m.name))
            .map((m) => ({ m, d: Math.max(Math.abs(m.x - pos.x), Math.abs(m.y - pos.y)) }))
            .filter((e) => e.d >= 1 && e.d <= 6)
            .sort((a, b) => a.d - b.d)[0];
          if (!dragon) return false;
          c.dispatch({ type: 'CAST', spellId: nukeId, target: { x: dragon.m.x, y: dragon.m.y } });
          return true;
        },
        heal.nukeSpellId,
      );
      if (fire) {
        const fireHk = await housekeeping(page);
        if (fireHk === 'death') return 'died';
        if (fireHk === 'victory-pending') return 'arrived';
        await sleep(25);
        continue;
      }
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
          heal.healSpellId,
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
    if ((await currentLevel(page)) !== startLevel) return 'arrived';
    if (st.err === 'unreachable') return 'unreachable';
    await sleep(25);
  }
  return 'capped';
}

/** Death recovery: death dialog → Load → this part's autosave. */
async function recoverFromDeath(page: CdpPage): Promise<boolean> {
  if (process.env.CAMPAIGN_DEBUG) {
    const logTail = await page.evaluate(() => {
      const c = (window as unknown as { __cotw: { log: () => string[] } }).__cotw;
      return c.log().slice(-16);
    });
    console.log(`campaign2: log tail >>> ${JSON.stringify(logTail)}`);
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

/** Dispatch with proof (see run-campaign.ts — appliedCount waits). */
function makeDispatchChecked(page: CdpPage): (a: unknown) => Promise<void> {
  return async (a: unknown): Promise<void> => {
    const before = await page.evaluate(
      () => (window as unknown as { __cotw: { appliedCount: () => number } }).__cotw.appliedCount(),
    );
    for (let attempt = 0; attempt < 3; attempt++) {
      const hk = await housekeeping(page);
      if (hk === 'death') return;
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
    throw new Error(`campaign2: dispatch ${JSON.stringify(a)} was swallowed (appliedCount stuck at ${before})`);
  };
}

/** Start a fresh part-2 game through the real title/wizard UI. */
async function beginPart2Game(page: CdpPage, name: string): Promise<void> {
  await page.waitForSelector('[data-part="2"]');
  await page.click('[data-part="2"]');
  await page.waitForSelector('[data-action="new-game"]');
  await page.click('[data-action="new-game"]');
  await page.waitForSelector('.modal-overlay [data-field="name"]');
  await page.type('.modal-overlay [data-field="name"]', name);
  // Pin only the synchronous world creation clock, then restore animation time.
  await page.evaluate(seed => {
    const now = Date.now;
    try { Date.now = () => seed; document.querySelector<HTMLElement>('.modal-overlay [data-action="begin"]')!.click(); }
    finally { Date.now = now; }
  }, Number(process.env.CAMPAIGN_SEED ?? 42));
  await page.waitForSelector('.story-overlay [data-action="continue"]');
  await housekeeping(page);
  await page.waitForFunction(() => !document.querySelector('.story-overlay'), { timeout: 10000 });
}

/** Pause → Save/Load → Edit Save → set position level → Apply (teleport). */
async function editorTeleport(page: CdpPage, level: number): Promise<void> {
  await page.click('[data-action="pause"]');
  await page.waitForSelector('.modal-overlay .pause [data-pause-action="save"]');
  await page.click('.modal-overlay .pause [data-pause-action="save"]');
  await page.waitForSelector('.modal-overlay [data-action="edit-save"]');
  await page.click('.modal-overlay [data-action="edit-save"]');
  await page.waitForSelector('.modal-overlay [data-field="pos-level"]');
  await page.evaluate((lv: number) => {
    const sel = document.querySelector<HTMLSelectElement>('.modal-overlay [data-field="pos-level"]');
    if (!sel) throw new Error('editor position level select missing');
    sel.value = String(lv);
    sel.dispatchEvent(new Event('change', { bubbles: true }));
  }, level);
  await page.click('.modal-overlay [data-action="apply-edits"]');
  await page.waitForFunction(() => !document.querySelector('.modal-overlay'), { timeout: 10000 });
}

/** Explicit fixture assistance: refill through the real editor, without changing monsters. */
async function refillAssistedHero(page: CdpPage): Promise<void> {
  await page.click('[data-action="pause"]');
  await page.click('.modal-overlay .pause [data-pause-action="save"]');
  await page.click('.modal-overlay [data-action="edit-save"]');
  await page.waitForSelector('.modal-overlay [data-field="mana"]');
  await page.evaluate(() => {
    const fields = Object.fromEntries(['con','int','level','hp','mana'].map(name => [name,document.querySelector<HTMLInputElement>(`.modal-overlay [data-field="${name}"]`)!]));
    const con=Number(fields.con!.value), intelligence=Number(fields.int!.value), level=Number(fields.level!.value);
    fields.hp!.value=String(10+Math.floor(con/20)+(level-1)*(4+Math.floor(con/25)));
    fields.mana!.value=String(Math.floor(intelligence/10)+(level-1)*(2+Math.floor(intelligence/25)));
    fields.hp!.dispatchEvent(new Event('input',{bubbles:true}));
    fields.mana!.dispatchEvent(new Event('input',{bubbles:true}));
  });
  await page.click('.modal-overlay [data-action="apply-edits"]');
  await page.waitForFunction(()=>!document.querySelector('.modal-overlay'));
}

async function main(): Promise<number> {
  let exit = 0;
  const report: Report = {
    part: 2,
    assisted: true,
    editedStats: true,
    resourceRefills: 0,
    seed: Number(process.env.CAMPAIGN_SEED ?? 42),
    victory: false,
    fireShrugSeen: false,
    lightningTearsSeen: false,
    deaths: 0,
    bossAttempts: 0,
    totalTurns: 0,
    unedited: null,
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
      const bossInfo = (): Promise<{ x: number; y: number; name: string; hp: number } | null> =>
        page.evaluate(
          () =>
            (window as unknown as { __cotw: { boss: () => { x: number; y: number; name: string; hp: number } | null } })
              .__cotw.boss(),
        );
      const castAt = async (spellId: string, target?: { x: number; y: number }): Promise<void> => {
        const d = makeDispatchChecked(page);
        const before = await page.evaluate(() => (window as unknown as {__cotw:{turn:()=>number}}).__cotw.turn());
        await d(target ? { type: 'CAST', spellId, target } : { type: 'CAST', spellId });
        const after = await page.evaluate(() => {const c=(window as unknown as {__cotw:{turn:()=>number;log:()=>string[]}}).__cotw;return {turn:c.turn(),last:c.log().slice(-1)[0]};});
        if(after.turn===before) throw new Error(`Rejected ${spellId}: ${after.last}`);
      };
      const logTailTexts = (): Promise<string[]> =>
        page.evaluate(() => (window as unknown as { __cotw: { log: () => string[] } }).__cotw.log().slice(-8));

      // ---------- Phase A: UNEDITED progression ----------
      {
        const uDispatch = makeDispatchChecked(page);
        await page.evaluate(() => localStorage.clear());
        await page.reload({ waitUntil: 'domcontentloaded' });
        await beginPart2Game(page, 'Unedited2');

        let uDeaths = 0;
        let roadWalk: 'arrived' | 'died' | 'unreachable' | 'capped' = 'arrived';
        for (let attempt = 0; attempt < 3; attempt++) {
          if ((await hpNow()) < 15) await uDispatch({ type: 'REST' });
          roadWalk = await walkTo(page, 15, 2, 400); // North Road castle stair
          if (roadWalk === 'died') {
            uDeaths++;
            report.deaths++;
            const recovered = await recoverFromDeath(page);
            if (!recovered) break;
            continue;
          }
          break;
        }
        let reachedLevel2 = false;
        if (roadWalk === 'arrived') {
          await uDispatch({ type: 'DESCEND' }); // town castle stair -> castle 1
          await sleep(300);
          if ((await currentLevel(page)) === 1) {
            await uDispatch({type:'ASCEND'});
            await housekeeping(page);
            if ((await currentLevel(page)) !== 0) fail('fresh Part Two hero cannot return to town on foot');
            await uDispatch({type:'DESCEND'});
            await housekeeping(page);
            for (let attempt = 0; attempt < 3; attempt++) {
              if ((await hpNow()) < 15) await uDispatch({ type: 'REST' });
              const st = await stairDown();
              if (!st) break;
              const down = await walkTo(page, st.x, st.y, 400);
              if (down === 'died') {
                uDeaths++;
                report.deaths++;
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
        const uTurns = await turnNow();
        report.unedited = { character: 'Unedited2', reachedLevel2, deaths: uDeaths, turns: uTurns };
        console.log(
          `campaign2: unedited progression reachedLevel2=${reachedLevel2} deaths=${uDeaths} turns=${uTurns}`,
        );
        if (!reachedLevel2) fail('unedited part-2 progression did not reach castle level 2');
        if (uDeaths > 2) fail(`unedited part-2 deaths ${uDeaths} exceed the bound of 2`);
      }

      // ---------- Phase B: ASSISTED (labeled — NOT a balance claim) ----------
      console.log('campaign2: assisted flow begins (editor-boosted — quest/transition test, NOT balance)');
      await page.evaluate(() => localStorage.clear());
      await page.reload({ waitUntil: 'domcontentloaded' });
      await beginPart2Game(page, 'Champion2');

      // Editor pass #1: veteran stats + spells + gold (NO position yet — we
      // shop for armor in town first). dex 100 → toHit +5.
      await page.click('[data-action="pause"]');
      await page.waitForSelector('.modal-overlay .pause [data-pause-action="save"]');
      await page.click('.modal-overlay .pause [data-pause-action="save"]');
      await page.waitForSelector('.modal-overlay [data-action="edit-save"]');
      await page.click('.modal-overlay [data-action="edit-save"]');
      await page.waitForSelector('.modal-overlay [data-field="level"]');
      await page.evaluate(() => {
        const fields: [string, string][] = [
          ['str', '90'],
          ['dex', '100'],
          ['int', '100'],
          ['con', '90'],
          ['level', '20'],
          ['gold', '20000'],
          ['spells', 's-lightning-bolt, s-fireball, s-heal-major-wounds, s-rune-of-return'],
        ];
        for (const [field, value] of fields) {
          const el = document.querySelector<HTMLInputElement>(`.modal-overlay [data-field="${field}"]`);
          if (!el) throw new Error(`editor field missing: ${field}`);
          el.value = value;
          el.dispatchEvent(new Event('input', { bubbles: true }));
        }
      });
      await page.click('.modal-overlay [data-action="apply-edits"]');
      await page.waitForFunction(() => !document.querySelector('.modal-overlay'), { timeout: 10000 });

      // ---- Buy plate mail at Eirik's and equip it (run-2 telemetry: the
      // champion had NO armor → Surtur's melee hit ~95% and every attempt
      // spiralled; AC 16-18 makes the fight a test of mechanics, not stats).
      const eirikDoor = await page.evaluate(() => {
        const doors = (window as unknown as { __cotw: { shopDoors: () => { shopId: string; x: number; y: number }[] } }).__cotw.shopDoors();
        return doors.find((d) => d.shopId === 'eirik') ?? null;
      });
      if (!eirikDoor) throw new Error('part-2 town has no eirik shop door');
      const walkShop = await walkTo(page, eirikDoor.x, eirikDoor.y, 400);
      if (walkShop !== 'arrived') fail(`walk to eirik door: ${walkShop}`);
      const openedShop = await page.evaluate(() => {
        const c = (window as unknown as {
          __cotw: { position: () => { x: number; y: number } | null; travel: { tap: (cell: { x: number; y: number }, t?: string) => void } };
        }).__cotw;
        if (document.querySelector('.modal-overlay')) return true;
        const pos = c.position();
        if (!pos) return false;
        c.travel.tap({ x: pos.x, y: pos.y }, 'touch'); // own-cell tap = interact
        return true;
      });
      if (!openedShop) fail('could not open eirik shop');
      await page.waitForSelector('.modal-overlay .merchant-buy-list', { timeout: 5000 });
      await page.click('.modal-overlay .merchant-buy-list .item-row[data-def-id="i-plate-mail"] .item-row-button');
      await page.click('.modal-overlay [data-field="primary-action"]');
      await sleep(100);
      const closeBtn = await page.$('.modal-overlay [data-action="close"]');
      if (closeBtn) await closeBtn.click();
      await page.waitForFunction(() => !document.querySelector('.modal-overlay'), { timeout: 5000 });
      // Equip via the inventory panel.
      await page.click('button[data-action="inventory"]');
      await page.waitForSelector('.modal-overlay .inventory-panel');
      await page.click('.modal-overlay .item-row[data-uid*="i-plate-mail"] .item-row-button');
      await page.click('.modal-overlay [data-field="primary-action"]'); // Equip
      await sleep(100);
      const closeBtn2 = await page.$('.modal-overlay [data-action="close"]');
      if (closeBtn2) await closeBtn2.click();
      await page.waitForFunction(() => !document.querySelector('.modal-overlay'), { timeout: 5000 });

      // ---- Prisoner interlude (REQUIRED stages): real arrival on level 12
      // fires prisoner[6]; a rune trip home fires prisoner-report[7] AND
      // jarl-depth[10] on the same town visit (cascade).
      await editorTeleport(page, 11);
      const st11 = await stairDown();
      if (!st11) fail('castle level 11 has no down stair');
      const walk11 = st11 ? await walkTo(page, st11.x, st11.y, 400, { healSpellId: 's-heal-major-wounds', nukeSpellId: 's-fireball', minHp: 70 }) : 'unreachable';
      if (walk11 !== 'arrived') fail(`walk to level-11 stair: ${walk11}`);
      if ((await currentLevel(page)) === 11) {
        const d11 = makeDispatchChecked(page);
        await d11({ type: 'DESCEND' });
        await sleep(300);
      }
      if ((await currentLevel(page)) !== 12) fail(`prisoner interlude: did not reach level 12 (${await currentLevel(page)})`);
      await housekeeping(page); // prisoner [6]
      await editorTeleport(page, 3);
      for (let floor = 0; floor < 4 && (await currentLevel(page)) !== 0; floor++) {
        await castAt('s-rune-of-return');
        await makeDispatchChecked(page)({type:'ASCEND'});
        await housekeeping(page);
      }
      await sleep(400);
      await housekeeping(page); // prisoner-report [7] + jarl-depth [10]
      await housekeeping(page);

      // Recover legitimately in town before starting the final dungeon leg.
      await makeDispatchChecked(page)({type:'REST'});

      // Editor pass #2: teleport to level 24.
      await editorTeleport(page, 24);
      const posAfter = await posNow();
      if (!posAfter || posAfter.level !== 24) fail(`editor teleport did not land on level 24 (${posAfter?.level})`);
      // Teleporting past story levels queues their cutscenes — drain them.
      await housekeeping(page);
      await sleep(200);
      await housekeeping(page);

      // Real descent into 25 (surtur-gate fires on arrival).
      const st24 = await stairDown();
      if (!st24) fail('castle level 24 has no down stair');
      const r = st24
        ? await walkTo(page, st24.x, st24.y, 400, {
            healSpellId: 's-heal-major-wounds',
            nukeSpellId: 's-fireball',
            minHp: 70,
          })
        : 'unreachable';
      if (r !== 'arrived') fail(`walk to level-24 stair: ${r}`);
      if ((await currentLevel(page)) === 24) {
        const d = makeDispatchChecked(page);
        await d({ type: 'DESCEND' });
        await sleep(300);
      }
      if ((await currentLevel(page)) !== 25) fail(`did not descend into castle level 25 (${await currentLevel(page)})`);
      await housekeeping(page); // surtur-gate + any queued beats

      // ---- Surtur fight: fire-immune shrug assert, lightning kill ----
      let boss = await bossInfo();
      if (!boss) fail('Surtur not found on castle level 25 (quest bosses[] lookup)');
      for (let attempt = 1; attempt <= 4 && boss; attempt++) {
        report.bossAttempts = attempt;
        console.log(`campaign2: boss attempt ${attempt} boss=${JSON.stringify(boss)}`);
        const d = makeDispatchChecked(page);
        await d({ type: 'REST' }); // refill mana if boss out of sight
        await housekeeping(page);
        let fireProbes = 0; // shrug only prints on a HIT — cap the probe so the fight progresses
        for (let action = 0; action < 500; action++) {
          const hk = await housekeeping(page);
          if (hk === 'death') break;
          if (hk === 'victory-pending') break;
          boss = await bossInfo();
          if (!boss || boss.hp <= 0) break;
          const pos = await posNow();
          if (!pos) break;
          const dist = Math.max(Math.abs(boss.x - pos.x), Math.abs(boss.y - pos.y));
          if ((await manaNow()) < 5 || (await hpNow()) < 35) {
            if(report.resourceRefills>=8) throw new Error('Assisted resource refill limit reached');
            await refillAssistedHero(page);
            report.resourceRefills++;
            continue;
          }
          if ((await hpNow()) < 50 && (await manaNow()) >= 1) {
            await castAt('s-heal-major-wounds');
            await sleep(25);
            continue;
          }
          if (dist > 6) {
            const st = await stepToward(page, boss.x, boss.y);
            if (st.err === 'unreachable') break;
            await sleep(25);
            continue;
          }
          // Documented fireball probes: immune → shrug line, zero damage.
          if (!report.fireShrugSeen && fireProbes < 24) {
            fireProbes++;
            await castAt('s-fireball', { x: boss.x, y: boss.y });
            const texts = await logTailTexts();
            if (texts.some((t) => /shrugs off the fire/i.test(t))) report.fireShrugSeen = true;
            await sleep(25);
            continue;
          }
          await castAt('s-lightning-bolt', { x: boss.x, y: boss.y });
          const texts = await logTailTexts();
          if (texts.some((t) => /lightning tears into/i.test(t))) report.lightningTearsSeen = true;
          if (texts.some((t) => /hit the wall/i.test(t))) {
            // bolt blocked: reposition one step and retry
            await stepToward(page, boss.x, boss.y);
          }
          await sleep(25);
        }
        if (await isDeadNow()) {
          report.deaths++;
          console.log(`campaign2: death #${report.deaths} in boss combat`);
          const recovered = await recoverFromDeath(page);
          if (!recovered) break;
          boss = await bossInfo();
          continue;
        }
        boss = await bossInfo();
        if (!boss || boss.hp <= 0) break;
      }
      if (boss && boss.hp > 0) console.error('campaign2: stalled boss details', await page.evaluate(() => { const c=(window as unknown as {__cotw:{hp:()=>number;mana:()=>number;log:()=>string[];position:()=>unknown}}).__cotw; return {hp:c.hp(),mana:c.mana(),position:c.position(),log:c.log().slice(-12)}; }));
      if (!report.fireShrugSeen) fail('fire immunity shrug line never observed');
      if (!report.lightningTearsSeen) fail('lightning vulnerability line never observed');
      await housekeeping(page); // banished cutscene [24] (and taunt [23] if queued)

      // ---- Homecoming: Rune of Return to the up stair, then ascend to town ----
      await editorTeleport(page, 3);
      await housekeeping(page);
      for (let floor = 0; floor < 4 && (await currentLevel(page)) !== 0; floor++) {
        await castAt('s-rune-of-return');
        await makeDispatchChecked(page)({type:'ASCEND'});
        await housekeeping(page);
      }
      await sleep(400);

      // Drain homecoming [25,26] + victory overlay.
      for (let i = 0; i < 40; i++) {
        const state = await page.evaluate(() => {
          const story = document.querySelector<HTMLElement>('.story-overlay [data-action="continue"]');
          if (story) {
            story.click();
            return 'story';
          }
          if (document.querySelector('.story-overlay.victory')) return 'victory';
          return 'clear';
        });
        if (state === 'victory') break;
        if (state === 'clear') break;
        await sleep(60);
      }
      const victoryText = await page.evaluate(
        () => document.querySelector('.story-overlay.victory')?.textContent ?? '',
      );
      report.victory = victoryText.length > 0 && /Lifthransir/.test(victoryText);
      report.totalTurns = await turnNow();
      if (!report.victory) fail('victory screen (shade of King Lifthransir) never appeared after homecoming');
      else console.log(`campaign2: VICTORY turns=${report.totalTurns} deaths=${report.deaths}`);

      if (errors.length > 0) {
        console.error('campaign2: page errors:');
        for (const e of errors.slice(0, 5)) console.error(`  ${e}`);
        fail('page errors during run');
      }

      writeFileSync('docs/e2e/campaign2-report.json', `${JSON.stringify(report, null, 2)}\n`);
      console.log(`campaign2: report written (victory=${report.victory})`);
    });
  } catch (err) {
    console.error('campaign2 FAILED:', err);
    exit = 1;
  }
  console.log(`campaign2: ${exit === 0 ? 'PASS' : 'FAIL'}`);
  return exit;
}

void main().then((code) => process.exit(code));
