import { readdirSync, existsSync } from 'node:fs';
import type { Page } from 'puppeteer-core';
import { ensureNested, ensurePreview, ensureVite, launchBrave, newPage } from './brave';
import { assertNoPageErrors, collectPageErrors, runWith, screenshot } from './helpers';

/**
 * E2E smoke (plan Task 0.3 + 7.1, hardened CODE-QUALITY Task 10):
 * boot → new game "Test" → HUD asserts → 3 moves via CDP keys → inventory
 * open/close → pause → Save slot 0 → reload → Continue → state restored.
 *
 * Modes: E2E_MODE=dev (default, vite dev server) | preview (production build
 * via `vite preview` + nested-hosting check + decoded-image assertions).
 * Every run owns an isolated browser (unique port + temp profile) and its own
 * app server on a unique port — nothing shared is touched.
 * Exit code 0/1 — usable from `npm run e2e`.
 */

/** The production bundle contains code-drawn art and no extracted sprite sheets. */
function assertShippedArt(fail: (msg: string) => void): string[] {
  if (!existsSync('dist/assets')) return [];
  const extracted = readdirSync('dist/assets').filter(f => /^(bm\d|gi\d|sprites)/.test(f));
  if (extracted.length) fail(`Extracted artwork in production: ${extracted.join(', ')}`);
  return ['procedural'];
}

async function assertDecodedImages(page: Page, fail: (msg: string) => void): Promise<void> {
  const colors = await page.evaluate(() => {
    const canvas = document.querySelector('canvas');
    if (!canvas) return 0;
    const ctx = canvas.getContext('2d');
    if (!ctx) return 0;
    const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    const colors = new Set<number>();
    for (let i = 0; i < pixels.length; i += 4) {
      if (pixels[i + 3]) colors.add((pixels[i]! << 16) | (pixels[i + 1]! << 8) | pixels[i + 2]!);
    }
    return colors.size;
  });
  if (colors < 30) fail(`Procedural scene did not render: ${colors} colors`);
  else console.log(`art: procedural scene renders with ${colors} colors`);
}

async function main(): Promise<number> {
  const mode = process.env.E2E_MODE === 'preview' ? 'preview' : 'dev';
  let exit = 0;
  const fail = (msg: string): void => {
    console.error(`FAIL: ${msg}`);
    exit = 1;
  };
  const artReferenced = assertShippedArt(fail);

  await runWith([], async (close) => {
    const brave = await launchBrave(console.error);
    close(() => brave.close());
    const server = mode === 'preview' ? await ensurePreview(console.error) : await ensureVite(console.error);
    close(() => server.stop());

    try {
      const page = await newPage(brave.browser, server.url);
      const { errors } = collectPageErrors(page);
      const title = await page.title();
      if (!title.includes('Castle')) fail(`title "${title}" does not contain "Castle"`);

      // Hermetic run: this browser profile is OWNED and unique to this run,
      // so clearing origin storage can never touch a user's data (Task 10).
      await page.evaluate(() => localStorage.clear());
      await page.reload({ waitUntil: 'domcontentloaded' });

    // --- New game via title overlay → wizard ---
    await page.waitForSelector('[data-action="new-game"]');
    await screenshot(page, 'docs/e2e/title.png');
    await page.click('[data-action="new-game"]');
    await page.waitForSelector('.modal-overlay [data-field="name"]');
    await page.type('.modal-overlay [data-field="name"]', 'Test');
    await page.click('.modal-overlay [data-action="begin"]');

    // --- Opening cutscene: click through until the overlay is gone ---
    await page.waitForSelector('.story-overlay');
    for (let i = 0; i < 20; i++) {
      const btn = await page.$('.story-overlay [data-action="continue"]');
      if (!btn) break;
      await btn.click();
    }
    const storyGone = (await page.$('.story-overlay')) === null;
    if (!storyGone) fail('story overlay never dismissed');

    // --- HUD asserts ---
    await page.waitForSelector('header.hud [data-field="name"]');
    const hudName = await page.$eval('header.hud [data-field="name"]', (el) => el.textContent ?? '');
    if (hudName !== 'Test') fail(`HUD name "${hudName}" !== "Test"`);
    const hudHp = await page.$eval('header.hud [data-field="hp"]', (el) => el.textContent ?? '');
    if (!/\d+\/\d+/.test(hudHp)) fail(`HUD hp "${hudHp}" not n/n`);

    // --- 3 moves via CDP keyboard (town road row y=20 is walkable) ---
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('ArrowLeft');
    await screenshot(page, 'docs/e2e/playing.png');

    // --- Inventory open/close ---
    await page.keyboard.press('i');
    await page.waitForSelector('.modal-overlay .inventory-panel');
    await screenshot(page, 'docs/e2e/inventory.png');
    await page.keyboard.press('Escape');
    const invClosed = (await page.$('.modal-overlay')) === null;
    if (!invClosed) fail('inventory modal did not close on Escape');

    // --- Pause → Save / Load → Save… → slot 0 ---
    await page.keyboard.press('Escape');
    await page.waitForSelector('.modal-overlay .pause [data-pause-action="save"]');
    await page.click('.modal-overlay .pause [data-pause-action="save"]');
    await page.waitForSelector('.modal-overlay [data-action="save"]');
    const clickedSave = await page.evaluate(() => {
      const rows = Array.from(document.querySelectorAll<HTMLElement>('.modal-overlay [data-action="save"]'));
      const save = rows.find((b) => (b.textContent ?? '').trim() === 'Save…');
      if (!save) return false;
      save.click();
      return true;
    });
    if (!clickedSave) fail('Save / Load chooser Save… row not found');
    await page.waitForSelector('.save-dialog [data-slot-id="0"] [data-action="save-here"]');
    await page.click('.save-dialog [data-slot-id="0"] [data-action="save-here"]');
    await page.waitForFunction(() => !document.querySelector('.modal-overlay'));
    await screenshot(page, 'docs/e2e/saved.png');

    // --- Reload → Continue (direct load) → state restored ---
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForSelector('[data-action="continue"]');
    const contEnabled = await page.$eval('[data-action="continue"]', (el) => !(el as HTMLButtonElement).disabled);
    if (!contEnabled) fail('Continue disabled after saving');
    // Truthful Continue (UI plan Phase 7): label shows the character up front
    // and clicking loads the most recent save directly — no slot-list detour.
    const contLabel = await page.$eval('[data-action="continue"]', (el) => el.textContent ?? '');
    if (!contLabel.includes('Test')) fail(`Continue label "${contLabel}" lacks "Test"`);
    if (contLabel.trim() === 'Continue') fail(`Continue label "${contLabel}" is generic — expected details`);
    await page.click('[data-action="continue"]');
    await page.waitForSelector('header.hud [data-field="name"]');
    const restoredName = await page.$eval('header.hud [data-field="name"]', (el) => el.textContent ?? '');
    if (restoredName !== 'Test') fail(`restored HUD name "${restoredName}" !== "Test"`);
    const restoredLevel = await page.$eval('header.hud [data-field="level"]', (el) => el.textContent ?? '');
    if (!restoredLevel.includes('1')) fail(`restored level "${restoredLevel}" not 1`);
    await screenshot(page, 'docs/e2e/restored.png');

      // Production-only checks (Task 10): decoded images + nested hosting.
      if (mode === 'preview') {
        await assertDecodedImages(page, fail);
        const nested = await ensureNested(console.error);
        try {
          const nestedPage = await newPage(brave.browser, nested.url);
          const nestedErrors = collectPageErrors(nestedPage);
          await nestedPage.waitForSelector('#app', { timeout: 5_000 });
          const nestedTitle = await nestedPage.title();
          if (!nestedTitle.includes('Castle')) fail(`nested-hosting title "${nestedTitle}" broken`);
          await nestedPage.close();
          assertNoPageErrors(nestedErrors.errors);
          console.log('nested: production build serves + boots under /nested/');
        } finally {
          await nested.stop();
        }
      }
      void artReferenced;

      assertNoPageErrors(errors);
      console.log(`smoke[${mode}]: title="${title}" — ${exit === 0 ? 'PASS' : 'FAIL'}`);
    } catch (err) {
      console.error('smoke FAILED:', err);
      exit = 1;
    }
  });
  return exit;
}

void main().then((code) => process.exit(code));
