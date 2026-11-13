import { spawn as nodeSpawn, type ChildProcess } from 'node:child_process';

/**
 * Ownership contract for externally-managed processes (Brave, vite dev server).
 *
 * Rules (plan Task 0.3):
 * - If the probe URL already answers, we ATTACH: owned=false, and stop() must
 *   never kill a process we did not start.
 * - If we spawn it, owned=true and stop() kills exactly that process:
 *   SIGTERM first, then SIGKILL after a grace period.
 * - Anything we spawn that never becomes ready is killed before throwing.
 */

export interface ProcessHandle {
  readonly pid: number;
  /** Non-null when the spawn itself failed (e.g. ENOENT); the process never ran. */
  failure(): string | null;
  signal(sig: NodeJS.Signals): void;
  exited(): Promise<void>;
}

export type Spawner = (cmd: string, args: string[], opts: { cwd?: string }) => ProcessHandle;

/** Returns true when `url` answers within `timeoutMs`. Never throws. */
export type IsUp = (url: string, timeoutMs: number) => Promise<boolean>;

export interface OwnedService {
  readonly url: string;
  readonly owned: boolean;
  /** Kill only if owned; otherwise a no-op (we attached to someone else's process). */
  stop(): Promise<void>;
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export async function ensureService(opts: {
  name: string;
  probeUrl: string;
  spawnCmd: string;
  spawnArgs: string[];
  cwd?: string;
  isUp: IsUp;
  spawn: Spawner;
  readyTimeoutMs?: number;
  pollMs?: number;
  killGraceMs?: number;
  /** Cap on the post-SIGKILL wait before giving up loudly (default 5s). */
  killCapMs?: number;
}): Promise<OwnedService> {
  const { name, probeUrl, spawnCmd, spawnArgs, isUp, spawn } = opts;
  const readyTimeoutMs = opts.readyTimeoutMs ?? 20_000;
  const pollMs = opts.pollMs ?? 250;
  const killGraceMs = opts.killGraceMs ?? 3_000;
  const killCapMs = opts.killCapMs ?? 5_000;

  if (await isUp(probeUrl, 750)) {
    return { url: probeUrl, owned: false, stop: async () => {} };
  }

  const proc = spawn(spawnCmd, spawnArgs, { cwd: opts.cwd });
  const startFailure = proc.failure();
  if (startFailure || proc.pid <= 0) {
    await killTree(name, proc, killGraceMs, killCapMs);
    throw new Error(`${name} failed to start: ${startFailure ?? `no process id (pid ${proc.pid})`}`);
  }
  const deadline = Date.now() + readyTimeoutMs;
  for (;;) {
    const failure = proc.failure();
    if (failure) {
      await killTree(name, proc, killGraceMs, killCapMs);
      throw new Error(`${name} failed to start: ${failure}`);
    }
    if (await isUp(probeUrl, 750)) break;
    if (Date.now() >= deadline) {
      await killTree(name, proc, killGraceMs, killCapMs);
      throw new Error(
        `${name} (pid ${proc.pid}) did not become ready at ${probeUrl} within ${readyTimeoutMs}ms`,
      );
    }
    await sleep(pollMs);
  }

  return {
    url: probeUrl,
    owned: true,
    stop: () => killTree(name, proc, killGraceMs, killCapMs),
  };
}

async function killTree(
  name: string,
  proc: ProcessHandle,
  graceMs: number,
  killCapMs: number,
): Promise<void> {
  proc.signal('SIGTERM');
  const died = await Promise.race([proc.exited().then(() => true), sleep(graceMs).then(() => false)]);
  if (!died) {
    proc.signal('SIGKILL');
    const killed = await Promise.race([
      proc.exited().then(() => true),
      sleep(killCapMs).then(() => false),
    ]);
    if (!killed) {
      throw new Error(`${name} did not exit after SIGKILL (pid ${proc.pid}) — giving up`);
    }
  }
}

/**
 * Signal a pid safely: refuses nonpositive pids outright (kill(-1)/kill(0)
 * would target the wrong thing), tries the process group first (detached
 * children), then the direct pid. Returns true when any signal was delivered.
 */
export function safeSignal(
  pid: number,
  sig: NodeJS.Signals,
  kill: (pid: number, sig: NodeJS.Signals) => boolean = process.kill.bind(process),
): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    if (kill(-pid, sig)) return true;
  } catch {
    /* group gone or permission denied */
  }
  try {
    return kill(pid, sig);
  } catch {
    return false;
  }
}

/** Real spawner backed by node:child_process. */
export function childProcessSpawner(log?: (line: string) => void): Spawner {
  return (cmd, args, opts): ProcessHandle => {
    const child: ChildProcess = nodeSpawn(cmd, args, {
      cwd: opts.cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: true, // own process group so SIGTERM reaches brave's children
    });
    if (log) {
      child.stdout?.on('data', (d: Buffer) => log(`[stdout] ${d.toString().trim()}`));
      child.stderr?.on('data', (d: Buffer) => log(`[stderr] ${d.toString().trim()}`));
    }
    let spawnError: string | null = null;
    const exitWaiters: Array<() => void> = [];
    const release = (): void => {
      const ws = exitWaiters.splice(0);
      for (const w of ws) w();
    };
    child.on('error', (err: NodeJS.ErrnoException) => {
      // e.g. ENOENT — the process never started; surface it via failure()
      spawnError = `${cmd}: ${err.message}${err.code ? ` (${err.code})` : ''}`;
      release();
    });
    child.on('exit', release);
    return {
      pid: child.pid ?? -1,
      failure: () => spawnError,
      signal(sig) {
        if (child.pid === undefined) return;
        // negative pid = process group (detached) with direct-pid fallback
        safeSignal(child.pid, sig);
      },
      exited() {
        if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve();
        if (spawnError !== null) return Promise.resolve();
        return new Promise<void>((resolve) => exitWaiters.push(resolve));
      },
    };
  };
}

/** Real IsUp backed by fetch; treats any HTTP response (even 404/500) as "up". Legacy/dev use. */
export const httpIsUp: IsUp = async (url, timeoutMs) => {
  try {
    const ac = new AbortController();
    const t = setTimeout(() => ac.abort(), timeoutMs);
    try {
      const res = await fetch(url, { signal: ac.signal });
      return res.status > 0;
    } finally {
      clearTimeout(t);
    }
  } catch {
    return false;
  }
};

/**
 * Probe factory: expects an ok HTTP response whose body parses as JSON and
 * satisfies `check` — distinguishes OUR service from whatever else answers.
 */
export const jsonIsUp =
  (check: (body: unknown) => boolean): IsUp =>
  async (url, timeoutMs) => {
    try {
      const ac = new AbortController();
      const t = setTimeout(() => ac.abort(), timeoutMs);
      try {
        const res = await fetch(url, { signal: ac.signal });
        if (!res.ok) return false;
        return check(await res.json());
      } finally {
        clearTimeout(t);
      }
    } catch {
      return false;
    }
  };

/** Probe factory: expects an ok HTML response containing `marker`. */
export const htmlContainsIsUp =
  (marker: string): IsUp =>
  async (url, timeoutMs) => {
    try {
      const ac = new AbortController();
      const t = setTimeout(() => ac.abort(), timeoutMs);
      try {
        const res = await fetch(url, { signal: ac.signal });
        if (!res.ok) return false;
        return (await res.text()).includes(marker);
      } finally {
        clearTimeout(t);
      }
    } catch {
      return false;
    }
  };
