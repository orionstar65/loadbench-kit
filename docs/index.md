# Getting Started

`loadbench-kit` is a service-agnostic performance testing framework for
Node.js-based Docker containers. It measures latency, throughput, error rates,
and memory behavior under load by running concurrent worker threads against a
live container and collecting results into structured reports.

This guide walks through the complete workflow: setting up a target container,
writing a worker script, authoring a test suite, and interpreting results.

## Prerequisites

- **Docker** must be installed and running.
- **Node.js** (with ESM support).
- The target container must expose three HTTP endpoints:
  - `/ready` -- polled by the runner before starting workers.
  - `/alive` -- health check endpoint.
  - `/metrics` -- Prometheus-format metrics endpoint. The framework polls this
    during test execution to collect memory and runtime statistics.

> The repository includes a local example HTTP service implementing all three endpoints. No external service framework is required.

## Project Setup

### Docker Compose

Define your target container in a `docker-compose.yaml` at the project root. The
framework uses Docker Compose to manage the container lifecycle.

```yaml
name: performance-test
services:
  app:
    build:
      context: .
      dockerfile: docker/Dockerfile
    ports:
      - "8080:8081"
```

The `name` field sets the Compose project name. The `Container` class uses this
along with the service name to identify the running container. The port mapping
exposes the container's internal port to the host so workers can reach it.

Your target container must respond to `GET /ready`, `GET /alive`, and
`GET /metrics`. The runner waits for the container to be running, then polls
`/ready` before dispatching any work.

## Writing a Worker

Workers are standalone TypeScript files that run inside `worker_threads`. Each
worker receives its configuration through the `workerData` global and sends
results back to the parent thread via `postMessage`.

Here is a minimal worker that probes the `/alive` endpoint:

```typescript
import { parentPort, workerData } from "node:worker_threads";
import { Pool } from "undici";

import type { ResponseSample } from "loadbench-kit/samples.js";
import type { WorkerData } from "loadbench-kit/runner.js";

if (!parentPort) throw new Error("Must run as worker thread");
const args = workerData as WorkerData;

const { url } = args.container;
const { messages, parallelism: connections } = args;
const pool = new Pool(url, { connections });
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
```

### Key points

- **`WorkerData`** contains three fields: `container` (a `ContainerInfo` object
  with `name`, `service`, and `url`), `parallelism` (how many concurrent
  connections this worker should maintain), and `messages` (how many total
  requests this worker should send).
- **`undici.Pool`** provides HTTP connection pooling. Set the `connections`
  option to `parallelism` so the pool matches the intended concurrency for this
  worker.
- **`ResponseSample`** is the standard result type. Every request -- whether it
  succeeds or fails -- must produce a `ResponseSample` and send it back via
  `parentPort.postMessage`. Include the `url`, `timestampMs`, `durationMs`, and
  `status` fields. On failure, also set the `error` field.
- Both success and error paths must post a sample. If a worker silently drops
  errors, the runner will undercount and reports will be inaccurate.

### Custom Worker Data

Connectors often need to pass additional configuration to workers beyond the
base `WorkerData` fields. Define a custom interface that extends `WorkerData`
and pass the extra fields via `Workload.options.workerData`:

```typescript
import type { WorkerData, Workload } from "loadbench-kit/runner.js";

// 1. Define your extended interface
interface ConfluenceWorkerData extends WorkerData {
  spaceKey: string;
  pageLimit: number;
}

// 2. Pass custom fields in the workload options
const work: Workload = {
  filename: new URL("workers/crawler.ts", import.meta.url).toString(),
  options: {
    workerData: { spaceKey: "ENG", pageLimit: 100 },
    execArgv: ["--"],
  },
};
```

In the worker script, cast `workerData` to your custom type to access both the
base fields and your custom fields:

```typescript
import { parentPort, workerData } from "node:worker_threads";

const args = workerData as ConfluenceWorkerData;
const { spaceKey, pageLimit, container, parallelism, messages } = args;
```

**Reserved field names:** The runner spreads your custom fields first, then
overlays `container`, `parallelism`, and `messages`. Do not use these three
names for custom data — they will be silently overwritten by the runner.

### Pool Timeouts in Docker

When using `undici.Pool` to make requests against a Docker container, always
configure `headersTimeout` and `bodyTimeout` to prevent workers from hanging
indefinitely if the container becomes unresponsive:

```typescript
const pool = new Pool(url, {
  connections,
  headersTimeout: 30_000,
  bodyTimeout: 30_000,
});
```

Without these timeouts, a stalled container can cause worker threads to hang
forever, preventing the test from completing. The 30-second values match the
typical Docker health check interval and are a safe default for most workloads.

## Writing a Test

Tests use Jest to orchestrate the container lifecycle, run workloads, and assert
on report values.

```typescript
import path from "path";
import {
  afterAll,
  beforeAll,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

import Container from "loadbench-kit/docker/container.js";
import FullReport from "loadbench-kit/reports/index.js";
import runner from "loadbench-kit/runner.js";
import type { Workload } from "loadbench-kit/runner.js";

const PROJECT_ROOT = path.resolve(import.meta.dirname, "../..");
jest.setTimeout(300_000);

describe("Performance: Probe (/alive)", () => {
  const container = new Container(
    PROJECT_ROOT,
    "performance-test-app-1",
    "app",
  );
  const work: Workload = {
    filename: new URL("workers/probe.ts", import.meta.url).toString(),
    options: { execArgv: ["--"] },
  };

  beforeAll(async () => await container.up());
  afterAll(async () => await container.down());

  test.each([
    {
      name: "light",
      concurrency: 20,
      count: 200,
      failureThreshold: 0,
      latencyThreshold: 30_000,
    },
  ])("$name (c=$concurrency, n=$count)", async (tier) => {
    const result = await runner(tier, work, container);
    const report = FullReport(result);
    expect(report.summary).toBeDefined();
    console.log(JSON.stringify(report, null, 2));

    const { failureThreshold, latencyThreshold } = tier;
    expect(report.summary!.failureRate).toBeLessThanOrEqual(failureThreshold);
    expect(report.latency!.p99Ms).toBeLessThanOrEqual(latencyThreshold);
  });
});
```

### Container lifecycle

Create a `Container` instance with the project root path, the full container
name (matching Docker Compose's naming convention), and the service name. Call
`container.up()` in `beforeAll` to start the container via
`docker compose up -d`, and `container.down()` in `afterAll` to tear it down.
The runner handles readiness polling internally, so you do not need to wait for
`/ready` yourself.

### Defining a Workload

A `Workload` has two fields:

- `filename` -- the absolute path (or file URL) to the worker script. Use
  `new URL("workers/probe.ts", import.meta.url).toString()` to resolve relative
  to the test file.
- `options` -- `WorkerOptions` passed to the `worker_threads` constructor. The
  `execArgv` field controls Node.js flags for the worker process.

### Defining Tiers

A `Tier` describes a single load level:

- `name` -- a label for the tier (used in reports).
- `concurrency` -- the total number of concurrent connections across all worker
  threads.
- `count` -- the total number of requests to send.

You can define multiple tiers and use `test.each` to run each one as a separate
test case. This lets you ramp from light to heavy load within a single test
suite.

### Running and reporting

Call `runner(tier, workload, container)` to execute the workload. The runner
returns a `Result` object containing raw response samples, metrics samples,
errors, and elapsed time. Pass the result to `FullReport(result)` to generate a
structured report with three sections:

- **`summary`** -- total requests, successes, failures, failure rate, and
  throughput (requests per second).
- **`latency`** -- percentile breakdowns: p50, p90, p95, and p99 in
  milliseconds.
- **`memory`** -- heap used, heap total, and RSS measurements showing baseline,
  peak, and delta values.

Assert on report fields to enforce performance SLAs. Common assertions include
an upper bound on `failureRate` (e.g., 0 for zero tolerance) and a ceiling on
`p99Ms` latency.

### Report Output

After collecting results, call `writeReport()` to produce deterministic
`results.json` and `results.md` files. This is a pure write utility — it does
not affect the runner or metrics collection.

```typescript
import { writeReport } from "loadbench-kit/reports/write.js";

// Collect results from one or more tiers
const results = await Promise.all(
  tiers.map((tier) => runner(tier, work, container)),
);

// Write both files to the output directory
writeReport(results, "./test-results", "confluence-connector 2026-04-14");
```

This produces two files in `./test-results/`:

- **`results.json`** — Machine-readable. Contains a `metadata` object
  (timestamp, package version, Node version, optional title) and a `results`
  array of `FullReport` objects, one per tier.
- **`results.md`** — Human-readable Markdown with three consolidated tables
  (Summary, Latency, Memory). Each table has the tier name as its first column.
  The Memory table is omitted when no reports contain memory data.

The output directory is created automatically if it does not exist. Each call
overwrites previous files, making it safe for repeated runs.

## Runner Mechanics

The runner distributes work across multiple `worker_threads` to simulate
concurrent load:

1. It waits for `container.isRunning()` to confirm the Docker container is up,
   then polls the `/ready` endpoint until it returns a successful response.
2. It calculates the number of threads:
   `threads = min(tier.concurrency, os.cpus().length - 1)`.
3. It distributes work evenly across threads:
   - Each thread gets `parallelism = floor(concurrency / threads)` concurrent
     connections.
   - Each thread sends `messages = ceil(count / threads)` requests.
4. Workers run in parallel. Each worker posts `ResponseSample` messages back to
   the main thread as requests complete.
5. During execution, a `Poller` periodically fetches the container's `/metrics`
   Prometheus endpoint and records memory and runtime statistics
   (`MetricsSample` objects).
6. When all workers finish, the runner returns a `Result` containing the
   collected response samples, metrics samples, any errors, the tier definition,
   and the total elapsed time.

## Contributing

Install dependencies (requires prior authentication via `npm run login`):

```bash
npm run login && npm install
```

To run unit tests (no Docker required):

```bash
npm run test:unit
```

Run integration tests (requires Docker):

```bash
npm run test:integration
```

This executes all tests under `test/integration/` with Jest in ESM mode. Tests
run sequentially with open-handle detection enabled. The default timeout is 300
seconds to allow for container startup and sustained load testing.

To run all tests (lint, then unit and integration):

```bash
npm test
```
