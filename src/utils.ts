/**
 * Compute a percentile value from a numeric array.
 *
 * The array is copied and sorted ascending before the index is calculated,
 * so the original input is not mutated.
 *
 * @param sorted - Array of numeric values (need not actually be pre-sorted).
 * @param p      - Desired percentile in the range 0-100 (e.g. 95 for p95).
 * @returns The value at the given percentile.
 */
export function percentile(sorted: number[], p: number): number {
  const arr = sorted.slice().sort((a, b) => a - b);
  const index = Math.ceil((p / 100) * arr.length) - 1;
  return arr[Math.max(0, index)];
}

/**
 * Format a byte count as a human-readable string.
 *
 * Auto-scales: `< 1 MB` → `"512.0 KB"`, `< 1 GB` → `"128.5 MB"`,
 * `>= 1 GB` → `"1.2 GB"`.
 *
 * @param bytes - Value in bytes.
 * @returns A formatted string, or `"N/A"` if the input is `NaN`.
 */
export function mb(bytes: number): string {
  if (isNaN(bytes)) return "N/A";
  const KB = 1024;
  const MB = KB * 1024;
  const GB = MB * 1024;
  if (bytes < MB) return `${(bytes / KB).toFixed(1)} KB`;
  if (bytes < GB) return `${(bytes / MB).toFixed(1)} MB`;
  return `${(bytes / GB).toFixed(2)} GB`;
}

/**
 * Poll an asynchronous condition at 100 ms intervals until it returns `true`
 * or the timeout expires.
 *
 * @param condition - Async function that returns `true` when the condition is met.
 * @param timeoutMs - Maximum time to wait in milliseconds (default 10 000).
 * @returns Resolves when the condition is satisfied.
 * @throws {Error} If the timeout elapses before the condition becomes `true`.
 */
export function waitFor(
  condition: () => Promise<boolean>,
  timeoutMs: number = 10_000,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      clearInterval(interval);
      reject(new Error("Timeout waiting for condition"));
    }, timeoutMs);
    const interval = setInterval(async () => {
      if (await condition()) {
        clearTimeout(timeout);
        clearInterval(interval);
        resolve();
      }
    }, 100);
  });
}
