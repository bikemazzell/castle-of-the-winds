import type { CDPSession, Page } from 'puppeteer-core';
import { launchBrave, ensureVite, newPage } from './brave';
import { assertNoPageErrors, collectPageErrors, runWith, screenshot } from './helpers';

/**
 * E2E mobile emulation (plan Task 7.2, hardened CODE-QUALITY Task 10):
 * Pixel 7 portrait + landscape via CDP device-metrics override, touch-driven
 * destination travel/dialogs/save-load, rotate mid-game, drag/pointercancel
 * tap-cancellation probes, and ACTION-TO-PAINT latency budgets (the idle
 * frame loop is reported as info only). Owned isolated browser + app server.
 * Exit code 0/1 — usable from `npm run e2e:mobile`.
 */
const PORTRAIT = { width: 412, height: 915, deviceScaleFactor: 2.625, mobile: true };
const LANDSCAPE = { width: 915, height: 412, deviceScaleFactor: 2.625, mobile: true };

async function setMetrics(client: CDPSession, m: typeof PORTRAIT): Promise<void> {
  await client.send('Emulation.setDeviceMetricsOverride', { ...m });
}

async function tap(
  client: CDPSession,
  page: Page,
  x: number,
  y: number,
): Promise<void> {
  // CDP touch input coordinates map to event.clientX/Y offset by the visual
  // viewport position (empirically client = input + pageTop/pageLeft). The
  // page must never scroll (html,body overflow:hidden), but compensate anyway
  // so any residual scroll can never desync taps.
  const vv = await page.evaluate(() => ({
    x: window.visualViewport?.pageLeft ?? 0,
    y: window.visualViewport?.pageTop ?? 0,
  }));
  const px = Math.round(x - vv.x);
  const py = Math.round(y - vv.y);
  await client.send('Input.dispatchTouchEvent', {
    type: 'touchStart',
    touchPoints: [{ x: px, y: py, id: 1 }],
  });
  await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
}

async function tapSelector(client: CDPSession, page: Page, selector: string): Promise<void> {
  const center = await page.evaluate((sel) => {
    const el = document.querySelector<HTMLElement>(sel);
    if (!el) return null;
    // Long dialogs (creation wizard with presets) may push controls below the
    // fold — bring the target into view before computing its tap point.
    el.scrollIntoView({ block: 'center', inline: 'nearest' });
    const r = el.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  }, selector);
  if (!center) throw new Error(`selector not found for tap: ${selector}`);
  await tap(client, page, center.x, center.y);
}

/** Viewport coordinates of a world cell's center (camera + canvas rect). */
async function cellCenter(page: Page, x: number, y: number): Promise<{ x: number; y: number }> {
  for (let i = 0; i < 40; i++) {
    const pt = await page.evaluate(
      (cx, cy) => {
        const c = (window as unknown as {
          __cotw: {
            camera: () => { tile: number; originX: number; originY: number } | null;
            position: () => { x: number; y: number } | null;
          };
        }).__cotw;
        const cam = c.camera();
        const canvas = document.querySelector<HTMLCanvasElement>('.map canvas');
        if (!cam || !canvas) return null;
        const r = canvas.getBoundingClientRect();
        const px = r.left + (cx - cam.originX + 0.5) * cam.tile;
        const py = r.top + (cy - cam.originY + 0.5) * cam.tile;
        if (px < r.left || px > r.right || py < r.top || py > r.bottom) return null;
        return { x: px, y: py };
      },
      x,
      y,
    );
    if (pt) return pt;
    await sleep(100); // camera renders on the next frame
  }
  throw new Error(`cell (${x},${y}) not on screen`);
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

async function main(): Promise<number> {
  let exit = 0;
  const fail = (msg: string): void => {
    console.error(`FAIL: ${msg}`);
    exit = 1;
  };
  try {
    await runWith([], async (close) => {
    const brave = await launchBrave(console.error);
    close(() => brave.close());
    const vite = await ensureVite(console.error);
    close(() => vite.stop());
    const page = await newPage(brave.browser, vite.url);
    const { errors } = collectPageErrors(page);
    const client = await page.createCDPSession();
    // Perf collection BEFORE any measured scenario (Task 10: enabling after
    // work misses the navigation cost). CDP Performance metric values are
    // MILLISECONDS (ScriptDuration etc.) — converted/logged explicitly.
    await client.send('Performance.enable');
    await client.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
    await setMetrics(client, PORTRAIT);

    // Hermetic run + fresh load under mobile metrics.
    await page.evaluate(() => localStorage.clear());
    await page.reload({ waitUntil: 'domcontentloaded' });

    // --- New game "Mobile" via touch taps ---
    await page.waitForSelector('[data-action="new-game"]');
    await tapSelector(client, page, '[data-action="new-game"]');
    await page.waitForSelector('.modal-overlay [data-field="name"]');
    await page.type('.modal-overlay [data-field="name"]', 'Mobile');
    await tapSelector(client, page, '.modal-overlay [data-action="begin"]');
    await page.waitForSelector('.story-overlay [data-action="continue"]');
    for (let i = 0; i < 20; i++) {
      const gone = await page.evaluate(() => {
        const btn = document.querySelector<HTMLElement>('.story-overlay [data-action="continue"]');
        if (!btn) return true;
        btn.click();
        return false;
      });
      if (gone) break;
    }
    await page.waitForFunction(() => !document.querySelector('.story-overlay'));

    // First-run onboarding hint toasts (Phase 7.2b) sit fixed at the bottom
    // center — exactly over the dock — and a FRESH owned profile shows them
    // (the old shared-profile runs had them already dismissed). Skip them the
    // way a player would before touching the dock.
    for (let i = 0; i < 6; i++) {
      const gone = await page.evaluate(() => {
        const btn = document.querySelector<HTMLElement>('.hint-toast [data-action="hint-skip"]');
        if (!btn) return true;
        btn.click();
        return false;
      });
      if (gone) break;
      await sleep(100);
    }
    await page.waitForFunction(() => !document.querySelector('.hint-toast'));

    // --- Portrait asserts ---
    await page.waitForSelector('header.hud [data-field="name"]');
    const portraitOk = await page.evaluate(() => {
      const shell = document.querySelector('.cotw-shell');
      const map = document.querySelector<HTMLElement>('.map canvas');
      return {
        portrait: shell?.classList.contains('portrait') ?? false,
        noOverflow: document.documentElement.scrollWidth <= window.innerWidth + 1,
        mapVisible: !!map && map.offsetWidth > 0 && map.offsetHeight > 0,
        noDpad: !document.querySelector('.dpad'),
      };
    });
    if (!portraitOk.portrait) fail('portrait class missing');
    if (!portraitOk.noOverflow) fail('horizontal overflow in portrait');
    if (!portraitOk.mapVisible) fail('map canvas not visible');
    if (!portraitOk.noDpad) fail('d-pad still present — destination travel should replace it');
    await screenshot(page, 'docs/e2e/mobile-portrait.png');

    // --- 5 destination taps: step east along the town road ---
    for (let i = 0; i < 5; i++) {
      const pos = await page.evaluate(() => (window as unknown as { __cotw: { position: () => { x: number; y: number } | null } }).__cotw.position());
      if (!pos) throw new Error(`position hook unavailable at step ${i}`);
      const c = await cellCenter(page, pos.x + 1, pos.y);
      await tap(client, page, c.x, c.y);
      await sleep(80);
    }
    const turnAfter5 = await page.evaluate(() => (window as unknown as { __cotw: { turn: () => number } }).__cotw.turn());
    if (turnAfter5 !== 5) fail(`turn after 5 destination taps = ${turnAfter5}, expected 5`);

    // --- Dialog open/close via touch ---
    await tapSelector(client, page, '[data-action="inventory"]');
    await page.waitForSelector('.modal-overlay');
    await screenshot(page, 'docs/e2e/mobile-inventory.png');
    await tapSelector(client, page, '.modal-overlay [data-action="close"]');
    await page.waitForFunction(() => !document.querySelector('.modal-overlay'));

    // --- Tap cancellation: drag and pointercancel must never move the hero ---
    const t0 = await page.evaluate(() => (window as unknown as { __cotw: { turn: () => number } }).__cotw.turn());
    // Drag: press a tile, slide far past the threshold, release → no tap.
    const pos = await page.evaluate(() => (window as unknown as { __cotw: { position: () => { x: number; y: number } | null } }).__cotw.position());
    if (!pos) throw new Error('position hook unavailable for cancellation probes');
    {
      const c = await cellCenter(page, pos.x + 1, pos.y);
      await client.send('Input.dispatchTouchEvent', {
        type: 'touchStart',
        touchPoints: [{ x: Math.round(c.x), y: Math.round(c.y), id: 1 }],
      });
      await client.send('Input.dispatchTouchEvent', {
        type: 'touchMove',
        touchPoints: [{ x: Math.round(c.x + 48), y: Math.round(c.y + 24), id: 1 }],
      });
      await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      await sleep(150);
      const t1 = await page.evaluate(() => (window as unknown as { __cotw: { turn: () => number } }).__cotw.turn());
      if (t1 !== t0) fail(`drag-release acted as a tap (turn ${t0} -> ${t1})`);
      // pointercancel: press, browser aborts the pointer, release → no tap.
      const c2 = await cellCenter(page, pos.x + 1, pos.y);
      await client.send('Input.dispatchTouchEvent', {
        type: 'touchStart',
        touchPoints: [{ x: Math.round(c2.x), y: Math.round(c2.y), id: 2 }],
      });
      await page.evaluate(() => {
        const canvas = document.querySelector('.map canvas');
        if (!canvas) throw new Error('map canvas missing');
        canvas.dispatchEvent(new PointerEvent('pointercancel', { bubbles: true, pointerId: 2, pointerType: 'touch' }));
      });
      await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      await sleep(150);
      const t2 = await page.evaluate(() => (window as unknown as { __cotw: { turn: () => number } }).__cotw.turn());
      if (t2 !== t0) fail(`pointercancel released as a tap (turn ${t0} -> ${t2})`);
    }

    // --- Save via touch, reload, Continue via touch ---
    await tapSelector(client, page, '[data-action="pause"]');
    await page.waitForSelector('.modal-overlay .pause [data-pause-action="save"]');
    await tapSelector(client, page, '.modal-overlay .pause [data-pause-action="save"]');
    await page.waitForSelector('.modal-overlay [data-action="save"]');
    await tapSelector(client, page, '.modal-overlay [data-action="save"]');
    await page.waitForSelector('.save-dialog [data-slot-id="0"] [data-action="save-here"]');
    await tapSelector(client, page, '.save-dialog [data-slot-id="0"] [data-action="save-here"]');
    await page.waitForFunction(() => !document.querySelector('.modal-overlay'));

    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForSelector('[data-action="continue"]');
    // Truthful Continue (UI plan Phase 7): tap loads the most recent save
    // directly.
    await tapSelector(client, page, '[data-action="continue"]');
    await page.waitForSelector('header.hud [data-field="name"]');
    const name = await page.$eval('header.hud [data-field="name"]', (el) => el.textContent ?? '');
    if (name !== 'Mobile') fail(`restored name "${name}" !== "Mobile"`);

    // --- Perf: totals + action-to-paint latency (Task 10) ---
    // CDP metrics are MILLISECONDS: ScriptDuration covers everything since
    // Performance.enable (which ran right after the CDP session, before
    // navigation — enabling after work misses the navigation cost).
    const { metrics } = await client.send('Performance.getMetrics');
    const script = metrics.find((m) => m.name === 'ScriptDuration')?.value ?? 0;
    if (script >= 2000) fail(`ScriptDuration ${script}ms exceeds 2s budget`);
    // Idle frame loop is INFO ONLY (Task 10 replaced the idle-frame budget
    // with action-to-paint: a dirty-flag renderer may legitimately idle).
    await page.evaluate(() => (window as unknown as { __cotw: { perfReset: () => void } }).__cotw.perfReset());
    await sleep(700);
    const perf = await page.evaluate(() => {
      const p = (window as unknown as { __cotwPerf?: { frames: number; totalMs: number; maxMs: number } }).__cotwPerf
        ?? { frames: 0, totalMs: 0, maxMs: 0 };
      return { ...p, avg: p.frames > 0 ? p.totalMs / p.frames : Infinity };
    });
    console.log(`perf[idle rAF]: ${perf.frames} frames, avg ${perf.avg.toFixed(1)}ms, max ${perf.maxMs.toFixed(1)}ms (info only)`);

    // Action-to-paint: dispatch an action, wait for TWO rAFs (commit +
    // present), measure wall time. 5 samples each; median < 100ms and
    // max < 400ms hard budgets.
    const actionPaint = async (label: string, act: () => Promise<number>): Promise<number> => {
      const samples: number[] = [];
      for (let i = 0; i < 5; i++) {
        samples.push(await act());
        await sleep(60);
      }
      const sorted = [...samples].sort((a, b) => a - b);
      const median = sorted[Math.floor(sorted.length / 2)] ?? 0;
      const max = sorted[sorted.length - 1] ?? 0;
      console.log(`perf[action->paint ${label}]: median ${median.toFixed(1)}ms max ${max.toFixed(1)}ms`);
      if (median >= 100) fail(`${label} action-to-paint median ${median.toFixed(1)}ms exceeds 100ms budget`);
      if (max >= 400) fail(`${label} action-to-paint max ${max.toFixed(1)}ms exceeds 400ms budget`);
      return median;
    };
    await actionPaint('movement', () => page.evaluate(() => {
      const c = (window as unknown as { __cotw: { dispatch: (a: unknown) => void } }).__cotw;
      const t0 = performance.now();
      c.dispatch({ type: 'MOVE', dx: 1, dy: 0 });
      return new Promise<number>((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(() => resolve(performance.now() - t0)));
      });
    }));
    await actionPaint('wait-turn', () => page.evaluate(() => {
      const c = (window as unknown as { __cotw: { dispatch: (a: unknown) => void } }).__cotw;
      const t0 = performance.now();
      c.dispatch({ type: 'WAIT' });
      return new Promise<number>((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(() => resolve(performance.now() - t0)));
      });
    }));
    await actionPaint('panel-open', async () => {
      const ms = await page.evaluate(() => {
        const btn = document.querySelector<HTMLElement>('[data-action="inventory"]');
        const t0 = performance.now();
        btn?.click();
        return new Promise<number>((resolve) => {
          requestAnimationFrame(() => requestAnimationFrame(() => resolve(performance.now() - t0)));
        });
      });
      // close what we opened so later sections start clean
      await page.evaluate(() => {
        document.querySelector<HTMLElement>('.modal-overlay [data-action="close"]')?.click();
      });
      await sleep(50);
      return ms;
    });

    // --- Working preferences via touch (UI plan Phase 8 matrix) ---
    await tapSelector(client, page, '[data-action="pause"]');
    await page.waitForSelector('.modal-overlay .pause [data-pause-action="settings"]');
    await tapSelector(client, page, '.modal-overlay .pause [data-pause-action="settings"]');
    await page.waitForSelector('.modal-overlay button[data-text-scale="1.5"]');
    await tapSelector(client, page, '.modal-overlay button[data-text-scale="1.5"]');
    const scaled = await page.evaluate(() => {
      const v = document.documentElement.style.getPropertyValue('--text-scale');
      const px = parseFloat(getComputedStyle(document.documentElement).fontSize);
      return { v, px };
    });
    if (scaled.v !== '1.5' || scaled.px < 22) fail(`text scale not applied (var="${scaled.v}", ${scaled.px}px)`);
    await tapSelector(client, page, '.modal-overlay [data-action="close"]');
    await page.waitForFunction(() => !document.querySelector('.modal-overlay'));
    // Restore the default so later runs start from the persisted default.
    await tapSelector(client, page, '[data-action="pause"]');
    await tapSelector(client, page, '.modal-overlay .pause [data-pause-action="settings"]');
    await page.waitForSelector('.modal-overlay [data-action="restore-defaults"]');
    await tapSelector(client, page, '.modal-overlay [data-action="restore-defaults"]');
    await tapSelector(client, page, '.modal-overlay [data-action="close"]');
    await page.waitForFunction(() => !document.querySelector('.modal-overlay'));

    // --- Targeting via touch with Cancel (Phase 8 matrix: no keyboard needed) ---
    // Grant Magic Arrow through the real editor flow (pause -> Save/Load -> Edit Save).
    await tapSelector(client, page, '[data-action="pause"]');
    await tapSelector(client, page, '.modal-overlay .pause [data-pause-action="save"]');
    await page.waitForSelector('.modal-overlay [data-action="edit-save"]');
    await tapSelector(client, page, '.modal-overlay [data-action="edit-save"]');
    await page.waitForSelector('.modal-overlay [data-field="spells"]');
    await page.evaluate(() => {
      const el = document.querySelector<HTMLInputElement>('.modal-overlay [data-field="spells"]');
      if (!el) throw new Error('spells field missing');
      el.value = 's510';
      el.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await tapSelector(client, page, '.modal-overlay [data-action="apply-edits"]');
    await page.waitForFunction(() => !document.querySelector('.modal-overlay'));
    await sleep(300); // hot-swap settle
    const manaBefore = await page.evaluate(() => (window as unknown as { __cotw: { mana: () => number } }).__cotw.mana());
    const turnBefore = await page.evaluate(() => (window as unknown as { __cotw: { turn: () => number } }).__cotw.turn());
    await tapSelector(client, page, '[data-action="cast"]');
    await page.waitForSelector('.modal-overlay .spell-row[data-spell="s510"] [data-action="cast"]');
    await tapSelector(client, page, '.modal-overlay .spell-row[data-spell="s510"] [data-action="cast"]');
    await page.waitForSelector('.target-bar');
    await tapSelector(client, page, '.target-bar [data-action="cancel-target"]');
    await page.waitForFunction(() => !document.querySelector('.target-bar'));
    const afterCancel = await page.evaluate(() => {
      const c = (window as unknown as { __cotw: { mana: () => number; turn: () => number } }).__cotw;
      return { mana: c.mana(), turn: c.turn() };
    });
    if (afterCancel.mana !== manaBefore) fail(`canceled targeting spent mana (${manaBefore} -> ${afterCancel.mana})`);
    if (afterCancel.turn !== turnBefore) fail(`canceled targeting spent a turn (${turnBefore} -> ${afterCancel.turn})`);


    // --- Rotate mid-game: landscape, then back ---
    await setMetrics(client, LANDSCAPE);
    await sleep(400);
    const landscapeOk = await page.evaluate(() => ({
      landscape: document.querySelector('.cotw-shell')?.classList.contains('landscape') ?? false,
      noOverflow: document.documentElement.scrollWidth <= window.innerWidth + 1,
    }));
    if (!landscapeOk.landscape) fail('landscape class missing after rotate');
    if (!landscapeOk.noOverflow) fail('horizontal overflow in landscape');
    await screenshot(page, 'docs/e2e/mobile-landscape.png');

    await setMetrics(client, PORTRAIT);
    await sleep(400);
    const backOk = await page.evaluate(() =>
      document.querySelector('.cotw-shell')?.classList.contains('portrait') ?? false);
    if (!backOk) fail('portrait class missing after rotating back');

    assertNoPageErrors(errors);
    console.log(`mobile: ${exit === 0 ? 'PASS' : 'FAIL'} (script ${script.toFixed(0)}ms, idle rAF avg ${perf.avg.toFixed(1)}ms/${perf.frames}f, action-paint logged above)`);
    });
  } catch (err) {
    console.error('mobile FAILED:', err);
    exit = 1;
  }
  return exit;
}

void main().then((code) => process.exit(code));
