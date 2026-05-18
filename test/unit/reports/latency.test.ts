import { describe, it, expect } from "@jest/globals";
import latency from "loadbench-kit/reports/latency.js";
import type { ResponseSample } from "loadbench-kit/samples.js";

function makeSample(overrides: Partial<ResponseSample> = {}): ResponseSample {
  return {
    url: "http://localhost/test",
    status: 200,
    durationMs: 100,
    timestampMs: 1000,
    ...overrides,
  };
}

describe("latency report", () => {
  it("returns zeros for empty input", () => {
    const report = latency([]);
    expect(report).toEqual({
      minMs: 0,
      p50Ms: 0,
      p90Ms: 0,
      p99Ms: 0,
      maxMs: 0,
      range: 0,
    });
  });

  it("computes correct percentiles for multiple samples", () => {
    // 10 samples with durations 10, 20, ..., 100
    const samples = Array.from({ length: 10 }, (_, i) =>
      makeSample({ durationMs: (i + 1) * 10 }),
    );
    const report = latency(samples);
    expect(report.minMs).toBe(10);
    expect(report.maxMs).toBe(100);
    expect(report.range).toBe(90);
    expect(report.p50Ms).toBe(50);
    expect(report.p90Ms).toBe(90);
    expect(report.p99Ms).toBe(100);
  });

  it("returns the same value for all percentiles with a single sample", () => {
    const samples = [makeSample({ durationMs: 42 })];
    const report = latency(samples);
    expect(report.minMs).toBe(42);
    expect(report.maxMs).toBe(42);
    expect(report.p50Ms).toBe(42);
    expect(report.p90Ms).toBe(42);
    expect(report.p99Ms).toBe(42);
    expect(report.range).toBe(0);
  });

  it("returns range 0 when all durations are identical", () => {
    const samples = Array.from({ length: 5 }, () =>
      makeSample({ durationMs: 75 }),
    );
    const report = latency(samples);
    expect(report.range).toBe(0);
    expect(report.minMs).toBe(75);
    expect(report.maxMs).toBe(75);
  });

  it("handles two samples correctly", () => {
    const samples = [
      makeSample({ durationMs: 10 }),
      makeSample({ durationMs: 90 }),
    ];
    const report = latency(samples);
    expect(report.minMs).toBe(10);
    expect(report.maxMs).toBe(90);
    expect(report.range).toBe(80);
  });
});
