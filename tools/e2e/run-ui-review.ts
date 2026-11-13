/**
 * UI review scene runner (UI plan Phase 0).
 *
 * Builds deterministic review scenes via the `__cotw` fixture hooks
 * (`newGame(seed)` + `scene(name)`), captures the Phase-0 viewport matrix,
 * and records what the current interface shows. Fixtures only — these are
 * NOT campaign acceptance runs.
 *
 * Outputs (gitignored like other docs/e2e/ artifacts):
 *   docs/ui-ux-review/scenes/<scene>.png        capture at 412×915
 *   docs/ui-ux-review/scenes/viewport-<n>.png   town scene across the matrix
 *   docs/ui-ux-review/scenes/report.json        machine-readable measurements
 */
import path from 'node:path';
import fs from 'node:fs';
import type { KeyInput, Page } from 'puppeteer-core';
import { launchBrave, ensureVite, newPage } from './brave';
import { collectPageErrors, screenshot, assertNoPageErrors, runWith } from './helpers';

/** Phase 0 scenes: name → setup on a freshly seeded review world. */
type SceneSpec = {
  name: string;
  /** Set up the scene; return a short human note, or throw to fail. */
  setup: (page: Page) => Promise<string>;
};

const REVIEW_SEED = 7;

async function dismissStory(page: Page): Promise<void> {
  for (let i = 0; i < 40; i++) {
    const gone = await page.evaluate(() => {
      const btn = document.querySelector<HTMLButtonElement>('.story-overlay [data-action="continue"]');
      if (!btn) return true;
      btn.click();
      return false;
    });
    if (gone) break;
    await sleep(40);
  }
}

async function freshReviewWorld(page: Page): Promise<void> {
  await page.evaluate((seed) => {
    localStorage.clear();
    const c = (window as unknown as { __cotw: { newGame: (s: number) => boolean } }).__cotw;
    if (!c.newGame(seed)) throw new Error('review world did not spawn');
  }, REVIEW_SEED);
  await dismissStory(page);
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

const SCENES: SceneSpec[] = [
  { name: 'town', setup: () => Promise.resolve('fresh character at the town spawn') },
  {
    name: 'combat',
    setup: async (page) => {
      const note = await page.evaluate(() => {
        const c = (window as unknown as { __cotw: { scene: (n: string) => { ok: boolean; detail?: string } } }).__cotw;
        const r = c.scene('combat');
        return r.ok ? 'adjacent alert monster on Mine level 1' : `FAILED: ${r.detail}`;
      });
      await dismissStory(page); // level-up cutscenes never fire here, safety only
      return note;
    },
  },
  {
    name: 'low-health',
    setup: async (page) => {
      await page.evaluate(() => {
        (window as unknown as { __cotw: { scene: (n: string) => void } }).__cotw.scene('low-health');
      });
      return 'hp forced to 3 of max';
    },
  },
  {
    name: 'full-pack',
    setup: async (page) => {
      await page.evaluate(() => {
        (window as unknown as { __cotw: { scene: (n: string) => void } }).__cotw.scene('full-pack');
      });
      await pressKey(page, 'i');
      await sleep(120);
      return 'inventory dialog open over a filled pack';
    },
  },
  {
    name: 'shop',
    setup: async (page) => {
      await page.evaluate(() => {
        (window as unknown as { __cotw: { scene: (n: string) => void } }).__cotw.scene('shop');
      });
      // One step onto the door tile, then the explicit open (Phase 2 task 6:
      // shop doors never auto-open on arrival).
      const opened = await page.evaluate(() => {
        const c = (window as unknown as {
          __cotw: { position: () => { x: number; y: number } | null; shopDoors: () => { x: number; y: number }[]; dispatch: (a: unknown) => void; travel: { tap: (cell: { x: number; y: number }, pointerType?: string) => void } };
        }).__cotw;
        const pos = c.position();
        if (!pos) return false;
        const door = c.shopDoors().find(
          (d) => Math.abs(d.x - pos.x) + Math.abs(d.y - pos.y) === 1,
        );
        if (!door) return false;
        c.dispatch({ type: 'MOVE', dx: Math.sign(door.x - pos.x), dy: Math.sign(door.y - pos.y) });
        const now = c.position();
        if (!now) return false;
        c.travel.tap({ x: now.x, y: now.y }, 'touch'); // own-cell tap opens
        return !!document.querySelector('.modal-overlay');
      });
      await sleep(150);
      return opened ? 'merchant dialog opened from the door step' : 'FAILED: no adjacent door';
    },
  },
  {
    name: 'targeting',
    setup: async (page) => {
      await page.evaluate(() => {
        (window as unknown as { __cotw: { scene: (n: string) => void } }).__cotw.scene('targeting');
      });
      await pressKey(page, 'c');
      await sleep(150);
      const cast = await page.evaluate(() => {
        const rows = [...document.querySelectorAll<HTMLElement>('.spell-row')];
        const fireball = rows.find((r) => /fireball/i.test(r.textContent ?? ''));
        const btn = fireball?.querySelector<HTMLButtonElement>('[data-action="cast"]');
        if (!btn) return 'missing';
        if (btn.disabled) return 'disabled';
        btn.click();
        return 'ok';
      });
      await sleep(150);
      const bar = await page.evaluate(() => document.querySelector('.target-bar') !== null);
      return cast === 'ok' && bar
        ? 'fireball targeting bar active'
        : `FAILED: cast=${cast} targetBar=${bar}`;
    },
  },
  {
    name: 'death',
    setup: async (page) => {
      await page.evaluate(() => {
        const c = (window as unknown as { __cotw: { scene: (n: string) => void; dispatch: (a: unknown) => void } }).__cotw;
        c.scene('death');
        c.dispatch({ type: 'WAIT' });
      });
      await sleep(150);
      return 'death dialog after a fatal turn';
    },
  },
  {
    name: 'victory',
    setup: async (page) => {
      await page.evaluate(() => {
        const c = (window as unknown as { __cotw: { scene: (n: string) => { ok: boolean; detail?: string } } }).__cotw;
        const r = c.scene('victory');
        if (!r.ok) throw new Error(`victory scene failed: ${r.detail ?? '?'}`);
        (window as unknown as { __cotw: { dispatch: (a: unknown) => void } }).__cotw.dispatch({ type: 'WAIT' });
      });
      await dismissStory(page);
      await sleep(150);
      return 'victory screen after the ending cutscene';
    },
  },
  {
    name: 'save-error',
    setup: async (page) => {
      await page.evaluate(() => {
        localStorage.clear();
        const original = localStorage.setItem.bind(localStorage);
        localStorage.setItem = (k: string, v: string) => {
          if (k.startsWith('cotw.save')) {
            throw new DOMException('quota exceeded (review fixture)', 'QuotaExceededError');
          }
          original(k, v);
        };
      });
      await pressKey(page, 'Escape'); // pause
      await sleep(120);
      await page.evaluate(() => {
        const pauseBtn = document.querySelector<HTMLButtonElement>('[data-pause-action="save"]');
        if (!pauseBtn) throw new Error('pause Save / Load button not found');
        pauseBtn.click();
      });
      await sleep(120);
      await page.evaluate(() => {
        const row = [...document.querySelectorAll('.modal-overlay [data-action="save"]')].find(
          (b) => b.textContent === 'Save…',
        ) as HTMLButtonElement | undefined;
        if (!row) throw new Error('Save / Load chooser Save… row not found');
        row.click();
      });
      await sleep(120);
      await page.evaluate(() => {
        const btn = document.querySelector<HTMLButtonElement>('[data-slot-id="0"] [data-action="save-here"]');
        if (!btn) throw new Error('save-here button not found');
        btn.click();
      });
      await sleep(120);
      const note = await page.evaluate(() => {
        // Phase 3 HUD demotes the log to one recent-event line
        const recent = document.querySelector('.recent-event')?.textContent ?? '';
        const entries = [...document.querySelectorAll('.log-entry')].map((e) => e.textContent ?? '');
        const failure = recent.match(/save failed/i)
          ? recent
          : entries.find((t) => /save failed/i.test(t));
        return failure ? `save failure surfaced: "${failure}"` : 'NOTE: no visible save-failure message found';
      });
      return note;
    },
  },
];

const VIEWPORT_MATRIX: [number, number][] = [
  [360, 640], [390, 844], [412, 915],
  [640, 360], [915, 412],
  [768, 1024], [1024, 768], [1280, 720], [1440, 900],
];

async function setViewport(page: Page, width: number, height: number): Promise<void> {
  const client = await page.createCDPSession();
  await client.send('Emulation.setDeviceMetricsOverride', {
    width,
    height,
    deviceScaleFactor: 1,
    mobile: false,
  });
}

async function pressKey(page: Page, key: KeyInput): Promise<void> {
  await page.keyboard.down(key);
  await page.keyboard.up(key);
}

interface LayoutMeasurement {
  viewport: string;
  statusHeight: number;
  mapWidth: number;
  mapHeight: number;
  mapPercentOfHeight: number;
  sheetHeight: number;
  horizontalClipping: boolean;
  verticalClipping: boolean;
}

async function measureLayout(page: Page, width: number, height: number): Promise<LayoutMeasurement> {
  return page.evaluate((vp) => {
    const hud = document.querySelector('header.hud');
    const map = document.querySelector('.map');
    const sheet = document.querySelector('.sheet');
    const mapRect = map?.getBoundingClientRect();
    return {
      viewport: `${vp.w}×${vp.h}`,
      statusHeight: Math.round(hud?.getBoundingClientRect().height ?? 0),
      mapWidth: Math.round(mapRect?.width ?? 0),
      mapHeight: Math.round(mapRect?.height ?? 0),
      mapPercentOfHeight: Math.round(((mapRect?.height ?? 0) / window.innerHeight) * 100),
      sheetHeight: Math.round(sheet?.getBoundingClientRect().height ?? 0),
      horizontalClipping: document.documentElement.scrollWidth > window.innerWidth + 1,
      verticalClipping: document.documentElement.scrollHeight > window.innerHeight + 1,
    };
  }, { w: width, h: height });
}

async function main(): Promise<void> {
  const log = (line: string): void => console.log(line);
  const outDir = 'docs/ui-ux-review/scenes';
  fs.mkdirSync(path.resolve(import.meta.dirname, '../..', outDir), { recursive: true });

  const report: { scenes: Record<string, string>; viewports: LayoutMeasurement[] } = {
    scenes: {},
    viewports: [],
  };
  let failures = 0;

  await runWith([], async (close) => {
    const brave = await launchBrave(log);
    close(() => brave.close());
    const vite = await ensureVite(log);
    close(() => vite.stop());
    const page = await newPage(brave.browser, vite.url);
  const errors = collectPageErrors(page);
  await page.waitForSelector('.title-overlay', { timeout: 10_000 });
  await setViewport(page, 412, 915);

  for (const scene of SCENES) {
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForSelector('.title-overlay', { timeout: 10_000 });
    if (scene.name !== 'save-error') {
      await freshReviewWorld(page);
    } else {
      await freshReviewWorld(page); // then the setup breaks storage on purpose
    }
    let note: string;
    try {
      note = await scene.setup(page);
    } catch (err) {
      note = `FAILED: ${err instanceof Error ? err.message : String(err)}`;
    }
    if (note.startsWith('FAILED')) failures += 1;
    report.scenes[scene.name] = note;
    await screenshot(page, `${outDir}/${scene.name}.png`);
    console.log(`ui-review: scene ${scene.name} — ${note}`);
  }

  // Viewport matrix on the plain town scene.
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.title-overlay', { timeout: 10_000 });
  await freshReviewWorld(page);
  for (const [w, h] of VIEWPORT_MATRIX) {
    await setViewport(page, w, h);
    await sleep(120);
    const m = await measureLayout(page, w, h);
    report.viewports.push(m);
    await screenshot(page, `${outDir}/viewport-${w}x${h}.png`);
    console.log(
      `ui-review: ${m.viewport} map ${m.mapWidth}×${m.mapHeight} (${m.mapPercentOfHeight}%h) ` +
      `status ${m.statusHeight} sheet ${m.sheetHeight}` +
      `${m.horizontalClipping ? ' H-CLIP' : ''}${m.verticalClipping ? ' V-CLIP' : ''}`,
    );
  }

  fs.writeFileSync(
    path.resolve(import.meta.dirname, '../..', `${outDir}/report.json`),
    `${JSON.stringify(report, null, 2)}\n`,
  );

  assertNoPageErrors(errors.errors);
  });
  if (failures > 0) {
    console.error(`ui-review: ${failures} scene(s) FAILED`);
    process.exit(1);
  }
  console.log('ui-review: PASS');
}

void main().then(
  () => process.exit(0),
  (err) => {
    console.error(err);
    process.exit(1);
  },
);
