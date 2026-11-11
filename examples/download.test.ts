import path from "path";
import { afterAll, describe, test, expect, jest, beforeAll } from "@jest/globals";

import Container from "loadbench-kit/docker/container.js";
import { rampUntil, type Workload, type Tier, type Result } from "loadbench-kit/runner.js";
import { composite, linear, constant } from "loadbench-kit/generators.js";
import LatencyReport from "loadbench-kit/reports/latency.js";

const PROJECT_ROOT = path.resolve(import.meta.dirname, "..");

jest.setTimeout(300_000);
describe("Download: ramp concurrency until p99 latency breaches 30s", () => {
  const container = new Container(PROJECT_ROOT, "performance-test-app-1", "app");
  const workload: Workload = {
    filename: new URL("workers/downloader.ts", import.meta.url).toString(),
    options: { execArgv: ["--"] },
  };

  const tiers = composite<Tier>({
    name: constant("download") as Generator<string>,
    concurrency: linear(10, 10), // 10, 20, 30, 40, ...
    count: constant(200) as Generator<number>,
  });

  function shouldStop(result: Result): boolean {
    if (result.responses.length === 0) return true;
    const latency = LatencyReport(result.responses);
    return latency.p99Ms > 30_000;
  }

  beforeAll(async () => await container.up());
  afterAll(async () => await container.down());

  test("finds the breaking tier", async () => {
    const results = await rampUntil(tiers, workload, container, shouldStop);
    expect(results.length).toBeGreaterThanOrEqual(1);

    console.table(
      results.map((r) => {
        const latency = LatencyReport(r.responses);
        return {
          concurrency: r.tier.concurrency,
          count: r.responses.length,
          p99: latency.p99Ms.toFixed(0) + "ms",
          elapsed: Math.round(r.elapsed) + "ms",
        };
      }),
    );
  });
});
