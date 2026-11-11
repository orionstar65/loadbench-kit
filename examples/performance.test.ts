/**
 * Example: full performance test suite with report generation.
 *
 * Demonstrates how to combine multiple test categories (probe, crawl,
 * download), collect results across all of them, and write a unified
 * Markdown + JSON report using {@link writeReport} with summary sections
 * built from {@link kvTable}, {@link mdTable}, and {@link ms}.
 *
 * Copy this file into your connector's `test/performance/` directory and
 * adapt the workers, thresholds, and summary sections to your use case.
 */
import os from "node:os";
import path from "path";
import { afterAll, beforeAll, describe, test, expect, jest } from "@jest/globals";

import Container from "loadbench-kit/docker/container.js";
import runner, { rampUntil, type Workload, type Tier, type Result } from "loadbench-kit/runner.js";
import { composite, linear, constant } from "loadbench-kit/generators.js";
import Report, { type FullReport } from "loadbench-kit/reports/full.js";
import SummaryReport from "loadbench-kit/reports/summary.js";
import LatencyReport from "loadbench-kit/reports/latency.js";
import { mb } from "loadbench-kit/utils.js";
import { writeReport, kvTable, mdTable, ms } from "loadbench-kit/reports/write.js";

// ---------------------------------------------------------------------------
// Configuration — adjust these for your connector
// ---------------------------------------------------------------------------

const PROJECT_ROOT = path.resolve(import.meta.dirname, "..");
const CONTAINER_NAME = "performance-test-app-1";
const SERVICE_NAME = "app";

/** Stop probing after this concurrency level. */
const MAX_PROBE_CONCURRENCY = 256;

/** RSS ceiling — fail if peak RSS exceeds this. */
const RSS_SAFE_THRESHOLD_BYTES = 700 * 1024 * 1024;

jest.setTimeout(300_000);

// ---------------------------------------------------------------------------
// Shared state — results collected across all test suites
// ---------------------------------------------------------------------------

const container = new Container(PROJECT_ROOT, CONTAINER_NAME, SERVICE_NAME);
let containerUrl = "";
const allResults: Result[] = [];

/** Common stop condition: >10% errors or p99 > 30s. */
function shouldStop(result: Result): boolean {
  if (result.responses.length === 0) return true;
  const summary = SummaryReport(result.responses);
  const latency = LatencyReport(result.responses);
  return summary.failureRate > 10 || latency.p99Ms > 30_000;
}

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

beforeAll(async () => {
  await container.up();
  containerUrl = await container.url();
}, 120_000);

afterAll(async () => {
  // -------------------------------------------------------------------------
  // Write report with summary sections
  // -------------------------------------------------------------------------
  if (allResults.length > 0) {
    const outputDir = path.resolve(PROJECT_ROOT, "test-results");

    // -- Environment section ------------------------------------------------
    const stats = await container.stats().catch(() => null);
    const serviceConf = await container.serviceConfig().catch(() => null);
    const memLimit = serviceConf?.deploy?.resources?.limits?.memory;

    const envEntries: Record<string, string> = {
      Node: process.version,
      Platform: `${os.platform()} ${os.arch()}`,
      "Host CPUs": String(os.cpus().length),
      "Host Memory": `${(os.totalmem() / 1024 ** 3).toFixed(0)} GB`,
    };
    if (serviceConf?.image) envEntries["Image"] = serviceConf.image;
    if (memLimit) envEntries["Container Memory Limit"] = mb(Number(memLimit));
    if (stats) {
      envEntries["Container Memory Usage"] =
        `${stats.MemUsage.Usage.value}${stats.MemUsage.Usage.units}`;
      envEntries["Container CPU Usage"] = String(stats.CPUPerc);
    }

    // -- Test configuration section -----------------------------------------
    const configEntries: Record<string, string> = {
      "Max Probe Concurrency": String(MAX_PROBE_CONCURRENCY),
      "RSS Safe Threshold": mb(RSS_SAFE_THRESHOLD_BYTES),
      "Jest Timeout": ms(300_000),
    };

    // -- Recommendations section --------------------------------------------
    const reports = allResults.map(Report);
    const withMemory = reports.filter((r) => r.memory && r.memory.count > 0);
    const withSummary = reports.filter((r) => r.summary);

    const peakRssBytes = withMemory.length > 0
      ? Math.max(...withMemory.map((r) => r.memory!.peakRssBytes))
      : NaN;
    const peakHeapBytes = withMemory.length > 0
      ? Math.max(...withMemory.map((r) => r.memory!.peakHeapUsedBytes))
      : NaN;
    const stableTiers = withSummary.filter((r) => r.summary!.failureRate < 1);
    const maxStableConcurrency = stableTiers.length > 0
      ? Math.max(...stableTiers.map((r) => r.tier.concurrency))
      : 0;
    const hasLeak = withMemory.some((r) => r.memory!.trend === "growing");

    const recommendedMb = !isNaN(peakRssBytes)
      ? Math.ceil((peakRssBytes * 1.5) / (128 * 1024 * 1024)) * 128
      : NaN;

    const summary = [
      kvTable("Environment", envEntries),
      "",
      kvTable("Test Configuration", configEntries),
      "",
      mdTable("Recommendations", ["Metric", "Observed", "Recommendation"], [
        [
          "Peak RSS",
          mb(peakRssBytes),
          !isNaN(recommendedMb) ? `Memory limit: ${recommendedMb} MB` : "N/A",
        ],
        [
          "Peak Heap",
          mb(peakHeapBytes),
          !isNaN(peakHeapBytes)
            ? `\`--max-old-space-size=${Math.ceil((peakHeapBytes * 2) / (1024 * 1024))}\``
            : "N/A",
        ],
        [
          "Max Stable Concurrency",
          maxStableConcurrency > 0 ? String(maxStableConcurrency) : "N/A",
          maxStableConcurrency > 0
            ? `Keep below ${maxStableConcurrency} concurrent requests`
            : "Insufficient data",
        ],
        [
          "Memory Trend",
          hasLeak ? "growing" : "stable",
          hasLeak ? "Investigate potential memory leak" : "No action needed",
        ],
      ]),
    ].join("\n");

    writeReport(allResults, outputDir, {
      title: "example-connector",
      summary,
    });
    console.log(`\nReport written to ${outputDir}/`);
  }

  try {
    await container.down();
  } catch {
    // best-effort teardown
  }
});

// ---------------------------------------------------------------------------
// Probe — ramp /alive until breach
// ---------------------------------------------------------------------------

describe("Probe — ramp /alive", () => {
  const workload: Workload = {
    filename: new URL("workers/healthcheck.ts", import.meta.url).toString(),
    options: { execArgv: ["--"] },
  };

  const tiers = composite<Tier>({
    name: constant("probe"),
    concurrency: linear(5, 5), // 5, 10, 15, 20, ...
    count: constant(200),
  });

  function probeStop(result: Result): boolean {
    return shouldStop(result) || result.tier.concurrency >= MAX_PROBE_CONCURRENCY;
  }

  test("finds the breaking tier", async () => {
    const results = await rampUntil(tiers, workload, container, probeStop);
    allResults.push(...results);
    expect(results.length).toBeGreaterThanOrEqual(1);

    const first = SummaryReport(results[0].responses);
    expect(first.failureRate).toBeLessThan(10);
  });
});

// ---------------------------------------------------------------------------
// Crawl — ramp content listing
// ---------------------------------------------------------------------------

describe("Crawl — ramp content listing", () => {
  const workload: Workload = {
    filename: new URL("workers/crawler.ts", import.meta.url).toString(),
    options: { execArgv: ["--"] },
  };

  const tiers = composite<Tier>({
    name: constant("crawl"),
    concurrency: linear(2, 2), // 2, 4, 6, 8, ...
    count: constant(50),
  });

  function crawlStop(result: Result): boolean {
    return shouldStop(result) || result.tier.concurrency >= 12;
  }

  test("finds the breaking tier", async () => {
    const results = await rampUntil(tiers, workload, container, crawlStop);
    allResults.push(...results);
    expect(results.length).toBeGreaterThanOrEqual(1);
  });
});

// ---------------------------------------------------------------------------
// Concurrency ramp — memory regression guard
// ---------------------------------------------------------------------------

describe("Ramp — memory regression guard", () => {
  const reports: FullReport[] = [];

  const tiers: Tier[] = [
    { name: "ramp", concurrency: 1, count: 10 },
    { name: "ramp", concurrency: 2, count: 10 },
    { name: "ramp", concurrency: 4, count: 10 },
    { name: "ramp", concurrency: 8, count: 10 },
  ];

  test.each(tiers)(
    "$name — concurrency=$concurrency",
    async (tier) => {
      const workload: Workload = {
        filename: new URL("workers/crawler.ts", import.meta.url).toString(),
        options: { execArgv: ["--"] },
      };

      const result = await runner(tier, workload, container);
      allResults.push(result);
      reports.push(Report(result));

      if (reports.at(-1)?.memory?.peakRssBytes) {
        expect(reports.at(-1)!.memory!.peakRssBytes).toBeLessThan(
          RSS_SAFE_THRESHOLD_BYTES,
        );
      }

      expect(await container.isOomKilled()).toBe(false);
    },
  );

  test("no growing memory trend", () => {
    const withMemory = reports.filter((r) => r.memory && r.memory.count > 0);
    for (const r of withMemory) {
      expect(r.memory!.trend).not.toBe("growing");
    }
  });
});
