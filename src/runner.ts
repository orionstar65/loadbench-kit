import os from "node:os";
import { Worker, WorkerOptions } from "node:worker_threads";

import Container, {
  ContainerInfo,
} from "loadbench-kit/docker/container.js";
import { Poller } from "loadbench-kit/metrics/poller.js";
import type {
  MetricsSample,
  ResponseSample,
} from "loadbench-kit/samples.js";
import { waitFor } from "loadbench-kit/utils.js";

/**
 * Defines a single load tier in a performance test run.
 *
 * @property name        - Human-readable label for this tier (e.g. "warm-up", "peak").
 * @property concurrency - Total number of concurrent virtual users (distributed
 *                         across worker threads).
 * @property count       - Total number of requests to execute across all workers.
 */
export interface Tier {
  name: string;
  concurrency: number;
  count: number;
}

/**
 * Describes the worker script and its instantiation options.
 *
 * @property filename - Path to the worker script file (resolved relative to
 *                      `import.meta.url` at runtime).
 * @property options  - Node.js {@link WorkerOptions} forwarded to `new Worker()`.
 */
export interface Workload {
  filename: string;
  options: WorkerOptions;
}

/**
 * Aggregated output of a single tier run.
 *
 * @property tier      - The tier configuration that produced these results.
 * @property responses - Individual HTTP response samples from all workers.
 * @property metrics   - Prometheus metric snapshots captured during the run.
 * @property errors    - Error messages collected from worker `message` events.
 * @property elapsed   - Wall-clock duration of the tier in milliseconds.
 */
export interface Result {
  tier: Tier;
  responses: ResponseSample[];
  metrics: MetricsSample[];
  errors: string[];
  elapsed: number;
}

/**
 * Payload passed to each worker thread via `workerData`.
 *
 * Connectors can extend this interface to pass additional configuration to
 * their worker scripts. Define a custom interface that extends `WorkerData`,
 * then pass the extra fields via `Workload.options.workerData`:
 *
 * ```typescript
 * interface MyWorkerData extends WorkerData {
 *   apiKey: string;
 *   batchSize: number;
 * }
 *
 * const work: Workload = {
 *   filename: "workers/my-worker.ts",
 *   options: {
 *     workerData: { apiKey: "...", batchSize: 50 },
 *   },
 * };
 * ```
 *
 * In the worker script, cast `workerData` to your custom type:
 *
 * ```typescript
 * const args = workerData as MyWorkerData;
 * const { apiKey, batchSize, container, parallelism, messages } = args;
 * ```
 *
 * **Reserved field names:** `container`, `parallelism`, and `messages` are
 * overlaid by the runner after spreading custom fields. Do not use these names
 * for custom data — they will be silently overwritten.
 *
 * @property container   - Serialized {@link ContainerInfo} so workers can reach
 *                         the container over HTTP.
 * @property parallelism - Number of concurrent requests this individual worker
 *                         should maintain (tier concurrency / thread count).
 * @property messages    - Number of requests this worker is responsible for
 *                         (tier count / thread count, rounded up).
 */
export interface WorkerData {
  container: ContainerInfo;
  parallelism: number;
  messages: number;
}

// Reserve one CPU for the main thread; all remaining CPUs are available for workers.
const MAX_WORKERS = os.cpus().length - 1;

/**
 * Maximum number of tiers `rampUntil` will execute, even if `shouldStop`
 * never fires and the tier generator keeps producing values.
 * Prevents runaway tests in CI.
 */
export const RAMP_ITERATION_LIMIT = 50;

/**
 * Execute a single performance tier by distributing work across worker threads.
 *
 * The runner waits for the target container to be running and ready, then
 * spawns up to `MAX_WORKERS` threads. Each thread receives an equal share of
 * the tier's total request count and a proportional slice of the concurrency.
 * A {@link Poller} captures Prometheus metrics in the background while
 * workers execute.
 *
 * @param tier      - The load tier defining concurrency and request count.
 * @param work      - The worker script and options to instantiate.
 * @param container - The Docker container under test.
 * @returns Aggregated {@link Result} with response samples, metrics, errors,
 *          and elapsed time.
 */
export default async function run(
  tier: Tier,
  work: Workload,
  container: Container,
): Promise<Result> {
  // Short-circuit: nothing to do
  const responses: ResponseSample[] = [];
  const metrics: MetricsSample[] = [];
  const errors: string[] = [];
  if (tier.count === 0) {
    return { tier, responses, metrics, errors, elapsed: 0 };
  }

  // Wait for the container to be running
  await waitFor(() => container.isRunning());

  // Wait for the container to be ready
  const containerInfo = await container.serialize();
  await waitFor(async () =>
    fetch(`${containerInfo.url}/ready`, { signal: AbortSignal.timeout(2_000) })
      .then((res) => res.ok)
      .catch(() => false),
  );

  // Thread count is the lesser of requested concurrency and available CPUs.
  // This prevents spawning more threads than logical processors.
  const threads = Math.min(tier.concurrency, MAX_WORKERS);

  // Parallelism: divide the tier's total concurrency evenly across threads
  // (floor so we never exceed the requested concurrency).
  // Messages: divide total request count across threads (ceil so every
  // request is accounted for, with the last worker potentially doing fewer).
  const workerData: WorkerData = {
    ...(work.options?.workerData as object),
    container: containerInfo,
    parallelism: Math.floor(tier.concurrency / threads),
    messages: Math.ceil(tier.count / threads),
  };

  const start = performance.now();
  const poller = new Poller(container);
  void poller.start();

  const finish = await new Promise<number>((resolve) => {
    let activeWorkers = threads;

    /**
     * Spawn a single worker thread and wire up its message, error, and exit
     * handlers. When all workers have exited the outer promise resolves with
     * the finish timestamp.
     */
    function spawn(): Worker {
      const url = new URL(work.filename, import.meta.url);
      const options = { ...work.options, workerData };
      const worker = new Worker(url, options);

      // Collect each response sample from the worker; route errors to
      // the errors array instead of the responses array.
      function onMessage(msg: ResponseSample) {
        if ("error" in msg) errors.push(msg.error!);
        else responses.push(msg);
      }

      // Log unexpected worker errors and decrement the active count so the
      // exit handler can still detect when all workers have finished.
      function onError(err: Error) {
        console.error(`Worker ${worker.threadId} error:`, err);
        activeWorkers--;
      }

      // Clean up listeners on exit. When the last active worker exits,
      // resolve the enclosing promise with the current high-resolution
      // timestamp so elapsed time can be computed.
      function onExit(code: number) {
        if (code !== 0)
          console.error(`Worker ${worker.threadId} exited with code ${code}`);

        worker.removeAllListeners();
        if (--activeWorkers === 0) resolve(performance.now());
      }

      return worker
        .on("message", onMessage)
        .on("error", onError)
        .on("exit", onExit);
    }

    Array.from({ length: threads }, spawn);
  });

  const elapsed = finish - start;
  metrics.push(...poller.stop());
  return { tier, responses, metrics, errors, elapsed };
}

/**
 * Execute tiers sequentially until a breach condition is met, the generator
 * is exhausted, or {@link RAMP_ITERATION_LIMIT} is reached.
 *
 * @param tiers      - A generator producing {@link Tier} configurations.
 * @param workload   - The worker script and options to instantiate.
 * @param container  - The Docker container under test.
 * @param shouldStop - Evaluated after each tier. Return `true` to stop.
 * @returns Results for every tier that ran, including the breaching tier.
 */
export async function rampUntil(
  tiers: Generator<Tier>,
  workload: Workload,
  container: Container,
  shouldStop: (result: Result) => boolean,
): Promise<Result[]> {
  const results: Result[] = [];

  for (let i = 0; i < RAMP_ITERATION_LIMIT; i++) {
    const next = tiers.next();
    if (next.done) break;

    const result = await run(next.value, workload, container);
    results.push(result);

    if (shouldStop(result)) break;
  }

  return results;
}
