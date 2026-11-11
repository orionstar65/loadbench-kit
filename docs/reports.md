# Reports

Reports transform raw `Result` data from a runner execution into structured
analysis objects. Each report isolates a specific concern -- throughput,
latency, or memory -- so consumers can assert on exactly the metrics they care
about.

---

## FullReport

`FullReport` is the primary entry point. It takes a single `Result` from the
runner and produces all three sub-reports in one call.

```typescript
export interface FullReport {
  tier: Tier;
  summary?: SummaryReport;
  latency?: LatencyReport;
  memory?: MemoryReport;
  errors: string[];
}
```

The default export of `src/reports/full.ts` is the `Report` function:

```typescript
import Report from "loadbench-kit/reports/full.js";

const report: FullReport = Report(result);
```

`Report` delegates to each sub-report builder, passing `result.responses` to
Summary and Latency, and `result.metrics` to Memory. The `errors` array is
forwarded directly from the result.

---

## SummaryReport

```typescript
export interface SummaryReport {
  count: number;
  success: number;
  failure: number;
  failureRate: number;
  durationMs: number;
  requestsPerSecond: number;
}
```

Built from `ResponseSample[]`.

| Field               | Description                                                                                                                         |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `count`             | Total number of requests in the sample set.                                                                                         |
| `success`           | Requests that returned status `200` or `206`. All other status codes are failures.                                                  |
| `failure`           | `count - success`.                                                                                                                  |
| `failureRate`       | Percentage of failed requests: `(failure / count) * 100`. A value of `5` means 5%.                                                  |
| `durationMs`        | Elapsed wall-clock time from the start of the earliest request to the completion of the latest, rounded to the nearest millisecond. |
| `requestsPerSecond` | `count / (durationMs / 1000)`, rounded to the nearest integer.                                                                      |

When the sample set is empty, all fields return `0`.

---

## LatencyReport

```typescript
export interface LatencyReport {
  minMs: number;
  p50Ms: number;
  p90Ms: number;
  p99Ms: number;
  maxMs: number;
  range: number;
}
```

Built from `ResponseSample[]`. The `durationMs` value of each sample is
extracted and fed through the `percentile()` utility from `src/utils.ts`.

| Field   | Description                                                                                                     |
| ------- | --------------------------------------------------------------------------------------------------------------- |
| `minMs` | Fastest observed request duration.                                                                              |
| `p50Ms` | Median latency. 50% of requests completed within this time.                                                     |
| `p90Ms` | 90th percentile. 90% of requests completed within this time.                                                    |
| `p99Ms` | 99th percentile. Only 1% of requests were slower. This is the primary latency threshold used in SLA assertions. |
| `maxMs` | Slowest observed request duration.                                                                              |
| `range` | `maxMs - minMs`. A large range relative to p50 suggests high tail latency.                                      |

When the sample set is empty, all fields return `0`.

---

## MemoryReport

```typescript
export type Trend = "stable" | "growing" | "unknown";

export interface MemoryReport {
  count: number;
  trend: Trend;
  baselineRssBytes: number;
  peakRssBytes: number;
  peakHeapUsedBytes: number;
  finalRssBytes: number;
}
```

Built from `MetricsSample[]`.

| Field               | Description                                                             |
| ------------------- | ----------------------------------------------------------------------- |
| `count`             | Number of metrics samples collected during the run.                     |
| `trend`             | Memory growth classification (see below).                               |
| `baselineRssBytes`  | RSS from the first sample. Represents idle memory before load.          |
| `peakRssBytes`      | Highest RSS observed across all samples during the run.                 |
| `peakHeapUsedBytes` | Highest V8 heap used value observed across all samples.                 |
| `finalRssBytes`     | RSS from the last sample. Compared against baseline to determine trend. |

**Trend classification:**

- **`"unknown"`** -- Fewer than 2 RSS samples were collected. Not enough data to
  determine direction.
- **`"growing"`** -- `finalRssBytes - baselineRssBytes` exceeds 50 MB
  (`50 * 1024 * 1024` bytes). Indicates the process accumulated memory under
  load and did not release it.
- **`"stable"`** -- RSS growth stayed within the 50 MB threshold. Normal for a
  well-behaved streaming service.

When the sample set is empty, all byte fields return `NaN` and trend is
`"unknown"`.

---

## Individual report functions

Each sub-report can be used independently by importing from its module:

```typescript
import Summary from "loadbench-kit/reports/summary.js";
import Latency from "loadbench-kit/reports/latency.js";
import Memory from "loadbench-kit/reports/memory.js";
```

`Summary` and `Latency` accept `ResponseSample[]`. `Memory` accepts
`MetricsSample[]`. This is useful when you only need one dimension of analysis,
or when building custom composite reports.

---

## Usage examples

### Generating a FullReport from a runner Result

```typescript
import Report from "loadbench-kit/reports/full.js";
import type { Result } from "loadbench-kit/runner.js";

const result: Result = await runner.execute(tier, workload);
const report = Report(result);

console.log(`Throughput: ${report.summary?.requestsPerSecond} req/s`);
console.log(`p99 latency: ${report.latency?.p99Ms} ms`);
console.log(`Memory trend: ${report.memory?.trend}`);
console.log(`Errors: ${report.errors.length}`);
```

### Asserting on report values in a test

```typescript
import Report from "loadbench-kit/reports/full.js";
import type { Result } from "loadbench-kit/runner.js";

const result: Result = await runner.execute(tier, workload);
const { summary, latency, memory, errors } = Report(result);

expect(summary?.failureRate).toBeLessThanOrEqual(10);
expect(latency?.p99Ms).toBeLessThan(30_000);
expect(memory?.trend).not.toBe("growing");
expect(errors).toHaveLength(0);
```

### Using individual report functions

```typescript
import Summary from "loadbench-kit/reports/summary.js";
import Memory from "loadbench-kit/reports/memory.js";
import type {
  ResponseSample,
  MetricsSample,
} from "loadbench-kit/samples.js";

const responses: ResponseSample[] = collectResponses();
const metrics: MetricsSample[] = collectMetrics();

const summary = Summary(responses);
console.log(
  `${summary.success}/${summary.count} succeeded (${summary.failureRate}% failure)`,
);

const memory = Memory(metrics);
if (memory.trend === "growing") {
  console.warn(
    `RSS grew from ${memory.baselineRssBytes} to ${memory.finalRssBytes}`,
  );
}
```

### Custom Reports

A `Report` is _just_ a transformed view of a `Result` from the `runner`.

Mix and match `ResponseSamples` and `MetricsSamples` to create new reports that
support your performance-testing use case!
