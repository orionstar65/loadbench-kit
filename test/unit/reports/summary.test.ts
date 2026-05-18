import { describe, it, expect } from "@jest/globals";
import summary from "loadbench-kit/reports/summary.js";
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

describe("summary report", () => {
  it("returns zero counts for empty input", () => {
    const report = summary([]);
    expect(report).toEqual({
      count: 0,
      success: 0,
      failure: 0,
      failureRate: 0,
      durationMs: 0,
      requestsPerSecond: 0,
    });
  });

  it("counts all 200s as success with failureRate 0", () => {
    const samples = [
      makeSample({ timestampMs: 1000, durationMs: 100 }),
      makeSample({ timestampMs: 1050, durationMs: 100 }),
      makeSample({ timestampMs: 1100, durationMs: 100 }),
    ];
    const report = summary(samples);
    expect(report.count).toBe(3);
    expect(report.success).toBe(3);
    expect(report.failure).toBe(0);
    expect(report.failureRate).toBe(0);
  });

  it("treats only 200 and 206 as success", () => {
    const samples = [
      makeSample({ status: 200 }),
      makeSample({ status: 206 }),
      makeSample({ status: 400 }),
      makeSample({ status: 500 }),
    ];
    const report = summary(samples);
    expect(report.count).toBe(4);
    expect(report.success).toBe(2);
    expect(report.failure).toBe(2);
    expect(report.failureRate).toBe(50);
  });

  it("returns failureRate 100 when all requests fail", () => {
    const samples = [
      makeSample({ status: 500 }),
      makeSample({ status: 500 }),
      makeSample({ status: 500 }),
    ];
    const report = summary(samples);
    expect(report.failureRate).toBe(100);
    expect(report.success).toBe(0);
    expect(report.failure).toBe(3);
  });

  it("handles a single sample correctly", () => {
    const samples = [makeSample({ timestampMs: 1000, durationMs: 200 })];
    const report = summary(samples);
    expect(report.count).toBe(1);
    expect(report.success).toBe(1);
    expect(report.durationMs).toBe(200);
    expect(report.requestsPerSecond).toBe(Math.round(1 / (200 / 1000)));
  });

  it("counts status 201 and 204 as failures (current behavior)", () => {
    const samples = [makeSample({ status: 201 }), makeSample({ status: 204 })];
    const report = summary(samples);
    expect(report.failure).toBe(2);
    expect(report.success).toBe(0);
    expect(report.failureRate).toBe(100);
  });
});
