import {
  describe,
  it,
  expect,
  jest,
  beforeEach,
  afterEach,
} from "@jest/globals";
import { EventEmitter } from "node:events";

// --- Mock setup (all mocks before dynamic import) ---

const mockWorkerInstances: EventEmitter[] = [];

// When set, each newly created Worker is auto-driven via this callback.
// When null, workers must be driven manually (existing test pattern).
type WorkerHandler = (worker: EventEmitter, index: number) => void;
let workerHandler: WorkerHandler | null = null;

jest.unstable_mockModule("node:os", () => ({
  default: { cpus: () => new Array(8).fill({}) }, // 8 CPUs -> MAX_WORKERS = 7
}));

jest.unstable_mockModule("node:worker_threads", () => ({
  Worker: jest.fn().mockImplementation(() => {
    const emitter = new EventEmitter();
    const index = mockWorkerInstances.length;
    Object.assign(emitter, {
      threadId: index + 1,
      removeAllListeners: jest.fn(),
    });
    mockWorkerInstances.push(emitter);
    if (workerHandler) {
      const handler = workerHandler;
      queueMicrotask(() => handler(emitter, index));
    }
    return emitter;
  }),
  WorkerOptions: {},
}));

jest.unstable_mockModule("loadbench-kit/docker/container.js", () => ({
  default: jest.fn<() => Record<string, unknown>>().mockImplementation(() => ({
    isRunning: jest.fn<() => Promise<boolean>>().mockResolvedValue(true),
    serialize: jest
      .fn<() => Promise<Record<string, string>>>()
      .mockResolvedValue({
        name: "test",
        service: "app",
        url: "http://localhost:8080",
      }),
  })),
  ContainerInfo: {},
}));

jest.unstable_mockModule("loadbench-kit/metrics/poller.js", () => ({
  Poller: jest.fn<() => Record<string, unknown>>().mockImplementation(() => ({
    start: jest.fn<() => Promise<void>>().mockResolvedValue(undefined),
    stop: jest.fn<() => unknown[]>().mockReturnValue([]),
  })),
}));

jest.unstable_mockModule("loadbench-kit/utils.js", () => ({
  waitFor: jest
    .fn<(fn: () => unknown) => Promise<void>>()
    .mockImplementation(async (fn) => {
      await fn();
    }),
}));

// Mock fetch globally
const originalFetch = globalThis.fetch;
const mockFetch = jest.fn() as jest.MockedFunction<typeof fetch>;

// Dynamic imports (after all mocks)
const runnerModule = await import("loadbench-kit/runner.js");
const runner = runnerModule.default;
// rampUntil and RAMP_ITERATION_LIMIT are imported loosely so the test suite
// compiles before the exports exist (TDD: tests are written before src/).
const rampUntil = (runnerModule as any).rampUntil as (
  tiers: Generator<any>,
  workload: any,
  container: any,
  shouldStop: (result: any) => boolean,
) => Promise<any[]>;
const RAMP_ITERATION_LIMIT = (runnerModule as any)
  .RAMP_ITERATION_LIMIT as number;
const { default: Container } =
  await import("loadbench-kit/docker/container.js");
const { Worker: MockWorker } = await import("node:worker_threads");

beforeEach(() => {
  mockWorkerInstances.length = 0;
  workerHandler = null;
  jest.clearAllMocks();
  globalThis.fetch = mockFetch;
  mockFetch.mockResolvedValue(new Response("OK", { status: 200 }));
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("runner", () => {
  function makeContainer() {
    return new (Container as any)() as InstanceType<typeof Container>;
  }

  describe("count === 0 short-circuits", () => {
    it("returns immediately with empty arrays and elapsed 0", async () => {
      const container = makeContainer();
      const result = await runner(
        { name: "empty", concurrency: 10, count: 0 },
        { filename: "worker.js", options: {} },
        container,
      );

      expect(result.elapsed).toBe(0);
      expect(result.responses).toEqual([]);
      expect(result.metrics).toEqual([]);
      expect(result.errors).toEqual([]);
      expect(MockWorker).not.toHaveBeenCalled();
    });
  });

  describe("happy path: workers emit messages and exit", () => {
    it("collects responses from all workers", async () => {
      const tier = { name: "test", concurrency: 2, count: 10 };
      const work = { filename: "worker.js", options: {} };
      const container = makeContainer();

      const resultPromise = runner(tier, work, container);

      // Wait for workers to be created
      await new Promise((r) => setTimeout(r, 0));

      expect(mockWorkerInstances).toHaveLength(2);

      for (const worker of mockWorkerInstances) {
        worker.emit("message", {
          url: "http://localhost/test",
          status: 200,
          durationMs: 50,
          timestampMs: Date.now(),
        });
        worker.emit("exit", 0);
      }

      const result = await resultPromise;
      expect(result.responses).toHaveLength(2);
      expect(result.errors).toEqual([]);
      expect(result.elapsed).toBeGreaterThan(0);
      expect(result.tier).toBe(tier);
    });
  });

  describe("error in message routing", () => {
    it("routes messages with error field to errors array", async () => {
      const tier = { name: "error-test", concurrency: 1, count: 5 };
      const work = { filename: "worker.js", options: {} };
      const container = makeContainer();

      const resultPromise = runner(tier, work, container);
      await new Promise((r) => setTimeout(r, 0));

      expect(mockWorkerInstances).toHaveLength(1);

      const worker = mockWorkerInstances[0];
      worker.emit("message", {
        url: "http://localhost/test",
        status: 500,
        durationMs: 50,
        timestampMs: Date.now(),
        error: "Server error",
      });
      worker.emit("message", {
        url: "http://localhost/test",
        status: 200,
        durationMs: 30,
        timestampMs: Date.now(),
      });
      worker.emit("exit", 0);

      const result = await resultPromise;
      expect(result.errors).toEqual(["Server error"]);
      expect(result.responses).toHaveLength(1);
      expect(result.responses[0].status).toBe(200);
    });
  });

  describe("worker error + exit", () => {
    it("handles worker error event then exit, promise still resolves", async () => {
      const consoleSpy = jest
        .spyOn(console, "error")
        .mockImplementation(() => {});
      // Use concurrency=2 so two workers are spawned. The error handler
      // decrements activeWorkers, so we need the second healthy worker's
      // exit to bring the count to zero and resolve the promise.
      const tier = { name: "worker-error", concurrency: 2, count: 10 };
      const work = { filename: "worker.js", options: {} };
      const container = makeContainer();

      const resultPromise = runner(tier, work, container);
      await new Promise((r) => setTimeout(r, 0));

      expect(mockWorkerInstances).toHaveLength(2);

      // Worker 1 errors then exits
      mockWorkerInstances[0].emit("error", new Error("Worker crashed"));
      mockWorkerInstances[0].emit("exit", 1);

      // Worker 2 exits cleanly — this resolves the promise
      mockWorkerInstances[1].emit("message", {
        url: "http://localhost/ok",
        status: 200,
        durationMs: 25,
        timestampMs: Date.now(),
      });
      mockWorkerInstances[1].emit("exit", 0);

      const result = await resultPromise;
      expect(result.responses).toHaveLength(1);
      expect(result.elapsed).toBeGreaterThan(0);
      expect(consoleSpy).toHaveBeenCalled();

      consoleSpy.mockRestore();
    });
  });

  describe("thread count calculation", () => {
    it("caps threads at concurrency when less than MAX_WORKERS", async () => {
      // MAX_WORKERS = 7 (8 CPUs - 1), concurrency = 3 -> threads = 3
      const tier = { name: "thread-calc", concurrency: 3, count: 9 };
      const work = { filename: "worker.js", options: {} };
      const container = makeContainer();

      const resultPromise = runner(tier, work, container);
      await new Promise((r) => setTimeout(r, 0));

      // Should spawn min(3, 7) = 3 workers
      expect(mockWorkerInstances).toHaveLength(3);
      expect(MockWorker).toHaveBeenCalledTimes(3);

      // Exit all workers to resolve
      for (const worker of mockWorkerInstances) {
        worker.emit("exit", 0);
      }

      await resultPromise;
    });

    it("caps threads at MAX_WORKERS when concurrency exceeds it", async () => {
      // MAX_WORKERS = 7, concurrency = 20 -> threads = 7
      const tier = { name: "high-concurrency", concurrency: 20, count: 100 };
      const work = { filename: "worker.js", options: {} };
      const container = makeContainer();

      const resultPromise = runner(tier, work, container);
      await new Promise((r) => setTimeout(r, 0));

      // Should spawn min(20, 7) = 7 workers
      expect(mockWorkerInstances).toHaveLength(7);
      expect(MockWorker).toHaveBeenCalledTimes(7);

      for (const worker of mockWorkerInstances) {
        worker.emit("exit", 0);
      }

      await resultPromise;
    });
  });

  describe("multiple workers with mixed messages", () => {
    it("aggregates responses and errors from all workers", async () => {
      const tier = { name: "mixed", concurrency: 3, count: 30 };
      const work = { filename: "worker.js", options: {} };
      const container = makeContainer();

      const resultPromise = runner(tier, work, container);
      await new Promise((r) => setTimeout(r, 0));

      expect(mockWorkerInstances).toHaveLength(3);

      // Worker 1: success
      mockWorkerInstances[0].emit("message", {
        url: "http://localhost/a",
        status: 200,
        durationMs: 10,
        timestampMs: Date.now(),
      });
      // Worker 2: error message
      mockWorkerInstances[1].emit("message", {
        url: "http://localhost/b",
        status: 500,
        durationMs: 20,
        timestampMs: Date.now(),
        error: "Timeout",
      });
      // Worker 3: success
      mockWorkerInstances[2].emit("message", {
        url: "http://localhost/c",
        status: 200,
        durationMs: 15,
        timestampMs: Date.now(),
      });

      for (const worker of mockWorkerInstances) {
        worker.emit("exit", 0);
      }

      const result = await resultPromise;
      expect(result.responses).toHaveLength(2);
      expect(result.errors).toEqual(["Timeout"]);
    });
  });
});

describe("rampUntil", () => {
  // Use concurrency: 1 so each tier spawns exactly 1 worker.
  // The workerHandler index then maps 1:1 to tier index.
  interface Tier {
    name: string;
    concurrency: number;
    count: number;
  }

  function makeTier(name: string, count = 10): Tier {
    return { name, concurrency: 1, count };
  }

  function* finiteTiers(n: number): Generator<Tier> {
    for (let i = 0; i < n; i++) yield makeTier(`tier-${i}`);
  }

  function* infiniteTiers(): Generator<Tier> {
    let i = 0;
    while (true) yield makeTier(`tier-${i++}`);
  }

  const workload = { filename: "worker.js", options: {} };

  function makeContainer() {
    return new (Container as any)() as any;
  }

  function sample(overrides: Record<string, unknown> = {}) {
    return {
      url: "http://localhost/test",
      status: 200,
      durationMs: 50,
      timestampMs: Date.now(),
      ...overrides,
    };
  }

  it("stops when shouldStop returns true (breach detection)", async () => {
    // Tier 0-1: clean, Tier 2: has errors → shouldStop fires
    workerHandler = (worker, index) => {
      if (index === 2) {
        worker.emit("message", sample({ error: "breach", status: 500 }));
      } else {
        worker.emit("message", sample());
      }
      worker.emit("exit", 0);
    };

    const container = makeContainer();
    const results = await rampUntil(
      finiteTiers(5),
      workload,
      container,
      (result) => result.errors.length > 0,
    );

    expect(results).toHaveLength(3);
    expect(results[2].errors).toContain("breach");
  });

  it("stops at RAMP_ITERATION_LIMIT when shouldStop never fires", async () => {
    workerHandler = (worker) => {
      worker.emit("message", sample());
      worker.emit("exit", 0);
    };

    const container = makeContainer();
    const results = await rampUntil(
      infiniteTiers(),
      workload,
      container,
      () => false,
    );

    expect(results).toHaveLength(RAMP_ITERATION_LIMIT);
  });

  it("returns accumulated results when generator exhausts", async () => {
    workerHandler = (worker) => {
      worker.emit("message", sample());
      worker.emit("exit", 0);
    };

    const container = makeContainer();
    const results = await rampUntil(
      finiteTiers(3),
      workload,
      container,
      () => false,
    );

    expect(results).toHaveLength(3);
  });

  it("includes the breaching tier in results", async () => {
    // shouldStop fires on tier index 1 (second tier)
    workerHandler = (worker, index) => {
      worker.emit("message", sample(index >= 1 ? { error: "fail" } : {}));
      worker.emit("exit", 0);
    };

    const container = makeContainer();
    const results = await rampUntil(
      finiteTiers(5),
      workload,
      container,
      (result) => result.errors.length > 0,
    );

    expect(results).toHaveLength(2);
    expect(results[1].errors).toContain("fail");
    expect(results[1].tier.name).toBe("tier-1");
  });

  it("propagates runner errors (accumulated results are lost)", async () => {
    workerHandler = (worker) => {
      worker.emit("message", sample());
      worker.emit("exit", 0);
    };

    // Make the container's isRunning reject on the second tier to simulate
    // a crash between tiers. waitFor calls isRunning, which throws,
    // propagating through rampUntil.
    let isRunningCallCount = 0;
    const container = makeContainer();
    (container.isRunning as any).mockImplementation(async () => {
      if (++isRunningCallCount > 1) throw new Error("Container crashed");
      return true;
    });

    await expect(
      rampUntil(finiteTiers(3), workload, container, () => false),
    ).rejects.toThrow("Container crashed");
  });

  it("forwards correct tier, workload, and container to runner", async () => {
    workerHandler = (worker) => {
      worker.emit("message", sample());
      worker.emit("exit", 0);
    };

    const container = makeContainer();
    const results = await rampUntil(
      finiteTiers(3),
      workload,
      container,
      () => false,
    );

    // Each result should contain the matching generated tier
    expect(results[0].tier).toEqual({
      name: "tier-0",
      concurrency: 1,
      count: 10,
    });
    expect(results[1].tier).toEqual({
      name: "tier-1",
      concurrency: 1,
      count: 10,
    });
    expect(results[2].tier).toEqual({
      name: "tier-2",
      concurrency: 1,
      count: 10,
    });
  });
});
