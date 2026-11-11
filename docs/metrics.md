# Metrics Collection

The metrics layer periodically fetches the `/metrics` Prometheus endpoint from
the container under test and collects `MetricsSample` snapshots. These samples
capture memory usage, active handle counts, and event loop lag at regular
intervals throughout a performance test run, providing the raw data that feeds
into the `MemoryReport`.

## MetricsSample

Each `MetricsSample` is a timestamped snapshot of the container's runtime state.
The fields map directly to standard Node.js Prometheus metrics:

| Field                 | Prometheus Metric               | Description                                                                                                                                  | Unit         |
| --------------------- | ------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- | ------------ |
| `timestampMs`         | _(monotonic clock)_             | Time the sample was taken (`performance.now()`). Inherited from the base `Sample` type. Both workers and the Poller use the same convention. | milliseconds |
| `heapUsedBytes`       | `nodejs_heap_size_used_bytes`   | V8 heap memory currently allocated and in use.                                                                                               | bytes        |
| `heapTotalBytes`      | `nodejs_heap_size_total_bytes`  | Total V8 heap memory allocated by the process, including free space available for future allocations.                                        | bytes        |
| `rssBytes`            | `process_resident_memory_bytes` | Resident Set Size -- the total memory occupied by the process in RAM, including heap, stack, and code segments.                              | bytes        |
| `activeHandles`       | `nodejs_active_handles_total`   | Number of active handles (sockets, timers, file descriptors) held by the Node.js event loop.                                                 | count        |
| `eventLoopLagSeconds` | `nodejs_eventloop_lag_seconds`  | Delay between when the event loop is expected to tick and when it actually does. High values indicate the loop is blocked.                   | seconds      |

The type definition:

```typescript
type MetricsSample = Sample & {
  heapUsedBytes: number;
  heapTotalBytes: number;
  rssBytes: number;
  activeHandles: number;
  eventLoopLagSeconds: number;
};
```

## Poller Class

The `Poller` manages the periodic collection of `MetricsSample` snapshots from a
running container.

### Constructor

```typescript
new Poller(container: Container, delayMs?: number)
```

- **container** -- The `Container` instance to poll. The Poller resolves the
  container's URL and appends `/metrics` to form the target endpoint.
- **delayMs** -- Interval between polls in milliseconds. Defaults to `3000` (3
  seconds).

The Poller stores all collected samples in a public `samples` array that can be
read at any time.

### start()

```typescript
async start(): Promise<void>
```

Resolves the container URL and begins polling at the configured interval. Each
tick fetches the `/metrics` endpoint, parses the Prometheus response, transforms
it into a `MetricsSample`, and pushes it onto the `samples` array. Failed
fetches (network errors, non-200 responses, timeouts) are silently dropped -- no
null entries appear in the samples array.

### stop()

```typescript
stop(): MetricsSample[]
```

Clears the polling interval and returns the collected `samples` array. Calling
`stop()` when the Poller is not running is safe and returns whatever samples
have been collected. After stopping, the `samples` array remains accessible on
the instance.

### Poller.snapshot() (static)

```typescript
static async snapshot(
  target: string,
  timeoutMs?: number,
  retries?: number,
): Promise<MetricsSample | null>
```

Takes a single point-in-time snapshot from the given URL. Returns `null` if all
attempts fail, the response is not OK, or parsing fails.

- **target** -- Container base URL or full metrics endpoint URL. If the URL does
  not end with `/metrics`, the suffix is appended automatically. Both
  `"http://localhost:3000"` and `"http://localhost:3000/metrics"` work.
- **timeoutMs** -- Abort each fetch after this many milliseconds (default
  `5000`). Uses `AbortSignal.timeout()`.
- **retries** -- Number of retry attempts after the initial fetch fails (default
  `0`). Each retry waits 2 seconds before re-attempting.

This method is useful outside the polling loop for one-off measurements such as
capturing a baseline before a test begins.

## Prometheus Parser

The parser (`src/metrics/parser.ts`) converts raw Prometheus text-format
responses into typed objects. The parsing pipeline produces three levels of
structure:

- **Observation** -- A single data point: `{ name, labels, value }`.
- **Metric** -- A named metric with metadata:
  `{ name, help, type, observations }`. The `type` corresponds to the Prometheus
  metric type (gauge, counter, histogram, etc.). The `observations` array holds
  one or more data points, typically one per label combination.
- **Prometheus** -- A `Record<string, Metric>` mapping metric names to their
  parsed `Metric` objects. This is the top-level output of the parser.

The `transform` function then extracts the first observation value from each
required metric and assembles a `MetricsSample`.

## Container Requirements

The target container must expose a `/metrics` endpoint that serves Prometheus
text format. The following metrics must be present in the response:

| Metric Name                     | Prometheus Type | Source                        |
| ------------------------------- | --------------- | ----------------------------- |
| `nodejs_heap_size_used_bytes`   | gauge           | `prom-client` default metrics |
| `nodejs_heap_size_total_bytes`  | gauge           | `prom-client` default metrics |
| `process_resident_memory_bytes` | gauge           | `prom-client` default metrics |
| `nodejs_active_handles_total`   | gauge           | `prom-client` default metrics |
| `nodejs_eventloop_lag_seconds`  | gauge           | `prom-client` default metrics |

These are all part of the default metric set provided by the
[prom-client](https://github.com/siimon/prom-client) library when
`collectDefaultMetrics()` is called. If any of these metrics are missing from
the response, the snapshot will fail and return `null`.

## Usage Examples

### Collecting samples during a test run

Create a Poller, let it run for the duration of the test, then retrieve the
samples:

```typescript
import { Container } from "loadbench-kit/docker/container.js";
import { Poller } from "loadbench-kit/metrics/poller.js";

const container = new Container("my-service");
await container.up();

const poller = new Poller(container, 2_000); // poll every 2 seconds
await poller.start();

// ... run your workload here ...

const samples = poller.stop();
console.log(`Collected ${samples.length} metric snapshots`);
```

### Taking a single baseline snapshot

Use the static `snapshot()` method to capture a one-off measurement before
applying load:

```typescript
import { Poller } from "loadbench-kit/metrics/poller.js";

const baseline = await Poller.snapshot("http://localhost:3000/metrics");

if (baseline) {
  console.log(`Baseline heap used: ${baseline.heapUsedBytes} bytes`);
  console.log(`Baseline RSS: ${baseline.rssBytes} bytes`);
  console.log(`Event loop lag: ${baseline.eventLoopLagSeconds}s`);
}
```

### Accessing collected samples after stopping

The `samples` array remains available on the Poller instance after `stop()` is
called. Each sample is timestamped, so you can compute deltas or find peaks:

```typescript
const poller = new Poller(container);
await poller.start();

// ... run workload ...

poller.stop();

const peakHeap = Math.max(...poller.samples.map((s) => s.heapUsedBytes));
const peakRss = Math.max(...poller.samples.map((s) => s.rssBytes));

console.log(`Peak heap used: ${peakHeap} bytes`);
console.log(`Peak RSS: ${peakRss} bytes`);

if (poller.samples.length >= 2) {
  const first = poller.samples[0];
  const last = poller.samples[poller.samples.length - 1];
  const heapDelta = last.heapUsedBytes - first.heapUsedBytes;
  console.log(`Heap delta over test run: ${heapDelta} bytes`);
}
```
