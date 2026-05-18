import path from "path";
import {
  afterAll,
  describe,
  test,
  expect,
  jest,
  beforeAll,
} from "@jest/globals";

import Container from "loadbench-kit/docker/container.js";
import FullReport from "loadbench-kit/reports/index.js";
import type { Workload, Result } from "loadbench-kit/runner.js";
import { composite, linear, constant } from "loadbench-kit/generators.js";

// Loose import — rampUntil and RAMP_ITERATION_LIMIT are added in Phase 1.
const runnerModule = await import("loadbench-kit/runner.js");
const rampUntil = (runnerModule as any).rampUntil as (
  tiers: Generator<any>,
  workload: Workload,
  container: Container,
  shouldStop: (result: Result) => boolean,
) => Promise<Result[]>;
const RAMP_ITERATION_LIMIT = (runnerModule as any)
  .RAMP_ITERATION_LIMIT as number;

const PROJECT_ROOT = path.resolve(import.meta.dirname, "../..");

jest.setTimeout(300_000);
describe("Performance: Probe (/alive) — ramp until failure", () => {
  const container = new Container(
    PROJECT_ROOT,
    "performance-test-app-1",
    "app",
  );
  const work: Workload = {
    filename: new URL("workers/probe.ts", import.meta.url).toString(),
    options: { execArgv: ["--"] },
  };

  interface Tier {
    name: string;
    concurrency: number;
    count: number;
  }
  const tiers = (composite as any)({
    name: constant("probe"),
    concurrency: linear(20, 20), // 20, 40, 60, ...
    count: constant(200),
  }) as Generator<Tier>;

  function shouldStop(result: Result): boolean {
    const report = FullReport(result);
    return report.summary!.failureRate > 0 || report.latency!.p99Ms > 30_000;
  }

  beforeAll(async () => await container.up());
  afterAll(async () => await container.down());

  test("ramps probe concurrency until breach", async () => {
    const results = await rampUntil(tiers, work, container, shouldStop);
    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results.length).toBeLessThanOrEqual(RAMP_ITERATION_LIMIT);

    console.table(
      results.map((r) => ({
        concurrency: r.tier.concurrency,
        responses: r.responses.length,
        errors: r.errors.length,
        elapsed: Math.round(r.elapsed),
      })),
    );
  });
});
