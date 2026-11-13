import { mkdtemp } from 'node:fs/promises';
import { rmSync } from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { tmpdir } from 'node:os';
import puppeteer, { type Browser, type Page } from 'puppeteer-core';
import {
  childProcessSpawner,
  ensureService,
  htmlContainsIsUp,
  jsonIsUp,
  type OwnedService,
} from './ownable';

/**
 * Brave CDP session (CODE-QUALITY Task 10 hardening):
 * - launchBrave ALWAYS spawns an OWNED, isolated browser: unique debugging
 *   port + unique temporary profile. Nothing on shared ports is touched and
 *   nothing the runner does (e.g. clearing storage for a hermetic run) can
 *   ever reach a user's browser.
 * - launchBraveAttached keeps the old attach-or-spawn behavior for
 *   interactive debugging ONLY — acceptance runners must not use it.
 * - On puppeteer connect failure every owned resource is stopped and the
 *   temp profile removed before the error propagates.
 */
export interface BraveSession {
  browser: Browser;
  service: OwnedService;
  /** Disconnect; kill only if we spawned this browser. */
  close(): Promise<void>;
}

const BRAVE = '/usr/bin/brave-browser-stable';
const APP_MARKER = 'Castle of the Winds';

/** Reserve a free TCP port (bind :0, read it, release). Best-effort locally. */
export function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.on('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const addr = srv.address();
      const port = typeof addr === 'object' && addr ? addr.port : 0;
      srv.close(() => (port > 0 ? resolve(port) : reject(new Error('no free port'))));
    });
  });
}

const braveArgs = (port: number, profile: string, headless: boolean): string[] => [
  `--remote-debugging-port=${port}`,
  `--user-data-dir=${profile}`,
  '--no-first-run',
  '--disable-background-timer-throttling',
  '--disable-renderer-backgrounding',
  ...(headless ? ['--headless'] : []),
  'about:blank',
];

/** A CDP /json/version endpoint answers with JSON carrying a Browser field. */
const cdpIsUp = jsonIsUp((body) => typeof (body as { Browser?: unknown }).Browser === 'string');

async function spawnOwnedBrave(
  log: (line: string) => void,
  headless: boolean,
): Promise<BraveSession> {
  const port = await freePort();
  const profile = await mkdtemp(path.join(tmpdir(), 'cotw-brave-e2e-'));
  const cdpUrl = `http://127.0.0.1:${port}`;
  const service = await ensureService({
    name: `brave${headless ? ' (headless)' : ''}`,
    probeUrl: `${cdpUrl}/json/version`,
    spawnCmd: BRAVE,
    spawnArgs: braveArgs(port, profile, headless),
    isUp: cdpIsUp,
    spawn: childProcessSpawner(log),
    readyTimeoutMs: 20_000,
  });
  const cleanup = async (): Promise<void> => {
    await service.stop();
    try {
      rmSync(profile, { recursive: true, force: true });
    } catch {
      /* best-effort temp cleanup */
    }
  };
  try {
    const browser = await puppeteer.connect({ browserURL: cdpUrl, defaultViewport: null });
    log(`spawned owned brave on :${port} (profile ${path.basename(profile)})`);
    return {
      browser,
      service,
      async close() {
        // spawned + owned: disconnect, kill the tree, drop the profile
        await browser.disconnect();
        await cleanup();
      },
    };
  } catch (err) {
    // partial startup: the browser is running but puppeteer cannot use it
    await cleanup();
    throw err;
  }
}

export async function launchBrave(log: (line: string) => void = () => {}): Promise<BraveSession> {
  let lastError: unknown = null;
  for (const headless of [true, false]) {
    try {
      return await spawnOwnedBrave(log, headless);
    } catch (err) {
      lastError = err;
      log(`brave launch attempt failed: ${String(err)}`);
    }
  }
  throw new Error(`could not launch an isolated brave: ${String(lastError)}`);
}

/**
 * DEV-ONLY: attach to a browser already listening on 9222 (spawn one if none).
 * Never use this from acceptance runners — an attached session may belong to a
 * user, and stop() must not (and will not) kill it.
 */
export async function launchBraveAttached(
  log: (line: string) => void = () => {},
): Promise<BraveSession> {
  const service = await ensureService({
    name: 'brave (shared :9222, dev-only)',
    probeUrl: 'http://127.0.0.1:9222/json/version',
    spawnCmd: BRAVE,
    spawnArgs: braveArgs(9222, '/tmp/opencode/brave-e2e-profile', true),
    isUp: cdpIsUp,
    spawn: childProcessSpawner(log),
    readyTimeoutMs: 15_000,
  });
  if (service.owned) log('spawned shared brave on :9222 (dev-only attach point)');
  else log('attached to existing brave on :9222');
  const browser = await puppeteer.connect({
    browserURL: 'http://127.0.0.1:9222',
    defaultViewport: null,
  });
  return {
    browser,
    service,
    async close() {
      await browser.disconnect();
      await service.stop();
    },
  };
}

export type ViteService = OwnedService & { url: string };

const viteIsUp = htmlContainsIsUp(APP_MARKER);

async function spawnOwnedServer(
  name: string,
  args: string[],
  log: (line: string) => void,
  readyTimeoutMs: number,
): Promise<ViteService> {
  const port = await freePort();
  const url = `http://127.0.0.1:${port}/`;
  const service = await ensureService({
    name,
    probeUrl: url,
    spawnCmd: 'npx',
    spawnArgs: [...args, '--port', String(port), '--strictPort', '--host', '127.0.0.1'],
    isUp: viteIsUp,
    spawn: childProcessSpawner(log),
    readyTimeoutMs,
  });
  return { ...service, url };
}

/** Owned vite dev server on a unique port; probes for OUR app HTML. */
export async function ensureVite(log: (line: string) => void = () => {}): Promise<ViteService> {
  return spawnOwnedServer('vite dev server', ['vite'], log, 30_000);
}

/**
 * Production preview: `vite build` (once) then `vite preview` on a unique
 * port serving dist/. Probes for OUR app HTML, so a foreign server on any
 * probed port can never satisfy the check.
 */
export async function ensurePreview(
  log: (line: string) => void = () => {},
): Promise<ViteService> {
  const { execFile } = await import('node:child_process');
  await new Promise<void>((resolve, reject) => {
    execFile('npm', ['run', 'build'], { timeout: 180_000 }, (err, _stdout, stderr) => {
      if (err) reject(new Error(`production build failed: ${stderr.slice(0, 400)}`));
      else resolve();
    });
  });
  log('production build complete');
  return spawnOwnedServer('vite preview (production)', ['vite', 'preview'], log, 20_000);
}

/**
 * Nested-hosting server: serves `dist/` under a `/nested/` URL prefix so the
 * relative-asset base ('./') is exercised the way a sub-directory deploy runs.
 */
export async function ensureNested(
  log: (line: string) => void = () => {},
): Promise<ViteService & { baseUrl: string }> {
  const port = await freePort();
  const url = `http://127.0.0.1:${port}/nested/`;
  const service = await ensureService({
    name: 'nested static server',
    probeUrl: url,
    spawnCmd: process.execPath,
    spawnArgs: [path.join(import.meta.dirname, 'nested-server.mjs'), String(port)],
    isUp: viteIsUp,
    spawn: childProcessSpawner(log),
    readyTimeoutMs: 10_000,
  });
  return { ...service, url, baseUrl: url };
}

export async function newPage(browser: Browser, url: string): Promise<Page> {
  const page = await browser.newPage();
  // collectors registered BEFORE navigation (CODE-QUALITY Task 10)
  page.on('pageerror', (err) => console.error('[pageerror]', (err as Error).message));
  page.on('requestfailed', (req) =>
    console.error(`[requestfailed] ${req.url()} — ${req.failure()?.errorText ?? 'unknown'}`),
  );
  await page.goto(url, { waitUntil: 'load', timeout: 20_000 });
  return page;
}
