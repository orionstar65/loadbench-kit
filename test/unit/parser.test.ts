import fs from "node:fs";
import path from "node:path";

import { describe, it, expect } from "@jest/globals";
import parser from "loadbench-kit/metrics/parser.js";

const PROMETHEUS_TEXT = fs.readFileSync(
  path.join(import.meta.dirname, "prometheus.txt"),
  "utf8",
);

describe("parser", () => {
  describe("single metric, single observation", () => {
    it("parses name, help, type, and value", () => {
      const input = [
        "# HELP http_requests_total The total number of HTTP requests",
        "# TYPE http_requests_total counter",
        "http_requests_total 1027",
      ].join("\n");

      const result = parser.parse(input);

      expect(result).toHaveProperty("http_requests_total");
      const metric = result["http_requests_total"];
      expect(metric.name).toBe("http_requests_total");
      expect(metric.help).toBe("The total number of HTTP requests");
      expect(metric.type).toBe("counter");
      expect(metric.observations).toHaveLength(1);
      expect(metric.observations[0].value).toBe(1027);
      expect(metric.observations[0].labels).toEqual({});
    });
  });

  describe("metric with labels", () => {
    it("parses multiple observations with labels", () => {
      const input = [
        "# HELP http_request_duration_seconds HTTP request duration",
        "# TYPE http_request_duration_seconds histogram",
        'http_request_duration_seconds{method="GET",path="/api"} 0.5',
        'http_request_duration_seconds{method="POST",path="/api"} 1.2',
      ].join("\n");

      const result = parser.parse(input);

      const metric = result["http_request_duration_seconds"];
      expect(metric.observations).toHaveLength(2);
      expect(metric.observations[0].labels).toEqual({
        method: "GET",
        path: "/api",
      });
      expect(metric.observations[0].value).toBe(0.5);
      expect(metric.observations[1].labels).toEqual({
        method: "POST",
        path: "/api",
      });
      expect(metric.observations[1].value).toBe(1.2);
    });
  });

  describe("multiple metrics", () => {
    it("parses two metric blocks separated by blank line", () => {
      const input = [
        "# HELP http_requests_total The total number of HTTP requests",
        "# TYPE http_requests_total counter",
        "http_requests_total 1027",
        "",
        "# HELP process_cpu_seconds_total Total CPU time",
        "# TYPE process_cpu_seconds_total counter",
        "process_cpu_seconds_total 42.5",
      ].join("\n");

      const result = parser.parse(input);

      expect(Object.keys(result)).toHaveLength(2);
      expect(result).toHaveProperty("http_requests_total");
      expect(result).toHaveProperty("process_cpu_seconds_total");
      expect(result["process_cpu_seconds_total"].observations[0].value).toBe(
        42.5,
      );
    });
  });

  describe("trailing newlines", () => {
    it("handles input ending with \\n\\n", () => {
      const input =
        [
          "# HELP http_requests_total The total number of HTTP requests",
          "# TYPE http_requests_total counter",
          "http_requests_total 1027",
        ].join("\n") + "\n\n";

      expect(() => parser.parse(input)).not.toThrow();
      const result = parser.parse(input);
      expect(result).toHaveProperty("http_requests_total");
    });

    it("handles input ending with \\n\\n\\n", () => {
      const input =
        [
          "# HELP http_requests_total The total number of HTTP requests",
          "# TYPE http_requests_total counter",
          "http_requests_total 1027",
        ].join("\n") + "\n\n\n";

      expect(() => parser.parse(input)).not.toThrow();
      const result = parser.parse(input);
      expect(result).toHaveProperty("http_requests_total");
    });

    it("handles single trailing \\n after last value (real Prometheus output)", () => {
      const input = [
        "# HELP process_resident_memory_bytes Resident memory size in bytes",
        "# TYPE process_resident_memory_bytes gauge",
        "process_resident_memory_bytes 50000000\n",
      ].join("\n");

      expect(() => parser.parse(input)).not.toThrow();
      const result = parser.parse(input);
      expect(
        result["process_resident_memory_bytes"].observations[0].value,
      ).toBe(50000000);
    });
  });

  describe("metrics with no observations", () => {
    it("skips metric blocks that have HELP and TYPE but no values", () => {
      const input = [
        "# HELP http_requests_total The total number of HTTP requests",
        "# TYPE http_requests_total counter",
        "http_requests_total 1027",
        "",
        "# HELP http_request_duration_seconds Duration of HTTP requests",
        "# TYPE http_request_duration_seconds histogram",
        "",
        "# HELP process_cpu_seconds_total Total CPU time",
        "# TYPE process_cpu_seconds_total counter",
        "process_cpu_seconds_total 42.5",
      ].join("\n");

      expect(() => parser.parse(input)).not.toThrow();
      const result = parser.parse(input);
      expect(Object.keys(result)).toHaveLength(2);
      expect(result).not.toHaveProperty("http_request_duration_seconds");
    });
  });

  describe("observations with labels", () => {
    it("handles labels with empty string values", () => {
      const input = [
        "# HELP process_resident_memory_bytes Resident memory size in bytes",
        "# TYPE process_resident_memory_bytes gauge",
        'process_resident_memory_bytes{host="localhost",env="local",version=""} 50000000',
      ].join("\n");

      expect(() => parser.parse(input)).not.toThrow();
      const result = parser.parse(input);
      const obs = result["process_resident_memory_bytes"].observations[0];
      expect(obs.value).toBe(50000000);
      expect(obs.labels).toEqual({
        host: "localhost",
        env: "local",
        version: "",
      });
    });
  });

  describe("empty string", () => {
    it("returns empty object for empty input", () => {
      expect(() => parser.parse("")).not.toThrow();
      expect(parser.parse("")).toEqual({});
    });
  });

  describe("metric without labels", () => {
    it("returns empty labels object", () => {
      const input = [
        "# HELP process_resident_memory_bytes Resident memory size in bytes",
        "# TYPE process_resident_memory_bytes gauge",
        "process_resident_memory_bytes 12345678",
      ].join("\n");

      const result = parser.parse(input);

      const metric = result["process_resident_memory_bytes"];
      expect(metric.observations).toHaveLength(1);
      expect(metric.observations[0].labels).toEqual({});
      expect(metric.observations[0].value).toBe(12345678);
    });
  });

  describe("invalid input", () => {
    it("throws an error for invalid input", () => {
      expect(() => parser.parse("invalid input")).toThrow();
    });
  });

  describe("prometheus.txt", () => {
    it("parses the prometheus.txt file", () => {
      expect(() => parser.parse(PROMETHEUS_TEXT)).not.toThrow();
      const result = parser.parse(PROMETHEUS_TEXT);

      // Gauges and counters with labels
      expect(result).toHaveProperty("process_cpu_user_seconds_total");
      expect(result).toHaveProperty("process_resident_memory_bytes");
      expect(result).toHaveProperty("nodejs_heap_size_total_bytes");
      expect(result).toHaveProperty("nodejs_heap_size_used_bytes");
      expect(result).toHaveProperty("nodejs_eventloop_lag_seconds");
      expect(result).toHaveProperty("nodejs_active_handles_total");

      // Histogram with bucket/sum/count observations
      expect(result).toHaveProperty("nodejs_gc_duration_seconds");
      expect(result["nodejs_gc_duration_seconds"].observations).toHaveLength(4);

      // Empty metrics (HELP + TYPE, no values) are excluded
      expect(result).not.toHaveProperty("http_request_duration_seconds");
      expect(result).not.toHaveProperty("http_requests_total");
      expect(result).not.toHaveProperty("http_requests_in_flight");

      expect(Object.keys(result)).toHaveLength(7);
    });
  });
});
