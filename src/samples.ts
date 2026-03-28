/**
 * Base type for all timestamped data points collected during a performance run.
 *
 * @property timestampMs - High-resolution monotonic timestamp (milliseconds) when
 *   the sample was recorded. Uses `performance.now()` in both workers and the Poller.
 */
export interface Sample {
  timestampMs: number;
}

/**
 * A single HTTP request/response measurement sent from a worker thread back
 * to the main thread via `postMessage`.
 *
 * @property url        - The URL that was requested.
 * @property status     - HTTP status code of the response.
 * @property durationMs - Round-trip time of the request in milliseconds.
 * @property error      - If present, the request resulted in an error and this
 *                        field contains the error message.
 */
export type ResponseSample = Sample & {
  url: string;
  status: number;
  durationMs: number;
  error?: string;
};

/**
 * A point-in-time snapshot of the container's Node.js runtime metrics,
 * scraped from the Prometheus `/metrics` endpoint.
 *
 * @property heapUsedBytes       - V8 heap memory currently in use (`nodejs_heap_size_used_bytes`).
 * @property heapTotalBytes      - V8 total heap size (`nodejs_heap_size_total_bytes`).
 * @property rssBytes            - Resident set size of the process (`process_resident_memory_bytes`).
 * @property activeHandles       - Number of active libuv handles (`nodejs_active_handles_total`).
 * @property eventLoopLagSeconds - Event loop lag in seconds (`nodejs_eventloop_lag_seconds`).
 */
export type MetricsSample = Sample & {
  heapUsedBytes: number;
  heapTotalBytes: number;
  rssBytes: number;
  activeHandles: number;
  eventLoopLagSeconds: number;
};
