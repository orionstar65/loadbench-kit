import type { ResponseSample } from "loadbench-kit/samples.js";
import { percentile } from "loadbench-kit/utils.js";

/**
 * Latency distribution report computed from response durations.
 *
 * @property minMs - Fastest observed request duration.
 * @property p50Ms - Median (50th percentile) latency.
 * @property p90Ms - 90th percentile latency.
 * @property p99Ms - 99th percentile latency.
 * @property maxMs - Slowest observed request duration.
 * @property range - Spread between max and min latency (maxMs - minMs).
 */
export interface LatencyReport {
  minMs: number;
  p50Ms: number;
  p90Ms: number;
  p99Ms: number;
  maxMs: number;
  range: number;
}

/**
 * Generate a {@link LatencyReport} from an array of response samples.
 *
 * Returns zeroed-out fields when the input array is empty.
 *
 * @param samples - Response samples collected during a tier run.
 * @returns A latency report with percentile breakdowns.
 */
export default function (samples: ResponseSample[]): LatencyReport {
  if (samples.length === 0) {
    return { minMs: 0, p50Ms: 0, p90Ms: 0, p99Ms: 0, maxMs: 0, range: 0 };
  }
  const durations = samples.map((s) => s.durationMs);
  const minMs = Math.min(...durations);
  const maxMs = Math.max(...durations);
  const range = maxMs - minMs;
  const [p50Ms, p90Ms, p99Ms] = [50, 90, 99].map((p) =>
    percentile(durations, p),
  );
  return { minMs, p50Ms, p90Ms, p99Ms, maxMs, range };
}
