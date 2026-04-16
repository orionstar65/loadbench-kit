import ejs from "ejs";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import Report from "loadbench-kit/reports/full.js";
import type { FullReport } from "loadbench-kit/reports/full.js";
import type { Result } from "loadbench-kit/runner.js";
import { mb } from "loadbench-kit/utils.js";
import pkg from "../../package.json" with { type: "json" };

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const template = fs.readFileSync(path.join(__dirname, "report.ejs"), "utf8");

/**
 * Metadata included at the top of every report output file.
 *
 * @property timestamp      - ISO 8601 timestamp when the report was generated.
 * @property packageVersion - Version of `loadbench-kit` that produced this report.
 * @property nodeVersion    - Node.js version the tests ran under.
 * @property title          - Optional label identifying the report (e.g. connector name + date).
 */
export interface ReportMetadata {
  timestamp: string;
  packageVersion: string;
  nodeVersion: string;
  title?: string;
}

/**
 * Top-level structure of the JSON report file.
 *
 * @property metadata - Generation metadata (timestamp, versions, optional title).
 * @property results  - Reports grouped by tier name. Each key is a tier name
 *                      and the value is the ordered array of {@link FullReport}
 *                      objects for that tier.
 */
export interface ReportOutput {
  metadata: ReportMetadata;
  results: Record<string, FullReport[]>;
}

/**
 * Format a millisecond duration as a human-readable string.
 *
 * Auto-scales: `< 1ms` → `0.12ms`, `< 1s` → `123ms`, `< 60s` → `1.23s`,
 * `>= 60s` → `1m 23s`.
 */
export function ms(value: number): string {
  if (isNaN(value)) return "N/A";
  if (value < 1) return `${value.toFixed(2)}ms`;
  if (value < 1_000) return `${Math.round(value)}ms`;
  if (value < 60_000) return `${(value / 1_000).toFixed(2)}s`;
  const minutes = Math.floor(value / 60_000);
  const seconds = ((value % 60_000) / 1_000).toFixed(0);
  return `${minutes}m ${seconds}s`;
}

/**
 * Format a percentage value.
 */
function pct(value: number): string {
  return isNaN(value) ? "N/A" : `${value.toFixed(1)}%`;
}

/**
 * Pad a string to a minimum width for table alignment.
 */
function pad(value: string, width: number): string {
  return value.padEnd(width);
}

/**
 * Render a Markdown table from headers and rows.
 */
function table(headers: string[], rows: string[][]): string {
  const widths = headers.map((h, i) =>
    Math.max(h.length, ...rows.map((r) => (r[i] ?? "").length)),
  );

  const header =
    "| " + headers.map((h, i) => pad(h, widths[i])).join(" | ") + " |";
  const separator = "| " + widths.map((w) => "-".repeat(w)).join(" | ") + " |";
  const body = rows.map(
    (row) =>
      "| " + row.map((cell, i) => pad(cell, widths[i])).join(" | ") + " |",
  );

  return [header, separator, ...body].join("\n");
}

/**
 * Render a titled Markdown table with arbitrary columns.
 *
 * Produces a `**title**` heading followed by a padded pipe table.
 * Use this in connector-side summary sections (Environment, Recommendations,
 * etc.) instead of hand-building markdown strings.
 *
 * @param title   - Bold heading rendered above the table.
 * @param headers - Column headers.
 * @param rows    - Row data (each inner array corresponds to one row).
 *
 * @example
 * ```typescript
 * mdTable("Recommendations", ["Metric", "Observed", "Action"], [
 *   ["Peak RSS", "312.5 MB", "Set memory limit to 512 MB"],
 * ]);
 * ```
 */
export function mdTable(
  title: string,
  headers: string[],
  rows: string[][],
): string {
  return [`**${title}**`, "", table(headers, rows)].join("\n");
}

/**
 * Render a titled two-column key-value Markdown table.
 *
 * Convenience wrapper over {@link mdTable} for the common case of a
 * Property / Value layout.
 *
 * @param title   - Bold heading rendered above the table.
 * @param entries - Key-value pairs in insertion order.
 *
 * @example
 * ```typescript
 * kvTable("Environment", {
 *   Node: process.version,
 *   Platform: "darwin arm64",
 *   CPUs: "10",
 * });
 * ```
 */
export function kvTable(
  title: string,
  entries: Record<string, string>,
): string {
  const rows = Object.entries(entries).map(([k, v]) => [k, v]);
  return mdTable(title, ["Property", "Value"], rows);
}

/**
 * Group an array of reports by tier name, preserving insertion order.
 */
function groupReports(reports: FullReport[]): Map<string, FullReport[]> {
  const groups = new Map<string, FullReport[]>();
  for (const report of reports) {
    const key = report.tier.name;
    const group = groups.get(key);
    if (group) {
      group.push(report);
    } else {
      groups.set(key, [report]);
    }
  }
  return groups;
}

/**
 * Options for {@link writeReport} and {@link renderMarkdown}.
 *
 * @property title   - Report heading (defaults to `"Performance Report"`).
 * @property summary - Free-form Markdown rendered between the title and the
 *                     first tier section. Typically used for system stats,
 *                     container resources, or other context the caller wants
 *                     at the top of the report.
 */
export interface WriteReportOptions {
  title?: string;
  summary?: string;
}

/**
 * Render a complete Markdown report from an array of {@link FullReport} objects.
 *
 * Reports are grouped by tier name. Each group becomes a `##` section
 * containing labeled Summary, Latency, and Memory tables. Concurrency is used
 * as the row identifier within each group.
 *
 * Layout is defined by the sibling `report.ejs` template. Helper functions
 * (`table`, `ms`, `pct`, `mb`) are passed as EJS locals so the template can
 * call them directly.
 */
export function renderMarkdown(
  reports: FullReport[],
  options?: WriteReportOptions,
): string {
  const groups = groupReports(reports);

  return ejs.render(template, {
    title: options?.title ?? "Performance Report",
    summary: options?.summary,
    groups,
    table,
    ms,
    pct,
    mb,
  });
}

/**
 * Write performance results to disk as `results.json` and `results.md`.
 *
 * Accepts one or more {@link Result} objects (multi-tier, multi-category),
 * generates {@link FullReport} objects for each, and writes both a
 * machine-readable JSON file and a human-readable Markdown file to the
 * specified output directory.
 *
 * The output directory is created if it does not exist.
 *
 * @param results   - Array of raw {@link Result} objects from the runner.
 * @param outputDir - Directory to write `results.json` and `results.md` into.
 * @param options   - Optional title, summary, and other report settings.
 *
 * @example
 * ```typescript
 * const result = await runner(tier, workload, container);
 * writeReport([result], "./test-results", {
 *   title: "confluence-connector",
 *   summary: "Node v22 · 1 GiB container · 200 corpus pages",
 * });
 * ```
 */
export function writeReport(
  results: Result[],
  outputDir: string,
  options?: WriteReportOptions,
): void {
  const reports = results.map(Report);
  const grouped = groupReports(reports);

  const groupedRecord: Record<string, FullReport[]> = {};
  for (const [key, value] of grouped) {
    groupedRecord[key] = value;
  }

  const output: ReportOutput = {
    metadata: {
      timestamp: new Date().toISOString(),
      packageVersion: pkg.version,
      nodeVersion: process.version,
      ...(options?.title ? { title: options.title } : {}),
    },
    results: groupedRecord,
  };

  fs.mkdirSync(outputDir, { recursive: true });
  fs.writeFileSync(
    path.join(outputDir, "results.json"),
    JSON.stringify(output, null, 2) + "\n",
  );
  fs.writeFileSync(
    path.join(outputDir, "results.md"),
    renderMarkdown(reports, options),
  );
}
