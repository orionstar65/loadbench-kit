import type { ResponseSample } from "loadbench-kit/samples.js";

/**
 * High-level throughput and error-rate summary for a set of response samples.
 *
 * @property count             - Total number of requests executed.
 * @property success           - Requests that returned HTTP 200 or 206.
 * @property failure           - Requests that returned any other status code.
 * @property failureRate       - Failure percentage (0-100).
 * @property durationMs        - Effective wall-clock duration of the tier in ms.
 * @property requestsPerSecond - Throughput (count / duration).
 */
export interface SummaryReport {
  count: number;
  success: number;
  failure: number;
  failureRate: number;
  durationMs: number;
  requestsPerSecond: number;
}

/**
 * Compute the effective elapsed time across all samples.
 *
 * The earliest sample's `timestampMs` marks the moment its response arrived,
 * so we subtract that sample's own `durationMs` to approximate when the very
 * first request was *sent*. The span from that send time to the latest
 * timestamp gives the true wall-clock duration.
 *
 * @param samples - Non-empty array of response samples.
 * @returns Elapsed time in milliseconds.
 */
function elapsed(samples: ResponseSample[]): number {
  const timestamps = samples.map((s) => s.timestampMs);
  const minTimestampMs = Math.min(...timestamps);
  const maxTimestampMs = Math.max(...timestamps);
  const firstSample = samples.find((s) => s.timestampMs === minTimestampMs)!;
  return maxTimestampMs - (minTimestampMs - firstSample.durationMs);
}

/**
 * Generate a {@link SummaryReport} from an array of response samples.
 *
 * Returns zeroed-out fields when the input array is empty.
 *
 * @param samples - Response samples collected during a tier run.
 * @returns A summary report with throughput and error statistics.
 */
export default function (samples: ResponseSample[]): SummaryReport {
  if (samples.length === 0) {
    return {
      count: 0,
      success: 0,
      failure: 0,
      failureRate: 0,
      durationMs: 0,
      requestsPerSecond: 0,
    };
  }
  const errors = samples.filter((r) => !(r.status === 200 || r.status === 206));
  const durationMs = elapsed(samples);
  return {
    count: samples.length,
    success: samples.length - errors.length,
    failure: errors.length,
    failureRate: (errors.length / samples.length) * 100,
    durationMs: Math.round(durationMs),
    requestsPerSecond: Math.round(samples.length / (durationMs / 1000)),
  };
}
