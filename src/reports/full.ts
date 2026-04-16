import Summary, { SummaryReport } from "loadbench-kit/reports/summary.js";
import Latency, { LatencyReport } from "loadbench-kit/reports/latency.js";
import Memory, { MemoryReport } from "loadbench-kit/reports/memory.js";
import type { Tier, Result } from "loadbench-kit/runner.js";

/**
 * Composite report that combines summary, latency, and memory reports for a
 * single tier run along with any errors collected from workers.
 *
 * @property tier    - The tier configuration that produced this report.
 * @property summary - Throughput and error-rate statistics (omitted if unavailable).
 * @property latency - Percentile latency distribution (omitted if unavailable).
 * @property memory  - Memory baseline, peak, and trend (omitted if unavailable).
 * @property errors  - Error messages forwarded by worker threads.
 */
export interface FullReport {
  tier: Tier;
  summary?: SummaryReport;
  latency?: LatencyReport;
  memory?: MemoryReport;
  errors: string[];
}

/**
 * Build a {@link FullReport} by running the summary, latency, and memory
 * report generators against the raw tier result.
 *
 * @param result - The aggregated {@link Result} from a single tier execution.
 * @returns A composite report suitable for logging or assertion.
 */
export default function Report(result: Result): FullReport {
  return {
    tier: result.tier,
    summary: Summary(result.responses),
    latency: Latency(result.responses),
    memory: Memory(result.metrics),
    errors: result.errors,
  };
}
