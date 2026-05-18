import path from "path";
import {
  afterAll,
  beforeAll,
  describe,
  test,
  expect,
  jest,
} from "@jest/globals";

import Container from "loadbench-kit/docker/container.js";
import { Poller } from "loadbench-kit/metrics/poller.js";
import { waitFor } from "loadbench-kit/utils.js";

const PROJECT_ROOT = path.resolve(import.meta.dirname, "../..");

jest.setTimeout(30_000);
describe("Poller: local demo /metrics", () => {
  const container = new Container(
    PROJECT_ROOT,
    "performance-test-app-1",
    "app",
  );

  beforeAll(async () => {
    await container.up();
    await waitFor(() => container.isRunning());
  });

  afterAll(async () => await container.down());

  test("collects metrics samples over 10 seconds", async () => {
    const poller = new Poller(container, 2_000);
    await poller.start();
    await new Promise((r) => setTimeout(r, 10_000));
    const samples = poller.stop();

    console.log(`Collected ${samples.length} samples`);
    console.log(JSON.stringify(samples, null, 2));

    expect(samples.length).toBeGreaterThanOrEqual(1);
    expect(samples.length).toBeLessThan(10);

    for (const sample of samples) {
      expect(sample.timestampMs).toBeGreaterThan(0);
      expect(sample.rssBytes).toBeGreaterThan(0);
      expect(sample.heapUsedBytes).toBeGreaterThan(0);
      expect(sample.heapTotalBytes).toBeGreaterThan(0);
      expect(sample.activeHandles).toBeGreaterThanOrEqual(0);
      expect(sample.eventLoopLagSeconds).toBeGreaterThanOrEqual(0);
    }
  });
});
