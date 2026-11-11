import http from "node:http";
import { monitorEventLoopDelay } from "node:perf_hooks";

const lag = monitorEventLoopDelay({ resolution: 20 });
lag.enable();

function metrics() {
  const memory = process.memoryUsage();
  const activeHandles = typeof process._getActiveHandles === "function"
    ? process._getActiveHandles().length : 0;
  const observations = [
    ["nodejs_heap_size_used_bytes", "V8 heap used", memory.heapUsed],
    ["nodejs_heap_size_total_bytes", "V8 heap total", memory.heapTotal],
    ["process_resident_memory_bytes", "Resident memory", memory.rss],
    ["nodejs_active_handles_total", "Active Node handles", activeHandles],
    ["nodejs_eventloop_lag_seconds", "Mean event-loop delay", Number.isFinite(lag.mean) ? lag.mean / 1e9 : 0],
  ];
  return observations.map(([name, help, value]) => [
    `# HELP ${name} ${help}`,
    `# TYPE ${name} gauge`,
    `${name} ${value}`,
  ].join("\n")).join("\n\n") + "\n";
}

const server = http.createServer((request, response) => {
  if (request.url === "/ready" || request.url === "/alive") {
    response.writeHead(200, { "Content-Type": "text/plain; charset=utf-8" });
    response.end("ok\n");
  } else if (request.url === "/metrics") {
    response.writeHead(200, { "Content-Type": "text/plain; version=0.0.4" });
    response.end(metrics());
  } else {
    response.writeHead(404);
    response.end("Not found\n");
  }
});
server.listen(8081, "0.0.0.0");
