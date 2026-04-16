import type { MetricsSample } from "loadbench-kit/samples.js";

/**
 * Describes the overall memory trajectory during a performance run.
 *
 * - `"stable"`  -- RSS growth stayed within the threshold.
 * - `"growing"` -- RSS grew by more than the threshold from baseline to final.
 * - `"unknown"` -- Fewer than two samples were available to determine a trend.
 */
export type Trend = "stable" | "growing" | "unknown";

/**
 * Memory usage report derived from Prometheus metric samples.
 *
 * @property count            - Number of metric samples analyzed.
 * @property trend            - Whether memory was stable, growing, or unknown.
 * @property baselineRssBytes - RSS value of the first sample (idle baseline).
 * @property peakRssBytes     - Highest RSS value observed during the run.
 * @property peakHeapUsedBytes - Highest V8 heap-used value observed.
 * @property finalRssBytes    - RSS value of the last sample (post-run).
 */
export interface MemoryReport {
  count: number;
  trend: Trend;
  baselineRssBytes: number;
  peakRssBytes: number;
  peakHeapUsedBytes: number;
  finalRssBytes: number;
}

/**
 * Return a report with `NaN` values and `"unknown"` trend, used when there
 * are no metric samples to analyze.
 *
 * @param samples - The (empty) input array (unused, kept for call-site symmetry).
 * @returns A zeroed-out {@link MemoryReport}.
 */
function NullReport(samples: MetricsSample[]): MemoryReport {
  return {
    baselineRssBytes: NaN,
    peakRssBytes: NaN,
    peakHeapUsedBytes: NaN,
    finalRssBytes: NaN,
    count: 0,
    trend: "unknown",
  };
}

/**
 * Generate a {@link MemoryReport} from an array of Prometheus metric samples.
 *
 * Computes baseline, peak, and final RSS/heap values and classifies the
 * memory trend based on a fixed growth threshold.
 *
 * @param samples - Metric samples collected by the {@link Poller} during a run.
 * @returns A memory report summarizing resource consumption and trend.
 */
export default function (samples: MetricsSample[]): MemoryReport {
  if (samples.length === 0) return NullReport(samples);

  const rssValues = samples.map((s) => s.rssBytes).filter(Boolean);
  const heapValues = samples.map((s) => s.heapUsedBytes).filter(Boolean);

  const baselineRssBytes = rssValues[0] ?? NaN;
  const peakRssBytes = Math.max(...rssValues);
  const peakHeapUsedBytes = Math.max(...heapValues);
  const finalRssBytes = rssValues[rssValues.length - 1] ?? NaN;

  // If final RSS exceeds the baseline by more than 50 MB, the container is
  // considered to have a growing memory footprint. 50 MB was chosen as a
  // reasonable heuristic -- small enough to catch meaningful leaks, large
  // enough to tolerate normal GC fluctuation in a Node.js process.
  const GROWTH_THRESHOLD = 50 * 1024 * 1024;
  const trend: Trend =
    rssValues.length < 2
      ? "unknown"
      : finalRssBytes - baselineRssBytes > GROWTH_THRESHOLD
        ? "growing"
        : "stable";

  return {
    count: samples.length,
    trend,
    baselineRssBytes,
    peakRssBytes,
    peakHeapUsedBytes,
    finalRssBytes,
  };
}
