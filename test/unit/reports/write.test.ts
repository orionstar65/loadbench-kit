import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { describe, it, expect, beforeEach, afterEach } from "@jest/globals";
import {
  writeReport,
  renderMarkdown,
  mdTable,
  kvTable,
  ms,
} from "loadbench-kit/reports/write.js";
import Report from "loadbench-kit/reports/full.js";
import type { Result } from "loadbench-kit/runner.js";

function makeResult(overrides: Partial<Result> = {}): Result {
  return {
    tier: { name: "test", concurrency: 10, count: 100 },
    responses: [
      {
        url: "http://localhost/test",
        status: 200,
        durationMs: 100,
        timestampMs: 1000,
      },
      {
        url: "http://localhost/test",
        status: 200,
        durationMs: 200,
        timestampMs: 1100,
      },
      {
        url: "http://localhost/test",
        status: 500,
        durationMs: 50,
        timestampMs: 1200,
        error: "Server error",
      },
    ],
    metrics: [
      {
        timestampMs: 1000,
        heapUsedBytes: 5e6,
        heapTotalBytes: 10e6,
        rssBytes: 50e6,
        activeHandles: 5,
        eventLoopLagSeconds: 0.01,
      },
      {
        timestampMs: 2000,
        heapUsedBytes: 6e6,
        heapTotalBytes: 10e6,
        rssBytes: 52e6,
        activeHandles: 5,
        eventLoopLagSeconds: 0.02,
      },
    ],
    errors: ["Server error"],
    elapsed: 1200,
    ...overrides,
  };
}

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "perf-write-test-"));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("writeReport", () => {
  it("produces results.json and results.md in the output directory", () => {
    writeReport([makeResult()], tmpDir);

    expect(fs.existsSync(path.join(tmpDir, "results.json"))).toBe(true);
    expect(fs.existsSync(path.join(tmpDir, "results.md"))).toBe(true);
  });

  it("creates the output directory when it does not exist", () => {
    const nested = path.join(tmpDir, "a", "b", "c");
    writeReport([makeResult()], nested);

    expect(fs.existsSync(path.join(nested, "results.json"))).toBe(true);
    expect(fs.existsSync(path.join(nested, "results.md"))).toBe(true);
  });

  it("overwrites existing files on subsequent calls", () => {
    writeReport([makeResult()], tmpDir);
    const firstJson = fs.readFileSync(
      path.join(tmpDir, "results.json"),
      "utf8",
    );

    writeReport([makeResult(), makeResult()], tmpDir);
    const secondJson = fs.readFileSync(
      path.join(tmpDir, "results.json"),
      "utf8",
    );

    expect(firstJson).not.toEqual(secondJson);
  });

  describe("JSON output", () => {
    it("round-trips through JSON.parse", () => {
      writeReport([makeResult()], tmpDir);
      const raw = fs.readFileSync(path.join(tmpDir, "results.json"), "utf8");
      const parsed = JSON.parse(raw);

      expect(parsed).toBeDefined();
    });

    it("contains metadata and grouped results fields", () => {
      writeReport([makeResult()], tmpDir);
      const parsed = JSON.parse(
        fs.readFileSync(path.join(tmpDir, "results.json"), "utf8"),
      );

      expect(parsed.metadata).toBeDefined();
      expect(parsed.results).toBeDefined();
      expect(typeof parsed.results).toBe("object");
      expect(Array.isArray(parsed.results)).toBe(false);
    });

    it("results are grouped by tier name", () => {
      const results = [
        makeResult(),
        makeResult({ tier: { name: "tier-2", concurrency: 20, count: 200 } }),
      ];
      writeReport(results, tmpDir);
      const parsed = JSON.parse(
        fs.readFileSync(path.join(tmpDir, "results.json"), "utf8"),
      );

      expect(Object.keys(parsed.results)).toEqual(["test", "tier-2"]);
      expect(parsed.results["test"]).toHaveLength(1);
      expect(parsed.results["tier-2"]).toHaveLength(1);
    });

    it("each result contains tier, summary, latency, memory, errors", () => {
      writeReport([makeResult()], tmpDir);
      const parsed = JSON.parse(
        fs.readFileSync(path.join(tmpDir, "results.json"), "utf8"),
      );
      const result = parsed.results["test"][0];

      expect(result.tier).toBeDefined();
      expect(result.summary).toBeDefined();
      expect(result.latency).toBeDefined();
      expect(result.memory).toBeDefined();
      expect(result.errors).toBeDefined();
    });

    it("metadata includes packageVersion and nodeVersion as strings", () => {
      writeReport([makeResult()], tmpDir);
      const parsed = JSON.parse(
        fs.readFileSync(path.join(tmpDir, "results.json"), "utf8"),
      );

      expect(typeof parsed.metadata.packageVersion).toBe("string");
      expect(typeof parsed.metadata.nodeVersion).toBe("string");
      expect(typeof parsed.metadata.timestamp).toBe("string");
    });

    it("metadata includes title when provided", () => {
      writeReport([makeResult()], tmpDir, { title: "My Test Run" });
      const parsed = JSON.parse(
        fs.readFileSync(path.join(tmpDir, "results.json"), "utf8"),
      );

      expect(parsed.metadata.title).toBe("My Test Run");
    });

    it("metadata omits title when not provided", () => {
      writeReport([makeResult()], tmpDir);
      const parsed = JSON.parse(
        fs.readFileSync(path.join(tmpDir, "results.json"), "utf8"),
      );

      expect(parsed.metadata.title).toBeUndefined();
    });
  });
});

describe("renderMarkdown", () => {
  it("starts with title heading when provided", () => {
    const reports = [Report(makeResult())];
    const md = renderMarkdown(reports, { title: "My Report" });

    expect(md.startsWith("# My Report")).toBe(true);
  });

  it("uses default heading when no title provided", () => {
    const reports = [Report(makeResult())];
    const md = renderMarkdown(reports);

    expect(md.startsWith("# Performance Report")).toBe(true);
  });

  it("renders summary section when provided", () => {
    const reports = [Report(makeResult())];
    const md = renderMarkdown(reports, {
      title: "My Report",
      summary: "Node v22 · 1 GiB container",
    });

    expect(md).toContain("Node v22 · 1 GiB container");
    // summary appears before the first tier section
    const summaryIdx = md.indexOf("Node v22");
    const tierIdx = md.indexOf("## test");
    expect(summaryIdx).toBeLessThan(tierIdx);
  });

  it("omits summary section when not provided", () => {
    const reports = [Report(makeResult())];
    const md = renderMarkdown(reports, { title: "My Report" });

    // title is immediately followed by the first tier heading (no extra section)
    const lines = md.split("\n").filter((l) => l.trim().length > 0);
    expect(lines[0]).toBe("# My Report");
    expect(lines[1]).toBe("## test");
  });

  it("groups reports under tier-name headings", () => {
    const reports = [Report(makeResult())];
    const md = renderMarkdown(reports);

    expect(md).toContain("## test");
  });

  it("labels each table within a section", () => {
    const reports = [Report(makeResult())];
    const md = renderMarkdown(reports);

    expect(md).toContain("**Summary**");
    expect(md).toContain("**Latency**");
    expect(md).toContain("**Memory**");
  });

  it("contains Summary columns with Concurrency as identifier", () => {
    const reports = [Report(makeResult())];
    const md = renderMarkdown(reports);

    expect(md).toContain("| Concurrency");
    expect(md).toContain("Count");
    expect(md).toContain("Success");
    expect(md).toContain("Failure");
    expect(md).toContain("Rate");
    expect(md).toContain("RPS");
  });

  it("contains Latency columns", () => {
    const reports = [Report(makeResult())];
    const md = renderMarkdown(reports);

    expect(md).toContain("Min");
    expect(md).toContain("p50");
    expect(md).toContain("p90");
    expect(md).toContain("p99");
    expect(md).toContain("Max");
  });

  it("contains Memory table when memory data exists", () => {
    const reports = [Report(makeResult())];
    const md = renderMarkdown(reports);

    expect(md).toContain("Baseline RSS");
    expect(md).toContain("Peak RSS");
    expect(md).toContain("Peak Heap");
    expect(md).toContain("Trend");
  });

  it("omits Memory table when no reports have memory data", () => {
    const reports = [Report(makeResult({ metrics: [] }))];
    const md = renderMarkdown(reports);

    expect(md).not.toContain("Baseline RSS");
    expect(md).not.toContain("**Memory**");
  });

  it("creates separate sections for different tier names", () => {
    const reports = [
      Report(
        makeResult({ tier: { name: "tier-1", concurrency: 5, count: 50 } }),
      ),
      Report(
        makeResult({ tier: { name: "tier-2", concurrency: 10, count: 100 } }),
      ),
    ];
    const md = renderMarkdown(reports);

    expect(md).toContain("## tier-1");
    expect(md).toContain("## tier-2");
  });

  it("groups same-name tiers into one section with concurrency rows", () => {
    const reports = [
      Report(
        makeResult({ tier: { name: "probe", concurrency: 5, count: 50 } }),
      ),
      Report(
        makeResult({ tier: { name: "probe", concurrency: 10, count: 100 } }),
      ),
    ];
    const md = renderMarkdown(reports);

    // Only one ## probe heading
    expect(md.match(/## probe/g)).toHaveLength(1);
    // Both concurrency values present
    expect(md).toContain("| 5");
    expect(md).toContain("| 10");
  });

  it("single-tier output produces valid tables", () => {
    const reports = [Report(makeResult())];
    const md = renderMarkdown(reports);

    // Should have table separators (pipes and dashes)
    expect(md).toMatch(/\|[-\s|]+\|/);
    // Should have at least the header row and one data row in the section
    const section = md.split("## test")[1];
    const rows = section.split("\n").filter((l) => l.startsWith("|"));
    expect(rows.length).toBeGreaterThanOrEqual(3); // header + separator + 1 data row
  });
});

describe("mdTable", () => {
  it("renders a bold title above a pipe table", () => {
    const result = mdTable("Stats", ["Metric", "Value"], [["p99", "120ms"]]);
    const lines = result.split("\n");

    expect(lines[0]).toBe("**Stats**");
    expect(lines[1]).toBe("");
    expect(lines[2]).toContain("| Metric");
    expect(lines[3]).toMatch(/^\| -/);
    expect(lines[4]).toContain("| p99");
  });

  it("auto-pads columns to the widest value", () => {
    const result = mdTable(
      "T",
      ["A", "B"],
      [
        ["short", "x"],
        ["a-much-longer-value", "y"],
      ],
    );

    expect(result).toContain("a-much-longer-value");
    // header separator should be at least as wide as the longest value
    const separatorLine = result.split("\n")[3];
    const firstCol = separatorLine.split("|")[1].trim();
    expect(firstCol.length).toBeGreaterThanOrEqual(
      "a-much-longer-value".length,
    );
  });

  it("handles multiple rows", () => {
    const result = mdTable("Multi", ["H"], [["a"], ["b"], ["c"]]);
    const dataRows = result
      .split("\n")
      .filter((l) => l.startsWith("|"))
      .slice(2);

    expect(dataRows).toHaveLength(3);
  });

  it("handles empty rows", () => {
    const result = mdTable("Empty", ["H1", "H2"], []);
    const lines = result.split("\n");

    expect(lines[0]).toBe("**Empty**");
    expect(lines[2]).toContain("| H1");
    expect(lines[3]).toMatch(/^\| -/);
    expect(lines).toHaveLength(4); // title, blank, header, separator
  });
});

describe("kvTable", () => {
  it("renders a Property/Value table", () => {
    const result = kvTable("Environment", {
      Node: "v22.0.0",
      Platform: "darwin arm64",
    });

    expect(result).toContain("**Environment**");
    expect(result).toContain("| Property");
    expect(result).toContain("| Value");
    expect(result).toContain("| Node");
    expect(result).toContain("v22.0.0");
    expect(result).toContain("| Platform");
    expect(result).toContain("darwin arm64");
  });

  it("preserves insertion order of entries", () => {
    const result = kvTable("Order", { Z: "last", A: "first", M: "middle" });
    const dataRows = result
      .split("\n")
      .filter((l) => l.startsWith("|"))
      .slice(2);

    expect(dataRows[0]).toContain("Z");
    expect(dataRows[1]).toContain("A");
    expect(dataRows[2]).toContain("M");
  });

  it("handles empty entries", () => {
    const result = kvTable("Empty", {});
    expect(result).toContain("**Empty**");
    expect(result).toContain("| Property");
  });
});

describe("ms", () => {
  it("returns N/A for NaN", () => {
    expect(ms(NaN)).toBe("N/A");
  });

  it("formats sub-millisecond values with 2 decimal places", () => {
    expect(ms(0.12)).toBe("0.12ms");
    expect(ms(0.5)).toBe("0.50ms");
  });

  it("formats millisecond values as integers", () => {
    expect(ms(1)).toBe("1ms");
    expect(ms(123)).toBe("123ms");
    expect(ms(999)).toBe("999ms");
  });

  it("formats second-range values with 2 decimal places", () => {
    expect(ms(1000)).toBe("1.00s");
    expect(ms(1234)).toBe("1.23s");
    expect(ms(59999)).toBe("60.00s");
  });

  it("formats minute-range values as Xm Ys", () => {
    expect(ms(60000)).toBe("1m 0s");
    expect(ms(90000)).toBe("1m 30s");
    expect(ms(125000)).toBe("2m 5s");
  });
});
