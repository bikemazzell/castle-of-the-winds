import fs from 'node:fs';
import path from 'node:path';
import type { Page } from 'puppeteer-core';

/** Collect console messages + uncaught exceptions for gate assertions (Task 7.1+). */
export function collectPageErrors(page: Page): { errors: string[] } {
  const errors: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(`console.error: ${msg.text()}`);
  });
  page.on('pageerror', (err) => errors.push(`pageerror: ${(err as Error).message}`));
  return { errors };
}

/**
 * Run `fn` with resources that must all be released afterwards — success or
 * failure (CODE-QUALITY Task 10: partial startup must never leak an owned
 * process). Callers push each started resource in as it starts.
 */
export async function runWith<T>(
  closes: Array<() => Promise<void>>,
  fn: (close: (c: () => Promise<void>) => void) => Promise<T>,
): Promise<T> {
  try {
    return await fn((c) => closes.push(c));
  } finally {
    for (const close of closes.reverse()) {
      try {
        await close();
      } catch (err) {
        console.error('[cleanup] a resource failed to close:', String(err));
      }
    }
  }
}

export async function screenshot(page: Page, relPath: string): Promise<void> {
  const abs = path.resolve(import.meta.dirname, '../..', relPath);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  await page.screenshot({ path: abs, fullPage: false });
}

/** Fail(throw) if the page logged errors; returns them otherwise. */
export function assertNoPageErrors(errors: string[]): void {
  if (errors.length > 0) {
    throw new Error(`page reported ${errors.length} error(s):\n${errors.join('\n')}`);
  }
}
