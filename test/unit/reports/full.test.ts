import { describe, it, expect } from "@jest/globals";
import FullReport from "loadbench-kit/reports/full.js";
import type { Result, Tier } from "loadbench-kit/runner.js";
import type {
  ResponseSample,
  MetricsSample,
} from "loadbench-kit/samples.js";

function makeResult(overrides: Partial<Result> = {}): Result {
  return {
    tier: { name: "test", concurrency: 10, count: 100 },
    responses: [
      {
        url: "http://localhost/test",
        status: 200,
        durationMs: 100,
        timestampMs: 1000,
      },
      {
        url: "http://localhost/test",
        status: 200,
        durationMs: 200,
        timestampMs: 1100,
      },
    ],
    metrics: [
      {
        timestampMs: 1000,
        heapUsedBytes: 5e6,
        heapTotalBytes: 10e6,
        rssBytes: 50e6,
        activeHandles: 5,
        eventLoopLagSeconds: 0.01,
      },
    ],
    errors: [],
    elapsed: 1200,
    ...overrides,
  };
}

describe("full report", () => {
  it("composes summary, latency, and memory sub-reports from a populated result", () => {
    const result = makeResult();
    const report = FullReport(result);

    expect(report.summary).toBeDefined();
    expect(report.latency).toBeDefined();
    expect(report.memory).toBeDefined();
    expect(report.summary!.count).toBe(2);
    expect(report.latency!.minMs).toBe(100);
    expect(report.latency!.maxMs).toBe(200);
    expect(report.memory!.count).toBe(1);
  });

  it("returns zero/null sub-reports for empty responses and metrics", () => {
    const result = makeResult({ responses: [], metrics: [] });
    const report = FullReport(result);

    expect(report.summary).toBeDefined();
    expect(report.summary!.count).toBe(0);
    expect(report.summary!.failureRate).toBe(0);
    expect(report.latency).toBeDefined();
    expect(report.latency!.minMs).toBe(0);
    expect(report.latency!.maxMs).toBe(0);
    expect(report.memory).toBeDefined();
    expect(report.memory!.count).toBe(0);
    expect(report.memory!.trend).toBe("unknown");
  });

  it("passes tier through unchanged", () => {
    const tier: Tier = { name: "heavy", concurrency: 50, count: 500 };
    const result = makeResult({ tier });
    const report = FullReport(result);

    expect(report.tier).toEqual(tier);
    expect(report.tier.name).toBe("heavy");
    expect(report.tier.concurrency).toBe(50);
    expect(report.tier.count).toBe(500);
  });

  it("passes errors through unchanged", () => {
    const errors = ["timeout on request 3", "connection refused"];
    const result = makeResult({ errors });
    const report = FullReport(result);

    expect(report.errors).toEqual(errors);
    expect(report.errors).toHaveLength(2);
  });

  it("passes empty errors array through", () => {
    const result = makeResult({ errors: [] });
    const report = FullReport(result);

    expect(report.errors).toEqual([]);
  });
});
