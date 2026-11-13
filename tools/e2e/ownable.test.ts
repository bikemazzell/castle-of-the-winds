import { describe, expect, it, vi, afterEach } from 'vitest';
import { ensureService, jsonIsUp, htmlContainsIsUp, safeSignal, type IsUp, type ProcessHandle, type Spawner } from './ownable';

class FakeProcess implements ProcessHandle {
  pid: number;
  alive = true;
  signals: string[] = [];
  private spawnError: string | null = null;
  private exitWaiters: Array<() => void> = [];
  private static nextPid = 4200;

  constructor() {
    this.pid = FakeProcess.nextPid++;
  }

  /** Simulate a failed spawn (ENOENT etc.) — the handle reports it and exits. */
  fail(msg: string): void {
    this.spawnError = msg;
    this.die();
  }

  failure(): string | null {
    return this.spawnError;
  }

  signal(sig: NodeJS.Signals): void {
    this.signals.push(sig);
    if (sig === 'SIGKILL') this.die();
  }

  die(): void {
    if (!this.alive) return;
    this.alive = false;
    const waiters = this.exitWaiters.splice(0);
    for (const w of waiters) w();
  }

  exited(): Promise<void> {
    if (!this.alive) return Promise.resolve();
    return new Promise((resolve) => this.exitWaiters.push(resolve));
  }
}

describe('ensureService ownership contract', () => {
  const neverUp: IsUp = () => Promise.resolve(false);
  const alwaysUp: IsUp = () => Promise.resolve(true);

  function fakeSpawn(log: string[]): Spawner {
    return (cmd, args) => {
      const proc = new FakeProcess();
      log.push(`${cmd} ${args.join(' ')} pid=${proc.pid}`);
      return proc;
    };
  }

  it('attaches without spawning when the probe URL already answers, and stop() does not kill', async () => {
    const log: string[] = [];
    const service = await ensureService({
      name: 'brave',
      probeUrl: 'http://x/json/version',
      spawnCmd: '/usr/bin/brave',
      spawnArgs: ['--flag'],
      isUp: alwaysUp,
      spawn: fakeSpawn(log),
    });
    expect(service.owned).toBe(false);
    expect(log).toEqual([]);
    await service.stop();
    expect(log).toEqual([]);
  });

  /** Probe that answers only once a process has been spawned (log gets an entry). */
  const upAfterSpawn = (log: string[]): IsUp => () => Promise.resolve(log.length > 0);

  it('spawns when nothing answers and marks itself owned', async () => {
    const log: string[] = [];
    const service = await ensureService({
      name: 'vite',
      probeUrl: 'http://x/',
      spawnCmd: 'vite',
      spawnArgs: ['--port', '5173'],
      isUp: upAfterSpawn(log),
      spawn: fakeSpawn(log),
      pollMs: 2,
    });
    expect(service.owned).toBe(true);
    expect(log.length).toBe(1);
    await service.stop();
  });

  it('stop() on an owned service SIGTERMs first and never SIGKILLs a process that exits in time', async () => {
    const log: string[] = [];
    const spawned: FakeProcess[] = [];
    const spawn: Spawner = (cmd, args) => {
      const proc = new FakeProcess();
      spawned.push(proc);
      log.push(`spawn ${cmd} ${args.join(' ')}`);
      return proc;
    };
    const service = await ensureService({
      name: 'vite',
      probeUrl: 'http://x/',
      spawnCmd: 'vite',
      spawnArgs: [],
      isUp: upAfterSpawn(log),
      spawn,
    });
    // Process exits shortly after SIGTERM (simulate via microtask after signal)
    const origSignal = spawned[0]!.signal.bind(spawned[0]);
    spawned[0]!.signal = (sig) => {
      origSignal(sig);
      if (sig === 'SIGTERM') setTimeout(() => spawned[0]!.die(), 10);
    };
    await service.stop();
    expect(spawned[0]!.signals).toEqual(['SIGTERM']);
    expect(spawned[0]!.alive).toBe(false);
  });

  it('stop() escalates to SIGKILL when SIGTERM is ignored', async () => {
    const log: string[] = [];
    const spawned: FakeProcess[] = [];
    const spawn: Spawner = (cmd, _args) => {
      const proc = new FakeProcess();
      spawned.push(proc);
      log.push(cmd);
      return proc;
    };
    const service = await ensureService({
      name: 'brave',
      probeUrl: 'http://x/',
      spawnCmd: 'brave',
      spawnArgs: [],
      isUp: upAfterSpawn(log),
      spawn,
      killGraceMs: 30,
    });
    await service.stop();
    expect(spawned[0]!.signals).toEqual(['SIGTERM', 'SIGKILL']);
    expect(spawned[0]!.alive).toBe(false);
  });

  it('kills the spawned process and throws when it never becomes ready', async () => {
    const log: string[] = [];
    const spawned: FakeProcess[] = [];
    const spawn: Spawner = (cmd, _args) => {
      const proc = new FakeProcess();
      proc.signal = (sig) => {
        proc.signals.push(sig);
        proc.die();
      };
      spawned.push(proc);
      log.push(cmd);
      return proc;
    };
    await expect(
      ensureService({
        name: 'brave',
        probeUrl: 'http://x/',
        spawnCmd: 'brave',
        spawnArgs: [],
        isUp: neverUp,
        spawn,
        readyTimeoutMs: 20,
        pollMs: 2,
      }),
    ).rejects.toThrow(/brave.*did not become ready/i);
    expect(spawned[0]!.alive).toBe(false);
  });
});

describe('spawn failure and shutdown hardening (CODE-QUALITY Task 10)', () => {
  it('throws with the spawn error when the child fails to start (no pid ever)', async () => {
    const spawned: FakeProcess[] = [];
    const spawn: Spawner = (_cmd, _args) => {
      const proc = new FakeProcess();
      proc.fail('spawn brave ENOENT');
      spawned.push(proc);
      return proc;
    };
    await expect(
      ensureService({
        name: 'brave',
        probeUrl: 'http://x/',
        spawnCmd: 'brave',
        spawnArgs: [],
        isUp: () => Promise.resolve(false),
        spawn,
      }),
    ).rejects.toThrow(/brave.*failed to start.*ENOENT/i);
  });

  it('refuses to signal nonpositive pids (no kill(-1)/kill(0) accidents)', () => {
    const kills: Array<[number, NodeJS.Signals]> = [];
    const kill = (pid: number, sig: NodeJS.Signals): boolean => {
      kills.push([pid, sig]);
      return pid > 0; // process group absent — direct pid "succeeds"
    };
    expect(safeSignal(0, 'SIGTERM', kill)).toBe(false);
    expect(safeSignal(-1, 'SIGTERM', kill)).toBe(false);
    expect(kills).toEqual([]);
    expect(safeSignal(4242, 'SIGTERM', kill)).toBe(true);
    expect(kills).toEqual([
      [-4242, 'SIGTERM'], // group first (detached children)
      [4242, 'SIGTERM'], // then direct pid
    ]);
  });

  it('killTree gives up with a loud error after SIGKILL deadline (bounded shutdown)', async () => {
    const spawned: FakeProcess[] = [];
    const spawn: Spawner = (_cmd, _args) => {
      const proc = new FakeProcess();
      // ignores SIGTERM AND SIGKILL — exited() never resolves
      proc.signal = (sig) => {
        proc.signals.push(sig);
      };
      spawned.push(proc);
      return proc;
    };
    const service = await ensureService({
      name: 'stuck',
      probeUrl: 'http://x/',
      spawnCmd: 'stuck',
      spawnArgs: [],
      isUp: () => Promise.resolve(spawned.length > 0), // "up" only once spawned
      spawn,
      killGraceMs: 10,
      killCapMs: 30,
    });
    await expect(service.stop()).rejects.toThrow(/stuck.*did not exit after SIGKILL/i);
    expect(spawned[0]!.signals).toEqual(['SIGTERM', 'SIGKILL']);
  });
});

describe('protocol-aware probes (CODE-QUALITY Task 10)', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const stubFetch = (status: number, body: string): void => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(new Response(body, { status }))),
    );
  };

  it('jsonIsUp accepts only ok responses whose JSON satisfies the predicate', async () => {
    const probe = jsonIsUp((body) => typeof (body as { Browser?: string }).Browser === 'string');
    stubFetch(200, JSON.stringify({ Browser: 'Brave/1' }));
    expect(await probe('http://x/json/version', 50)).toBe(true);
    stubFetch(200, JSON.stringify({ unrelated: true }));
    expect(await probe('http://x/json/version', 50)).toBe(false);
    stubFetch(404, 'nope');
    expect(await probe('http://x/json/version', 50)).toBe(false);
    stubFetch(200, '<html>not json</html>');
    expect(await probe('http://x/json/version', 50)).toBe(false);
  });

  it('htmlContainsIsUp accepts only ok HTML responses containing the app marker', async () => {
    const probe = htmlContainsIsUp('Castle of the Winds');
    stubFetch(200, '<title>Castle of the Winds</title><div id="app"></div>');
    expect(await probe('http://x/', 50)).toBe(true);
    stubFetch(200, '<title>Some other vite app</title>');
    expect(await probe('http://x/', 50)).toBe(false);
    stubFetch(500, 'Castle of the Winds');
    expect(await probe('http://x/', 50)).toBe(false);
  });
});
