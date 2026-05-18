import { describe, it, expect } from "@jest/globals";
import memory from "loadbench-kit/reports/memory.js";
import type { MetricsSample } from "loadbench-kit/samples.js";

function makeMetricsSample(
  overrides: Partial<MetricsSample> = {},
): MetricsSample {
  return {
    timestampMs: 1000,
    heapUsedBytes: 5e6,
    heapTotalBytes: 10e6,
    rssBytes: 50e6,
    activeHandles: 5,
    eventLoopLagSeconds: 0.01,
    ...overrides,
  };
}

describe("memory report", () => {
  it("returns NullReport for empty input", () => {
    const report = memory([]);
    expect(report.count).toBe(0);
    expect(report.trend).toBe("unknown");
    expect(report.baselineRssBytes).toBeNaN();
    expect(report.peakRssBytes).toBeNaN();
    expect(report.peakHeapUsedBytes).toBeNaN();
    expect(report.finalRssBytes).toBeNaN();
  });

  it("returns trend unknown for a single sample", () => {
    const samples = [makeMetricsSample()];
    const report = memory(samples);
    expect(report.count).toBe(1);
    expect(report.trend).toBe("unknown");
    expect(report.baselineRssBytes).toBe(50e6);
    expect(report.finalRssBytes).toBe(50e6);
  });

  it("detects stable RSS when growth is below 50MB threshold", () => {
    const samples = [
      makeMetricsSample({ rssBytes: 50e6 }),
      makeMetricsSample({ rssBytes: 55e6 }),
      makeMetricsSample({ rssBytes: 60e6 }),
    ];
    const report = memory(samples);
    expect(report.trend).toBe("stable");
    expect(report.baselineRssBytes).toBe(50e6);
    expect(report.finalRssBytes).toBe(60e6);
    expect(report.peakRssBytes).toBe(60e6);
  });

  it("detects growing RSS when growth exceeds 50MB threshold", () => {
    const baseline = 50e6;
    const growth = 51 * 1024 * 1024; // just over 50 MiB
    const samples = [
      makeMetricsSample({ rssBytes: baseline }),
      makeMetricsSample({ rssBytes: baseline + growth / 2 }),
      makeMetricsSample({ rssBytes: baseline + growth }),
    ];
    const report = memory(samples);
    expect(report.trend).toBe("growing");
  });

  it("reports stable when all RSS values are identical", () => {
    const samples = [
      makeMetricsSample({ rssBytes: 100e6 }),
      makeMetricsSample({ rssBytes: 100e6 }),
      makeMetricsSample({ rssBytes: 100e6 }),
    ];
    const report = memory(samples);
    expect(report.trend).toBe("stable");
    expect(report.peakRssBytes).toBe(100e6);
    expect(report.baselineRssBytes).toBe(100e6);
    expect(report.finalRssBytes).toBe(100e6);
  });

  it("reports stable when RSS decreases", () => {
    const samples = [
      makeMetricsSample({ rssBytes: 100e6 }),
      makeMetricsSample({ rssBytes: 80e6 }),
      makeMetricsSample({ rssBytes: 60e6 }),
    ];
    const report = memory(samples);
    expect(report.trend).toBe("stable");
    expect(report.peakRssBytes).toBe(100e6);
    expect(report.finalRssBytes).toBe(60e6);
  });
});
