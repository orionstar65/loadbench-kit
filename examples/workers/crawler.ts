import { parentPort, workerData } from "node:worker_threads";
import { Pool } from "undici";

import type { ResponseSample } from "loadbench-kit/samples.js";
import type { WorkerData } from "loadbench-kit/runner.js";

if (!parentPort) throw new Error("Must run as worker thread");
const { container, messages, parallelism: connections } = workerData as WorkerData;

const pool = new Pool(container.url, {
  connections,
  headersTimeout: 30_000,
  bodyTimeout: 30_000,
});

/**
 * Simulate a crawl operation: list contents then download each item.
 * Returns an aggregated ResponseSample covering the entire crawl.
 */
async function crawl(): Promise<ResponseSample> {
  const timestampMs = performance.now();
  try {
    const listResponse = await pool.request({
      method: "POST",
      path: "/contents:pull",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    });

    // Download each item returned by the listing
    const body = await listResponse.body.text();
    const items: string[] = JSON.parse(body).items ?? [];
    for (const item of items) {
      await pool.request({
        method: "POST",
        path: "/content-data:download",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sourceLocation: item }),
      });
    }

    return {
      url: "/contents:pull",
      timestampMs,
      durationMs: performance.now() - timestampMs,
      status: listResponse.statusCode,
    };
  } catch (err) {
    return {
      url: "/contents:pull",
      timestampMs,
      durationMs: performance.now() - timestampMs,
      status: 500,
      error: String(err),
    };
  }
}

await Promise.all(
  Array.from({ length: messages }, async () => {
    const sample = await crawl();
    parentPort!.postMessage(sample);
  }),
);
