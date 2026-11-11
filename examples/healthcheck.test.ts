import path from "path";
import { afterAll, describe, test, expect, jest, beforeAll } from "@jest/globals";

import Container from "loadbench-kit/docker/container.js";
import { rampUntil, type Workload, type Tier, type Result } from "loadbench-kit/runner.js";
import { composite, exponential, constant } from "loadbench-kit/generators.js";
import SummaryReport from "loadbench-kit/reports/summary.js";

const PROJECT_ROOT = path.resolve(import.meta.dirname, "..");

jest.setTimeout(300_000);
describe("Healthcheck: ramp /alive until error rate breaches 10%", () => {
  const container = new Container(PROJECT_ROOT, "performance-test-app-1", "app");
  const workload: Workload = {
    filename: new URL("workers/healthcheck.ts", import.meta.url).toString(),
    options: { execArgv: ["--"] },
  };

  const tiers = composite<Tier>({
    name: constant("healthcheck") as Generator<string>,
    concurrency: exponential(2), // 1, 2, 4, 8, 16, ...
    count: constant(100) as Generator<number>,
  });

  function shouldStop(result: Result): boolean {
    const summary = SummaryReport(result.responses);
    return summary.failureRate > 10;
  }

  beforeAll(async () => await container.up());
  afterAll(async () => await container.down());

  test("finds the breaking tier", async () => {
    const results = await rampUntil(tiers, workload, container, shouldStop);
    expect(results.length).toBeGreaterThanOrEqual(1);

    console.table(
      results.map((r) => {
        const summary = SummaryReport(r.responses);
        return {
          concurrency: r.tier.concurrency,
          count: r.responses.length,
          failureRate: summary.failureRate.toFixed(1) + "%",
          elapsed: Math.round(r.elapsed) + "ms",
        };
      }),
    );
  });
});
