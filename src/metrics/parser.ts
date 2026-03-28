/**
 * A single data point within a Prometheus metric.
 *
 * @property name   - Metric name (may include a suffix such as `_bucket`).
 * @property labels - Key/value label pairs attached to this observation.
 * @property value  - The numeric value of the observation.
 */
export interface Observation {
  name: string;
  labels: Record<string, string>;
  value: number;
}

/**
 * A fully parsed Prometheus metric block including its help text, type
 * declaration, and one or more observations.
 *
 * @property name         - The metric name (e.g. `nodejs_heap_size_used_bytes`).
 * @property help         - Human-readable description from the `# HELP` line.
 * @property type         - Prometheus type (`gauge`, `counter`, `histogram`, etc.).
 * @property observations - Individual data points belonging to this metric.
 */
export interface Metric {
  name: string;
  help: string;
  type: string;
  observations: Observation[];
}

// Matches: # HELP <metric_name> <description text>
const reHelp = /^# HELP\s+(?<name>\S+)\s+(?<help>.+)$/;

// Matches: # TYPE <metric_name> <prometheus_type>
const reType = /^# TYPE\s+(?<name>\S+)\s+(?<type>.+)$/;

// Matches a data line: optional leading whitespace, metric name, optional
// {label=value,...} block, then a numeric value.
const reLine = /^(\s+)?(?<name>[^\s{]+)(?:{(?<labels>.+)})?\s+(?<value>.+)$/;

/**
 * Parse a single `key="value"` label pair from inside a Prometheus label block.
 *
 * @param text - A string of the form `key="value"`.
 * @returns A `[key, value]` tuple with surrounding quotes removed from the value.
 */
function Label(text: string): [string, string] {
  const [key, value] = text.split("=");
  return [key, value.slice(1, -1)];
}

/**
 * Parse a single Prometheus data line into an {@link Observation}.
 *
 * @param text - A line such as `http_requests_total{method="GET"} 42`.
 * @returns The parsed observation with name, labels, and numeric value.
 * @throws {Error} If the line does not match the expected Prometheus format.
 */
function Line(text: string): Observation {
  const match = text.match(reLine);
  if (!match) throw new Error(`Invalid line: ${text}`);
  const labels = match.groups?.labels?.split(",").map(Label);
  return {
    name: match.groups?.name ?? "",
    labels: Object.fromEntries(labels ?? []),
    value: parseFloat(match.groups?.value ?? "0"),
  };
}

/**
 * Parse a full Prometheus metric block (HELP + TYPE + data lines) into a
 * structured {@link Metric} object.
 *
 * @param text - A block of text containing `# HELP`, `# TYPE`, and one or
 *               more data lines, separated by newlines.
 * @returns The parsed metric with help text, type, and observations.
 * @throws {Error} If the HELP or TYPE lines are missing or their names do
 *                 not match.
 */
function Metric(text: string): Metric {
  const [helpLine, typeLine, ...valueLines] = text.split("\n");
  const helpMatch = helpLine.match(reHelp);
  const typeMatch = typeLine.match(reType);

  if (!helpMatch || !typeMatch) throw new Error(`Invalid metric: ${text}`);
  if (helpMatch.groups?.name !== typeMatch.groups?.name)
    throw new Error(`Invalid metric: ${text}`);

  return {
    name: helpMatch.groups?.name ?? "",
    help: helpMatch.groups?.help ?? "",
    type: typeMatch.groups?.type ?? "",
    observations: valueLines.filter((line) => line.trim()).map(Line),
  };
}

/**
 * A dictionary of Prometheus metrics keyed by metric name.
 *
 * Produced by {@link parse} and consumed by the {@link Poller}'s `transform`
 * function to extract specific runtime metrics.
 */
export type Prometheus = Record<string, Metric>;

/**
 * Parse a full Prometheus text exposition into a {@link Prometheus} dictionary.
 *
 * Metric blocks are separated by blank lines. Each block is parsed by
 * {@link Metric}, and blocks with zero observations are discarded.
 *
 * @param text - Raw Prometheus text exposition (the body of a `/metrics` response).
 * @returns A record mapping metric names to their parsed {@link Metric} objects.
 */
function parse(text: string): Prometheus {
  return Object.fromEntries(
    text
      .split("\n\n")
      .filter((block) => block.trim())
      .map(Metric)
      .filter(Boolean)
      .filter((metric) => metric.observations.length > 0)
      .map((metric) => [metric.name, metric]),
  );
}

export default { parse };
