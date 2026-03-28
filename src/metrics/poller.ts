import Container from "loadbench-kit/docker/container.js";
import parser, { type Prometheus } from "loadbench-kit/metrics/parser.js";
import type { MetricsSample } from "loadbench-kit/samples.js";

// TODO: Abstract this so we can grab other metrics during testing if desired.
// Currently hard-coded to the five Node.js default Prometheus metrics below.
// A future refactor could accept a mapping config so callers choose which
// Prometheus metric names to extract and how to map them to sample fields.

/**
 * Map a raw Prometheus scrape into a single {@link MetricsSample}.
 *
 * Extracts the first observation from each of the five well-known Node.js
 * Prometheus metrics (heap used, heap total, RSS, active handles, event-loop
 * lag) and returns them in a flat object stamped with the current time.
 *
 * @param metrics - Parsed Prometheus metrics keyed by metric name.
 * @returns A timestamped snapshot of the container's memory and runtime state.
 */
function transform(metrics: Prometheus): MetricsSample {
  return {
    timestampMs: performance.now(),
    heapUsedBytes: metrics.nodejs_heap_size_used_bytes.observations[0].value,
    heapTotalBytes: metrics.nodejs_heap_size_total_bytes.observations[0].value,
    rssBytes: metrics.process_resident_memory_bytes.observations[0].value,
    activeHandles: metrics.nodejs_active_handles_total.observations[0].value,
    eventLoopLagSeconds:
      metrics.nodejs_eventloop_lag_seconds.observations[0].value,
  };
}

/**
 * Periodically scrapes a container's `/metrics` Prometheus endpoint and
 * collects {@link MetricsSample} snapshots into an in-memory array.
 *
 * Designed to run alongside a performance test so that memory and runtime
 * metrics are captured over the duration of the load run.
 */
export class Poller {
  public readonly samples: MetricsSample[] = [];
  private timer: ReturnType<typeof setInterval> | null = null;

  /**
   * @param container - The Docker container whose `/metrics` endpoint to poll.
   * @param delayMs   - Interval between polls in milliseconds (default 3 000).
   */
  constructor(
    private readonly container: Container,
    private readonly delayMs: number = 3_000,
  ) {}

  /**
   * Begin polling the container's `/metrics` endpoint at the configured
   * interval. Each successful scrape appends a {@link MetricsSample} to
   * {@link Poller.samples}. Failed fetches are silently discarded.
   */
  async start(): Promise<void> {
    const target = `${await this.container.url()}/metrics`;

    // Warm up the /metrics endpoint so the first poll returns a complete sample.
    await fetch(target, { signal: AbortSignal.timeout(5_000) }).catch(() => {
      console.warn("Failed to warm up /metrics endpoint");
    });

    const poll = () => {
      Poller.snapshot(target).then((sample) => {
        if (sample) this.samples.push(sample);
      });
    };
    this.timer = setInterval(poll, this.delayMs);
  }

  /**
   * Stop polling and return all collected samples.
   *
   * @returns The array of {@link MetricsSample} snapshots gathered since
   *          {@link start} was called.
   */
  stop(): MetricsSample[] {
    if (this.timer !== null) clearInterval(this.timer);
    this.timer = null;
    return this.samples;
  }

  /**
   * Take a single immediate snapshot of a Prometheus `/metrics` endpoint.
   *
   * Useful for capturing an idle baseline before a load run or a recovery
   * reading after workers have finished.
   *
   * The `target` URL is normalized: if it does not end with `/metrics`, the
   * suffix is appended automatically so callers can pass either a base
   * container URL or the full metrics URL.
   *
   * @param target    - Container base URL or full metrics endpoint URL.
   *                    Examples: `"http://localhost:8080"` or
   *                    `"http://localhost:8080/metrics"` — both work.
   * @param timeoutMs - Abort the fetch after this many milliseconds (default 5 000).
   * @param retries   - Number of retry attempts after the initial fetch fails
   *                    (default 0). Each retry waits 2 seconds before re-attempting.
   * @returns A {@link MetricsSample} on success, or `null` if all attempts
   *          fail or the response is not OK.
   */
  static async snapshot(
    target: string,
    timeoutMs: number = 5_000,
    retries: number = 0,
  ): Promise<MetricsSample | null> {
    const url = target.endsWith("/metrics") ? target : `${target}/metrics`;

    // TODO: Replace this retry loop with a RetryDispatcher (undici RetryHandler)
    // once the HTTP transport layer is rewritten on top of undici Agents/Pools.
    for (let attempt = 0; attempt <= retries; attempt++) {
      const result = await fetch(url, {
        signal: AbortSignal.timeout(timeoutMs),
      })
        .then((response) => (!response.ok ? null : response.text()))
        .then((text) => parser.parse(text!))
        .then(transform)
        .catch(() => null);

      if (result) return result;
      if (attempt < retries) {
        await new Promise((resolve) => setTimeout(resolve, 2_000));
      }
    }

    return null;
  }
}
