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
const path = "/alive";

await Promise.all(
  Array.from({ length: messages }, async () => {
    const timestampMs = performance.now();
    return pool
      .request({ method: "GET", path })
      .then((response) => {
        const sample: ResponseSample = {
          url: path,
          timestampMs,
          durationMs: performance.now() - timestampMs,
          status: response.statusCode,
        };
        parentPort!.postMessage(sample);
      })
      .catch((err) => {
        const sample: ResponseSample = {
          url: path,
          timestampMs,
          durationMs: performance.now() - timestampMs,
          status: 500,
          error: String(err),
        };
        parentPort!.postMessage(sample);
      });
  }),
);
