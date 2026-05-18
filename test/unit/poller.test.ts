import fs from "node:fs";
import path from "node:path";

import {
  describe,
  it,
  expect,
  jest,
  beforeEach,
  afterEach,
} from "@jest/globals";

// Mock Container before importing Poller
jest.unstable_mockModule("loadbench-kit/docker/container.js", () => ({
  default: jest
    .fn<() => { url: () => Promise<string> }>()
    .mockImplementation(() => ({
      url: jest
        .fn<() => Promise<string>>()
        .mockResolvedValue("http://localhost:8080"),
    })),
}));

const { Poller } = await import("loadbench-kit/metrics/poller.js");
const { default: Container } =
  await import("loadbench-kit/docker/container.js");

const PROMETHEUS_TEXT = fs.readFileSync(
  path.join(import.meta.dirname, "prometheus.txt"),
  "utf8",
);

const originalFetch = globalThis.fetch;
const mockFetch = jest.fn() as jest.MockedFunction<typeof fetch>;

beforeEach(() => {
  globalThis.fetch = mockFetch;
  mockFetch.mockReset();
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("Poller.snapshot", () => {
  it("returns a MetricsSample on successful fetch", async () => {
    mockFetch.mockResolvedValue(new Response(PROMETHEUS_TEXT, { status: 200 }));

    const sample = await Poller.snapshot("http://localhost:8080/metrics");

    expect(sample).not.toBeNull();
    expect(sample!.heapUsedBytes).toBe(5000000);
    expect(sample!.heapTotalBytes).toBe(10000000);
    expect(sample!.rssBytes).toBe(50000000);
    expect(sample!.activeHandles).toBe(5);
    expect(sample!.eventLoopLagSeconds).toBe(0.01);
    expect(sample!.timestampMs).toBeGreaterThan(0);
  });

  it("returns null when fetch responds with non-200", async () => {
    mockFetch.mockResolvedValue(
      new Response("Service Unavailable", { status: 503 }),
    );

    const sample = await Poller.snapshot("http://localhost:8080/metrics");
    expect(sample).toBeNull();
  });

  it("returns null when fetch throws a network error", async () => {
    mockFetch.mockRejectedValue(new Error("ECONNREFUSED"));

    const sample = await Poller.snapshot("http://localhost:8080/metrics");
    expect(sample).toBeNull();
  });

  it("auto-appends /metrics when target URL lacks it", async () => {
    mockFetch.mockResolvedValue(new Response(PROMETHEUS_TEXT, { status: 200 }));

    const sample = await Poller.snapshot("http://localhost:8080");

    expect(sample).not.toBeNull();
    expect(mockFetch).toHaveBeenCalledWith(
      "http://localhost:8080/metrics",
      expect.objectContaining({ signal: expect.anything() }),
    );
  });

  it("does not double-append /metrics when already present", async () => {
    mockFetch.mockResolvedValue(new Response(PROMETHEUS_TEXT, { status: 200 }));

    await Poller.snapshot("http://localhost:8080/metrics");

    expect(mockFetch).toHaveBeenCalledWith(
      "http://localhost:8080/metrics",
      expect.objectContaining({ signal: expect.anything() }),
    );
  });

  it("retries on failure and succeeds on later attempt", async () => {
    mockFetch
      .mockRejectedValueOnce(new Error("ECONNREFUSED"))
      .mockResolvedValueOnce(new Response(PROMETHEUS_TEXT, { status: 200 }));

    const sample = await Poller.snapshot(
      "http://localhost:8080/metrics",
      5_000,
      1,
    );

    expect(sample).not.toBeNull();
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it("returns null after all retry attempts are exhausted", async () => {
    mockFetch.mockRejectedValue(new Error("ECONNREFUSED"));

    const sample = await Poller.snapshot(
      "http://localhost:8080/metrics",
      5_000,
      2,
    );

    expect(sample).toBeNull();
    expect(mockFetch).toHaveBeenCalledTimes(3);
  });

  it("does not retry when retries is 0 (default)", async () => {
    mockFetch.mockRejectedValue(new Error("ECONNREFUSED"));

    const sample = await Poller.snapshot("http://localhost:8080/metrics");

    expect(sample).toBeNull();
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });
});

describe("Poller lifecycle", () => {
  beforeEach(() => {
    jest.useFakeTimers();
    mockFetch.mockResolvedValue(new Response(PROMETHEUS_TEXT, { status: 200 }));
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it("stop returns empty samples when start was called but no poll fired", async () => {
    const container = new (Container as any)() as InstanceType<
      typeof Container
    >;
    const poller = new Poller(container, 60_000);

    await poller.start();
    const samples = poller.stop();

    expect(samples).toEqual([]);
  });

  it("stop returns empty samples when never started", () => {
    const container = new (Container as any)() as InstanceType<
      typeof Container
    >;
    const poller = new Poller(container);
    const samples = poller.stop();

    expect(samples).toEqual([]);
  });

  it("warms up /metrics endpoint on start before polling begins", async () => {
    const container = new (Container as any)() as InstanceType<
      typeof Container
    >;
    const poller = new Poller(container, 60_000);

    await poller.start();
    poller.stop();

    // The warmup fetch should be the first call to mockFetch
    expect(mockFetch).toHaveBeenCalledWith(
      "http://localhost:8080/metrics",
      expect.objectContaining({ signal: expect.anything() }),
    );
  });

  it("starts polling even when warmup fetch fails", async () => {
    mockFetch
      .mockRejectedValueOnce(new Error("ECONNREFUSED"))
      .mockResolvedValue(new Response(PROMETHEUS_TEXT, { status: 200 }));

    const container = new (Container as any)() as InstanceType<
      typeof Container
    >;
    const poller = new Poller(container, 5_000);

    await poller.start();
    await jest.advanceTimersByTimeAsync(10_000);
    const samples = poller.stop();

    // Polling should still work despite warmup failure
    expect(samples.length).toBeGreaterThanOrEqual(1);
  });

  it("stop returns samples when at least one poll has fired", async () => {
    const container = new (Container as any)() as InstanceType<
      typeof Container
    >;
    const poller = new Poller(container, 5_000);
    await poller.start();
    await jest.advanceTimersByTimeAsync(10_000);
    const samples = poller.stop();
    expect(samples.length).toBeGreaterThanOrEqual(1);
  });
});
