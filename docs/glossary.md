# Glossary

Terms used throughout the performance test suite and SLA documentation.

---

## Test types

**Probe** — A lightweight health-check test that hits the `/alive` endpoint
under increasing concurrency to verify the connector stays responsive.

**Crawl** — A full content-discovery pass: paginate a listing endpoint, then
call metadata + download for every item on each page.

**Soak** — A sustained-duration test (minutes, not seconds) designed to surface
slow resource leaks that short burst tests miss.

**Ramp** — A progressive concurrency ladder that increases worker count step by
step, measuring memory and responsiveness at each level.

**Negative test** — A test that intentionally enables a known-bad code path
(buffer mode) and expects failure (OOMKill or threshold breach), confirming that
the fix under test is actually load-bearing.

---

## Load profile

**Tier** — A named load level (e.g. light, moderate, heavy, stress, ultrastress)
that specifies a concurrency and request count pair.

**Concurrency** — The number of parallel workers issuing requests simultaneously
during a tier.

**Corpus** — The document library used as the target dataset for crawl and
download tests. Configurable via `PERF_CORPUS_URL`.

**Threshold** — The maximum (or minimum) acceptable value for a metric in a
given test. A test fails when a measured value crosses its threshold. Examples:
peak RSS < 700 MB, error rate <= 10%, p99 latency <= 30,000 ms. See
`docs/performance.md` for the full set of enforced thresholds.

**Worker** — A single async loop that pulls from a shared request queue and
executes tasks sequentially. A tier's concurrency value determines how many
workers run in parallel (see `tier.ts`).

**Task** — The unit of work a worker executes on each iteration — typically a
single HTTP request wrapped by the `attempt()` helper, which captures status and
latency. Each tier defines its own task function.

---

## Latency and throughput

**p50 / p90 / p99** — Percentile latencies. p99 means 99% of requests completed
within this duration; the remaining 1% were slower.

**Error rate** — Percentage of requests that returned a non-success status
(anything other than `200` or `206`).

**Requests per second (Req/s)** — Total requests divided by elapsed wall-clock
time for a tier.

---

## Memory

**RSS (Resident Set Size)** — The total physical memory held by the process, as
reported by the Prometheus `process_resident_memory_bytes` gauge. This is the
primary metric for OOM risk because the kernel kills based on RSS, not heap.

**Heap used** — The V8 heap allocation reported by
`nodejs_heap_size_used_bytes`. A spike in heap without a corresponding RSS spike
may indicate GC pressure; a spike in both indicates buffering.

**Baseline** — The idle RSS or heap measurement taken before any load is
applied. Used as the reference point for recovery and spike calculations.

**Peak** — The highest RSS or heap value observed across all samples during a
test run.

**RSS slope** — The rate of RSS growth over time (bytes/ms, reported as MB/min),
computed via linear regression on post-warm-up samples. A positive slope above
the threshold indicates a memory leak.

**Recovery** — The RSS measurement taken after load stops and a GC wait period
elapses. Compared against baseline to detect retained references.

**Warm-up** — The initial period (default 30 s in soak tests) whose memory
samples are discarded before slope analysis, allowing JIT compilation and caches
to stabilize.

---

## Container health

**OOMKill** — The Linux kernel's out-of-memory killer terminated the container
because RSS exceeded the cgroup memory limit (1 GiB pod limit). Detected via
`docker inspect --format={{.State.OOMKilled}}`.

**Active handles** — The count of open libuv handles
(`nodejs_active_handles_total`): sockets, timers, file descriptors. A count that
does not return to near-baseline after load indicates a resource leak (unclosed
connections, lingering timers).

**Event loop lag** — The delay between when a timer is scheduled and when it
actually fires (`nodejs_eventloop_lag_seconds`). High lag means the event loop
is blocked by synchronous work, starving I/O callbacks.

---

## Streaming vs. buffering

**Buffer mode** — The pre-fix code path that accumulated entire file bodies in
memory before forwarding them. Caused OOMKill at moderate concurrency with large
files.

**Streaming** — The current code path that pipes response data through without
accumulating it in heap. The ramp and soak tests exist to guard against
regressions back to buffer mode.

**`SHAREPOINT_FORCE_BUFFER_MODE`** — Environment variable that reverts the
connector to the old buffering behavior. Used only by the negative test to prove
the streaming fix is necessary.

---

## Endpoints

**`/alive`** — Health-check probe endpoint. Returns `200 OK` when the container
is ready to serve requests.

**`/metrics`** — Prometheus exposition endpoint serving Node.js runtime gauges
(heap, RSS, event loop lag, active handles). Scraped by `MetricsPoller` during
tests.
