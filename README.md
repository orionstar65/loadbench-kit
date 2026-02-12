# Loadbench Kit

Service-agnostic performance testing framework for Node.js Docker containers.
Tests run against a live container and measure latency, throughput, error rates,
and memory behavior under load.

## Install from a source checkout

The package has not been published to the public npm registry. From the repository root:

```bash
npm ci
npm run build
```

The package name is `loadbench-kit` for eventual publication.

## Quick Start

```typescript
import Container from "loadbench-kit/docker/container.js";
import { rampUntil, type Workload, type Tier, type Result } from "loadbench-kit/runner.js";
import { composite, linear, constant } from "loadbench-kit/generators.js";
import SummaryReport from "loadbench-kit/reports/summary.js";
import { writeReport } from "loadbench-kit/reports/write.js";

const container = new Container(process.cwd(), "my-app-1", "app");
await container.up();

const workload: Workload = {
  filename: new URL("workers/probe.ts", import.meta.url).pathname,
  options: { execArgv: ["--"] },
};

const tiers = composite<Tier>({
  name: constant("probe"),
  concurrency: linear(5, 5),
  count: constant(200),
});

const results = await rampUntil(tiers, workload, container, (result) => {
  const summary = SummaryReport(result.responses);
  return summary.failureRate > 10;
});

writeReport(results, "./test-results", { title: "my-connector" });
await container.down();
```

See `examples/performance.test.ts` for a complete Jest-based test suite.

## Architecture

### Container

Manages Docker Compose lifecycle (`up`, `down`, `stats`, `inspect`).

```typescript
import Container from "loadbench-kit/docker/container.js";

const container = new Container(cwd, "container-name", "service-name");
await container.up();

const stats = await container.stats();
// stats.MemUsage.Usage  → { value: 120.3, units: "MiB" }
// stats.CPUPerc         → "1.46%"

const config = await container.serviceConfig();
// config.deploy.resources.limits.memory → "1073741824"
// config.image → "my-connector:latest"

const url = await container.url();
// "http://127.0.0.1:8080"

const info = await container.serialize();
// { name, service, url } — safe for worker threads

await container.down();
```

### Runner

Executes load tiers by spawning `worker_threads`.

```typescript
import runner, { rampUntil } from "loadbench-kit/runner.js";

// Single tier
const result = await runner(tier, workload, container);

// Ramp until stop condition
const results = await rampUntil(tiers, workload, container, shouldStop);
```

Workers receive a `WorkerData` object with `container` (serialized),
`parallelism` (connections per worker), and `messages` (requests to send).
Extend `WorkerData` to pass connector-specific data (corpus URLs, file URIs).

### Generators

Infinite generators for building tier sequences.

```typescript
import { exponential, linear, constant, range, composite, n } from "loadbench-kit/generators.js";

exponential(2)           // 1, 2, 4, 8, 16, ...
linear(5, 5)             // 5, 10, 15, 20, ...
constant("probe")        // "probe", "probe", ...
range(10, 50, 10)        // 10, 20, 30, 40, 50
n(3, exponential(2))     // [1, 2, 4]

// Combine into Tier objects
const tiers = composite<Tier>({
  name: constant("crawl"),
  concurrency: linear(2, 2),
  count: constant(50),
});
```

### Metrics

Polls the container's `/metrics` Prometheus endpoint during a run.

```typescript
import { Poller } from "loadbench-kit/metrics/poller.js";

const poller = new Poller(container, 5_000);
await poller.start();
// ... run load ...
const samples = poller.stop();
// samples[0].rssBytes, .heapUsedBytes, .eventLoopLagSeconds
```

### Reports

Transform raw `Result` data into structured reports.

```typescript
import Report from "loadbench-kit/reports/full.js";
import SummaryReport from "loadbench-kit/reports/summary.js";
import LatencyReport from "loadbench-kit/reports/latency.js";
import MemoryReport from "loadbench-kit/reports/memory.js";

const full = Report(result);         // { tier, summary, latency, memory }
const summary = SummaryReport(responses);  // { successCount, failureRate, rps }
const latency = LatencyReport(responses);  // { minMs, p50Ms, p90Ms, p99Ms, maxMs }
const memory = MemoryReport(metrics);      // { peakRssBytes, peakHeapUsedBytes, trend }
```

## Report Writing

`writeReport` generates `results.json` and `results.md` from raw results.

```typescript
import { writeReport, kvTable, mdTable, ms } from "loadbench-kit/reports/write.js";
import { mb } from "loadbench-kit/utils.js";
```

### writeReport

```typescript
writeReport(results, "./test-results", {
  title: "my-connector",
  summary: "Node v22 · 1 GiB container · 200 corpus pages",
});
```

Writes two files to the output directory:
- `results.json` — machine-readable report with metadata and per-tier data
- `results.md` — Markdown report with summary, latency, and memory tables

### kvTable

Render a two-column Property / Value table with a bold heading.

```typescript
kvTable("Environment", {
  Node: process.version,
  Platform: `${os.platform()} ${os.arch()}`,
  "Host CPUs": String(os.cpus().length),
  "Container Memory Limit": mb(1073741824),  // "1.00 GB"
});
```

```markdown
**Environment**

| Property               | Value        |
| ---------------------- | ------------ |
| Node                   | v22.13.0     |
| Platform               | darwin arm64 |
| Host CPUs              | 16           |
| Container Memory Limit | 1.00 GB      |
```

### mdTable

Render an N-column table with a bold heading.

```typescript
mdTable("Recommendations", ["Metric", "Observed", "Action"], [
  ["Peak RSS", "312.5 MB", "Set memory limit to 512 MB"],
  ["Peak Heap", "64.2 MB", "`--max-old-space-size=128`"],
  ["Memory Trend", "stable", "No action needed"],
]);
```

### ms

Format millisecond durations with auto-scaling.

```typescript
ms(0.5)      // "0.50ms"
ms(42)       // "42ms"
ms(1_234)    // "1.23s"
ms(75_000)   // "1m 15s"
ms(NaN)      // "N/A"
```

### mb

Format byte values with auto-scaling.

```typescript
import { mb } from "loadbench-kit/utils.js";

mb(524_288)       // "512.0 KB"
mb(134_217_728)   // "128.0 MB"
mb(1_073_741_824) // "1.00 GB"
mb(NaN)           // "N/A"
```

## Building a Report Summary

Connectors build a `summary` string from `kvTable` and `mdTable` and pass it
to `writeReport`. This renders between the title and the per-tier tables.

```typescript
const summary = [
  kvTable("Environment", { ... }),
  "",
  kvTable("Corpus", { ... }),
  "",
  kvTable("Test Configuration", { ... }),
  "",
  mdTable("Recommendations", ["Metric", "Observed", "Recommendation"], [
    ["Peak RSS", mb(peakRss), `Memory limit: ${recommendedMb} MB`],
    ["Peak Heap", mb(peakHeap), `\`--max-old-space-size=${heapMb}\``],
    ["Memory Trend", trend, action],
  ]),
].join("\n");

writeReport(allResults, outputDir, { title: "my-connector", summary });
```

See `examples/performance.test.ts` for the full pattern including how to derive
recommendations from aggregated results.

## Examples

| File | Description |
| ---- | ----------- |
| `examples/performance.test.ts` | Full test suite with report generation |
| `examples/healthcheck.test.ts` | Ramp `/alive` until error rate breach |
| `examples/crawl.test.ts` | Ramp content listing until latency breach |
| `examples/download.test.ts` | Ramp file download until latency breach |

## Workers

Workers run in `worker_threads` and post `ResponseSample` messages back to the
runner. A minimal worker:

```typescript
import { parentPort, workerData } from "node:worker_threads";
import { Pool } from "undici";
import type { ResponseSample } from "loadbench-kit/samples.js";
import type { WorkerData } from "loadbench-kit/runner.js";

const { container, messages, parallelism } = workerData as WorkerData;
const pool = new Pool(container.url, { connections: parallelism });

await Promise.all(
  Array.from({ length: messages }, async () => {
    const timestampMs = performance.now();
    const response = await pool.request({ method: "GET", path: "/alive" });
    parentPort!.postMessage({
      url: "/alive",
      timestampMs,
      durationMs: performance.now() - timestampMs,
      status: response.statusCode,
    } satisfies ResponseSample);
  }),
);
```

## Development

```bash
npm run check      # Type-check (tsc --noEmit)
npm run build      # Compile + path alias rewrite
npm run lint       # ESLint + Prettier
npm run test:unit  # Unit tests (no Docker)
npm run test:integration  # Integration tests (Docker required)
```

## Local integration target

The included Docker Compose configuration builds a small Node.js HTTP fixture
from `examples/demo-server.mjs`. It provides `/ready`, `/alive`, and
Prometheus-format `/metrics` without a private image, registry, or credentials.

```bash
npm ci
npm run check
npm run lint
npm run test:unit
npm run build
# Requires Docker Engine with Docker Compose:
npm run test:integration
```

The existing integration suites start and stop the demo through Docker Compose.
Use Node.js 22.18+ (or a compatible newer release) for built-in TypeScript
worker support.
