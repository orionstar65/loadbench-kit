# Container Lifecycle

The `Container` class in `loadbench-kit` wraps the `docker` and
`docker compose` CLI to manage the full lifecycle of a Docker container used as
a performance testing target. It handles starting and stopping the container,
querying its runtime state, collecting resource metrics, and resolving the
container's localhost URL for worker threads.

## Construction

```typescript
import Container from "loadbench-kit/docker/container.js";

const container = new Container(cwd, name, service?);
```

| Parameter | Type     | Description                                                                                                                                     |
| --------- | -------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `cwd`     | `string` | Absolute path to the directory containing the `docker-compose.yaml` file. All Docker CLI commands execute with this as their working directory. |
| `name`    | `string` | The Docker container name (the `container_name` value in your compose file). Used for `docker inspect` and `docker stats` lookups.              |
| `service` | `string` | The Compose service name. Defaults to `"app"`. Passed to `docker compose up` and used to look up the service entry in `docker compose config`.  |

## Lifecycle Methods

### `up(env?)`

```typescript
async up(env?: Record<string, string>): Promise<void>
```

Starts the container by running `docker compose up --detach --wait <service>`.
The `--wait` flag causes the call to block until Docker considers the container
ready (based on any configured healthcheck). The optional `env` parameter is
merged with `process.env` and forwarded to the compose invocation, which is
useful for injecting build args or runtime configuration.

### `down()`

```typescript
async down(): Promise<void>
```

Stops the container by running `docker compose down` in the configured `cwd`.
This tears down all services and networks created by the compose file.

## Observing Stability

This is the primary use case for the `Container` class beyond simple start/stop.
During a performance test run, the runner polls the container's state to detect
instability: OOM kills, restarts, pauses, and health degradation. Each method
calls `docker inspect` under the hood and reads a field from
`DockerContainerState`.

### State-Checking Methods

All state-checking methods are async and return `Promise<boolean>`.

#### `isRunning()`

Returns `true` when the container's `State.Running` field is `true`. This is the
most basic liveness check. A container that is not running has either exited,
been killed, or has not yet started.

#### `isOomKilled()`

Returns `true` when `State.OOMKilled` is `true`. An OOM kill means the kernel
terminated the container's main process because it exceeded its memory limit.
This is a critical signal during performance testing -- it indicates that the
workload caused the container to exhaust its allocated memory.

#### `isPaused()`

Returns `true` when `State.Paused` is `true`. A paused container has had its
processes frozen via `docker pause`. This is uncommon during automated testing
but can indicate external interference or a stuck container orchestration step.

#### `isRestarting()`

Returns `true` when `State.Restarting` is `true`. A restarting container is in
the process of being restarted by Docker, typically due to a restart policy
triggered by a crash. During performance testing, unexpected restarts invalidate
timing data and signal instability.

#### `isHealthy()`

Returns `true` when `State.Health.Status` equals `"healthy"`. This checks the
Docker healthcheck result, not just whether the process is running. A container
can be running but unhealthy if its healthcheck command is failing.

### DockerContainerStatus

The `DockerContainerStatus` type represents the full set of Docker container
lifecycle states:

```typescript
type DockerContainerStatus =
  | "created"
  | "running"
  | "paused"
  | "restarting"
  | "removing"
  | "exited"
  | "dead";
```

These values come from the `State.Status` field in `docker inspect` output. The
convenience methods above cover the states most relevant to performance testing,
but the raw status is available through the underlying `DockerContainerState`
interface if needed.

### DockerHealthStatus

The `DockerHealthStatus` type represents the possible health states:

```typescript
type DockerHealthStatus = "none" | "starting" | "healthy" | "unhealthy";
```

- `"none"` -- the container has no healthcheck configured.
- `"starting"` -- the healthcheck has not yet passed for the first time.
- `"healthy"` -- the most recent healthcheck passed.
- `"unhealthy"` -- the healthcheck is failing. `Health.FailingStreak` contains
  the number of consecutive failures.

### DockerContainerState

The full state interface returned by `docker inspect`:

```typescript
interface DockerContainerState {
  Status: DockerContainerStatus;
  Running: boolean;
  OOMKilled: boolean;
  Paused: boolean;
  Restarting: boolean;
  StartedAt: Date;
  FinishedAt: Date;
  Pid: number;
  ExitCode: number;
  Error: string;
  Health: { Status: DockerHealthStatus; FailingStreak: number };
}
```

## Resource Metrics

### `stats()`

```typescript
async stats(): Promise<StatsResult>
```

Runs `docker stats --no-stream --format=json` and returns a `StatsResult`. The
raw Docker stats output includes string fields like `"150.5MiB / 2GiB"` for
memory usage. The `Container` class parses these into structured `Usage` objects
so that values can be compared and converted programmatically.

### StatsResult

`StatsResult` extends `DockerStatsResult` with parsed usage fields:

```typescript
type StatsResult = DockerStatsResult & {
  MemUsage: { Usage: Usage; Limit: Usage };
  BlockIO: { Read: Usage; Write: Usage };
  NetIO: { Read: Usage; Write: Usage };
};
```

The base `DockerStatsResult` includes:

| Field       | Type     | Description             |
| ----------- | -------- | ----------------------- |
| `ID`        | `string` | Container ID            |
| `Name`      | `string` | Container name          |
| `Container` | `string` | Short container ID      |
| `PIDs`      | `number` | Process count           |
| `CPUPerc`   | `number` | CPU usage percentage    |
| `MemPerc`   | `number` | Memory usage percentage |

### Usage Type

Each parsed metric is a `Usage` object:

```typescript
interface Usage {
  value: number;
  units: Units;
}
```

Where `Units` is one of: `B`, `kB`, `MB`, `GB`, `TB`, `KiB`, `MiB`, `GiB`,
`TiB`.

The `usage` module provides helpers for working with these values:

- `usage.parse(s)` -- parse a string like `"150.5MiB"` into a `Usage`.
- `usage.convert(u, to)` -- convert a `Usage` to different units.
- `usage.simplify(bytes)` -- convert a raw byte count to the most appropriate
  unit.

## Container URL Resolution

### `url()`

```typescript
async url(): Promise<string>
```

Resolves the container's localhost URL by reading the compose configuration. It
finds the first port mapping with `mode: "ingress"` and returns
`http://127.0.0.1:<published_port>`. Falls back to port `8080` if no ingress
port is found.

### `serviceConfig()`

```typescript
async serviceConfig(): Promise<DockerComposeServiceResult>
```

Returns the parsed compose configuration for this container's service. The
result includes the `image` and `ports` array from the compose file:

```typescript
interface DockerComposeServiceResult {
  image: string;
  ports: {
    published: number;
    target: number;
    protocol: string;
    mode: string;
  }[];
}
```

## Serialization

### `serialize()`

```typescript
async serialize(): Promise<ContainerInfo>
```

Returns a plain object that can be passed to worker threads. Worker threads
cannot receive class instances, so `serialize()` extracts the essential fields
into a `ContainerInfo`:

```typescript
interface ContainerInfo {
  name: string;
  service: string;
  url: string;
}
```

The `url` field is resolved at serialization time by calling `url()` internally.

`Workers` use this URL to send requests to the container under test.

## Usage Examples

### Creating and starting a container

```typescript
import Container from "loadbench-kit/docker/container.js";

const container = new Container("/path/to/project", "perf-test-target", "api");

await container.up({ LOG_LEVEL: "warn" });

const url = await container.url();
console.log(`Container ready at ${url}`);
```

### Checking container health in a loop

```typescript
import Container from "loadbench-kit/docker/container.js";

const container = new Container(process.cwd(), "perf-test-target");
await container.up();

const interval = setInterval(async () => {
  const running = await container.isRunning();
  const healthy = await container.isHealthy();
  const oomKilled = await container.isOomKilled();
  const restarting = await container.isRestarting();

  if (oomKilled) {
    console.error("Container was OOM killed -- aborting test");
    clearInterval(interval);
    await container.down();
    process.exit(1);
  }

  if (restarting) {
    console.warn("Container is restarting -- results may be invalid");
  }

  if (!running || !healthy) {
    console.warn(`Stability check: running=${running}, healthy=${healthy}`);
  }
}, 5000);
```

### Reading stats and interpreting memory usage

```typescript
import Container from "loadbench-kit/docker/container.js";
import usage from "loadbench-kit/docker/usage.js";

const container = new Container(process.cwd(), "perf-test-target");
await container.up();

const stats = await container.stats();

const memUsed = usage.convert(stats.MemUsage.Usage, "MiB");
const memLimit = usage.convert(stats.MemUsage.Limit, "MiB");
const memPercent = stats.MemPerc;

console.log(
  `Memory: ${memUsed.value} ${memUsed.units} / ${memLimit.value} ${memLimit.units} (${memPercent}%)`,
);
console.log(`CPU: ${stats.CPUPerc}%`);
console.log(
  `Block I/O read: ${stats.BlockIO.Read.value} ${stats.BlockIO.Read.units}`,
);
console.log(
  `Net I/O read: ${stats.NetIO.Read.value} ${stats.NetIO.Read.units}`,
);
```
